//! Agy Shift 数据目录解析与隔离策略：
//! - Debug / 开发态固定隔离到 `~/.agy_shift_dev`（绝不干扰运行中的 Cockpit Tools）。
//! - Release 正式版默认独立存放在 `~/.agy_shift`，避免首次试用时与原版冲突。
//! - 在设置页触发「备份并正式接管 ~/.cockpit_tools」后，将偏好写入
//!   `~/.agy_shift-data-root.json` 指向 `~/.cockpit_tools`，重启后直接接管原目录并与插件互通。
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

pub const DATA_DIR: &str = ".agy_shift";
pub const DEV_DATA_DIR: &str = ".agy_shift_dev";
pub const COCKPIT_TOOLS_DATA_DIR_NAME: &str = ".cockpit_tools";

static DATA_ROOT_PREFERENCE: OnceLock<Result<Option<PathBuf>, String>> = OnceLock::new();
static DEV_ROOT_PREFERENCE: OnceLock<Result<Option<PathBuf>, String>> = OnceLock::new();

pub fn is_dev_profile() -> bool {
    if cfg!(debug_assertions) {
        return true;
    }
    std::env::var("AGY_SHIFT_PROFILE")
        .or_else(|_| std::env::var("COCKPIT_TOOLS_PROFILE"))
        .map(|value| value.trim().eq_ignore_ascii_case("dev"))
        .unwrap_or(false)
}

pub fn environment_data_dir() -> Option<PathBuf> {
    std::env::var("AGY_SHIFT_DATA_DIR")
        .or_else(|_| std::env::var("COCKPIT_TOOLS_DATA_DIR"))
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

pub fn default_isolated_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    Ok(home.join(if is_dev_profile() {
        DEV_DATA_DIR
    } else {
        DATA_DIR
    }))
}

pub fn cockpit_tools_data_dir() -> Result<PathBuf, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    Ok(home.join(COCKPIT_TOOLS_DATA_DIR_NAME))
}

fn data_dir_preference_path(home: &Path, dev: bool) -> PathBuf {
    home.join(if dev {
        ".agy_shift_dev-data-root.json"
    } else {
        ".agy_shift-data-root.json"
    })
}

fn read_data_dir_preference_at(path: &Path) -> Result<Option<PathBuf>, String> {
    let content = match fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("读取数据目录设置失败 ({}): {error}", path.display())),
    };
    let selected: Option<PathBuf> = serde_json::from_str(&content)
        .map_err(|error| format!("数据目录设置无效 ({}): {error}", path.display()))?;
    if selected.as_ref().is_some_and(|p| !p.is_absolute()) {
        return Err(format!("数据目录设置必须是绝对路径: {}", path.display()));
    }
    Ok(selected)
}

pub fn read_data_dir_preference() -> Result<Option<PathBuf>, String> {
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    read_data_dir_preference_at(&data_dir_preference_path(&home, is_dev_profile()))
}

fn active_data_dir_preference() -> Result<Option<PathBuf>, String> {
    let cache = if is_dev_profile() {
        &DEV_ROOT_PREFERENCE
    } else {
        &DATA_ROOT_PREFERENCE
    };
    cache.get_or_init(read_data_dir_preference).clone()
}

pub fn save_data_dir_preference(selected: Option<&Path>) -> Result<(), String> {
    if let Some(directory) = selected {
        if !directory.is_absolute() {
            return Err("数据目录必须是绝对路径".into());
        }
        let metadata = fs::metadata(directory)
            .map_err(|error| format!("无法访问数据目录 ({}): {error}", directory.display()))?;
        if !metadata.is_dir() {
            return Err(format!("选中的路径不是目录: {}", directory.display()));
        }
    }
    let home = dirs::home_dir().ok_or("无法获取用户主目录")?;
    let _ = active_data_dir_preference();
    let preference = data_dir_preference_path(&home, is_dev_profile());
    let content = serde_json::to_string(&selected).map_err(|error| error.to_string())?;
    crate::modules::atomic_write::write_string_atomic(&preference, &content)
}

pub fn active_custom_data_dir() -> Result<Option<PathBuf>, String> {
    if let Some(path) = environment_data_dir() {
        return Ok(Some(path));
    }
    active_data_dir_preference()
}

pub fn resolve_data_dir() -> Result<PathBuf, String> {
    #[cfg(test)]
    for key in ["COCKPIT_TOOLS_TEST_DATA_DIR", "COCKPIT_TEST_DATA_DIR"] {
        if let Ok(override_dir) = std::env::var(key) {
            let override_dir = override_dir.trim();
            if !override_dir.is_empty() {
                return Ok(PathBuf::from(override_dir));
            }
        }
    }
    if let Some(path) = active_custom_data_dir()? {
        return Ok(path);
    }
    default_isolated_data_dir()
}

pub fn fallback_data_dir() -> PathBuf {
    resolve_data_dir().unwrap_or_else(|_| {
        dirs::home_dir()
            .unwrap_or_default()
            .join(if is_dev_profile() {
                DEV_DATA_DIR
            } else {
                DATA_DIR
            })
    })
}

pub fn managed_instances_root_dir(platform: &str) -> Result<PathBuf, String> {
    Ok(resolve_data_dir()?.join("instances").join(platform))
}

pub fn without_compatibility_alias(path: &Path) -> PathBuf {
    path.to_path_buf()
}

pub fn same_directory(left: &Path, right: &Path) -> bool {
    match (fs::canonicalize(left), fs::canonicalize(right)) {
        (Ok(a), Ok(b)) => a == b,
        _ => left
            .to_string_lossy()
            .eq_ignore_ascii_case(&right.to_string_lossy()),
    }
}

/// 备份 `~/.cockpit_tools` 中与 Antigravity 相关的核心文件与目录到 `~/.agy_shift/backups/cockpit_takeover_<ts>`。
pub fn backup_cockpit_tools_antigravity_data(
    source_dir: &Path,
    backup_root: &Path,
) -> Result<(PathBuf, usize), String> {
    if !source_dir.is_dir() {
        return Err(format!("未找到 Cockpit Tools 数据目录: {}", source_dir.display()));
    }
    let stamp = chrono::Local::now().format("%Y%m%d_%H%M%S").to_string();
    let dest = backup_root.join(format!("cockpit_takeover_{}", stamp));
    fs::create_dir_all(&dest)
        .map_err(|e| format!("创建备份目录失败 ({}): {e}", dest.display()))?;

    let antigravity_entries = [
        "accounts",
        "antigravity_token_usage",
        "antigravity_accounts.sqlite",
        "antigravity_accounts.sqlite-wal",
        "antigravity_accounts.sqlite-shm",
        "antigravity_wakeup_state.sqlite",
        "account_groups.sqlite",
        "switch_history.sqlite",
        "wakeup_history.sqlite",
        "wakeup_verification_state.sqlite",
        "instance_registry.sqlite",
        "secure-account-storage.key",
        "account-token.key",
        "config.json",
        "current_account.json",
        "ui_preferences.json",
    ];

    let mut copied = 0usize;
    for entry in antigravity_entries {
        let src = source_dir.join(entry);
        if !src.exists() {
            continue;
        }
        let dst = dest.join(entry);
        if src.is_dir() {
            copied += copy_dir_recursive(&src, &dst)?;
        } else {
            fs::copy(&src, &dst)
                .map_err(|e| format!("备份文件失败 ({}): {e}", src.display()))?;
            copied += 1;
        }
    }

    Ok((dest, copied))
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<usize, String> {
    fs::create_dir_all(dst).map_err(|e| format!("创建目录失败 ({}): {e}", dst.display()))?;
    let mut count = 0usize;
    for entry in fs::read_dir(src).map_err(|e| format!("读取目录失败 ({}): {e}", src.display()))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let target = dst.join(entry.file_name());
        if path.is_dir() {
            count += copy_dir_recursive(&path, &target)?;
        } else if path.is_file() {
            fs::copy(&path, &target)
                .map_err(|e| format!("复制文件失败 ({}): {e}", path.display()))?;
            count += 1;
        }
    }
    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn backup_copies_only_antigravity_files_without_mutating_source() {
        let sandbox = tempfile::tempdir().unwrap();
        let source = sandbox.path().join(".cockpit_tools");
        let backup_root = sandbox.path().join(".agy_shift").join("backups");
        fs::create_dir_all(source.join("accounts")).unwrap();
        fs::create_dir_all(source.join("codex_accounts")).unwrap();
        fs::write(source.join("accounts").join("a1.json"), "{}").unwrap();
        fs::write(source.join("codex_accounts").join("c1.json"), "{}").unwrap();
        fs::write(source.join("config.json"), r#"{"theme":"dark"}"#).unwrap();

        let (dest, copied) = backup_cockpit_tools_antigravity_data(&source, &backup_root).unwrap();
        assert_eq!(copied, 2);
        assert!(dest.join("accounts").join("a1.json").is_file());
        assert!(dest.join("config.json").is_file());
        assert!(!dest.join("codex_accounts").exists());
    }

    #[test]
    fn preference_roundtrip_accepts_absolute_and_rejects_relative() {
        let sandbox = tempfile::tempdir().unwrap();
        let pref = sandbox.path().join("pref.json");
        fs::write(&pref, serde_json::to_string(&Some(sandbox.path())).unwrap()).unwrap();
        assert_eq!(
            read_data_dir_preference_at(&pref).unwrap(),
            Some(sandbox.path().to_path_buf())
        );

        fs::write(&pref, r#""relative/path""#).unwrap();
        assert!(read_data_dir_preference_at(&pref).is_err());
    }
}
