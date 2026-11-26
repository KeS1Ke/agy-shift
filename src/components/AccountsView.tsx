import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRightLeft, ChevronDown, ChevronLeft, ChevronRight, Clock, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { useAppStore } from '../stores/useAppStore';
import type { Account, ModelQuota } from '../types';
import { formatResetCountdown, getAccountTierLabel, quotaColorClass, type AccountTierLabel } from '../utils/format';

const PAGE_SIZE = 24;
const QUOTA_ROWS = [
  { model: 'Gemini', fiveHours: ['gemini-5h', 'gemini:5h'], weekly: ['gemini-weekly', 'gemini:weekly'] },
  { model: 'Claude', fiveHours: ['3p-5h', 'claude:5h', 'claude-5h'], weekly: ['3p-weekly', 'claude:weekly', 'claude-weekly'] },
];
const switchTimeFormat = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const ACTION_CLASS = 'inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-stone-700 hover:bg-stone-200/70 disabled:opacity-40 dark:text-stone-300 dark:hover:bg-white/10';
const OPTION_CLASS = 'block w-full rounded px-3 py-2 text-left text-xs font-medium text-stone-800 hover:bg-stone-100 dark:text-stone-100 dark:hover:bg-white/10';
const TIER_STYLE: Record<AccountTierLabel, string> = {
  PLUS: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-400/15 dark:text-emerald-200',
  PRO: 'bg-sky-100 text-sky-900 dark:bg-sky-400/15 dark:text-sky-200',
  'ULTRA 5X': 'bg-violet-100 text-violet-900 dark:bg-violet-400/15 dark:text-violet-200',
  'ULTRA 20X': 'bg-orange-100 text-orange-900 dark:bg-orange-400/15 dark:text-orange-200',
  ULTRA: 'bg-stone-200 text-stone-800 dark:bg-white/10 dark:text-stone-200',
  FREE: 'bg-stone-100 text-stone-700 dark:bg-white/10 dark:text-stone-300',
};

export function AccountsView() {
  const accounts = useAppStore((s) => s.accounts);
  const loading = useAppStore((s) => s.loadingAccounts);
  const [page, setPage] = useState(0);
  const [switchMenuId, setSwitchMenuId] = useState<string | null>(null);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const scrollArea = useRef<HTMLElement>(null);
  const deleteTarget = deleteTargetId ? accounts.find((account) => account.id === deleteTargetId) : undefined;
  const lastPage = Math.max(0, Math.ceil(accounts.length / PAGE_SIZE) - 1);
  const visiblePage = Math.min(page, lastPage);
  const visibleAccounts = useMemo(
    () => accounts.slice(visiblePage * PAGE_SIZE, (visiblePage + 1) * PAGE_SIZE),
    [accounts, visiblePage],
  );
  const changePage = (next: number) => {
    setPage(next);
    scrollArea.current?.scrollTo({ top: 0 });
  };

  if (accounts.length === 0) {
    return (
      <div className="grid h-full place-items-center bg-[#f3efe8] px-5 text-center text-sm text-stone-600 dark:bg-[#19171b] dark:text-stone-400">
        {loading ? '正在加载账号…' : '暂无账号。添加账号后即可切换和查看额度。'}
      </div>
    );
  }

  return (
    <section
      ref={scrollArea}
      aria-label="账号与额度"
      className="h-full overflow-y-auto bg-[#f3efe8] dark:bg-[#19171b]"
      onClick={() => {
        if (switchMenuId) setSwitchMenuId(null);
      }}
    >
      <div className="mx-auto max-w-[1140px] px-4 pb-14 pt-2 sm:px-5">
        <div className="grid grid-cols-1 items-stretch gap-3 min-[700px]:grid-cols-2 min-[1060px]:grid-cols-3">
          {visibleAccounts.map((account) => (
            <AccountCard
              key={account.id}
              account={account}
              menuOpen={switchMenuId === account.id}
              setSwitchMenuId={setSwitchMenuId}
              onRequestDelete={setDeleteTargetId}
            />
          ))}
        </div>
        {lastPage > 0 && (
          <nav aria-label="账号分页" className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-600 dark:text-slate-300">
            <button
              type="button"
              aria-label="上一页"
              className={ACTION_CLASS}
              disabled={visiblePage === 0}
              onClick={() => changePage(visiblePage - 1)}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="tabular-nums">{visiblePage + 1} / {lastPage + 1}</span>
            <button
              type="button"
              aria-label="下一页"
              className={ACTION_CLASS}
              disabled={visiblePage === lastPage}
              onClick={() => changePage(visiblePage + 1)}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </nav>
        )}
      </div>
      {deleteTarget && <DeleteAccountDialog account={deleteTarget} onClose={() => setDeleteTargetId(null)} />}
    </section>
  );
}

const AccountCard = memo(function AccountCard({
  account, menuOpen, setSwitchMenuId, onRequestDelete,
}: {
  account: Account;
  menuOpen: boolean;
  setSwitchMenuId: (id: string | null) => void;
  onRequestDelete: (id: string) => void;
}) {
  const isCurrent = useAppStore((s) => s.currentAccountId === account.id);
  const isRefreshing = useAppStore((s) => Boolean(s.refreshingIds[account.id]));
  const isSwitching = useAppStore((s) => s.switchingId === account.id);
  const switching = useAppStore((s) => Boolean(s.switchingId));
  const switchDisabled = switching || Boolean(account.pending_oauth);
  const models = account.quota?.models;
  const quotaRows = useMemo(
    () => QUOTA_ROWS.map(({ model, fiveHours, weekly }) => ({
      model,
      fiveHours: models?.find((quota) => fiveHours.includes(quota.name.toLowerCase())),
      weekly: models?.find((quota) => weekly.includes(quota.name.toLowerCase())),
    })),
    [models],
  );
  const tier = getAccountTierLabel(account.quota);
  const restricted = account.disabled || account.quota?.is_forbidden;
  const switchedAt = account.last_switched_at;
  const switchTime = switchedAt
    ? switchTimeFormat.format(switchedAt > 1_000_000_000_000 ? switchedAt : switchedAt * 1000)
    : '暂无记录';

  const chooseSwitch = (launch: boolean) => {
    setSwitchMenuId(null);
    void useAppStore.getState().switchToAccount(account, launch);
  };

  return (
    <article
      aria-label={account.email}
      className={'flex min-w-0 flex-col rounded-xl border border-stone-300/75 border-t-2 bg-[#fffdf9] px-4 pb-3 pt-3 dark:border-[#39353d] dark:bg-[#231f26] ' +
        (menuOpen ? '' : 'account-card ') +
        (isCurrent ? 'border-t-[#ab4432] dark:border-t-[#ed8067]' : '')}
    >
      <div className="flex min-h-6 items-center gap-2">
        <span title={account.email} className="min-w-0 flex-1 truncate text-[14px] font-semibold tracking-tight text-stone-900 dark:text-stone-50">
          {account.email}
        </span>
        {tier && (
          <span title={tier} className={'shrink-0 whitespace-nowrap rounded px-2 py-1 text-[10px] font-bold tracking-wider ' + TIER_STYLE[tier]}>
            {tier}
          </span>
        )}
      </div>

      <div className="mt-1 flex min-h-4 flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] text-stone-600 dark:text-stone-400">
        {isCurrent && (
          <span className="inline-flex shrink-0 items-center gap-1 font-medium text-[#933825] dark:text-[#ffa28c]">
            <span className="h-1.5 w-1.5 rounded-full bg-current" />当前账号
          </span>
        )}
        {account.notes && (
          <span title={account.notes} className="inline-flex min-w-0 max-w-full items-center gap-1">
            <FileText className="h-3 w-3 shrink-0" />
            <span className="truncate">{account.notes}</span>
          </span>
        )}
        {restricted && (
          <span title={account.disabled_reason} className="rounded-full bg-rose-500/10 px-2 py-0.5 text-[11px] text-rose-700 dark:text-rose-300">
            账号受限
          </span>
        )}
        {account.pending_oauth && <span className="text-[11px] text-slate-500 dark:text-slate-300">等待授权</span>}
      </div>

      <table aria-label="剩余额度" className="mt-3 w-full table-fixed border-collapse text-left text-xs">
        <colgroup><col className="w-[24%]" /><col /><col /></colgroup>
        <thead className="bg-[#f1ede6] text-[11px] font-medium text-stone-600 dark:bg-[#302b32] dark:text-stone-300">
          <tr>
            <th scope="col" className="rounded-l-md px-2 py-1.5 font-medium">模型</th>
            <th scope="col" className="px-3 py-1.5 font-medium">5 小时</th>
            <th scope="col" className="rounded-r-md px-3 py-1.5 font-medium">每周</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-200 dark:divide-[#3c373f]">
          {quotaRows.map(({ model, fiveHours, weekly }) => (
            <tr key={model}>
              <th scope="row" className="px-2 pt-2.5 align-top text-[13px] font-semibold text-stone-800 dark:text-stone-100">{model}</th>
              <td className="px-3 py-1.5">
                <QuotaReading model={fiveHours} weeklyExhausted={!fiveHours && (weekly?.summary_exhausted ?? weekly?.percentage === 0)} />
              </td>
              <td className="px-3 py-1.5"><QuotaReading model={weekly} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {account.quota_error && (
        <p className="mt-2 break-words text-[11px] text-rose-700 dark:text-rose-300">
          额度刷新失败：{account.quota_error.message}
        </p>
      )}
      {account.quota?.quota_summary_stale && (
        <p className="mt-2 text-[11px] text-amber-700 dark:text-amber-300">显示上次成功获取的额度</p>
      )}

      <div className="mt-auto pt-2">
        <div className="text-[11px] text-stone-600 dark:text-stone-400">
          <span title="最近切换时间" className="inline-flex items-center gap-1.5 tabular-nums">
            <Clock className="h-3 w-3 shrink-0" />切换时间 {switchTime}
          </span>
        </div>
        <div className="mt-2 flex items-center justify-between gap-2 border-t border-stone-200 pt-2 dark:border-[#3c373f]">
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={isRefreshing || Boolean(account.pending_oauth)}
              className={ACTION_CLASS}
              onClick={() => void useAppStore.getState().refreshSingleQuota(account.id)}
            >
              <RefreshCw className={'h-3.5 w-3.5 ' + (isRefreshing ? 'animate-spin' : '')} />
              {isRefreshing ? '刷新中…' : '刷新额度'}
            </button>
            <button
              type="button"
              disabled={isSwitching || isRefreshing}
              className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium text-stone-600 hover:bg-rose-50 hover:text-rose-800 disabled:opacity-40 dark:text-stone-400 dark:hover:bg-rose-400/10 dark:hover:text-rose-300"
              onClick={() => onRequestDelete(account.id)}
            >
              <Trash2 className="h-3.5 w-3.5" />
              删除账号
            </button>
          </div>
          <div
            className="relative"
            onClick={(event) => event.stopPropagation()}
            onBlur={(event) => {
              if (menuOpen && !event.currentTarget.contains(event.relatedTarget)) setSwitchMenuId(null);
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape' && menuOpen) {
                event.currentTarget.querySelector('button')?.focus();
                setSwitchMenuId(null);
              }
            }}
          >
            <button
              type="button"
              aria-expanded={menuOpen}
              disabled={switchDisabled}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-[#9b3c2a] px-2.5 text-xs font-semibold text-white hover:bg-[#863123] disabled:opacity-40 dark:bg-[#b94f39] dark:hover:bg-[#aa442f]"
              onClick={() => setSwitchMenuId(menuOpen ? null : account.id)}
            >
              <ArrowRightLeft className="h-3.5 w-3.5" />
              {isSwitching ? '切换中…' : '切号'}
              <ChevronDown className="h-3 w-3" />
            </button>
            {menuOpen && (
              <div className="absolute bottom-full right-0 z-20 mb-2 w-36 rounded-lg border border-stone-200 bg-[#fffdf9] p-1 shadow-lg dark:border-[#4e4650] dark:bg-[#302b32]">
                <button type="button" className={OPTION_CLASS} disabled={switchDisabled} onClick={() => chooseSwitch(false)}>仅切号</button>
                <button type="button" className={OPTION_CLASS} disabled={switchDisabled} onClick={() => chooseSwitch(true)}>切号并启动</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </article>
  );
});

function DeleteAccountDialog({ account, onClose }: { account: Account; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const deleteAccount = useAppStore((s) => s.deleteAccountById);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);

  const confirmDelete = async () => {
    if (deleting) return;
    setDeleting(true);
    try {
      await deleteAccount(account);
    } finally {
      onClose();
    }
  };

  return (
    <dialog
      ref={dialog}
      aria-labelledby="delete-account-title"
      aria-describedby="delete-account-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!deleting) onClose();
      }}
      className="w-[min(356px,calc(100%-32px))] rounded-xl border border-stone-200 bg-[#fffdf9] p-5 text-stone-900 shadow-xl backdrop:bg-black/50 dark:border-[#48414b] dark:bg-[#231f26] dark:text-stone-100"
    >
      <h2 id="delete-account-title" className="text-base font-semibold">删除账号</h2>
      <p className="mt-2 break-all text-sm font-medium">{account.email}</p>
      <p id="delete-account-description" className="mt-1 text-xs text-stone-600 dark:text-stone-400">
        此账号及 Agy Shift 保存的本地登录凭据将被移除。
      </p>
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" autoFocus onClick={onClose} disabled={deleting} className="rounded-md px-3 py-1.5 text-xs hover:bg-stone-100 disabled:opacity-50 dark:hover:bg-white/10">
          取消
        </button>
        <button type="button" onClick={() => void confirmDelete()} disabled={deleting} className="rounded-md bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-800 disabled:opacity-50">
          {deleting ? '删除中…' : '确认删除'}
        </button>
      </div>
    </dialog>
  );
}

function QuotaReading({ model, weeklyExhausted }: {
  model?: ModelQuota;
  weeklyExhausted?: boolean;
}) {
  const percent = model?.percentage;
  const tone = percent === undefined ? null : quotaColorClass(percent);
  const countdown = formatResetCountdown(model?.reset_time);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-1.5">
        <span className={'shrink-0 text-[17px] font-semibold leading-tight tracking-tight tabular-nums ' +
          ((percent !== undefined && percent > 50) ? 'text-stone-900 dark:text-stone-50' : (tone?.text ?? 'text-stone-500 dark:text-stone-400'))}>
          {percent === undefined ? '—' : percent + '%'}
        </span>
        <span title={countdown || undefined} className="truncate text-[10px] text-stone-600 dark:text-stone-400">
          {countdown || (weeklyExhausted ? '周额度已用尽' : '')}
        </span>
      </div>
      <div className="mt-1 h-[3px] rounded-full bg-stone-200 dark:bg-[#48414b]">
        {tone && percent !== undefined && (
          <div className={'h-full rounded-full ' + tone.bar} style={{ width: Math.min(100, Math.max(0, percent)) + '%' }} />
        )}
      </div>
    </div>
  );
}
