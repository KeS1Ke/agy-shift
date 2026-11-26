use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Duration;

use tauri::AppHandle;

use super::FrontendAccount;
use crate::modules;

#[derive(Debug, Clone)]
struct TerminalLaunchPlan {
    program: String,
    args: Vec<String>,
}

fn powershell_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn build_windows_terminal_launch_plan(
    command: &str,
    terminal: &str,
) -> Result<TerminalLaunchPlan, String> {
    let normalized = terminal.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "cmd" => Ok(TerminalLaunchPlan {
            program: "cmd".to_string(),
            args: vec!["/C".into(), "start".into(), "cmd".into(), "/K".into(), command.into()],
        }),
        "pwsh" => Ok(TerminalLaunchPlan {
            program: "pwsh".to_string(),
            args: vec!["-NoExit".into(), "-Command".into(), command.into()],
        }),
        "wt" => Ok(TerminalLaunchPlan {
            program: "wt".to_string(),
            args: vec![
                "new-tab".into(),
                "powershell".into(),
                "-NoExit".into(),
                "-Command".into(),
                command.into(),
            ],
        }),
        _ => Ok(TerminalLaunchPlan {
            program: "powershell".to_string(),
            args: vec!["-NoExit".into(), "-Command".into(), command.into()],
        }),
    }
}

#[tauri::command]
pub(crate) async fn switch_antigravity_cli(
    app: AppHandle,
    account_id: String,
    working_dir: Option<PathBuf>,
    launch: bool,
    terminal: Option<String>,
    custom_command: Option<String>,
) -> Result<FrontendAccount, String> {
    let permit =
        modules::account::try_begin_antigravity_switch(&modules::account::ANTIGRAVITY_SWITCH_GATE)?;
    let terminal_plan = if launch {
        Some(prepare_terminal(working_dir, terminal, custom_command).await?)
    } else {
        None
    };
    let account = tokio::time::timeout(
        Duration::from_secs(60),
        modules::account::prepare_account_for_injection(&account_id),
    )
    .await
    .map_err(|_| "ANTIGRAVITY_SWITCH_PREPARATION_TIMEOUT".to_string())??;

    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        let (account, _) = modules::antigravity_shared_switch::switch(
            &account,
            modules::antigravity_shared_switch::SwitchTarget::Cli,
            false,
            super::super::system::antigravity_ide_uses_shared_credentials(),
        )?;
        modules::websocket::broadcast_account_switched(&account.id, &account.email);
        modules::websocket::broadcast_data_changed("switch_antigravity_cli");
        let _ = modules::tray::update_tray_menu(&app);
        if let Some(plan) = terminal_plan {
            open_terminal(plan)
                .map_err(|error| format!("ANTIGRAVITY_CLI_SWITCHED_TERMINAL_FAILED: {error}"))?;
        }
        Ok(FrontendAccount::from(account))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn launch_antigravity_cli(
    working_dir: Option<PathBuf>,
    terminal: Option<String>,
    custom_command: Option<String>,
) -> Result<(), String> {
    let plan = prepare_terminal(working_dir, terminal, custom_command).await?;
    tokio::task::spawn_blocking(move || {
        open_terminal(plan)
            .map_err(|error| format!("ANTIGRAVITY_CLI_TERMINAL_FAILED: {error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

async fn prepare_terminal(
    working_dir: Option<PathBuf>,
    terminal: Option<String>,
    custom_command: Option<String>,
) -> Result<TerminalLaunchPlan, String> {
    tokio::task::spawn_blocking(move || {
        let command = resolve_command(working_dir, custom_command)?;
        let terminal =
            terminal.unwrap_or_else(|| modules::config::get_user_config().default_terminal);
        build_windows_terminal_launch_plan(&command, &terminal)
            .map_err(|error| format!("ANTIGRAVITY_CLI_TERMINAL_FAILED: {error}"))
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub(crate) async fn antigravity_cli_launch_command(
    working_dir: Option<PathBuf>,
    custom_command: Option<String>,
) -> Result<String, String> {
    tokio::task::spawn_blocking(move || resolve_command(working_dir, custom_command))
        .await
        .map_err(|error| error.to_string())?
}

fn resolve_command(
    working_dir: Option<PathBuf>,
    custom_command: Option<String>,
) -> Result<String, String> {
    let dir = working_dir
        .or_else(dirs::home_dir)
        .filter(|dir| dir.is_absolute() && dir.is_dir())
        .ok_or("ANTIGRAVITY_CLI_INVALID_DIRECTORY")?;
    let binary = find_cli().ok_or("ANTIGRAVITY_CLI_NOT_FOUND")?;
    Ok(build_command(&binary, &dir, custom_command.as_deref()))
}

pub(crate) fn find_cli() -> Option<PathBuf> {
    let configured = modules::config::get_user_config().antigravity_cli_path;
    if configured.is_empty() {
        return detect_cli();
    }
    let path = PathBuf::from(configured);
    crate::commands::cli_launch_path::executable_file(&path).then_some(path)
}

pub(crate) fn detect_cli() -> Option<PathBuf> {
    let installed =
        std::env::var_os("LOCALAPPDATA").map(|dir| PathBuf::from(dir).join("agy/bin/agy.exe"));
    let path = std::env::var_os("PATH").unwrap_or_default();
    std::env::split_paths(&path)
        .filter(|dir| dir.is_absolute())
        .map(|dir| dir.join("agy.exe"))
        .chain(installed)
        .find(|candidate| candidate.is_file())
}

fn build_command(binary: &Path, dir: &Path, custom_command: Option<&str>) -> String {
    use base64::{engine::general_purpose::STANDARD, Engine};

    let launch = match custom_command.filter(|value| !value.trim().is_empty()) {
        Some(value) => format!(
            "$env:Path = {} + ';' + $env:Path\n{}",
            powershell_quote(&binary.parent().unwrap_or(binary).to_string_lossy()),
            value
        ),
        None => format!("& {}", powershell_quote(&binary.to_string_lossy())),
    };
    let script = format!(
        "Set-Location -LiteralPath {} -ErrorAction Stop\n{}",
        powershell_quote(&dir.to_string_lossy()),
        launch,
    );
    let encoded = STANDARD.encode(
        script
            .encode_utf16()
            .flat_map(u16::to_le_bytes)
            .collect::<Vec<_>>(),
    );
    format!("powershell -NoProfile -EncodedCommand {encoded}")
}

fn open_terminal(plan: TerminalLaunchPlan) -> Result<(), String> {
    let mut command = Command::new(&plan.program);
    command.args(&plan.args);
    let _guard = modules::app_lifecycle::acquire_process_spawn_guard(&plan.program)
        .map_err(|error| error.to_string())?;
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let flags = if matches!(plan.program.as_str(), "powershell" | "pwsh") {
            0x00000010
        } else {
            0x08000000
        };
        command.creation_flags(flags);
    }
    drop(command.spawn().map_err(|error| error.to_string())?);
    Ok(())
}
