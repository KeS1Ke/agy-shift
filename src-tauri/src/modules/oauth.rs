use serde::{Deserialize, Serialize};

const TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v2/userinfo";
const AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const DEFAULT_OAUTH_CLIENT_KEY: &str = "antigravity_enterprise";
const TOKEN_REFRESH_SKEW_SECONDS: i64 = 900;
// Match Antigravity-Manager's native OAuth UA and known-stable fallback.
// Do not run version probes or remote discovery on the authorization path.
const NATIVE_OAUTH_USER_AGENT: &str = "vscode/1.X.X (Antigravity/4.3.0)";

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenResponse {
    pub access_token: String,
    pub expires_in: i64,
    #[serde(default)]
    pub token_type: String,
    #[serde(default)]
    pub refresh_token: Option<String>,
    #[serde(default)]
    pub id_token: Option<String>,
    #[serde(skip)]
    pub oauth_client_key: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct UserInfo {
    #[serde(default)]
    pub id: Option<String>,
    pub email: String,
    pub name: Option<String>,
    pub given_name: Option<String>,
    pub family_name: Option<String>,
    pub picture: Option<String>,
}

impl UserInfo {
    pub fn get_display_name(&self) -> Option<String> {
        if let Some(name) = &self.name {
            if !name.trim().is_empty() {
                return Some(name.clone());
            }
        }

        match (&self.given_name, &self.family_name) {
            (Some(given), Some(family)) => Some(format!("{} {}", given, family)),
            (Some(given), None) => Some(given.clone()),
            (None, Some(family)) => Some(family.clone()),
            (None, None) => None,
        }
    }
}

const OAUTH_CLIENT_ID_ENV: &str = "AGY_SHIFT_GOOGLE_OAUTH_CLIENT_ID";
const OAUTH_CLIENT_SECRET_ENV: &str = "AGY_SHIFT_GOOGLE_OAUTH_CLIENT_SECRET";
const BUILTIN_OAUTH_CLIENT_ID: Option<&str> = option_env!("AGY_SHIFT_GOOGLE_OAUTH_CLIENT_ID");
const BUILTIN_OAUTH_CLIENT_SECRET: Option<&str> =
    option_env!("AGY_SHIFT_GOOGLE_OAUTH_CLIENT_SECRET");

pub(super) struct OAuthClientConfig {
    id: String,
    secret: String,
    key: String,
}

impl OAuthClientConfig {
    pub(super) fn new(id: String, secret: String) -> Self {
        let key = format!("google:{id}");
        Self { id, secret, key }
    }
}

fn compiled_oauth_client_config() -> Option<OAuthClientConfig> {
    resolve_oauth_client_credentials(
        None,
        None,
        BUILTIN_OAUTH_CLIENT_ID,
        BUILTIN_OAUTH_CLIENT_SECRET,
    )
    .ok()
    .map(|(id, secret)| OAuthClientConfig::new(id, secret))
}

#[derive(Debug, thiserror::Error)]
pub(crate) enum RefreshError {
    #[error("刷新失败: invalid_grant")]
    InvalidGrant,
    #[error("OAuth 续期失败 (invalid_grant)，无法确认旧令牌对应的 OAuth 客户端")]
    UnverifiedGrant,
    #[error("{0}")]
    Other(String),
}

impl From<RefreshError> for String {
    fn from(error: RefreshError) -> Self {
        error.to_string()
    }
}

fn normalize_non_empty(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn resolve_oauth_client_credentials(
    runtime_id: Option<&str>,
    runtime_secret: Option<&str>,
    builtin_id: Option<&str>,
    builtin_secret: Option<&str>,
) -> Result<(String, String), String> {
    match (
        normalize_non_empty(runtime_id),
        normalize_non_empty(runtime_secret),
    ) {
        (Some(id), Some(secret)) => Ok((id, secret)),
        (Some(_), None) => Err(format!(
            "Google OAuth 配置不完整：已设置 {OAUTH_CLIENT_ID_ENV}，请同时设置 {OAUTH_CLIENT_SECRET_ENV} 后重新启动 Agy Shift"
        )),
        (None, Some(_)) => Err(format!(
            "Google OAuth 配置不完整：已设置 {OAUTH_CLIENT_SECRET_ENV}，请同时设置 {OAUTH_CLIENT_ID_ENV} 后重新启动 Agy Shift"
        )),
        (None, None) => match (
            normalize_non_empty(builtin_id),
            normalize_non_empty(builtin_secret),
        ) {
            (Some(id), Some(secret)) => Ok((id, secret)),
            (None, _) => Err(format!(
                "Google OAuth 未配置：当前构建未内置 OAuth 客户端，请在打包时注入或启动前设置 {OAUTH_CLIENT_ID_ENV} 与 {OAUTH_CLIENT_SECRET_ENV}"
            )),
            (Some(_), None) => Err(format!(
                "Google OAuth 配置不完整：当前构建缺少内置 {OAUTH_CLIENT_SECRET_ENV}"
            )),
        },
    }
}

pub(super) fn oauth_client_config() -> Result<OAuthClientConfig, String> {
    let runtime_id = std::env::var(OAUTH_CLIENT_ID_ENV).ok();
    let runtime_secret = std::env::var(OAUTH_CLIENT_SECRET_ENV).ok();
    let (id, secret) = resolve_oauth_client_credentials(
        runtime_id.as_deref(),
        runtime_secret.as_deref(),
        BUILTIN_OAUTH_CLIENT_ID,
        BUILTIN_OAUTH_CLIENT_SECRET,
    )?;
    Ok(OAuthClientConfig::new(id, secret))
}

/// 当前进程是否具备可用的 OAuth 客户端配置（运行时环境变量或编译期注入）。
pub fn has_oauth_client_config() -> bool {
    oauth_client_config().is_ok()
}

/// 从 Google OIDC `id_token`（JWT）的 payload 中解码邮箱与显示名，无需网络或 OAuth Client 配置。
pub fn extract_identity_from_id_token(id_token: &str) -> Option<(String, Option<String>)> {
    use base64::{engine::general_purpose, Engine as _};

    let payload_b64 = id_token.trim().split('.').nth(1)?;
    let decoded = general_purpose::URL_SAFE_NO_PAD
        .decode(payload_b64)
        .or_else(|_| general_purpose::URL_SAFE.decode(payload_b64))
        .ok()?;
    let payload: serde_json::Value = serde_json::from_slice(&decoded).ok()?;
    let email = payload
        .get("email")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty() && value.contains('@'))?
        .to_string();
    let name = payload
        .get("name")
        .and_then(|value| value.as_str())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .or_else(|| {
            let given = payload
                .get("given_name")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            let family = payload
                .get("family_name")
                .and_then(|value| value.as_str())
                .map(str::trim)
                .filter(|value| !value.is_empty());
            match (given, family) {
                (Some(g), Some(f)) => Some(format!("{g} {f}")),
                (Some(g), None) => Some(g.to_owned()),
                (None, Some(f)) => Some(f.to_owned()),
                (None, None) => None,
            }
        });
    Some((email, name))
}

/// 生成 OAuth 授权 URL
pub(super) fn get_auth_url(
    client: &OAuthClientConfig,
    redirect_uri: &str,
    state: &str,
    code_verifier: &str,
) -> String {
    build_auth_url(&client.id, redirect_uri, state, code_verifier)
}

fn build_auth_url(client_id: &str, redirect_uri: &str, state: &str, code_verifier: &str) -> String {
    use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
    use sha2::{Digest, Sha256};

    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(code_verifier.as_bytes()));
    let scopes = vec![
        "openid",
        "https://www.googleapis.com/auth/cloud-platform",
        "https://www.googleapis.com/auth/userinfo.email",
        "https://www.googleapis.com/auth/userinfo.profile",
        "https://www.googleapis.com/auth/cclog",
        "https://www.googleapis.com/auth/experimentsandconfigs",
        // Required by Antigravity voice transcription (Cockpit #2361).
        "https://www.googleapis.com/auth/aicode",
    ]
    .join(" ");

    let params = [
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("scope", &scopes),
        ("access_type", "offline"),
        ("prompt", "consent"),
        ("include_granted_scopes", "true"),
        ("state", state),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
    ];

    let url = url::Url::parse_with_params(AUTH_URL, &params).expect("无效的 Auth URL");
    url.to_string()
}

/// 使用 Authorization Code 交换 Token
pub(super) async fn exchange_code(
    code: &str,
    redirect_uri: &str,
    code_verifier: &str,
    oauth: &OAuthClientConfig,
) -> Result<TokenResponse, String> {
    crate::modules::logger::log_info(&format!("开始 Token 交换, redirect_uri: {}", redirect_uri));
    let client = crate::utils::http::create_client(15);

    let params = [
        ("client_id", oauth.id.as_str()),
        ("client_secret", oauth.secret.as_str()),
        ("code", code),
        ("code_verifier", code_verifier),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code"),
    ];

    let response = client
        .post(TOKEN_URL)
        .header(reqwest::header::USER_AGENT, NATIVE_OAUTH_USER_AGENT)
        .form(&params)
        .send()
        .await
        .map_err(|e| {
            let msg = format!("Token 交换请求失败: {}", e);
            crate::modules::logger::log_error(&msg);
            msg
        })?;

    let status = response.status();
    crate::modules::logger::log_info(&format!("Token 交换响应状态: {}", status));

    if status.is_success() {
        let mut token_res = response.json::<TokenResponse>().await.map_err(|e| {
            let msg = format!("Token 解析失败: {}", e);
            crate::modules::logger::log_error(&msg);
            msg
        })?;
        token_res.oauth_client_key = Some(oauth.key.clone());

        if token_res.refresh_token.is_some() {
            crate::modules::logger::log_info("Token 交换成功, 获取到 refresh_token");
        } else {
            crate::modules::logger::log_warn(
                "警告: Google 未返回 refresh_token, 可能之前已授权过此应用",
            );
        }

        Ok(token_res)
    } else {
        let error_text = response.text().await.unwrap_or_default();
        let msg = format!("Token 交换失败 ({})，body_len={}", status, error_text.len());
        crate::modules::logger::log_error(&msg);
        Err(msg)
    }
}

/// 使用 refresh_token 刷新 access_token
pub async fn refresh_access_token(refresh_token: &str) -> Result<TokenResponse, String> {
    let client = oauth_client_config()?;
    let http = crate::utils::http::create_client(15);
    Ok(refresh_access_token_for_clients(
        &http,
        TOKEN_URL,
        refresh_token,
        None,
        std::iter::once(client).chain(compiled_oauth_client_config()),
    )
    .await?)
}

pub(super) async fn refresh_existing_access_token(
    refresh_token: &str,
    preferred_key: Option<&str>,
) -> Result<TokenResponse, RefreshError> {
    let configured = oauth_client_config().ok();
    // 旧令牌先用发行时注入的客户端，运行时可以为相同 ID 提供更新后的配置。
    let compiled = compiled_oauth_client_config().filter(|client| {
        configured
            .as_ref()
            .is_none_or(|runtime| runtime.id != client.id)
    });
    let http = crate::utils::http::create_client(15);
    refresh_access_token_for_clients(
        &http,
        TOKEN_URL,
        refresh_token,
        preferred_key,
        compiled.into_iter().chain(configured),
    )
    .await
}

async fn refresh_access_token_for_clients(
    http: &reqwest::Client,
    endpoint: &str,
    refresh_token: &str,
    preferred_key: Option<&str>,
    clients: impl IntoIterator<Item = OAuthClientConfig>,
) -> Result<TokenResponse, RefreshError> {
    let preferred_key = bound_client_key(preferred_key);
    let mut attempted = Vec::new();
    for client in clients {
        if preferred_key.is_some_and(|key| key != client.key) || attempted.contains(&client.key) {
            continue;
        }
        match refresh_access_token_at(http, endpoint, refresh_token, &client).await {
            Err(RefreshError::InvalidGrant) if preferred_key.is_none() => {
                attempted.push(client.key);
            }
            result => return result,
        }
    }
    if attempted.is_empty() {
        Err(RefreshError::Other(
            "缺少此账号对应的 Google OAuth 客户端配置".to_string(),
        ))
    } else {
        Err(RefreshError::UnverifiedGrant)
    }
}

fn bound_client_key(key: Option<&str>) -> Option<&str> {
    key.map(str::trim)
        .filter(|key| !key.is_empty() && !key.eq_ignore_ascii_case(DEFAULT_OAUTH_CLIENT_KEY))
}

pub(super) fn has_unbound_client(token: &crate::models::TokenData) -> bool {
    bound_client_key(token.oauth_client_key.as_deref()).is_none()
}

async fn refresh_access_token_at(
    client: &reqwest::Client,
    token_url: &str,
    refresh_token: &str,
    oauth: &OAuthClientConfig,
) -> Result<TokenResponse, RefreshError> {
    if refresh_token.trim().is_empty() {
        return Err(RefreshError::Other("缺少 OAuth 刷新令牌".to_string()));
    }
    let params = [
        ("client_id", oauth.id.as_str()),
        ("client_secret", oauth.secret.as_str()),
        ("refresh_token", refresh_token),
        ("grant_type", "refresh_token"),
    ];

    for attempt in 0..2 {
        let response = client
            .post(token_url)
            .header(reqwest::header::USER_AGENT, NATIVE_OAUTH_USER_AGENT)
            .form(&params)
            .send()
            .await
            .map_err(|e| RefreshError::Other(format!("刷新请求失败: {}", e)))?;

        let status = response.status();
        if status.is_success() {
            let mut token_data = response
                .json::<TokenResponse>()
                .await
                .map_err(|e| RefreshError::Other(format!("刷新数据解析失败: {}", e)))?;
            token_data.oauth_client_key = Some(oauth.key.clone());
            return Ok(token_data);
        }

        let error = response
            .json::<serde_json::Value>()
            .await
            .unwrap_or_default();
        let code = error.get("error").and_then(|value| value.as_str());
        if status == reqwest::StatusCode::BAD_REQUEST && code == Some("invalid_grant") {
            if attempt == 1 {
                return Err(RefreshError::InvalidGrant);
            }
            crate::modules::logger::log_warn("OAuth invalid_grant，短暂退避后再次确认");
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            continue;
        }
        return Err(RefreshError::Other(match code {
            Some("invalid_client") => format!("刷新失败 ({status}): invalid_client"),
            _ => format!("刷新失败 ({status})"),
        }));
    }
    unreachable!("OAuth refresh attempts are bounded")
}

/// 获取用户信息
pub async fn get_user_info(access_token: &str) -> Result<UserInfo, String> {
    let client = crate::utils::http::create_client(15);

    let response = client
        .get(USERINFO_URL)
        .bearer_auth(access_token)
        .send()
        .await
        .map_err(|e| format!("用户信息请求失败: {}", e))?;

    if response.status().is_success() {
        response
            .json::<UserInfo>()
            .await
            .map_err(|e| format!("用户信息解析失败: {}", e))
    } else {
        Err(format!("获取用户信息失败 ({})", response.status()))
    }
}

/// 检查并在需要时刷新 Token
pub(crate) async fn ensure_fresh_token(
    current_token: &crate::models::TokenData,
) -> Result<crate::models::TokenData, RefreshError> {
    let now = chrono::Local::now().timestamp();

    if !current_token.access_token.trim().is_empty()
        && !token_needs_refresh(current_token.expiry_timestamp, now)
    {
        return Ok(current_token.clone());
    }

    crate::modules::logger::log_info("Token 即将过期，正在刷新...");
    let result = refresh_existing_access_token(
        &current_token.refresh_token,
        current_token.oauth_client_key.as_deref(),
    )
    .await;
    match result {
        Ok(response) => Ok(build_refreshed_token(current_token, response)),
        Err(_) if usable_access_token(current_token) => Ok(current_token.clone()),
        Err(error) => Err(error),
    }
}

pub(super) fn usable_access_token(token: &crate::models::TokenData) -> bool {
    !token.access_token.trim().is_empty() && token.expiry_timestamp > chrono::Utc::now().timestamp()
}

fn build_refreshed_token(
    current_token: &crate::models::TokenData,
    response: TokenResponse,
) -> crate::models::TokenData {
    let mut token = crate::models::TokenData::new(
        response.access_token,
        response
            .refresh_token
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| current_token.refresh_token.clone()),
        response.expires_in,
        current_token.email.clone(),
        current_token.project_id.clone(),
        current_token.session_id.clone(),
    )
    .with_oauth_metadata(
        response.oauth_client_key,
        response.id_token.or_else(|| current_token.id_token.clone()),
    );
    token.is_gcp_tos = current_token.is_gcp_tos;
    token
}

fn token_needs_refresh(expiry_timestamp: i64, now: i64) -> bool {
    expiry_timestamp <= now + TOKEN_REFRESH_SKEW_SECONDS
}

#[cfg(test)]
#[path = "oauth_tests.rs"]
mod tests;
