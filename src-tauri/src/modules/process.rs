//! Windows-only Antigravity 进程检测、窗口聚焦、安全关闭与启动模块。
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::time::{Duration, Instant};

use serde::Serialize;
use sysinfo::{Pid, ProcessRefreshKind, ProcessesToUpdate, System, UpdateKind};

use crate::modules::{app_lifecycle, config, logger, windows_operation};

const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AntigravityCloseMode {
    Restart,
    Stop,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppLaunchCandidate {
    pub target_type: String,
    pub label: String,
    pub target: String,
    pub source: String,
    pub supports_multi_instance: bool,
}

#[derive(Debug, Clone)]
pub(crate) struct DesktopLaunchPath {
    pub configured_path: Option<String>,
    pub resolved_path: Option<PathBuf>,
    pub uses_configured_path: bool,
}

pub(crate) fn background_child_pid(child: Child) -> u32 {
    child.id()
}

pub fn normalize_windows_user_facing_path(raw: &str) -> String {
    let trimmed = raw.trim().trim_matches('"');
    if trimmed.is_empty() {
        return String::new();
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.starts_with(r"\\?\unc\") {
        let rest: String = trimmed.chars().skip(r"\\?\UNC\".chars().count()).collect();
        format!(r"\\{rest}")
    } else if lower.starts_with(r"\\?\") {
        trimmed.chars().skip(r"\\?\".chars().count()).collect()
    } else {
        trimmed.to_string()
    }
}

fn normalize_path_for_compare(raw: &str) -> String {
    normalize_windows_user_facing_path(raw)
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_ascii_lowercase()
}

fn is_wsl_unc_path(path: &str) -> bool {
    let lower = path.trim().replace('/', "\\").to_ascii_lowercase();
    lower.starts_with(r"\\wsl.localhost\") || lower.starts_with(r"\\wsl$\")
}

pub fn parse_extra_args(raw: &str) -> Vec<String> {
    let mut args = Vec::new();
    let mut current = String::new();
    let mut quote: Option<char> = None;
    for ch in raw.chars() {
        match (quote, ch) {
            (Some(end), c) if c == end => quote = None,
            (None, '\'' | '"') => quote = Some(ch),
            (None, c) if c.is_whitespace() => {
                if !current.is_empty() {
                    args.push(std::mem::take(&mut current));
                }
            }
            (_, c) => current.push(c),
        }
    }
    if !current.is_empty() {
        args.push(current);
    }
    args
}

pub(crate) fn antigravity_install_root_from_path(path: &Path) -> Option<PathBuf> {
    if path.is_file() {
        let parent = path.parent()?;
        let parent_name = parent
            .file_name()
            .map(|n| n.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        if parent_name == "bin" {
            return parent.parent().map(Path::to_path_buf).or_else(|| Some(parent.to_path_buf()));
        }
        return Some(parent.to_path_buf());
    }
    if path.is_dir() {
        return Some(path.to_path_buf());
    }
    None
}

fn app_path_missing_error(app: &str) -> String {
    format!("APP_PATH_NOT_FOUND:{app}")
}

fn extract_user_data_dir_from_cmd(cmd: &[std::ffi::OsString]) -> Option<String> {
    let mut iter = cmd.iter();
    while let Some(arg) = iter.next() {
        let s = arg.to_string_lossy();
        if let Some(val) = s.strip_prefix("--user-data-dir=") {
            let trimmed = val.trim().trim_matches('"');
            if !trimmed.is_empty() {
                return Some(trimmed.to_string());
            }
        } else if s.eq_ignore_ascii_case("--user-data-dir") {
            if let Some(next) = iter.next() {
                let val = next.to_string_lossy();
                let trimmed = val.trim().trim_matches('"');
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
    }
    None
}

fn is_helper_cmd(cmd: &[std::ffi::OsString]) -> bool {
    cmd.iter().any(|arg| {
        let lower = arg.to_string_lossy().to_ascii_lowercase();
        lower.starts_with("--type=")
            || lower.contains("crashpad")
            || lower.contains("--utility-sub-type=")
    })
}

fn matches_ide_executable(exe_name_lower: &str, exe_path_lower: &str) -> bool {
    matches!(exe_name_lower, "antigravity ide.exe" | "antigravity-ide.exe")
        || (exe_name_lower == "electron.exe" && exe_path_lower.contains("antigravity ide"))
}

fn matches_legacy_executable(exe_name_lower: &str, exe_path_lower: &str) -> bool {
    exe_name_lower == "antigravity.exe"
        || (exe_name_lower == "electron.exe"
            && exe_path_lower.contains("antigravity")
            && !exe_path_lower.contains("antigravity ide"))
}

fn collect_antigravity_entries(legacy: bool) -> Vec<(u32, Option<String>, Option<PathBuf>)> {
    let mut system = System::new();
    system.refresh_processes_specifics(
        ProcessesToUpdate::All,
        true,
        ProcessRefreshKind::nothing()
            .with_exe(UpdateKind::Always)
            .with_cmd(UpdateKind::Always),
    );
    let current_pid = std::process::id();
    let mut results = Vec::new();
    for (pid, process) in system.processes() {
        let pid_u32 = pid.as_u32();
        if pid_u32 == current_pid {
            continue;
        }
        let name_lower = process.name().to_string_lossy().to_ascii_lowercase();
        let exe_path = process.exe().map(Path::to_path_buf);
        let path_lower = exe_path
            .as_ref()
            .map(|p| p.to_string_lossy().to_ascii_lowercase())
            .unwrap_or_default();
        let matched = if legacy {
            matches_legacy_executable(&name_lower, &path_lower)
        } else {
            matches_ide_executable(&name_lower, &path_lower)
        };
        if !matched {
            continue;
        }
        let cmd = process.cmd();
        if is_helper_cmd(cmd) {
            continue;
        }
        let user_data_dir = extract_user_data_dir_from_cmd(cmd);
        results.push((pid_u32, user_data_dir, exe_path));
    }
    results
}

fn find_running_exe(legacy: bool) -> Option<PathBuf> {
    collect_antigravity_entries(legacy)
        .into_iter()
        .find_map(|(_, _, exe)| exe.filter(|p| p.is_file()))
}

fn candidate_install_paths(legacy: bool) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    let names: &[(&str, &str)] = if legacy {
        &[
            ("Antigravity", "Antigravity.exe"),
            ("antigravity", "Antigravity.exe"),
        ]
    } else {
        &[
            ("Antigravity IDE", "Antigravity IDE.exe"),
            ("Antigravity IDE", "antigravity-ide.exe"),
            ("antigravity-ide", "Antigravity IDE.exe"),
        ]
    };

    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        let local_path = PathBuf::from(&local);
        let programs = local_path.join("Programs");
        for (dir, exe) in names {
            candidates.push(programs.join(dir).join(exe));
            candidates.push(local_path.join(dir).join(exe));
        }
    }
    for env_key in ["PROGRAMFILES", "PROGRAMFILES(X86)"] {
        if let Ok(base) = std::env::var(env_key) {
            let base_path = PathBuf::from(base);
            for (dir, exe) in names {
                candidates.push(base_path.join(dir).join(exe));
            }
        }
    }
    candidates
}

pub fn detect_antigravity_exec_path() -> Option<PathBuf> {
    if let Some(path) = find_running_exe(false) {
        return Some(path);
    }
    candidate_install_paths(false)
        .into_iter()
        .find(|p| !is_wsl_unc_path(&p.to_string_lossy()) && p.is_file())
}

pub fn detect_antigravity_legacy_exec_path() -> Option<PathBuf> {
    if let Some(path) = find_running_exe(true) {
        return Some(path);
    }
    candidate_install_paths(true)
        .into_iter()
        .find(|p| !is_wsl_unc_path(&p.to_string_lossy()) && p.is_file())
}

pub(crate) fn detect_preview_desktop_path(app: &str) -> Option<PathBuf> {
    match app {
        "antigravity" | "antigravity_ide" => detect_antigravity_exec_path(),
        "antigravity_legacy" => detect_antigravity_legacy_exec_path(),
        _ => None,
    }
}

pub(crate) fn inspect_preview_desktop_path(app: &str) -> Option<DesktopLaunchPath> {
    let current = config::get_user_config();
    let raw = match app {
        "antigravity" | "antigravity_ide" => &current.antigravity_app_path,
        "antigravity_legacy" => &current.antigravity_legacy_app_path,
        _ => return None,
    };
    let normalized = normalize_windows_user_facing_path(raw);
    let configured_path = (!normalized.is_empty()).then_some(normalized);
    let configured_valid = configured_path
        .as_deref()
        .map(PathBuf::from)
        .filter(|p| p.is_file());
    let uses_configured_path = configured_valid.is_some();
    let resolved_path = configured_valid.or_else(|| {
        if configured_path.is_none() {
            detect_preview_desktop_path(app)
        } else {
            None
        }
    });
    Some(DesktopLaunchPath {
        configured_path,
        resolved_path,
        uses_configured_path,
    })
}

fn resolve_antigravity_launch_path() -> Result<PathBuf, String> {
    inspect_preview_desktop_path("antigravity")
        .and_then(|p| p.resolved_path)
        .ok_or_else(|| app_path_missing_error("antigravity"))
}

fn resolve_antigravity_legacy_launch_path() -> Result<PathBuf, String> {
    inspect_preview_desktop_path("antigravity_legacy")
        .and_then(|p| p.resolved_path)
        .ok_or_else(|| app_path_missing_error("antigravity_legacy"))
}

pub fn ensure_antigravity_launch_path_configured() -> Result<(), String> {
    resolve_antigravity_launch_path().map(|_| ())
}

pub fn ensure_antigravity_legacy_launch_path_configured() -> Result<(), String> {
    resolve_antigravity_legacy_launch_path().map(|_| ())
}

pub fn detect_and_save_app_path(app: &str, force: bool) -> Option<String> {
    let current = config::get_user_config();
    match app {
        "antigravity" | "antigravity_ide" => {
            if !force && !current.antigravity_app_path.trim().is_empty() {
                return Some(normalize_windows_user_facing_path(
                    &current.antigravity_app_path,
                ));
            }
            let detected = detect_antigravity_exec_path()?;
            let path_str = normalize_windows_user_facing_path(&detected.to_string_lossy());
            let saved = path_str.clone();
            let _ = config::patch_user_config(move |cfg| {
                cfg.antigravity_app_path = saved;
                Ok(())
            });
            Some(path_str)
        }
        "antigravity_legacy" => {
            if !force && !current.antigravity_legacy_app_path.trim().is_empty() {
                return Some(normalize_windows_user_facing_path(
                    &current.antigravity_legacy_app_path,
                ));
            }
            let detected = detect_antigravity_legacy_exec_path()?;
            let path_str = normalize_windows_user_facing_path(&detected.to_string_lossy());
            let saved = path_str.clone();
            let _ = config::patch_user_config(move |cfg| {
                cfg.antigravity_legacy_app_path = saved;
                Ok(())
            });
            Some(path_str)
        }
        _ => None,
    }
}

pub fn scan_app_launch_targets(
    app: &str,
    _scan_roots: Option<&str>,
) -> Result<Vec<AppLaunchCandidate>, String> {
    let legacy = app == "antigravity_legacy";
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    let mut push_path = |path: PathBuf, source: &str| {
        let normalized = normalize_windows_user_facing_path(&path.to_string_lossy());
        let key = normalized.to_ascii_lowercase();
        if !normalized.is_empty() && path.is_file() && seen.insert(key) {
            let label = path
                .file_name()
                .map(|n| n.to_string_lossy().into_owned())
                .unwrap_or_else(|| normalized.clone());
            out.push(AppLaunchCandidate {
                target_type: "exe".to_string(),
                label,
                target: normalized,
                source: source.to_string(),
                supports_multi_instance: false,
            });
        }
    };

    if let Some(running) = find_running_exe(legacy) {
        push_path(running, "running");
    }
    for candidate in candidate_install_paths(legacy) {
        push_path(candidate, "standard");
    }
    Ok(out)
}

pub fn is_pid_running(pid: u32) -> bool {
    if pid == 0 {
        return false;
    }
    let mut system = System::new();
    let target = Pid::from_u32(pid);
    system.refresh_processes_specifics(
        ProcessesToUpdate::Some(&[target]),
        true,
        ProcessRefreshKind::nothing(),
    );
    system.process(target).is_some()
}

fn match_pids_for_dir(
    entries: &[(u32, Option<String>, Option<PathBuf>)],
    target_dir: Option<&str>,
    default_dir: Option<&str>,
) -> Vec<u32> {
    let normalized_target = target_dir
        .map(normalize_path_for_compare)
        .filter(|s| !s.is_empty());
    let normalized_default = default_dir
        .map(normalize_path_for_compare)
        .filter(|s| !s.is_empty());
    let allow_none = normalized_target.is_none() || normalized_target == normalized_default;

    entries
        .iter()
        .filter(|(_, dir, _)| match (dir.as_deref(), normalized_target.as_deref()) {
            (None, _) => allow_none,
            (Some(d), Some(t)) => normalize_path_for_compare(d) == t,
            (Some(d), None) => normalized_default
                .as_deref()
                .is_none_or(|def| normalize_path_for_compare(d) == def),
        })
        .map(|(pid, _, _)| *pid)
        .collect()
}

pub fn resolve_antigravity_pid(last_pid: Option<u32>, user_data_dir: Option<&str>) -> Option<u32> {
    let default_dir = crate::modules::instance::get_default_user_data_dir()
        .ok()
        .map(|p| p.to_string_lossy().into_owned());
    let entries = collect_antigravity_entries(false);
    let matches = match_pids_for_dir(&entries, user_data_dir, default_dir.as_deref());
    if let Some(pid) = last_pid {
        if is_pid_running(pid) && matches.contains(&pid) {
            return Some(pid);
        }
    }
    matches.into_iter().next()
}

pub fn resolve_antigravity_legacy_pid(
    last_pid: Option<u32>,
    user_data_dir: Option<&str>,
) -> Option<u32> {
    let default_dir = crate::modules::antigravity_paths::legacy_default_user_data_dir()
        .ok()
        .map(|p| p.to_string_lossy().into_owned());
    let entries = collect_antigravity_entries(true);
    let matches = match_pids_for_dir(&entries, user_data_dir, default_dir.as_deref());
    if let Some(pid) = last_pid {
        if is_pid_running(pid) && matches.contains(&pid) {
            return Some(pid);
        }
    }
    matches.into_iter().next()
}

pub fn focus_antigravity_instance(
    last_pid: Option<u32>,
    user_data_dir: Option<&str>,
) -> Result<u32, String> {
    use windows::Win32::Foundation::{BOOL, HWND, LPARAM};
    use windows::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindowThreadProcessId, IsWindowVisible, SetForegroundWindow, ShowWindow,
        SW_RESTORE,
    };

    let pid = resolve_antigravity_pid(last_pid, user_data_dir)
        .ok_or_else(|| "Antigravity IDE 当前未运行".to_string())?;

    struct Search {
        target_pid: u32,
        found: Option<HWND>,
    }
    unsafe extern "system" fn enum_proc(hwnd: HWND, lparam: LPARAM) -> BOOL {
        let state = &mut *(lparam.0 as *mut Search);
        if IsWindowVisible(hwnd).as_bool() {
            let mut win_pid = 0u32;
            GetWindowThreadProcessId(hwnd, Some(&mut win_pid));
            if win_pid == state.target_pid {
                state.found = Some(hwnd);
                return BOOL(0);
            }
        }
        BOOL(1)
    }

    let mut search = Search {
        target_pid: pid,
        found: None,
    };
    unsafe {
        let _ = EnumWindows(Some(enum_proc), LPARAM((&mut search as *mut Search) as isize));
        if let Some(hwnd) = search.found {
            let _ = ShowWindow(hwnd, SW_RESTORE);
            let _ = SetForegroundWindow(hwnd);
        }
    }
    Ok(pid)
}

fn run_taskkill(pids: &[u32], force: bool) -> Result<(), String> {
    use std::os::windows::process::CommandExt;
    if pids.is_empty() {
        return Ok(());
    }
    let args = windows_operation::taskkill_args(pids, force, force);
    let output = Command::new("taskkill")
        .args(&args)
        .creation_flags(CREATE_NO_WINDOW)
        .stdin(Stdio::null())
        .output()
        .map_err(|e| format!("执行 taskkill 失败: {e}"))?;
    if windows_operation::taskkill_accepted_or_targets_exited(output.status.success(), || {
        pids.iter().any(|pid| is_pid_running(*pid))
    }) {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let reason = if !stderr.is_empty() { stderr } else { stdout };
    Err(if reason.is_empty() {
        format!("taskkill 退出码: {:?}", output.status.code())
    } else {
        reason
    })
}

fn close_matching_processes(
    legacy: bool,
    user_data_dirs: &[String],
    default_dir: Option<&str>,
    timeout_secs: u64,
    mode: AntigravityCloseMode,
) -> Result<(), String> {
    let entries = collect_antigravity_entries(legacy);
    let mut pids = HashSet::new();
    if user_data_dirs.is_empty() {
        for pid in match_pids_for_dir(&entries, None, default_dir) {
            pids.insert(pid);
        }
    } else {
        for dir in user_data_dirs {
            for pid in match_pids_for_dir(&entries, Some(dir), default_dir) {
                pids.insert(pid);
            }
        }
    }
    let target_pids: Vec<u32> = pids.into_iter().collect();
    if target_pids.is_empty() {
        return Ok(());
    }

    logger::log_info(&format!(
        "[Process] 关闭 Antigravity{} 进程: pids={:?}, mode={:?}",
        if legacy { "" } else { " IDE" },
        target_pids,
        mode
    ));

    // 先尝试温和关闭
    let _ = run_taskkill(&target_pids, false);
    let wait_graceful = Instant::now() + Duration::from_secs(timeout_secs.clamp(2, 6));
    while Instant::now() < wait_graceful {
        if target_pids.iter().all(|pid| !is_pid_running(*pid)) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    // 再强制结束进程树
    let still_alive: Vec<u32> = target_pids
        .into_iter()
        .filter(|pid| is_pid_running(*pid))
        .collect();
    if still_alive.is_empty() {
        return Ok(());
    }
    let force_err = run_taskkill(&still_alive, true).err();
    let wait_force = Instant::now() + Duration::from_secs(4);
    while Instant::now() < wait_force {
        if still_alive.iter().all(|pid| !is_pid_running(*pid)) {
            return Ok(());
        }
        std::thread::sleep(Duration::from_millis(200));
    }

    let remaining: Vec<u32> = still_alive
        .into_iter()
        .filter(|pid| is_pid_running(*pid))
        .collect();
    if remaining.is_empty() {
        return Ok(());
    }
    let reason = force_err.unwrap_or_else(|| "进程在超时后仍在运行".to_string());
    Err(windows_operation::format_error(
        "stop_process",
        "无法关闭 Antigravity 进程",
        &reason,
        None,
        &remaining,
        true,
        true,
        true,
    ))
}

pub fn close_antigravity_instances(
    user_data_dirs: &[String],
    timeout_secs: u64,
    mode: AntigravityCloseMode,
) -> Result<(), String> {
    let default_dir = crate::modules::instance::get_default_user_data_dir()
        .ok()
        .map(|p| p.to_string_lossy().into_owned());
    close_matching_processes(false, user_data_dirs, default_dir.as_deref(), timeout_secs, mode)
}

pub fn close_antigravity_legacy_instances(
    user_data_dirs: &[String],
    default_user_data_dir: &str,
    timeout_secs: u64,
    mode: AntigravityCloseMode,
) -> Result<(), String> {
    let default_dir = (!default_user_data_dir.trim().is_empty()).then_some(default_user_data_dir);
    close_matching_processes(true, user_data_dirs, default_dir, timeout_secs, mode)
}

fn spawn_antigravity_exe(
    launch_path: &Path,
    user_data_dir: &str,
    extra_args: &[String],
) -> Result<u32, String> {
    let program_label = launch_path.to_string_lossy().into_owned();
    let _guard = app_lifecycle::acquire_process_spawn_guard(&program_label)
        .map_err(|e| format!("无法启动进程: {e}"))?;
    let mut cmd = Command::new(launch_path);
    if !user_data_dir.trim().is_empty() {
        cmd.arg(format!("--user-data-dir={}", user_data_dir.trim()));
    }
    if !extra_args.is_empty() {
        cmd.args(extra_args);
    }
    cmd.stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    let child = cmd
        .spawn()
        .map_err(|e| format!("启动 {} 失败: {e}", launch_path.display()))?;
    Ok(background_child_pid(child))
}

pub fn start_antigravity() -> Result<u32, String> {
    start_antigravity_with_args("", &[])
}

pub fn start_antigravity_with_args(
    user_data_dir: &str,
    extra_args: &[String],
) -> Result<u32, String> {
    logger::log_info("[Process] 正在启动 Antigravity IDE...");
    let launch_path = resolve_antigravity_launch_path()?;
    spawn_antigravity_exe(&launch_path, user_data_dir, extra_args)
}

pub fn start_antigravity_legacy_with_args(
    user_data_dir: &str,
    extra_args: &[String],
) -> Result<u32, String> {
    logger::log_info("[Process] 正在启动 Antigravity...");
    let launch_path = resolve_antigravity_legacy_launch_path()?;
    spawn_antigravity_exe(&launch_path, user_data_dir, extra_args)
}
