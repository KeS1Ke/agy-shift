import { useCallback, useEffect, useState } from 'react';
import { BarChart3, ChevronRight, RefreshCw, X } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';
import * as api from '../services/tauri';
import type { ConversationDetail, TokenUsageBundle, UsageRangePreset } from '../types';
import { formatDateTime, formatTokens } from '../utils/format';

const RANGE_OPTIONS: { id: UsageRangePreset; label: string }[] = [
  { id: 'today', label: '今日' },
  { id: '7d', label: '7天' },
  { id: '30d', label: '30天' },
  { id: 'month', label: '本月' },
  { id: 'all', label: '全部' },
];

export function UsageView() {
  const pushToast = useAppStore((s) => s.pushToast);
  const [range, setRange] = useState<UsageRangePreset>('30d');
  const [bundle, setBundle] = useState<TokenUsageBundle | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);

  const loadUsage = useCallback(
    async (preset: UsageRangePreset) => {
      setLoading(true);
      try {
        const res = await api.queryTokenUsage(preset);
        setBundle(res);
      } catch (err) {
        pushToast(`加载 Token 用量失败：${String(err)}`, 'error');
      } finally {
        setLoading(false);
      }
    },
    [pushToast],
  );

  useEffect(() => {
    void loadUsage(range);
  }, [loadUsage, range]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const res = await api.syncTokenUsage(range, false);
      setBundle(res);
      pushToast(`同步完成（耗时 ${res.summary.scan.scanDurationMs}ms）`, 'success');
    } catch (err) {
      pushToast(`同步用量失败：${String(err)}`, 'error');
    } finally {
      setSyncing(false);
    }
  };

  const handleOpenDetail = async (conversationId: string) => {
    setLoadingDetail(true);
    try {
      const res = await api.getConversationTokenDetail(conversationId);
      setDetail(res.conversation);
    } catch (err) {
      pushToast(`读取会话明细失败：${String(err)}`, 'error');
    } finally {
      setLoadingDetail(false);
    }
  };

  const kpi = bundle?.summary.kpi;
  const models = bundle?.summary.byModel ?? [];
  const series = bundle?.summary.timeSeries ?? [];
  const conversations = bundle?.conversations.items ?? [];
  const maxSeriesTokens = series.reduce((m, p) => Math.max(m, p.exact.totalTokens), 1);

  return (
    <div className="relative flex h-full flex-col overflow-hidden">
      {/* 顶部时间范围 + 同步 */}
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200/75 bg-white/70 px-3.5 py-2.5 dark:border-white/[0.07] dark:bg-[#111215]/70">
        <div className="flex items-center rounded-lg border border-zinc-200/80 bg-zinc-100/70 p-0.5 dark:border-white/[0.07] dark:bg-white/[0.03]">
          {RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setRange(opt.id)}
              className={`rounded-md px-2 py-1 text-[11.5px] font-medium transition-colors ${
                range === opt.id
                  ? 'bg-white text-zinc-900 shadow-sm dark:bg-white/[0.11] dark:text-white'
                  : 'text-zinc-500 hover:text-zinc-800 dark:text-zinc-400'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          disabled={syncing}
          onClick={() => void handleSync()}
          className="flex h-7 items-center gap-1 rounded-md border border-zinc-200 bg-white px-2.5 text-[11.5px] font-medium text-zinc-700 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.09] dark:bg-white/[0.04] dark:text-zinc-200"
        >
          <RefreshCw className={`h-3 w-3 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? '同步中…' : '扫描同步'}
        </button>
      </div>

      {/* 主体内容 */}
      <div className="flex-1 space-y-3 overflow-y-auto px-3.5 py-3">
        {loading && !bundle ? (
          <div className="flex h-44 items-center justify-center text-[12.5px] text-zinc-400">
            正在统计本地 Antigravity Token 用量...
          </div>
        ) : !kpi || (kpi.totalConversations === 0 && kpi.exact.totalTokens === 0) ? (
          <div className="flex h-48 flex-col items-center justify-center text-center text-zinc-400">
            <BarChart3 className="h-8 w-8 opacity-40" />
            <p className="mt-2 text-[12.5px]">当前时间范围内暂无 Token 用量记录</p>
            <p className="mt-1 text-[11px]">
              数据目录：{bundle?.settings.effectiveDataDir || '自动探测'}
            </p>
          </div>
        ) : (
          <>
            {/* 2x2 KPI 卡片 */}
            <div className="grid grid-cols-2 gap-2">
              <KpiCard
                label="总精确 Token"
                value={formatTokens(kpi.exact.totalTokens)}
                sub={`输入 ${formatTokens(kpi.exact.inputTokens)} · 输出 ${formatTokens(kpi.exact.outputTokens)}`}
              />
              <KpiCard
                label="思考 / 缓存读取"
                value={formatTokens(kpi.exact.thinkingTokens)}
                sub={`缓存命中 ${formatTokens(kpi.exact.cacheReadTokens)}`}
              />
              <KpiCard
                label="会话 / 轮次"
                value={`${kpi.totalConversations} / ${kpi.totalTurns}`}
                sub={`精确覆盖 ${kpi.exactCoveragePercent.toFixed(0)}%`}
              />
              <KpiCard
                label="活跃日均"
                value={formatTokens(kpi.avgExactTokensPerActiveDay)}
                sub={`活跃 ${kpi.activeDays} 天 · 会话均 ${formatTokens(kpi.avgExactTokensPerConversation)}`}
              />
            </div>

            {/* 趋势迷你柱状图 */}
            {series.length > 1 && (
              <div className="rounded-xl border border-zinc-200/80 bg-white p-3 dark:border-white/[0.08] dark:bg-[#141518]">
                <div className="mb-2 flex items-center justify-between text-[11.5px] font-medium text-zinc-700 dark:text-zinc-300">
                  <span>用量趋势</span>
                  <span className="tabular-nums text-[10.5px] text-zinc-400">
                    峰值 {formatTokens(maxSeriesTokens)}
                  </span>
                </div>
                <div className="flex h-16 items-end gap-1">
                  {series.slice(-24).map((pt) => {
                    const ratio = Math.max(6, Math.round((pt.exact.totalTokens / maxSeriesTokens) * 100));
                    return (
                      <div
                        key={pt.bucketKey}
                        title={`${pt.label}: ${formatTokens(pt.exact.totalTokens)} (${pt.conversationCount} 会话)`}
                        className="group relative flex h-full flex-1 items-end"
                      >
                        <div
                          className="w-full rounded-t bg-[#5E6AD2]/75 transition-all group-hover:bg-[#5E6AD2] dark:bg-indigo-400/75"
                          style={{ height: `${ratio}%` }}
                        />
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* 按模型分布 */}
            {models.length > 0 && (
              <div className="rounded-xl border border-zinc-200/80 bg-white p-3 dark:border-white/[0.08] dark:bg-[#141518]">
                <div className="mb-2 text-[11.5px] font-medium text-zinc-700 dark:text-zinc-300">
                  模型消耗分布
                </div>
                <div className="space-y-2">
                  {models.slice(0, 6).map((m) => (
                    <div key={m.modelId} className="space-y-1">
                      <div className="flex items-center justify-between gap-2 text-[11.5px]">
                        <span className="truncate text-zinc-700 dark:text-zinc-200">
                          {m.modelDisplayName || m.modelId}
                        </span>
                        <span className="shrink-0 tabular-nums text-[11px] text-zinc-500 dark:text-zinc-400">
                          {formatTokens(m.exact.totalTokens)} ({m.sharePercent.toFixed(1)}%)
                        </span>
                      </div>
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-white/[0.07]">
                        <div
                          className="h-full rounded-full bg-[#5E6AD2] dark:bg-indigo-400"
                          style={{ width: `${Math.max(2, Math.min(100, m.sharePercent))}%` }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 最近会话列表 */}
            {conversations.length > 0 && (
              <div className="rounded-xl border border-zinc-200/80 bg-white p-3 dark:border-white/[0.08] dark:bg-[#141518]">
                <div className="mb-2 flex items-center justify-between text-[11.5px] font-medium text-zinc-700 dark:text-zinc-300">
                  <span>最近会话</span>
                  <span className="text-[10.5px] text-zinc-400">
                    共 {bundle.conversations.totalItems} 条
                  </span>
                </div>
                <div className="divide-y divide-zinc-100 dark:divide-white/[0.06]">
                  {conversations.slice(0, 15).map((conv) => (
                    <button
                      key={conv.conversationId}
                      type="button"
                      onClick={() => void handleOpenDetail(conv.conversationId)}
                      className="flex w-full items-center justify-between gap-2 py-2 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-white/[0.03]"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-medium text-zinc-800 dark:text-zinc-200">
                          {conv.displayTitle || conv.title || conv.conversationId}
                        </div>
                        <div className="mt-0.5 flex items-center gap-2 text-[10.5px] text-zinc-400">
                          <span className="truncate">{conv.primaryModelDisplayName || '未知模型'}</span>
                          <span>·</span>
                          <span>{conv.turnCount} 轮</span>
                          <span>·</span>
                          <span>{formatDateTime(conv.lastModifiedTime)}</span>
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1 tabular-nums text-[11.5px] font-medium text-zinc-700 dark:text-zinc-300">
                        {formatTokens(conv.exact.totalTokens)}
                        <ChevronRight className="h-3.5 w-3.5 text-zinc-400" />
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 会话明细弹层 */}
      {(detail || loadingDetail) && (
        <div className="absolute inset-0 z-20 flex flex-col bg-white dark:bg-[#0F1013]">
          <div className="flex shrink-0 items-center justify-between border-b border-zinc-200/80 px-3.5 py-2.5 dark:border-white/[0.08]">
            <span className="truncate text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
              {detail?.displayTitle || '会话明细'}
            </span>
            <button
              type="button"
              onClick={() => setDetail(null)}
              className="flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.08]"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="flex-1 space-y-2.5 overflow-y-auto px-3.5 py-3">
            {loadingDetail || !detail ? (
              <div className="py-12 text-center text-[12px] text-zinc-400">加载中...</div>
            ) : (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  <MiniStat label="输入" value={formatTokens(detail.exact.inputTokens)} />
                  <MiniStat label="输出" value={formatTokens(detail.exact.outputTokens)} />
                  <MiniStat label="思考" value={formatTokens(detail.exact.thinkingTokens)} />
                </div>
                <div className="space-y-1.5">
                  {detail.modelBreakdown.map((slice) => (
                    <div
                      key={slice.modelId}
                      className="flex items-center justify-between rounded-lg border border-zinc-200/75 px-2.5 py-2 text-[11.5px] dark:border-white/[0.07]"
                    >
                      <span className="truncate font-medium">{slice.modelDisplayName}</span>
                      <span className="tabular-nums text-zinc-500">
                        {slice.turnCount} 轮 · {formatTokens(slice.exact.totalTokens)}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function KpiCard({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-xl border border-zinc-200/80 bg-white px-3 py-2.5 dark:border-white/[0.08] dark:bg-[#141518]">
      <div className="text-[11px] text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="mt-0.5 tabular-nums text-[17px] font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
      <div className="mt-0.5 truncate text-[10.5px] text-zinc-400">{sub}</div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-50 py-2 dark:bg-white/[0.04]">
      <div className="text-[10.5px] text-zinc-400">{label}</div>
      <div className="mt-0.5 tabular-nums text-[13px] font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
    </div>
  );
}
