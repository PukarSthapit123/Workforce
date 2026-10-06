/* Module 2b Clocking (timesheet capture method B). One clock record per
   person per day (brief D1): the events the server stamped, never the
   browser's times; the state and the time worked are derived from them on
   every read. Own only (Review Focus 1): every path is the caller's own
   clock, so there is no person in any of them, and each needs own_ts. Every
   write carries If-Match: the clock record's version, 0 when there is none
   yet. Clock out, and closing a forgotten clock, write the day as a draft
   through module 2's day save (D3), so its lock, absence and capture rules
   refuse exactly as the day form's save does. No money (D7). */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime, RecordMeta } from './common';
import { IsoDate } from './people';
import { BreakInput, Clock, RotaDay, TimesheetDay } from './timesheets';

export const ClockKind = z.enum(['in', 'breakStart', 'breakEnd', 'out']);
export const ClockEvent = z.object({ kind: ClockKind, at: IsoDateTime });
export const ClockStateKey = z.enum(['idle', 'running', 'onBreak', 'clockedOut']);
export type ClockStateKey = z.infer<typeof ClockStateKey>;
export const ClockRecord = RecordMeta.extend({
  personCode: z.string(), date: IsoDate, events: z.array(ClockEvent),
  /* the first clock in came after the published rota line's start (D5) */
  late: z.boolean(),
  /* a forgotten clock-out closed later with the finish the person gave (D6) */
  closedLate: z.object({ finish: z.string(), at: IsoDateTime }).nullable(),
  /* the clocked break pairs the clock has written to the day so far: a later clock out adds only the rest, so a start
     or break the person edited or deleted stays as they left it (review I4); null until the clock first writes the day */
  written: z.object({ breaks: z.array(BreakInput) }).nullable(),
  /* derived on every read, never stored: the state, the seconds worked with
     breaks paused up to the server's now, and the day as "Thu 13 Aug" */
  state: ClockStateKey, elapsedSeconds: z.number().int().nonnegative(), label: z.string(),
});
export type ClockRecord = z.infer<typeof ClockRecord>;
const Blocked = z.object({ code: z.string(), message: z.string(), next: z.string() });
/* D4: the card shows only while Clock in / out is live, the person's type
   enters by clock and the day is not blocked (a closed period, a submitted
   or decided day, or an absence not marked worked anyway). */
export const ClockGates = z.object({
  live: z.boolean(), mode: z.enum(['form', 'grid', 'clock']), blocked: Blocked.nullable(), show: z.boolean(),
  /* Break tracking, and how many breaks a day may hold */
  breaks: z.boolean(), breaksMax: z.number().int().positive(),
});
export const MyClock = z.object({
  /* the server's clock: the card's timer ticks on from it, never from the browser's own */
  serverNow: IsoDateTime, now: Clock,
  /* the record the card acts on: today's, or a night shift still running past midnight */
  current: ClockRecord.nullable(),
  /* the If-Match clock in, break and clock out send: current's version, or 0 */
  version: z.number().int().nonnegative(),
  /* the published rota line for the current day, when there is one */
  rota: RotaDay.nullable(), targetHours: z.number().positive(),
  /* a clock from an earlier day nobody clocked out of (D6) */
  open: ClockRecord.nullable(),
  gates: ClockGates, status: z.string(),
});
export type MyClock = z.infer<typeof MyClock>;
export const ClockMoved = z.object({
  record: ClockRecord,
  /* the draft day clock out or a close wrote, with module 2's warnings */
  day: TimesheetDay.nullable(), warnings: z.array(z.string()),
  toast: z.string(), auditId: z.string(),
});
export type ClockMoved = z.infer<typeof ClockMoved>;
export const CloseClock = z.object({ finish: z.string().max(5) });
export type CloseClock = z.infer<typeof CloseClock>;
const ByDate = z.object({ date: IsoDate });

export const getMyClock = defineEndpoint({ method: 'GET', path: '/api/v1/clock/me', response: MyClock, capability: 'own_ts',
  summary: 'Your clock: the record the card acts on, the server\'s now, today\'s rota line, any clock from an earlier day left open, and the gates' });
export const clockIn = defineEndpoint({ method: 'POST', path: '/api/v1/clock/in', response: ClockMoved, capability: 'own_ts', versioned: true, errors: [409],
  summary: 'Clock in, or clock in again (If-Match: the clock record\'s version, 0 for none). A first clock in after the rota line\'s start is marked late.' });
export const startBreak = defineEndpoint({ method: 'POST', path: '/api/v1/clock/break/start', response: ClockMoved, capability: 'own_ts', versioned: true, errors: [409],
  summary: 'Start a break while clocked in and Break tracking is on, up to the breaks a day allows (If-Match)' });
export const endBreak = defineEndpoint({ method: 'POST', path: '/api/v1/clock/break/end', response: ClockMoved, capability: 'own_ts', versioned: true, errors: [409],
  summary: 'End the break and carry on (If-Match)' });
export const clockOut = defineEndpoint({ method: 'POST', path: '/api/v1/clock/out', response: ClockMoved, capability: 'own_ts', versioned: true, errors: [409],
  summary: 'Clock out, ending any break first, and save the day as a draft through the day save (If-Match). Its refusals are the day save\'s.' });
export const closeClock = defineEndpoint({ method: 'POST', path: '/api/v1/clock/:date/close', params: ByDate, request: CloseClock, response: ClockMoved,
  capability: 'own_ts', versioned: true, errors: [404, 409],
  summary: 'Close a clock from an earlier day nobody clocked out of, with the time you finished, and save that day as a draft (If-Match)' });
