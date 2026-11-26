import { Download, Plus } from 'lucide-react';
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
      <span className="relative grid h-4 w-4 shrink-0 place-items-center rounded bg-[#17233a] ring-1 ring-inset ring-white/15" aria-hidden="true">
        <img src={CLIENTS.cli.icon} alt="" className="mb-0.5 h-2.5 w-2.5" />
        <span className="absolute bottom-[2px] right-[2px] h-px w-1 bg-[#f2922e]" />
      </span>
    );
  }
  return <img src={CLIENTS[target].icon} alt="" className="h-4 w-4 shrink-0" />;
}

export function Header() {
  const accountCount = useAppStore((s) => s.accounts.length);
  const loadingAccounts = useAppStore((s) => s.loadingAccounts);
  const clientTarget = useAppStore((s) => s.clientTarget);
  const setClientTarget = useAppStore((s) => s.setClientTarget);
  const switching = useAppStore((s) => Boolean(s.switchingId));
  const openAddModal = useAppStore((s) => s.openAddModal);
  const openUpdate = useAppStore((s) => s.openUpdateModal);

  return (
    <header className="shrink-0 px-4 pb-1.5 pt-2.5 text-stone-900 dark:text-stone-100 sm:px-5">
      <div className="mx-auto flex w-full max-w-[1140px] flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-baseline gap-2">
          <h1 className="text-[19px] font-semibold leading-none tracking-tight text-stone-900 dark:text-stone-100">账号</h1>
          {(!loadingAccounts || accountCount > 0) && (
            <span className="shrink-0 text-[14px] font-medium tabular-nums text-stone-700 dark:text-stone-300">{accountCount} 个</span>
          )}
        </div>

        <div
          role="group"
          aria-label="账号操作"
          className="flex shrink-0 items-center gap-0.5 rounded-full border border-stone-300/80 bg-[#fffdf9] p-1 text-[13px] font-medium shadow-[0_3px_12px_rgba(62,40,25,0.10)] dark:border-[#48414b] dark:bg-[#28242c] dark:shadow-[0_4px_14px_rgba(0,0,0,0.28)]"
        >
          <div role="group" aria-label="切号目标客户端" className="flex items-center gap-0.5">
            {CLIENT_ORDER.map((target) => {
              const active = clientTarget === target;
              return (
                <button
                  key={target}
                  type="button"
                  aria-pressed={active}
                  disabled={switching}
                  onClick={() => {
                    if (target !== clientTarget) setClientTarget(target);
                  }}
                  className={
                    'inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-2.5 transition-colors disabled:opacity-50 ' +
                    (active
                      ? 'bg-[#9b3c2a] text-white shadow-sm dark:bg-[#b94f39] dark:text-white'
                      : 'text-stone-700 hover:bg-stone-100 dark:text-stone-300 dark:hover:bg-white/10')
                  }
                >
                  <ClientIcon target={target} />
                  <span>{CLIENTS[target].label}</span>
                </button>
              );
            })}
          </div>
          <span aria-hidden="true" className="mx-0.5 h-4 w-px shrink-0 bg-stone-200 dark:bg-white/10" />
          <button
            type="button"
            aria-label="添加账号"
            title="添加账号"
            onClick={openAddModal}
            className="inline-flex h-8 items-center gap-1 whitespace-nowrap rounded-full px-2.5 hover:bg-stone-100 dark:hover:bg-white/10"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden min-[540px]:inline">添加账号</span>
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
            <span className="hidden min-[540px]:inline">更新</span>
          </button>
        </div>
      </div>
    </header>
  );
}
