import { useCallback, useEffect, useState } from 'react';
import {
  CheckCircle2,
  ExternalLink,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useAppStore } from '../stores/useAppStore';
import * as api from '../services/tauri';
import type {
  AvailableModel,
  PersistedWakeupState,
  WakeupHistoryItem,
  WakeupTaskInput,
  WakeupVerificationStateItem,
} from '../types';
import { formatDateTime } from '../utils/format';

type WakeupSubTab = 'tasks' | 'history' | 'verify';

export function WakeupView() {
  const accounts = useAppStore((s) => s.accounts);
  const pushToast = useAppStore((s) => s.pushToast);

  const [subTab, setSubTab] = useState<WakeupSubTab>('tasks');
  const [state, setState] = useState<PersistedWakeupState>({ enabled: false, tasks: [] });
  const [history, setHistory] = useState<WakeupHistoryItem[]>([]);
  const [verifications, setVerifications] = useState<WakeupVerificationStateItem[]>([]);
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);

  // 新建任务表单
  const [creating, setCreating] = useState(false);
  const [taskName, setTaskName] = useState('每日定时唤醒');
  const [repeatMode, setRepeatMode] = useState<'daily' | 'interval' | 'crontab'>('daily');
  const [dailyTime, setDailyTime] = useState('08:30');
  const [intervalHours, setIntervalHours] = useState(4);
  const [crontab, setCrontab] = useState('30 8 * * *');
  const [wakeOnReset, setWakeOnReset] = useState(false);
  const [selectedModel, setSelectedModel] = useState('gemini-3-flash');
  const [selectedAccountIds, setSelectedAccountIds] = useState<string[]>([]);

  // 批量验证状态
  const [verifyModel, setVerifyModel] = useState('gemini-3-flash');
  const [verifying, setVerifying] = useState(false);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [ws, hist, ver, avail] = await Promise.all([
        api.wakeupLoadState(),
        api.wakeupLoadHistory().catch(() => ({ items: [] as WakeupHistoryItem[] })),
        api
          .wakeupVerificationLoadState()
          .catch(() => ({ items: [] as WakeupVerificationStateItem[] })),
        api.fetchAvailableModels().catch(() => [] as AvailableModel[]),
      ]);
      setState(ws);
      setHistory(hist.items ?? []);
      setVerifications(ver.items ?? []);
      if (avail.length > 0) {
        setModels(avail);
        setSelectedModel((prev) =>
          avail.some((m) => m.id === prev) ? prev : avail[0].id,
        );
        setVerifyModel((prev) =>
          avail.some((m) => m.id === prev) ? prev : avail[0].id,
        );
      }
    } catch (err) {
      pushToast(`加载唤醒状态失败：${String(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const syncWakeup = async (nextEnabled: boolean, nextTasks: WakeupTaskInput[]) => {
    try {
      const updated = await api.wakeupSyncState(nextEnabled, nextTasks, state.rulesRevision);
      setState(updated);
    } catch (err) {
      pushToast(`保存唤醒配置失败：${String(err)}`, 'error');
    }
  };

  const handleToggleMaster = async () => {
    await syncWakeup(!state.enabled, state.tasks);
    pushToast(!state.enabled ? '已启用自动唤醒调度' : '已暂停自动唤醒调度', 'info');
  };

  const handleRunNow = async () => {
    setRunning(true);
    try {
      const count = await api.wakeupRunEnabledTasks('manual');
      pushToast(count > 0 ? `已触发 ${count} 个唤醒任务` : '当前没有可执行的启用任务', 'success');
      setTimeout(() => void loadAll(), 1500);
    } catch (err) {
      pushToast(`触发唤醒失败：${String(err)}`, 'error');
    } finally {
      setRunning(false);
    }
  };

  const handleCreateTask = async () => {
    const targetAccounts =
      selectedAccountIds.length > 0
        ? selectedAccountIds
        : accounts.map((a) => a.email);
    if (targetAccounts.length === 0) {
      pushToast('请先添加至少一个账号', 'error');
      return;
    }
    if (repeatMode === 'crontab') {
      try {
        await api.wakeupValidateCrontab(crontab);
      } catch (err) {
        pushToast(`Crontab 表达式无效：${String(err)}`, 'error');
        return;
      }
    }
    const newTask: WakeupTaskInput = {
      id: `task-${Date.now()}`,
      name: taskName.trim() || '唤醒任务',
      enabled: true,
      createdAt: Date.now(),
      schedule: {
        repeatMode,
        dailyTimes: repeatMode === 'daily' ? [dailyTime] : undefined,
        intervalHours: repeatMode === 'interval' ? intervalHours : undefined,
        crontab: repeatMode === 'crontab' ? crontab.trim() : null,
        wakeOnReset,
        selectedModels: [selectedModel],
        selectedAccounts: targetAccounts,
        customPrompt: 'hi',
        maxOutputTokens: 0,
      },
    };
    await syncWakeup(true, [...state.tasks, newTask]);
    setCreating(false);
    pushToast(`已添加唤醒任务「${newTask.name}」`, 'success');
  };

  const handleToggleTask = async (taskId: string) => {
    const next = state.tasks.map((t) =>
      t.id === taskId ? { ...t, enabled: !t.enabled } : t,
    );
    await syncWakeup(state.enabled, next);
  };

  const handleDeleteTask = async (taskId: string) => {
    const next = state.tasks.filter((t) => t.id !== taskId);
    await syncWakeup(state.enabled, next);
    pushToast('已删除唤醒任务', 'info');
  };

  const handleClearHistory = async () => {
    try {
      await api.wakeupClearHistory();
      setHistory([]);
      pushToast('已清空唤醒历史', 'info');
    } catch (err) {
      pushToast(`清空历史失败：${String(err)}`, 'error');
    }
  };

  const handleRunVerifyBatch = async () => {
    if (accounts.length === 0) {
      pushToast('没有可验证的账号', 'error');
      return;
    }
    setVerifying(true);
    try {
      const res = await api.wakeupVerificationRunBatch(
        accounts.map((a) => a.id),
        verifyModel,
      );
      pushToast(
        `批量验证完成：成功 ${res.successCount}/${res.total}，异常 ${res.failedCount}`,
        res.failedCount > 0 ? 'info' : 'success',
      );
      await loadAll();
    } catch (err) {
      pushToast(`批量验证失败：${String(err)}`, 'error');
    } finally {
      setVerifying(false);
    }
  };

  const toggleAccountSelection = (email: string) => {
    setSelectedAccountIds((prev) =>
      prev.includes(email) ? prev.filter((e) => e !== email) : [...prev, email],
    );
  };

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* 顶部控制条 */}
      <div className="shrink-0 space-y-2.5 border-b border-zinc-200/75 bg-white/70 px-3.5 py-3 dark:border-white/[0.07] dark:bg-[#111215]/70">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <button
              type="button"
              role="switch"
              aria-checked={state.enabled}
              onClick={() => void handleToggleMaster()}
              className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
                state.enabled ? 'bg-[#5E6AD2]' : 'bg-zinc-300 dark:bg-white/[0.14]'
              }`}
            >
              <span
                className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${
                  state.enabled ? 'translate-x-4' : 'translate-x-1'
                }`}
              />
            </button>
            <span className="text-[12.5px] font-medium text-zinc-800 dark:text-zinc-200">
              自动唤醒调度
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              disabled={running || state.tasks.length === 0}
              onClick={() => void handleRunNow()}
              className="flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2 text-[11.5px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.09] dark:bg-white/[0.05] dark:text-zinc-200"
            >
              <Play className="h-3 w-3" />
              {running ? '执行中…' : '立即执行'}
            </button>
            <button
              type="button"
              onClick={() => {
                setSubTab('tasks');
                setCreating((v) => !v);
              }}
              className="flex h-7 items-center gap-1 rounded-md bg-[#5E6AD2] px-2.5 text-[11.5px] font-medium text-white hover:bg-[#4F5BC4]"
            >
              <Plus className="h-3.5 w-3.5" />
              新建
            </button>
          </div>
        </div>

        {/* 子标签 */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1">
            {(
              [
                ['tasks', `定时任务 (${state.tasks.length})`],
                ['history', `历史 (${history.length})`],
                ['verify', '批量验证'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSubTab(id)}
                className={`rounded-md px-2.5 py-1 text-[11.5px] font-medium transition-colors ${
                  subTab === id
                    ? 'bg-zinc-900 text-white dark:bg-white dark:text-zinc-900'
                    : 'text-zinc-500 hover:bg-zinc-100 hover:text-zinc-800 dark:text-zinc-400 dark:hover:bg-white/[0.06]'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void loadAll()}
            className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
            title="刷新"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 主体内容 */}
      <div className="flex-1 overflow-y-auto px-3.5 py-3">
        {subTab === 'tasks' && (
          <div className="space-y-2.5">
            {creating && (
              <div className="space-y-2.5 rounded-xl border border-[#5E6AD2]/40 bg-white p-3 shadow-sm dark:bg-[#141518]">
                <div className="text-[12.5px] font-semibold text-zinc-900 dark:text-zinc-100">
                  新建唤醒任务
                </div>
                <input
                  type="text"
                  value={taskName}
                  onChange={(e) => setTaskName(e.target.value)}
                  placeholder="任务名称"
                  className="h-8 w-full rounded-md border border-zinc-200 bg-zinc-50 px-2.5 text-[12px] outline-none focus:border-[#5E6AD2] dark:border-white/[0.1] dark:bg-white/[0.04]"
                />
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={repeatMode}
                    onChange={(e) => setRepeatMode(e.target.value as 'daily' | 'interval' | 'crontab')}
                    className="h-8 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[12px] outline-none dark:border-white/[0.1] dark:bg-[#1B1D22]"
                  >
                    <option value="daily">每天定时</option>
                    <option value="interval">固定间隔</option>
                    <option value="crontab">Crontab 表达式</option>
                  </select>

                  {repeatMode === 'daily' && (
                    <input
                      type="time"
                      value={dailyTime}
                      onChange={(e) => setDailyTime(e.target.value)}
                      className="h-8 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[12px] outline-none dark:border-white/[0.1] dark:bg-white/[0.04]"
                    />
                  )}
                  {repeatMode === 'interval' && (
                    <div className="flex items-center gap-1">
                      <span className="text-[11.5px] text-zinc-500">每</span>
                      <input
                        type="number"
                        min={1}
                        max={24}
                        value={intervalHours}
                        onChange={(e) => setIntervalHours(Number(e.target.value) || 4)}
                        className="h-8 w-16 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[12px] outline-none dark:border-white/[0.1] dark:bg-white/[0.04]"
                      />
                      <span className="text-[11.5px] text-zinc-500">小时</span>
                    </div>
                  )}
                  {repeatMode === 'crontab' && (
                    <input
                      type="text"
                      value={crontab}
                      onChange={(e) => setCrontab(e.target.value)}
                      placeholder="30 8 * * *"
                      className="h-8 rounded-md border border-zinc-200 bg-zinc-50 px-2 font-mono text-[11.5px] outline-none dark:border-white/[0.1] dark:bg-white/[0.04]"
                    />
                  )}
                </div>

                <div className="flex items-center justify-between gap-2">
                  <label className="text-[11.5px] text-zinc-500">唤醒模型</label>
                  <select
                    value={selectedModel}
                    onChange={(e) => setSelectedModel(e.target.value)}
                    className="h-7 max-w-[240px] rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[11.5px] outline-none dark:border-white/[0.1] dark:bg-[#1B1D22]"
                  >
                    {models.length > 0 ? (
                      models.map((m) => (
                        <option key={m.id} value={m.id}>
                          {m.displayName || m.display_name || m.id}
                        </option>
                      ))
                    ) : (
                      <option value="gemini-3-flash">gemini-3-flash</option>
                    )}
                  </select>
                </div>

                <label className="flex items-center gap-2 text-[11.5px] text-zinc-600 dark:text-zinc-300">
                  <input
                    type="checkbox"
                    checked={wakeOnReset}
                    onChange={(e) => setWakeOnReset(e.target.checked)}
                    className="rounded border-zinc-300 text-[#5E6AD2]"
                  />
                  配额重置时自动触发唤醒
                </label>

                {accounts.length > 0 && (
                  <div className="space-y-1">
                    <div className="text-[11px] text-zinc-500">
                      目标账号（留空默认全部 {accounts.length} 个账号）
                    </div>
                    <div className="flex max-h-24 flex-wrap gap-1 overflow-y-auto">
                      {accounts.map((acc) => {
                        const checked = selectedAccountIds.includes(acc.email);
                        return (
                          <button
                            key={acc.id}
                            type="button"
                            onClick={() => toggleAccountSelection(acc.email)}
                            className={`rounded-md border px-2 py-0.5 text-[11px] transition-colors ${
                              checked
                                ? 'border-[#5E6AD2] bg-[#5E6AD2]/10 text-[#5E6AD2] dark:text-indigo-300'
                                : 'border-zinc-200 text-zinc-600 dark:border-white/[0.08] dark:text-zinc-400'
                            }`}
                          >
                            {acc.email}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="flex justify-end gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => setCreating(false)}
                    className="rounded-md px-2.5 py-1 text-[12px] text-zinc-500 hover:bg-zinc-100 dark:hover:bg-white/[0.06]"
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleCreateTask()}
                    className="rounded-md bg-[#5E6AD2] px-3 py-1 text-[12px] font-medium text-white hover:bg-[#4F5BC4]"
                  >
                    保存任务
                  </button>
                </div>
              </div>
            )}

            {state.tasks.length === 0 ? (
              <div className="flex h-40 flex-col items-center justify-center text-center text-zinc-400">
                <p className="text-[12.5px]">还没有配置自动唤醒任务</p>
                <p className="mt-1 text-[11px]">点击右上角「新建」定时触发账号活跃，防止额度休眠</p>
              </div>
            ) : (
              state.tasks.map((task) => (
                <div
                  key={task.id}
                  className="flex items-start justify-between gap-2 rounded-xl border border-zinc-200/80 bg-white p-3 dark:border-white/[0.08] dark:bg-[#141518]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-medium text-zinc-900 dark:text-zinc-100">
                        {task.name}
                      </span>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10.5px] text-zinc-600 dark:bg-white/[0.07] dark:text-zinc-300">
                        {describeSchedule(task)}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-2 text-[11px] text-zinc-500 dark:text-zinc-400">
                      <span>模型：{task.schedule.selectedModels.join(', ') || '默认'}</span>
                      <span>账号：{task.schedule.selectedAccounts.length} 个</span>
                      {task.lastRunAt && <span>上次：{formatDateTime(task.lastRunAt)}</span>}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={task.enabled}
                      onClick={() => void handleToggleTask(task.id)}
                      className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                        task.enabled ? 'bg-[#5E6AD2]' : 'bg-zinc-300 dark:bg-white/[0.15]'
                      }`}
                    >
                      <span
                        className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${
                          task.enabled ? 'translate-x-3.5' : 'translate-x-0.5'
                        }`}
                      />
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleDeleteTask(task.id)}
                      className="flex h-6 w-6 items-center justify-center rounded text-zinc-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-500/10 dark:hover:text-rose-400"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {subTab === 'history' && (
          <div className="space-y-2">
            {history.length > 0 && (
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={() => void handleClearHistory()}
                  className="text-[11px] text-zinc-400 hover:text-rose-500"
                >
                  清空记录
                </button>
              </div>
            )}
            {history.length === 0 ? (
              <div className="flex h-40 items-center justify-center text-[12.5px] text-zinc-400">
                暂无唤醒历史记录
              </div>
            ) : (
              history.map((item) => (
                <div
                  key={item.id}
                  className="flex items-start justify-between gap-2 rounded-lg border border-zinc-200/75 bg-white px-3 py-2 dark:border-white/[0.07] dark:bg-[#141518]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      {item.success ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
                      )}
                      <span className="truncate text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
                        {item.accountEmail}
                      </span>
                      <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500 dark:bg-white/[0.06] dark:text-zinc-400">
                        {item.modelId}
                      </span>
                    </div>
                    {item.message && (
                      <p className="mt-0.5 truncate text-[11px] text-zinc-500 dark:text-zinc-400">
                        {item.message}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right tabular-nums text-[10.5px] text-zinc-400">
                    <div>{formatDateTime(item.timestamp)}</div>
                    {item.duration != null && <div>{item.duration}ms</div>}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {subTab === 'verify' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-zinc-200/80 bg-white p-3 dark:border-white/[0.08] dark:bg-[#141518]">
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-4 w-4 text-[#5E6AD2]" />
                <select
                  value={verifyModel}
                  onChange={(e) => setVerifyModel(e.target.value)}
                  className="h-7 rounded-md border border-zinc-200 bg-zinc-50 px-2 text-[11.5px] outline-none dark:border-white/[0.1] dark:bg-[#1B1D22]"
                >
                  {models.length > 0 ? (
                    models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.displayName || m.display_name || m.id}
                      </option>
                    ))
                  ) : (
                    <option value="gemini-3-flash">gemini-3-flash</option>
                  )}
                </select>
              </div>
              <button
                type="button"
                disabled={verifying || accounts.length === 0}
                onClick={() => void handleRunVerifyBatch()}
                className="rounded-lg bg-[#5E6AD2] px-3 py-1.5 text-[11.5px] font-medium text-white hover:bg-[#4F5BC4] disabled:opacity-50"
              >
                {verifying ? '验证中…' : `批量检测 (${accounts.length})`}
              </button>
            </div>

            {verifications.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-[12px] text-zinc-400">
                点击「批量检测」可检查全部账号是否需要人工验证或授权过期
              </div>
            ) : (
              <div className="space-y-1.5">
                {verifications.map((item) => (
                  <div
                    key={item.accountId}
                    className="flex items-center justify-between gap-2 rounded-lg border border-zinc-200/75 bg-white px-3 py-2 dark:border-white/[0.07] dark:bg-[#141518]"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
                        {item.accountEmail}
                      </div>
                      {item.lastMessage && (
                        <div className="truncate text-[11px] text-zinc-400">{item.lastMessage}</div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <VerifyStatusBadge status={item.status} />
                      {item.validationUrl && (
                        <button
                          type="button"
                          onClick={() => void openUrl(item.validationUrl!)}
                          title="打开验证链接"
                          className="rounded p-1 text-[#5E6AD2] hover:bg-indigo-50 dark:hover:bg-indigo-500/15"
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function describeSchedule(task: WakeupTaskInput): string {
  const s = task.schedule;
  if (s.repeatMode === 'daily') return `每天 ${s.dailyTimes?.[0] ?? ''}`;
  if (s.repeatMode === 'interval') return `每 ${s.intervalHours ?? 4} 小时`;
  if (s.repeatMode === 'crontab') return s.crontab || 'Crontab';
  if (s.wakeOnReset) return '重置触发';
  return s.repeatMode;
}

function VerifyStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    success: {
      label: '正常',
      cls: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
    },
    verification_required: {
      label: '需验证',
      cls: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
    },
    tos_violation: {
      label: '受限',
      cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    },
    auth_expired: {
      label: '授权过期',
      cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    },
    failed: {
      label: '失败',
      cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
    },
    idle: {
      label: '未检测',
      cls: 'bg-zinc-200/70 text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-400',
    },
  };
  const badge = map[status] ?? map.idle;
  return (
    <span className={`rounded px-1.5 py-0.5 text-[10.5px] font-medium ${badge.cls}`}>
      {badge.label}
    </span>
  );
}
