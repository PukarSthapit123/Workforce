/* Module 2b Clocking (timesheet capture method B). One clock record per person
   per day (brief D1): the events the server stamped, never the browser's
   times. Everything the card shows is derived here from those events: the
   state, the time worked with breaks paused, and the day the clock writes
   through module 2's day save (D3). The moves (D2), late (D5) and forgotten
   (D6) rules and every sentence the card and the server say are here too, so
   the client and the fake server cannot disagree. The prototype's "·" asides
   are plain sentences. */
import { addDays, clockFromIso, formatDay, pad, toMin } from './time';
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
/* The breaks the clock recorded, start to end, as HH:MM pairs: every break,
   and the gap between a clock out and "Clock in again", which is unpaid time
   like a break (main-session ruling), so the day's net hours leave it out as
   the timer does. A break still open, or a clock out not yet followed by a
   clock in, has no pair yet. A pair that starts and ends in the same minute
   is left out: module 2 refuses a zero-length break, and a pair the person
   never typed must not stop the day from saving. */
export function clockedBreaks(events: readonly ClockEvent[]): BreakInput[] {
  const out: BreakInput[] = [];
  let open: string | null = null;
  for (const e of events) {
    if (e.kind === 'breakStart' || e.kind === 'out') { open = clockTime(e.at); continue; }
    const end = clockTime(e.at);
    if (open != null && end !== open) out.push({ start: open, end });
    open = null;
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
/* What the clock has already written to the day (review I4): the clocked
   pairs, in order. Events are only ever appended, so the pairs of a later
   write start with these, and only the rest are the clock's to add. Null
   until the clock first writes the day. */
export interface ClockWritten { breaks: BreakInput[] }
export const clockWritten = (events: readonly ClockEvent[]): ClockWritten => ({ breaks: clockedBreaks(events) });
const unwritten = (events: readonly ClockEvent[], written: ClockWritten | null | undefined) => clockedBreaks(events).slice(written?.breaks.length ?? 0);
/* The pairs a day would hold with the clock's unwritten breaks merged in: what the break cap counts. */
export const breaksUsed = (existing: readonly BreakInput[], events: readonly ClockEvent[], written?: ClockWritten | null) =>
  mergeBreaks(existing, unwritten(events, written), Number.POSITIVE_INFINITY).filter(b => !empty(b)).length;

export interface ClockEntry { start: string; finish: string; breaks: BreakInput[]; fields: Record<string, string | boolean> }
/* The day's first entry as the clock leaves it (D3), writing only what the
   clock owns since its last write (review I4): the finish is the last clock
   out (or the finish the person gave when closing the clock); the clocked
   pairs not yet written are merged into the breaks already there; the start
   is the first clock in on the clock's first write, and after that the start
   the person left. A break they edited or deleted stays as they left it. The
   entry's other fields stay as they were. */
export function clockEntry(events: readonly ClockEvent[],
  existing: { start?: string; breaks: readonly BreakInput[]; fields?: Record<string, string | boolean> } | undefined,
  breaksMax: number, written: ClockWritten | null = null, finish?: string): ClockEntry {
  const first = events.find(e => e.kind === 'in'), last = [...events].reverse().find(e => e.kind === 'out');
  const kept = written ? existing?.start?.trim() : '';
  return {
    start: kept || (first ? clockTime(first.at) : ''),
    finish: finish ?? (last ? clockTime(last.at) : ''),
    breaks: mergeBreaks(existing?.breaks ?? [], unwritten(events, written), breaksMax),
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
/* "Clock in again" records the gap since the clock out as a break pair, so it
   needs a pair left under breaksMax. Null when there is room, when the gap is
   too short to need a pair, or when this is not a clock in again. */
export function clockInAgainProblem(existing: readonly BreakInput[], events: readonly ClockEvent[], now: string, max: number,
  written?: ClockWritten | null): ClockProblem | null {
  if (clockState(events) !== 'clockedOut') return null;
  const before = breaksUsed(existing, events, written), after = breaksUsed(existing, [...events, { kind: 'in', at: now }], written);
  return after > before && after > max ? BREAK_LIMIT : null;
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
export function isLate(at: string, line: { from: string } | null | undefined, date?: string): boolean {
  const start = toMin(line?.from), t = toMin(clockTime(at));
  if (start == null || t == null) return false;
  /* a clock in after midnight against the line of the day before (review M1) is after its start */
  return (date != null && clockFromIso(at).date > date) || t > start;
}
/* `date` is the line's day; when the clock in came on a later calendar day (a night line after midnight) both are named. */
export const lateNotices = (name: string, date: string, at: string, from: string) => {
  const on = clockFromIso(at).date, line = on === date ? from : `${from} on ${formatDay(date)}`;
  return {
    subject: { title: 'Late clock-in', body: `You clocked in at ${clockTime(at)} on ${formatDay(on)}. Your shift started at ${line}.` },
    actor: { title: 'Late clock-in', body: `${name} clocked in at ${clockTime(at)} on ${formatDay(on)}. The shift started at ${line}.` },
  };
};
/* Review M1: a night line crosses midnight when it finishes at or before its
   start; from midnight until its finish a new clock belongs to it, on the
   line's date, rather than to the calendar day. */
export function inNightTail(line: { from: string; to: string }, time: string): boolean {
  const from = toMin(line.from), to = toMin(line.to), t = toMin(time);
  return from != null && to != null && t != null && to <= from && t < to;
}

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
/* Review I2: a forgotten clock whose day can no longer be written (a closed
   pay period, a submitted or decided day, a blocking absence) is closed
   without writing the day, so it stops blocking the clock; the line manager
   is asked to amend the day. */
export const noDaySentence = (manager: string) => `Closing the clock does not change the day itself. ${manager} is asked to amend it.`;
export const closedNoDayToast = (date: string, manager: string) =>
  `The clock from ${formatDay(date)} is closed. The day itself is not changed. ${manager} has been asked to amend it.`;
export const noDayNotice = (name: string, date: string, finish: string) => ({ title: 'Clock closed without the day',
  body: `${name} did not clock out on ${formatDay(date)} and finished at ${finish}. The day can no longer be changed from the clock, so it needs an amendment.` });
/* Review M3: a clock out a day rule refuses (the daily maximum, say) leaves
   the clock running, so the card offers the close flow with a finish the
   person chooses, and the refusal names it. The finish must have come: one
   at or before the first clock in is the next morning, as on the day form. */
export const CHOOSE_FINISH = 'Clock out at a time you choose';
export const CHOOSE_FINISH_NEXT = `Use “${CHOOSE_FINISH}” and enter the time you finished.`;
export const chosenToast = (finish: string) => `Clocked out at ${finish} and saved as a draft. Not submitted yet.`;
export const FINISH_AHEAD = { code: 'TS_INVALID', field: 'finish', message: 'That finish time has not come yet.', next: 'Enter the time you finished.' } as const;
export function finishAhead(date: string, start: string, finish: string, now: { date: string; time: string }): boolean {
  const s = toMin(start), f = toMin(finish);
  if (f == null) return false;
  const on = s != null && f <= s ? addDays(date, 1) : date;
  return `${on} ${finish}` > `${now.date} ${now.time}`;
}
export const BAD_FINISH ={ code: 'TS_INVALID', field: 'finish', message: 'Finish time must be a 24-hour time such as 15:00.', next: 'Enter the time you finished.' } as const;
export const ALREADY_CLOSED: ClockProblem = { code: 'CLOCK_MOVE', message: 'That clock is already closed.', next: 'Open the day to correct its times.' };

/* ------------------------------------------- a running clock holds its day */
/* Review I1: while a clock is running or on a break, the day it will write
   cannot be saved or submitted from the day form, the week or by a proxy, so
   the clock always finds a draft to write when it stops. */
export const CLOCK_OUT_FIRST = 'Clock out first.';
export const clockRunning = (date: string, proxy = false): ClockProblem => ({ code: 'CLOCK_RUNNING',
  message: `The clock is still running on ${formatDay(date)}.`, next: proxy ? 'Ask them to clock out first.' : CLOCK_OUT_FIRST });
export const clockHeldReason = (date: string) => `${formatDay(date)} has a clock still running, so it was held back. ${CLOCK_OUT_FIRST}`;

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
/* Review I3: a clock still running since an earlier calendar day says when it
   started, wherever the card shows it; null when it started today. */
export function clockedInSince(rec: { events: readonly ClockEvent[] }, today: string): string | null {
  const first = rec.events.find(e => e.kind === 'in');
  if (!first) return null;
  const on = clockFromIso(first.at);
  return on.date < today ? `Clocked in since ${formatDay(on.date)} ${on.time}.` : null;
}
/* Review M1: after midnight a clock goes on the night line of the day before, and the card says so. */
export const nightLineNote = (lineName: string, date: string, running: boolean) =>
  running ? `This clock goes on your ${lineName} shift of ${formatDay(date)}.` : `Clocking in now goes on your ${lineName} shift of ${formatDay(date)}.`;
