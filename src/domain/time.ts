/* Dates, clock times and rest between shifts, shared by Timesheet and Rota.
   Dates are ISO strings (yyyy-mm-dd) worked in UTC, so a day never shifts with
   the host's timezone. Moved here from timesheet.ts so the Rota rules reuse
   them rather than copy them; timesheet.ts re-exports each one.

   Module 8 group 1: the tenant's locale. Its timezone, date format, clock and
   week start are the tenant's settings (D6 defaults: Europe/London,
   dd/mm/yyyy, 24 h, Monday). clockAt is the one function every "now" and
   "today" comes from, given the tenant's zone. The active locale is what the
   formatting and week rules read when they are not given one: the fake
   server sets it from the tenant record at the start of every request (D5: a
   change applies from the next request), and the client sets it from the
   tenant read (src/lib/format.ts). Nothing else sets it. */

/* ------------------------------------------------------------- the locale */
export const DATE_FORMATS = ['dd/mm/yyyy', 'yyyy-mm-dd', 'mm/dd/yyyy'] as const;
export type DateFormat = (typeof DATE_FORMATS)[number];
export const CLOCK_STYLES = ['24h', '12h'] as const;
export type ClockStyle = (typeof CLOCK_STYLES)[number];
export const WEEK_STARTS = ['Monday', 'Sunday', 'Saturday'] as const;
export type WeekStart = (typeof WEEK_STARTS)[number];
export interface Locale { timezone: string; dateFormat: DateFormat; clock: ClockStyle; weekStart: WeekStart }
export const DEFAULT_ZONE = 'Europe/London';
/* Module 8: the time zone each country Organisation offers keeps its clocks in. */
export const COUNTRY_ZONES: Readonly<Record<string, string>> = { 'United Kingdom': 'Europe/London', Ireland: 'Europe/Dublin', Nepal: 'Asia/Kathmandu' };
export const DEFAULT_LOCALE: Readonly<Locale> = Object.freeze({ timezone: DEFAULT_ZONE, dateFormat: 'dd/mm/yyyy', clock: '24h', weekStart: 'Monday' });

/* supportedValuesOf omits UTC and some IANA links, including the commonly
   used Asia/Kathmandu spelling. Keep those named zones selectable too. */
const TIME_ZONE_LINKS = ['Asia/Kathmandu'] as const;
const timeZones = [...new Set([
  ...(typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [DEFAULT_ZONE]),
  'UTC',
  ...TIME_ZONE_LINKS,
])].sort();
const TIME_ZONE_SET = new Set(timeZones);
export const supportedTimeZones = (): readonly string[] => timeZones;

/* Accept named IANA identifiers only; Intl also accepts non-IANA offset strings. */
export function isTimeZone(zone: unknown): zone is string {
  return typeof zone === 'string' && TIME_ZONE_SET.has(zone);
}
const pick = <T extends string>(all: readonly T[], v: unknown, d: T): T => all.find(x => x === v) ?? d;
/* A locale from whatever a record holds: anything missing or unknown is the default. */
export function localeOf(v: Partial<Record<keyof Locale, unknown>> | null | undefined): Locale {
  return { timezone: isTimeZone(v?.timezone) ? v.timezone : DEFAULT_LOCALE.timezone, dateFormat: pick(DATE_FORMATS, v?.dateFormat, DEFAULT_LOCALE.dateFormat),
    clock: pick(CLOCK_STYLES, v?.clock, DEFAULT_LOCALE.clock), weekStart: pick(WEEK_STARTS, v?.weekStart, DEFAULT_LOCALE.weekStart) };
}
let active: Locale = { ...DEFAULT_LOCALE };
/* The locale the formatting and week rules read by default. */
export const activeLocale = (): Readonly<Locale> => active;
export function setActiveLocale(l: Partial<Record<keyof Locale, unknown>> | null | undefined) { active = localeOf(l); }

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
/* 0 is Monday, 6 is Sunday: the date's own weekday, whatever the week start. */
export const dowMon = (iso: string) => (parseIso(iso).getUTCDay() + 6) % 7;
/* The weekday a date falls on: "Thu". */
export const weekdayShort = (iso: string) => DOW_SHORT[dowMon(iso)] ?? '';
/* "Thu 13 Aug", or "Thu Aug 13" when the tenant writes the month first. */
export const formatDay = (iso: string, fmt: DateFormat = active.dateFormat) => {
  const d = parseIso(iso), mon = MONTH_SHORT[d.getUTCMonth()] ?? '';
  return fmt === 'mm/dd/yyyy' ? `${weekdayShort(iso)} ${mon} ${d.getUTCDate()}` : `${weekdayShort(iso)} ${d.getUTCDate()} ${mon}`;
};
/* A date in the tenant's format: "13/08/2026", "2026-08-13" or "08/13/2026".
   The name is the 1a one; every date on screen goes through it. */
export const formatDmy = (iso: string, fmt: DateFormat = active.dateFormat) => {
  const d = parseIso(iso), dd = pad(d.getUTCDate()), mm = pad(d.getUTCMonth() + 1), y = d.getUTCFullYear();
  return fmt === 'yyyy-mm-dd' ? `${y}-${mm}-${dd}` : fmt === 'mm/dd/yyyy' ? `${mm}/${dd}/${y}` : `${dd}/${mm}/${y}`;
};
/* A day and month in the tenant's format, without the year: "13/08", "08-13"
   or "08/13". For short labels such as the acknowledged pill. */
export const formatDayMonth = (iso: string, fmt: DateFormat = active.dateFormat) => {
  const d = parseIso(iso), dd = pad(d.getUTCDate()), mm = pad(d.getUTCMonth() + 1);
  return fmt === 'yyyy-mm-dd' ? `${mm}-${dd}` : fmt === 'mm/dd/yyyy' ? `${mm}/${dd}` : `${dd}/${mm}`;
};
/* A date typed in the tenant's format back to "2026-08-13"; '' when it is not a date. */
export const dmyToIso = (s: string, fmt: DateFormat = active.dateFormat) => {
  const t = String(s || '').trim();
  if (fmt === 'yyyy-mm-dd') return isIsoDate(t) ? t : '';
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t);
  if (!m) return '';
  const [day, month] = fmt === 'mm/dd/yyyy' ? [m[2], m[1]] : [m[1], m[2]];
  const iso = `${m[3] ?? ''}-${pad(Number(month))}-${pad(Number(day))}`;
  return isIsoDate(iso) ? iso : '';
};
export function isoWeek(iso: string): number {
  const j = parseIso(iso), day = (j.getUTCDay() + 6) % 7;
  j.setUTCDate(j.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(j.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((j.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
/* The week number of the week beginning `weekStart`: the ISO week of its
   fourth day, so a Monday week is its ISO week and a Sunday or Saturday week
   takes the number most of its days carry. */
export const weekNo = (weekStart: string) => isoWeek(addDays(weekStart, 3));
/* The multi-week card's label: "Week 32 · 03–09 Aug 2026", or across a month "Week 31 · 27 Jul – 02 Aug 2026". */
export function weekLabel(weekStart: string): string {
  const a = parseIso(weekStart), b = parseIso(addDays(weekStart, 6));
  const mon = (d: Date) => MONTH_SHORT[d.getUTCMonth()] ?? '';
  const span = a.getUTCMonth() === b.getUTCMonth()
    ? `${pad(a.getUTCDate())}–${pad(b.getUTCDate())} ${mon(b)}`
    : `${pad(a.getUTCDate())} ${mon(a)} – ${pad(b.getUTCDate())} ${mon(b)}`;
  return `Week ${weekNo(weekStart)} · ${span} ${b.getUTCFullYear()}`;
}
/* Weeks begin on the tenant's week start (Monday, Sunday or Saturday). Weeks,
   pay periods and cut-offs all count from it. */
const START_DOW: Readonly<Record<WeekStart, number>> = { Monday: 0, Sunday: 6, Saturday: 5 };
/* Where the date falls in its week: 0 on the week's first day, 6 on its last. */
export const dayIndex = (iso: string, ws: WeekStart = active.weekStart) => (dowMon(iso) - START_DOW[ws] + 7) % 7;
/* The first day of the week containing the date. */
export const periodStart = (iso: string, ws: WeekStart = active.weekStart) => addDays(iso, -dayIndex(iso, ws));
export const isWeekStart = (iso: string, ws: WeekStart = active.weekStart) => isIsoDate(iso) && dayIndex(iso, ws) === 0;
export const weekDates = (weekStart: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
/* A week slot's weekday, Monday 0: what a preference by weekday is matched against. */
export const slotWeekday = (day: number, ws: WeekStart = active.weekStart) => (START_DOW[ws] + day) % 7;
/* The seven day heads of a week, from its first day: "Mon" to "Sun" by default. */
export const weekHeads = (ws: WeekStart = active.weekStart) => Array.from({ length: 7 }, (_, i) => DOW_SHORT[slotWeekday(i, ws)] ?? '');

/* The clock every rule reads: a date and a 24-hour time in the tenant's zone.
   The prototype froze it at 13/08/2026 09:12. */
export interface Clock { date: string; time: string }
const ZONED = new Map<string, Intl.DateTimeFormat>();
function zoned(zone: string): Intl.DateTimeFormat {
  const z = isTimeZone(zone) ? zone : DEFAULT_ZONE;
  let f = ZONED.get(z);
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', { timeZone: z, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    ZONED.set(z, f);
  }
  return f;
}
/* The one clock: an instant as the date and time it is in `zone`. Every "now"
   and "today" a rule reads is clockAt(the server's now, the tenant's zone). */
export function clockAt(instant: string, zone: string): Clock {
  const parts = zoned(zone).formatToParts(new Date(instant));
  const part = (k: string) => parts.find(p => p.type === k)?.value ?? '00';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}
/* An instant on the active locale's clock: a stamped event's date and time. */
export const clockFromIso = (iso: string, zone: string = active.timezone): Clock => clockAt(iso, zone);

/* A 24-hour "HH:MM" on the tenant's clock: as it is, or "3:05 pm" on the
   12-hour clock. Anything that is not a time is left as it is. */
export function formatTime(hhmm: string, clock: ClockStyle = active.clock): string {
  const m = toMin(hhmm);
  if (m == null || clock === '24h') return hhmm;
  const h = Math.floor(m / 60), mm = m % 60;
  return `${h % 12 || 12}:${pad(mm)} ${h < 12 ? 'am' : 'pm'}`;
}
/* An instant's date and time in the tenant's zone, format and clock: "13/08/2026 14:30". */
export const formatDateTime = (iso: string) => { const c = clockFromIso(iso); return `${formatDmy(c.date)} ${formatTime(c.time)}`; };
/* An instant's date in the tenant's zone and format, never its UTC date. */
export const formatAtDate = (iso: string) => formatDmy(clockFromIso(iso).date);
/* An instant's day and month in the tenant's zone and format: "13/08". */
export const formatAtDayMonth = (iso: string) => formatDayMonth(clockFromIso(iso).date);

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
