use crate::modules::oauth;
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::{rngs::OsRng, RngCore};
use std::collections::HashMap;
use std::sync::{Arc, Mutex, OnceLock};
use tauri::Url;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio::sync::oneshot;
use tokio::sync::watch;
use tokio::time::{timeout, Duration};

struct OAuthFlowState {
    redirect_uri: String,
    expected_state: String,
    code_verifier: String,
    client: Arc<oauth::OAuthClientConfig>,
    cancel_tx: watch::Sender<bool>,
    code_tx: Arc<tokio::sync::Mutex<Option<oneshot::Sender<Result<String, String>>>>>,
    code_rx: Option<oneshot::Receiver<Result<String, String>>>,
}

#[derive(serde::Serialize)]
pub struct PreparedOAuthFlow {
    id: uuid::Uuid,
    url: String,
}

static OAUTH_FLOWS: OnceLock<Mutex<HashMap<uuid::Uuid, OAuthFlowState>>> = OnceLock::new();
const OAUTH_CALLBACK_PATH: &str = "/oauth-callback";
const MAX_HTTP_REQUEST_BYTES: usize = 32 * 1024;
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(5);
const OAUTH_FLOW_WAIT_TIMEOUT: Duration = Duration::from_secs(10 * 60);

fn oauth_flows() -> &'static Mutex<HashMap<uuid::Uuid, OAuthFlowState>> {
    OAUTH_FLOWS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn oauth_success_html() -> &'static str {
    "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\r\n\
    <html>\
    <body style='font-family: sans-serif; text-align: center; padding: 50px; background: #0d1117; color: #fff;'>\
        <h1 style='color: #4ade80;'>✅ 授权成功!</h1>\
        <p>您可以关闭此窗口返回应用。</p>\
        <script>setTimeout(function() { window.close(); }, 2000);</script>\
    </body>\
    </html>"
}

fn oauth_fail_html(message: &str) -> String {
    format!(
        "HTTP/1.1 400 Bad Request\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nReferrer-Policy: no-referrer\r\n\r\n\
    <html>\
    <body style='font-family: sans-serif; text-align: center; padding: 50px; background: #0d1117; color: #fff;'>\
        <h1 style='color: #f87171;'>❌ 授权失败</h1>\
        <p>{}</p>\
    </body>\
    </html>",
        message
    )
}

fn oauth_not_found_response() -> &'static str {
    "HTTP/1.1 404 Not Found\r\nContent-Type: text/plain; charset=utf-8\r\n\r\nNot Found"
}

fn callback_result(callback_url: &Url, expected_state: &str) -> Option<Result<String, String>> {
    let mut code = None;
    let mut state = None;
    let mut denied = false;
    for (key, value) in callback_url.query_pairs() {
        match key.as_ref() {
            "code" if code.is_none() => code = Some(value.into_owned()),
            "state" if state.is_none() => state = Some(value.into_owned()),
            "error" if !value.is_empty() => denied = true,
            _ => {}
        }
    }

    if state.as_deref() != Some(expected_state) {
        return None;
    }
    if denied {
        return Some(Err("Google 授权未完成，请重新发起授权".to_string()));
    }
    code.filter(|value| !value.trim().is_empty()).map(Ok)
}

fn parse_manual_callback_url(raw_callback_url: &str, redirect_uri: &str) -> Result<Url, String> {
    let trimmed = raw_callback_url.trim();
    if trimmed.is_empty() {
        return Err("回调链接不能为空".to_string());
    }

    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Url::parse(trimmed).map_err(|e| format!("OAuth 回调 URL 解析失败: {}", e));
    }

    let redirect =
        Url::parse(redirect_uri).map_err(|e| format!("OAuth redirect_uri 无效: {}", e))?;
    let host = redirect
        .host_str()
        .ok_or_else(|| "OAuth redirect_uri 缺少 host".to_string())?;
    let origin = match redirect.port() {
        Some(port) => format!("{}://{}:{}", redirect.scheme(), host, port),
        None => format!("{}://{}", redirect.scheme(), host),
    };

    if trimmed.starts_with('/') {
        return Url::parse(format!("{}{}", origin, trimmed).as_str())
            .map_err(|e| format!("OAuth 回调 URL 解析失败: {}", e));
    }

    Url::parse(
        format!(
            "{}{}?{}",
            origin,
            OAUTH_CALLBACK_PATH,
            trimmed.trim_start_matches('?')
        )
        .as_str(),
    )
    .map_err(|e| format!("OAuth 回调 URL 解析失败: {}", e))
}

async fn read_http_request(stream: &mut tokio::net::TcpStream) -> Result<String, String> {
    let mut buffer = Vec::with_capacity(4096);
    let mut chunk = [0u8; 2048];

    loop {
        let bytes_read = stream
            .read(&mut chunk)
            .await
            .map_err(|e| format!("读取 OAuth 回调请求失败: {}", e))?;

        if bytes_read == 0 {
            break;
        }

        buffer.extend_from_slice(&chunk[..bytes_read]);
        if buffer.windows(4).any(|window| window == b"\r\n\r\n") {
            return Ok(String::from_utf8_lossy(&buffer).into_owned());
        }
        if buffer.len() >= MAX_HTTP_REQUEST_BYTES {
            break;
        }
    }

    Err("OAuth 回调请求不完整或超过长度限制".to_string())
}

fn parse_request_target(request: &str) -> Result<(String, String), String> {
    let request_line = request
        .lines()
        .next()
        .ok_or_else(|| "OAuth 回调请求行为空".to_string())?;
    let mut parts = request_line.split_whitespace();
    let method = parts
        .next()
        .ok_or_else(|| "OAuth 回调请求缺少 method".to_string())?;
    let target = parts
        .next()
        .ok_or_else(|| "OAuth 回调请求缺少 target".to_string())?;

    Ok((method.to_string(), target.to_string()))
}

async fn process_callback_request(
    stream: &mut tokio::net::TcpStream,
    port: u16,
    expected_state: &str,
) -> Option<Result<String, String>> {
    let request = timeout(REQUEST_READ_TIMEOUT, read_http_request(stream))
        .await
        .ok()?
        .ok()?;
    let (method, target) = parse_request_target(&request).ok()?;
    let callback_url = Url::parse(&format!("http://localhost:{port}{target}")).ok()?;
    if method != "GET" || !target.starts_with('/') || callback_url.path() != OAUTH_CALLBACK_PATH {
        let _ = stream
            .write_all(oauth_not_found_response().as_bytes())
            .await;
        let _ = stream.flush().await;
        return None;
    }

    let result = callback_result(&callback_url, expected_state);
    let response = match &result {
        Some(Ok(_)) => oauth_success_html().to_owned(),
        Some(Err(message)) => oauth_fail_html(message),
        None => oauth_fail_html("回调链接与当前授权不匹配，请使用当前授权链接重试。"),
    };
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.flush().await;

    result
}

// Listen on both loopback families before advertising localhost. A single-family
// machine gets an explicit IP so the browser cannot choose an unbound address.
struct OAuthCallbackListeners {
    ipv4: Option<TcpListener>,
    ipv6: Option<TcpListener>,
    port: u16,
}

fn callback_redirect_uri(port: u16, has_ipv4: bool, has_ipv6: bool) -> String {
    let host = match (has_ipv4, has_ipv6) {
        (true, true) => "localhost",
        (true, false) => "127.0.0.1",
        (false, true) => "[::1]",
        (false, false) => unreachable!("OAuth needs a bound loopback listener"),
    };
    format!("http://{}:{}{}", host, port, OAUTH_CALLBACK_PATH)
}

async fn bind_callback_listeners() -> Result<OAuthCallbackListeners, String> {
    let (first, is_ipv6) = match TcpListener::bind("[::1]:0").await {
        Ok(listener) => (listener, true),
        Err(_) => (
            TcpListener::bind("127.0.0.1:0")
                .await
                .map_err(|e| format!("无法绑定本地端口: {}", e))?,
            false,
        ),
    };
    let port = first
        .local_addr()
        .map_err(|e| format!("无法获取本地端口: {}", e))?
        .port();
    let other_address = if is_ipv6 {
        format!("127.0.0.1:{}", port)
    } else {
        format!("[::1]:{}", port)
    };
    let other = TcpListener::bind(&other_address).await.ok();
    let (ipv4, ipv6) = if is_ipv6 {
        (other, Some(first))
    } else {
        (Some(first), other)
    };
    Ok(OAuthCallbackListeners { ipv4, ipv6, port })
}

async fn accept_callback(
    listener: &Option<TcpListener>,
) -> std::io::Result<(tokio::net::TcpStream, std::net::SocketAddr)> {
    match listener {
        Some(listener) => listener.accept().await,
        None => std::future::pending().await,
    }
}

pub async fn prepare_oauth_url(app_handle: tauri::AppHandle) -> Result<PreparedOAuthFlow, String> {
    let client = Arc::new(oauth::oauth_client_config()?);
    let listeners = bind_callback_listeners().await?;
    let port = listeners.port;
    let redirect_uri =
        callback_redirect_uri(port, listeners.ipv4.is_some(), listeners.ipv6.is_some());
    let id = uuid::Uuid::new_v4();
    let expected_state = uuid::Uuid::new_v4().to_string();
    let mut verifier_bytes = [0; 32];
    OsRng.fill_bytes(&mut verifier_bytes);
    let code_verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);
    let url = oauth::get_auth_url(&client, &redirect_uri, &expected_state, &code_verifier);

    let (cancel_tx, mut cancel_rx) = watch::channel(false);
    let (code_tx, code_rx) = oneshot::channel();
    let code_tx = Arc::new(tokio::sync::Mutex::new(Some(code_tx)));
    oauth_flows()
        .lock()
        .map_err(|_| "OAuth 状态锁不可用".to_string())?
        .insert(
            id,
            OAuthFlowState {
                redirect_uri,
                expected_state: expected_state.clone(),
                code_verifier,
                client,
                cancel_tx,
                code_tx: code_tx.clone(),
                code_rx: Some(code_rx),
            },
        );

    tokio::spawn(async move {
        use tauri::Emitter;

        let listen = async {
            loop {
                let accepted = tokio::select! {
                    result = accept_callback(&listeners.ipv4) => result,
                    result = accept_callback(&listeners.ipv6) => result,
                };
                if let Ok((mut stream, _)) = accepted {
                    if let Some(result) =
                        process_callback_request(&mut stream, port, &expected_state).await
                    {
                        if let Some(sender) = code_tx.lock().await.take() {
                            let _ = sender.send(result);
                            let _ = app_handle.emit("oauth-callback-received", ());
                        }
                        break;
                    }
                } else {
                    break;
                }
            }
        };
        let deadline = tokio::time::sleep(OAUTH_FLOW_WAIT_TIMEOUT);
        tokio::pin!(deadline);
        tokio::select! {
            _ = cancel_rx.changed() => return,
            _ = &mut deadline => {}
            _ = listen => {
                drop(listeners);
                tokio::select! {
                    _ = cancel_rx.changed() => return,
                    _ = &mut deadline => {}
                }
            }
        }
        cancel_oauth_flow(id);
    });

    Ok(PreparedOAuthFlow { id, url })
}

pub fn cancel_oauth_flow(id: uuid::Uuid) {
    if let Ok(mut flows) = oauth_flows().lock() {
        if let Some(flow) = flows.remove(&id) {
            let _ = flow.cancel_tx.send(true);
        }
    }
}

pub async fn submit_oauth_callback_url(
    app_handle: tauri::AppHandle,
    id: uuid::Uuid,
    callback_url: &str,
) -> Result<(), String> {
    use tauri::Emitter;

    let (redirect_uri, expected_state, code_tx) = {
        let flows = oauth_flows()
            .lock()
            .map_err(|_| "OAuth 状态锁不可用".to_string())?;
        let flow = flows
            .get(&id)
            .ok_or_else(|| "授权已取消或过期，请重新发起授权".to_string())?;
        (
            flow.redirect_uri.clone(),
            flow.expected_state.clone(),
            flow.code_tx.clone(),
        )
    };
    let parsed = parse_manual_callback_url(callback_url, &redirect_uri)?;
    let redirect =
        Url::parse(&redirect_uri).map_err(|e| format!("OAuth redirect_uri 无效: {e}"))?;
    if parsed.origin() != redirect.origin() || parsed.path() != redirect.path() {
        return Err("回调链接地址与当前授权不匹配".to_string());
    }
    let result = callback_result(&parsed, &expected_state)
        .ok_or_else(|| "回调链接缺少授权结果或状态与当前授权不匹配".to_string())?;

    let sender = code_tx
        .lock()
        .await
        .take()
        .ok_or_else(|| "OAuth 回调已处理，请勿重复提交".to_string())?;
    sender
        .send(result)
        .map_err(|_| "OAuth 回调发送失败，请重新发起授权".to_string())?;
    let _ = app_handle.emit("oauth-callback-received", ());
    Ok(())
}

pub async fn start_oauth_flow(
    app_handle: tauri::AppHandle,
) -> Result<oauth::TokenResponse, String> {
    use tauri_plugin_opener::OpenerExt;

    let flow = prepare_oauth_url(app_handle.clone()).await?;
    app_handle
        .opener()
        .open_url(&flow.url, None::<String>)
        .map_err(|e| {
            cancel_oauth_flow(flow.id);
            format!("无法打开浏览器: {e}")
        })?;
    complete_oauth_flow(flow.id).await
}

pub async fn complete_oauth_flow(id: uuid::Uuid) -> Result<oauth::TokenResponse, String> {
    let (code_rx, redirect_uri, code_verifier, client, mut cancel_rx) = {
        let mut flows = oauth_flows()
            .lock()
            .map_err(|_| "OAuth 状态锁不可用".to_string())?;
        let flow = flows
            .get_mut(&id)
            .ok_or_else(|| "授权已取消或过期，请重新发起授权".to_string())?;
        let code_rx = flow
            .code_rx
            .take()
            .ok_or_else(|| "OAuth 授权已在进行中".to_string())?;
        (
            code_rx,
            flow.redirect_uri.clone(),
            flow.code_verifier.clone(),
            flow.client.clone(),
            flow.cancel_tx.subscribe(),
        )
    };

    let finish = async {
        let code = code_rx
            .await
            .map_err(|_| "等待 OAuth 回调失败".to_string())??;
        oauth::exchange_code(&code, &redirect_uri, &code_verifier, &client).await
    };
    let result = tokio::select! {
        biased;
        _ = cancel_rx.changed() => Err("授权已取消或过期，请重新发起授权".to_string()),
        result = finish => result,
    };
    cancel_oauth_flow(id);
    result
}

#[cfg(test)]
#[path = "oauth_server_tests.rs"]
mod tests;
