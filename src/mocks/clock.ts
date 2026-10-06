/* Module 2b Clocking handlers. One clock record per person per day (D1),
   stamped with the server's clock; every rule is src/domain/clock.ts's. Own
   only: each path is the caller's own clock (Review Focus 1). Clock out, and
   closing a forgotten clock, write the day through module 2's day save path
   (draftBase, writeDraft), so its decided, lock, absence and capture rules
   refuse here exactly as they do on the day form (D3, Review Focus 3). One
   audit row per event; a refusal or a fault writes nothing, because serve()
   restores the store (Review Focus 5). */
import { store } from './store';
import { Refused, bump, refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { notifyEvent } from './notify';
import { rotaDaysFor } from './rota';
import { asStored, absenceBlocks, captureRules, dayView, daysOf, draftBase, isLocked, refuseLocked, writeDraft } from './timesheets';
import { effectiveCode, people, personByCode, recordAt, type Signed, type StoredPerson } from './world';
import { clockIn, clockOut, closeClock, endBreak, getMyClock, startBreak, type ClockMoved, type ClockRecord } from '@/contract/clock';
import type { Refusal } from '@/contract/common';
import type { DayInput, RotaDay } from '@/contract/timesheets';
import {
  ALREADY_CLOSED, BAD_FINISH, BREAK_ENDED, closedNoDayToast, noDayNotice, BREAK_STARTED, CLOCK_OFF, CLOCK_STATUS, NOT_CLOCK_TYPE, NOT_FORGOTTEN, breaksUsed, clockEntry, clockInAgainProblem,
  clockState, clockedInToast, clockedOutToast, closeFirst, closedToast, elapsedSeconds, eventsFor, isForgotten, isLate, isOpenState, lateNotices,
  moveProblem, ringTarget, clockWritten, type ClockEvent, type ClockMove, type ClockProblem, type ClockWritten,
} from '@/domain/clock';
import { absenceBlockedProblem } from '@/domain/leave';
import { DEFAULT_EXTRAS, flagOn, modOn } from '@/domain/modules';
import { clockFromIso, dowMon, formatDay, periodStart, toMin } from '@/domain/time';

interface StoredClock {
  id: string; version: number; updatedAt: string; personCode: string; date: string; events: ClockEvent[];
  late: boolean; closedLate: { finish: string; at: string } | null;
  /* the clocked pairs the clock has written to the day (review I4); absent on a record from before it was kept */
  written?: ClockWritten | null;
  /* a forgotten clock closed without writing its day, which could no longer be written (review I2) */
  closedNoDay?: { finish: string; at: string } | null;
}
interface Tenant { modules: Record<string, boolean>; flags: Record<string, unknown>; extras?: { breaksMax?: number } }
interface StoredType { code: string; name: string; mode?: 'form' | 'grid' | 'clock' }

const clocks = () => store.coll<StoredClock>('clockRecords');
const clockId = (code: string, date: string) => `clk_${code}_${date}`;
const today = () => clockFromIso(store.now()).date;
function tenant(): Tenant {
  const t = recordAt(store.coll<Tenant>('tenant'), 'tenant');
  if (!t) throw new Error('the store has no tenant record');
  return t;
}
const live = (t: Tenant) => modOn(t.modules, 'TS') && modOn(t.modules, 'B');
const breaksOn = (t: Tenant) => flagOn(t.modules, t.flags, 'BREAKS');
const breaksMax = (t: Tenant) => t.extras?.breaksMax ?? DEFAULT_EXTRAS.breaksMax;
const typeOf = (p: StoredPerson) => Object.values(store.coll<StoredType>('employeeTypes')).find(x => x.code === p.employeeType);
const closed = (r: StoredClock) => r.closedLate != null || r.closedNoDay != null;
const stateOf = (r: StoredClock) => clockState(r.events, closed(r));
const view = (r: StoredClock): ClockRecord => ({ ...r, written: r.written ?? null, closedNoDay: r.closedNoDay ?? null, state: stateOf(r),
  elapsedSeconds: elapsedSeconds(r.events, store.now(), closed(r)), label: formatDay(r.date) });
const refuseWith = (p: ClockProblem | Refusal, status = 409): never => refuse(status, { code: p.code, message: p.message, next: p.next, ...('field' in p && p.field ? { field: p.field } : {}) });

/* The published rota line for the day: a shift, never a rest day, leave or sickness (D5). */
function rotaLine(p: StoredPerson, date: string): RotaDay | null {
  const r = rotaDaysFor(p.code, periodStart(date))?.[dowMon(date)];
  return r && r.from && r.code !== 'V' && r.code !== 'S' ? r : null;
}
/* The person's line manager, by the name their record carries. */
const lineManager = (p: StoredPerson) => Object.values(people()).find(x => x.name === p.manager.trim() && x.code !== p.code);
const me = (s: Signed) => personByCode(effectiveCode(s))
  ?? refuse(404, { code: 'not-found', message: 'That person record no longer exists.', next: 'Reload the page.' });

/* The record the card acts on, and any forgotten one. A record still running
   or on break from an earlier day is the current one while it is within the
   daily maximum of its first clock in (a night shift), and forgotten after. */
function locate(p: StoredPerson): { current: StoredClock | undefined; open: StoredClock | undefined } {
  const d = today(), now = store.now(), max = captureRules().maxDaily;
  const active = Object.values(clocks()).filter(r => r.personCode === p.code && isOpenState(stateOf(r))).sort((a, b) => b.date.localeCompare(a.date))[0];
  const todays = recordAt(clocks(), clockId(p.code, d));
  if (active && isForgotten({ ...active, closed: false }, d, now, max)) return { current: todays, open: active };
  return { current: active ?? todays, open: undefined };
}
/* D4: why the day cannot be clocked, in module 2's and module 4's own words, or null. */
function dayBlocked(p: StoredPerson, date: string): Refusal | null {
  try {
    if (isLocked(date)) refuseLocked(p, date);
    const { base } = draftBase(p, date);
    const mark = absenceBlocks(p.code, date, Boolean(base.workedAnyway));
    if (mark) refuse(409, absenceBlockedProblem(mark));
    return null;
  } catch (e) {
    if (e instanceof Refused) return e.body;
    throw e;
  }
}
const shortBlocked = (b: Refusal | null) => (b ? { code: b.code, message: b.message, next: b.next } : null);
/* Every write: the clock is live and the person's type enters by clock. */
function owner(s: Signed): { p: StoredPerson; t: Tenant } {
  const p = me(s), t = tenant();
  if (!live(t)) refuseWith(CLOCK_OFF);
  const type = typeOf(p);
  if (type?.mode !== 'clock') refuseWith(NOT_CLOCK_TYPE(type?.name ?? 'This employee type'));
  return { p, t };
}
const put = (base: StoredClock, changes: Partial<StoredClock>): StoredClock => {
  const rec = bump(base, changes);
  clocks()[rec.id] = rec;
  return rec;
};
const blank = (p: StoredPerson, date: string): StoredClock =>
  ({ id: clockId(p.code, date), version: 0, updatedAt: store.now(), personCode: p.code, date, events: [], late: false, closedLate: null });
const storedDay = (p: StoredPerson, date: string) => daysOf(p.code).find(d => d.date === date);

/* D3: the clock's day, written through module 2's save path as a draft with
   captureSource clock. The stored day keeps everything the clock does not
   own; its first entry takes the clock's finish and the breaks it has not
   written yet, and its start on the clock's first write (review I4); an
   empty shift takes the rota line's. Refuses as the day save refuses. */
function writeClockDay(s: Signed, p: StoredPerson, t: Tenant, rec: StoredClock, events: readonly ClockEvent[], finish?: string) {
  const date = rec.date, { existing, base } = draftBase(p, date);
  const stored = existing ? asStored(existing) : null, first = stored?.entries[0];
  const entry = clockEntry(events, first, breaksMax(t), rec.written ?? null, finish);
  const shift = stored?.shift || rotaLine(p, date)?.code || '';
  const input: DayInput = stored
    ? { ...stored, shift, entries: [entry, ...stored.entries.slice(1)] }
    : { entries: [entry], shift };
  return writeDraft(s, p, base, input, 'clock');
}

const ACT: Record<ClockMove, string> = { in: 'Clocked in', breakStart: 'Break started', breakEnd: 'Break ended', out: 'Clocked out' };
function audit(s: Signed, act: string, before: StoredClock, after: StoredClock, detail: string, extra: Record<string, unknown> = {}) {
  return writeAudit({ who: actor(s), act, entity: 'clockRecord', entityId: after.id,
    before: before.version ? { state: stateOf(before) } : null, after: { state: stateOf(after), detail, ...extra } });
}
/* A break move: the record changes, the day does not. */
function breakMove(s: Signed, move: 'breakStart' | 'breakEnd', checkVersion: (r: StoredClock) => void): ClockMoved {
  const { p, t } = owner(s);
  const rec = locate(p).current ?? blank(p, today()), st = stateOf(rec);
  const used = breaksUsed(storedDay(p, rec.date)?.entries[0]?.breaks ?? [], rec.events, rec.written);
  const problem = moveProblem(st, move, { breaksOn: breaksOn(t), breaksUsed: used, breaksMax: breaksMax(t) });
  if (problem) refuseWith(problem);
  checkVersion(rec);
  const now = store.now(), saved = put(rec, { events: [...rec.events, ...eventsFor(st, move, now)] });
  const auditId = audit(s, ACT[move], rec, saved, `${formatDay(rec.date)} · ${clockFromIso(now).time}`);
  return { record: view(saved), day: null, warnings: [], toast: move === 'breakStart' ? BREAK_STARTED : BREAK_ENDED, auditId };
}

export const clockHandlers = [
  serve(getMyClock, ({ session }) => {
    const p = me(session), t = tenant(), now = store.now(), { current, open } = locate(p);
    const date = current?.date ?? today(), line = rotaLine(p, date), mode = typeOf(p)?.mode ?? 'form';
    const blocked = dayBlocked(p, date), on = live(t), running = Boolean(current && isOpenState(stateOf(current)));
    return {
      serverNow: now, now: clockFromIso(now), date, current: current ? view(current) : null, version: current?.version ?? 0,
      rota: line, targetHours: ringTarget(line?.hours), open: open ? view(open) : null, openBlocked: open ? shortBlocked(dayBlocked(p, open.date)) : null,
      gates: { live: on, mode, blocked: shortBlocked(blocked),
        /* a running clock always shows, so it can be stopped, even if its day was blocked since it started (review I3) */
        show: on && mode === 'clock' && (!blocked || running), breaks: breaksOn(t), breaksMax: breaksMax(t) },
      status: CLOCK_STATUS[current ? stateOf(current) : 'idle'],
    };
  }),

  serve(clockIn, ({ session, checkVersion }) => {
    const { p, t } = owner(session);
    const { current, open } = locate(p);
    /* D6: nothing new while an earlier clock is still open */
    if (open) refuseWith(closeFirst(open.date));
    const rec = current ?? blank(p, today()), st = stateOf(rec);
    const problem = moveProblem(st, 'in', { breaksOn: true, breaksUsed: 0, breaksMax: 1 })
      /* the gap before "Clock in again" is a break pair, so it needs one left (ruling) */
      ?? clockInAgainProblem(storedDay(p, rec.date)?.entries[0]?.breaks ?? [], rec.events, store.now(), breaksMax(t), rec.written);
    if (problem) refuseWith(problem);
    const blocked = dayBlocked(p, rec.date);
    if (blocked) refuseWith(blocked);
    checkVersion(rec);
    /* D5: only the day's first clock in is checked against the rota line */
    const now = store.now(), first = !rec.events.some(e => e.kind === 'in'), line = first ? rotaLine(p, rec.date) : null;
    const late = first ? isLate(now, line) : rec.late;
    const saved = put(rec, { events: [...rec.events, ...eventsFor(st, 'in', now)], late });
    if (first && late && line) {
      const n = lateNotices(p.name, rec.date, now, line.from), m = lineManager(p);
      notifyEvent('ts_late', 'subject', [p.code], n.subject);
      if (m) notifyEvent('ts_late', 'actor', [m.code], n.actor);
    }
    const auditId = audit(session, ACT.in, rec, saved, `${formatDay(rec.date)} · ${clockFromIso(now).time}${first && late && line ? ` · late against the ${line.from} start` : ''}`,
      first ? { late } : {});
    return { record: view(saved), day: null, warnings: [], toast: clockedInToast(now), auditId };
  }),

  serve(startBreak, ({ session, checkVersion }) => breakMove(session, 'breakStart', checkVersion)),
  serve(endBreak, ({ session, checkVersion }) => breakMove(session, 'breakEnd', checkVersion)),

  serve(clockOut, ({ session, checkVersion }) => {
    const { p, t } = owner(session);
    const rec = locate(p).current ?? blank(p, today()), st = stateOf(rec);
    const problem = moveProblem(st, 'out', { breaksOn: true, breaksUsed: 0, breaksMax: 1 });
    if (problem) refuseWith(problem);
    checkVersion(rec);
    const now = store.now(), events = [...rec.events, ...eventsFor(st, 'out', now)];
    const { rec: day, check } = writeClockDay(session, p, t, rec, events);
    const saved = put(rec, { events, written: clockWritten(events) }), worked = elapsedSeconds(events, now);
    const auditId = audit(session, ACT.out, rec, saved, `${formatDay(rec.date)} · ${clockFromIso(now).time} · saved as a draft`, { day: day.id });
    return { record: view(saved), day: dayView(day), warnings: check.warnings, toast: clockedOutToast(worked), auditId };
  }),

  serve(closeClock, ({ session, params, body, checkVersion }) => {
    const { p, t } = owner(session);
    const rec = recordAt(clocks(), clockId(p.code, params.date))
      ?? refuse(404, { code: 'not-found', message: `You have no clock on ${formatDay(params.date)}.`, next: 'Reload the page.' });
    if (!isOpenState(stateOf(rec))) refuseWith(ALREADY_CLOSED);
    if (!isForgotten(rec, today(), store.now(), captureRules().maxDaily)) refuseWith(NOT_FORGOTTEN);
    checkVersion(rec);
    const finish = body.finish.trim();
    /* review I2: a day that can no longer be written is left as it is; the clock closes without it and the line manager is asked to amend it */
    if (dayBlocked(p, rec.date)) {
      if (toMin(finish) == null) refuseWith(BAD_FINISH, 422);
      const saved = put(rec, { closedNoDay: { finish, at: store.now() } }), m = lineManager(p);
      if (m) notifyEvent('ts_missing', 'actor', [m.code], noDayNotice(p.name, rec.date, finish));
      const auditId = audit(session, 'Forgotten clock closed', rec, saved, `${formatDay(rec.date)} · finished at ${finish} · the day was not changed`);
      return { record: view(saved), day: null, warnings: [], toast: closedNoDayToast(rec.date, m?.name ?? (p.manager.trim() || 'Your manager')), auditId };
    }
    let written: ReturnType<typeof writeClockDay>;
    try { written = writeClockDay(session, p, t, rec, rec.events, finish); } catch (e) {
      /* the finish is this request's field, not the day form's */
      if (e instanceof Refused && e.body.field === 'entries.0.finish') refuse(e.status, { ...e.body, field: 'finish' });
      throw e;
    }
    const saved = put(rec, { closedLate: { finish, at: store.now() }, written: clockWritten(rec.events) });
    const auditId = audit(session, 'Forgotten clock closed', rec, saved, `${formatDay(rec.date)} · finished at ${finish} · saved as a draft`, { day: written.rec.id });
    return { record: view(saved), day: dayView(written.rec), warnings: written.check.warnings, toast: closedToast(rec.date), auditId };
  }),
];
