use crate::modules::logger;
use crate::modules::update_checker::{
    self, ReleaseHistoryItem, ReleaseNotes, UpdateSettings, VersionJumpInfo,
};

#[tauri::command]
pub fn should_check_updates() -> Result<bool, String> {
    let settings = update_checker::load_update_settings()?;
    Ok(update_checker::should_check_for_updates(&settings))
}

#[tauri::command]
pub fn update_last_check_time() -> Result<(), String> {
    update_checker::update_last_check_time()
}

#[tauri::command]
pub fn get_update_settings() -> Result<UpdateSettings, String> {
    update_checker::load_update_settings()
}

#[tauri::command]
pub fn patch_update_settings(
    auto_check: Option<bool>,
    check_interval_hours: Option<u64>,
    auto_install: Option<bool>,
    last_run_version: Option<String>,
    remind_on_update: Option<bool>,
    skipped_version: Option<String>,
) -> Result<UpdateSettings, String> {
    update_checker::patch_update_settings(move |settings| {
        if let Some(value) = auto_check {
            settings.auto_check = value;
        }
        if let Some(value) = check_interval_hours {
            settings.check_interval_hours = value;
        }
        if let Some(value) = auto_install {
            settings.auto_install = value;
        }
        if let Some(value) = last_run_version {
            settings.last_run_version = value;
        }
        if let Some(value) = remind_on_update {
            settings.remind_on_update = value;
        }
        if let Some(value) = skipped_version {
            settings.skipped_version = value;
        }
    })
}

#[tauri::command]
pub fn check_version_jump() -> Result<Option<VersionJumpInfo>, String> {
    update_checker::check_version_jump()
}

#[tauri::command]
pub async fn get_release_history(
    locale: Option<String>,
    limit: Option<usize>,
) -> Result<Vec<ReleaseHistoryItem>, String> {
    tokio::task::spawn_blocking(move || {
        update_checker::get_local_release_history(locale.as_deref(), limit)
    })
    .await
    .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_bundled_release_notes(version: String) -> Result<ReleaseNotes, String> {
    tokio::task::spawn_blocking(move || update_checker::get_bundled_release_notes(&version))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn get_pending_release_notes(version: String) -> Result<Option<ReleaseNotes>, String> {
    tokio::task::spawn_blocking(move || update_checker::get_pending_release_notes(&version))
        .await
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn save_pending_update_notes(
    version: String,
    release_notes: String,
    release_notes_zh: String,
) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        update_checker::save_pending_update_notes(version, release_notes, release_notes_zh)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub fn update_log(level: String, message: String) -> Result<(), String> {
    let message = message.trim();
    if message.is_empty() {
        return Ok(());
    }
    let text = format!("[Updater] {}", message);
    match level.trim().to_lowercase().as_str() {
        "error" => logger::log_error(&text),
        "warn" | "warning" => logger::log_warn(&text),
        _ => logger::log_info(&text),
    }
    Ok(())
}

#[tauri::command]
pub fn relaunch_after_update(app: tauri::AppHandle) -> Result<(), String> {
    crate::modules::window_manager::request_app_exit();
    app.request_restart();
    Ok(())
}
