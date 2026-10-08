import { clockAt, activeLocale, formatDmy } from '@/domain/time';
export { formatDateTime } from '@/domain/time';

const show = (v: unknown): string => v === undefined || v === null ? 'none' : typeof v === 'boolean' ? (v ? 'yes' : 'no')
  : Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : typeof v === 'object' ? JSON.stringify(v) : String(v);

export function describeChange(before: unknown, after: unknown): string {
  const b = (before ?? {}) as Record<string, unknown>, a = (after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(k => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map(k => `${k}: ${show(b[k])} → ${show(a[k])}`).join(' · ');
}

/* A stored date follows the tenant's configured date format. */
export const formatDate = (iso: string) => /^\d{4}-\d{2}-\d{2}$/.test(iso) ? formatDmy(iso) : '—';

/* The date today is in the tenant's zone, not the browser's zone. */
export const todayIso = (now: Date = new Date()) => clockAt(now.toISOString(), activeLocale().timezone).date;
