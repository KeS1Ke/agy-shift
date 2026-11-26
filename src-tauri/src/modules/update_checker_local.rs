use super::ReleaseHistoryItem;
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ReleaseNotes {
    pub release_notes: String,
    pub release_notes_zh: String,
}

#[derive(Serialize, Deserialize)]
struct PendingUpdateNotes {
    version: String,
    #[serde(default)]
    release_notes: String,
    #[serde(default)]
    release_notes_zh: String,
}

fn pending_notes_path() -> Result<std::path::PathBuf, String> {
    Ok(super::get_data_dir()?.join("pending_update_notes.json"))
}

pub fn save_pending_update_notes(
    version: String,
    release_notes: String,
    release_notes_zh: String,
) -> Result<(), String> {
    if version.trim().is_empty() {
        return Err("版本号不能为空".into());
    }
    let path = super::ensure_data_dir()?.join("pending_update_notes.json");
    let pending = PendingUpdateNotes {
        version,
        release_notes,
        release_notes_zh,
    };
    let content = serde_json::to_string_pretty(&pending).map_err(|error| error.to_string())?;
    crate::modules::atomic_write::write_string_atomic(&path, &content)
        .map_err(|error| error.to_string())
}

fn read_pending(path: &std::path::Path, version: &str) -> Option<ReleaseNotes> {
    let contents = std::fs::read_to_string(path).ok()?;
    let pending: PendingUpdateNotes = serde_json::from_str(&contents).ok()?;
    if pending.version.trim().trim_start_matches('v') != version
        || (pending.release_notes.is_empty() && pending.release_notes_zh.is_empty())
    {
        return None;
    }
    Some(ReleaseNotes {
        release_notes: pending.release_notes,
        release_notes_zh: pending.release_notes_zh,
    })
}

pub fn get_pending_release_notes(version: &str) -> Option<ReleaseNotes> {
    let version = version.trim().trim_start_matches('v');
    pending_notes_path()
        .ok()
        .and_then(|path| read_pending(&path, version))
}

pub fn get_bundled_release_notes(_version: &str) -> ReleaseNotes {
    ReleaseNotes {
        release_notes: String::new(),
        release_notes_zh: String::new(),
    }
}

pub fn get_local_release_history(
    _locale: Option<&str>,
    _limit: Option<usize>,
) -> Vec<ReleaseHistoryItem> {
    Vec::new()
}
