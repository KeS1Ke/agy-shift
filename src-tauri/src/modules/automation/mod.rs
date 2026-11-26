use super::automation_protocol::{
    AccountPlatform as Platform, Operation, Outcome, Reply, Request, VERSION,
};
use super::logger;
use crate::commands;
use serde_json::{json, Value};
use std::sync::LazyLock;
use tauri::AppHandle;
use tokio::sync::Mutex;

mod accounts;
mod quotas;

static SWITCH_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));

#[derive(Debug)]
struct Failure {
    code: String,
    message: String,
}

impl Failure {
    fn new(code: &str, message: &str) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }

    fn host(error: String) -> Self {
        let prefix = error.split(':').next().unwrap_or_default();
        match prefix {
            "account_not_found" => Self::new("account_not_found", "未找到指定账号"),
            "APP_PATH_NOT_FOUND" => Self::new(prefix, "未找到 Antigravity 客户端路径"),
            "APP_PATH_MISSING_AFTER_SWITCH" => {
                Self::new(prefix, "账号已切换，但未找到客户端启动路径")
            }
            _ => {
                let code = if !prefix.is_empty()
                    && prefix.len() <= 100
                    && prefix.contains('_')
                    && prefix
                        .bytes()
                        .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
                {
                    prefix
                } else {
                    "operation_failed"
                };
                logger::log_warn(&format!("[Automation] {code}"));
                Self::new(code, "自动化操作执行失败")
            }
        }
    }

    fn outcome(self) -> Outcome {
        Outcome::Error {
            code: self.code,
            message: self.message,
        }
    }
}

async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, Failure> {
    tokio::task::spawn_blocking(work)
        .await
        .map_err(|error| Failure::host(error.to_string()))?
        .map_err(Failure::host)
}

fn check_id(id: &str) -> Result<(), Failure> {
    if id.is_empty()
        || id.trim() != id
        || id == "."
        || id == ".."
        || id.contains(['/', '\\', ':'])
        || id.chars().any(char::is_control)
    {
        return Err(Failure::new("invalid_account_id", "账号 ID 无效"));
    }
    Ok(())
}

pub(super) async fn handle(request: Request, authorized: bool) -> Reply {
    let outcome = if !authorized {
        Failure::new("unauthorized", "WebSocket 鉴权失败").outcome()
    } else if request.version != VERSION {
        Failure::new("version_mismatch", "自动化协议版本不匹配").outcome()
    } else {
        match Box::pin(execute(request.command)).await {
            Ok(data) => Outcome::Ok { data },
            Err(error) => error.outcome(),
        }
    };
    Reply {
        version: VERSION,
        request_id: request.request_id,
        outcome,
    }
}

async fn execute(command: Operation) -> Result<Value, Failure> {
    match command {
        Operation::Platforms => Ok(json!(Platform::ALL
            .iter()
            .map(|p| p.as_str())
            .collect::<Vec<_>>())),
        Operation::List { platform } => Ok(json!(accounts::list(platform).await?)),
        Operation::Quota {
            platform,
            account_id,
            refresh,
        } => {
            check_id(&account_id)?;
            if refresh {
                accounts::lookup(platform, account_id.clone(), |_| ()).await?;
                Box::pin(quotas::refresh(platform, account_id.clone())).await?;
            }
            let snapshot = accounts::lookup(platform, account_id.clone(), quotas::snapshot).await?;
            if refresh && snapshot.refresh_failed() {
                return Err(Failure::new("quota_refresh_failed", "配额刷新失败"));
            }
            Ok(json!({ "platform": platform, "accountId": account_id, "quota": snapshot }))
        }
        Operation::Switch {
            platform,
            account_id,
        } => {
            check_id(&account_id)?;
            let _guard = SWITCH_LOCK
                .try_lock()
                .map_err(|_| Failure::new("switch_busy", "切号任务进行中，请稍后重试"))?;
            accounts::lookup(platform, account_id.clone(), |_| ()).await?;
            let effect = Box::pin(switch(app()?, platform, account_id.clone())).await?;
            Ok(json!({
                "platform": platform,
                "accountId": account_id,
                "effect": effect.kind,
                "warnings": effect.warnings
            }))
        }
    }
}

fn app() -> Result<AppHandle, Failure> {
    crate::get_app_handle()
        .cloned()
        .ok_or_else(|| Failure::new("host_unavailable", "宿主窗口尚未就绪"))
}

struct SwitchEffect {
    kind: &'static str,
    warnings: Vec<&'static str>,
}

async fn switch(app: AppHandle, platform: Platform, id: String) -> Result<SwitchEffect, Failure> {
    let result = match platform {
        Platform::Antigravity => Box::pin(commands::account::switch_account(
            app,
            id,
            Some("antigravity".into()),
            Some(false),
            Some(true),
        ))
        .await
        .map(|_| ()),
        Platform::AntigravityIde => Box::pin(commands::account::switch_account(
            app,
            id,
            Some("antigravity_ide".into()),
            None,
            Some(true),
        ))
        .await
        .map(|_| ()),
    };
    result.map_err(Failure::host)?;
    Ok(SwitchEffect {
        kind: "client_credentials_applied",
        warnings: Vec::new(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn automation_requires_authentication_and_exact_protocol_version() {
        let request = |version| Request {
            version,
            request_id: "fixture".into(),
            auth_token: String::new(),
            command: Operation::Platforms,
        };
        assert!(matches!(
            handle(request(VERSION), false).await.outcome,
            Outcome::Error { code, .. } if code == "unauthorized"
        ));
        assert!(matches!(
            handle(request(VERSION + 1), true).await.outcome,
            Outcome::Error { code, .. } if code == "version_mismatch"
        ));
        assert!(matches!(
            handle(request(VERSION), true).await.outcome,
            Outcome::Ok { data } if data.as_array().is_some_and(|ids| ids.len() == 2)
        ));
    }
}
