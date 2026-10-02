/* Module 2 Timesheet handlers. Every capture rule is the domain's (brief D3):
   errors refuse with TS_INVALID (and `field`) or PERIOD_LOCKED, warnings travel
   with the saved record. One record per person per day (D1), moved only along
   TS_STATES (D2). Approval queues a posting; only the dispatcher, run when the
   approvals queue is read, resolves it (D4). One audit row per mutation; a
   refusal or a fault writes none, because serve() restores the store. */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor, requireCapability } from './auth';
import { writeAudit } from './audit';
import { faults } from './faults';
import { invalid } from './people';
import meta from './seed/meta.json';
import { effectiveCode, inScope, nameOf, personByCode, recordAt, scopeOf, type Signed, type StoredPerson } from './world';
import {
  bulkApproveTimesheets, getTimesheetConfig, getTimesheetWeek, listTimesheetApprovals, retryIntegrationAttempt, saveTimesheetDay,
  submitMultiweek, submitTimesheetDay, submitTimesheetWeek, transitionTimesheetDay, updateTimesheetConfig,
  type DayInput, type IntegrationAttempt, type QueueRow, type TimesheetConfig, type TimesheetDay, type TimesheetField, type UpdateTimesheetConfig,
} from '@/contract/timesheets';
import type { Problem } from '@/domain/codes';
import {
  APPROVAL_AUDIT_SUFFIX, TS_STATE, advisoryFlags, allSubmittedMessage, alreadySubmittedMessage, clockFromIso, dayMinutes,
  deriveWorkType, dispatchAttempt, dowMon, formatDmy, formatMinutes, historyEntry, isoWeek, lockNote, missingMandatory,
  periodLocked, periodStart, planWeekSubmit, queueChecksum, queuedAttempt, retryAttempt, retryAuditText, retryProblem,
  returnReasonProblem, rotaFor, timesheetConfigProblem, toMin, transitionAuditText, tsCan, tsPending, tsTransitionProblem,
  validateTimes, weekBlockedMessage, weekDates, weekDayOutcome, weekLabel, weekModel, weekTotals, NOTHING_TO_SUBMIT,
  type AllowanceDef, type CheckContext, type FieldEnv, type PayCode, type TsState, type WeekDayInput,
} from '@/domain/timesheet';

type StoredDay = Omit<TimesheetDay, 'minutes' | 'posting' | 'enteredByName'>;
type StoredAttempt = IntegrationAttempt;
interface Tenant { modules: Record<string, boolean>; flags: Record<string, unknown> }
interface StoredType { code: string; name: string; capabilities: string[]; mode?: 'form' | 'grid' | 'clock' }

export const FIELDS: TimesheetField[] = meta.timesheetFields;
const days = () => store.coll<StoredDay>('timesheetDays');
const attempts = () => store.coll<StoredAttempt>('integrationAttempts');
const dayId = (code: string, date: string) => `tsd_${code}_${date}`;
function config(): TimesheetConfig {
  const c = recordAt(store.coll<TimesheetConfig>('timesheetConfig'), 'timesheetConfig');
  if (!c) throw new Error('the store has no timesheet config');
  return c;
}
function tenant(): Tenant {
  const t = recordAt(store.coll<Tenant>('tenant'), 'tenant');
  if (!t) throw new Error('the store has no tenant record');
  return t;
}
const payCodes = (): PayCode[] => Object.values(store.coll<PayCode>('payCodes'))
  .map(p => ({ code: p.code, basis: p.basis, value: p.value, element: p.element, label: p.label, workType: p.workType }));
const employeeType = (code: string) => Object.values(store.coll<StoredType>('employeeTypes')).find(t => t.code === code);
const typeOf = (p: StoredPerson) => recordAt(config().types, p.employeeType);
const envFor = (p: StoredPerson): FieldEnv => {
  const t = tenant();
  return { modules: t.modules, flagOn: c => Boolean(t.flags[c]), capabilities: employeeType(p.employeeType)?.capabilities ?? [], defaults: config().fieldDefaults };
};
const now = () => clockFromIso(store.now());
const managerOf = (p: StoredPerson) => p.manager.trim() || 'your manager';
/* The rota line reaches the checks only while Rota is on (D9). Rota lines are
   module 3's; until it lands there is no line to pass, so none is. */
const rulesCtx = (): Omit<CheckContext, 'date'> => {
  const c = config();
  return { now: now(), rules: c.rules, cutoff: c.cutoff, timeFormat: c.timeFormat, rota: rotaFor(tenant().modules, undefined) };
};
const ctxFor = (date: string): CheckContext => ({ date, ...rulesCtx() });
const isLocked = (date: string) => { const c = config(); return periodLocked(date, { enforceLock: c.rules.enforceLock, cutoff: c.cutoff }, now()); };
const hm = (min: number) => formatMinutes(min, config().timeFormat);

function attemptOf(d: StoredDay): StoredAttempt | undefined {
  return d.integrationAttemptId ? recordAt(attempts(), d.integrationAttemptId) : undefined;
}
export const dayView = (d: StoredDay): TimesheetDay => ({
  ...d, enteredByName: personByCode(d.enteredBy)?.name ?? d.enteredBy, minutes: dayMinutes(d.entries), posting: attemptOf(d)?.state ?? 'none',
});

/* ------------------------------------------------------------ who may act */
function personFor(personId: string): StoredPerson {
  return personByCode(personId) ?? refuse(404, { code: 'not-found', message: 'That person record no longer exists.', next: 'Reload the page.' });
}
type Mode = 'self' | 'proxy';
/* Your own timesheet needs own_ts. Anyone else's needs team_ts and your
   location (D5, D6); entering time for them needs proxy as well. */
function access(s: Signed, p: StoredPerson, write: boolean): Mode {
  if (p.code === effectiveCode(s)) { requireCapability(s, 'own_ts'); return 'self'; }
  requireCapability(s, 'team_ts');
  if (!inScope(s, p.location)) refuse(403, { code: 'scope', message: 'This person is outside the people you look after.',
    next: 'Ask an administrator if you need their timesheet.' });
  if (write) requireCapability(s, 'proxy');
  return 'proxy';
}

/* -------------------------------------------------------------- the checks */
interface DayCheck { errors: Problem[]; warnings: string[]; minutes: number }
const firstStart = (entries: DayInput['entries']) => toMin(entries.find(e => toMin(e.start) != null)?.start);
function valuesFor(input: DayInput): Record<string, string | boolean | undefined> {
  const e = input.entries[0];
  if (!e) return {};
  const hoursOnly = !e.start.trim() && !e.finish.trim() && e.hours != null && e.hours > 0;
  const out: Record<string, string | boolean | undefined> = { start: hoursOnly ? String(e.hours) : e.start, finish: hoursOnly ? String(e.hours) : e.finish };
  e.breaks.forEach((b, i) => { const n = i ? String(i + 1) : ''; out[`break_s${n}`] = b.start; out[`break_e${n}`] = b.end; });
  out.shift_code = input.shift ?? '';
  return { ...out, ...e.fields };
}
/* Everything validateTimes and the field rules say about one day, entry by
   entry, with each field named as the form names it (entries.0.start). */
function checkDay(p: StoredPerson, date: string, input: DayInput): DayCheck {
  const ctx = ctxFor(date), rules = ctx.rules, type = typeOf(p);
  const errors: Problem[] = [], warnings: string[] = [];
  errors.push(...validateTimes({ start: '', finish: '', breaks: [] }, ctx).errors);
  if (!input.entries.length && !input.nonWorkingReason?.trim())
    errors.push({ field: 'entries', message: 'Enter a start and finish time, or mark the day as non-working with a reason.' });
  let entryMaxed = false;
  input.entries.forEach((e, i) => {
    const blank = !e.start.trim() && !e.finish.trim();
    if (blank && e.hours == null) { errors.push({ field: `entries.${i}.start`, message: 'Add a start and finish time.' }); return; }
    if (blank) return;
    const r = validateTimes(e, ctx);
    for (const x of r.errors) if (x.field !== 'date') { errors.push({ field: `entries.${i}.${x.field}`, message: x.message }); if (x.message.includes('daily maximum')) entryMaxed = true; }
    warnings.push(...r.warnings);
  });
  const minutes = dayMinutes(input.entries);
  const several = input.entries.length > 1 || input.entries.some(e => !e.start.trim() && !e.finish.trim());
  if (several && minutes && !entryMaxed) {
    if (minutes / 60 > rules.maxDaily) errors.push({ field: 'entries', message: `Net time is ${hm(minutes)}, above the ${rules.maxDaily}-hour daily maximum.` });
    else if (minutes / 60 < rules.minNet) errors.push({ field: 'entries', message: `Net time is ${hm(minutes)}. Record at least ${rules.minNet} h.` });
    else if (minutes / 60 > rules.warnDaily && !warnings.some(w => w.includes('review threshold')))
      warnings.push(`That is ${hm(minutes)} in one day. It is above the ${rules.warnDaily}-hour review threshold.`);
  }
  const allowed = type?.allowances ?? [];
  const extra = (input.allowances ?? []).find(a => !allowed.includes(a));
  if (extra) errors.push({ field: 'allowances', message: `${extra} is not an allowance ${employeeType(p.employeeType)?.name ?? 'this employee type'} can claim.` });
  if (input.entries.length) {
    const missing = missingMandatory(FIELDS, type, envFor(p), valuesFor(input));
    if (missing) errors.push({ field: `entries.0.${missing.field}`, message: missing.message });
  }
  return { errors, warnings, minutes };
}
const LOCK_NEXT = (p: StoredPerson) => `Ask ${managerOf(p)} to raise an amendment.`;
function refuseLocked(p: StoredPerson, date: string): never {
  return refuse(409, { code: 'PERIOD_LOCKED', field: 'date', message: `${lockNote(date, config().cutoff)}.`, next: LOCK_NEXT(p) });
}
function refuseDay(p: StoredPerson, date: string, errors: readonly Problem[]): never {
  if (isLocked(date)) refuseLocked(p, date);
  const first = errors[0];
  return refuse(422, { code: 'TS_INVALID', field: first?.field ?? 'entries', message: first?.message ?? 'This day cannot be saved.',
    next: 'Correct the highlighted field and try again.' });
}
const alreadySubmitted = (d: StoredDay): never => refuse(409, { code: 'ALREADY_SUBMITTED', message: alreadySubmittedMessage(d.date, d.state),
  next: d.state === 'ok' ? 'An approved day changes only by an amendment.' : 'Wait for a decision, or ask your approver to send it back.' });

/* ------------------------------------------------------------- the writes */
const blankDay = (p: StoredPerson, date: string): StoredDay => ({
  id: dayId(p.code, date), version: 0, updatedAt: store.now(), personCode: p.code, date, state: 'draft', entries: [], workType: '',
  allowances: [], shift: '', nonWorkingReason: '', captureSource: 'self', enteredBy: p.code, submittedAt: '', returnReason: '',
  warnings: [], history: [], integrationAttemptId: '',
});
/* A type with no usable rule falls back to standard time, as every prototype submission did ("STD 7.5h"). */
const BASE_WORK_TYPE = 'STD';
/* The day as the input leaves it, with the derived work type and whoever entered it. */
function applyInput(p: StoredPerson, base: StoredDay, input: DayInput, check: DayCheck, s: Signed, mode: Mode): Partial<StoredDay> {
  const c = config();
  const derived = deriveWorkType(typeOf(p)?.rules ?? [], { date: base.date, start: firstStart(input.entries), net: check.minutes,
    travel: input.entries.some(e => Boolean(e.fields?.travel)) }, c.rules, payCodes());
  return {
    entries: input.entries.map(e => ({ start: e.start.trim(), finish: e.finish.trim(), breaks: e.breaks, ...(e.hours != null ? { hours: e.hours } : {}), fields: e.fields ?? {} })),
    allowances: input.allowances ?? [], shift: input.shift ?? base.shift, nonWorkingReason: input.nonWorkingReason?.trim() ?? '',
    workType: derived?.code ?? BASE_WORK_TYPE, warnings: check.warnings, captureSource: mode, enteredBy: s.account.personCode,
  };
}
const by = (s: Signed) => { const w = actor(s); return { personCode: w.personCode, name: w.name }; };
function moved(d: StoredDay, to: TsState, s: Signed, reason = ''): Partial<StoredDay> {
  return { state: to, history: [...d.history, historyEntry(d.state, to, by(s), store.now(), reason)] };
}
const save = (base: StoredDay, changes: Partial<StoredDay>): StoredDay => {
  const rec = { ...bump(base, changes) };
  days()[rec.id] = rec;
  return rec;
};
const stateAct = (to: TsState) => `Timesheet ${TS_STATE[to].label.toLowerCase()}`;

/* A counter one past the highest stored, as audit ids are. */
const INT = /^int_(\d{12})$/;
function nextAttemptId(): string {
  let max = 0;
  for (const id of Object.keys(attempts())) max = Math.max(max, Number(INT.exec(id)?.[1] ?? 0));
  return `int_${String(max + 1).padStart(12, '0')}`;
}
/* D4: approval queues a posting and never posts. */
function queuePosting(p: StoredPerson, d: StoredDay): StoredAttempt {
  const id = nextAttemptId(), m = dayMinutes(d.entries);
  const a: StoredAttempt = { id, version: 1, updatedAt: store.now(), event: 'Post to buffer', ref: `${p.name} · ${formatDmy(d.date)}`,
    summary: `${d.workType || 'STD'} ${(m / 60).toFixed(1)}h`, ...queuedAttempt(), simulated: true, dayId: d.id, at: store.now() };
  attempts()[id] = a;
  return a;
}
function approve(p: StoredPerson, d: StoredDay, s: Signed) {
  const a = queuePosting(p, d);
  const rec = save(d, { ...moved(d, 'ok', s), integrationAttemptId: a.id });
  return { rec, a };
}
/* The dispatcher (D4): the only thing that resolves an attempt, run on each
   read of the approvals queue. An attempt with a cause fails every time; a
   DISPATCH fault set through /api/_dev/faults on /api/v1/integration/attempts
   (or one attempt's path) fails the next one it meets, once. */
const DISPATCH_FAULT = 'Business Central did not answer (simulated fault).';
function takeDispatchFault(id: string): boolean {
  const f = faults.find(x => x.method === 'DISPATCH' && x.times > 0 && (x.path === '/api/v1/integration/attempts' || x.path === `/api/v1/integration/attempts/${id}`));
  if (!f) return false;
  f.times--;
  return true;
}
function dispatch() {
  for (const a of Object.values(attempts())) {
    if (a.state !== 'queued') continue;
    const out: StoredAttempt = takeDispatchFault(a.id) ? { ...a, state: 'failed', reason: DISPATCH_FAULT } : dispatchAttempt(a);
    attempts()[a.id] = { ...out, version: a.version + 1, updatedAt: store.now(), at: store.now() };
  }
}

/* ---------------------------------------------------------------- reading */
const flagsFor = (d: StoredDay) => {
  return advisoryFlags({ date: d.date, minutes: dayMinutes(d.entries), state: d.state, captureSource: d.captureSource }, rulesCtx());
};
function captureFor(p: StoredPerson) {
  const c = config(), t = tenant(), type = typeOf(p) ?? null, codes = payCodes();
  const allowances: AllowanceDef[] = (type?.allowances ?? []).map(code => recordAt(c.allowances, code)
    ?? { code, label: codes.find(x => x.code === code)?.label ?? code, payCode: code, tier: 'core' });
  return {
    rules: c.rules, cutoff: c.cutoff, timeFormat: c.timeFormat, returnReasonRequired: c.returnReasonRequired, weekGrid: c.weekGrid,
    weekLayout: c.weekLayout, fields: FIELDS, type, modules: t.modules, flags: Object.keys(t.flags).filter(k => Boolean(t.flags[k])),
    capabilities: employeeType(p.employeeType)?.capabilities ?? [], fieldDefaults: c.fieldDefaults, allowances, payCodes: codes,
    mode: employeeType(p.employeeType)?.mode ?? 'form',
  };
}
const daysOf = (code: string) => Object.values(days()).filter(d => d.personCode === code);
/* Earlier weeks with time still to send (ready) or awaiting a decision (submitted), newest first. */
function earlierWeeks(p: StoredPerson) {
  const current = periodStart(now().date), cutoff = config().cutoff;
  const byWeek = new Map<string, StoredDay[]>();
  for (const d of daysOf(p.code)) {
    if (d.date >= current) continue;
    const ws = periodStart(d.date);
    byWeek.set(ws, [...(byWeek.get(ws) ?? []), d]);
  }
  return [...byWeek].map(([ws, list]) => {
    const ready = list.some(d => (d.state === 'draft' || d.state === 'back') && dayMinutes(d.entries) > 0);
    const waiting = list.some(d => tsPending(d.state));
    if (!ready && !waiting) return null;
    const locked = isLocked(ws);
    return { weekStart: ws, label: weekLabel(ws), minutes: list.reduce((n, d) => n + dayMinutes(d.entries), 0),
      status: ready ? 'ready' as const : 'submitted' as const, locked, lockNote: locked ? lockNote(ws, cutoff) : '' };
  }).filter(w => w !== null).sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, 8);
}
function requireMonday(weekStart: string, field = 'weekStart') {
  if (dowMon(weekStart) !== 0) invalid({ field, message: 'A week starts on a Monday.' });
}

/* ----------------------------------------------------------- week submit */
interface Planned { date: string; input: DayInput | null; existing: StoredDay | undefined; check: DayCheck | null }
function planWeek(p: StoredPerson, weekStart: string, given: Map<string, DayInput>) {
  const planned: Planned[] = weekDates(weekStart).map(date => {
    const existing = recordAt(days(), dayId(p.code, date));
    const input = given.get(date) ?? (existing ? { entries: existing.entries, allowances: existing.allowances, shift: existing.shift, nonWorkingReason: existing.nonWorkingReason } : null);
    const minutes = input ? dayMinutes(input.entries) : 0;
    return { date, input, existing, check: input && minutes ? checkDay(p, date, input) : null };
  });
  /* the week's own message already opens with "Submission blocked.", so a mandatory field message does not repeat it */
  const inputs: WeekDayInput[] = planned.map(d => ({ date: d.date, minutes: d.check?.minutes ?? 0, state: d.existing?.state ?? null,
    errors: (d.check?.errors ?? []).map(e => ({ ...e, message: e.message.replace(/^Submission blocked\. /, '') })) }));
  const ctx = rulesCtx();
  return { planned, inputs, plan: planWeekSubmit(inputs, ctx), ctx };
}
/* The first day that blocks the week, for the refusal's field. */
function firstBlocked(planned: readonly Planned[], ctx: Omit<CheckContext, 'date' | 'rota'>) {
  return planned.find(d => {
    if (!d.check || (d.existing && d.existing.state !== 'draft' && d.existing.state !== 'back')) return false;
    const o = weekDayOutcome(d.date, d.check.minutes, ctx);
    return o.kind === 'blocked' || (o.kind === 'ready' && d.check.errors.length > 0);
  });
}
function submitPlanned(p: StoredPerson, planned: readonly Planned[], dates: readonly string[], s: Signed, mode: Mode): StoredDay[] {
  return dates.map(date => {
    const d = planned.find(x => x.date === date);
    if (!d?.input || !d.check) throw new Error(`week plan lost ${date}`);
    const base = d.existing ?? blankDay(p, date);
    const to: TsState = base.state === 'back' ? 'resub' : 'pend';
    const reason = to === 'resub' ? 'Corrected and resubmitted' : mode === 'proxy' ? 'Submitted on their behalf' : '';
    return save(base, { ...applyInput(p, base, d.input, d.check, s, mode), ...moved(base, to, s, reason), submittedAt: store.now() });
  });
}

/* ----------------------------------------------------------------- queue */
const PAGE = 50;
interface Located { d: StoredDay; p: StoredPerson }
function located(): Located[] {
  return Object.values(days()).flatMap(d => { const p = personByCode(d.personCode); return p ? [{ d, p }] : []; });
}
const rowOf = ({ d, p }: Located): QueueRow =>
  ({ ...dayView(d), personName: p.name, location: p.location, locationName: nameOf('locations', p.location), flags: flagsFor(d) });

export const timesheetHandlers = [
  serve(getTimesheetWeek, ({ session, params }) => {
    const p = personFor(params.personId);
    access(session, p, false);
    requireMonday(params.weekStart);
    const ws = params.weekStart, c = config(), today = now();
    const list = weekDates(ws).map(date => {
      const d = recordAt(days(), dayId(p.code, date)), locked = isLocked(date);
      return { date, record: d ? dayView(d) : null, state: d?.state ?? 'none' as const, version: d?.version ?? 0,
        minutes: d ? dayMinutes(d.entries) : 0, future: date > today.date, locked, lockNote: locked ? lockNote(date, c.cutoff) : '',
        flags: d && d.state !== 'draft' ? flagsFor(d) : [] };
    });
    const alloc = weekModel(FIELDS, typeOf(p), envFor(p), c.weekGrid).ctx.map(f => f.c);
    const totals = weekTotals(ws, list.flatMap(x => (x.record ? [{ date: x.date, entries: x.record.entries }] : [])), alloc);
    return {
      person: { code: p.code, name: p.name, employeeType: p.employeeType, typeName: employeeType(p.employeeType)?.name ?? p.employeeType,
        location: p.location, manager: p.manager, contractedHours: Math.max(0, p.contractedHours) },
      weekStart: ws, label: weekLabel(ws), now: today, days: list, weekMinutes: totals.weekMinutes, byAllocation: totals.byAllocation,
      capture: captureFor(p), earlierWeeks: earlierWeeks(p),
    };
  }),

  serve(saveTimesheetDay, ({ session, params, body, checkVersion }) => {
    const p = personFor(params.personId), mode = access(session, p, true);
    const existing = recordAt(days(), dayId(p.code, params.date));
    if (existing && existing.state !== 'draft' && existing.state !== 'back') alreadySubmitted(existing);
    const base = existing ?? blankDay(p, params.date);
    checkVersion(base);
    const check = checkDay(p, params.date, body);
    if (check.errors.length) refuseDay(p, params.date, check.errors);
    const rec = save(base, applyInput(p, base, body, check, session, mode));
    const auditId = writeAudit({ who: actor(session), act: mode === 'proxy' ? 'Proxy timesheet saved' : 'Timesheet draft saved',
      entity: 'timesheetDay', entityId: rec.id, before: existing ? { minutes: dayMinutes(existing.entries) } : null,
      after: { state: rec.state, minutes: dayMinutes(rec.entries), ...(mode === 'proxy' ? { enteredFor: `${p.name} (${p.code})` } : {}) } });
    return { record: dayView(rec), warnings: check.warnings, auditId };
  }),

  serve(submitTimesheetDay, ({ session, params, body, checkVersion }) => {
    const p = personFor(params.personId), mode = access(session, p, true);
    const existing = recordAt(days(), dayId(p.code, params.date));
    /* D8: a retried submit finds the first one and is refused before the version is read */
    if (existing && (tsPending(existing.state) || existing.state === 'ok')) alreadySubmitted(existing);
    const base = existing ?? blankDay(p, params.date);
    checkVersion(base);
    const check = checkDay(p, params.date, body);
    if (check.errors.length) refuseDay(p, params.date, check.errors);
    const to: TsState = base.state === 'back' ? 'resub' : 'pend';
    const reason = to === 'resub' ? 'Corrected and resubmitted' : mode === 'proxy' ? 'Submitted on their behalf' : '';
    const rec = save(base, { ...applyInput(p, base, body, check, session, mode), ...moved(base, to, session, reason), submittedAt: store.now() });
    const detail = transitionAuditText(p.name, rec.date, base.state, to, reason) + (mode === 'proxy' ? ` · ${hm(dayMinutes(rec.entries))} · entered on their behalf` : '');
    const auditId = writeAudit({ who: actor(session), act: mode === 'proxy' ? 'Proxy timesheet submitted' : stateAct(to), entity: 'timesheetDay',
      entityId: rec.id, before: { state: base.state }, after: { state: to, detail } });
    return { record: dayView(rec), warnings: check.warnings, auditId };
  }),

  serve(submitTimesheetWeek, ({ session, params, body }) => {
    const p = personFor(params.personId), mode = access(session, p, true);
    requireMonday(params.weekStart);
    const dates = weekDates(params.weekStart), given = new Map<string, DayInput>();
    body.days.forEach((d, i) => {
      if (!dates.includes(d.date)) invalid({ field: `days.${i}.date`, message: `${formatDmy(d.date)} is not in this week.` });
      if (given.has(d.date)) invalid({ field: `days.${i}.date`, message: `${formatDmy(d.date)} is in this request twice.` });
      const stored = recordAt(days(), dayId(p.code, d.date));
      if ((stored?.version ?? 0) !== d.version)
        refuse(412, { code: 'stale', field: `days.${i}`, message: `Somebody changed ${formatDmy(d.date)} since you opened this week. Nothing has been saved.`, next: 'Reload and apply your change again' });
      given.set(d.date, { entries: d.entries, allowances: d.allowances, shift: d.shift, nonWorkingReason: d.nonWorkingReason });
    });
    const { planned, inputs, plan, ctx } = planWeek(p, params.weekStart, given);
    if (plan.blocked.length) {
      const first = firstBlocked(planned, ctx), at = first ? body.days.findIndex(d => d.date === first.date) : -1;
      if (first && isLocked(first.date)) refuse(409, { code: 'PERIOD_LOCKED', field: at >= 0 ? `days.${at}` : 'weekStart', message: weekBlockedMessage(plan.blocked), next: LOCK_NEXT(p) });
      const field = first?.check?.errors[0]?.field;
      refuse(422, { code: 'TS_INVALID', field: at >= 0 ? `days.${at}${field ? `.${field}` : ''}` : 'days', message: weekBlockedMessage(plan.blocked), next: 'Correct the highlighted day and submit the week again.' });
    }
    const moving = [...plan.submit, ...plan.resubmit];
    if (!moving.length) {
      if (!inputs.some(d => d.minutes)) refuse(422, { code: 'NOTHING_TO_SUBMIT', field: 'days', message: NOTHING_TO_SUBMIT, next: 'Enter the hours you worked, then submit the week.' });
      const onlyDecided = plan.held.every(h => { const s = inputs.find(d => d.date === h.date)?.state; return s && s !== 'draft' && s !== 'back'; });
      if (onlyDecided) refuse(409, { code: 'ALREADY_SUBMITTED', message: allSubmittedMessage(managerOf(p)), next: 'Open a day to see where it is.' });
      refuse(422, { code: 'NOTHING_TO_SUBMIT', field: 'days', message: `Nothing to submit. ${plan.held.map(h => h.reason).join(' ')}`, next: 'Submit those days once they have happened.' });
    }
    const made = submitPlanned(p, planned, moving.sort(), session, mode);
    const weekMinutes = made.reduce((n, d) => n + dayMinutes(d.entries), 0), n = made.length;
    const detail = mode === 'proxy'
      ? `${p.name} (${p.code}) · week ${isoWeek(params.weekStart)} · ${n} day${n > 1 ? 's' : ''} · ${hm(weekMinutes)} · entered on their behalf`
      : `Week ${isoWeek(params.weekStart)} · ${n} day${n > 1 ? 's' : ''} · ${hm(weekMinutes)} · to ${managerOf(p)}`;
    const auditId = writeAudit({ who: actor(session), act: mode === 'proxy' ? 'Proxy timesheet week submitted' : 'Timesheet week submitted',
      entity: 'timesheetDay', entityId: `${p.code} week ${isoWeek(params.weekStart)}`, before: null,
      after: { days: made.map(d => d.date), held: plan.held.length, detail } });
    return { submitted: made.map(dayView), held: plan.held, flagged: plan.flagged,
      warnings: made.filter(d => d.warnings.length).map(d => ({ date: d.date, warnings: d.warnings })), weekMinutes, auditId };
  }),

  serve(submitMultiweek, ({ session, params, body }) => {
    const p = personFor(params.personId), mode = access(session, p, true);
    const current = periodStart(now().date), c = config();
    const weeks = [...new Set(body.weeks)];
    weeks.forEach((ws, i) => {
      requireMonday(ws, `weeks.${i}`);
      if (ws >= current) invalid({ field: `weeks.${i}`, message: 'Only earlier weeks are caught up here. Submit this week from the week view.' });
    });
    const out = weeks.sort().reverse().map(ws => {
      const { planned, plan } = planWeek(p, ws, new Map());
      const label = weekLabel(ws);
      const withTime = planned.filter(d => d.check);
      const holdAll = (reason: string) => ({ weekStart: ws, label, outcome: 'held' as const, reason, submitted: [] as TimesheetDay[],
        held: withTime.map(d => ({ date: d.date, reason })) });
      /* the ruling on group 1's question: a week in a closed period is held back with the lock note (D3) */
      if (isLocked(ws)) return holdAll(`${lockNote(ws, c.cutoff)}. ${LOCK_NEXT(p)}`);
      if (plan.blocked.length) return holdAll(weekBlockedMessage(plan.blocked));
      const moving = [...plan.submit, ...plan.resubmit];
      if (!moving.length) return { ...holdAll(withTime.length ? allSubmittedMessage(managerOf(p)) : NOTHING_TO_SUBMIT), held: plan.held };
      const made = submitPlanned(p, planned, moving.sort(), session, mode);
      return { weekStart: ws, label, outcome: 'submitted' as const, reason: '', submitted: made.map(dayView), held: plan.held };
    });
    const sent = out.filter(w => w.outcome === 'submitted');
    if (!sent.length) return { weeks: out, auditId: null };
    const n = sent.reduce((k, w) => k + w.submitted.length, 0);
    const auditId = writeAudit({ who: actor(session), act: mode === 'proxy' ? 'Proxy timesheet weeks submitted' : 'Timesheet weeks submitted',
      entity: 'timesheetDay', entityId: `${p.code} ${sent.map(w => `week ${isoWeek(w.weekStart)}`).join(', ')}`, before: null,
      after: { weeks: sent.map(w => w.label), days: n, held: out.length - sent.length,
        detail: `${sent.length} week${sent.length > 1 ? 's' : ''} · ${n} day${n > 1 ? 's' : ''} · each routes through approval separately` } });
    return { weeks: out, auditId };
  }),

  serve(transitionTimesheetDay, ({ session, params, body: { to, reason }, checkVersion }) => {
    const d = recordAt(days(), params.id) ?? refuse(404, { code: 'not-found', message: 'That timesheet no longer exists.', next: 'Reload the queue.' });
    const p = personByCode(d.personCode) ?? refuse(404, { code: 'not-found', message: 'That person record no longer exists.', next: 'Reload the queue.' });
    if (!inScope(session, p.location)) refuse(403, { code: 'scope', message: 'This timesheet belongs to someone outside the people you look after.', next: 'Their own manager decides it.' });
    /* D5 */
    if (d.personCode === effectiveCode(session)) refuse(403, { code: 'SELF_APPROVAL', message: 'You cannot approve or return your own timesheet.', next: 'Ask another approver at your location.' });
    const problem = tsTransitionProblem(d.state, to);
    if (problem) refuse(409, { code: 'TRANSITION_NOT_ALLOWED', ...problem });
    checkVersion(d);
    const why = reason.trim();
    const rp = returnReasonProblem(why, to === 'back' && config().returnReasonRequired);
    if (rp) invalid(rp);
    const from = d.state;
    let rec: StoredDay, attempt: StoredAttempt | null = null;
    if (to === 'ok') ({ rec, a: attempt } = approve(p, d, session));
    else rec = save(d, { ...moved(d, 'back', session, why), returnReason: why });
    const detail = transitionAuditText(p.name, d.date, from, to, why) + (to === 'ok' ? ` · ${APPROVAL_AUDIT_SUFFIX}` : '');
    const auditId = writeAudit({ who: actor(session), act: stateAct(to), entity: 'timesheetDay', entityId: d.id,
      before: { state: from }, after: { state: to, detail, ...(attempt ? { posting: attempt.id } : {}) }, ...(why ? { reason: why } : {}) });
    return { record: dayView(rec), attempt, auditId };
  }),

  serve(listTimesheetApprovals, ({ session, query }) => {
    dispatch();
    const sc = scopeOf(session), self = effectiveCode(session);
    const submitted = located().filter(x => x.d.state !== 'draft' && x.d.personCode !== self);
    const mine = submitted.filter(x => sc.all || x.p.location === sc.location);
    const week = query.weekStart ? weekDates(query.weekStart) : null;
    const inWeek = week ? mine.filter(x => week.includes(x.d.date)) : mine;
    const status = query.status ?? 'pend', q = (query.q ?? '').trim().toLowerCase();
    const rows = inWeek
      .filter(x => status === 'all' || (status === 'pend' ? tsPending(x.d.state) : x.d.state === status))
      .filter(x => !q || [x.p.name.toLowerCase(), x.d.date, formatDmy(x.d.date)].some(s => s.includes(q)))
      .sort((a, b) => b.d.date.localeCompare(a.d.date) || a.p.name.localeCompare(b.p.name) || a.d.id.localeCompare(b.d.id));
    const offset = Number(query.cursor ?? '0');
    const pending = mine.filter(x => tsPending(x.d.state));
    const flagged = pending.map(x => ({ x, why: flagsFor(x.d).map(f => f.text) })).filter(f => f.why.length)
      .map(({ x, why }) => ({ id: x.d.id, personName: x.p.name, date: x.d.date, why }));
    const oldest = pending.map(x => x.d.submittedAt).filter(Boolean).sort()[0];
    const count = (s: TsState) => inWeek.filter(x => x.d.state === s).length;
    return {
      rows: rows.slice(offset, offset + PAGE).map(rowOf), nextCursor: offset + PAGE < rows.length ? String(offset + PAGE) : null,
      counts: { pend: inWeek.filter(x => tsPending(x.d.state)).length, resub: count('resub'), ok: count('ok'), back: count('back'), all: inWeek.length },
      oldestPending: oldest ? clockFromIso(oldest).date : null,
      bulk: { ids: pending.map(x => x.d.id).sort(), checksum: queueChecksum(pending.map(x => x.d)), people: new Set(pending.map(x => x.p.code)).size,
        minutes: pending.reduce((n, x) => n + dayMinutes(x.d.entries), 0), flagged,
        outside: submitted.filter(x => tsPending(x.d.state) && !(sc.all || x.p.location === sc.location)).length },
    };
  }),

  serve(bulkApproveTimesheets, ({ session, body }) => {
    const ids = [...new Set(body.ids)];
    const found = ids.map(id => recordAt(days(), id));
    const changed = (): never => refuse(409, { code: 'QUEUE_CHANGED', message: 'The queue changed since you opened it, so nothing was approved.',
      next: 'Reload the queue, check it again, then approve.' });
    const recs = found.filter((d): d is StoredDay => d !== undefined);
    if (recs.length !== ids.length || queueChecksum(recs) !== body.checksum) changed();
    const self = effectiveCode(session);
    const held: { id: string; code: string; reason: string }[] = [], ready: Located[] = [];
    for (const d of recs) {
      const p = personByCode(d.personCode);
      if (d.personCode === self) held.push({ id: d.id, code: 'SELF_APPROVAL', reason: 'This is your own timesheet. Ask another approver at your location.' });
      else if (!p || !inScope(session, p.location)) held.push({ id: d.id, code: 'scope', reason: 'This timesheet belongs to someone outside the people you look after.' });
      else if (!tsCan(d.state, 'ok')) held.push({ id: d.id, code: 'TRANSITION_NOT_ALLOWED', reason: tsTransitionProblem(d.state, 'ok')?.message ?? '' });
      else ready.push({ d, p });
    }
    if (!ready.length) return { approved: [], held, people: 0, minutes: 0, auditId: null };
    const flaggedCount = ready.filter(x => flagsFor(x.d).length).length;
    const approved = ready.map(({ d, p }) => approve(p, d, session).rec);
    const people = new Set(ready.map(x => x.p.code)).size, minutes = approved.reduce((n, d) => n + dayMinutes(d.entries), 0);
    const where = [...new Set(ready.map(x => nameOf('locations', x.p.location)))].join(', ');
    const detail = `${approved.length} record(s) · ${people} employee(s) · ${hm(minutes)} · ${where}`
      + `${flaggedCount ? ` · ${flaggedCount} with exceptions` : ''} · ${APPROVAL_AUDIT_SUFFIX}`;
    const auditId = writeAudit({ who: actor(session), act: 'Bulk approval', entity: 'timesheetDay', entityId: approved.map(d => d.id).join(', '),
      before: { state: 'awaiting approval' }, after: { state: 'approved', days: approved.map(d => d.id), held: held.length, detail } });
    return { approved: approved.map(dayView), held, people, minutes, auditId };
  }),

  serve(getTimesheetConfig, () => ({ config: config(), fields: FIELDS, payCodes: payCodes() })),

  serve(updateTimesheetConfig, ({ session, body, checkVersion }) => {
    const c = config();
    checkVersion(c);
    const { rules, types, ...rest } = body;
    const next: TimesheetConfig = { ...c, ...rest, rules: { ...c.rules, ...rules }, types: { ...c.types, ...types } };
    const problem = timesheetConfigProblem(next, { employeeTypes: Object.values(store.coll<StoredType>('employeeTypes')).map(t => t.code), payCodes: payCodes().map(x => x.code) });
    if (problem) invalid(problem);
    const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    for (const k of Object.keys(body) as (keyof UpdateTimesheetConfig)[]) {
      if (k === 'rules' || k === 'types') {
        const was = c[k] as Record<string, unknown>, is = next[k] as Record<string, unknown>;
        const keys = Object.keys(is).filter(x => !same(was[x], is[x]));
        if (keys.length) { before[k] = Object.fromEntries(keys.map(x => [x, was[x]])); after[k] = Object.fromEntries(keys.map(x => [x, is[x]])); }
      } else if (!same(c[k], next[k])) { before[k] = c[k]; after[k] = next[k]; }
    }
    if (!Object.keys(after).length) return { record: c, auditId: null };
    const saved = bump(c, { ...rest, rules: next.rules, types: next.types });
    store.coll<TimesheetConfig>('timesheetConfig')[c.id] = saved;
    const auditId = writeAudit({ who: actor(session), act: 'Timesheet setup saved', entity: 'timesheetConfig', entityId: c.id, before, after });
    return { record: saved, auditId };
  }),

  serve(retryIntegrationAttempt, ({ session, params, checkVersion }) => {
    const a = recordAt(attempts(), params.id) ?? refuse(404, { code: 'not-found', message: 'That posting no longer exists.', next: 'Reload the page.' });
    const problem = retryProblem(a);
    if (problem) refuse(409, { code: 'RETRY_NOT_ALLOWED', ...problem });
    checkVersion(a);
    const saved: StoredAttempt = { ...retryAttempt(a), version: a.version + 1, updatedAt: store.now(), at: store.now() };
    attempts()[a.id] = saved;
    const auditId = writeAudit({ who: actor(session), act: 'Integration retry', entity: 'integrationAttempt', entityId: a.id,
      before: { state: a.state, attempt: a.attempt }, after: { state: saved.state, attempt: saved.attempt, detail: retryAuditText(a.ref, saved.attempt) } });
    return { record: saved, auditId };
  }),
];
