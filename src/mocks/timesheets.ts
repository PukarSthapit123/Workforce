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
import { rotaDayOn, rotaDaysFor, rotaInputOn, rotaLineOptions, rotaWeekDays } from './rota';
import { leaveAbsenceOn, leaveBlocksTimesheet } from './leave';
import { invalid } from './people';
import meta from './seed/meta.json';
import { effectiveCode, inScope, nameOf, personByCode, recordAt, scopeOf, type Signed, type StoredPerson } from './world';
import { approvesIn, chainPeople, lineManagerCode, slaFor, walkNow } from './approvals';
import { notifyEvent } from './notify';
import { roleRule, roleWaiting, type ChainItem, type ChainWalk, type DecisionBlock, type DeciderPerson, type ItemFacts } from '@/domain/approvals';
import {
  bulkApproveTimesheets, getTimesheetConfig, getTimesheetWeek, listTimesheetApprovals, retryIntegrationAttempt, saveTimesheetDay,
  submitMultiweek, submitTimesheetDay, submitTimesheetWeek, transitionTimesheetDay, updateTimesheetConfig,
  type DayInput, type IntegrationAttempt, type RotaDay, type QueueRow, type TimesheetConfig, type TimesheetDay, type TimesheetField, type UpdateTimesheetConfig,
} from '@/contract/timesheets';
import type { Problem } from '@/domain/codes';
import { clockHeldReason, clockRunning, clockState, isOpenState, type ClockEvent } from '@/domain/clock';
import { absenceBlockedProblem, absenceHeldReason } from '@/domain/leave';
import {
  APPROVAL_AUDIT_SUFFIX, TS_STATE, advisoryFlags, allSubmittedMessage, alreadySubmittedMessage, clockFromIso, dayMinutes,
  deriveWorkType, dispatchAttempt, formatDmy, formatMinutes, historyEntry, isPremium, isoWeek, lockNote, missingMandatory,
  periodLocked, periodStart, planWeekSubmit, queueChecksum, queuedAttempt, retryAttempt, retryAuditText, retryProblem,
  returnReasonProblem, rotaFor, signedLayers, daySigners, SIGNED_EARLIER, timesheetConfigProblem, toMin, transitionAuditText, tsOpen, tsTransitionProblem,
  validateTimes, weekBlockedMessage, weekDates, weekDayOutcome, weekLabel, weekModel, weekTotals, NOTHING_TO_SUBMIT,
  allocationProblem, type AllowanceDef, type CheckContext, type FieldEnv, type PayCode, type TsState, type WeekDayInput,
} from '@/domain/timesheet';
import { isWeekStart } from '@/domain/time';

type StoredDay = Omit<TimesheetDay, 'minutes' | 'posting' | 'enteredByName'>;
type StoredAttempt = IntegrationAttempt;
interface Tenant { modules: Record<string, boolean>; flags: Record<string, unknown>; weekStart: string }
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
/* The tenant's open projects (1b's projects) with their own tasks (the seed's projectTasks), in seed order. */
interface StoredProject { code: string; name: string; status: string }
interface StoredTask { projectCode: string; name: string }
function openProjects() {
  const tasks = Object.values(store.coll<StoredTask>('projectTasks'));
  return Object.values(store.coll<StoredProject>('projects')).filter(p => p.status !== 'Closed')
    .map(p => ({ code: p.code, name: p.name, tasks: tasks.filter(t => t.projectCode === p.code).map(t => t.name) }));
}
const managerOf = (p: StoredPerson) => p.manager.trim() || 'your manager';
const rulesCtx = (): Omit<CheckContext, 'date' | 'rota'> => {
  const c = config();
  return { now: now(), rules: c.rules, cutoff: c.cutoff, timeFormat: c.timeFormat };
};
/* The person's rota line for the day reaches the checks only while Rota is on
   (module 2 D9, module 3 D13): their cell in their location's published week. */
const rotaOn = (personCode: string, date: string) => rotaFor(tenant().modules, rotaInputOn(personCode, date));
const ctxFor = (p: StoredPerson, date: string): CheckContext => ({ date, ...rulesCtx(), rota: rotaOn(p.code, date) });
export const isLocked = (date: string) => { const c = config(); return periodLocked(date, { enforceLock: c.rules.enforceLock, cutoff: c.cutoff }, now()); };
export const hm = (min: number) => formatMinutes(min, config().timeFormat);
export const captureRules = () => config().rules;

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
/* Who captured the day: the person, a manager as proxy, or the clock (2b D3). */
type Source = Mode | 'clock';
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
  const ctx = ctxFor(p, date), rules = ctx.rules, type = typeOf(p);
  const errors: Problem[] = [], warnings: string[] = [];
  errors.push(...validateTimes({ start: '', finish: '', breaks: [] }, ctx).errors);
  if (!input.entries.length && !input.nonWorkingReason?.trim())
    errors.push({ field: 'entries', message: 'Enter a start and finish time, or mark the day as non-working with a reason.' });
  let entryMaxed = false;
  const projects = openProjects();
  input.entries.forEach((e, i) => {
    const alloc = allocationProblem(e.fields ?? {}, projects);
    if (alloc) errors.push({ field: `entries.${i}.${alloc.field}`, message: alloc.message });
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
export function refuseLocked(p: StoredPerson, date: string): never {
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
function applyInput(p: StoredPerson, base: StoredDay, input: DayInput, check: DayCheck, s: Signed, mode: Source): Partial<StoredDay> {
  const c = config();
  const derived = deriveWorkType(typeOf(p)?.rules ?? [], { date: base.date, start: firstStart(input.entries), net: check.minutes,
    travel: input.entries.some(e => Boolean(e.fields?.travel)) }, c.rules, payCodes());
  return {
    entries: input.entries.map(e => ({ start: e.start.trim(), finish: e.finish.trim(), breaks: e.breaks, ...(e.hours != null ? { hours: e.hours } : {}), fields: e.fields ?? {} })),
    allowances: input.allowances ?? [], shift: input.shift ?? base.shift, nonWorkingReason: input.nonWorkingReason?.trim() ?? '',
    workType: derived?.code ?? BASE_WORK_TYPE, warnings: check.warnings, captureSource: mode, enteredBy: s.account.personCode,
    workedAnyway: Boolean(input.workedAnyway),
  };
}
const by = (s: Signed) => { const w = actor(s); return { personCode: w.personCode, name: w.name }; };
function moved(d: StoredDay, to: TsState, s: Signed, reason = '', layer = ''): Partial<StoredDay> {
  return { state: to, history: [...d.history, historyEntry(d.state, to, by(s), store.now(), reason, layer)] };
}
const save = (base: StoredDay, changes: Partial<StoredDay>): StoredDay => {
  const rec = { ...bump(base, changes) };
  days()[rec.id] = rec;
  return rec;
};
const stateAct = (to: TsState) => `Timesheet ${TS_STATE[to].label.toLowerCase()}`;

/* The day save path (D3), shared with the clock (2b D3): a decided day is
   refused, then the absence, lock and capture checks run, then the draft is
   written. The caller checks the version between the two and writes the one
   audit row, so a clock out records one event, not two. */
export function draftBase(p: StoredPerson, date: string): { existing: StoredDay | undefined; base: StoredDay } {
  const existing = recordAt(days(), dayId(p.code, date));
  if (existing && existing.state !== 'draft' && existing.state !== 'back') alreadySubmitted(existing);
  return { existing, base: existing ?? blankDay(p, date) };
}
export function writeDraft(s: Signed, p: StoredPerson, base: StoredDay, input: DayInput, source: Source): { rec: StoredDay; check: DayCheck } {
  refuseAbsence(p.code, base.date, input, 'date');
  const check = checkDay(p, base.date, input);
  if (check.errors.length) refuseDay(p, base.date, check.errors);
  return { rec: save(base, applyInput(p, base, input, check, s, source)), check };
}

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
/* ------------------------------------------- the approval chain (module 8) */
/* What a layer's condition reads off the day: a premium work type, a
   non-working day or time on a day of leave or sickness, a proxy entry. */
function factsOf(d: StoredDay): ItemFacts {
  return { premium: isPremium(payCodes(), d.workType), proxy: d.captureSource === 'proxy',
    absence: d.nonWorkingReason.trim() !== '' || absenceOf(d.personCode, d.date) !== '' };
}
/* The person's own line manager holds the Line manager layer for them whatever their department, as for Leave (review I2). */
function itemOf(d: StoredDay, p: StoredPerson): ChainItem {
  const manager = lineManagerCode(p);
  return { personCode: p.code, location: p.location, department: p.department, ...(manager ? { manager } : {}), facts: factsOf(d) };
}
/* The day's walk along the Timesheet chain as it stands, with the layers signed since it was last submitted and who signed
   them, who decide no later layer (review I1). */
const walkOf = (d: StoredDay, p: StoredPerson, everyone?: readonly DeciderPerson[]) =>
  walkNow('Timesheet', itemOf(d, p), signedLayers(d.history), everyone, daySigners(d.history));
const capLabel = (cap: string) => store.coll<{ label?: string }>('capabilities')[cap]?.label ?? cap;
const waitingOn = (w: ChainWalk) => roleWaiting(w.current?.step.role ?? 'Line manager');
const upper = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/* Why the reader may not decide the day at its current layer, as a refusal and as a held row's reason. */
function blocked(block: DecisionBlock, w: ChainWalk): { status: number; code: string; message: string; next: string } {
  if (block === 'self') return { status: 403, code: 'SELF_APPROVAL', message: 'You cannot approve or return your own timesheet.', next: 'Ask another approver at your location.' };
  if (block === 'signed') return { status: 403, code: 'ALREADY_SIGNED', message: SIGNED_EARLIER, next: `${upper(waitingOn(w))} decides it now.` };
  if (block === 'scope') return { status: 403, code: 'scope', message: 'This timesheet belongs to someone outside the people you look after.', next: 'Their own manager decides it.' };
  if (block === 'layer') return { status: 403, code: 'WRONG_LAYER', message: `This timesheet is waiting on ${waitingOn(w)}, not on a layer you sign off.`, next: `${upper(waitingOn(w))} decides it now.` };
  const cap = roleRule('Timesheet', w.current?.step.role ?? 'Line manager')?.capability ?? 'team_ts';
  return { status: 403, code: 'capability', message: `This needs "${capLabel(cap)}", which your access does not include.`, next: 'Ask an administrator to grant it on Qnipay setup → Permissions.' };
}
const HELD_REASON: Partial<Record<DecisionBlock, string>> = { self: 'This is your own timesheet. Ask another approver at your location.' };
/* Reading or deciding the queue needs a capability that decides some layer of the chain, or a delegation in force from someone who has one. */
function requireApprover(s: Signed) {
  if (!approvesIn('Timesheet', effectiveCode(s), s.caps)) requireCapability(s, 'team_ts');
}

/* Signs the day off at its current layer (D4, module 8): with a later layer
   to come the day moves to mgrok; the last layer's approval moves it to ok
   and queues a posting, and never posts. */
function signOff(p: StoredPerson, d: StoredDay, s: Signed, w: ChainWalk): { rec: StoredDay; a: StoredAttempt | null } {
  const layer = w.current?.step.role ?? '';
  if (!w.final) return { rec: save(d, moved(d, 'mgrok', s, '', layer)), a: null };
  const a = queuePosting(p, d);
  return { rec: save(d, { ...moved(d, 'ok', s, '', layer), integrationAttemptId: a.id }), a };
}

/* ----------------------------------------------------------- notifications */
/* ts_submitted, ts_approved and ts_returned (module 8 group 4), raised as
   Profile raises pf_req and pf_done: to the people who decide the day's
   current layer (its holders and anyone covering them), never to whoever
   just acted; and to the person once it is approved or sent back. */
const daysText = (list: readonly StoredDay[]) => {
  const dates = list.map(d => d.date).sort(), first = dates[0] ?? '', last = dates[dates.length - 1] ?? '';
  return dates.length === 1 ? formatDmy(first) : `${dates.length} days, ${formatDmy(first)} to ${formatDmy(last)}`;
};
const minutesOf = (list: readonly StoredDay[]) => list.reduce((n, d) => n + dayMinutes(d.entries), 0);
function tellApprovers(p: StoredPerson, recs: readonly StoredDay[], s: Signed, by?: { name: string; layer: string }) {
  const everyone = chainPeople(), me = s.account.personCode, to = new Map<string, StoredDay[]>();
  for (const d of recs) for (const code of walkOf(d, p, everyone).walk.current?.deciders ?? [])
    if (code !== me) to.set(code, [...(to.get(code) ?? []), d]);
  for (const [code, list] of to) {
    const what = `${p.name} (${p.code}). ${daysText(list)}. ${hm(minutesOf(list))}.`;
    notifyEvent('ts_submitted', 'actor', [code], by
      ? { title: 'Timesheet awaiting approval', body: `${what} Approved by ${by.name}, now waiting on ${by.layer}.` }
      : { title: 'Timesheet submitted', body: `${what} Awaiting approval.` });
  }
}
function tellApproved(p: StoredPerson, list: readonly StoredDay[], s: Signed) {
  if (!list.length) return;
  notifyEvent('ts_approved', 'subject', [p.code], { title: 'Timesheet approved',
    body: `${daysText(list)}. ${hm(minutesOf(list))}. Approved by ${actor(s).name} and queued for Business Central.` });
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
  return advisoryFlags({ date: d.date, minutes: dayMinutes(d.entries), state: d.state, captureSource: d.captureSource }, { ...rulesCtx(), rota: rotaOn(d.personCode, d.date) });
};
function captureFor(p: StoredPerson) {
  const c = config(), t = tenant(), type = typeOf(p) ?? null, codes = payCodes(), lines = rotaLineOptions();
  const allowances: AllowanceDef[] = (type?.allowances ?? []).map(code => recordAt(c.allowances, code)
    ?? { code, label: codes.find(x => x.code === code)?.label ?? code, payCode: code, tier: 'core' });
  return {
    rules: c.rules, cutoff: c.cutoff, timeFormat: c.timeFormat, returnReasonRequired: c.returnReasonRequired, weekGrid: c.weekGrid,
    weekLayout: c.weekLayout, fields: FIELDS, type, modules: t.modules, flags: Object.keys(t.flags).filter(k => Boolean(t.flags[k])),
    capabilities: employeeType(p.employeeType)?.capabilities ?? [], fieldDefaults: c.fieldDefaults, allowances, payCodes: codes,
    mode: employeeType(p.employeeType)?.mode ?? 'form', projects: openProjects(),
    ...(lines ? { rotaLines: lines } : {}),
  };
}
export const daysOf = (code: string) => Object.values(days()).filter(d => d.personCode === code);
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
    const waiting = list.some(d => tsOpen(d.state));
    if (!ready && !waiting) return null;
    const locked = isLocked(ws);
    return { weekStart: ws, label: weekLabel(ws), minutes: list.reduce((n, d) => n + dayMinutes(d.entries), 0),
      status: ready ? 'ready' as const : 'submitted' as const, locked, lockNote: locked ? lockNote(ws, cutoff) : '' };
  }).filter(w => w !== null).sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, 8);
}
/* The day's absence (module 4 D8): a V or S cell on the published rota, else
   approved leave or recorded sickness from the leave records, on any tenant. */
export function absenceOf(personCode: string, date: string): '' | 'V' | 'S' {
  const cell = rotaDayOn(personCode, date)?.code;
  return cell === 'V' || cell === 'S' ? cell : leaveAbsenceOn(personCode, date);
}
/* With "Leave blocks timesheet capture" on, time on an absence day is refused
   unless the day is marked called in and worked anyway. A reason alone is fine. */
function blockingAbsence(personCode: string, date: string, input: Pick<DayInput, 'entries' | 'workedAnyway'>): '' | 'V' | 'S' {
  if (!input.entries.length || input.workedAnyway || !leaveBlocksTimesheet()) return '';
  return absenceOf(personCode, date);
}
/* The clock's gate (2b D4): an absence day blocks clocking in unless the day is marked worked anyway. */
export const absenceBlocks = (personCode: string, date: string, workedAnyway: boolean): '' | 'V' | 'S' =>
  workedAnyway || !leaveBlocksTimesheet() ? '' : absenceOf(personCode, date);
function refuseAbsence(personCode: string, date: string, input: Pick<DayInput, 'entries' | 'workedAnyway'>, field: string) {
  const mark = blockingAbsence(personCode, date, input);
  if (mark) refuse(409, { ...absenceBlockedProblem(mark), field });
}
/* Review I1: every day a week submit or a catch-up would move is checked
   again, as stored or as sent, since absence recorded after a draft was saved
   blocks it just the same. */
function absenceHolds(p: StoredPerson, planned: readonly Planned[], dates: readonly string[]) {
  return dates.flatMap(date => {
    const input = planned.find(x => x.date === date)?.input;
    const mark = input ? blockingAbsence(p.code, date, input) : '';
    return mark ? [{ date, mark, reason: absenceHeldReason(date, mark) }] : [];
  });
}
function requireWeekStart(weekStart: string, field = 'weekStart') {
  if (!isWeekStart(weekStart)) invalid({ field, message: `A week starts on a ${tenant().weekStart}.` });
}

/* ----------------------------------------------------------- week submit */
/* `unchanged`: the day goes as it is stored, so it keeps who entered it, and a sent-back day is held rather than resubmitted. */
interface Planned { date: string; input: DayInput | null; existing: StoredDay | undefined; check: DayCheck | null; unchanged: boolean }
/* What the request names for each day: new entries, or null for "as it was read". */
type Sent = ReadonlyMap<string, DayInput | null>;
export const asStored = (d: StoredDay): DayInput => ({ entries: d.entries, allowances: d.allowances, shift: d.shift, nonWorkingReason: d.nonWorkingReason,
  ...(d.workedAnyway ? { workedAnyway: true } : {}) });
/* Only the days in `sent` are planned; `'stored'` plans every stored day as it is (multi-week catch-up). */
function planWeek(p: StoredPerson, weekStart: string, sent: Sent | 'stored') {
  const planned: Planned[] = weekDates(weekStart).map(date => {
    const existing = recordAt(days(), dayId(p.code, date));
    const given = sent === 'stored' ? null : sent.get(date);
    const named = sent === 'stored' || sent.has(date);
    const input = given ?? (named && existing ? asStored(existing) : null);
    const minutes = input ? dayMinutes(input.entries) : 0;
    return { date, input, existing, check: input && minutes ? checkDay(p, date, input) : null, unchanged: !given };
  });
  /* the week's own message already opens with "Submission blocked.", so a mandatory field message does not repeat it */
  const inputs: WeekDayInput[] = planned.map(d => ({ date: d.date, minutes: d.check?.minutes ?? 0, state: d.existing?.state ?? null, unchanged: d.unchanged,
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
    const kept = d.unchanged && d.existing ? { captureSource: d.existing.captureSource, enteredBy: d.existing.enteredBy } : {};
    return save(base, { ...applyInput(p, base, d.input, d.check, s, mode), ...kept, ...moved(base, to, s, reason), submittedAt: store.now() });
  });
}

/* ----------------------------------------------------------------- queue */
const PAGE = 50;
interface Located { d: StoredDay; p: StoredPerson }
function located(): Located[] {
  return Object.values(days()).flatMap(d => { const p = personByCode(d.personCode); return p ? [{ d, p }] : []; });
}
/* A clocked day's marks (module 2b D5, D6), read from the clock records the clock handlers keep. */
interface ClockRec { late?: boolean; closedLate?: unknown; closedNoDay?: unknown; events?: ClockEvent[] }
/* Review I1 (2b): the person's clock on that day is running or on a break, so the day waits for it to stop. */
function clockRunsOn(code: string, date: string): boolean {
  const r = recordAt(store.coll<ClockRec>('clockRecords'), `clk_${code}_${date}`);
  return Boolean(r && isOpenState(clockState(r.events ?? [], r.closedLate != null || r.closedNoDay != null)));
}
const clockHolds = (p: StoredPerson, dates: readonly string[]) =>
  dates.filter(date => clockRunsOn(p.code, date)).map(date => ({ date, reason: clockHeldReason(date) }));
function clockMark(code: string, date: string) {
  const r = recordAt(store.coll<ClockRec>('clockRecords'), `clk_${code}_${date}`);
  return r ? { clock: { late: Boolean(r.late), closedLate: r.closedLate != null } } : {};
}
const rowOf = ({ d, p }: Located, decide: boolean): QueueRow =>
  ({ ...dayView(d), personName: p.name, location: p.location, locationName: nameOf('locations', p.location), flags: flagsFor(d), ...clockMark(p.code, d.date), decide });

/* The matrix's rota: everyone on a published week in the approver's scope (module 3, gap 6). */
function weekRota(sc: ReturnType<typeof scopeOf>, weekStart: string): Record<string, RotaDay[]> {
  const locs = sc.all ? Object.values(store.coll<{ code: string }>('locations')).map(l => l.code) : [sc.location];
  return Object.fromEntries(locs.flatMap(l => Object.entries(rotaWeekDays(l, weekStart))));
}

export const timesheetHandlers = [
  serve(getTimesheetWeek, ({ session, params }) => {
    const p = personFor(params.personId);
    access(session, p, false);
    requireWeekStart(params.weekStart);
    const ws = params.weekStart, c = config(), today = now();
    /* the published rota for the week (module 3 D13, D16); a V or S cell is the day's absence, not a line,
       and so are approved leave and recorded sickness (module 4 D8) */
    const rota = rotaDaysFor(p.code, ws);
    const list = weekDates(ws).map((date, i) => {
      const d = recordAt(days(), dayId(p.code, date)), locked = isLocked(date), r = rota?.[i];
      const mark = r?.code === 'V' || r?.code === 'S' ? r.code : leaveAbsenceOn(p.code, date);
      const absence = mark === 'V' ? 'leave' as const : mark === 'S' ? 'sickness' as const : undefined;
      return { date, record: d ? dayView(d) : null, state: d?.state ?? 'none' as const, version: d?.version ?? 0,
        minutes: d ? dayMinutes(d.entries) : 0, future: date > today.date, locked, lockNote: locked ? lockNote(date, c.cutoff) : '',
        flags: d && d.state !== 'draft' ? flagsFor(d) : [], ...(absence ? { absence } : {}), ...(r ? { rota: r } : {}), ...clockMark(p.code, date) };
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
    const { existing, base } = draftBase(p, params.date);
    /* review I1 (2b): the clock writes this day when it stops */
    if (clockRunsOn(p.code, params.date)) refuse(409, clockRunning(params.date, mode === 'proxy'));
    checkVersion(base);
    const { rec, check } = writeDraft(session, p, base, body, mode);
    const auditId = writeAudit({ who: actor(session), act: mode === 'proxy' ? 'Proxy timesheet saved' : 'Timesheet draft saved',
      entity: 'timesheetDay', entityId: rec.id, before: existing ? { minutes: dayMinutes(existing.entries) } : null,
      after: { state: rec.state, minutes: dayMinutes(rec.entries), ...(mode === 'proxy' ? { enteredFor: `${p.name} (${p.code})` } : {}) } });
    return { record: dayView(rec), warnings: check.warnings, auditId };
  }),

  serve(submitTimesheetDay, ({ session, params, body, checkVersion }) => {
    const p = personFor(params.personId), mode = access(session, p, true);
    const existing = recordAt(days(), dayId(p.code, params.date));
    /* D8: a retried submit finds the first one and is refused before the version is read */
    if (existing && (tsOpen(existing.state) || existing.state === 'ok')) alreadySubmitted(existing);
    if (clockRunsOn(p.code, params.date)) refuse(409, clockRunning(params.date, mode === 'proxy'));
    const base = existing ?? blankDay(p, params.date);
    checkVersion(base);
    refuseAbsence(p.code, params.date, body, 'date');
    const check = checkDay(p, params.date, body);
    if (check.errors.length) refuseDay(p, params.date, check.errors);
    const to: TsState = base.state === 'back' ? 'resub' : 'pend';
    const reason = to === 'resub' ? 'Corrected and resubmitted' : mode === 'proxy' ? 'Submitted on their behalf' : '';
    const rec = save(base, { ...applyInput(p, base, body, check, session, mode), ...moved(base, to, session, reason), submittedAt: store.now() });
    const detail = transitionAuditText(p.name, rec.date, base.state, to, reason) + (mode === 'proxy' ? ` · ${hm(dayMinutes(rec.entries))} · entered on their behalf` : '');
    const auditId = writeAudit({ who: actor(session), act: mode === 'proxy' ? 'Proxy timesheet submitted' : stateAct(to), entity: 'timesheetDay',
      entityId: rec.id, before: { state: base.state }, after: { state: to, detail } });
    tellApprovers(p, [rec], session);
    return { record: dayView(rec), warnings: check.warnings, auditId };
  }),

  serve(submitTimesheetWeek, ({ session, params, body }) => {
    const p = personFor(params.personId), mode = access(session, p, true);
    requireWeekStart(params.weekStart);
    /* only the days sent are acted on, each checked against the version it was read at (D8) */
    const dates = weekDates(params.weekStart), sent = new Map<string, DayInput | null>();
    body.days.forEach((d, i) => {
      if (!dates.includes(d.date)) invalid({ field: `days.${i}.date`, message: `${formatDmy(d.date)} is not in this week.` });
      if (sent.has(d.date)) invalid({ field: `days.${i}.date`, message: `${formatDmy(d.date)} is in this request twice.` });
      const stored = recordAt(days(), dayId(p.code, d.date));
      if ((stored?.version ?? 0) !== d.version)
        refuse(412, { code: 'stale', field: `days.${i}`, message: `Somebody changed ${formatDmy(d.date)} since you opened this week. Nothing has been saved.`, next: 'Reload and apply your change again' });
      /* the week grid edits times only, so a changed day keeps the worked-anyway mark it was stored with unless the request says otherwise */
      const anyway = d.workedAnyway ?? stored?.workedAnyway ?? false;
      if (d.entries) refuseAbsence(p.code, d.date, { entries: d.entries, workedAnyway: anyway }, `days.${i}`);
      sent.set(d.date, d.entries ? { entries: d.entries, allowances: d.allowances, shift: d.shift, nonWorkingReason: d.nonWorkingReason, workedAnyway: anyway } : null);
    });
    const { planned, inputs, plan: full, ctx } = planWeek(p, params.weekStart, sent);
    /* a stored day sent as it was read, with absence recorded on it since, is held back (review I1) */
    const absent = absenceHolds(p, planned, [...full.submit, ...full.resubmit]);
    /* review I1 (2b): a day whose clock is still running is held back too, until the clock stops */
    const clocked = clockHolds(p, [...full.submit, ...full.resubmit]), out = new Set([...absent, ...clocked].map(a => a.date));
    const plan = { ...full, submit: full.submit.filter(d => !out.has(d)), resubmit: full.resubmit.filter(d => !out.has(d)),
      held: [...full.held, ...[...absent, ...clocked].map(({ date, reason }) => ({ date, reason }))].sort((a, b) => a.date.localeCompare(b.date)) };
    if (plan.blocked.length) {
      const first = firstBlocked(planned, ctx), at = first ? body.days.findIndex(d => d.date === first.date) : -1;
      if (first && isLocked(first.date)) refuse(409, { code: 'PERIOD_LOCKED', field: at >= 0 ? `days.${at}` : 'weekStart', message: weekBlockedMessage(plan.blocked), next: LOCK_NEXT(p) });
      const field = first?.check?.errors[0]?.field;
      refuse(422, { code: 'TS_INVALID', field: at >= 0 ? `days.${at}${field ? `.${field}` : ''}` : 'days', message: weekBlockedMessage(plan.blocked), next: 'Correct the highlighted day and submit the week again.' });
    }
    const moving = [...plan.submit, ...plan.resubmit];
    if (!moving.length) {
      const first = absent[0];
      if (first) {
        const at = body.days.findIndex(d => d.date === first.date);
        refuse(409, { ...absenceBlockedProblem(first.mark), field: at >= 0 ? `days.${at}` : 'days' });
      }
      if (!inputs.some(d => d.minutes)) refuse(422, { code: 'NOTHING_TO_SUBMIT', field: 'days', message: NOTHING_TO_SUBMIT, next: 'Enter the hours you worked, then submit the week.' });
      const onlyDecided = plan.held.every(h => { const s = inputs.find(d => d.date === h.date)?.state; return s && s !== 'draft' && s !== 'back'; });
      if (onlyDecided) refuse(409, { code: 'ALREADY_SUBMITTED', message: allSubmittedMessage(managerOf(p)), next: 'Open a day to see where it is.' });
      const sentBack = plan.held.some(h => inputs.find(d => d.date === h.date)?.state === 'back');
      refuse(422, { code: 'NOTHING_TO_SUBMIT', field: 'days', message: `Nothing to submit. ${plan.held.map(h => h.reason).join(' ')}`,
        next: sentBack ? 'Correct the day that was sent back, then submit the week again.' : 'Submit those days once they have happened.' });
    }
    const made = submitPlanned(p, planned, moving.sort(), session, mode);
    const weekMinutes = made.reduce((n, d) => n + dayMinutes(d.entries), 0), n = made.length;
    const detail = mode === 'proxy'
      ? `${p.name} (${p.code}) · week ${isoWeek(params.weekStart)} · ${n} day${n > 1 ? 's' : ''} · ${hm(weekMinutes)} · entered on their behalf`
      : `Week ${isoWeek(params.weekStart)} · ${n} day${n > 1 ? 's' : ''} · ${hm(weekMinutes)} · to ${managerOf(p)}`;
    const auditId = writeAudit({ who: actor(session), act: mode === 'proxy' ? 'Proxy timesheet week submitted' : 'Timesheet week submitted',
      entity: 'timesheetDay', entityId: `${p.code} week ${isoWeek(params.weekStart)}`, before: null,
      after: { days: made.map(d => d.date), held: plan.held.length, detail } });
    tellApprovers(p, made, session);
    return { submitted: made.map(dayView), held: plan.held, flagged: plan.flagged,
      warnings: made.filter(d => d.warnings.length).map(d => ({ date: d.date, warnings: d.warnings })), weekMinutes, auditId };
  }),

  serve(submitMultiweek, ({ session, params, body }) => {
    const p = personFor(params.personId), mode = access(session, p, true);
    const current = periodStart(now().date), c = config();
    const weeks = [...new Set(body.weeks)];
    weeks.forEach((ws, i) => {
      requireWeekStart(ws, `weeks.${i}`);
      if (ws >= current) invalid({ field: `weeks.${i}`, message: 'Only earlier weeks are caught up here. Submit this week from the week view.' });
    });
    const out = weeks.sort().reverse().map(ws => {
      const { planned, plan } = planWeek(p, ws, 'stored');
      const label = weekLabel(ws);
      const withTime = planned.filter(d => d.check);
      const holdAll = (reason: string) => ({ weekStart: ws, label, outcome: 'held' as const, reason, submitted: [] as TimesheetDay[],
        held: withTime.map(d => ({ date: d.date, reason })) });
      /* the ruling on group 1's question: a week in a closed period is held back with the lock note (D3) */
      if (isLocked(ws)) return holdAll(`${lockNote(ws, c.cutoff)}. ${LOCK_NEXT(p)}`);
      if (plan.blocked.length) return holdAll(weekBlockedMessage(plan.blocked));
      const moving = [...plan.submit, ...plan.resubmit];
      /* review I1: a week with a stored day now on leave or sickness is held back whole, as a locked week is */
      const absent = absenceHolds(p, planned, moving);
      if (absent.length) return holdAll(absent.map(a => a.reason).join(' '));
      /* review I1 (2b): so is a week with a day whose clock is still running */
      const clocked = clockHolds(p, moving);
      if (clocked.length) return holdAll(clocked.map(a => a.reason).join(' '));
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
    for (const w of sent) tellApprovers(p, w.submitted.flatMap(x => recordAt(days(), x.id) ?? []), session);
    return { weeks: out, auditId };
  }),

  serve(transitionTimesheetDay, ({ session, params, body: { to, reason }, checkVersion }) => {
    requireApprover(session);
    const d = recordAt(days(), params.id) ?? refuse(404, { code: 'not-found', message: 'That timesheet no longer exists.', next: 'Reload the queue.' });
    const p = personByCode(d.personCode) ?? refuse(404, { code: 'not-found', message: 'That person record no longer exists.', next: 'Reload the queue.' });
    /* D5 and module 8: the reader must decide the day's current layer of the chain;
       a day no longer open is refused as a transition below, whoever asks */
    const { walk, block } = walkOf(d, p), why = block(effectiveCode(session));
    if (why && (why !== 'layer' || tsOpen(d.state))) { const { status, ...r } = blocked(why, walk); refuse(status, r); }
    const target: TsState = to === 'ok' && !walk.final ? 'mgrok' : to;
    const problem = tsTransitionProblem(d.state, target);
    if (problem) refuse(409, { code: 'TRANSITION_NOT_ALLOWED', ...problem });
    checkVersion(d);
    const reasonText = reason.trim();
    const rp = returnReasonProblem(reasonText, to === 'back' && config().returnReasonRequired);
    if (rp) invalid(rp);
    const from = d.state;
    let rec: StoredDay, attempt: StoredAttempt | null = null;
    if (to === 'ok') ({ rec, a: attempt } = signOff(p, d, session, walk));
    else rec = save(d, { ...moved(d, 'back', session, reasonText, walk.current?.step.role ?? ''), returnReason: reasonText });
    const next = rec.state === 'mgrok' ? walkOf(rec, p).walk : null;
    const detail = transitionAuditText(p.name, d.date, from, rec.state, reasonText)
      + (rec.state === 'ok' ? ` · ${APPROVAL_AUDIT_SUFFIX}` : next ? ` · now waiting on ${waitingOn(next)}` : '');
    const act = rec.state === 'mgrok' && next ? `Timesheet passed to ${waitingOn(next)}` : stateAct(rec.state);
    const auditId = writeAudit({ who: actor(session), act, entity: 'timesheetDay', entityId: d.id,
      before: { state: from }, after: { state: rec.state, detail, ...(attempt ? { posting: attempt.id } : {}) }, ...(reasonText ? { reason: reasonText } : {}) });
    if (rec.state === 'ok') tellApproved(p, [rec], session);
    else if (next) tellApprovers(p, [rec], session, { name: actor(session).name, layer: waitingOn(next) });
    else notifyEvent('ts_returned', 'subject', [p.code], { title: 'Timesheet returned',
      body: `${formatDmy(d.date)}. Sent back by ${actor(session).name}${reasonText ? `: "${reasonText}"` : ''}. Correct it and submit it again.` });
    return { record: dayView(rec), attempt, auditId };
  }),

  serve(listTimesheetApprovals, ({ session, query }) => {
    requireApprover(session);
    dispatch();
    const sc = scopeOf(session), self = effectiveCode(session), everyone = chainPeople();
    /* Module 8: every submitted day, walked along the chain once. The reader
       takes part in a day when they decide any of its applicable layers, and
       may decide it now when it is open and its current layer is theirs. */
    const walked = located().filter(x => x.d.state !== 'draft' && x.d.personCode !== self)
      .map(x => { const w = walkOf(x.d, x.p, everyone); return { ...x, w: w.walk, block: w.block(self) }; });
    const mine = walked.filter(x => x.w.layers.some(l => l.deciders.includes(self)) || daySigners(x.d.history).includes(self));
    const decidable = walked.filter(x => tsOpen(x.d.state) && x.block === null);
    const week = query.weekStart ? weekDates(query.weekStart) : null;
    const inWeek = week ? mine.filter(x => week.includes(x.d.date)) : mine;
    const status = query.status ?? 'pend', q = (query.q ?? '').trim().toLowerCase();
    const rows = (status === 'pend' ? (week ? decidable.filter(x => week.includes(x.d.date)) : decidable) : inWeek)
      .filter(x => status === 'all' || status === 'pend' || x.d.state === status)
      .filter(x => !q || [x.p.name.toLowerCase(), x.d.date, formatDmy(x.d.date)].some(s => s.includes(q)))
      .sort((a, b) => b.d.date.localeCompare(a.d.date) || a.p.name.localeCompare(b.p.name) || a.d.id.localeCompare(b.d.id));
    /* A week read (the matrix) is bounded by people × 7, so it comes whole: Approve selected
       must see every day of the week, never only the first page of it. */
    const offset = Number(query.cursor ?? '0'), size = week ? Math.max(1, rows.length) : PAGE;
    const flagged = decidable.map(x => ({ x, why: flagsFor(x.d).map(f => f.text) })).filter(f => f.why.length)
      .map(({ x, why }) => ({ id: x.d.id, personName: x.p.name, date: x.d.date, why }));
    const oldest = decidable.map(x => x.d.submittedAt).filter(Boolean).sort()[0];
    const count = (s: TsState) => inWeek.filter(x => x.d.state === s).length;
    return {
      rows: rows.slice(offset, offset + size).map(x => rowOf(x, tsOpen(x.d.state) && x.block === null)), nextCursor: offset + size < rows.length ? String(offset + size) : null,
      counts: { pend: (week ? decidable.filter(x => week.includes(x.d.date)) : decidable).length, resub: count('resub'), ok: count('ok'), back: count('back'),
        mgrok: count('mgrok'), all: inWeek.length },
      oldestPending: oldest ? clockFromIso(oldest).date : null,
      bulk: { ids: decidable.map(x => x.d.id).sort(), checksum: queueChecksum(decidable.map(x => x.d)), people: new Set(decidable.map(x => x.p.code)).size,
        minutes: decidable.reduce((n, x) => n + dayMinutes(x.d.entries), 0), flagged,
        /* open days at a layer the reader holds the role of, outside their scope */
        outside: walked.filter(x => tsOpen(x.d.state) && x.block === 'scope').length },
      now: now(), returnReasonRequired: config().returnReasonRequired, sla: slaFor('Timesheet', everyone.find(x => x.code === self)?.caps ?? session.caps),
      ...(query.weekStart && tenant().modules.R ? { rota: weekRota(sc, query.weekStart) } : {}),
    };
  }),

  /* Bulk approval works per layer (module 8): each day moves on one layer,
     and only a day whose current layer the approver decides is approved. */
  serve(bulkApproveTimesheets, ({ session, body }) => {
    requireApprover(session);
    const ids = [...new Set(body.ids)];
    const found = ids.map(id => recordAt(days(), id));
    const changed = (): never => refuse(409, { code: 'QUEUE_CHANGED', message: 'The queue changed since you opened it, so nothing was approved.',
      next: 'Reload the queue, check it again, then approve.' });
    const recs = found.filter((d): d is StoredDay => d !== undefined);
    if (recs.length !== ids.length || queueChecksum(recs) !== body.checksum) changed();
    const self = effectiveCode(session), everyone = chainPeople();
    const held: { id: string; code: string; reason: string }[] = [], ready: (Located & { w: ChainWalk })[] = [];
    for (const d of recs) {
      const p = personByCode(d.personCode);
      if (!p) { held.push({ id: d.id, code: 'scope', reason: 'This timesheet belongs to someone outside the people you look after.' }); continue; }
      const { walk, block } = walkOf(d, p, everyone), why = block(self);
      if (why && (why !== 'layer' || tsOpen(d.state))) { const b = blocked(why, walk); held.push({ id: d.id, code: b.code, reason: HELD_REASON[why] ?? b.message }); }
      else if (!tsOpen(d.state)) held.push({ id: d.id, code: 'TRANSITION_NOT_ALLOWED', reason: tsTransitionProblem(d.state, 'ok')?.message ?? '' });
      else ready.push({ d, p, w: walk });
    }
    if (!ready.length) return { approved: [], held, people: 0, minutes: 0, auditId: null };
    const flaggedCount = ready.filter(x => flagsFor(x.d).length).length;
    const done = ready.map(({ d, p, w }) => ({ p, rec: signOff(p, d, session, w).rec }));
    const approved = done.map(x => x.rec), passed = approved.filter(d => d.state === 'mgrok').length;
    const people = new Set(ready.map(x => x.p.code)).size, minutes = approved.reduce((n, d) => n + dayMinutes(d.entries), 0);
    const where = [...new Set(ready.map(x => nameOf('locations', x.p.location)))].join(', ');
    const posted = approved.length - passed;
    const detail = `${approved.length} record(s) · ${people} employee(s) · ${hm(minutes)} · ${where}`
      + `${flaggedCount ? ` · ${flaggedCount} with exceptions` : ''}`
      + (passed ? `${posted ? ` · ${posted} ${APPROVAL_AUDIT_SUFFIX}` : ''} · ${passed} passed to the next layer` : ` · ${APPROVAL_AUDIT_SUFFIX}`);
    const auditId = writeAudit({ who: actor(session), act: 'Bulk approval', entity: 'timesheetDay', entityId: approved.map(d => d.id).join(', '),
      before: { state: 'awaiting approval' }, after: { state: passed === approved.length ? 'approved by manager' : 'approved', days: approved.map(d => d.id), held: held.length, detail } });
    for (const code of new Set(done.map(x => x.p.code))) {
      const p = done.find(x => x.p.code === code)?.p;
      if (!p) continue;
      const mineNow = done.filter(x => x.p.code === code).map(x => x.rec);
      tellApproved(p, mineNow.filter(d => d.state === 'ok'), session);
      const onward = mineNow.filter(d => d.state === 'mgrok');
      if (onward[0]) tellApprovers(p, onward, session, { name: actor(session).name, layer: waitingOn(walkOf(onward[0], p, everyone).walk) });
    }
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
