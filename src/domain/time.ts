/* Dates, clock times and rest between shifts, shared by Timesheet and Rota.
   Dates are ISO strings (yyyy-mm-dd) worked in UTC, so a day never shifts with
   the host's timezone; the clock every rule reads is a London date and time.
   Moved here from timesheet.ts so the Rota rules reuse them rather than copy
   them; timesheet.ts re-exports each one. */

/* 'HH:MM' to minutes from midnight. The prototype accepted 25:99; a server must not. */
export function toMin(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}
export const pad = (n: number) => String(n).padStart(2, '0');
/* The prototype's fmtMin: minutes (any number of days) back to 'HH:MM' on the 24-hour clock. */
export const fmtMin = (v: number) => `${pad(Math.floor(v / 60) % 24)}:${pad(v % 60)}`;

export const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
export const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const parseIso = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : new Date(Number.NaN);
};
export const toIso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const isIsoDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && toIso(parseIso(s)) === s;
export const addDays = (iso: string, n: number) => { const d = parseIso(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
/* The prototype's addMonths: 31 Aug plus one month is 1 Oct, as JavaScript dates roll. */
export const addMonths = (iso: string, n: number) => {
  const d = parseIso(iso);
  return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate())));
};
/* Whole days from a to b; negative when b is earlier. */
export const daysBetween = (a: string, b: string) => Math.round((parseIso(b).getTime() - parseIso(a).getTime()) / 86400000);
/* 0 is Monday, 6 is Sunday. */
export const dowMon = (iso: string) => (parseIso(iso).getUTCDay() + 6) % 7;
/* "Thu 13 Aug" */
export const formatDay = (iso: string) => { const d = parseIso(iso); return `${DOW_SHORT[dowMon(iso)] ?? ''} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()] ?? ''}`; };
/* "13/08/2026" */
export const formatDmy = (iso: string) => { const d = parseIso(iso); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
/* "13/08/2026" back to "2026-08-13"; '' when it is not a date. */
export const dmyToIso = (s: string) => {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(s || ''));
  if (!m) return '';
  const iso = `${m[3] ?? ''}-${pad(Number(m[2]))}-${pad(Number(m[1]))}`;
  return isIsoDate(iso) ? iso : '';
};
export function isoWeek(iso: string): number {
  const j = parseIso(iso), day = (j.getUTCDay() + 6) % 7;
  j.setUTCDate(j.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(j.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((j.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
/* The multi-week card's label: "Week 32 · 03–09 Aug 2026", or across a month "Week 31 · 27 Jul – 02 Aug 2026". */
export function weekLabel(weekStart: string): string {
  const a = parseIso(weekStart), b = parseIso(addDays(weekStart, 6));
  const mon = (d: Date) => MONTH_SHORT[d.getUTCMonth()] ?? '';
  const span = a.getUTCMonth() === b.getUTCMonth()
    ? `${pad(a.getUTCDate())}–${pad(b.getUTCDate())} ${mon(b)}`
    : `${pad(a.getUTCDate())} ${mon(a)} – ${pad(b.getUTCDate())} ${mon(b)}`;
  return `Week ${isoWeek(weekStart)} · ${span} ${b.getUTCFullYear()}`;
}
/* The Monday of the week containing the date. */
export const periodStart = (iso: string) => addDays(iso, -dowMon(iso));
export const weekDates = (weekStart: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

/* The clock every rule reads: a London date and time. The prototype froze it at 13/08/2026 09:12. */
export interface Clock { date: string; time: string }
const LONDON = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function clockFromIso(iso: string): Clock {
  const part = (k: string) => LONDON.formatToParts(new Date(iso)).find(p => p.type === k)?.value ?? '00';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

/* Rest between a shift and the others in its rota week, in hours; negative when
   they overlap, 99 when there is nothing to compare. Hours run from Monday 00:00
   of the week, so a shift's `end` may pass 24. The prototype's restGap. */
export interface ShiftSpan { start: number; end: number }
export function restGap(week: readonly (ShiftSpan | null)[], day: number, shift: ShiftSpan | null): number {
  if (!shift) return 99;
  const a = [day * 24 + shift.start, day * 24 + shift.end] as const;
  let min = 99;
  week.forEach((s, i) => {
    if (!s || i === day) return;
    const b = [i * 24 + s.start, i * 24 + s.end] as const;
    if (min === -1) return;
    if (a[0] < b[1] && b[0] < a[1]) { min = -1; return; }
    min = Math.min(min, a[0] >= b[1] ? a[0] - b[1] : b[0] - a[1]);
  });
  return min;
}
