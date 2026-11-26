//! 本机 Antigravity 账号自动导入监听。
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{LazyLock, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

use crate::modules::{antigravity_credential, config, import, logger};

const POLL_INTERVAL_SECONDS: u64 = 30;
const STARTUP_DELAY_SECONDS: u64 = 10;
const IDENTITY_SCAN_TIMEOUT: Duration = Duration::from_secs(15);

static WATCHER_STARTED: AtomicBool = AtomicBool::new(false);
static CONFIG_CHANGED: LazyLock<Notify> = LazyLock::new(Notify::new);
static LAST_IDENTITY: LazyLock<Mutex<Option<String>>> = LazyLock::new(|| Mutex::new(None));
static WATCH_CYCLE_LOCK: LazyLock<tokio::sync::Mutex<()>> =
    LazyLock::new(|| tokio::sync::Mutex::new(()));
static IDENTITY_SCAN_IN_FLIGHT: AtomicBool = AtomicBool::new(false);

struct IdentityScanInFlightGuard;
impl Drop for IdentityScanInFlightGuard {
    fn drop(&mut self) {
        IDENTITY_SCAN_IN_FLIGHT.store(false, Ordering::SeqCst);
    }
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AutoLocalImportScanResult {
    pub scanned: u32,
    pub imported: u32,
    pub failed: u32,
    pub platforms: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WatchMode {
    PollOnChange,
    FullScanImport,
}

pub fn ensure_started(app_handle: AppHandle) {
    if WATCHER_STARTED.swap(true, Ordering::SeqCst) {
        return;
    }
    logger::log_info("[AutoLocalImport] Antigravity 本机账号自动导入监听已启动");
    tauri::async_runtime::spawn(async move {
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(STARTUP_DELAY_SECONDS)) => {}
            _ = CONFIG_CHANGED.notified() => {}
        }
        loop {
            if config::get_user_config().auto_import_from_local_enabled {
                let _ = run_watch_cycle_with_mode(&app_handle, WatchMode::PollOnChange).await;
            }
            tokio::select! {
                _ = tokio::time::sleep(Duration::from_secs(POLL_INTERVAL_SECONDS)) => {}
                _ = CONFIG_CHANGED.notified() => {}
            }
        }
    });
}

pub fn notify_config_changed(enabled: bool) {
    logger::log_info(&format!(
        "[AutoLocalImport] 本机账号自动导入已{}",
        if enabled { "启用" } else { "停用" }
    ));
    CONFIG_CHANGED.notify_one();
}

pub async fn scan_now(app_handle: AppHandle) -> Result<AutoLocalImportScanResult, String> {
    Ok(run_watch_cycle_with_mode(&app_handle, WatchMode::FullScanImport).await)
}

fn peek_antigravity_identity() -> Option<String> {
    let credential = antigravity_credential::read_antigravity_system_credential()
        .ok()
        .flatten()?;
    let prefix: String = credential.refresh_token.trim().chars().take(24).collect();
    (!prefix.is_empty()).then_some(prefix)
}

async fn run_watch_cycle_with_mode(
    app_handle: &AppHandle,
    mode: WatchMode,
) -> AutoLocalImportScanResult {
    let _cycle_guard = match mode {
        WatchMode::FullScanImport => WATCH_CYCLE_LOCK.lock().await,
        WatchMode::PollOnChange => match WATCH_CYCLE_LOCK.try_lock() {
            Ok(guard) => guard,
            Err(_) => return AutoLocalImportScanResult::default(),
        },
    };
    if IDENTITY_SCAN_IN_FLIGHT.swap(true, Ordering::SeqCst) {
        return AutoLocalImportScanResult::default();
    }
    let task = tauri::async_runtime::spawn_blocking(move || {
        let _guard = IdentityScanInFlightGuard;
        let current = peek_antigravity_identity();
        let Some(identity) = current else {
            if let Ok(mut state) = LAST_IDENTITY.lock() {
                *state = None;
            }
            return (0u32, None::<String>);
        };
        let should_import = match mode {
            WatchMode::FullScanImport => true,
            WatchMode::PollOnChange => {
                if let Ok(mut state) = LAST_IDENTITY.lock() {
                    match state.as_deref() {
                        None => {
                            *state = Some(identity.clone());
                            false
                        }
                        Some(prev) if prev == identity => false,
                        Some(_) => true,
                    }
                } else {
                    false
                }
            }
        };
        (1u32, should_import.then_some(identity))
    });

    let (scanned, pending_identity) = match tokio::time::timeout(IDENTITY_SCAN_TIMEOUT, task).await
    {
        Ok(Ok(res)) => res,
        _ => return AutoLocalImportScanResult::default(),
    };

    let Some(identity) = pending_identity else {
        return AutoLocalImportScanResult {
            scanned,
            ..Default::default()
        };
    };

    match import::import_from_local_logic().await {
        Ok(_) => {
            if let Ok(mut state) = LAST_IDENTITY.lock() {
                *state = Some(identity);
            }
            let _ = app_handle.emit(
                "accounts:changed",
                serde_json::json!({
                    "platformId": "antigravity",
                    "reason": "auto_import_from_local",
                }),
            );
            let _ = crate::modules::tray::update_tray_menu(app_handle);
            AutoLocalImportScanResult {
                scanned,
                imported: 1,
                failed: 0,
                platforms: vec!["antigravity".to_string()],
            }
        }
        Err(err) => {
            logger::log_warn(&format!("[AutoLocalImport] 自动导入失败: {}", err));
            AutoLocalImportScanResult {
                scanned,
                imported: 0,
                failed: 1,
                platforms: Vec::new(),
            }
        }
    }
}
