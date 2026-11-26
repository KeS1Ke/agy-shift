//! 系统、通用配置、网络代理、Antigravity 版本探测与数据目录接管命令（Windows-only）。
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value as JsonValue};
use tauri::Manager;
use tauri_plugin_autostart::ManagerExt as _;

use crate::modules;
use crate::modules::config::{self, CloseWindowBehavior, UserConfig, DEFAULT_WS_PORT};
use crate::modules::websocket;

const CREATE_NO_WINDOW: u32 = 0x0800_0000;
const MAX_STARTUP_WAKEUP_DELAY_SECONDS: i32 = 24 * 60 * 60;
const ANTIGRAVITY_VERSION_BADGE_TIMEOUT_MS: u64 = 1200;
const ANTIGRAVITY_VERSION_FULL_SCAN_TIMEOUT_MS: u64 = 30_000;
const AUTO_SWITCH_ACCOUNT_SCOPE_ALL: &str = "all_accounts";
const AUTO_SWITCH_ACCOUNT_SCOPE_SELECTED: &str = "selected_accounts";

static GENERAL_CONFIG_SAVE_LOCK: OnceLock<Mutex<()>> = OnceLock::new();
static ANTIGRAVITY_VERSION_INFO_CACHE: OnceLock<
    Mutex<HashMap<String, AntigravityInstalledVersionInfo>>,
> = OnceLock::new();

fn lock_general_config_transaction() -> Result<std::sync::MutexGuard<'static, ()>, String> {
    GENERAL_CONFIG_SAVE_LOCK
        .get_or_init(|| Mutex::new(()))
        .lock()
        .map_err(|_| "通用配置保存锁已损坏".to_string())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct NetworkConfig {
    pub ws_enabled: bool,
    pub ws_port: u16,
    pub actual_port: Option<u16>,
    pub default_port: u16,
    pub global_proxy_enabled: bool,
    pub global_proxy_url: String,
    pub global_proxy_no_proxy: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NetworkConfigSaveResult {
    pub needs_restart: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeneralConfig {
    pub default_terminal: String,
    pub theme: String,
    pub reduced_motion_enabled: bool,
    pub ui_scale: f64,
    pub auto_refresh_minutes: i32,
    pub close_behavior: String,
    pub show_tray_icon: bool,
    pub startup_minimized: bool,
    pub remember_main_window_state: bool,
    pub app_auto_launch_enabled: bool,
    pub auto_import_from_local_enabled: bool,
    pub antigravity_startup_wakeup_enabled: bool,
    pub antigravity_startup_wakeup_delay_seconds: i32,
    pub antigravity_app_path: String,
    pub antigravity_legacy_app_path: String,
    pub antigravity_cli_path: String,
    pub antigravity_launch_on_switch: bool,
    pub antigravity_dual_switch_no_restart_enabled: bool,
    pub auto_switch_enabled: bool,
    pub auto_switch_threshold: i32,
    pub auto_switch_credits_enabled: bool,
    pub auto_switch_credits_threshold: i32,
    pub auto_switch_window_thresholds_enabled: bool,
    pub auto_switch_five_hour_threshold: i32,
    pub auto_switch_weekly_threshold: i32,
    pub auto_switch_scope_mode: String,
    pub auto_switch_selected_group_ids: Vec<String>,
    pub auto_switch_account_scope_mode: String,
    pub auto_switch_selected_account_ids: Vec<String>,
    pub quota_alert_enabled: bool,
    pub quota_alert_threshold: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AntigravityInstalledVersionInfo {
    pub product_name: String,
    pub version: String,
    pub app_path: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirectorySettings {
    pub active_dir: String,
    pub default_dir: String,
    pub configured_dir: Option<String>,
    pub cockpit_tools_dir: String,
    pub cockpit_tools_exists: bool,
    pub is_using_cockpit_tools: bool,
    pub is_dev_profile: bool,
    pub env_override: Option<String>,
    pub needs_restart: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CockpitTakeoverResult {
    pub target_dir: String,
    pub backup_dir: String,
    pub backed_up_files: usize,
    pub needs_restart: bool,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum AntigravityVersionScanMode {
    Quick,
    Full,
}

// ============================================================================
// Antigravity 安装版本探测（供切号认证模式判定 & UI 徽章使用）
// ============================================================================

fn trim_non_empty(value: &str) -> Option<String> {
    let trimmed = value.trim();
    (!trimmed.is_empty()).then(|| trimmed.to_string())
}

fn json_string_field(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| {
        value
            .get(*key)
            .and_then(serde_json::Value::as_str)
            .and_then(trim_non_empty)
    })
}

fn antigravity_product_json_candidates(root: &Path) -> Vec<PathBuf> {
    vec![
        root.join("resources").join("app").join("product.json"),
        root.join("app").join("product.json"),
    ]
}

fn read_antigravity_product_json_metadata(root: &Path) -> Option<AntigravityInstalledVersionInfo> {
    for path in antigravity_product_json_candidates(root) {
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(value) = serde_json::from_str::<serde_json::Value>(&content) else {
            continue;
        };
        let Some(version) = json_string_field(&value, &["ideVersion", "version"]) else {
            continue;
        };
        let product_name = json_string_field(
            &value,
            &["nameShort", "nameLong", "productName", "applicationName"],
        )
        .unwrap_or_else(|| "Antigravity".to_string());
        return Some(AntigravityInstalledVersionInfo {
            product_name,
            version,
            app_path: root.to_string_lossy().to_string(),
            source: "product.json".to_string(),
        });
    }
    None
}

fn find_antigravity_windows_exe(root: &Path) -> Option<PathBuf> {
    if root.is_file() {
        return Some(root.to_path_buf());
    }
    let candidates = [
        root.join("Antigravity.exe"),
        root.join("Antigravity IDE.exe"),
        root.join("antigravity.exe"),
        root.join("antigravity-ide.exe"),
        root.join("Electron.exe"),
    ];
    candidates.into_iter().find(|path| path.exists())
}

fn read_powershell_json_for_antigravity_exe(
    exe_path: &Path,
    script: &str,
) -> Option<serde_json::Value> {
    use std::os::windows::process::CommandExt;

    let mut command = std::process::Command::new("powershell");
    command
        .creation_flags(CREATE_NO_WINDOW)
        .args([
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .env("AGY_SHIFT_EXE_PATH", exe_path.as_os_str());
    let output =
        modules::process_timeout::output_with_timeout(&mut command, Duration::from_secs(5)).ok()?;
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice::<serde_json::Value>(&output.stdout).ok()
}

fn build_antigravity_windows_version_info(
    value: serde_json::Value,
    exe_path: &Path,
    source: &str,
) -> Option<AntigravityInstalledVersionInfo> {
    let version = json_string_field(&value, &["ProductVersion", "FileVersion", "DisplayVersion"])?;
    let product_name = json_string_field(&value, &["ProductName", "DisplayName"])
        .unwrap_or_else(|| "Antigravity".to_string());
    Some(AntigravityInstalledVersionInfo {
        product_name,
        version,
        app_path: exe_path.to_string_lossy().to_string(),
        source: source.to_string(),
    })
}

fn read_antigravity_windows_exe_metadata(root: &Path) -> Option<AntigravityInstalledVersionInfo> {
    let exe_path = find_antigravity_windows_exe(root)?;
    let script = r#"
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
$OutputEncoding = [System.Text.Encoding]::UTF8
$p = [Environment]::GetEnvironmentVariable('AGY_SHIFT_EXE_PATH', 'Process')
if ([string]::IsNullOrWhiteSpace($p) -or -not (Test-Path -LiteralPath $p -PathType Leaf)) { exit 2 }
$v = (Get-Item -LiteralPath $p).VersionInfo
if ([string]::IsNullOrWhiteSpace($v.ProductVersion) -and [string]::IsNullOrWhiteSpace($v.FileVersion)) { exit 4 }
[pscustomobject]@{
  ProductName = $v.ProductName
  ProductVersion = $v.ProductVersion
  FileVersion = $v.FileVersion
} | ConvertTo-Json -Compress
"#;
    read_powershell_json_for_antigravity_exe(&exe_path, script)
        .and_then(|value| build_antigravity_windows_version_info(value, &exe_path, "VersionInfo"))
}

fn normalize_antigravity_metadata_target(target: Option<&str>) -> Option<&'static str> {
    match target.unwrap_or("").trim().to_ascii_lowercase().as_str() {
        "antigravity" => Some("antigravity"),
        "antigravity_ide" | "antigravity-ide" | "ide" => Some("antigravity_ide"),
        _ => None,
    }
}

fn push_unique_antigravity_candidate(candidates: &mut Vec<PathBuf>, path: PathBuf) {
    let key = path.to_string_lossy().to_ascii_lowercase();
    if !candidates
        .iter()
        .any(|item| item.to_string_lossy().to_ascii_lowercase() == key)
    {
        candidates.push(path);
    }
}

fn antigravity_metadata_root_matches_target(root: &Path, target: Option<&str>) -> bool {
    let Some(target) = normalize_antigravity_metadata_target(target) else {
        return true;
    };
    let value = root.to_string_lossy().to_ascii_lowercase();
    match target {
        "antigravity" => {
            value.ends_with("antigravity")
                || value.ends_with("antigravity.exe")
                || (root.is_dir()
                    && (root.join("Antigravity.exe").exists()
                        || root.join("antigravity.exe").exists()))
        }
        "antigravity_ide" => {
            value.contains("antigravity ide")
                || value.contains("antigravity-ide")
                || (root.is_dir()
                    && (root.join("Antigravity IDE.exe").exists()
                        || root.join("antigravity-ide.exe").exists()))
        }
        _ => true,
    }
}

fn antigravity_metadata_candidates(
    target: Option<&str>,
    scan_mode: AntigravityVersionScanMode,
) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let configured = config::get_user_config();
    for (kind, path) in [
        ("antigravity", &configured.antigravity_legacy_app_path),
        ("antigravity_ide", &configured.antigravity_app_path),
    ] {
        if path.trim().is_empty()
            || normalize_antigravity_metadata_target(target).is_some_and(|t| t != kind)
        {
            continue;
        }
        if let Some(root) =
            crate::modules::process::antigravity_install_root_from_path(Path::new(path.trim()))
        {
            if antigravity_metadata_root_matches_target(&root, target) {
                push_unique_antigravity_candidate(&mut candidates, root);
            }
        }
    }

    let mut roots = Vec::new();
    for env_key in ["LOCALAPPDATA", "PROGRAMFILES", "PROGRAMFILES(X86)"] {
        if let Ok(base_str) = std::env::var(env_key) {
            let base = if env_key == "LOCALAPPDATA" {
                PathBuf::from(base_str).join("Programs")
            } else {
                PathBuf::from(base_str)
            };
            match normalize_antigravity_metadata_target(target) {
                Some("antigravity") => roots.push(base.join("Antigravity")),
                Some("antigravity_ide") => roots.push(base.join("Antigravity IDE")),
                _ => {
                    roots.push(base.join("Antigravity"));
                    roots.push(base.join("Antigravity IDE"));
                }
            }
        }
    }
    for path in roots {
        if path.exists() {
            push_unique_antigravity_candidate(&mut candidates, path);
        }
    }

    if scan_mode == AntigravityVersionScanMode::Full {
        let mut push_detected = |path: PathBuf| {
            if let Some(root) = crate::modules::process::antigravity_install_root_from_path(&path) {
                if antigravity_metadata_root_matches_target(&root, target) {
                    push_unique_antigravity_candidate(&mut candidates, root);
                }
            }
        };
        match normalize_antigravity_metadata_target(target) {
            Some("antigravity") => {
                if let Some(p) = crate::modules::process::detect_antigravity_legacy_exec_path() {
                    push_detected(p);
                }
            }
            Some("antigravity_ide") => {
                if let Some(p) = crate::modules::process::detect_antigravity_exec_path() {
                    push_detected(p);
                }
            }
            _ => {
                if let Some(p) = crate::modules::process::detect_antigravity_legacy_exec_path() {
                    push_detected(p);
                }
                if let Some(p) = crate::modules::process::detect_antigravity_exec_path() {
                    push_detected(p);
                }
            }
        }
    }
    candidates
}

fn antigravity_ide_version_uses_shared_credentials(version: &str) -> Option<bool> {
    let mut parts = version.trim().trim_start_matches(['v', 'V']).split('.');
    let major: u32 = parts.next()?.parse().ok()?;
    let minor: u32 = parts.next()?.parse().ok()?;
    Some((major, minor) >= (2, 6))
}

pub(crate) fn antigravity_ide_uses_shared_credentials() -> bool {
    antigravity_metadata_candidates(Some("antigravity_ide"), AntigravityVersionScanMode::Quick)
        .into_iter()
        .flat_map(|root| antigravity_product_json_candidates(&root))
        .filter_map(|path| fs::read_to_string(path).ok())
        .filter_map(|content| serde_json::from_str::<serde_json::Value>(&content).ok())
        .find_map(|product| {
            json_string_field(&product, &["ideVersion"])
                .and_then(|version| antigravity_ide_version_uses_shared_credentials(&version))
        })
        .unwrap_or(false)
}

fn antigravity_version_cache() -> &'static Mutex<HashMap<String, AntigravityInstalledVersionInfo>> {
    ANTIGRAVITY_VERSION_INFO_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn antigravity_version_cache_key(target: Option<&str>) -> String {
    normalize_antigravity_metadata_target(target)
        .unwrap_or("all")
        .to_string()
}

pub fn get_cached_antigravity_installed_version_info_for_target(
    target: Option<&str>,
) -> Option<AntigravityInstalledVersionInfo> {
    antigravity_version_cache()
        .lock()
        .ok()
        .and_then(|cache| cache.get(&antigravity_version_cache_key(target)).cloned())
}

fn resolve_with_mode(
    target: Option<&str>,
    scan_mode: AntigravityVersionScanMode,
) -> Option<AntigravityInstalledVersionInfo> {
    for root in antigravity_metadata_candidates(target, scan_mode) {
        if let Some(info) = read_antigravity_product_json_metadata(&root) {
            if let Ok(mut cache) = antigravity_version_cache().lock() {
                cache.insert(antigravity_version_cache_key(target), info.clone());
            }
            return Some(info);
        }
        if scan_mode == AntigravityVersionScanMode::Full {
            if let Some(info) = read_antigravity_windows_exe_metadata(&root) {
                if let Ok(mut cache) = antigravity_version_cache().lock() {
                    cache.insert(antigravity_version_cache_key(target), info.clone());
                }
                return Some(info);
            }
        }
    }
    None
}

pub fn resolve_antigravity_installed_version_info_for_target(
    target: Option<&str>,
) -> Option<AntigravityInstalledVersionInfo> {
    resolve_with_mode(target, AntigravityVersionScanMode::Full)
}

#[tauri::command]
pub async fn get_antigravity_installed_version_info(
    target: Option<String>,
    scan_mode: Option<String>,
) -> Result<Option<AntigravityInstalledVersionInfo>, String> {
    let mode = match scan_mode.as_deref().unwrap_or("").trim().to_ascii_lowercase().as_str() {
        "full" | "complete" => AntigravityVersionScanMode::Full,
        _ => AntigravityVersionScanMode::Quick,
    };
    let timeout_ms = match mode {
        AntigravityVersionScanMode::Quick => ANTIGRAVITY_VERSION_BADGE_TIMEOUT_MS,
        AntigravityVersionScanMode::Full => ANTIGRAVITY_VERSION_FULL_SCAN_TIMEOUT_MS,
    };
    let task = tauri::async_runtime::spawn_blocking(move || resolve_with_mode(target.as_deref(), mode));
    match tokio::time::timeout(Duration::from_millis(timeout_ms), task).await {
        Ok(Ok(info)) => Ok(info),
        Ok(Err(error)) => Err(format!("Antigravity 版本检测失败: {}", error)),
        Err(_) => Ok(None),
    }
}

// ============================================================================
// 数据目录与一键备份接管 ~/.cockpit_tools
// ============================================================================

#[tauri::command]
pub fn get_data_directory_settings() -> Result<DataDirectorySettings, String> {
    let active_dir = modules::data_paths::resolve_data_dir()?;
    let default_dir = modules::data_paths::default_isolated_data_dir()?;
    let configured_dir = modules::data_paths::read_data_dir_preference()?;
    let cockpit_dir = modules::data_paths::cockpit_tools_data_dir()?;
    let env_override = modules::data_paths::environment_data_dir()
        .map(|p| p.to_string_lossy().into_owned());
    let next_effective = configured_dir.as_ref().unwrap_or(&default_dir);
    let needs_restart = env_override.is_none()
        && !modules::data_paths::same_directory(&active_dir, next_effective);
    let is_using_cockpit_tools = modules::data_paths::same_directory(&active_dir, &cockpit_dir);

    Ok(DataDirectorySettings {
        active_dir: active_dir.to_string_lossy().into_owned(),
        default_dir: default_dir.to_string_lossy().into_owned(),
        configured_dir: configured_dir.map(|p| p.to_string_lossy().into_owned()),
        cockpit_tools_dir: cockpit_dir.to_string_lossy().into_owned(),
        cockpit_tools_exists: cockpit_dir.is_dir(),
        is_using_cockpit_tools,
        is_dev_profile: modules::data_paths::is_dev_profile(),
        env_override,
        needs_restart,
    })
}

#[tauri::command]
pub fn set_data_directory(path: Option<String>) -> Result<DataDirectorySettings, String> {
    let trimmed = path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let target = trimmed.map(PathBuf::from);
    if let Some(dir) = target.as_deref() {
        if !dir.exists() {
            fs::create_dir_all(dir)
                .map_err(|e| format!("创建数据目录失败 ({}): {e}", dir.display()))?;
        }
    }
    modules::data_paths::save_data_dir_preference(target.as_deref())?;
    get_data_directory_settings()
}

fn is_cockpit_tools_running() -> bool {
    use sysinfo::{ProcessRefreshKind, ProcessesToUpdate, System};
    let mut sys = System::new();
    sys.refresh_processes_specifics(ProcessesToUpdate::All, true, ProcessRefreshKind::nothing());
    sys.processes().values().any(|proc| {
        let name = proc.name().to_string_lossy().to_ascii_lowercase();
        name == "cockpit-tools.exe" || name == "cockpit_tools.exe"
    })
}

/// 一键安全备份 `~/.cockpit_tools` 中的 Antigravity 数据，并将 Agy Shift 数据目录切换指向 `~/.cockpit_tools`。
#[tauri::command]
pub async fn takeover_cockpit_tools_data_dir(
    force: Option<bool>,
) -> Result<CockpitTakeoverResult, String> {
    let force = force.unwrap_or(false);
    tokio::task::spawn_blocking(move || {
        if !force && is_cockpit_tools_running() {
            return Err("COCKPIT_TOOLS_RUNNING: 检测到原版 Cockpit Tools 正在运行，请先退出原版 Cockpit Tools 再执行正式接管，避免同时写入数据目录。".to_string());
        }
        let cockpit_dir = modules::data_paths::cockpit_tools_data_dir()?;
        if !cockpit_dir.is_dir() {
            return Err(format!("未找到原版数据目录：{}", cockpit_dir.display()));
        }
        let backup_root = modules::data_paths::default_isolated_data_dir()?.join("backups");
        let (backup_dir, backed_up_files) =
            modules::data_paths::backup_cockpit_tools_antigravity_data(&cockpit_dir, &backup_root)?;
        modules::data_paths::save_data_dir_preference(Some(&cockpit_dir))?;
        modules::logger::log_info(&format!(
            "[DataTakeover] 已备份 {} 个文件到 {}，并将数据目录指向 {}",
            backed_up_files,
            backup_dir.display(),
            cockpit_dir.display()
        ));
        Ok(CockpitTakeoverResult {
            target_dir: cockpit_dir.to_string_lossy().into_owned(),
            backup_dir: backup_dir.to_string_lossy().into_owned(),
            backed_up_files,
            needs_restart: true,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn reset_data_directory_to_default() -> Result<DataDirectorySettings, String> {
    modules::data_paths::save_data_dir_preference(None)?;
    get_data_directory_settings()
}

#[tauri::command]
pub async fn open_data_folder() -> Result<(), String> {
    let data_dir = modules::account::get_data_dir()?;
    open_folder(data_dir.to_string_lossy().into_owned()).await
}

#[tauri::command]
pub async fn open_folder(path: String) -> Result<(), String> {
    let folder_path = Path::new(&path);
    if !folder_path.exists() {
        fs::create_dir_all(folder_path).map_err(|e| format!("创建文件夹失败: {}", e))?;
    }
    std::process::Command::new("explorer")
        .arg(&path)
        .spawn()
        .map(modules::process::background_child_pid)
        .map_err(|e| format!("打开文件夹失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn open_local_path(path: String) -> Result<(), String> {
    let target = Path::new(path.trim());
    if !target.exists() {
        return Err(format!("路径不存在: {}", target.display()));
    }
    let mut cmd = std::process::Command::new("explorer");
    if target.is_file() {
        cmd.arg(format!("/select,{}", target.display()));
    } else {
        cmd.arg(target);
    }
    cmd.spawn()
        .map(modules::process::background_child_pid)
        .map_err(|e| format!("打开本地路径失败: {}", e))?;
    Ok(())
}

#[tauri::command]
pub async fn save_text_file(path: String, content: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        modules::atomic_write::write_string_atomic(Path::new(&path), &content)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn get_downloads_dir() -> Result<String, String> {
    dirs::download_dir()
        .or_else(dirs::home_dir)
        .map(|p| p.to_string_lossy().into_owned())
        .ok_or_else(|| "无法获取下载目录".to_string())
}

#[tauri::command]
pub async fn windows_elevated_close_processes(pids: Vec<u32>) -> Result<u32, String> {
    tokio::task::spawn_blocking(move || {
        modules::windows_operation::elevated_close_supported_processes(&pids)
    })
    .await
    .map_err(|e| e.to_string())?
}

// ============================================================================
// 网络与代理设置
// ============================================================================

#[tauri::command]
pub fn get_network_config() -> Result<NetworkConfig, String> {
    let user_config = config::get_user_config();
    Ok(NetworkConfig {
        ws_enabled: user_config.ws_enabled,
        ws_port: user_config.ws_port,
        actual_port: config::get_actual_port(),
        default_port: DEFAULT_WS_PORT,
        global_proxy_enabled: user_config.global_proxy_enabled,
        global_proxy_url: user_config.global_proxy_url,
        global_proxy_no_proxy: user_config.global_proxy_no_proxy,
    })
}

#[tauri::command]
pub async fn save_network_config(
    ws_enabled: bool,
    ws_port: u16,
    global_proxy_enabled: Option<bool>,
    global_proxy_url: Option<String>,
    global_proxy_no_proxy: Option<String>,
) -> Result<NetworkConfigSaveResult, String> {
    let needs_restart = tauri::async_runtime::spawn_blocking(move || {
        let mut needs_restart = false;
        config::patch_user_config(|current| {
            let next_proxy_enabled = global_proxy_enabled.unwrap_or(current.global_proxy_enabled);
            let next_proxy_url = global_proxy_url
                .unwrap_or_else(|| current.global_proxy_url.clone())
                .trim()
                .to_string();
            let next_no_proxy = global_proxy_no_proxy
                .unwrap_or_else(|| current.global_proxy_no_proxy.clone())
                .trim()
                .to_string();
            if next_proxy_enabled && next_proxy_url.is_empty() {
                return Err("启用全局代理时，代理地址不能为空".to_string());
            }
            needs_restart = current.ws_port != ws_port || current.ws_enabled != ws_enabled;
            current.ws_enabled = ws_enabled;
            current.ws_port = ws_port;
            current.global_proxy_enabled = next_proxy_enabled;
            current.global_proxy_url = next_proxy_url;
            current.global_proxy_no_proxy = next_no_proxy;
            Ok(())
        })?;
        Ok::<bool, String>(needs_restart)
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(NetworkConfigSaveResult { needs_restart })
}

// ============================================================================
// 通用与自动切号设置
// ============================================================================

fn get_app_auto_launch_enabled(app: &tauri::AppHandle) -> Result<bool, String> {
    app.autolaunch()
        .is_enabled()
        .map_err(|e| format!("读取开机自启状态失败: {}", e))
}

fn apply_app_auto_launch_enabled(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let manager = app.autolaunch();
    if enabled {
        manager
            .enable()
            .map_err(|e| format!("启用开机自启失败: {}", e))
    } else {
        manager
            .disable()
            .map_err(|e| format!("关闭开机自启失败: {}", e))
    }
}

#[tauri::command]
pub fn get_general_config(app: tauri::AppHandle) -> Result<GeneralConfig, String> {
    let user_config = config::get_user_config();
    let app_auto_launch_enabled =
        get_app_auto_launch_enabled(&app).unwrap_or(user_config.app_auto_launch_enabled);
    let close_behavior = match user_config.close_behavior {
        CloseWindowBehavior::Ask => "ask",
        CloseWindowBehavior::Minimize => "minimize",
        CloseWindowBehavior::Quit => "quit",
    };

    Ok(GeneralConfig {
        default_terminal: user_config.default_terminal,
        theme: user_config.theme,
        reduced_motion_enabled: user_config.reduced_motion_enabled,
        ui_scale: user_config.ui_scale,
        auto_refresh_minutes: user_config.auto_refresh_minutes,
        close_behavior: close_behavior.to_string(),
        show_tray_icon: user_config.show_tray_icon,
        startup_minimized: user_config.startup_minimized,
        remember_main_window_state: user_config.remember_main_window_state,
        app_auto_launch_enabled,
        auto_import_from_local_enabled: user_config.auto_import_from_local_enabled,
        antigravity_startup_wakeup_enabled: user_config.antigravity_startup_wakeup_enabled,
        antigravity_startup_wakeup_delay_seconds: user_config
            .antigravity_startup_wakeup_delay_seconds
            .clamp(0, MAX_STARTUP_WAKEUP_DELAY_SECONDS),
        antigravity_app_path: modules::process::normalize_windows_user_facing_path(
            &user_config.antigravity_app_path,
        ),
        antigravity_legacy_app_path: modules::process::normalize_windows_user_facing_path(
            &user_config.antigravity_legacy_app_path,
        ),
        antigravity_cli_path: modules::process::normalize_windows_user_facing_path(
            &user_config.antigravity_cli_path,
        ),
        antigravity_launch_on_switch: user_config.antigravity_launch_on_switch,
        antigravity_dual_switch_no_restart_enabled: user_config
            .antigravity_dual_switch_no_restart_enabled,
        auto_switch_enabled: user_config.auto_switch_enabled,
        auto_switch_threshold: user_config.auto_switch_threshold,
        auto_switch_credits_enabled: user_config.auto_switch_credits_enabled,
        auto_switch_credits_threshold: user_config.auto_switch_credits_threshold,
        auto_switch_window_thresholds_enabled: user_config.auto_switch_window_thresholds_enabled,
        auto_switch_five_hour_threshold: user_config.auto_switch_five_hour_threshold,
        auto_switch_weekly_threshold: user_config.auto_switch_weekly_threshold,
        auto_switch_scope_mode: user_config.auto_switch_scope_mode,
        auto_switch_selected_group_ids: user_config.auto_switch_selected_group_ids,
        auto_switch_account_scope_mode: user_config.auto_switch_account_scope_mode,
        auto_switch_selected_account_ids: user_config.auto_switch_selected_account_ids,
        quota_alert_enabled: user_config.quota_alert_enabled,
        quota_alert_threshold: user_config.quota_alert_threshold,
    })
}

fn is_allowed_patch_field(key: &str) -> bool {
    matches!(
        key,
        "default_terminal"
            | "theme"
            | "reduced_motion_enabled"
            | "ui_scale"
            | "auto_refresh_minutes"
            | "close_behavior"
            | "show_tray_icon"
            | "startup_minimized"
            | "remember_main_window_state"
            | "app_auto_launch_enabled"
            | "auto_import_from_local_enabled"
            | "antigravity_startup_wakeup_enabled"
            | "antigravity_startup_wakeup_delay_seconds"
            | "antigravity_app_path"
            | "antigravity_legacy_app_path"
            | "antigravity_cli_path"
            | "antigravity_launch_on_switch"
            | "antigravity_dual_switch_no_restart_enabled"
            | "auto_switch_enabled"
            | "auto_switch_threshold"
            | "auto_switch_credits_enabled"
            | "auto_switch_credits_threshold"
            | "auto_switch_window_thresholds_enabled"
            | "auto_switch_five_hour_threshold"
            | "auto_switch_weekly_threshold"
            | "auto_switch_scope_mode"
            | "auto_switch_selected_group_ids"
            | "auto_switch_account_scope_mode"
            | "auto_switch_selected_account_ids"
            | "quota_alert_enabled"
            | "quota_alert_threshold"
    )
}

fn apply_general_config_updates(
    current: &mut UserConfig,
    updates: &JsonMap<String, JsonValue>,
) -> Result<(), String> {
    for key in updates.keys() {
        if !is_allowed_patch_field(key) {
            return Err(format!("不支持的配置字段: {}", key));
        }
    }
    let mut value = serde_json::to_value(&*current)
        .map_err(|e| format!("序列化当前配置失败: {}", e))?;
    let object = value
        .as_object_mut()
        .ok_or_else(|| "当前配置结构无效".to_string())?;
    for (k, v) in updates {
        object.insert(k.clone(), v.clone());
    }
    let mut next: UserConfig =
        serde_json::from_value(value).map_err(|e| format!("配置字段类型无效: {}", e))?;

    if updates.contains_key("ui_scale") {
        next.ui_scale = next.ui_scale.clamp(0.75, 1.5);
    }
    if updates.contains_key("antigravity_startup_wakeup_delay_seconds") {
        next.antigravity_startup_wakeup_delay_seconds = next
            .antigravity_startup_wakeup_delay_seconds
            .clamp(0, MAX_STARTUP_WAKEUP_DELAY_SECONDS);
    }
    if updates.contains_key("antigravity_app_path") {
        next.antigravity_app_path =
            modules::process::normalize_windows_user_facing_path(&next.antigravity_app_path);
    }
    if updates.contains_key("antigravity_legacy_app_path") {
        next.antigravity_legacy_app_path =
            modules::process::normalize_windows_user_facing_path(&next.antigravity_legacy_app_path);
    }
    if updates.contains_key("antigravity_cli_path") {
        next.antigravity_cli_path =
            modules::process::normalize_windows_user_facing_path(&next.antigravity_cli_path);
    }
    if updates.contains_key("auto_switch_account_scope_mode") {
        next.auto_switch_account_scope_mode =
            if next.auto_switch_account_scope_mode.trim().eq_ignore_ascii_case(AUTO_SWITCH_ACCOUNT_SCOPE_SELECTED) {
                AUTO_SWITCH_ACCOUNT_SCOPE_SELECTED.to_string()
            } else {
                AUTO_SWITCH_ACCOUNT_SCOPE_ALL.to_string()
            };
    }

    *current = next;
    Ok(())
}

#[tauri::command]
pub fn patch_general_config(
    app: tauri::AppHandle,
    updates: JsonMap<String, JsonValue>,
) -> Result<(), String> {
    let _save_guard = lock_general_config_transaction()?;
    if updates.is_empty() {
        return Ok(());
    }

    let mut preview = config::get_user_config();
    apply_general_config_updates(&mut preview, &updates)?;

    let requested_auto_launch = updates
        .get("app_auto_launch_enabled")
        .map(|v| v.as_bool().ok_or_else(|| "app_auto_launch_enabled 必须为布尔值".to_string()))
        .transpose()?;
    let previous_auto_launch = requested_auto_launch
        .map(|_| get_app_auto_launch_enabled(&app))
        .transpose()?;
    if let (Some(req), Some(prev)) = (requested_auto_launch, previous_auto_launch) {
        if req != prev {
            apply_app_auto_launch_enabled(&app, req)?;
        }
    }

    let mut auto_import_changed = false;
    let mut tray_visibility_changed = false;

    let new_config = config::patch_user_config(|current| {
        let prev_auto_import = current.auto_import_from_local_enabled;
        let prev_tray = current.show_tray_icon;
        apply_general_config_updates(current, &updates)?;
        auto_import_changed = prev_auto_import != current.auto_import_from_local_enabled;
        tray_visibility_changed = prev_tray != current.show_tray_icon;
        Ok(())
    })?;

    if auto_import_changed {
        modules::auto_local_import::notify_config_changed(
            new_config.auto_import_from_local_enabled,
        );
    }
    if tray_visibility_changed {
        crate::apply_tray_visibility(&app, new_config.show_tray_icon)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn scan_auto_local_import(
    app: tauri::AppHandle,
) -> Result<modules::auto_local_import::AutoLocalImportScanResult, String> {
    modules::auto_local_import::scan_now(app).await
}

#[tauri::command]
pub async fn get_available_terminals() -> Result<Vec<String>, String> {
    let mut available = vec!["system".to_string()];
    for name in ["cmd", "PowerShell", "pwsh", "wt"] {
        use std::os::windows::process::CommandExt;
        let ok = std::process::Command::new("where")
            .arg(name)
            .creation_flags(CREATE_NO_WINDOW)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ok {
            available.push(name.to_string());
        }
    }
    Ok(available)
}

#[tauri::command]
pub async fn set_app_path(app: String, path: String, validate: Option<bool>) -> Result<(), String> {
    let normalized = modules::process::normalize_windows_user_facing_path(path.trim());
    tauri::async_runtime::spawn_blocking(move || {
        if validate.unwrap_or(false) && !normalized.is_empty() && !Path::new(&normalized).is_file()
        {
            return Err(format!("APP_PATH_NOT_FOUND:{app}"));
        }
        config::patch_user_config(move |current| {
            match app.as_str() {
                "antigravity" | "antigravity_ide" => current.antigravity_app_path = normalized,
                "antigravity_legacy" => current.antigravity_legacy_app_path = normalized,
                _ => return Err("未知应用类型".to_string()),
            }
            Ok(())
        })?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn detect_app_path(app: String, force: Option<bool>) -> Result<Option<String>, String> {
    let force = force.unwrap_or(false);
    match app.as_str() {
        "antigravity" | "antigravity_ide" | "antigravity_legacy" => {
            Ok(modules::process::detect_and_save_app_path(app.as_str(), force))
        }
        _ => Err("未知应用类型".to_string()),
    }
}

#[tauri::command]
pub async fn scan_app_launch_targets(
    app: String,
) -> Result<Vec<modules::process::AppLaunchCandidate>, String> {
    match app.as_str() {
        "antigravity" | "antigravity_ide" | "antigravity_legacy" => {}
        _ => return Err("未知应用类型".to_string()),
    }
    let task = tauri::async_runtime::spawn_blocking(move || {
        modules::process::scan_app_launch_targets(app.as_str(), None)
    });
    match tokio::time::timeout(Duration::from_secs(2), task).await {
        Ok(Ok(res)) => res,
        Ok(Err(e)) => Err(format!("检测运行中的 Antigravity 失败: {e}")),
        Err(_) => Err("检测运行中的 Antigravity 超时，请重试".to_string()),
    }
}

#[tauri::command]
pub fn set_wakeup_override(enabled: bool) -> Result<(), String> {
    websocket::broadcast_wakeup_override(enabled);
    Ok(())
}

#[tauri::command]
pub fn handle_window_close(
    window: tauri::Window,
    action: String,
    remember: bool,
) -> Result<(), String> {
    if remember {
        let close_behavior = match action.as_str() {
            "minimize" => CloseWindowBehavior::Minimize,
            "quit" => CloseWindowBehavior::Quit,
            _ => CloseWindowBehavior::Ask,
        };
        config::patch_user_config(move |current| {
            current.close_behavior = close_behavior;
            Ok(())
        })?;
    }
    match action.as_str() {
        "minimize" => modules::window_manager::minimize_main_window(&window)?,
        "quit" => {
            modules::window_manager::request_app_exit();
            window.app_handle().exit(0);
        }
        _ => return Err("无效的操作".to_string()),
    }
    Ok(())
}

#[tauri::command]
pub fn main_window_take_pending_navigation() -> Result<Option<String>, String> {
    modules::window_manager::take_pending_main_window_navigation()
}

#[tauri::command]
pub fn main_window_ready(app: tauri::AppHandle) -> Result<(), String> {
    modules::window_manager::mark_main_window_ready(&app)
}

#[tauri::command]
pub fn get_local_timezone() -> i64 {
    chrono::Local::now().offset().local_minus_utc() as i64 / 60
}

#[tauri::command]
pub fn relaunch_app(app: tauri::AppHandle) -> Result<(), String> {
    modules::window_manager::request_app_exit();
    app.request_restart();
    Ok(())
}

#[tauri::command]
pub async fn load_ui_preferences() -> Result<modules::ui_preferences::UiPreferences, String> {
    tauri::async_runtime::spawn_blocking(modules::ui_preferences::load_ui_preferences)
        .await
        .map_err(|error| format!("读取界面偏好失败: {}", error))?
}

#[tauri::command]
pub async fn save_ui_preferences(
    values: BTreeMap<String, String>,
) -> Result<modules::ui_preferences::UiPreferences, String> {
    tauri::async_runtime::spawn_blocking(move || modules::ui_preferences::save_ui_preferences(values))
        .await
        .map_err(|error| format!("保存界面偏好失败: {}", error))?
}

#[tauri::command]
pub async fn update_ui_preference(
    app: tauri::AppHandle,
    key: String,
    value: String,
    expected_revision: u64,
) -> Result<modules::ui_preferences::UiPreferences, String> {
    let changed_key = key.clone();
    let mut snapshot = tauri::async_runtime::spawn_blocking(move || {
        modules::ui_preferences::update_ui_preference(key, value, expected_revision)
    })
    .await
    .map_err(|error| error.to_string())??;
    snapshot.values.retain(|k, _| k == &changed_key);
    snapshot.revisions.retain(|k, _| k == &changed_key);
    let _ = tauri::Emitter::emit(&app, "ui-preferences:updated", &snapshot);
    Ok(snapshot)
}
