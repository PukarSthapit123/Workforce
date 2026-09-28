const DT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export const formatDateTime = (iso: string) => DT.format(new Date(iso)).replace(',', '');

const show = (v: unknown): string => v === undefined || v === null ? 'none' : typeof v === 'boolean' ? (v ? 'yes' : 'no')
  : Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : typeof v === 'object' ? JSON.stringify(v) : String(v);

export function describeChange(before: unknown, after: unknown): string {
  const b = (before ?? {}) as Record<string, unknown>, a = (after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(k => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map(k => `${k}: ${show(b[k])} → ${show(a[k])}`).join(' · ');
}
