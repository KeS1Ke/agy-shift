import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  History,
  RefreshCw,
  Sparkles,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import * as api from '../services/tauri';
import { useAppStore } from '../stores/useAppStore';
import type { SwitchHistoryItem } from '../types';
import { formatDateTime } from '../utils/format';

function formatTriggerLabel(item: SwitchHistoryItem): string {
  const parts: string[] = [];
  if (item.triggerSource) {
    const sourceMap: Record<string, string> = {
      manual: '手动触发',
      auto: '自动切号',
      auto_switch: '自动切号',
      tray: '托盘菜单',
      cli: 'CLI',
    };
    parts.push(sourceMap[item.triggerSource] ?? item.triggerSource);
  }
  if (item.triggerType && item.triggerType !== item.triggerSource) {
    parts.push(item.triggerType);
  }
  return parts.join(' · ') || '手动触发';
}

export function SwitchHistoryModal() {
  const historyModalOpen = useAppStore((s) => s.historyModalOpen);
  const closeHistoryModal = useAppStore((s) => s.closeHistoryModal);
  const pushToast = useAppStore((s) => s.pushToast);

  const [items, setItems] = useState<SwitchHistoryItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [corruptedWarning, setCorruptedWarning] = useState<string | null>(null);

  const loadHistory = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.loadSwitchHistory();
      const sorted = [...(res.items ?? [])].sort((a, b) => b.timestamp - a.timestamp);
      setItems(sorted);
      if (res.corrupted || res.error) {
        setCorruptedWarning(res.error ?? '部分历史记录文件可能已损坏');
      } else {
        setCorruptedWarning(null);
      }
    } catch (err) {
      pushToast(`读取切换历史失败：${String(err)}`, 'error');
    } finally {
      setLoading(false);
    }
  }, [pushToast]);

  useEffect(() => {
    if (historyModalOpen) {
      void loadHistory();
    }
  }, [historyModalOpen, loadHistory]);

  useEffect(() => {
    if (!historyModalOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeHistoryModal();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [historyModalOpen, closeHistoryModal]);

  if (!historyModalOpen) return null;

  const handleClear = async () => {
    if (clearing || items.length === 0) return;
    setClearing(true);
    try {
      await api.clearSwitchHistory();
      setItems([]);
      setCorruptedWarning(null);
      pushToast('已清空账号切换历史', 'success');
    } catch (err) {
      pushToast(`清空历史失败：${String(err)}`, 'error');
    } finally {
      setClearing(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/45 p-3 backdrop-blur-[2px]"
      onClick={closeHistoryModal}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="账号切换历史"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[540px] max-h-[calc(100vh-24px)] w-full max-w-[456px] flex-col overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#141518]"
      >
        {/* 标题与操作栏 */}
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-200/75 px-4 py-3 dark:border-white/[0.08]">
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#5E6AD2]/12 text-[#5E6AD2] dark:text-indigo-400">
              <History className="h-3.5 w-3.5" />
            </div>
            <div>
              <h2 className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">
                账号切换历史
              </h2>
              <p className="tabular-nums text-[11px] text-zinc-500 dark:text-zinc-400">
                共 {items.length} 条记录
              </p>
            </div>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadHistory()}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200/85 bg-white px-2 text-[11.5px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-zinc-200 dark:hover:bg-white/[0.08]"
            >
              <RefreshCw className={`h-3 w-3 ${loading ? 'animate-spin' : ''}`} />
              刷新
            </button>
            <button
              type="button"
              disabled={clearing || items.length === 0}
              onClick={() => void handleClear()}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-zinc-200/85 bg-white px-2 text-[11.5px] font-medium text-rose-600 transition-colors hover:bg-rose-50 disabled:opacity-45 dark:border-white/[0.1] dark:bg-white/[0.04] dark:text-rose-400 dark:hover:bg-rose-500/10"
            >
              <Trash2 className="h-3 w-3" />
              {clearing ? '清空中…' : '清空历史'}
            </button>
            <button
              type="button"
              onClick={closeHistoryModal}
              aria-label="关闭弹窗"
              className="ml-0.5 flex h-7 w-7 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-white/[0.08] dark:hover:text-zinc-200"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* 损坏提示 */}
        {corruptedWarning && (
          <div className="flex shrink-0 items-center gap-1.5 border-b border-amber-200/70 bg-amber-50/80 px-4 py-2 text-[11px] text-amber-700 dark:border-amber-500/20 dark:bg-amber-500/10 dark:text-amber-300">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{corruptedWarning}</span>
          </div>
        )}

        {/* 时间线列表 */}
        <div className="flex-1 overflow-y-auto px-4 py-3">
          {loading && items.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12px] text-zinc-400">
              正在加载切换历史...
            </div>
          ) : items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center text-zinc-400">
              <History className="h-7 w-7 opacity-40" />
              <p className="mt-2 text-[12.5px]">暂无账号切换记录</p>
              <p className="mt-0.5 text-[11px]">每次手动或自动切号后都会在此留下时间线记录</p>
            </div>
          ) : (
            <div className="relative space-y-2.5 before:absolute before:bottom-2 before:left-[9px] before:top-2 before:w-px before:bg-zinc-200 dark:before:bg-white/[0.08]">
              {items.map((item) => {
                const modeLabel = item.seamlessOk
                  ? item.seamlessEffectiveMode
                    ? `无感 (${item.seamlessEffectiveMode})`
                    : '无感切换'
                  : item.localOk
                    ? item.seamlessEffectiveMode
                      ? `本地 (${item.seamlessEffectiveMode})`
                      : '本地切换'
                    : '未写入';

                return (
                  <div key={item.id} className="relative pl-6">
                    <span
                      className={`absolute left-0 top-3 flex h-[19px] w-[19px] items-center justify-center rounded-full border bg-white dark:bg-[#141518] ${
                        item.success
                          ? 'border-emerald-500/40 text-emerald-500'
                          : 'border-rose-500/40 text-rose-500'
                      }`}
                    >
                      {item.success ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <XCircle className="h-3 w-3" />
                      )}
                    </span>

                    <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/55 p-2.5 dark:border-white/[0.08] dark:bg-white/[0.03]">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0 truncate text-[12.5px] font-medium text-zinc-900 dark:text-zinc-100">
                          {item.targetEmail || item.accountId}
                        </span>
                        <span className="shrink-0 tabular-nums text-[10.5px] text-zinc-400">
                          {formatDateTime(item.timestamp)}
                        </span>
                      </div>

                      <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            item.success
                              ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                              : 'bg-rose-500/12 text-rose-700 dark:text-rose-300'
                          }`}
                        >
                          {item.success ? '成功' : '失败'}
                        </span>

                        <span
                          className={`inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                            item.seamlessOk
                              ? 'bg-[#5E6AD2]/12 text-[#5E6AD2] dark:text-indigo-300'
                              : 'bg-zinc-200/75 text-zinc-600 dark:bg-white/[0.08] dark:text-zinc-300'
                          }`}
                        >
                          {item.seamlessOk && <Sparkles className="h-2.5 w-2.5" />}
                          {modeLabel}
                        </span>

                        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:bg-white/[0.06] dark:text-zinc-400">
                          {formatTriggerLabel(item)}
                        </span>

                        <span
                          title={`本地 ${item.localDurationMs}ms${
                            item.seamlessDurationMs != null
                              ? ` · 无感 ${item.seamlessDurationMs}ms`
                              : ''
                          }`}
                          className="ml-auto inline-flex items-center gap-0.5 tabular-nums text-[10.5px] text-zinc-400"
                        >
                          <Clock className="h-2.5 w-2.5" />
                          {item.totalDurationMs}ms
                        </span>
                      </div>

                      {!item.success && (item.errorMessage || item.errorCode || item.errorStage) && (
                        <div className="mt-1.5 rounded-lg bg-rose-500/10 px-2 py-1 text-[11px] text-rose-600 dark:text-rose-400">
                          {item.errorMessage ||
                            [item.errorStage, item.errorCode].filter(Boolean).join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
