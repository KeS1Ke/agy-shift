import { lazy, Suspense, useEffect } from 'react';
import { Settings } from 'lucide-react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { getCurrentWebview } from '@tauri-apps/api/webview';
import * as api from './services/tauri';
import { applyThemeToDom, useAppStore } from './stores/useAppStore';
import { Header } from './components/Header';
import { AccountsView } from './components/AccountsView';
import { ToastStack } from './components/ToastStack';
import { CloseConfirmModal } from './components/CloseConfirmModal';

const AddAccountModal = lazy(() => import('./components/AddAccountModal').then((module) => ({ default: module.AddAccountModal })));
const UpdateDialog = lazy(() => import('./components/UpdateDialog').then((module) => ({ default: module.UpdateDialog })));
const BasicSettingsDialog = lazy(() => import('./components/BasicSettingsDialog').then((module) => ({ default: module.BasicSettingsDialog })));

function handleNavigationTarget(target: unknown): void {
  if (target === 'update') {
    useAppStore.getState().openUpdateModal();
  } else if (target === 'settings') {
    useAppStore.getState().openSettingsModal();
  }
}

export function App() {
  const generalConfig = useAppStore((s) => s.generalConfig);
  const showingAdd = useAppStore((s) => s.addModalOpen);
  const showingUpdate = useAppStore((s) => s.updateModalOpen);
  const showingSettings = useAppStore((s) => s.settingsModalOpen);
  const openSettingsModal = useAppStore((s) => s.openSettingsModal);

  useEffect(() => {
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];

    void useAppStore.getState().bootstrap();
    // 窗口重建时初始隐藏，Chromium 在隐藏窗口下会暂停 requestAnimationFrame，
    // 因此通过同步布局刷新 + 短定时器通知 Rust 显示窗口，避免白屏且不被 rAF 阻塞。
    void document.documentElement.offsetHeight;
    const readyTimer = window.setTimeout(() => {
      if (!cancelled) {
        void api.notifyMainWindowReady().catch(() => {});
      }
    }, 30);
    void api
      .mainWindowTakePendingNavigation()
      .then((target) => {
        if (!cancelled) {
          handleNavigationTarget(target);
        }
      })
      .catch(() => null);

    const setupListeners = async () => {
      try {
        const registered = await Promise.all([
          listen('accounts:changed', () => {
            void useAppStore.getState().reloadAccounts();
          }),
          listen<string>('tray:navigate', (event) => {
            handleNavigationTarget(event.payload);
          }),
          listen<boolean>('window:close_requested', (event) => {
            useAppStore.getState().setCloseConfirm(true, Boolean(event.payload));
          }),
        ]);

        if (cancelled) {
          for (const unlisten of registered) {
            unlisten();
          }
          return;
        }
        unlisteners.push(...registered);
      } catch {
        // Ignore event subscription errors in non-Tauri browser previews.
      }
    };

    void setupListeners();

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleSystemThemeChange = () => {
      applyThemeToDom(useAppStore.getState().theme);
    };
    mediaQuery.addEventListener('change', handleSystemThemeChange);

    return () => {
      cancelled = true;
      window.clearTimeout(readyTimer);
      for (const unlisten of unlisteners) {
        unlisten();
      }
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
    };
  }, []);

  useEffect(() => {
    const scale = generalConfig?.ui_scale;
    if (typeof scale !== 'number' || !Number.isFinite(scale) || scale <= 0) {
      return;
    }
    try {
      void getCurrentWebview()
        .setZoom(scale)
        .catch(() => {});
    } catch {
      // Ignore zoom sync errors outside Tauri WebView.
    }
  }, [generalConfig?.ui_scale]);

  useEffect(() => {
    document.documentElement.classList.toggle(
      'reduced-motion',
      Boolean(generalConfig?.reduced_motion_enabled),
    );
  }, [generalConfig?.reduced_motion_enabled]);

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-[#f3efe8] text-zinc-900 dark:bg-[#19171b] dark:text-zinc-100">
      <Header />
      <main className="min-h-0 flex-1 overflow-hidden">
        <AccountsView />
      </main>
      <Suspense fallback={null}>
        {showingAdd && <AddAccountModal />}
        {showingUpdate && <UpdateDialog />}
        {showingSettings && <BasicSettingsDialog />}
      </Suspense>
      <button
        type="button"
        aria-label="基础设置"
        title="基础设置"
        onClick={() => openSettingsModal()}
        className="fixed bottom-3 right-4 z-20 inline-flex h-8 items-center gap-1.5 rounded-full border border-stone-300/80 bg-[#fffdf9] px-3 text-[12.5px] font-medium text-stone-800 shadow-[0_3px_12px_rgba(62,40,25,0.10)] hover:bg-stone-100 dark:border-[#48414b] dark:bg-[#28242c] dark:text-stone-100 dark:shadow-[0_4px_14px_rgba(0,0,0,0.28)] dark:hover:bg-[#322d37] sm:right-5"
      >
        <Settings className="h-3.5 w-3.5" />
        <span>设置</span>
      </button>
      <CloseConfirmModal />
      <ToastStack />
    </div>
  );
}
