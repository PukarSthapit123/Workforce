/* Module 2b Clocking (timesheet capture method B). One clock record per person
   per day (brief D1): the events the server stamped, never the browser's
   times. Everything the card shows is derived here from those events: the
   state, the time worked with breaks paused, and the day the clock writes
   through module 2's day save (D3). The moves (D2), late (D5) and forgotten
   (D6) rules and every sentence the card and the server say are here too, so
   the client and the fake server cannot disagree. The prototype's "·" asides
   are plain sentences. */
import { clockFromIso, formatDay, pad, toMin } from './time';
import type { BreakInput } from './timesheet';

export type ClockKind = 'in' | 'breakStart' | 'breakEnd' | 'out';
export interface ClockEvent { kind: ClockKind; at: string }
export type ClockState = 'idle' | 'running' | 'onBreak' | 'clockedOut';
export type ClockMove = 'in' | 'breakStart' | 'breakEnd' | 'out';

/* --------------------------------------------------------------- state */
/* A record closed after a forgotten clock-out (D6) is clocked out whatever its last event was. */
export function clockState(events: readonly ClockEvent[], closed = false): ClockState {
  if (closed) return 'clockedOut';
  const last = events.at(-1);
  if (!last) return 'idle';
  if (last.kind === 'out') return 'clockedOut';
  return last.kind === 'breakStart' ? 'onBreak' : 'running';
}
export const isOpenState = (s: ClockState) => s === 'running' || s === 'onBreak';

const ms = (iso: string) => new Date(iso).getTime();
/* Whole seconds worked: every span from a clock in or a break end to the next
   break start or clock out, and a span still running counts up to `now`, the
   server's clock. Breaks and the gap between a clock out and "Clock in again"
   are paused time. */
export function elapsedSeconds(events: readonly ClockEvent[], now: string, closed = false): number {
  let total = 0, since: number | null = null;
  for (const e of events) {
    if (e.kind === 'in' || e.kind === 'breakEnd') since = ms(e.at);
    else if (since != null) { total += ms(e.at) - since; since = null; }
  }
  if (since != null && !closed) total += ms(now) - since;
  return Math.max(0, Math.floor(total / 1000));
}
/* The prototype's fmtT: 7:58:12. */
export function formatElapsed(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  return `${Math.floor(s / 3600)}:${pad(Math.floor((s % 3600) / 60))}:${pad(s % 60)}`;
}
/* An event's time on the London clock every module 2 rule reads, as HH:MM. */
export const clockTime = (at: string) => clockFromIso(at).time;

/* ----------------------------------------------------- events to the day */
/* The breaks the clock recorded, start to end, as HH:MM pairs. A break still
   open has no pair yet. A break that starts and ends in the same minute is
   left out: module 2 refuses a zero-length break, and a pair the person never
   typed must not stop the day from saving. */
export function clockedBreaks(events: readonly ClockEvent[]): BreakInput[] {
  const out: BreakInput[] = [];
  let open: string | null = null;
  for (const e of events) {
    if (e.kind === 'breakStart') open = clockTime(e.at);
    else if (e.kind === 'breakEnd' && open != null) {
      const end = clockTime(e.at);
      if (end !== open) out.push({ start: open, end });
      open = null;
    }
  }
  return out;
}
const empty = (b: BreakInput) => !b.start.trim() && !b.end.trim();
const same = (a: BreakInput, b: BreakInput) => a.start.trim() === b.start && a.end.trim() === b.end;
/* The prototype's recordClockedBreak: each clocked break goes into the first
   pair with neither time, else a new pair while there is room for one under
   breaksMax. A pair already on the day (written by an earlier clock out) is
   not added twice. */
export function mergeBreaks(existing: readonly BreakInput[], clocked: readonly BreakInput[], max: number): BreakInput[] {
  const out = existing.map(b => ({ start: b.start, end: b.end }));
  for (const c of clocked) {
    if (out.some(b => same(b, c))) continue;
    const i = out.findIndex(empty);
    if (i >= 0) out[i] = { ...c };
    else if (out.length < max) out.push({ ...c });
  }
  return out;
}
/* The pairs a day would hold with the clocked breaks merged in: what the break cap counts. */
export const breaksUsed = (existing: readonly BreakInput[], events: readonly ClockEvent[]) =>
  mergeBreaks(existing, clockedBreaks(events), Number.POSITIVE_INFINITY).filter(b => !empty(b)).length;

export interface ClockEntry { start: string; finish: string; breaks: BreakInput[]; fields: Record<string, string | boolean> }
/* The day's first entry as the clock leaves it (D3): start from the first
   clock in, finish from the last clock out (or the finish the person gave
   when closing a forgotten clock), the clocked breaks merged into the breaks
   already there. The entry's other fields stay as they were. */
export function clockEntry(events: readonly ClockEvent[], existing: { breaks: readonly BreakInput[]; fields?: Record<string, string | boolean> } | undefined,
  breaksMax: number, finish?: string): ClockEntry {
  const first = events.find(e => e.kind === 'in'), last = [...events].reverse().find(e => e.kind === 'out');
  return {
    start: first ? clockTime(first.at) : '',
    finish: finish ?? (last ? clockTime(last.at) : ''),
    breaks: mergeBreaks(existing?.breaks ?? [], clockedBreaks(events), breaksMax),
    fields: { ...(existing?.fields ?? {}) },
  };
}

/* ---------------------------------------------------------------- moves */
export interface ClockProblem { code: string; message: string; next: string }
export const NOT_CLOCKED_IN: ClockProblem = { code: 'CLOCK_MOVE', message: 'You are not clocked in.', next: 'Clock in first.' };
export const ALREADY_IN: ClockProblem = { code: 'CLOCK_MOVE', message: 'You are already clocked in.', next: 'Clock out when you finish.' };
export const ON_BREAK_NOW: ClockProblem = { code: 'CLOCK_MOVE', message: 'You are on a break.', next: 'Resume, or clock out.' };
export const ALREADY_ON_BREAK: ClockProblem = { code: 'CLOCK_MOVE', message: 'You are already on a break.', next: 'Resume when the break ends.' };
export const NOT_ON_BREAK: ClockProblem = { code: 'CLOCK_MOVE', message: 'You are not on a break.', next: 'Start a break first.' };
export const BREAKS_OFF: ClockProblem = { code: 'FLAG_OFF', message: 'Break tracking is off, so the clock cannot record a break.',
  next: 'Add any break on the day form.' };
export const BREAK_LIMIT: ClockProblem = { code: 'BREAK_LIMIT', message: 'You have recorded the most breaks this day allows.',
  next: 'Carry on, and correct the breaks on the day form if you need to.' };
export interface MoveContext { breaksOn: boolean; breaksUsed: number; breaksMax: number }
/* D2: clock in only when idle or clocked out ("Clock in again"); break start
   only while running and Break tracking is on, and under the cap; break end
   only while on break; clock out while running or on break (the break ends
   first). Null when the move is allowed. */
export function moveProblem(state: ClockState, move: ClockMove, ctx: MoveContext): ClockProblem | null {
  switch (move) {
    case 'in': return state === 'running' ? ALREADY_IN : state === 'onBreak' ? ON_BREAK_NOW : null;
    case 'breakStart':
      if (state === 'onBreak') return ALREADY_ON_BREAK;
      if (state !== 'running') return NOT_CLOCKED_IN;
      if (!ctx.breaksOn) return BREAKS_OFF;
      return ctx.breaksUsed >= ctx.breaksMax ? BREAK_LIMIT : null;
    case 'breakEnd': return state === 'onBreak' ? null : NOT_ON_BREAK;
    case 'out': return isOpenState(state) ? null : NOT_CLOCKED_IN;
  }
}
/* The events a move adds, all at the server's `now`. Clocking out on a break ends the break first. */
export function eventsFor(state: ClockState, move: ClockMove, now: string): ClockEvent[] {
  if (move === 'out' && state === 'onBreak') return [{ kind: 'breakEnd', at: now }, { kind: 'out', at: now }];
  return [{ kind: move, at: now }];
}

/* ------------------------------------------------------- late (D5) */
/* A first clock in after the published rota line's start is late. No
   tolerance: 07:01 against 07:00 is late, 07:00 is not (the clock reads to the
   minute). No line (Rota off, a rest day, leave), no check. */
export function isLate(at: string, line: { from: string } | null | undefined): boolean {
  const start = toMin(line?.from), t = toMin(clockTime(at));
  return start != null && t != null && t > start;
}
export const lateNotices = (name: string, date: string, at: string, from: string) => ({
  subject: { title: 'Late clock-in', body: `You clocked in at ${clockTime(at)} on ${formatDay(date)}. Your shift started at ${from}.` },
  actor: { title: 'Late clock-in', body: `${name} clocked in at ${clockTime(at)} on ${formatDay(date)}. The shift started at ${from}.` },
});

/* --------------------------------------------------- forgotten (D6) */
/* A record from an earlier day still running or on break is a forgotten clock
   once the time since its first clock in passes the daily maximum (module 2's
   maxDaily). Until then it is a night shift still running past midnight, and
   the card keeps acting on it. */
export function isForgotten(rec: { date: string; events: readonly ClockEvent[]; closed?: boolean }, today: string, now: string, maxDailyHours: number): boolean {
  if (rec.date >= today || !isOpenState(clockState(rec.events, rec.closed))) return false;
  const first = rec.events.find(e => e.kind === 'in');
  return !first || ms(now) - ms(first.at) > maxDailyHours * 3600 * 1000;
}
export const forgottenMessage = (date: string) => `You did not clock out on ${formatDay(date)}.`;
export const closeFirst = (date: string): ClockProblem => ({ code: 'CLOCK_OPEN', message: `Close the clock from ${formatDay(date)} first.`,
  next: 'Enter the time you finished that day, then clock in.' });
export const NOT_FORGOTTEN: ClockProblem = { code: 'CLOCK_MOVE', message: 'This clock is still running.', next: 'Clock out instead.' };
export const ALREADY_CLOSED: ClockProblem = { code: 'CLOCK_MOVE', message: 'That clock is already closed.', next: 'Open the day to correct its times.' };

/* ------------------------------------------------------------- the gates */
export const CLOCK_OFF: ClockProblem = { code: 'MODULE_OFF', message: 'Clock in / out is switched off, so the clock cannot be used.',
  next: 'Record your day on the day form instead.' };
export const NOT_CLOCK_TYPE = (typeName: string): ClockProblem => ({ code: 'NOT_CLOCK_TYPE',
  message: `${typeName} records time on the day form, not the clock.`, next: 'Record your day on the day form instead.' });

/* ----------------------------------------------------- what the card says */
export const CLOCK_STATUS: Readonly<Record<ClockState, string>> = {
  idle: 'Ready to start. Tap Clock in when you begin your shift.',
  running: 'Clocked in. Shift running.',
  onBreak: 'On break. Timer paused.',
  clockedOut: 'Clocked out and saved as a draft. Save or submit the day below.',
};
export const clockedInToast = (at: string) => `Clocked in. Start time ${clockTime(at)}.`;
export const clockedOutToast = (seconds: number) => `Clocked out and saved as a draft. ${formatElapsed(seconds)}. Not submitted yet.`;
export const BREAK_STARTED = 'On break. Timer paused.';
export const BREAK_ENDED = 'Break ended and added to your breaks.';
export const closedToast = (date: string) => `The clock from ${formatDay(date)} is closed and the day saved as a draft. Not submitted yet.`;
/* The ring's target: the rota line's hours, else the prototype's 8 hours. */
export const ringTarget = (hours: number | null | undefined) => (hours && hours > 0 ? hours : 8);
