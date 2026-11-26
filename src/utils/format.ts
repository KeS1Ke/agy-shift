import type { Account, DisplayGroup, ModelQuota, QuotaData } from '../types';

export type AccountTierLabel = 'PLUS' | 'PRO' | 'ULTRA 5X' | 'ULTRA 20X' | 'ULTRA' | 'FREE';

const accountTierLabels = new Map<string, AccountTierLabel>([
  ['g1-plus-tier', 'PLUS'], ['plus', 'PLUS'], ['google ai plus', 'PLUS'],
  ['g1-pro-tier', 'PRO'], ['pro', 'PRO'], ['google ai pro', 'PRO'],
  ['g1-ultra-lite-tier', 'ULTRA 5X'], ['ultra 5x', 'ULTRA 5X'], ['google ai ultra 5x', 'ULTRA 5X'],
  ['g1-ultra-tier', 'ULTRA 20X'], ['ultra 20x', 'ULTRA 20X'], ['google ai ultra 20x', 'ULTRA 20X'],
  ['ultra', 'ULTRA'], ['google ai ultra', 'ULTRA'],
  ['free-tier', 'FREE'], ['free', 'FREE'],
]);

export function getAccountTierLabel(quota?: Pick<QuotaData, 'subscription_tier' | 'tier_id'>): AccountTierLabel | undefined {
  const subscription = accountTierLabels.get(quota?.subscription_tier?.trim().toLowerCase() ?? '');
  const tierId = accountTierLabels.get(quota?.tier_id?.trim().toLowerCase() ?? '');
  if (subscription === 'ULTRA' && (tierId === 'ULTRA 5X' || tierId === 'ULTRA 20X')) return tierId;
  return subscription ?? tierId;
}

export interface QuotaGroupView {
  id: string;
  label: string;
  percentage: number;
  resetTime: string;
  models: ModelQuota[];
}

export function normalizeTierLabel(tier?: string | null): {
  label: string;
  tone: 'ultra' | 'pro' | 'free' | 'default';
} | null {
  if (!tier) return null;
  const upper = tier.trim().toUpperCase();
  if (!upper || upper === 'UNKNOWN') return null;
  if (upper.includes('ULTRA')) return { label: 'ULTRA', tone: 'ultra' };
  if (upper.includes('PRO')) return { label: 'PRO', tone: 'pro' };
  if (upper.includes('FREE')) return { label: 'FREE', tone: 'free' };
  return { label: upper.slice(0, 12), tone: 'default' };
}

export function formatResetCountdown(resetTime?: string | null): string {
  if (!resetTime) return '';
  const ts = Date.parse(resetTime);
  if (Number.isNaN(ts)) return '';
  const diffMs = ts - Date.now();
  if (diffMs <= 0) return '即将重置';
  const totalMinutes = Math.ceil(diffMs / 60_000);
  if (totalMinutes < 60) return `${totalMinutes}分钟`;
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  if (hours < 24) return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}天${remHours}h` : `${days}天`;
}

export function formatRelativeTime(unixSeconds?: number | null): string {
  if (!unixSeconds || unixSeconds <= 0) return '从未';
  const ms = unixSeconds > 1_000_000_000_000 ? unixSeconds : unixSeconds * 1000;
  const diffSec = Math.floor((Date.now() - ms) / 1000);
  if (diffSec < 60) return '刚刚';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} 分钟前`;
  if (diffSec < 86_400) return `${Math.floor(diffSec / 3600)} 小时前`;
  const days = Math.floor(diffSec / 86_400);
  if (days < 30) return `${days} 天前`;
  const date = new Date(ms);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

export function formatDateTime(ts?: number | string | null): string {
  if (!ts) return '-';
  const ms =
    typeof ts === 'string'
      ? Date.parse(ts)
      : ts > 1_000_000_000_000
        ? ts
        : ts * 1000;
  if (Number.isNaN(ms)) return '-';
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function formatTokens(count: number): string {
  if (!Number.isFinite(count) || count <= 0) return '0';
  if (count >= 1_000_000_000) return `${(count / 1_000_000_000).toFixed(2)}B`;
  if (count >= 1_000_000) return `${(count / 1_000_000).toFixed(2)}M`;
  if (count >= 1_000) return `${(count / 1_000).toFixed(1)}K`;
  return String(Math.round(count));
}

export function quotaColorClass(percentage: number): {
  bar: string;
  text: string;
} {
  if (percentage > 50) {
    return {
      bar: 'bg-emerald-500 dark:bg-emerald-400',
      text: 'text-emerald-600 dark:text-emerald-400',
    };
  }
  if (percentage >= 20) {
    return {
      bar: 'bg-amber-500 dark:bg-amber-400',
      text: 'text-amber-600 dark:text-amber-400',
    };
  }
  return {
    bar: 'bg-rose-500 dark:bg-rose-400',
    text: 'text-rose-600 dark:text-rose-400',
  };
}

function classifyFallbackFamily(model: ModelQuota): { id: string; label: string } {
  const key = (model.name || model.display_name || '').toLowerCase();
  if (key.includes('claude') || key.includes('sonnet') || key.includes('opus')) {
    return { id: 'claude', label: 'Claude' };
  }
  if (key.includes('flash') || key.includes('hydrogen')) {
    return { id: 'gemini_flash', label: 'Flash' };
  }
  if (key.includes('gemini') || key.includes('pro') || key.includes('carbon') || key.includes('neon')) {
    return { id: 'gemini_pro', label: 'Gemini Pro' };
  }
  if (key.includes('gpt') || key.includes('o3') || key.includes('o4')) {
    return { id: 'gpt', label: 'GPT' };
  }
  return { id: 'other', label: model.display_name || model.name };
}

export function buildQuotaGroups(
  account: Account,
  displayGroups: DisplayGroup[],
): QuotaGroupView[] {
  const models = account.quota?.models ?? [];
  if (models.length === 0) return [];

  // 优先匹配后端配置的显示分组
  if (displayGroups.length > 0) {
    const matched: QuotaGroupView[] = [];
    for (const group of displayGroups) {
      const normalizedSet = new Set(group.models.map((m) => m.toLowerCase()));
      const groupModels = models.filter(
        (m) =>
          normalizedSet.has(m.name.toLowerCase()) ||
          (m.display_name && normalizedSet.has(m.display_name.toLowerCase())),
      );
      if (groupModels.length > 0) {
        const minModel = groupModels.reduce((acc, cur) =>
          cur.percentage < acc.percentage ? cur : acc,
        );
        matched.push({
          id: group.id,
          label: group.name,
          percentage: minModel.percentage,
          resetTime: minModel.reset_time,
          models: groupModels,
        });
      }
    }
    if (matched.length > 0) return matched.slice(0, 4);
  }

  // 回退按模型家族聚合，最多展示 3 组核心配额
  const map = new Map<string, QuotaGroupView>();
  for (const model of models) {
    const fam = classifyFallbackFamily(model);
    const existing = map.get(fam.id);
    if (!existing) {
      map.set(fam.id, {
        id: fam.id,
        label: fam.label,
        percentage: model.percentage,
        resetTime: model.reset_time,
        models: [model],
      });
    } else {
      existing.models.push(model);
      if (model.percentage < existing.percentage) {
        existing.percentage = model.percentage;
        existing.resetTime = model.reset_time;
      }
    }
  }
  return Array.from(map.values()).slice(0, 3);
}

export function getMinQuotaPercent(account: Account): number {
  const models = account.quota?.models ?? [];
  if (models.length === 0) return -1;
  return models.reduce((min, m) => Math.min(min, m.percentage), 100);
}

export function shortModelName(model: ModelQuota): string {
  const raw = model.display_name || model.name;
  return raw.replace(/^models\//i, '');
}
