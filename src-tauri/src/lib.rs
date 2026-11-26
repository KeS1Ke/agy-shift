#![recursion_limit = "256"]

mod commands;
pub mod error;
mod models;
mod modules;
mod utils;

use modules::config::{CloseWindowBehavior, MinimizeWindowBehavior};
use modules::logger;
use std::sync::OnceLock;
use tauri::{Emitter, Manager, RunEvent, WindowEvent};
use tracing::info;

static APP_HANDLE: OnceLock<tauri::AppHandle> = OnceLock::new();

pub fn get_app_handle() -> Option<&'static tauri::AppHandle> {
    APP_HANDLE.get()
}

pub(crate) fn apply_tray_visibility(app: &tauri::AppHandle, visible: bool) -> Result<(), String> {
    modules::tray::set_tray_visibility(app, visible)
}

fn apply_startup_minimized(app: &tauri::AppHandle) {
    let config = modules::config::get_user_config();
    if !config.startup_minimized {
        return;
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.minimize();
    }
}

pub fn run() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(2)
        .enable_all()
        .build()
        .expect("error while creating the async runtime");
    tauri::async_runtime::set(runtime.handle().clone());

    logger::init_logger();
    modules::diagnostics::install_panic_hook();
    // 启动时加载一次配置，确保代理环境同步。
    let startup_minimized = modules::config::get_user_config().startup_minimized;

    let mut context = tauri::generate_context!();
    let startup_main_window_state = context
        .config_mut()
        .app
        .windows
        .iter_mut()
        .find(|window| window.label == "main")
        .and_then(|window| {
            modules::window_manager::apply_low_memory_window_config(window);
            if !startup_minimized {
                window.visible = false;
            }
            modules::main_window_state::apply_state_to_window_config(window)
        });

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Err(err) = modules::window_manager::show_main_window(app) {
                logger::log_warn(&format!("[Window] 单实例唤起主窗口失败: {}", err));
            }
        }))
        .setup(move |app| {
            info!("Agy Shift 启动...");
            let _ = APP_HANDLE.set(app.handle().clone());

            if let Err(err) = modules::app_lifecycle::install_system_shutdown_listener() {
                logger::log_warn(&format!("[Lifecycle] 安装系统关机监听失败: {}", err));
            }

            // 后台历史与索引兼容迁移（接管 ~/.cockpit_tools 时零阻塞）
            std::thread::spawn(|| {
                for result in [
                    modules::account::schedule_index_migration(),
                    modules::instance_store::schedule_legacy_registries(),
                ] {
                    if let Err(error) = result {
                        logger::log_warn(&format!("[Migration] 后台迁移失败: {error}"));
                    }
                }
            });

            // 初始化 Updater 与开机自启插件
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            app.handle().plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None::<Vec<&'static str>>,
            ))?;

            // 创建系统托盘
            if modules::config::get_user_config().show_tray_icon {
                if let Err(err) = modules::tray::set_tray_visibility(app.handle(), true) {
                    logger::log_error(&format!("[Tray] 创建托盘失败: {}", err));
                }
            }

            if let Some(main) = app.get_webview_window("main") {
                modules::window_manager::configure_main_webview(&main);
                if let Some(state) = startup_main_window_state {
                    modules::window_manager::restore_placement_for_window(
                        &main,
                        state,
                        !startup_minimized,
                    );
                }
            }
            if startup_minimized {
                apply_startup_minimized(&app.handle());
            } else {
                modules::window_manager::arm_main_window_reveal_on_ready(app.handle());
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                if window.label() != "main" {
                    return;
                }
                modules::main_window_state::capture_and_save_from_window_handle(window);
                let config = modules::config::get_user_config();
                match config.close_behavior {
                    CloseWindowBehavior::Minimize => {
                        api.prevent_close();
                        if let Err(err) = modules::window_manager::minimize_main_window(window) {
                            logger::log_warn(&format!("[Window] 最小化失败: {err}"));
                        }
                    }
                    CloseWindowBehavior::Quit => {
                        modules::window_manager::request_app_exit();
                        window.app_handle().exit(0);
                    }
                    CloseWindowBehavior::Ask => {
                        api.prevent_close();
                        let _ = window.emit("window:close_requested", config.show_tray_icon);
                    }
                }
            }
            WindowEvent::Resized(_)
                if window.label() == "main" && window.is_minimized().unwrap_or(false) =>
            {
                let config = modules::config::get_user_config();
                if config.minimize_behavior == MinimizeWindowBehavior::TrayOnly
                    && window.app_handle().tray_by_id(modules::tray::TRAY_ID).is_some()
                {
                    if let Err(err) = modules::window_manager::minimize_main_window(window) {
                        logger::log_warn(&format!("[Window] 最小化到托盘失败: {err}"));
                    }
                }
            }
            WindowEvent::Resized(_) | WindowEvent::Moved(_) => {
                if window.label() == "main" {
                    modules::main_window_state::capture_and_save_from_window_handle_debounced(
                        window,
                    );
                }
            }
            WindowEvent::Focused(focused) => {
                modules::window_manager::on_main_window_focus_changed(window, *focused);
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            commands::account::list_accounts,
            commands::account::add_account,
            commands::account::delete_account,
            commands::account::get_current_account,
            commands::account::fetch_account_quota,
            commands::account::switch_account,
            commands::account::antigravity_launch_current,
            commands::account::cli_launch::switch_antigravity_cli,
            commands::oauth::prepare_oauth_url,
            commands::oauth::complete_oauth_login,
            commands::oauth::submit_oauth_callback_url,
            commands::oauth::cancel_oauth_login,
            commands::import::import_from_old_tools,
            commands::import::import_from_local,
            commands::import::import_from_json,
            commands::import::import_from_files,
            commands::system::get_general_config,
            commands::system::patch_general_config,
            commands::system::set_app_path,
            commands::cli_launch_path::save_cli_launch_path,
            commands::system::handle_window_close,
            commands::system::main_window_take_pending_navigation,
            commands::system::main_window_ready,
            commands::update::get_update_settings,
            commands::update::patch_update_settings,
            commands::update::update_last_check_time,
            commands::update::relaunch_after_update,
        ])
        .build(context)
        .expect("error while building tauri application");

    app.run(|app_handle, event| match &event {
        RunEvent::WindowEvent {
            label,
            event: WindowEvent::Destroyed,
            ..
        } if label == "main" => {
            modules::window_manager::main_window_destroyed(app_handle);
        }
        RunEvent::ExitRequested { api, .. } => {
            if modules::window_manager::should_keep_alive_after_main_window_destroyed()
                && !modules::app_lifecycle::is_shutdown_started()
            {
                api.prevent_exit();
                logger::log_info("[Window] 主窗口已销毁，应用继续在托盘运行");
            } else if modules::app_lifecycle::begin_shutdown() {
                if let Some(main) = app_handle.get_webview_window("main") {
                    modules::main_window_state::capture_and_save_main_window(&main);
                }
            }
        }
        RunEvent::Exit => {
            let _ = modules::app_lifecycle::begin_shutdown();
        }
        _ => {}
    });
}
