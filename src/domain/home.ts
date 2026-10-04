/* 1c group 7: My home, the month calendar (brief D7, D13). The prototype's
   essHome, dayInfo, calKey, greeting and whoLine (qnipay-workforce-v15.html:
   5323-5433, 6244-6256, 6307-6327). One answer per day: the published rota
   gives the shift, the leave records give leave and sickness, the timesheet
   gives what was recorded, and the tenant gives its bank holidays. The server
   paints the days with these rules; the page only draws them. */
import { DOW_SHORT, MONTH_SHORT, addDays, dowMon, pad, parseIso } from './time';
import { SHIFT_TONES } from './rota';
import type { TsState } from './timesheet';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;

/* ------------------------------------------------------------- months */
/* A month is "YYYY-MM". */
export const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
export const monthOf = (iso: string) => iso.slice(0, 7);
export function shiftMonth(month: string, n: number): string {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7)) - 1, t = y * 12 + m + n;
  return `${Math.floor(t / 12)}-${pad((t % 12 + 12) % 12 + 1)}`;
}
/* "August 2026" */
export const monthLabel = (month: string) => `${MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? ''} ${month.slice(0, 4)}`;
/* Every date in the month, first to last. */
export function monthDates(month: string): string[] {
  const first = `${month}-01`, out: string[] = [];
  for (let d = first; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
}
/* How many blank cells come before the 1st in a Monday-first grid (firstDowMon). */
export const leadingBlanks = (month: string) => dowMon(`${month}-01`);

/* CAL_MIN and CAL_MAX, worked out rather than fixed: from the month before
   today's to as far ahead as the rota horizon reaches (P: July 2026 to
   August 2027 at 12 months). */
export interface MonthBounds { min: string; max: string }
export const monthBounds = (today: string, horizonMonths: number): MonthBounds =>
  ({ min: shiftMonth(monthOf(today), -1), max: shiftMonth(monthOf(today), horizonMonths) });
export const inBounds = (month: string, b: MonthBounds) => MONTH_RE.test(month) && month >= b.min && month <= b.max;
export const outOfBoundsProblem = (b: MonthBounds) => ({
  field: 'month', message: `The calendar runs from ${monthLabel(b.min)} to ${monthLabel(b.max)}.`,
});

/* ----------------------------------------------------- greeting and who */
/* greeting(): by the hour on the tenant's clock. */
export function greeting(time: string): string {
  const h = Number(time.slice(0, 2));
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}
export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;
/* whoLine(): the job (or the type when there is no job), the type when it
   says something the job does not, and the location. */
export function whoLine(o: { job: string; type: string; location: string }): string {
  const bits = [o.job || o.type];
  if (o.type && o.job && o.type.toLowerCase() !== o.job.toLowerCase()) bits.push(o.type);
  bits.push(o.location);
  return bits.filter(Boolean).join(' · ');
}

/* -------------------------------------------------------- a day's glyph */
/* ✓ approved · ◷ awaiting a decision · ↻ resubmitted · ✕ sent back · ✎ draft
   · ⚠ nothing recorded. The tone is the calendar's own state colour. In this
   order the key lists them. */
export type GlyphKey = 'ok' | 'pend' | 'resub' | 'back' | 'draft' | 'none';
export type GlyphTone = 'ok' | 'pend' | 'att' | 'draft';
export interface Glyph { key: GlyphKey; glyph: string; tone: GlyphTone; label: string }
export const GLYPHS: Record<GlyphKey, Glyph> = {
  ok: { key: 'ok', glyph: '✓', tone: 'ok', label: 'Approved' },
  pend: { key: 'pend', glyph: '◷', tone: 'pend', label: 'Submitted, awaiting a decision' },
  resub: { key: 'resub', glyph: '↻', tone: 'pend', label: 'Resubmitted, awaiting a decision' },
  back: { key: 'back', glyph: '✕', tone: 'att', label: 'Sent back' },
  draft: { key: 'draft', glyph: '✎', tone: 'draft', label: 'Draft, not submitted' },
  none: { key: 'none', glyph: '⚠', tone: 'att', label: 'Nothing recorded' },
};
export const GLYPH_ORDER: readonly GlyphKey[] = ['ok', 'pend', 'resub', 'back', 'draft', 'none'];

/* dayInfo's state, as the cell shows it: leave or sickness carry no glyph;
   a recorded day carries its timesheet state; a past shift with nothing
   recorded is flagged; anything else is plain. */
export function dayGlyph(d: { absence: '' | 'V' | 'S'; ts: TsState | null; shift: boolean; past: boolean }): GlyphKey | null {
  if (d.absence) return null;
  if (d.ts) return d.ts;
  return d.shift && d.past ? 'none' : null;
}

/* ------------------------------------------------- the month's live key */
/* What a day contributes to the key and the month line. */
export interface KeyDay {
  tone: 'E' | 'L' | 'N' | null;
  /* the leave type's name and icon, or sickness */
  leave: { name: string; icon: string } | null;
  absence: '' | 'V' | 'S';
  glyph: GlyphKey | null;
  minutes: number;
}
export interface MonthKey {
  tones: { tone: 'E' | 'L' | 'N'; label: string; count: number }[];
  leave: { name: string; icon: string; count: number }[];
  states: { key: GlyphKey; glyph: string; tone: GlyphTone; label: string; count: number }[];
}
/* calKey(): only what the month holds, each with its count. */
export function monthKey(days: readonly KeyDay[]): MonthKey {
  const tones = SHIFT_TONES.map(([tone, l]) => ({ tone, label: l.split(' (')[0] ?? l, count: days.filter(d => d.tone === tone).length }))
    .filter(t => t.count > 0);
  const leave: MonthKey['leave'] = [];
  for (const d of days) {
    if (!d.leave) continue;
    const row = leave.find(x => x.name === d.leave?.name);
    if (row) row.count++;
    else leave.push({ ...d.leave, count: 1 });
  }
  const states = GLYPH_ORDER.map(k => ({ ...GLYPHS[k], label: GLYPHS[k].label.split(',')[0] ?? GLYPHS[k].label, count: days.filter(d => d.glyph === k).length }))
    .filter(s => s.count > 0).map(({ key, glyph, tone, label, count }) => ({ key, glyph, tone, label, count }));
  return { tones, leave, states };
}
export const keyIsEmpty = (k: MonthKey) => !k.tones.length && !k.leave.length && !k.states.length;

/* The month's totals, derived the same way the cells are. */
export interface MonthTotals { shifts: number; minutes: number; leaveDays: number }
export const monthTotals = (days: readonly KeyDay[]): MonthTotals => ({
  shifts: days.filter(d => d.tone).length, minutes: days.reduce((n, d) => n + d.minutes, 0), leaveDays: days.filter(d => d.absence === 'V').length,
});
/* "8 shifts · 36.5h recorded · 2 days leave", or '' for an empty month. */
export function monthSummary(t: MonthTotals): string {
  return [t.shifts ? `${t.shifts} shift${t.shifts === 1 ? '' : 's'}` : '',
    t.minutes ? `${(t.minutes / 60).toFixed(1)}h recorded` : '',
    t.leaveDays ? `${t.leaveDays} day${t.leaveDays === 1 ? '' : 's'} leave` : ''].filter(Boolean).join(' · ');
}

/* ------------------------------------------------------------- wording */
/* "Thu 13 Aug" */
export const shortDate = (iso: string) => { const d = parseIso(iso); return `${DOW_SHORT[dowMon(iso)] ?? ''} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()] ?? ''}`; };
/* "13 Aug" */
export const dayMonth = (iso: string) => { const d = parseIso(iso); return `${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()] ?? ''}`; };
/* "2 days with no hours recorded. Mon, Tue" */
export function missingTitle(dates: readonly string[]): string {
  return `${dates.length} day${dates.length === 1 ? '' : 's'} with no hours recorded: ${dates.map(d => DOW_SHORT[dowMon(d)] ?? '').join(', ')}`;
}
