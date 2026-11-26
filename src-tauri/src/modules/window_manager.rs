//! 主窗口生命周期与托盘常驻管理（Windows-only，无悬浮卡片）。
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, Runtime, WebviewWindowBuilder};

use crate::modules::{config, logger, main_window_state, process_memory, tray};

const DARK_WINDOW_BG_RGB: (u8, u8, u8) = (0x19, 0x17, 0x1b);
const LIGHT_WINDOW_BG_RGB: (u8, u8, u8) = (0xf3, 0xef, 0xe8);
const MAIN_WINDOW_READY_FALLBACK_MS: u64 = 1200;

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
static WAITING_FOR_MAIN_WINDOW_READY: AtomicBool = AtomicBool::new(false);
static PENDING_MAXIMIZE_ON_REVEAL: AtomicBool = AtomicBool::new(false);
static MAIN_WINDOW_GENERATION: AtomicUsize = AtomicUsize::new(0);
static PENDING_NAVIGATION: Mutex<Option<String>> = Mutex::new(None);

#[cfg(target_os = "windows")]
fn system_prefers_dark_mode() -> bool {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};

    let mut value: u32 = 0;
    let mut size: u32 = std::mem::size_of::<u32>() as u32;
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize"),
            w!("AppsUseLightTheme"),
            RRF_RT_REG_DWORD,
            None,
            Some((&mut value as *mut u32).cast()),
            Some(&mut size),
        )
    };
    if status.is_ok() {
        value == 0
    } else {
        true
    }
}

#[cfg(not(target_os = "windows"))]
fn system_prefers_dark_mode() -> bool {
    true
}

fn resolve_window_bg_rgb_for_theme(theme: &str, system_dark: bool) -> (u8, u8, u8) {
    let is_dark = match theme.trim().to_ascii_lowercase().as_str() {
        "dark" => true,
        "light" => false,
        _ => system_dark,
    };
    if is_dark {
        DARK_WINDOW_BG_RGB
    } else {
        LIGHT_WINDOW_BG_RGB
    }
}

fn resolve_window_bg_rgb() -> (u8, u8, u8) {
    let theme = config::get_user_config().theme;
    resolve_window_bg_rgb_for_theme(&theme, system_prefers_dark_mode())
}

pub fn apply_low_memory_window_config(config: &mut tauri::utils::config::WindowConfig) {
    config.additional_browser_args = Some(MAIN_WINDOW_BROWSER_ARGS.to_string());
    let (r, g, b) = resolve_window_bg_rgb();
    config.background_color = Some(tauri::utils::config::Color(r, g, b, 255));
}

pub fn configure_main_webview<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    #[cfg(target_os = "windows")]
    {
        let (bg_r, bg_g, bg_b) = resolve_window_bg_rgb();
        let _ = window.with_webview(move |webview| {
            use webview2_com::Microsoft::Web::WebView2::Win32::{
                ICoreWebView2Controller2, ICoreWebView2Settings4, ICoreWebView2Settings5,
                ICoreWebView2Settings6, COREWEBVIEW2_COLOR,
            };
            use windows_core::Interface;

            let controller = webview.controller();
            if let Ok(controller2) = controller.cast::<ICoreWebView2Controller2>() {
                let _ = unsafe {
                    controller2.SetDefaultBackgroundColor(COREWEBVIEW2_COLOR {
                        A: 255,
                        R: bg_r,
                        G: bg_g,
                        B: bg_b,
                    })
                };
            }
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
    WAITING_FOR_MAIN_WINDOW_READY.store(false, Ordering::SeqCst);
    PENDING_MAXIMIZE_ON_REVEAL.store(false, Ordering::SeqCst);
    if window.app_handle().tray_by_id(tray::TRAY_ID).is_none() {
        return window.minimize().map_err(|err| err.to_string());
    }
    KEEP_ALIVE_IN_TRAY.store(true, Ordering::SeqCst);
    if let Err(err) = window.hide() {
        KEEP_ALIVE_IN_TRAY.store(false, Ordering::SeqCst);
        return Err(format!("隐藏主窗口失败：{err}"));
    }
    #[cfg(target_os = "windows")]
    if let Some(main) = window.app_handle().get_webview_window("main") {
        set_webview_memory_usage_low(&main, true);
    }
    release_tray_memory();
    Ok(())
}

fn release_tray_memory() {
    crate::utils::http::clear_cached_clients();
    process_memory::trim_idle_process_memory();
}

/// 窗口先隐藏创建，待前端完成首帧绘制后通过 `main_window_ready` 显示（附带超时兜底防止永久不可见）。
pub fn arm_main_window_reveal_on_ready<R: Runtime>(app: &AppHandle<R>) {
    KEEP_ALIVE_IN_TRAY.store(false, Ordering::SeqCst);
    WAITING_FOR_MAIN_WINDOW_READY.store(true, Ordering::SeqCst);
    let generation = MAIN_WINDOW_GENERATION.load(Ordering::Acquire);
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(std::time::Duration::from_millis(
            MAIN_WINDOW_READY_FALLBACK_MS,
        ))
        .await;
        if MAIN_WINDOW_GENERATION.load(Ordering::Acquire) != generation {
            return;
        }
        if WAITING_FOR_MAIN_WINDOW_READY.load(Ordering::SeqCst) {
            let _ = mark_main_window_ready(&app_handle);
        }
    });
}

pub fn mark_main_window_ready<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    if !WAITING_FOR_MAIN_WINDOW_READY.swap(false, Ordering::SeqCst) {
        return Ok(());
    }
    let app_handle = app.clone();
    app.run_on_main_thread(move || {
        if DESTROYING_MAIN_WINDOW.load(Ordering::SeqCst) {
            return;
        }
        if let Some(window) = app_handle.get_webview_window("main") {
            show_existing_window(&window);
        }
    })
    .map_err(|err| err.to_string())
}

/// 恢复主窗口位置；当窗口处于隐藏等待首帧渲染阶段时推迟 `maximize()`，避免 Windows 上提前显现空白窗口。
pub fn restore_placement_for_window<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    mut state: main_window_state::MainWindowState,
    defer_maximize: bool,
) {
    if defer_maximize && state.maximized {
        PENDING_MAXIMIZE_ON_REVEAL.store(true, Ordering::SeqCst);
        state.maximized = false;
    } else {
        PENDING_MAXIMIZE_ON_REVEAL.store(false, Ordering::SeqCst);
    }
    main_window_state::restore_saved_placement(window, state);
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
    // 重建时先隐藏窗口，等 WebView2 首帧渲染完成后再显现，避免从托盘打开时白屏闪烁。
    config.visible = false;
    let restored = main_window_state::apply_state_to_window_config(&mut config);
    let window = WebviewWindowBuilder::from_config(app, &config)
        .map_err(|err| err.to_string())?
        .build()
        .map_err(|err| err.to_string())?;
    configure_main_webview(&window);
    if let Some(state) = restored {
        restore_placement_for_window(&window, state, true);
    }
    arm_main_window_reveal_on_ready(app);
    Ok(())
}

fn show_existing_window<R: Runtime>(window: &tauri::WebviewWindow<R>) {
    KEEP_ALIVE_IN_TRAY.store(false, Ordering::SeqCst);
    #[cfg(target_os = "windows")]
    set_webview_memory_usage_low(window, false);
    if PENDING_MAXIMIZE_ON_REVEAL.swap(false, Ordering::SeqCst) {
        let _ = window.show();
        let _ = window.maximize();
    } else if window.is_minimized().unwrap_or(false) {
        let _ = window.unminimize();
        let _ = window.show();
    } else {
        let _ = window.show();
    }
    let _ = window.set_focus();
}

pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let app_handle = app.clone();
    app.run_on_main_thread(move || {
        if DESTROYING_MAIN_WINDOW.load(Ordering::SeqCst) {
            PENDING_REOPEN_AFTER_DESTROY.store(true, Ordering::SeqCst);
        } else if let Some(window) = app_handle.get_webview_window("main") {
            if !WAITING_FOR_MAIN_WINDOW_READY.load(Ordering::SeqCst) {
                show_existing_window(&window);
            }
        } else if let Err(err) = recreate_main_window(&app_handle) {
            logger::log_warn(&format!("[Window] 重建主窗口失败: {}", err));
        }
    })
    .map_err(|err| err.to_string())
}

pub fn main_window_destroyed<R: Runtime>(app: &AppHandle<R>) {
    WAITING_FOR_MAIN_WINDOW_READY.store(false, Ordering::SeqCst);
    PENDING_MAXIMIZE_ON_REVEAL.store(false, Ordering::SeqCst);
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
        assert!(cfg.background_color.is_some());
    }

    #[test]
    fn window_background_rgb_matches_selected_or_system_theme() {
        assert_eq!(resolve_window_bg_rgb_for_theme("dark", false), DARK_WINDOW_BG_RGB);
        assert_eq!(resolve_window_bg_rgb_for_theme("light", true), LIGHT_WINDOW_BG_RGB);
        assert_eq!(resolve_window_bg_rgb_for_theme("system", true), DARK_WINDOW_BG_RGB);
        assert_eq!(resolve_window_bg_rgb_for_theme("system", false), LIGHT_WINDOW_BG_RGB);
    }
}
