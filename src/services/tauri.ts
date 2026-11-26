import { invoke } from '@tauri-apps/api/core';
import type {
  Account,
  AntigravityRuntimeTarget,
  AntigravityVersionInfo,
  AvailableModel,
  CockpitTakeoverResult,
  ConversationDetail,
  DataDirectorySettings,
  DisplayGroup,
  FileImportResult,
  GeneralConfig,
  LaunchPathStatus,
  LocalHistoryRead,
  NetworkConfig,
  PersistedWakeupState,
  RefreshStats,
  SwitchHistoryItem,
  TokenUsageBundle,
  UpdateSettings,
  UsageRangePreset,
  WakeupHistoryItem,
  WakeupTaskInput,
  WakeupVerificationStateItem,
} from '../types';

// === 账号管理与切号 ===
export const listAccounts = () => invoke<Account[]>('list_accounts');

export const getCurrentAccount = (runtimeTarget?: AntigravityRuntimeTarget) =>
  invoke<Account | null>('get_current_account', { runtimeTarget });

export const addAccountWithToken = (refreshToken: string) =>
  invoke<Account>('add_account', { refreshToken });

export const deleteAccount = (accountId: string) =>
  invoke<void>('delete_account', { accountId });

export const deleteAccounts = (accountIds: string[]) =>
  invoke<void>('delete_accounts', { accountIds });

export const fetchAccountQuota = (accountId: string) =>
  invoke<Account>('fetch_account_quota', { accountId });

export const refreshAllQuotas = (
  trigger: 'manual' | 'auto' = 'manual',
  runtimeTarget?: AntigravityRuntimeTarget,
) => invoke<RefreshStats>('refresh_all_quotas', { trigger, runtimeTarget });

export const switchAccount = (
  accountId: string,
  runtimeTarget?: AntigravityRuntimeTarget,
  launch?: boolean,
  inlinePathRecovery?: boolean,
) => invoke<Account>('switch_account', { accountId, runtimeTarget, launch, inlinePathRecovery });

export const launchCurrentAntigravity = (runtimeTarget: AntigravityRuntimeTarget) =>
  invoke<void>('antigravity_launch_current', { runtimeTarget });

export const switchAntigravityCli = (
  accountId: string,
  launch: boolean,
  options?: { workingDir?: string; terminal?: string; customCommand?: string },
) => invoke<Account>('switch_antigravity_cli', { accountId, launch, ...options });

export const launchAntigravityCli = (options?: {
  workingDir?: string;
  terminal?: string;
  customCommand?: string;
}) => invoke<void>('launch_antigravity_cli', { ...(options ?? {}) });

export const updateAccountNote = (accountId: string, note: string) =>
  invoke<Account>('update_account_note', { accountId, note });

export const updateAccountTags = (accountId: string, tags: string[]) =>
  invoke<Account>('update_account_tags', { accountId, tags });

interface RawHistoryRead<T> {
  records?: T[];
  items?: T[];
  corrupted?: boolean;
  migrationError?: string | null;
  error?: string | null;
}

function normalizeHistoryRead<T>(raw: RawHistoryRead<T>): LocalHistoryRead<T> {
  const error = raw.migrationError ?? raw.error ?? null;
  return {
    items: Array.isArray(raw.records)
      ? raw.records
      : Array.isArray(raw.items)
        ? raw.items
        : [],
    corrupted: raw.corrupted ?? Boolean(error),
    error,
  };
}

export const loadSwitchHistory = async (): Promise<LocalHistoryRead<SwitchHistoryItem>> =>
  normalizeHistoryRead(
    await invoke<RawHistoryRead<SwitchHistoryItem>>('load_antigravity_switch_history', {
      retry: false,
    }),
  );

export const clearSwitchHistory = () => invoke<void>('clear_antigravity_switch_history');

export const syncCurrentFromClient = () => invoke<string | null>('sync_current_from_client');

export const getDisplayGroups = () => invoke<DisplayGroup[]>('get_display_groups');

// === OAuth 登录 ===
export const prepareOAuthUrl = () => invoke<string>('prepare_oauth_url');
export const startOAuthLogin = () => invoke<Account>('start_oauth_login');
export const completeOAuthLogin = () => invoke<Account>('complete_oauth_login');
export const submitOAuthCallbackUrl = (callbackUrl: string) =>
  invoke<void>('submit_oauth_callback_url', { callbackUrl });
export const cancelOAuthLogin = () => invoke<void>('cancel_oauth_login');

// === 导入与导出 ===
export const importFromLocal = (runtimeTarget: AntigravityRuntimeTarget) =>
  invoke<Account>('import_from_local', { runtimeTarget });

export const importFromOldTools = () => invoke<Account[]>('import_from_old_tools');

export const importFromJson = (jsonContent: string) =>
  invoke<Account[]>('import_from_json', { jsonContent });

export const importFromFiles = (filePaths: string[]) =>
  invoke<FileImportResult>('import_from_files', { filePaths });

export const exportAccounts = (accountIds: string[]) =>
  invoke<string>('export_accounts', { accountIds });

// === 自动唤醒 ===
export const wakeupLoadState = () => invoke<PersistedWakeupState>('wakeup_load_state');

export const wakeupSyncState = (
  enabled: boolean,
  tasks: WakeupTaskInput[],
  expectedRulesRevision?: number,
) =>
  invoke<PersistedWakeupState>('wakeup_sync_state', {
    enabled,
    tasks,
    expectedRulesRevision,
  });

export const wakeupRunEnabledTasks = (triggerSource = 'manual') =>
  invoke<number>('wakeup_run_enabled_tasks', { triggerSource });

export const wakeupLoadHistory = async (): Promise<LocalHistoryRead<WakeupHistoryItem>> =>
  normalizeHistoryRead(
    await invoke<RawHistoryRead<WakeupHistoryItem>>('wakeup_load_history', { retry: false }),
  );

export const wakeupClearHistory = () => invoke<void>('wakeup_clear_history');

export const fetchAvailableModels = () => invoke<AvailableModel[]>('fetch_available_models');

export const wakeupValidateCrontab = (expr: string) =>
  invoke<void>('wakeup_validate_crontab', { expr });

export const wakeupVerificationLoadState = async (): Promise<
  LocalHistoryRead<WakeupVerificationStateItem>
> =>
  normalizeHistoryRead(
    await invoke<RawHistoryRead<WakeupVerificationStateItem>>('wakeup_verification_load_state', {
      retry: false,
    }),
  );

export const wakeupVerificationRunBatch = (
  accountIds: string[],
  model: string,
  prompt = 'hi',
) =>
  invoke<{ total: number; successCount: number; failedCount: number }>(
    'wakeup_verification_run_batch',
    { accountIds, model, prompt },
  );

// === Token 用量 ===
export const queryTokenUsage = (preset: UsageRangePreset) =>
  invoke<TokenUsageBundle>('antigravity_query_token_usage', {
    query: {
      preset,
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
      page: 1,
      pageSize: 30,
    },
  });

export const syncTokenUsage = (preset: UsageRangePreset, rebuild = false) =>
  invoke<TokenUsageBundle>('antigravity_sync_token_usage', {
    rebuild,
    query: {
      preset,
      tzOffsetMinutes: -new Date().getTimezoneOffset(),
      page: 1,
      pageSize: 30,
    },
  });

export const getConversationTokenDetail = (conversationId: string) =>
  invoke<{ conversation: ConversationDetail }>('antigravity_get_conversation_token_detail', {
    conversationId,
  });

// === 系统、配置、路径与接管 ===
export const getGeneralConfig = () => invoke<GeneralConfig>('get_general_config');

export const patchGeneralConfig = (updates: Partial<GeneralConfig>) =>
  invoke<void>('patch_general_config', { updates });

export const getNetworkConfig = () => invoke<NetworkConfig>('get_network_config');

export const saveNetworkConfig = (payload: {
  wsEnabled: boolean;
  wsPort: number;
  globalProxyEnabled: boolean;
  globalProxyUrl: string;
  globalProxyNoProxy: string;
}) => invoke<{ needsRestart: boolean }>('save_network_config', payload);

export const getDataDirectorySettings = () =>
  invoke<DataDirectorySettings>('get_data_directory_settings');

export const takeoverCockpitToolsDataDir = (force = false) =>
  invoke<CockpitTakeoverResult>('takeover_cockpit_tools_data_dir', { force });

export const resetDataDirectoryToDefault = () =>
  invoke<DataDirectorySettings>('reset_data_directory_to_default');

export const openDataFolder = () => invoke<void>('open_data_folder');
export const openFolder = (path: string) => invoke<void>('open_folder', { path });
export const saveTextFile = (path: string, content: string) =>
  invoke<void>('save_text_file', { path, content });

export const getAvailableTerminals = () => invoke<string[]>('get_available_terminals');

export const scanAutoLocalImport = () =>
  invoke<{ scanned: number; imported: number; failed: number }>('scan_auto_local_import');

export const getPlatformLaunchPath = (app: string) =>
  invoke<LaunchPathStatus>('get_platform_launch_path', { app });

export const setAppPath = (app: string, path: string, validate = true) =>
  invoke<void>('set_app_path', { app, path, validate });

export const saveCliLaunchPath = (app: string, path: string) =>
  invoke<void>('save_cli_launch_path', { app, path });

export const detectAppPath = (app: string, force = true) =>
  invoke<string | null>('detect_app_path', { app, force });

export const getAntigravityVersionInfo = (target?: AntigravityRuntimeTarget) =>
  invoke<AntigravityVersionInfo | null>('get_antigravity_installed_version_info', {
    target,
    scanMode: 'quick',
  });

export const handleWindowClose = (action: 'minimize' | 'quit', remember: boolean) =>
  invoke<void>('handle_window_close', { action, remember });

export const relaunchApp = () => invoke<void>('relaunch_app');

export const openLogsDir = () => invoke<void>('logs_open_log_directory');

// === 自动更新 ===
export const getUpdateSettings = () => invoke<UpdateSettings>('get_update_settings');
export const patchUpdateSettings = (patch: Partial<{
  autoCheck: boolean;
  checkIntervalHours: number;
  autoInstall: boolean;
  remindOnUpdate: boolean;
}>) => invoke<UpdateSettings>('patch_update_settings', patch);
export const updateLastCheckTime = () => invoke<void>('update_last_check_time');
export const relaunchAfterUpdate = () => invoke<void>('relaunch_after_update');

export const inspectCliLaunchPath = (app: string, detect = true) =>
  invoke<string | null>('inspect_cli_launch_path', { app, detect });
export const mainWindowTakePendingNavigation = () =>
  invoke<string | null>('main_window_take_pending_navigation');
