import { useEffect, useRef, useState } from 'react';
import { Monitor, Moon, Sun, X } from 'lucide-react';
import * as api from '../services/tauri';
import { useAppStore } from '../stores/useAppStore';
import type { AntigravityClientTarget, CloseWindowBehavior, ThemeMode } from '../types';

const CLOSE_BEHAVIOR_OPTIONS: { value: CloseWindowBehavior; label: string }[] = [
  { value: 'minimize', label: '最小化到托盘' },
  { value: 'quit', label: '完全退出' },
  { value: 'ask', label: '每次询问' },
];

const THEME_OPTIONS: { value: ThemeMode; label: string; icon: typeof Monitor }[] = [
  { value: 'system', label: '跟随系统', icon: Monitor },
  { value: 'light', label: '浅色', icon: Sun },
  { value: 'dark', label: '深色', icon: Moon },
];

const UI_SCALE_OPTIONS = [
  { value: 0.85, label: '85%' },
  { value: 0.9, label: '90%' },
  { value: 1, label: '100%' },
  { value: 1.1, label: '110%' },
  { value: 1.25, label: '125%' },
];

const LAUNCH_TARGETS = {
  antigravity: {
    label: 'Antigravity 桌面端',
    configKey: 'antigravity_legacy_app_path',
    save: (path: string) => api.setAppPath('antigravity_legacy', path),
  },
  antigravity_ide: {
    label: 'Antigravity IDE',
    configKey: 'antigravity_app_path',
    save: (path: string) => api.setAppPath('antigravity', path),
  },
  cli: {
    label: 'Antigravity CLI (agy)',
    configKey: 'antigravity_cli_path',
    save: (path: string) => api.saveCliLaunchPath('antigravity_cli', path),
  },
} as const;

export function BasicSettingsDialog() {
  const close = useAppStore((s) => s.closeSettingsModal);
  const generalConfig = useAppStore((s) => s.generalConfig);
  const updateSettings = useAppStore((s) => s.updateSettings);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const patchUpdateSettings = useAppStore((s) => s.patchUpdateSettings);
  const dialog = useRef<HTMLDialogElement>(null);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [launchTarget, setLaunchTarget] = useState(() => useAppStore.getState().clientTarget);
  const [pathDraft, setPathDraft] = useState<string | null>(null);
  const [pathFeedback, setPathFeedback] = useState<{ message: string; error: boolean } | null>(null);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    let disposed = false;
    void api
      .getGeneralConfig()
      .then((fresh) => {
        if (!disposed) {
          useAppStore.setState({ generalConfig: fresh });
        }
      })
      .catch(() => {});
    void api
      .getUpdateSettings()
      .then((fresh) => {
        if (!disposed) {
          useAppStore.setState({ updateSettings: fresh });
        }
      })
      .catch(() => {});
    return () => {
      disposed = true;
      element?.close();
    };
  }, []);

  const closeBehavior: CloseWindowBehavior =
    generalConfig?.close_behavior === 'quit' || generalConfig?.close_behavior === 'ask'
      ? generalConfig.close_behavior
      : 'minimize';
  const showTrayIcon = generalConfig?.show_tray_icon ?? true;
  const autoLaunch = generalConfig?.app_auto_launch_enabled ?? false;
  const startupMinimized = generalConfig?.startup_minimized ?? false;
  const rememberWindowState = generalConfig?.remember_main_window_state ?? false;
  const autoCheckUpdate = updateSettings?.auto_check ?? true;
  const autoDownloadUpdate = autoCheckUpdate && Boolean(updateSettings?.auto_install);
  const uiScale = generalConfig?.ui_scale ?? 1;
  const target = LAUNCH_TARGETS[launchTarget];
  const savedPath = generalConfig?.[target.configKey] ?? '';
  const path = pathDraft ?? savedPath;
  const pathControlsDisabled = savingKey !== null || !generalConfig;

  const patchField = async (
    key: string,
    patch: Parameters<typeof updateConfig>[0],
  ) => {
    if (savingKey) return;
    setSavingKey(key);
    try {
      await updateConfig(patch);
    } catch {
      // Toast already surfaced by store.updateConfig
    } finally {
      setSavingKey(null);
    }
  };

  const patchUpdateField = async (
    key: string,
    patch: Parameters<typeof patchUpdateSettings>[0],
  ) => {
    if (savingKey) return;
    setSavingKey(key);
    try {
      await patchUpdateSettings(patch);
    } catch {
      // Toast already surfaced by store.patchUpdateSettings
    } finally {
      setSavingKey(null);
    }
  };

  const changeLaunchPath = async (action: 'save' | 'browse' | 'reset') => {
    if (pathControlsDisabled) return;
    setSavingKey('launch_path');
    setPathFeedback(null);
    try {
      let nextPath = action === 'reset' ? '' : path.trim();
      if (action === 'browse') {
        const { open } = await import('@tauri-apps/plugin-dialog');
        const selected = await open({
          title: `选择 ${target.label} 可执行文件`,
          filters: [{ name: '可执行文件', extensions: launchTarget === 'cli' ? ['exe', 'cmd', 'bat', 'com'] : ['exe'] }],
        });
        if (!selected) return;
        nextPath = selected;
        setPathDraft(selected);
      }
      if (nextPath && launchTarget !== 'cli' && !/\.exe"?$/i.test(nextPath)) {
        setPathFeedback({ message: '请选择或填写 Windows .exe 文件的完整路径。', error: true });
        return;
      }
      await target.save(nextPath);
      const fresh = await api.getGeneralConfig();
      useAppStore.setState(({ generalConfig: current }) => ({
        generalConfig: current ? { ...current, [target.configKey]: fresh[target.configKey] } : fresh,
      }));
      setPathDraft(null);
      setPathFeedback({ message: nextPath ? '启动路径已保存。' : '已恢复自动探测。', error: false });
    } catch (error) {
      const detail = String(error);
      setPathFeedback({
        message: /^(APP|CLI)_PATH_NOT_FOUND:/.test(detail)
          ? '找不到可执行文件，请检查路径。'
          : `设置启动路径失败：${detail}`,
        error: true,
      });
    } finally {
      setSavingKey(null);
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="basic-settings-title"
      onCancel={(event) => {
        event.preventDefault();
        close();
      }}
      onClick={(event) => {
        if (event.target === dialog.current) close();
      }}
      className="w-[min(420px,calc(100%-32px))] rounded-xl border border-stone-200 bg-[#fffdf9] p-0 text-stone-900 shadow-xl backdrop:bg-black/50 dark:border-[#48414b] dark:bg-[#231f26] dark:text-stone-100"
    >
      <div className="flex items-center justify-between border-b border-stone-200 px-5 py-3.5 dark:border-[#3c373f]">
        <h2 id="basic-settings-title" className="text-[15px] font-semibold leading-none">
          基础设置
        </h2>
        <button
          type="button"
          aria-label="关闭设置"
          onClick={close}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-stone-500 hover:bg-stone-200/70 hover:text-stone-800 dark:text-stone-400 dark:hover:bg-white/10 dark:hover:text-stone-100"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="max-h-[min(72vh,520px)] space-y-4 overflow-y-auto px-5 py-4 text-xs">
        <section className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <label htmlFor="launch-path-input" className="text-[13px] font-medium">客户端启动路径</label>
            <select
              aria-label="选择客户端"
              value={launchTarget}
              disabled={pathControlsDisabled}
              onChange={(event) => {
                setLaunchTarget(event.target.value as AntigravityClientTarget);
                setPathDraft(null);
                setPathFeedback(null);
              }}
              className="h-7 rounded-md border border-stone-200 bg-[#fffdf9] px-2 dark:border-[#48414b] dark:bg-[#28242c]"
            >
              {Object.entries(LAUNCH_TARGETS).map(([key, item]) => (
                <option key={key} value={key}>{item.label}</option>
              ))}
            </select>
          </div>
          <form
            className="flex gap-1.5"
            onSubmit={(event) => {
              event.preventDefault();
              if (path.trim() !== savedPath) void changeLaunchPath('save');
            }}
          >
            <input
              id="launch-path-input"
              type="text"
              value={path}
              placeholder="自动探测"
              spellCheck={false}
              disabled={pathControlsDisabled}
              onChange={(event) => {
                setPathDraft(event.target.value);
                setPathFeedback(null);
              }}
              className="h-8 min-w-0 flex-1 rounded-md border border-stone-200 bg-[#fffdf9] px-2 outline-none focus:border-[#9b3c2a] dark:border-[#48414b] dark:bg-[#1d1a20] dark:focus:border-[#b94f39]"
            />
            <button type="button" className={PATH_BUTTON_STYLE} disabled={pathControlsDisabled} onClick={() => void changeLaunchPath('browse')}>
              浏览…
            </button>
            <button type="submit" className={PATH_BUTTON_STYLE} disabled={pathControlsDisabled || path.trim() === savedPath}>
              保存
            </button>
          </form>
          <div className="flex min-h-6 items-start justify-between gap-2">
            <p role="status" className={pathFeedback?.error ? 'text-red-700 dark:text-red-300' : 'text-stone-500 dark:text-stone-400'}>
              {pathFeedback?.message ?? (savingKey === 'launch_path' ? '正在设置启动路径…' : '用于客户端的「切号并启动」。')}
            </p>
            {savedPath && (
              <button type="button" className={`${PATH_BUTTON_STYLE} h-6`} disabled={pathControlsDisabled} onClick={() => void changeLaunchPath('reset')}>
                恢复自动探测
              </button>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <div>
            <div className="text-[13px] font-medium text-stone-900 dark:text-stone-100">关闭主窗口时</div>
            <p className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">
              {showTrayIcon
                ? '最小化到托盘会隐藏主窗口并进入低内存模式，点击托盘可秒开。'
                : '当前已关闭系统托盘图标，选择最小化将仅最小化到任务栏。'}
            </p>
          </div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-stone-200 bg-[#f3efe8] p-1 dark:border-[#3c373f] dark:bg-[#19171b]">
            {CLOSE_BEHAVIOR_OPTIONS.map((option) => {
              const active = closeBehavior === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  disabled={savingKey !== null}
                  onClick={() => void patchField('close_behavior', { close_behavior: option.value })}
                  className={
                    'rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50 ' +
                    (active
                      ? 'bg-[#9b3c2a] text-white shadow-sm dark:bg-[#b94f39]'
                      : 'text-stone-700 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-white/10')
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>

        <section className="divide-y divide-stone-200 rounded-lg border border-stone-200 bg-[#faf7f2] px-3 dark:divide-[#3c373f] dark:border-[#3c373f] dark:bg-[#1d1a20]">
          <SettingToggleRow
            label="显示系统托盘图标"
            description="支持关闭主窗口后托盘常驻并快速重新打开"
            checked={showTrayIcon}
            disabled={savingKey !== null}
            onChange={(checked) => void patchField('show_tray_icon', { show_tray_icon: checked })}
          />
          <SettingToggleRow
            label="开机自启动"
            description="登录 Windows 时自动启动 Agy Shift"
            checked={autoLaunch}
            disabled={savingKey !== null}
            onChange={(checked) =>
              void patchField('app_auto_launch_enabled', { app_auto_launch_enabled: checked })
            }
          />
          <SettingToggleRow
            label="启动后最小化"
            description="启动时自动最小化窗口"
            checked={startupMinimized}
            disabled={savingKey !== null}
            onChange={(checked) =>
              void patchField('startup_minimized', { startup_minimized: checked })
            }
          />
          <SettingToggleRow
            label="记住窗口大小与位置"
            description="重新打开窗口时恢复上次尺寸和位置"
            checked={rememberWindowState}
            disabled={savingKey !== null}
            onChange={(checked) =>
              void patchField('remember_main_window_state', {
                remember_main_window_state: checked,
              })
            }
          />
          <SettingToggleRow
            label="自动检测更新"
            description="启动时自动检查新版本，有更新时在右下角显示提示"
            checked={autoCheckUpdate}
            disabled={savingKey !== null}
            onChange={(checked) =>
              void patchUpdateField('auto_check_update', {
                autoCheck: checked,
                ...(checked ? {} : { autoInstall: false }),
              })
            }
          />
          <SettingToggleRow
            label="自动下载更新包"
            description="发现新版本后自动在后台下载，就绪后点击右下角提示即可安装"
            checked={autoDownloadUpdate}
            disabled={savingKey !== null}
            onChange={(checked) =>
              void patchUpdateField('auto_download_update', {
                autoCheck: checked ? true : autoCheckUpdate,
                autoInstall: checked,
              })
            }
          />
        </section>

        <section className="space-y-2">
          <div className="text-[13px] font-medium text-stone-900 dark:text-stone-100">外观主题</div>
          <div className="grid grid-cols-3 gap-1 rounded-lg border border-stone-200 bg-[#f3efe8] p-1 dark:border-[#3c373f] dark:bg-[#19171b]">
            {THEME_OPTIONS.map((option) => {
              const Icon = option.icon;
              const active = theme === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => void setTheme(option.value)}
                  className={
                    'inline-flex items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-[12px] font-medium transition-colors ' +
                    (active
                      ? 'bg-[#fffdf9] text-stone-900 shadow-sm dark:bg-[#302b32] dark:text-stone-50'
                      : 'text-stone-600 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-white/10')
                  }
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{option.label}</span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="space-y-2">
          <div className="text-[13px] font-medium text-stone-900 dark:text-stone-100">界面缩放</div>
          <div className="grid grid-cols-5 gap-1 rounded-lg border border-stone-200 bg-[#f3efe8] p-1 dark:border-[#3c373f] dark:bg-[#19171b]">
            {UI_SCALE_OPTIONS.map((option) => {
              const active = Math.abs(uiScale - option.value) < 0.01;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  disabled={savingKey !== null}
                  onClick={() => void patchField('ui_scale', { ui_scale: option.value })}
                  className={
                    'rounded-md py-1.5 text-[11.5px] font-medium tabular-nums transition-colors disabled:opacity-50 ' +
                    (active
                      ? 'bg-[#fffdf9] text-stone-900 shadow-sm dark:bg-[#302b32] dark:text-stone-50'
                      : 'text-stone-600 hover:bg-stone-200/70 dark:text-stone-300 dark:hover:bg-white/10')
                  }
                >
                  {option.label}
                </button>
              );
            })}
          </div>
        </section>
      </div>

      <div className="flex justify-end border-t border-stone-200 px-5 py-3 dark:border-[#3c373f]">
        <button
          type="button"
          onClick={close}
          className="rounded-md bg-stone-200/80 px-3.5 py-1.5 text-xs font-medium text-stone-800 hover:bg-stone-300/80 dark:bg-white/10 dark:text-stone-100 dark:hover:bg-white/15"
        >
          完成
        </button>
      </div>
    </dialog>
  );
}

const PATH_BUTTON_STYLE = 'shrink-0 rounded-md border border-stone-200 bg-[#faf7f2] px-2 hover:bg-stone-200/70 disabled:opacity-50 dark:border-[#48414b] dark:bg-[#28242c] dark:hover:bg-white/10';

function SettingToggleRow({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 py-2.5 select-none">
      <div className="min-w-0">
        <div className="text-[12.5px] font-medium text-stone-900 dark:text-stone-100">{label}</div>
        <div className="mt-0.5 text-[11px] text-stone-500 dark:text-stone-400">{description}</div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => onChange(!checked)}
        className={
          'relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors disabled:opacity-50 ' +
          (checked ? 'bg-[#9b3c2a] dark:bg-[#b94f39]' : 'bg-stone-300 dark:bg-[#48414b]')
        }
      >
        <span
          className={
            'inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ' +
            (checked ? 'translate-x-[18px]' : 'translate-x-[3px]')
          }
        />
      </button>
    </label>
  );
}
