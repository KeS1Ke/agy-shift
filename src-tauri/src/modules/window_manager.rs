//! 主窗口生命周期与托盘常驻管理（Windows-only，无悬浮卡片）。
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindowBuilder};

use crate::modules::{account, logger, main_window_state, process_memory, tray};

/// WebView2 低内存启动参数（必须保证首次启动与托盘重建使用完全一致的参数，满足同一数据目录约束）。
pub const MAIN_WINDOW_BROWSER_ARGS: &str = concat!(
    "--disable-gpu ",
    "--disable-gpu-compositing ",
    "--in-process-gpu ",
    "--disable-extensions ",
    "--disable-background-networking ",
    "--disable-component-update ",
    "--disable-sync ",
    "--disable-default-apps ",
    "--disable-domain-reliability ",
    "--disable-speech-api ",
    "--disable-translate ",
    "--no-pings ",
    "--renderer-process-limit=1 ",
    "--disk-cache-size=1 ",
    "--media-cache-size=1 ",
    "--js-flags=--optimize-for-size ",
    "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,",
    "OptimizationHints,MediaRouter,DialMediaRouteProvider,",
    "InterestFeedContentSuggestions,Translate,BackForwardCache,",
    "AcceptCHFrame,HeavyAdPrivacyMitigations,AutofillServerCommunication,",
    "CertificateTransparencyComponentUpdater,PaintHolding,Prerender2,",
    "msEdgeCollections,msEdgeSidebarV2,msEdgeDiscover,msEdgeShopping,msEdgeHistorySearch"
);

static APP_EXIT_REQUESTED: AtomicBool = AtomicBool::new(false);
static KEEP_ALIVE_IN_TRAY: AtomicBool = AtomicBool::new(false);
static DESTROYING_MAIN_WINDOW: AtomicBool = AtomicBool::new(false);
static PENDING_REOPEN_AFTER_DESTROY: AtomicBool = AtomicBool::new(false);
static MAIN_WINDOW_GENERATION: AtomicUsize = AtomicUsize::new(0);
static PENDING_NAVIGATION: Mutex<Option<String>> = Mutex::new(None);

pub fn apply_low_memory_window_config(config: &mut tauri::utils::config::WindowConfig) {
    config.additional_browser_args = Some(MAIN_WINDOW_BROWSER_ARGS.to_string());
}

pub fn configure_main_webview<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "windows")]
    {
        let _ = window.with_webview(|webview| {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2Settings4, ICoreWebView2Settings5, ICoreWebView2Settings6,
            };
            use windows_core::Interface;

            let controller = webview.controller();
            if let Ok(core) = unsafe { controller.CoreWebView2() } {
                if let Ok(settings) = unsafe { core.Settings() } {
                    unsafe {
                        let _ = settings.SetIsStatusBarEnabled(false);
                        let _ = settings.SetIsBuiltInErrorPageEnabled(false);
                    }
                    #[cfg(not(debug_assertions))]
                    {
                        use webview2_com::Microsoft::Web::WebView2::Win32::ICoreWebView2Settings3;
                        if let Ok(settings3) = settings.cast::<ICoreWebView2Settings3>() {
                            let _ = unsafe { settings3.SetAreBrowserAcceleratorKeysEnabled(false) };
                        }
                    }
                    if let Ok(settings4) = settings.cast::<ICoreWebView2Settings4>() {
                        unsafe {
                            let _ = settings4.SetIsGeneralAutofillEnabled(false);
                            let _ = settings4.SetIsPasswordAutosaveEnabled(false);
                        }
                    }
                    if let Ok(settings5) = settings.cast::<ICoreWebView2Settings5>() {
                        let _ = unsafe { settings5.SetIsPinchZoomEnabled(false) };
                    }
                    if let Ok(settings6) = settings.cast::<ICoreWebView2Settings6>() {
                        let _ = unsafe { settings6.SetIsSwipeNavigationEnabled(false) };
                    }
                }
            }
        });

        let generation = MAIN_WINDOW_GENERATION
            .fetch_add(1, Ordering::AcqRel)
            .wrapping_add(1);
        let app = window.app_handle().clone();
        tauri::async_runtime::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_secs(4)).await;
            if MAIN_WINDOW_GENERATION.load(Ordering::Acquire) != generation {
                return;
            }
            if let Some(main) = app.get_webview_window("main") {
                set_webview_memory_usage_low(&main, true);
            }
        });
    }
    #[cfg(not(target_os = "windows"))]
    let _ = window;
}

#[cfg(target_os = "windows")]
fn set_webview_memory_usage_low<R: Runtime>(window: &tauri::WebviewWindow<R>, low: bool) {
    let _ = window.with_webview(move |webview| {
        use webview2_com::Microsoft::Web::WebView2::Win32::{
            ICoreWebView2_19, COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW,
            COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL,
        };
        use windows_core::Interface;

        let controller = webview.controller();
        if let Ok(core) = unsafe { controller.CoreWebView2() } {
            if let Ok(wv19) = core.cast::<ICoreWebView2_19>() {
                let level = if low {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_LOW
                } else {
                    COREWEBVIEW2_MEMORY_USAGE_TARGET_LEVEL_NORMAL
                };
                let _ = unsafe { wv19.SetMemoryUsageTargetLevel(level) };
            }
        }
    });
}

pub fn on_main_window_focus_changed<R: Runtime>(window: &tauri::Window<R>, focused: bool) {
    if window.label() != "main" {
        return;
    }
    #[cfg(target_os = "windows")]
    if !focused {
        if let Some(main) = window.app_handle().get_webview_window("main") {
            set_webview_memory_usage_low(&main, true);
        }
    }
    #[cfg(not(target_os = "windows"))]
    let _ = focused;
}

pub fn request_app_exit() {
    APP_EXIT_REQUESTED.store(true, Ordering::SeqCst);
    KEEP_ALIVE_IN_TRAY.store(false, Ordering::SeqCst);
}

pub fn should_keep_alive_after_main_window_destroyed() -> bool {
    KEEP_ALIVE_IN_TRAY.load(Ordering::SeqCst) && !APP_EXIT_REQUESTED.load(Ordering::SeqCst)
}

pub fn take_pending_main_window_navigation() -> Result<Option<String>, String> {
    let mut pending = PENDING_NAVIGATION
        .lock()
        .map_err(|_| "导航状态锁已损坏".to_string())?;
    Ok(pending.take())
}

fn set_pending_navigation(page: Option<String>) {
    if let Ok(mut pending) = PENDING_NAVIGATION.lock() {
        *pending = page;
    }
}

pub fn minimize_main_window<R: Runtime>(window: &tauri::Window<R>) -> Result<(), String> {
    if window.app_handle().tray_by_id(tray::TRAY_ID).is_none() {
        return window.minimize().map_err(|err| err.to_string());
    }
    if DESTROYING_MAIN_WINDOW.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    KEEP_ALIVE_IN_TRAY.store(true, Ordering::SeqCst);
    if let Err(err) = window.destroy() {
        DESTROYING_MAIN_WINDOW.store(false, Ordering::SeqCst);
        if let Err(hide_error) = window.hide() {
            KEEP_ALIVE_IN_TRAY.store(false, Ordering::SeqCst);
            return Err(format!("释放主窗口失败：{err}；隐藏主窗口失败：{hide_error}"));
        }
        logger::log_warn(&format!("[Window] 释放主窗口失败，已隐藏: {err}"));
        release_tray_memory();
    }
    Ok(())
}

fn release_tray_memory() {
    account::invalidate_list_accounts_cache();
    crate::utils::http::clear_cached_clients();
    process_memory::trim_idle_process_memory();
}

fn recreate_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main")
        .cloned()
        .ok_or_else(|| "未找到主窗口配置".to_string())?;
    apply_low_memory_window_config(&mut config);
    let restored = main_window_state::apply_state_to_window_config(&mut config);
    let window = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|err| err.to_string())?
        .build()
        .map_err(|err| err.to_string())?;
    configure_main_webview(&window);
    if let Some(state) = restored {
        main_window_state::restore_saved_placement(&window, state);
    }
    show_existing_window(&window);
    Ok(())
}

fn show_existing_window<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    KEEP_ALIVE_IN_TRAY.store(false, Ordering::SeqCst);
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let app_handle = app.clone();
    app.run_on_main_thread(move || {
        if DESTROYING_MAIN_WINDOW.load(Ordering::SeqCst) {
            PENDING_REOPEN_AFTER_DESTROY.store(true, Ordering::SeqCst);
        } else if let Some(window) = app_handle.get_webview_window("main") {
            show_existing_window(&window);
        } else if let Err(err) = recreate_main_window(&app_handle) {
            logger::log_warn(&format!("[Window] 重建主窗口失败: {}", err));
        }
    })
    .map_err(|err| err.to_string())
}

pub fn main_window_destroyed<R: Runtime>(app: &AppHandle<R>) {
    MAIN_WINDOW_GENERATION.fetch_add(1, Ordering::AcqRel);
    if DESTROYING_MAIN_WINDOW.swap(false, Ordering::SeqCst)
        && should_keep_alive_after_main_window_destroyed()
    {
        release_tray_memory();
    }
    if PENDING_REOPEN_AFTER_DESTROY.swap(false, Ordering::SeqCst)
        && !APP_EXIT_REQUESTED.load(Ordering::SeqCst)
    {
        let _ = show_main_window(app);
    }
}

pub fn show_main_window_and_navigate<R: Runtime>(
    app: &AppHandle<R>,
    page: &str,
) -> Result<(), String> {
    let target = page.trim().to_string();
    if let Some(window) = app
        .get_webview_window("main")
        .filter(|_| !DESTROYING_MAIN_WINDOW.load(Ordering::SeqCst))
    {
        show_existing_window(&window);
        if !target.is_empty() {
            let _ = window.emit("tray:navigate", target);
        }
        return Ok(());
    }
    if !target.is_empty() {
        set_pending_navigation(Some(target));
    }
    show_main_window(app)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn low_memory_window_config_preserves_wry_defaults_and_disables_gpu_process() {
        let mut cfg = tauri::utils::config::WindowConfig::default();
        apply_low_memory_window_config(&mut cfg);
        let args = cfg.additional_browser_args.expect("browser args should be set");
        assert!(args.contains("--disable-gpu"));
        assert!(args.contains("--disable-gpu-compositing"));
        assert!(args.contains("--in-process-gpu"));
        assert!(args.contains("msWebOOUI,msPdfOOUI,msSmartScreenProtection"));
        assert!(args.contains("--js-flags=--optimize-for-size"));
    }
}
