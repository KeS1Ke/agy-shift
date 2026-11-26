export type AntigravityRuntimeTarget = 'antigravity' | 'antigravity_ide';
export type AntigravityClientTarget = AntigravityRuntimeTarget | 'cli';
export type MainTab = 'accounts' | 'wakeup' | 'usage';
export type ThemeMode = 'system' | 'light' | 'dark';
export type CloseWindowBehavior = 'ask' | 'minimize' | 'quit';

export interface TokenData {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expiry_timestamp: number;
  token_type: string;
  email?: string;
  project_id?: string;
  is_gcp_tos?: boolean;
  session_id?: string;
}

export interface ModelQuota {
  name: string;
  display_name?: string;
  percentage: number;
  reset_time: string;
  summary_exhausted?: boolean;
}

export interface CreditInfo {
  credit_type: string;
  credit_amount?: string;
  minimum_credit_amount_for_usage?: string;
}

export interface QuotaErrorInfo {
  code?: number;
  message: string;
  reason?: string;
  validation_url?: string;
  timestamp: number;
}

export interface QuotaData {
  models: ModelQuota[];
  last_updated: number;
  quota_summary_stale?: boolean;
  quota_summary_updated_at?: number;
  is_forbidden?: boolean;
  subscription_tier?: string;
  credits?: CreditInfo[];
  tier_id?: string;
  is_gcp_tos?: boolean;
  project_id?: string;
}

export interface Account {
  id: string;
  email: string;
  name?: string;
  tags?: string[];
  notes?: string;
  pending_oauth?: boolean;
  token?: TokenData;
  quota?: QuotaData;
  quota_error?: QuotaErrorInfo;
  disabled?: boolean;
  disabled_reason?: string;
  disabled_at?: number;
  protected_models?: string[];
  created_at: number;
  last_used: number;
  last_switched_at?: number | null;
}

export interface RefreshStats {
  total: number;
  success: number;
  failed: number;
  details: string[];
}

export interface DisplayGroup {
  id: string;
  name: string;
  models: string[];
}

export interface FileImportResult {
  imported: Account[];
  failed: { email: string; error: string }[];
}

export interface SwitchHistoryItem {
  id: string;
  timestamp: number;
  accountId: string;
  targetEmail: string;
  triggerType?: string;
  triggerSource?: string;
  localOk: boolean;
  seamlessOk: boolean;
  success: boolean;
  localDurationMs: number;
  seamlessDurationMs?: number | null;
  totalDurationMs: number;
  errorStage?: string | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  seamlessEffectiveMode?: string | null;
}

export interface LocalHistoryRead<T> {
  items: T[];
  corrupted?: boolean;
  error?: string | null;
}

export interface GeneralConfig {
  default_terminal: string;
  theme: string;
  reduced_motion_enabled: boolean;
  ui_scale: number;
  auto_refresh_minutes: number;
  close_behavior: 'ask' | 'minimize' | 'quit' | string;
  show_tray_icon: boolean;
  startup_minimized: boolean;
  remember_main_window_state: boolean;
  app_auto_launch_enabled: boolean;
  auto_import_from_local_enabled: boolean;
  antigravity_startup_wakeup_enabled: boolean;
  antigravity_startup_wakeup_delay_seconds: number;
  antigravity_app_path: string;
  antigravity_legacy_app_path: string;
  antigravity_cli_path: string;
  antigravity_launch_on_switch: boolean;
  antigravity_dual_switch_no_restart_enabled: boolean;
  auto_switch_enabled: boolean;
  auto_switch_threshold: number;
  auto_switch_credits_enabled: boolean;
  auto_switch_credits_threshold: number;
  auto_switch_window_thresholds_enabled: boolean;
  auto_switch_five_hour_threshold: number;
  auto_switch_weekly_threshold: number;
  auto_switch_scope_mode: string;
  auto_switch_selected_group_ids: string[];
  auto_switch_account_scope_mode: string;
  auto_switch_selected_account_ids: string[];
  quota_alert_enabled: boolean;
  quota_alert_threshold: number;
}

export interface NetworkConfig {
  ws_enabled: boolean;
  ws_port: number;
  actual_port: number | null;
  default_port: number;
  global_proxy_enabled: boolean;
  global_proxy_url: string;
  global_proxy_no_proxy: string;
}

export interface DataDirectorySettings {
  activeDir: string;
  defaultDir: string;
  configuredDir: string | null;
  cockpitToolsDir: string;
  cockpitToolsExists: boolean;
  isUsingCockpitTools: boolean;
  isDevProfile: boolean;
  envOverride: string | null;
  needsRestart: boolean;
}

export interface CockpitTakeoverResult {
  targetDir: string;
  backupDir: string;
  backedUpFiles: number;
  needsRestart: boolean;
}

export interface AntigravityVersionInfo {
  product_name: string;
  version: string;
  app_path: string;
  source: string;
}

export interface LaunchPathStatus {
  configuredPath: string | null;
  resolvedPath: string | null;
  usesConfiguredPath: boolean;
}

export interface UpdateSettings {
  auto_check: boolean;
  last_check_time: number;
  check_interval_hours: number;
  auto_install: boolean;
  last_run_version: string;
  remind_on_update: boolean;
  skipped_version: string;
}

// === 自动唤醒 ===
export interface ScheduleConfig {
  repeatMode: string;
  dailyTimes?: string[];
  weeklyDays?: number[];
  weeklyTimes?: string[];
  intervalHours?: number;
  intervalStartTime?: string;
  intervalEndTime?: string;
  selectedModels: string[];
  selectedAccounts: string[];
  crontab?: string | null;
  wakeOnReset?: boolean;
  weeklyResetOnly?: boolean;
  customPrompt?: string | null;
  maxOutputTokens?: number | null;
  timeWindowEnabled?: boolean;
  timeWindowStart?: string | null;
  timeWindowEnd?: string | null;
  fallbackTimes?: string[];
  startupDelayMinutes?: number | null;
  executionMode?: string | null;
  confirmTimeoutMinutes?: number | null;
}

export interface WakeupTaskInput {
  id: string;
  name: string;
  enabled: boolean;
  lastRunAt?: number | null;
  createdAt: number;
  executionMode?: string | null;
  confirmTimeoutMinutes?: number | null;
  schedule: ScheduleConfig;
}

export interface PersistedWakeupState {
  enabled: boolean;
  tasks: WakeupTaskInput[];
  webviewSeeded?: boolean;
  rulesRevision?: number;
}

export interface WakeupHistoryItem {
  id: string;
  timestamp: number;
  triggerType: string;
  triggerSource: string;
  taskName?: string | null;
  accountEmail: string;
  modelId: string;
  prompt?: string | null;
  success: boolean;
  status?: string | null;
  message?: string | null;
  duration?: number | null;
}

export interface WakeupVerificationStateItem {
  accountId: string;
  accountEmail: string;
  status: string;
  lastVerifyAt?: number | null;
  lastModel?: string | null;
  lastErrorCode?: number | null;
  lastMessage?: string | null;
  validationUrl?: string | null;
  appealUrl?: string | null;
  durationMs?: number | null;
}

export interface AvailableModel {
  id: string;
  displayName?: string;
  display_name?: string;
  modelConstant?: string;
}

// === Token 用量 ===
export type UsageRangePreset = 'today' | '7d' | '30d' | 'month' | 'all';

export interface ExactTokenTotals {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
}

export interface EstimatedTokenTotals {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  estimatedTurnCount: number;
}

export interface ModelUsageSummary {
  modelId: string;
  modelDisplayName: string;
  apiProvider: string;
  conversationCount: number;
  turnCount: number;
  exact: ExactTokenTotals;
  estimatedTotalTokens: number;
  sharePercent: number;
}

export interface TimeBucketPoint {
  bucketKey: string;
  label: string;
  startDate: string;
  endDate: string;
  turnCount: number;
  conversationCount: number;
  exact: ExactTokenTotals;
  estimatedTotalTokens: number;
}

export interface ConversationSummaryItem {
  conversationId: string;
  title: string;
  displayTitle: string;
  preview: string;
  kind: 'main' | 'swarm' | 'subagent';
  workspaceName: string;
  lastModifiedTime: string;
  stepCount: number;
  turnCount: number;
  primaryModelDisplayName: string;
  exact: ExactTokenTotals;
  estimated: EstimatedTokenTotals;
}

export interface ConversationModelSlice {
  modelId: string;
  modelDisplayName: string;
  turnCount: number;
  exact: ExactTokenTotals;
  estimatedTotalTokens: number;
}

export interface ConversationDetail extends ConversationSummaryItem {
  modelBreakdown: ConversationModelSlice[];
  turns: Array<{
    stepIndex: number;
    timestamp: string | null;
    modelDisplayName: string;
    isExact: boolean;
    exact: ExactTokenTotals;
    estimated: { inputTokens: number; outputTokens: number; totalTokens: number };
  }>;
}

export interface TokenUsageBundle {
  summary: {
    scan: {
      dataDir: string;
      dataDirExists: boolean;
      scannedAt: string;
      scanDurationMs: number;
      warnings: string[];
    };
    kpi: {
      exact: ExactTokenTotals;
      estimated: EstimatedTokenTotals;
      totalConversations: number;
      totalTurns: number;
      exactCoveragePercent: number;
      activeDays: number;
      avgExactTokensPerActiveDay: number;
      avgExactTokensPerConversation: number;
    };
    timeSeries: TimeBucketPoint[];
    byModel: ModelUsageSummary[];
  };
  conversations: {
    items: ConversationSummaryItem[];
    totalItems: number;
    page: number;
    totalPages: number;
  };
  settings: {
    customDataDir: string | null;
    effectiveDataDir: string;
    defaultDataDir: string;
    isCustomDataDir: boolean;
  };
}
