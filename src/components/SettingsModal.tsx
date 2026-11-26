import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { open } from '@tauri-apps/plugin-dialog';
import { check } from '@tauri-apps/plugin-updater';
import {
  AlertTriangle,
  Check,
  Database,
  Download,
  FolderOpen,
  Globe,
  Monitor,
  Moon,
  RefreshCw,
  RotateCcw,
  Search,
  Sliders,
  Sparkles,
  Sun,
  Terminal,
  X,
  Zap,
} from 'lucide-react';
import * as api from '../services/tauri';
import { useAppStore } from '../stores/useAppStore';
import type {
  CockpitTakeoverResult,
  LaunchPathStatus,
  ThemeMode,
  UpdateSettings,
} from '../types';

type SettingsTab = 'general' | 'autoswitch' | 'network' | 'data';
type LaunchAppKey = 'antigravity_legacy' | 'antigravity' | 'antigravity_cli';
type PendingUpdate = Awaited<ReturnType<typeof check>>;

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: typeof Sliders }[] = [
  { id: 'general', label: '常规', icon: Sliders },
  { id: 'autoswitch', label: '自动切号', icon: Zap },
  { id: 'network', label: '网络与路径', icon: Globe },
  { id: 'data', label: '数据与更新', icon: Database },
];

const THEME_OPTIONS: { id: ThemeMode; label: string; icon: typeof Monitor }[] = [
  { id: 'system', label: '跟随系统', icon: Monitor },
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'dark', label: '深色', icon: Moon },
];

const UI_SCALE_OPTIONS: { value: number; label: string }[] = [
  { value: 0.85, label: '85%' },
  { value: 0.9, label: '90%' },
  { value: 1, label: '100%' },
  { value: 1.1, label: '110%' },
  { value: 1.25, label: '125%' },
];

const CLOSE_BEHAVIOR_OPTIONS: { value: 'ask' | 'minimize' | 'quit'; label: string }[] = [
  { value: 'ask', label: '每次询问' },
  { value: 'minimize', label: '最小化到托盘' },
  { value: 'quit', label: '直接退出' },
];

const REFRESH_INTERVAL_OPTIONS: { value: number; label: string }[] = [
  { value: -1, label: '关闭' },
  { value: 2, label: '2 分钟' },
  { value: 5, label: '5 分钟' },
  { value: 10, label: '10 分钟' },
  { value: 15, label: '15 分钟' },
  { value: 30, label: '30 分钟' },
];

const LAUNCH_PATH_TARGETS: {
  app: LaunchAppKey;
  label: string;
  placeholder: string;
  savePath: (path: string) => Promise<void>;
  detectPath: () => Promise<string | null>;
}[] = [
  {
    app: 'antigravity_legacy',
    label: 'Antigravity 桌面端',
    placeholder: '自动探测 Antigravity.exe',
    savePath: (path) => api.setAppPath('antigravity_legacy', path, true),
    detectPath: () => api.detectAppPath('antigravity_legacy', true),
  },
  {
    app: 'antigravity',
    label: 'Antigravity IDE',
    placeholder: '自动探测 Antigravity IDE.exe',
    savePath: (path) => api.setAppPath('antigravity', path, true),
    detectPath: () => api.detectAppPath('antigravity', true),
  },
  {
    app: 'antigravity_cli',
    label: 'Antigravity CLI (agy)',
    placeholder: '自动探测 agy.cmd / agy.exe',
    savePath: (path) => api.saveCliLaunchPath('antigravity_cli', path),
    detectPath: () => api.inspectCliLaunchPath('antigravity_cli', true),
  },
];

function formatUpdateCheckError(err: unknown): string {
  const msg = String(err ?? '');
  const lower = msg.toLowerCase();
  if (lower.includes('pubkey') || lower.includes('public key') || lower.includes('signature')) {
    return '当前构建未配置发布签名公钥或签名校验失败，请前往 GitHub Releases 手动下载更新。';
  }
  if (lower.includes('404') || lower.includes('not found') || lower.includes('release')) {
    return '暂未找到已发布的线上版本元数据（KeS1Ke/agy-shift），请稍后再试。';
  }
  if (lower.includes('network') || lower.includes('connect') || lower.includes('timeout')) {
    return '连接 GitHub 更新服务器失败，请检查网络或代理设置后重试。';
  }
  return `检查更新未完成：${msg}`;
}

export function SettingsModal() {
  const settingsModalOpen = useAppStore((s) => s.settingsModalOpen);
  const settingsInitialTab = useAppStore((s) => s.settingsInitialTab);
  const closeSettingsModal = useAppStore((s) => s.closeSettingsModal);
  const generalConfig = useAppStore((s) => s.generalConfig);
  const networkConfig = useAppStore((s) => s.networkConfig);
  const dataDirSettings = useAppStore((s) => s.dataDirSettings);
  const displayGroups = useAppStore((s) => s.displayGroups);
  const accounts = useAppStore((s) => s.accounts);
  const theme = useAppStore((s) => s.theme);
  const setTheme = useAppStore((s) => s.setTheme);
  const updateConfig = useAppStore((s) => s.updateConfig);
  const reloadConfigs = useAppStore((s) => s.reloadConfigs);
  const reloadAccounts = useAppStore((s) => s.reloadAccounts);
  const pushToast = useAppStore((s) => s.pushToast);

  const [tab, setTab] = useState<SettingsTab>('general');
  const [scanningLocal, setScanningLocal] = useState(false);

  // 网络与路径状态
  const [wsEnabled, setWsEnabled] = useState(true);
  const [wsPortText, setWsPortText] = useState('19528');
  const [proxyEnabled, setProxyEnabled] = useState(false);
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyNoProxy, setProxyNoProxy] = useState('');
  const [savingNetwork, setSavingNetwork] = useState(false);
  const [networkNeedsRestart, setNetworkNeedsRestart] = useState(false);

  const [terminals, setTerminals] = useState<string[]>(['system']);
  const [pathDrafts, setPathDrafts] = useState<Record<LaunchAppKey, string>>({
    antigravity_legacy: '',
    antigravity: '',
    antigravity_cli: '',
  });
  const [pathStatuses, setPathStatuses] = useState<
    Partial<Record<LaunchAppKey, LaunchPathStatus>>
  >({});
  const [pathBusy, setPathBusy] = useState<Partial<Record<LaunchAppKey, boolean>>>({});

  // 数据目录接管与更新状态
  const [takingOver, setTakingOver] = useState(false);
  const [takeoverResult, setTakeoverResult] = useState<CockpitTakeoverResult | null>(null);
  const [takeoverRunningWarn, setTakeoverRunningWarn] = useState<string | null>(null);
  const [resettingDir, setResettingDir] = useState(false);

  const [appVersion, setAppVersion] = useState('0.1.0');
  const [updateSettings, setUpdateSettings] = useState<UpdateSettings | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [installingUpdate, setInstallingUpdate] = useState(false);
  const [pendingUpdate, setPendingUpdate] = useState<PendingUpdate>(null);
  const [updateStatusMsg, setUpdateStatusMsg] = useState<string | null>(null);

  useEffect(() => {
    if (settingsModalOpen) {
      setTab(settingsInitialTab);
      setNetworkNeedsRestart(false);
      setTakeoverRunningWarn(null);
      setTakeoverResult(null);
      setUpdateStatusMsg(null);
    }
  }, [settingsModalOpen, settingsInitialTab]);

  useEffect(() => {
    if (!settingsModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeSettingsModal();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [settingsModalOpen, closeSettingsModal]);

  useEffect(() => {
    if (!networkConfig) return;
    setWsEnabled(networkConfig.ws_enabled);
    setWsPortText(String(networkConfig.ws_port || networkConfig.default_port || 19528));
    setProxyEnabled(networkConfig.global_proxy_enabled);
    setProxyUrl(networkConfig.global_proxy_url ?? '');
    setProxyNoProxy(networkConfig.global_proxy_no_proxy ?? '');
  }, [networkConfig]);

  useEffect(() => {
    if (!generalConfig) return;
    setPathDrafts({
      antigravity_legacy: generalConfig.antigravity_legacy_app_path ?? '',
      antigravity: generalConfig.antigravity_app_path ?? '',
      antigravity_cli: generalConfig.antigravity_cli_path ?? '',
    });
  }, [generalConfig]);

  const refreshLaunchPaths = useCallback(async () => {
    const entries = await Promise.all(
      LAUNCH_PATH_TARGETS.map(async (item) => {
        try {
          const status = await api.getPlatformLaunchPath(item.app);
          return [item.app, status] as const;
        } catch {
          return [item.app, undefined] as const;
        }
      }),
    );
    const next: Partial<Record<LaunchAppKey, LaunchPathStatus>> = {};
    for (const [key, status] of entries) {
      if (status) next[key] = status;
    }
    setPathStatuses(next);
  }, []);

  useEffect(() => {
    if (!settingsModalOpen) return;
    void refreshLaunchPaths();
    api
      .getAvailableTerminals()
      .then((list) => {
        if (list.length > 0) setTerminals(list);
      })
      .catch(() => {});
    getVersion()
      .then((v) => {
        if (v) setAppVersion(v);
      })
      .catch(() => setAppVersion('0.1.0'));
    api
      .getUpdateSettings()
      .then((s) => setUpdateSettings(s))
      .catch(() => {});
  }, [settingsModalOpen, refreshLaunchPaths]);

  if (!settingsModalOpen) return null;

  const patchGeneral = (patch: Parameters<typeof updateConfig>[0]) => {
    void updateConfig(patch).catch(() => {});
  };

  const handleScanLocal = async () => {
    setScanningLocal(true);
    try {
      const res = await api.scanAutoLocalImport();
      await reloadAccounts();
      pushToast(
        `本机扫描完成：发现 ${res.scanned} 项，成功导入 ${res.imported} 个账号${res.failed > 0 ? `，失败 ${res.failed}` : ''}`,
        res.imported > 0 ? 'success' : 'info',
      );
    } catch (err) {
      pushToast(`扫描本机账号失败：${String(err)}`, 'error');
    } finally {
      setScanningLocal(false);
    }
  };

  const handleOpenLogs = async () => {
    try {
      await api.openLogsDir();
    } catch (err) {
      pushToast(`打开日志目录失败：${String(err)}`, 'error');
    }
  };

  const handleSaveNetwork = async () => {
    const parsedPort = Number.parseInt(wsPortText.trim(), 10);
    if (!Number.isFinite(parsedPort) || parsedPort < 1024 || parsedPort > 65535) {
      pushToast('WebSocket 端口需为 1024 ~ 65535 之间的整数', 'error');
      return;
    }
    if (proxyEnabled && !proxyUrl.trim()) {
      pushToast('启用全局代理时，代理地址不能为空', 'error');
      return;
    }
    setSavingNetwork(true);
    try {
      const res = await api.saveNetworkConfig({
        wsEnabled,
        wsPort: parsedPort,
        globalProxyEnabled: proxyEnabled,
        globalProxyUrl: proxyUrl.trim(),
        globalProxyNoProxy: proxyNoProxy.trim(),
      });
      await reloadConfigs();
      setNetworkNeedsRestart(res.needsRestart);
      pushToast(
        res.needsRestart ? '网络设置已保存，部分 WebSocket 端口变更需重启生效' : '网络设置已保存',
        'success',
      );
    } catch (err) {
      pushToast(`保存网络设置失败：${String(err)}`, 'error');
    } finally {
      setSavingNetwork(false);
    }
  };

  const handleSaveLaunchPath = async (
    target: (typeof LAUNCH_PATH_TARGETS)[number],
    overridePath?: string,
  ) => {
    const nextPath = (overridePath ?? pathDrafts[target.app]).trim();
    setPathBusy((prev) => ({ ...prev, [target.app]: true }));
    try {
      await target.savePath(nextPath);
      await Promise.all([refreshLaunchPaths(), reloadConfigs()]);
      pushToast(`已保存 ${target.label} 路径`, 'success');
    } catch (err) {
      pushToast(`保存路径失败：${String(err)}`, 'error');
    } finally {
      setPathBusy((prev) => ({ ...prev, [target.app]: false }));
    }
  };

  const handleDetectLaunchPath = async (target: (typeof LAUNCH_PATH_TARGETS)[number]) => {
    setPathBusy((prev) => ({ ...prev, [target.app]: true }));
    try {
      const detected = await target.detectPath();
      if (detected) {
        if (target.app === 'antigravity_cli') {
          await target.savePath(detected);
        }
        setPathDrafts((prev) => ({ ...prev, [target.app]: detected }));
        await Promise.all([refreshLaunchPaths(), reloadConfigs()]);
        pushToast(`已自动识别 ${target.label}：${detected}`, 'success');
      } else {
        pushToast(`未自动检测到 ${target.label}，请手动选择可执行文件`, 'info');
      }
    } catch (err) {
      pushToast(`探测路径失败：${String(err)}`, 'error');
    } finally {
      setPathBusy((prev) => ({ ...prev, [target.app]: false }));
    }
  };

  const handleBrowseLaunchPath = async (target: (typeof LAUNCH_PATH_TARGETS)[number]) => {
    try {
      const selected = await open({
        multiple: false,
        title: `选择 ${target.label} 可执行文件`,
        filters: [{ name: '可执行文件', extensions: ['exe', 'cmd', 'bat'] }],
      });
      const filePath =
        typeof selected === 'string'
          ? selected
          : Array.isArray(selected)
            ? (selected[0] ?? null)
            : null;
      if (!filePath) return;
      setPathDrafts((prev) => ({ ...prev, [target.app]: filePath }));
      await handleSaveLaunchPath(target, filePath);
    } catch (err) {
      pushToast(`选择文件失败：${String(err)}`, 'error');
    }
  };

  const toggleGroupSelection = (groupId: string) => {
    const current = generalConfig?.auto_switch_selected_group_ids ?? [];
    const next = current.includes(groupId)
      ? current.filter((id) => id !== groupId)
      : [...current, groupId];
    patchGeneral({ auto_switch_selected_group_ids: next });
  };

  const toggleAccountSelection = (accountId: string) => {
    const current = generalConfig?.auto_switch_selected_account_ids ?? [];
    const next = current.includes(accountId)
      ? current.filter((id) => id !== accountId)
      : [...current, accountId];
    patchGeneral({ auto_switch_selected_account_ids: next });
  };

  const handleTakeoverCockpit = async () => {
    setTakingOver(true);
    setTakeoverRunningWarn(null);
    try {
      const result = await api.takeoverCockpitToolsDataDir(false);
      setTakeoverResult(result);
      await reloadConfigs();
      pushToast(`已完成备份（${result.backedUpFiles} 个文件）并接管 ~/.cockpit_tools`, 'success');
    } catch (err) {
      const msg = String(err);
      if (msg.includes('COCKPIT_TOOLS_RUNNING')) {
        setTakeoverRunningWarn(
          '检测到原版 Cockpit Tools 正在运行，请先完全退出原版 Cockpit Tools 后再点击接管，以免并发写入导致数据损坏。',
        );
      } else {
        pushToast(`接管失败：${msg}`, 'error');
      }
    } finally {
      setTakingOver(false);
    }
  };

  const handleResetDataDir = async () => {
    setResettingDir(true);
    setTakeoverResult(null);
    setTakeoverRunningWarn(null);
    try {
      await api.resetDataDirectoryToDefault();
      await reloadConfigs();
      pushToast('已恢复为默认独立目录 (~/.agy_shift)，请重启应用生效', 'success');
    } catch (err) {
      pushToast(`恢复默认目录失败：${String(err)}`, 'error');
    } finally {
      setResettingDir(false);
    }
  };

  const handleRelaunch = async () => {
    try {
      await api.relaunchApp();
    } catch (err) {
      pushToast(`重启失败：${String(err)}`, 'error');
    }
  };

  const handlePatchUpdateSetting = async (
    patch: Partial<{ autoCheck: boolean; remindOnUpdate: boolean }>,
  ) => {
    try {
      const next = await api.patchUpdateSettings(patch);
      setUpdateSettings(next);
    } catch (err) {
      pushToast(`保存更新设置失败：${String(err)}`, 'error');
    }
  };

  const handleCheckUpdate = async () => {
    setCheckingUpdate(true);
    setUpdateStatusMsg(null);
    setPendingUpdate(null);
    try {
      const update = await check();
      await api.updateLastCheckTime().catch(() => {});
      if (update) {
        setPendingUpdate(update);
        setUpdateStatusMsg(`发现新版本 v${update.version}`);
      } else {
        setUpdateStatusMsg('当前已是最新版本');
      }
    } catch (err) {
      setUpdateStatusMsg(formatUpdateCheckError(err));
    } finally {
      setCheckingUpdate(false);
    }
  };

  const handleInstallUpdate = async () => {
    if (!pendingUpdate) return;
    setInstallingUpdate(true);
    try {
      await pendingUpdate.downloadAndInstall();
      await api.relaunchAfterUpdate();
    } catch (err) {
      setUpdateStatusMsg(`下载或安装更新失败：${String(err)}`);
    } finally {
      setInstallingUpdate(false);
    }
  };

  const dataBadge = dataDirSettings?.isDevProfile
    ? { label: 'DEV 隔离', cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400' }
    : dataDirSettings?.isUsingCockpitTools
      ? { label: '已接管 ~/.cockpit_tools', cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400' }
      : { label: '独立目录 ~/.agy_shift', cls: 'bg-[#5E6AD2]/15 text-[#5E6AD2] dark:text-indigo-300' };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-3 backdrop-blur-sm"
      onClick={closeSettingsModal}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="应用设置"
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[90vh] w-full max-w-[468px] flex-col overflow-hidden rounded-xl border border-zinc-200/80 bg-white shadow-2xl dark:border-white/[0.08] dark:bg-[#141518]"
      >
        {/* 顶部标题与胶囊标签栏 */}
        <div className="shrink-0 border-b border-zinc-200/80 bg-zinc-50/70 px-3.5 pb-2.5 pt-3 dark:border-white/[0.07] dark:bg-white/[0.02]">
          <div className="flex items-center justify-between">
            <h2 className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">设置</h2>
            <button
              type="button"
              onClick={closeSettingsModal}
              aria-label="关闭设置"
              className="flex h-6 w-6 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-200/70 hover:text-zinc-700 dark:hover:bg-white/[0.08] dark:hover:text-zinc-200"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>

          <div className="mt-2.5 grid grid-cols-4 gap-1 rounded-lg border border-zinc-200/80 bg-zinc-100/80 p-0.5 dark:border-white/[0.07] dark:bg-white/[0.03]">
            {SETTINGS_TABS.map((item) => {
              const Icon = item.icon;
              const active = tab === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={`flex items-center justify-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] font-medium transition-all ${
                    active
                      ? 'bg-white text-zinc-900 shadow-sm dark:bg-white/[0.11] dark:text-white'
                      : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                  }`}
                >
                  <Icon className="h-3 w-3 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* 可滚动主体内容区 */}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
          {tab === 'general' && (
            <>
              <SectionCard title="外观与交互">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-zinc-700 dark:text-zinc-200">外观主题</span>
                    <div className="flex items-center rounded-lg border border-zinc-200/80 bg-zinc-100/70 p-0.5 dark:border-white/[0.07] dark:bg-white/[0.03]">
                      {THEME_OPTIONS.map((opt) => {
                        const Icon = opt.icon;
                        const active = theme === opt.id;
                        return (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => void setTheme(opt.id)}
                            className={`flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                              active
                                ? 'bg-white text-zinc-900 shadow-sm dark:bg-white/[0.11] dark:text-white'
                                : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200'
                            }`}
                          >
                            <Icon className="h-3 w-3" />
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-zinc-700 dark:text-zinc-200">界面缩放</span>
                    <div className="flex items-center gap-1">
                      {UI_SCALE_OPTIONS.map((opt) => {
                        const active =
                          Math.abs((generalConfig?.ui_scale ?? 1) - opt.value) < 0.01;
                        return (
                          <button
                            key={opt.value}
                            type="button"
                            onClick={() => patchGeneral({ ui_scale: opt.value })}
                            className={`rounded-md border px-2 py-0.5 text-[11px] font-medium tabular-nums transition-colors ${
                              active
                                ? 'border-[#5E6AD2]/50 bg-[#5E6AD2]/12 text-[#5E6AD2] dark:border-indigo-400/50 dark:bg-indigo-400/15 dark:text-indigo-300'
                                : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-400'
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <SettingRow label="减少动效" hint="降低界面过渡动画与闪烁">
                    <ToggleSwitch
                      checked={Boolean(generalConfig?.reduced_motion_enabled)}
                      onChange={(v) => patchGeneral({ reduced_motion_enabled: v })}
                    />
                  </SettingRow>
                </div>
              </SectionCard>

              <SectionCard title="窗口与托盘">
                <div className="space-y-2.5">
                  <SettingRow label="开机自启">
                    <ToggleSwitch
                      checked={Boolean(generalConfig?.app_auto_launch_enabled)}
                      onChange={(v) => patchGeneral({ app_auto_launch_enabled: v })}
                    />
                  </SettingRow>
                  <SettingRow label="启动时最小化">
                    <ToggleSwitch
                      checked={Boolean(generalConfig?.startup_minimized)}
                      onChange={(v) => patchGeneral({ startup_minimized: v })}
                    />
                  </SettingRow>
                  <SettingRow label="显示系统托盘图标">
                    <ToggleSwitch
                      checked={generalConfig?.show_tray_icon ?? true}
                      onChange={(v) => patchGeneral({ show_tray_icon: v })}
                    />
                  </SettingRow>
                  <SettingRow label="记住窗口位置与大小">
                    <ToggleSwitch
                      checked={generalConfig?.remember_main_window_state ?? true}
                      onChange={(v) => patchGeneral({ remember_main_window_state: v })}
                    />
                  </SettingRow>
                  <div className="flex items-center justify-between gap-2 pt-0.5">
                    <span className="text-[12px] text-zinc-700 dark:text-zinc-200">
                      关闭按钮行为
                    </span>
                    <select
                      value={generalConfig?.close_behavior ?? 'ask'}
                      onChange={(e) => patchGeneral({ close_behavior: e.target.value })}
                      className="h-7 rounded-md border border-zinc-200/80 bg-white px-2 text-[11.5px] text-zinc-700 outline-none focus:border-[#5E6AD2] dark:border-white/[0.09] dark:bg-[#1B1D22] dark:text-zinc-200"
                    >
                      {CLOSE_BEHAVIOR_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="配额与本机同步">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-zinc-700 dark:text-zinc-200">
                      配额自动刷新间隔
                    </span>
                    <select
                      value={generalConfig?.auto_refresh_minutes ?? 10}
                      onChange={(e) =>
                        patchGeneral({ auto_refresh_minutes: Number(e.target.value) })
                      }
                      className="h-7 rounded-md border border-zinc-200/80 bg-white px-2 text-[11.5px] text-zinc-700 outline-none focus:border-[#5E6AD2] dark:border-white/[0.09] dark:bg-[#1B1D22] dark:text-zinc-200"
                    >
                      {REFRESH_INTERVAL_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <SettingRow
                    label="本机账号自动导入"
                    hint="监听客户端登录状态并自动导入新账号"
                  >
                    <ToggleSwitch
                      checked={Boolean(generalConfig?.auto_import_from_local_enabled)}
                      onChange={(v) => patchGeneral({ auto_import_from_local_enabled: v })}
                    />
                  </SettingRow>

                  <div className="flex items-center justify-between gap-2 border-t border-zinc-200/60 pt-2.5 dark:border-white/[0.06]">
                    <button
                      type="button"
                      disabled={scanningLocal}
                      onClick={() => void handleScanLocal()}
                      className="flex h-7 items-center gap-1.5 rounded-md border border-zinc-200/80 bg-white px-2.5 text-[11.5px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:bg-white/[0.08]"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${scanningLocal ? 'animate-spin' : ''}`}
                      />
                      {scanningLocal ? '扫描中…' : '立即扫描'}
                    </button>

                    <button
                      type="button"
                      onClick={() => void handleOpenLogs()}
                      className="flex h-7 items-center gap-1.5 rounded-md border border-zinc-200/80 bg-white px-2.5 text-[11.5px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:bg-white/[0.08]"
                    >
                      <FolderOpen className="h-3 w-3" />
                      打开日志目录
                    </button>
                  </div>
                </div>
              </SectionCard>
            </>
          )}

          {tab === 'autoswitch' && (
            <>
              <SectionCard title="切号行为">
                <div className="space-y-2.5">
                  <SettingRow label="切号后自动启动客户端">
                    <ToggleSwitch
                      checked={generalConfig?.antigravity_launch_on_switch ?? true}
                      onChange={(v) => patchGeneral({ antigravity_launch_on_switch: v })}
                    />
                  </SettingRow>
                  <SettingRow
                    label="优先无感切号（通过 WebSocket 无需重启）"
                    hint="需开启 WebSocket 服务且客户端已连接扩展"
                  >
                    <ToggleSwitch
                      checked={Boolean(
                        generalConfig?.antigravity_dual_switch_no_restart_enabled,
                      )}
                      onChange={(v) =>
                        patchGeneral({ antigravity_dual_switch_no_restart_enabled: v })
                      }
                    />
                  </SettingRow>
                </div>
              </SectionCard>

              <SectionCard title="自动切号规则">
                <div className="space-y-2.5">
                  <SettingRow
                    label="启用自动切号"
                    hint="当前账号配额低于阈值时自动切换至可用账号"
                  >
                    <ToggleSwitch
                      checked={Boolean(generalConfig?.auto_switch_enabled)}
                      onChange={(v) => patchGeneral({ auto_switch_enabled: v })}
                    />
                  </SettingRow>

                  <ThresholdField
                    label="默认触发阈值 (%)"
                    value={generalConfig?.auto_switch_threshold ?? 5}
                    min={1}
                    max={95}
                    onCommit={(val) => patchGeneral({ auto_switch_threshold: val })}
                  />

                  <div className="border-t border-zinc-200/60 pt-2 dark:border-white/[0.06]">
                    <SettingRow label="5h / 周配额独立阈值">
                      <ToggleSwitch
                        checked={Boolean(
                          generalConfig?.auto_switch_window_thresholds_enabled,
                        )}
                        onChange={(v) =>
                          patchGeneral({ auto_switch_window_thresholds_enabled: v })
                        }
                      />
                    </SettingRow>
                    {generalConfig?.auto_switch_window_thresholds_enabled && (
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <ThresholdField
                          label="5h 阈值 (%)"
                          value={generalConfig.auto_switch_five_hour_threshold ?? 5}
                          min={1}
                          max={95}
                          compact
                          onCommit={(val) =>
                            patchGeneral({ auto_switch_five_hour_threshold: val })
                          }
                        />
                        <ThresholdField
                          label="周配额阈值 (%)"
                          value={generalConfig.auto_switch_weekly_threshold ?? 5}
                          min={1}
                          max={95}
                          compact
                          onCommit={(val) =>
                            patchGeneral({ auto_switch_weekly_threshold: val })
                          }
                        />
                      </div>
                    )}
                  </div>

                  <div className="border-t border-zinc-200/60 pt-2 dark:border-white/[0.06]">
                    <SettingRow label="AI 积分触发阈值">
                      <ToggleSwitch
                        checked={Boolean(generalConfig?.auto_switch_credits_enabled)}
                        onChange={(v) =>
                          patchGeneral({ auto_switch_credits_enabled: v })
                        }
                      />
                    </SettingRow>
                    {generalConfig?.auto_switch_credits_enabled && (
                      <div className="mt-2">
                        <ThresholdField
                          label="最低积分阈值"
                          value={generalConfig.auto_switch_credits_threshold ?? 5}
                          min={0}
                          max={100000}
                          onCommit={(val) =>
                            patchGeneral({ auto_switch_credits_threshold: val })
                          }
                        />
                      </div>
                    )}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="监控范围与候选账号">
                <div className="space-y-3">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] text-zinc-700 dark:text-zinc-200">
                        监控模型分组范围
                      </span>
                      <div className="flex items-center rounded-lg border border-zinc-200/80 bg-zinc-100/70 p-0.5 dark:border-white/[0.07] dark:bg-white/[0.03]">
                        {[
                          { id: 'any_group', label: '任意分组触发' },
                          { id: 'selected_groups', label: '指定分组' },
                        ].map((opt) => {
                          const active =
                            (generalConfig?.auto_switch_scope_mode ?? 'any_group') ===
                            opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() =>
                                patchGeneral({ auto_switch_scope_mode: opt.id })
                              }
                              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                                active
                                  ? 'bg-white text-zinc-900 shadow-sm dark:bg-white/[0.11] dark:text-white'
                                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {generalConfig?.auto_switch_scope_mode === 'selected_groups' && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {displayGroups.length === 0 ? (
                          <span className="text-[11px] text-zinc-400">
                            暂无可用模型分组
                          </span>
                        ) : (
                          displayGroups.map((group) => {
                            const selected = (
                              generalConfig.auto_switch_selected_group_ids ?? []
                            ).includes(group.id);
                            return (
                              <button
                                key={group.id}
                                type="button"
                                onClick={() => toggleGroupSelection(group.id)}
                                className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-medium transition-colors ${
                                  selected
                                    ? 'border-[#5E6AD2]/50 bg-[#5E6AD2]/12 text-[#5E6AD2] dark:border-indigo-400/50 dark:bg-indigo-400/15 dark:text-indigo-300'
                                    : 'border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-400'
                                }`}
                              >
                                {selected && <Check className="h-3 w-3" />}
                                {group.name}
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>

                  <div className="border-t border-zinc-200/60 pt-2.5 dark:border-white/[0.06]">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] text-zinc-700 dark:text-zinc-200">
                        候选切换账号范围
                      </span>
                      <div className="flex items-center rounded-lg border border-zinc-200/80 bg-zinc-100/70 p-0.5 dark:border-white/[0.07] dark:bg-white/[0.03]">
                        {[
                          { id: 'all_accounts', label: '全部账号' },
                          { id: 'selected_accounts', label: '指定账号' },
                        ].map((opt) => {
                          const active =
                            (generalConfig?.auto_switch_account_scope_mode ??
                              'all_accounts') === opt.id;
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() =>
                                patchGeneral({ auto_switch_account_scope_mode: opt.id })
                              }
                              className={`rounded-md px-2 py-1 text-[11px] font-medium transition-all ${
                                active
                                  ? 'bg-white text-zinc-900 shadow-sm dark:bg-white/[0.11] dark:text-white'
                                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
                              }`}
                            >
                              {opt.label}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {generalConfig?.auto_switch_account_scope_mode ===
                      'selected_accounts' && (
                      <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-lg border border-zinc-200/70 bg-zinc-50/70 p-1.5 dark:border-white/[0.07] dark:bg-black/20">
                        {accounts.length === 0 ? (
                          <p className="px-1.5 py-1 text-[11px] text-zinc-400">
                            暂无可选账号
                          </p>
                        ) : (
                          accounts.map((acc) => {
                            const selected = (
                              generalConfig.auto_switch_selected_account_ids ?? []
                            ).includes(acc.id);
                            return (
                              <button
                                key={acc.id}
                                type="button"
                                onClick={() => toggleAccountSelection(acc.id)}
                                className={`flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-[11.5px] transition-colors ${
                                  selected
                                    ? 'bg-[#5E6AD2]/12 text-[#5E6AD2] dark:bg-indigo-400/15 dark:text-indigo-300'
                                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-white/[0.05]'
                                }`}
                              >
                                <span className="truncate">{acc.email}</span>
                                {selected && <Check className="h-3.5 w-3.5 shrink-0" />}
                              </button>
                            );
                          })
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="低配额提醒">
                <div className="space-y-2.5">
                  <SettingRow label="启用低配额提醒">
                    <ToggleSwitch
                      checked={Boolean(generalConfig?.quota_alert_enabled)}
                      onChange={(v) => patchGeneral({ quota_alert_enabled: v })}
                    />
                  </SettingRow>
                  <ThresholdField
                    label="提醒阈值 (%)"
                    value={generalConfig?.quota_alert_threshold ?? 20}
                    min={1}
                    max={95}
                    onCommit={(val) => patchGeneral({ quota_alert_threshold: val })}
                  />
                </div>
              </SectionCard>
            </>
          )}

          {tab === 'network' && (
            <>
              <SectionCard
                title="WebSocket 无感切号服务与全局代理"
                headerRight={
                  networkConfig?.actual_port ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10.5px] font-medium text-emerald-600 tabular-nums dark:text-emerald-400">
                      <Sparkles className="h-2.5 w-2.5" />
                      运行中 :{networkConfig.actual_port}
                    </span>
                  ) : (
                    <span className="rounded-full bg-zinc-200/80 px-2 py-0.5 text-[10.5px] font-medium text-zinc-500 dark:bg-white/[0.08] dark:text-zinc-400">
                      未启动
                    </span>
                  )
                }
              >
                <div className="space-y-2.5">
                  <SettingRow label="启用 WebSocket 服务">
                    <ToggleSwitch checked={wsEnabled} onChange={setWsEnabled} />
                  </SettingRow>

                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[12px] text-zinc-700 dark:text-zinc-200">
                      监听端口
                    </span>
                    <input
                      type="number"
                      min={1024}
                      max={65535}
                      value={wsPortText}
                      onChange={(e) => setWsPortText(e.target.value)}
                      className="h-7 w-28 rounded-md border border-zinc-200/80 bg-white px-2 text-right text-[12px] tabular-nums text-zinc-800 outline-none focus:border-[#5E6AD2] dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-100"
                    />
                  </div>

                  <div className="border-t border-zinc-200/60 pt-2.5 dark:border-white/[0.06]">
                    <SettingRow label="启用全局代理" hint="仅对受管启动链路及请求生效">
                      <ToggleSwitch checked={proxyEnabled} onChange={setProxyEnabled} />
                    </SettingRow>
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      代理地址
                    </label>
                    <input
                      type="text"
                      value={proxyUrl}
                      onChange={(e) => setProxyUrl(e.target.value)}
                      placeholder="http://127.0.0.1:7890"
                      className="h-7 w-full rounded-md border border-zinc-200/80 bg-white px-2.5 text-[12px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-[#5E6AD2] dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-100"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-[11px] font-medium text-zinc-500 dark:text-zinc-400">
                      绕过列表 (NO_PROXY)
                    </label>
                    <input
                      type="text"
                      value={proxyNoProxy}
                      onChange={(e) => setProxyNoProxy(e.target.value)}
                      placeholder="localhost,127.0.0.1"
                      className="h-7 w-full rounded-md border border-zinc-200/80 bg-white px-2.5 text-[12px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-[#5E6AD2] dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-100"
                    />
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-1">
                    <button
                      type="button"
                      disabled={savingNetwork}
                      onClick={() => void handleSaveNetwork()}
                      className="flex h-7 items-center gap-1.5 rounded-md bg-[#5E6AD2] px-3 text-[11.5px] font-medium text-white shadow-sm transition-colors hover:bg-[#525EC4] disabled:opacity-50"
                    >
                      {savingNetwork ? '保存中…' : '保存网络设置'}
                    </button>

                    {networkNeedsRestart && (
                      <div className="flex items-center gap-2">
                        <span className="text-[11px] text-amber-600 dark:text-amber-400">
                          需重启生效
                        </span>
                        <button
                          type="button"
                          onClick={() => void handleRelaunch()}
                          className="flex h-7 items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 text-[11px] font-medium text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
                        >
                          立即重启
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="客户端可执行文件路径">
                <div className="space-y-3">
                  {LAUNCH_PATH_TARGETS.map((target) => {
                    const status = pathStatuses[target.app];
                    const busy = Boolean(pathBusy[target.app]);
                    return (
                      <div
                        key={target.app}
                        className="space-y-1.5 border-b border-zinc-200/60 pb-2.5 last:border-b-0 last:pb-0 dark:border-white/[0.06]"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
                            {target.label}
                          </span>
                          <span className="max-w-[230px] truncate text-[10.5px] text-zinc-400">
                            {status?.resolvedPath
                              ? `当前解析: ${status.resolvedPath}`
                              : '未检测到可执行文件'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <input
                            type="text"
                            value={pathDrafts[target.app]}
                            onChange={(e) =>
                              setPathDrafts((prev) => ({
                                ...prev,
                                [target.app]: e.target.value,
                              }))
                            }
                            placeholder={target.placeholder}
                            className="h-7 min-w-0 flex-1 rounded-md border border-zinc-200/80 bg-white px-2 text-[11.5px] text-zinc-800 outline-none placeholder:text-zinc-400 focus:border-[#5E6AD2] dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-100"
                          />
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleBrowseLaunchPath(target)}
                            title="浏览选择文件"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-300"
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleDetectLaunchPath(target)}
                            title="自动探测"
                            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-zinc-200/80 bg-white text-zinc-600 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-300"
                          >
                            <Search className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => void handleSaveLaunchPath(target)}
                            className="h-7 shrink-0 rounded-md border border-zinc-200/80 bg-white px-2 text-[11px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-200"
                          >
                            保存
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </SectionCard>

              <SectionCard title="默认终端">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[12px] text-zinc-700 dark:text-zinc-200">
                    <Terminal className="h-3.5 w-3.5 text-zinc-400" />
                    <span>启动 CLI (agy) 使用的终端</span>
                  </div>
                  <select
                    value={generalConfig?.default_terminal ?? 'system'}
                    onChange={(e) => patchGeneral({ default_terminal: e.target.value })}
                    className="h-7 rounded-md border border-zinc-200/80 bg-white px-2 text-[11.5px] text-zinc-700 outline-none focus:border-[#5E6AD2] dark:border-white/[0.09] dark:bg-[#1B1D22] dark:text-zinc-200"
                  >
                    {terminals.map((term) => (
                      <option key={term} value={term}>
                        {term === 'system' ? '系统默认' : term}
                      </option>
                    ))}
                  </select>
                </div>
              </SectionCard>
            </>
          )}

          {tab === 'data' && (
            <>
              <SectionCard
                title="当前数据目录"
                headerRight={
                  <span
                    className={`rounded-full px-2 py-0.5 text-[10.5px] font-medium ${dataBadge.cls}`}
                  >
                    {dataBadge.label}
                  </span>
                }
              >
                <div className="space-y-2.5">
                  <div className="rounded-lg border border-zinc-200/70 bg-zinc-50/80 px-2.5 py-2 text-[11.5px] text-zinc-700 break-all dark:border-white/[0.06] dark:bg-black/20 dark:text-zinc-300">
                    {dataDirSettings?.activeDir || '加载中…'}
                  </div>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-zinc-400">
                      {dataDirSettings?.needsRestart ? '目录配置已变更，需重启应用生效' : '账号与配置持久化路径'}
                    </span>
                    <button
                      type="button"
                      onClick={() => void api.openDataFolder().catch((err) => pushToast(`打开目录失败：${String(err)}`, 'error'))}
                      className="flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-zinc-200/80 bg-white px-2.5 text-[11.5px] font-medium text-zinc-700 hover:bg-zinc-50 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-200"
                    >
                      <FolderOpen className="h-3 w-3" />
                      打开目录
                    </button>
                  </div>
                </div>
              </SectionCard>

              <SectionCard title="一键接管 ~/.cockpit_tools">
                <div className="space-y-2.5">
                  {dataDirSettings?.isDevProfile ? (
                    <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-2 text-[11.5px] leading-relaxed text-amber-700 dark:text-amber-300">
                      当前为开发环境构建，数据已严格隔离在 <code className="font-mono">~/.agy_shift_dev</code>，不会读取或写入 <code className="font-mono">~/.cockpit_tools</code>。
                    </p>
                  ) : dataDirSettings?.cockpitToolsExists &&
                    !dataDirSettings.isUsingCockpitTools ? (
                    <>
                      <p className="text-[11.5px] leading-relaxed text-zinc-600 dark:text-zinc-400">
                        检测到本机存在原版数据目录 <code className="font-mono text-zinc-800 dark:text-zinc-200">~/.cockpit_tools</code>。点击下方按钮将先把 Antigravity 相关数据安全备份到 <code className="font-mono text-zinc-800 dark:text-zinc-200">~/.agy_shift/backups/</code>，再将数据目录切换指向 <code className="font-mono text-zinc-800 dark:text-zinc-200">~/.cockpit_tools</code>，以兼容原生 Antigravity Cockpit 扩展的无感切号。
                      </p>
                      <button
                        type="button"
                        disabled={takingOver}
                        onClick={() => void handleTakeoverCockpit()}
                        className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[#5E6AD2] px-3 text-[12px] font-medium text-white shadow-sm transition-colors hover:bg-[#525EC4] disabled:opacity-50"
                      >
                        <Database className="h-3.5 w-3.5" />
                        {takingOver ? '正在备份并接管…' : '备份并正式接管 ~/.cockpit_tools'}
                      </button>
                    </>
                  ) : !dataDirSettings?.isUsingCockpitTools ? (
                    <p className="text-[11.5px] text-zinc-500 dark:text-zinc-400">
                      当前未检测到 <code className="font-mono">~/.cockpit_tools</code> 目录，应用正使用独立目录运行。
                    </p>
                  ) : (
                    <p className="text-[11.5px] text-emerald-600 dark:text-emerald-400">
                      当前已接管 <code className="font-mono">~/.cockpit_tools</code>，可与原生 Antigravity Cockpit 扩展无缝协作。
                    </p>
                  )}

                  {takeoverRunningWarn && (
                    <div className="flex items-start gap-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-2 text-[11.5px] text-rose-700 dark:text-rose-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      <span>{takeoverRunningWarn}</span>
                    </div>
                  )}

                  {takeoverResult && (
                    <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-2.5 text-[11.5px] text-emerald-800 dark:text-emerald-300">
                      <div>
                        接管配置已写入，已备份 <strong>{takeoverResult.backedUpFiles}</strong> 个文件至：
                        <div className="mt-1 break-all font-mono text-[10.5px] opacity-90">
                          {takeoverResult.backupDir}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => void handleRelaunch()}
                        className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-emerald-600 px-3 text-[11.5px] font-medium text-white hover:bg-emerald-700"
                      >
                        立即重启生效
                      </button>
                    </div>
                  )}

                  {(dataDirSettings?.isUsingCockpitTools ||
                    dataDirSettings?.configuredDir ||
                    dataDirSettings?.needsRestart) && (
                    <div className="flex items-center gap-2 border-t border-zinc-200/60 pt-2.5 dark:border-white/[0.06]">
                      <button
                        type="button"
                        disabled={resettingDir}
                        onClick={() => void handleResetDataDir()}
                        className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-md border border-zinc-200/80 bg-white px-2.5 text-[11.5px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-200"
                      >
                        <RotateCcw className="h-3 w-3" />
                        {resettingDir ? '恢复中…' : '恢复默认独立目录 (~/.agy_shift)'}
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleRelaunch()}
                        className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-zinc-900 px-2.5 text-[11.5px] font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-200"
                      >
                        立即重启应用
                      </button>
                    </div>
                  )}
                </div>
              </SectionCard>

              <SectionCard
                title="应用更新"
                headerRight={
                  <span className="text-[11px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400">
                    v{appVersion}
                  </span>
                }
              >
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between text-[11.5px] text-zinc-500 dark:text-zinc-400">
                    <span>更新源</span>
                    <span className="font-mono text-zinc-700 dark:text-zinc-300">
                      KeS1Ke/agy-shift
                    </span>
                  </div>

                  <SettingRow label="启动时自动检查更新">
                    <ToggleSwitch
                      checked={updateSettings?.auto_check ?? true}
                      onChange={(v) => void handlePatchUpdateSetting({ autoCheck: v })}
                    />
                  </SettingRow>

                  <SettingRow label="发现新版本时弹窗提醒">
                    <ToggleSwitch
                      checked={updateSettings?.remind_on_update ?? true}
                      onChange={(v) =>
                        void handlePatchUpdateSetting({ remindOnUpdate: v })
                      }
                    />
                  </SettingRow>

                  <div className="flex items-center gap-2 pt-0.5">
                    <button
                      type="button"
                      disabled={checkingUpdate || installingUpdate}
                      onClick={() => void handleCheckUpdate()}
                      className="flex h-7 items-center gap-1.5 rounded-md border border-zinc-200/80 bg-white px-2.5 text-[11.5px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-200"
                    >
                      <RefreshCw
                        className={`h-3 w-3 ${checkingUpdate ? 'animate-spin' : ''}`}
                      />
                      {checkingUpdate ? '检查中…' : '检查更新'}
                    </button>
                  </div>

                  {updateStatusMsg && (
                    <div className="rounded-lg border border-zinc-200/70 bg-zinc-50/80 px-2.5 py-2 text-[11.5px] text-zinc-600 dark:border-white/[0.07] dark:bg-black/20 dark:text-zinc-300">
                      {updateStatusMsg}
                    </div>
                  )}

                  {pendingUpdate && (
                    <div className="space-y-2 rounded-lg border border-[#5E6AD2]/30 bg-[#5E6AD2]/10 p-2.5 dark:border-indigo-400/30 dark:bg-indigo-500/10">
                      <div className="flex items-center justify-between text-[12px] font-medium text-zinc-900 dark:text-zinc-100">
                        <span>新版本 v{pendingUpdate.version}</span>
                      </div>
                      {pendingUpdate.body && (
                        <p className="max-h-24 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-600 dark:text-zinc-300">
                          {pendingUpdate.body}
                        </p>
                      )}
                      <button
                        type="button"
                        disabled={installingUpdate}
                        onClick={() => void handleInstallUpdate()}
                        className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md bg-[#5E6AD2] px-3 text-[11.5px] font-medium text-white hover:bg-[#525EC4] disabled:opacity-50"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {installingUpdate ? '下载并安装中…' : '下载并安装'}
                      </button>
                    </div>
                  )}
                </div>
              </SectionCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function SectionCard({
  title,
  headerRight,
  children,
}: {
  title: string;
  headerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-3 dark:border-white/[0.07] dark:bg-white/[0.02]">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h3 className="text-[11.5px] font-semibold tracking-tight text-zinc-800 dark:text-zinc-200">
          {title}
        </h3>
        {headerRight}
      </div>
      {children}
    </section>
  );
}

function SettingRow({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="min-w-0">
        <div className="text-[12px] text-zinc-700 dark:text-zinc-200">{label}</div>
        {hint && (
          <div className="mt-0.5 text-[10.5px] text-zinc-400 dark:text-zinc-500">
            {hint}
          </div>
        )}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function ToggleSwitch({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
        checked
          ? 'border-[#5E6AD2] bg-[#5E6AD2]'
          : 'border-zinc-300 bg-zinc-200 dark:border-white/[0.12] dark:bg-white/[0.1]'
      }`}
    >
      <span
        className={`pointer-events-none inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow-sm transition-transform ${
          checked ? 'translate-x-[18px]' : 'translate-x-[2px]'
        }`}
      />
    </button>
  );
}

function ThresholdField({
  label,
  value,
  min,
  max,
  compact = false,
  onCommit,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  compact?: boolean;
  onCommit: (next: number) => void;
}) {
  const [draft, setDraft] = useState(String(value));

  useEffect(() => {
    setDraft(String(value));
  }, [value]);

  const commit = () => {
    const parsed = Number.parseInt(draft.trim(), 10);
    if (!Number.isFinite(parsed)) {
      setDraft(String(value));
      return;
    }
    const clamped = Math.min(max, Math.max(min, parsed));
    setDraft(String(clamped));
    if (clamped !== value) {
      onCommit(clamped);
    }
  };

  return (
    <div
      className={`flex items-center justify-between gap-2 ${
        compact
          ? 'rounded-lg border border-zinc-200/70 bg-white/70 px-2 py-1.5 dark:border-white/[0.06] dark:bg-black/20'
          : ''
      }`}
    >
      <span className="text-[11.5px] text-zinc-600 dark:text-zinc-300">{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.currentTarget.blur();
          }
        }}
        className="h-7 w-20 rounded-md border border-zinc-200/80 bg-white px-2 text-right text-[12px] tabular-nums text-zinc-800 outline-none focus:border-[#5E6AD2] dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-100"
      />
    </div>
  );
}
