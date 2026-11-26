import { create } from 'zustand';
import type {
  Account,
  AntigravityClientTarget,
  AntigravityRuntimeTarget,
  DataDirectorySettings,
  DisplayGroup,
  GeneralConfig,
  MainTab,
  NetworkConfig,
  ThemeMode,
} from '../types';
import * as api from '../services/tauri';

export interface ToastItem {
  id: string;
  tone: 'info' | 'success' | 'error';
  message: string;
}

const CLIENT_TARGET_KEY = 'agy-shift.client-target.v1';
const THEME_KEY = 'agy-shift.theme.v1';

function readInitialTarget(): AntigravityClientTarget {
  try {
    const raw = localStorage.getItem(CLIENT_TARGET_KEY);
    if (raw === 'antigravity' || raw === 'antigravity_ide' || raw === 'cli') {
      return raw;
    }
  } catch {
    // ignore
  }
  return 'antigravity';
}

function readInitialTheme(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === 'light' || raw === 'dark' || raw === 'system') return raw;
  } catch {
    // ignore
  }
  return 'system';
}

export function applyThemeToDom(theme: ThemeMode): void {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const isDark = theme === 'dark' || (theme === 'system' && prefersDark);
  root.classList.toggle('dark', isDark);
  root.style.backgroundColor = isDark ? '#19171b' : '#f3efe8';
}

interface AppState {
  activeTab: MainTab;
  clientTarget: AntigravityClientTarget;
  theme: ThemeMode;

  accounts: Account[];
  currentAccountId: string | null;
  displayGroups: DisplayGroup[];
  generalConfig: GeneralConfig | null;
  networkConfig: NetworkConfig | null;
  dataDirSettings: DataDirectorySettings | null;

  loadingAccounts: boolean;
  refreshingAll: boolean;
  refreshingIds: Record<string, boolean>;
  switchingId: string | null;

  addModalOpen: boolean;
  updateModalOpen: boolean;
  settingsModalOpen: boolean;
  settingsInitialTab: 'general' | 'autoswitch' | 'network' | 'data';
  historyModalOpen: boolean;
  editingAccount: Account | null;
  closeConfirmOpen: boolean;
  closeConfirmHasTray: boolean;

  toasts: ToastItem[];

  setActiveTab: (tab: MainTab) => void;
  setClientTarget: (target: AntigravityClientTarget) => void;
  setTheme: (theme: ThemeMode) => Promise<void>;
  cycleTheme: () => Promise<void>;

  openAddModal: () => void;
  closeAddModal: () => void;
  openUpdateModal: () => void;
  closeUpdateModal: () => void;
  openSettingsModal: (tab?: 'general' | 'autoswitch' | 'network' | 'data') => void;
  closeSettingsModal: () => void;
  openHistoryModal: () => void;
  closeHistoryModal: () => void;
  setEditingAccount: (account: Account | null) => void;
  setCloseConfirm: (open: boolean, hasTray?: boolean) => void;

  pushToast: (message: string, tone?: 'info' | 'success' | 'error') => void;
  dismissToast: (id: string) => void;

  bootstrap: () => Promise<void>;
  reloadAccounts: () => Promise<void>;
  reloadConfigs: () => Promise<void>;
  refreshAllQuotas: () => Promise<void>;
  refreshSingleQuota: (accountId: string) => Promise<void>;
  switchToAccount: (account: Account, launchOverride?: boolean) => Promise<void>;
  deleteAccountById: (account: Account) => Promise<void>;
  updateConfig: (patch: Partial<GeneralConfig>) => Promise<void>;
}

export const useAppStore = create<AppState>((set, get) => ({
  activeTab: 'accounts',
  clientTarget: readInitialTarget(),
  theme: readInitialTheme(),

  accounts: [],
  currentAccountId: null,
  displayGroups: [],
  generalConfig: null,
  networkConfig: null,
  dataDirSettings: null,

  loadingAccounts: true,
  refreshingAll: false,
  refreshingIds: {},
  switchingId: null,

  addModalOpen: false,
  updateModalOpen: false,
  settingsModalOpen: false,
  settingsInitialTab: 'general',
  historyModalOpen: false,
  editingAccount: null,
  closeConfirmOpen: false,
  closeConfirmHasTray: true,

  toasts: [],

  setActiveTab: (tab) => set({ activeTab: tab }),

  setClientTarget: (target) => {
    try {
      localStorage.setItem(CLIENT_TARGET_KEY, target);
    } catch {
      // ignore
    }
    set({ clientTarget: target });
    if (target !== 'cli') {
      api
        .getCurrentAccount(target)
        .then((curr) => set({ currentAccountId: curr?.id ?? get().currentAccountId }))
        .catch(() => {});
    }
  },

  setTheme: async (theme) => {
    set({ theme });
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // ignore
    }
    applyThemeToDom(theme);
    try {
      await api.patchGeneralConfig({ theme });
      const cfg = get().generalConfig;
      if (cfg) set({ generalConfig: { ...cfg, theme } });
    } catch {
      // non-fatal
    }
  },

  cycleTheme: async () => {
    const order: ThemeMode[] = ['system', 'light', 'dark'];
    const next = order[(order.indexOf(get().theme) + 1) % order.length];
    await get().setTheme(next);
  },

  openAddModal: () => set({ addModalOpen: true }),
  closeAddModal: () => set({ addModalOpen: false }),
  openUpdateModal: () => set({ updateModalOpen: true }),
  closeUpdateModal: () => set({ updateModalOpen: false }),
  openSettingsModal: (tab = 'general') =>
    set({ settingsModalOpen: true, settingsInitialTab: tab }),
  closeSettingsModal: () => set({ settingsModalOpen: false }),
  openHistoryModal: () => set({ historyModalOpen: true }),
  closeHistoryModal: () => set({ historyModalOpen: false }),
  setEditingAccount: (account) => set({ editingAccount: account }),
  setCloseConfirm: (open, hasTray = true) =>
    set({ closeConfirmOpen: open, closeConfirmHasTray: hasTray }),

  pushToast: (message, tone = 'info') => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    set((s) => ({ toasts: [...s.toasts.slice(-3), { id, tone, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 3600);
  },

  dismissToast: (id) =>
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  bootstrap: async () => {
    applyThemeToDom(get().theme);
    await Promise.all([
      api.getGeneralConfig().then((generalConfig) => {
        const theme = generalConfig.theme === 'light' || generalConfig.theme === 'dark'
          ? generalConfig.theme
          : 'system';
        applyThemeToDom(theme);
        set({ generalConfig, theme });
      }).catch((error) => get().pushToast(`加载配置失败：${String(error)}`, 'error')),
      get().reloadAccounts(),
    ]);
  },

  reloadConfigs: async () => {
    try {
      const [generalConfig, networkConfig, dataDirSettings, displayGroups] =
        await Promise.all([
          api.getGeneralConfig(),
          api.getNetworkConfig(),
          api.getDataDirectorySettings(),
          api.getDisplayGroups().catch(() => [] as DisplayGroup[]),
        ]);
      const theme: ThemeMode =
        generalConfig.theme === 'light' ||
        generalConfig.theme === 'dark' ||
        generalConfig.theme === 'system'
          ? generalConfig.theme
          : 'system';
      applyThemeToDom(theme);
      set({
        generalConfig,
        networkConfig,
        dataDirSettings,
        displayGroups,
        theme,
      });
    } catch (err) {
      get().pushToast(`加载配置失败：${String(err)}`, 'error');
    }
  },

  reloadAccounts: async () => {
    set({ loadingAccounts: true });
    try {
      const target = get().clientTarget;
      const runtimeTarget: AntigravityRuntimeTarget =
        target === 'cli' ? 'antigravity' : target;
      const [accounts, current] = await Promise.all([
        api.listAccounts(),
        api.getCurrentAccount(runtimeTarget).catch(() => null),
      ]);
      set({
        accounts,
        currentAccountId: current?.id ?? null,
        loadingAccounts: false,
      });
    } catch (err) {
      set({ loadingAccounts: false });
      get().pushToast(`读取账号列表失败：${String(err)}`, 'error');
    }
  },

  refreshAllQuotas: async () => {
    if (get().refreshingAll) return;
    set({ refreshingAll: true });
    try {
      const target = get().clientTarget;
      const runtimeTarget: AntigravityRuntimeTarget =
        target === 'cli' ? 'antigravity' : target;
      const stats = await api.refreshAllQuotas('manual', runtimeTarget);
      await get().reloadAccounts();
      get().pushToast(
        stats.failed > 0
          ? `配额刷新完成：成功 ${stats.success}，失败 ${stats.failed}`
          : `已刷新全部 ${stats.success} 个账号配额`,
        stats.failed > 0 ? 'info' : 'success',
      );
    } catch (err) {
      get().pushToast(`刷新配额失败：${String(err)}`, 'error');
    } finally {
      set({ refreshingAll: false });
    }
  },

  refreshSingleQuota: async (accountId) => {
    if (get().refreshingIds[accountId]) return;
    set((s) => ({ refreshingIds: { ...s.refreshingIds, [accountId]: true } }));
    try {
      const updated = await api.fetchAccountQuota(accountId);
      set((s) => ({
        accounts: s.accounts.map((a) => (a.id === updated.id ? updated : a)),
      }));
      get().pushToast(`已刷新 ${updated.email} 的配额`, 'success');
    } catch (err) {
      get().pushToast(`刷新失败：${String(err)}`, 'error');
    } finally {
      set((s) => {
        const next = { ...s.refreshingIds };
        delete next[accountId];
        return { refreshingIds: next };
      });
    }
  },

  switchToAccount: async (account, launchOverride) => {
    if (get().switchingId) return;
    const target = get().clientTarget;
    set({ switchingId: account.id });
    try {
      const switchAccount = () => target === 'cli'
        ? api.switchAntigravityCli(account.id, launchOverride ?? false)
        : api.switchAccount(account.id, target, launchOverride, true);
      let updated: Account;
      try {
        updated = await switchAccount();
      } catch (error) {
        const pathError = /^APP_PATH_(NOT_FOUND|MISSING_AFTER_SWITCH):(antigravity|antigravity_legacy|antigravity_ide)$/.exec(String(error));
        if (!pathError || target === 'cli' || !launchOverride) throw error;
        const alreadySwitched = pathError[1] === 'MISSING_AFTER_SWITCH';
        if (alreadySwitched) await get().reloadAccounts();
        const { open } = await import('@tauri-apps/plugin-dialog');
        const path = await open({
          title: '选择 Antigravity 客户端程序',
          filters: [{ name: 'Windows 程序', extensions: ['exe'] }],
        });
        if (!path) return;
        await api.setAppPath(pathError[2], path, true);
        if (alreadySwitched) {
          await api.launchCurrentAntigravity(pathError[2] === 'antigravity_legacy' ? 'antigravity' : 'antigravity_ide');
          get().pushToast('账号已切换，客户端已启动', 'success');
          return;
        }
        updated = await switchAccount();
      }
      set((s) => ({
        currentAccountId: updated.id,
        accounts: s.accounts.map((entry) => entry.id === updated.id ? updated : entry),
      }));
      get().pushToast(`已切换至 ${updated.email}`, 'success');
    } catch (err) {
      await get().reloadAccounts();
      get().pushToast(`切号或启动失败：${String(err)}`, 'error');
    } finally {
      set({ switchingId: null });
    }
  },

  deleteAccountById: async (account) => {
    try {
      await api.deleteAccount(account.id);
      set((s) => ({
        accounts: s.accounts.filter((a) => a.id !== account.id),
        currentAccountId: s.currentAccountId === account.id ? null : s.currentAccountId,
      }));
      get().pushToast(`已删除 ${account.email}`, 'info');
    } catch (err) {
      get().pushToast(`删除失败：${String(err)}`, 'error');
    }
  },

  updateConfig: async (patch) => {
    try {
      await api.patchGeneralConfig(patch);
      const prev = get().generalConfig;
      if (prev) {
        set({ generalConfig: { ...prev, ...patch } });
      } else {
        await get().reloadConfigs();
      }
    } catch (err) {
      get().pushToast(`保存设置失败：${String(err)}`, 'error');
      throw err;
    }
  },
}));
