import { CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';

export function ToastStack() {
  const toasts = useAppStore((s) => s.toasts);
  const dismissToast = useAppStore((s) => s.dismissToast);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-3 left-1/2 z-50 flex w-[calc(100%-24px)] max-w-[420px] -translate-x-1/2 flex-col gap-1.5">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-2 rounded-lg border border-zinc-200/90 bg-white px-3 py-2 text-[12px] text-zinc-800 shadow-lg dark:border-white/[0.12] dark:bg-[#1B1D22] dark:text-zinc-100"
        >
          {toast.tone === 'success' && (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
          )}
          {toast.tone === 'error' && (
            <XCircle className="h-3.5 w-3.5 shrink-0 text-rose-500" />
          )}
          {toast.tone === 'info' && <Info className="h-3.5 w-3.5 shrink-0 text-[#5E6AD2]" />}
          <span className="min-w-0 flex-1 break-words">{toast.message}</span>
          <button
            type="button"
            onClick={() => dismissToast(toast.id)}
            className="shrink-0 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ))}
    </div>
  );
}
