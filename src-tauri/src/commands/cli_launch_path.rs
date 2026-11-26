use std::path::{Path, PathBuf};
use std::time::Duration;

use crate::modules::{config, process};

pub(crate) fn executable_file(path: &Path) -> bool {
    path.is_absolute()
        && path.metadata().is_ok_and(|metadata| {
            if !metadata.is_file() {
                return false;
            }
            path.extension()
                .and_then(|ext| ext.to_str())
                .is_some_and(|ext| {
                    ["exe", "cmd", "bat", "com"]
                        .iter()
                        .any(|name| ext.eq_ignore_ascii_case(name))
                })
        })
}

fn configured_cli_path(app: &str, config: &config::UserConfig) -> Option<String> {
    let path = match app {
        "antigravity_cli" => &config.antigravity_cli_path,
        _ => return None,
    };
    Some(process::normalize_windows_user_facing_path(path))
}

fn detect_cli_path(app: &str) -> Option<PathBuf> {
    match app {
        "antigravity_cli" => super::account::cli_launch::detect_cli(),
        _ => None,
    }
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct LaunchPathStatus {
    configured_path: Option<String>,
    resolved_path: Option<String>,
    uses_configured_path: bool,
}

fn path_for_display(path: PathBuf) -> String {
    process::normalize_windows_user_facing_path(&path.to_string_lossy())
}

fn matches_desktop_scan_target(app: &str, path: &str) -> bool {
    let normalized = path.to_ascii_lowercase().replace('\\', "/");
    let name = normalized.rsplit('/').next().unwrap_or_default();
    match app {
        "antigravity" => matches!(name, "antigravity ide.exe" | "antigravity-ide.exe"),
        "antigravity_legacy" => {
            name == "antigravity.exe"
                || (name == "electron.exe" && normalized.contains("/antigravity/"))
        }
        _ => false,
    }
}

async fn run_launch_path_probe<T: Send + 'static>(
    probe: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    let worker = tokio::task::spawn_blocking(probe);
    tokio::time::timeout(Duration::from_secs(5), worker)
        .await
        .map_err(|_| "LAUNCH_PATH_CHECK_TIMEOUT".to_string())?
        .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn get_platform_launch_path(app: String) -> Result<LaunchPathStatus, String> {
    run_launch_path_probe(move || {
        if let Some(path) = configured_cli_path(&app, &config::get_user_config()) {
            let configured_path = (!path.is_empty()).then_some(path);
            let uses_configured_path = configured_path
                .as_deref()
                .is_some_and(|path| executable_file(Path::new(path)));
            let resolved_path = if uses_configured_path {
                configured_path.clone()
            } else if configured_path.is_none() {
                detect_cli_path(&app).map(path_for_display)
            } else {
                None
            };
            return Ok(LaunchPathStatus {
                configured_path,
                resolved_path,
                uses_configured_path,
            });
        }
        let path = process::inspect_preview_desktop_path(&app).ok_or("UNKNOWN_LAUNCH_TARGET")?;
        Ok(LaunchPathStatus {
            configured_path: path.configured_path,
            resolved_path: path.resolved_path.map(path_for_display),
            uses_configured_path: path.uses_configured_path,
        })
    })
    .await
}

#[tauri::command]
pub(crate) async fn scan_platform_launch_paths(app: String) -> Result<Vec<String>, String> {
    run_launch_path_probe(move || {
        if configured_cli_path(&app, &config::get_user_config()).is_some() {
            return Ok(detect_cli_path(&app)
                .map(path_for_display)
                .into_iter()
                .collect());
        }
        if !matches!(app.as_str(), "antigravity" | "antigravity_legacy") {
            return Err("UNKNOWN_LAUNCH_TARGET".into());
        }
        let mut paths: Vec<String> = process::detect_preview_desktop_path(&app)
            .map(path_for_display)
            .into_iter()
            .collect();
        match process::scan_app_launch_targets(&app, None) {
            Ok(candidates) => {
                for candidate in candidates {
                    if candidate.target_type == "exe"
                        && matches_desktop_scan_target(&app, &candidate.target)
                        && !paths.contains(&candidate.target)
                    {
                        paths.push(candidate.target);
                    }
                }
            }
            Err(error) if paths.is_empty() => return Err(error),
            Err(_) => {}
        }
        Ok(paths)
    })
    .await
}

#[tauri::command]
pub(crate) async fn inspect_cli_launch_path(
    app: String,
    detect: bool,
) -> Result<Option<String>, String> {
    run_launch_path_probe(move || {
        let configured =
            configured_cli_path(&app, &config::get_user_config()).ok_or("UNKNOWN_CLI_TARGET")?;
        let path = if detect {
            detect_cli_path(&app).map(path_for_display)
        } else {
            Some(configured)
        };
        Ok(path.filter(|path| !path.is_empty()))
    })
    .await
}

#[tauri::command]
pub(crate) async fn save_cli_launch_path(app: String, path: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let path = process::normalize_windows_user_facing_path(path.trim());
        if !path.is_empty() && !executable_file(Path::new(&path)) {
            return Err(format!("CLI_PATH_NOT_FOUND:{app}"));
        }
        config::patch_user_config(move |config| {
            match app.as_str() {
                "antigravity_cli" => config.antigravity_cli_path = path,
                _ => return Err("UNKNOWN_CLI_TARGET".into()),
            }
            Ok(())
        })?;
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())?
}
