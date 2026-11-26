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

fn normalize_oauth_client_key(value: &str) -> String {
    value.trim().to_ascii_lowercase()
}

fn resolve_oauth_client_key(preferred: Option<&str>) -> Result<String, String> {
    match preferred.map(normalize_oauth_client_key) {
        Some(key) if key == DEFAULT_OAUTH_CLIENT_KEY => Ok(key),
        Some(key) if key.is_empty() => Ok(DEFAULT_OAUTH_CLIENT_KEY.to_string()),
        Some(key) => Err(format!(
            "未知 OAuth client: {}，当前版本仅支持 {}",
            key, DEFAULT_OAUTH_CLIENT_KEY
        )),
        None => Ok(DEFAULT_OAUTH_CLIENT_KEY.to_string()),
    }
}

const OAUTH_CLIENT_ID_ENV: &str = "AGY_SHIFT_GOOGLE_OAUTH_CLIENT_ID";
const OAUTH_CLIENT_SECRET_ENV: &str = "AGY_SHIFT_GOOGLE_OAUTH_CLIENT_SECRET";
const BUILTIN_OAUTH_CLIENT_ID: Option<&str> = option_env!("AGY_SHIFT_GOOGLE_OAUTH_CLIENT_ID");
const BUILTIN_OAUTH_CLIENT_SECRET: Option<&str> =
    option_env!("AGY_SHIFT_GOOGLE_OAUTH_CLIENT_SECRET");

struct OAuthClientConfig {
    id: String,
    secret: String,
    key: String,
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

fn oauth_client_config(preferred: Option<&str>) -> Result<OAuthClientConfig, String> {
    let key = resolve_oauth_client_key(preferred)?;
    let runtime_id = std::env::var(OAUTH_CLIENT_ID_ENV).ok();
    let runtime_secret = std::env::var(OAUTH_CLIENT_SECRET_ENV).ok();
    let (id, secret) = resolve_oauth_client_credentials(
        runtime_id.as_deref(),
        runtime_secret.as_deref(),
        BUILTIN_OAUTH_CLIENT_ID,
        BUILTIN_OAUTH_CLIENT_SECRET,
    )?;
    Ok(OAuthClientConfig { id, secret, key })
}

/// 生成 OAuth 授权 URL
pub fn get_auth_url(redirect_uri: &str, state: Option<&str>) -> Result<String, String> {
    let oauth = oauth_client_config(None)?;
    Ok(build_auth_url(&oauth.id, redirect_uri, state))
}

fn build_auth_url(client_id: &str, redirect_uri: &str, state: Option<&str>) -> String {
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

    let mut params = vec![
        ("client_id", client_id),
        ("redirect_uri", redirect_uri),
        ("response_type", "code"),
        ("scope", &scopes),
        ("access_type", "offline"),
        ("prompt", "consent"),
        ("include_granted_scopes", "true"),
    ];

    if let Some(state) = state.filter(|value| !value.trim().is_empty()) {
        params.push(("state", state));
    }

    let url = url::Url::parse_with_params(AUTH_URL, &params).expect("无效的 Auth URL");
    url.to_string()
}

/// 使用 Authorization Code 交换 Token
pub async fn exchange_code(code: &str, redirect_uri: &str) -> Result<TokenResponse, String> {
    let oauth = oauth_client_config(None)?;
    crate::modules::logger::log_info(&format!("开始 Token 交换, redirect_uri: {}", redirect_uri));
    let client = crate::utils::http::create_client(15);

    let params = [
        ("client_id", oauth.id.as_str()),
        ("client_secret", oauth.secret.as_str()),
        ("code", code),
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
        token_res.oauth_client_key = Some(oauth.key);

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
    refresh_access_token_with_client(refresh_token, None).await
}

/// 使用指定 OAuth client 刷新 access_token。
pub async fn refresh_access_token_with_client(
    refresh_token: &str,
    oauth_client_key: Option<&str>,
) -> Result<TokenResponse, String> {
    let oauth = oauth_client_config(oauth_client_key)?;
    let client = crate::utils::http::create_client(15);
    refresh_access_token_at(&client, TOKEN_URL, refresh_token, oauth).await
}

async fn refresh_access_token_at(
    client: &reqwest::Client,
    token_url: &str,
    refresh_token: &str,
    oauth: OAuthClientConfig,
) -> Result<TokenResponse, String> {
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
            .map_err(|e| format!("刷新请求失败: {}", e))?;

        if response.status().is_success() {
            let mut token_data = response
                .json::<TokenResponse>()
                .await
                .map_err(|e| format!("刷新数据解析失败: {}", e))?;
            token_data.oauth_client_key = Some(oauth.key);
            return Ok(token_data);
        }

        let error_text = response.text().await.unwrap_or_default();
        let invalid_grant = serde_json::from_str::<serde_json::Value>(&error_text)
            .ok()
            .and_then(|value| {
                value
                    .get("error")
                    .and_then(|e| e.as_str())
                    .map(str::to_owned)
            })
            .as_deref()
            == Some("invalid_grant");
        if attempt == 0 && invalid_grant {
            crate::modules::logger::log_warn("OAuth invalid_grant，短暂退避后再次确认");
            tokio::time::sleep(std::time::Duration::from_millis(500)).await;
            continue;
        }
        return Err(format!("刷新失败: {}", error_text));
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
        let error_text = response.text().await.unwrap_or_default();
        Err(format!("获取用户信息失败: {}", error_text))
    }
}

/// 检查并在需要时刷新 Token
pub async fn ensure_fresh_token(
    current_token: &crate::models::TokenData,
) -> Result<crate::models::TokenData, String> {
    let now = chrono::Local::now().timestamp();

    if !token_needs_refresh(current_token.expiry_timestamp, now) {
        return Ok(current_token.clone());
    }

    crate::modules::logger::log_info("Token 即将过期，正在刷新...");
    let response = refresh_access_token_with_client(
        &current_token.refresh_token,
        current_token.oauth_client_key.as_deref(),
    )
    .await?;

    Ok(build_refreshed_token(current_token, response))
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
