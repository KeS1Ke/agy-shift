//! 系统托盘模块（Windows-only，极简静态菜单：仅保留打开应用与退出应用）。
use tauri::menu::{Menu, MenuItem};
use tauri::{
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    Runtime,
};
use tracing::info;

use crate::modules::{logger, window_manager};

pub const TRAY_ID: &str = "main-tray";

pub mod menu_ids {
    pub const SHOW_WINDOW: &str = "show_window";
    pub const QUIT: &str = "quit";
}

const TRAY_MENU_ITEMS: [(&str, &str); 2] = [
    (menu_ids::SHOW_WINDOW, "打开应用"),
    (menu_ids::QUIT, "退出应用"),
];

const TRAY_ICON_32_PNG: &[u8] = include_bytes!("../../icons/32x32.png");

pub(crate) fn set_tray_visibility<R: Runtime>(
    app: &tauri::AppHandle<R>,
    visible: bool,
) -> Result<(), String> {
    if let Some(tray) = app.tray_by_id(TRAY_ID) {
        tray.set_visible(visible).map_err(|err| err.to_string())?;
    } else if visible {
        create_tray(app).map_err(|err| err.to_string())?;
    }
    Ok(())
}

fn create_tray<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<TrayIcon<R>, tauri::Error> {
    info!("[Tray] 创建 Agy Shift 系统托盘...");
    let menu = Menu::with_id(app, "tray_menu")?;
    for (id, label) in TRAY_MENU_ITEMS {
        let item = MenuItem::with_id(app, id, label, true, None::<&str>)?;
        menu.append(&item)?;
    }

    let tray_icon = tauri::image::Image::from_bytes(TRAY_ICON_32_PNG)
        .unwrap_or_else(|_| app.default_window_icon().unwrap().clone());
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(tray_icon)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("Agy Shift")
        .on_menu_event(handle_menu_event)
        .on_tray_icon_event(handle_tray_event)
        .build(app)
}

/// 静态托盘菜单无需按账号变化动态重建，保留无操作入口兼容既有调用方。
pub fn update_tray_menu<R: Runtime>(_app: &tauri::AppHandle<R>) -> Result<(), String> {
    Ok(())
}

fn handle_tray_event<R: Runtime>(tray: &TrayIcon<R>, event: TrayIconEvent) {
    let should_open = matches!(
        event,
        TrayIconEvent::Click {
            button: MouseButton::Left,
            button_state: MouseButtonState::Up,
            ..
        } | TrayIconEvent::DoubleClick {
            button: MouseButton::Left,
            ..
        }
    );
    if should_open {
        if let Err(err) = window_manager::show_main_window(tray.app_handle()) {
            logger::log_warn(&format!("[Tray] 恢复主窗口失败: {}", err));
        }
    }
}

fn handle_menu_event<R: Runtime>(app: &tauri::AppHandle<R>, event: tauri::menu::MenuEvent) {
    match event.id().as_ref() {
        menu_ids::SHOW_WINDOW => {
            if let Err(err) = window_manager::show_main_window(app) {
                logger::log_warn(&format!("[Tray] 菜单恢复主窗口失败: {}", err));
            }
        }
        menu_ids::QUIT => {
            window_manager::request_app_exit();
            app.exit(0);
        }
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tray_menu_contains_only_open_and_quit_items() {
        assert_eq!(
            TRAY_MENU_ITEMS,
            [
                (menu_ids::SHOW_WINDOW, "打开应用"),
                (menu_ids::QUIT, "退出应用"),
            ]
        );
    }
}
