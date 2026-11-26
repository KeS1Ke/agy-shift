import { useRef, useState } from 'react';
import { Check, ChevronDown, Download, Plus } from 'lucide-react';
import antigravityIcon from '../assets/icons/antigravity-app.png';
import antigravityIdeIcon from '../assets/icons/antigravity-ide-app.png';
import antigravityCliMark from '../assets/icons/antigravity-mark-white.svg';
import { useAppStore } from '../stores/useAppStore';
import type { AntigravityClientTarget } from '../types';

const CLIENTS = {
  antigravity: { label: 'Desktop', icon: antigravityIcon },
  cli: { label: 'CLI', icon: antigravityCliMark },
  antigravity_ide: { label: 'IDE', icon: antigravityIdeIcon },
} satisfies Record<AntigravityClientTarget, { label: string; icon: string }>;
const CLIENT_ORDER: AntigravityClientTarget[] = ['antigravity', 'cli', 'antigravity_ide'];

function ClientIcon({ target }: { target: AntigravityClientTarget }) {
  if (target === 'cli') {
    return (
      <span className="relative grid h-5 w-5 shrink-0 place-items-center rounded bg-[#17233a] ring-1 ring-inset ring-white/15" aria-hidden="true">
        <img src={CLIENTS.cli.icon} alt="" className="mb-0.5 h-3 w-3" />
        <span className="absolute bottom-[3px] right-[3px] h-px w-1 bg-[#f2922e]" />
      </span>
    );
  }
  return <img src={CLIENTS[target].icon} alt="" className="h-5 w-5 shrink-0" />;
}

export function Header() {
  const accountCount = useAppStore((s) => s.accounts.length);
  const loadingAccounts = useAppStore((s) => s.loadingAccounts);
  const clientTarget = useAppStore((s) => s.clientTarget);
  const setClientTarget = useAppStore((s) => s.setClientTarget);
  const switching = useAppStore((s) => Boolean(s.switchingId));
  const openAddModal = useAppStore((s) => s.openAddModal);
  const openUpdate = useAppStore((s) => s.openUpdateModal);
  const [clientMenuOpen, setClientMenuOpen] = useState(false);
  const clientTrigger = useRef<HTMLButtonElement>(null);

  const closeClientMenu = () => {
    setClientMenuOpen(false);
    clientTrigger.current?.focus();
  };

  return (
    <header className="shrink-0 px-4 pb-1.5 pt-2.5 text-stone-900 dark:text-stone-100 sm:px-5">
      <div className="mx-auto flex w-full max-w-[1140px] items-center justify-between gap-3">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-[19px] font-semibold leading-none tracking-tight text-stone-900 dark:text-stone-100">账号</h1>
          {(!loadingAccounts || accountCount > 0) && (
            <span className="shrink-0 text-xs tabular-nums text-stone-600 dark:text-stone-400">{accountCount} 个</span>
          )}
        </div>
        <div role="group" aria-label="账号操作" className="flex shrink-0 items-center gap-0.5 rounded-full border border-stone-300/80 bg-[#fffdf9] p-1 text-[13px] font-medium shadow-[0_3px_12px_rgba(62,40,25,0.10)] dark:border-[#48414b] dark:bg-[#28242c] dark:shadow-[0_4px_14px_rgba(0,0,0,0.28)]">
          <div
            className="relative z-30"
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setClientMenuOpen(false);
            }}
            onKeyDown={(event) => {
              if (clientMenuOpen && event.key === 'Escape') closeClientMenu();
            }}
          >
            <button
              ref={clientTrigger}
              type="button"
              aria-label={'切号目标客户端：' + CLIENTS[clientTarget].label}
              aria-expanded={clientMenuOpen}
              disabled={switching}
              onClick={() => setClientMenuOpen(!clientMenuOpen)}
              className="inline-grid h-8 w-[114px] grid-cols-[20px_minmax(0,1fr)_18px] items-center gap-1.5 rounded-full px-2 hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-white/10"
            >
              <ClientIcon target={clientTarget} />
              <span className="whitespace-nowrap text-left">{CLIENTS[clientTarget].label}</span>
              <ChevronDown className="h-3 w-3 justify-self-center" />
            </button>
            {clientMenuOpen && (
              <div role="group" aria-label="选择客户端" className="absolute left-0 top-full mt-1.5 w-[122px] rounded-lg border border-stone-300 bg-[#fffdf9] p-[3px] shadow-lg dark:border-[#48414b] dark:bg-[#302b32]">
                {CLIENT_ORDER.map((target) => (
                  <button
                    key={target}
                    type="button"
                    aria-pressed={clientTarget === target}
                    disabled={switching}
                    onClick={() => {
                      if (target !== clientTarget) setClientTarget(target);
                      closeClientMenu();
                    }}
                    className="grid h-8 w-full grid-cols-[20px_minmax(0,1fr)_18px] items-center gap-1.5 rounded px-1.5 hover:bg-stone-100 dark:hover:bg-white/10"
                  >
                    <ClientIcon target={target} />
                    <span className="whitespace-nowrap text-left">{CLIENTS[target].label}</span>
                    {clientTarget === target && <Check className="h-3.5 w-3.5 justify-self-center" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-stone-200 dark:bg-white/10" />
          <button
            type="button"
            aria-label="添加账号"
            title="添加账号"
            onClick={openAddModal}
            className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full px-2.5 hover:bg-stone-100 dark:hover:bg-white/10"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden min-[480px]:inline">添加账号</span>
          </button>
          <span aria-hidden="true" className="h-4 w-px shrink-0 bg-stone-200 dark:bg-white/10" />
          <button
            type="button"
            aria-label="更新"
            title="更新"
            onClick={() => openUpdate()}
            className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full px-2.5 hover:bg-stone-100 dark:hover:bg-white/10"
          >
            <Download className="h-3.5 w-3.5" />
            <span className="hidden min-[480px]:inline">更新</span>
          </button>
        </div>
      </div>
    </header>
  );
}
