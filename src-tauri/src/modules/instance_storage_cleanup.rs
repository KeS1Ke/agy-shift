//! Antigravity-only guards for instance storage creation, link inspection,
//! and conservative directory deletion.

use std::fs::{self, File, Metadata};
use std::io;
use std::path::Path;

/// RAII guard preventing instance storage cleanup while instance creation,
/// deletion, or registry persistence is in progress.
pub struct CreationGuard {
    _gate: File,
}

/// Acquires a shared lock on the instance registry cleanup gate so nested
/// creation/deletion/registry saves can coexist while excluding cleanup.
pub fn protect_instance_creation() -> Result<CreationGuard, String> {
    let data_dir = super::account::get_data_dir()?;
    let gate = super::instance_registry::cleanup_gate(&data_dir, false)?;
    Ok(CreationGuard { _gate: gate })
}

fn is_link_metadata(metadata: &Metadata) -> bool {
    if metadata.file_type().is_symlink() {
        return true;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x0400;
        if metadata.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

/// Returns `true` if `path` or any existing ancestor is a symlink or Windows
/// reparse point (including NTFS junctions).
pub fn path_has_link_ancestor(path: &Path) -> Result<bool, String> {
    for ancestor in path.ancestors() {
        if ancestor.as_os_str().is_empty() {
            continue;
        }
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                if is_link_metadata(&metadata) {
                    return Ok(true);
                }
            }
            Err(err) if err.kind() == io::ErrorKind::NotFound => continue,
            Err(err) => {
                return Err(format!(
                    "检查路径链接属性失败 ({}): {err}",
                    ancestor.display()
                ))
            }
        }
    }
    Ok(false)
}

/// Returns `true` only when `dir_path` is a real directory directly inside
/// Antigravity's owned instance storage (`instances/antigravity` or
/// `instances/antigravity-legacy`), has no symlink/reparse-point ancestor,
/// and carries a valid creation-ownership marker.
pub fn can_delete_registered_instance_directory(dir_path: &Path) -> Result<bool, String> {
    let metadata = match fs::symlink_metadata(dir_path) {
        Ok(metadata) => metadata,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(err) => {
            return Err(format!(
                "检查实例目录属性失败 ({}): {err}",
                dir_path.display()
            ))
        }
    };
    if is_link_metadata(&metadata) || !metadata.is_dir() {
        return Ok(false);
    }
    if path_has_link_ancestor(dir_path)? {
        return Ok(false);
    }
    let normalized = super::data_paths::without_compatibility_alias(dir_path);
    let canonical_dir = match fs::canonicalize(&normalized) {
        Ok(path) => path,
        Err(err) if err.kind() == io::ErrorKind::NotFound => return Ok(false),
        Err(err) => {
            return Err(format!(
                "解析实例目录真实路径失败 ({}): {err}",
                dir_path.display()
            ))
        }
    };
    let Some(parent) = canonical_dir.parent() else {
        return Ok(false);
    };
    let managed_roots = [
        super::antigravity_paths::managed_instances_root_dir()?,
        super::antigravity_paths::legacy_managed_instances_root_dir()?,
    ];
    let in_managed_root = managed_roots
        .iter()
        .any(|root| fs::canonicalize(root).ok().as_deref() == Some(parent));
    if !in_managed_root {
        return Ok(false);
    }
    Ok(super::instance_directory_ownership::owner(&canonical_dir)?.is_some())
}

#[cfg(test)]
mod tests {
    use super::*;

    struct DataDirFixture {
        dir: tempfile::TempDir,
        previous: Option<std::ffi::OsString>,
    }

    impl DataDirFixture {
        fn new() -> Self {
            let dir = tempfile::tempdir().unwrap();
            let previous = std::env::var_os("COCKPIT_TOOLS_TEST_DATA_DIR");
            std::env::set_var("COCKPIT_TOOLS_TEST_DATA_DIR", dir.path());
            Self { dir, previous }
        }

        fn path(&self) -> &Path {
            self.dir.path()
        }
    }

    impl Drop for DataDirFixture {
        fn drop(&mut self) {
            match &self.previous {
                Some(previous) => std::env::set_var("COCKPIT_TOOLS_TEST_DATA_DIR", previous),
                None => std::env::remove_var("COCKPIT_TOOLS_TEST_DATA_DIR"),
            }
        }
    }

    #[test]
    fn nested_creation_guards_coexist_while_exclusive_gate_blocks() {
        let _lock = crate::modules::test_support::env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let fixture = DataDirFixture::new();

        let outer = protect_instance_creation().unwrap();
        let inner = protect_instance_creation().unwrap();
        drop(inner);
        drop(outer);

        let exclusive = crate::modules::instance_registry::cleanup_gate(fixture.path(), true).unwrap();
        assert!(protect_instance_creation().is_err());
        drop(exclusive);
        assert!(protect_instance_creation().is_ok());
    }

    #[test]
    fn only_owned_directories_under_antigravity_managed_roots_can_be_deleted() {
        let _lock = crate::modules::test_support::env_lock()
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        let fixture = DataDirFixture::new();

        let current_root = fixture.path().join("instances").join("antigravity");
        let legacy_root = fixture.path().join("instances").join("antigravity-legacy");
        let external_root = fixture.path().join("external");
        let owned_current = current_root.join("owned");
        let owned_legacy = legacy_root.join("owned-legacy");
        let unowned_current = current_root.join("unowned");
        let external_marked = external_root.join("marked");
        let regular_file = current_root.join("file.txt");

        for dir in [&owned_current, &owned_legacy, &unowned_current, &external_marked] {
            fs::create_dir_all(dir).unwrap();
        }
        fs::write(&regular_file, "data").unwrap();

        crate::modules::instance_directory_ownership::test_mark_created(&owned_current);
        crate::modules::instance_directory_ownership::test_mark_created(&owned_legacy);
        crate::modules::instance_directory_ownership::test_mark_created(&external_marked);

        assert!(can_delete_registered_instance_directory(&owned_current).unwrap());
        assert!(can_delete_registered_instance_directory(&owned_legacy).unwrap());
        assert!(!can_delete_registered_instance_directory(&unowned_current).unwrap());
        assert!(!can_delete_registered_instance_directory(&external_marked).unwrap());
        assert!(!can_delete_registered_instance_directory(&regular_file).unwrap());
        assert!(!can_delete_registered_instance_directory(
            &current_root.join("missing")
        )
        .unwrap());
    }

    #[test]
    fn path_has_link_ancestor_returns_false_for_regular_directory() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("instances").join("antigravity").join("pending");
        assert!(!path_has_link_ancestor(&nested).unwrap());
    }
}
