import { useCallback, useEffect, useState } from 'react';
import { Minimize2, Power, X } from 'lucide-react';
import * as api from '../services/tauri';
import { useAppStore } from '../stores/useAppStore';

export function CloseConfirmModal() {
  const closeConfirmOpen = useAppStore((s) => s.closeConfirmOpen);
  const closeConfirmHasTray = useAppStore((s) => s.closeConfirmHasTray);
  const setCloseConfirm = useAppStore((s) => s.setCloseConfirm);
  const pushToast = useAppStore((s) => s.pushToast);

  const [remember, setRemember] = useState(false);
  const [submitting, setSubmitting] = useState<'minimize' | 'quit' | null>(null);

  useEffect(() => {
    if (closeConfirmOpen) {
      setRemember(false);
      setSubmitting(null);
    }
  }, [closeConfirmOpen]);

  const handleCancel = useCallback(() => {
    if (submitting) return;
    setCloseConfirm(false);
  }, [submitting, setCloseConfirm]);

  useEffect(() => {
    if (!closeConfirmOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCancel();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [closeConfirmOpen, handleCancel]);

  if (!closeConfirmOpen) return null;

  const handleAction = async (action: 'minimize' | 'quit') => {
    if (submitting) return;
    setSubmitting(action);
    try {
      await api.handleWindowClose(action, remember);
      if (remember) {
        const cfg = useAppStore.getState().generalConfig;
        if (cfg) {
          useAppStore.setState({ generalConfig: { ...cfg, close_behavior: action } });
        }
      }
      setCloseConfirm(false);
    } catch (err) {
      pushToast(`执行窗口关闭操作失败：${String(err)}`, 'error');
    } finally {
      setSubmitting(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-3"
      onClick={handleCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="确认关闭窗口"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-[380px] overflow-hidden rounded-xl border border-zinc-200/90 bg-white shadow-2xl dark:border-white/[0.1] dark:bg-[#141518]"
      >
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-zinc-200/75 px-4 py-3 dark:border-white/[0.08]">
          <h2 className="text-[13.5px] font-semibold text-zinc-900 dark:text-zinc-100">
            关闭窗口
          </h2>
          <button
            type="button"
            disabled={Boolean(submitting)}
            onClick={handleCancel}
            aria-label="取消"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700 disabled:opacity-50 dark:hover:bg-white/[0.08] dark:hover:text-zinc-200"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* 内容 */}
        <div className="space-y-3 p-4">
          <p className="text-[12px] leading-relaxed text-zinc-600 dark:text-zinc-300">
            {closeConfirmHasTray
              ? '请选择关闭主窗口时的行为。最小化到托盘后，自动切号、唤醒调度和无感服务仍会保持运行。'
              : '请选择关闭主窗口时的行为。'}
          </p>

          <label className="flex cursor-pointer select-none items-center gap-2 rounded-lg border border-zinc-200/80 bg-zinc-50/70 px-3 py-2 text-[12px] text-zinc-700 dark:border-white/[0.08] dark:bg-white/[0.03] dark:text-zinc-200">
            <input
              type="checkbox"
              checked={remember}
              disabled={Boolean(submitting)}
              onChange={(e) => setRemember(e.target.checked)}
              className="h-3.5 w-3.5 rounded border-zinc-300 accent-[#5E6AD2] dark:border-white/20"
            />
            <span>记住我的选择</span>
          </label>
        </div>

        {/* 底部操作按钮 */}
        <div className="flex items-center justify-end gap-2 border-t border-zinc-200/75 bg-zinc-50/70 px-4 py-2.5 dark:border-white/[0.07] dark:bg-white/[0.02]">
          <button
            type="button"
            disabled={Boolean(submitting)}
            onClick={handleCancel}
            className="h-8 rounded-lg border border-zinc-200/85 bg-white px-3 text-[12px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50 dark:border-white/[0.1] dark:bg-white/[0.05] dark:text-zinc-200 dark:hover:bg-white/[0.09]"
          >
            取消
          </button>
          <button
            type="button"
            disabled={Boolean(submitting)}
            onClick={() => void handleAction('quit')}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 text-[12px] font-medium text-rose-600 transition-colors hover:bg-rose-100 disabled:opacity-50 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-400 dark:hover:bg-rose-500/20"
          >
            <Power className="h-3.5 w-3.5" />
            {submitting === 'quit' ? '退出中…' : '退出应用'}
          </button>
          <button
            type="button"
            disabled={Boolean(submitting)}
            onClick={() => void handleAction('minimize')}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[#5E6AD2] px-3 text-[12px] font-medium text-white shadow-sm transition-colors hover:bg-[#4F5BC4] disabled:opacity-50"
          >
            <Minimize2 className="h-3.5 w-3.5" />
            {submitting === 'minimize'
              ? '处理中…'
              : closeConfirmHasTray
                ? '最小化到托盘'
                : '最小化'}
          </button>
        </div>
      </div>
    </div>
  );
}
