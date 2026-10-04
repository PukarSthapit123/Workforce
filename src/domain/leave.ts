/* Leave and absence rules. Ported from the prototype (qnipay-workforce-v15.html:
   LEAVE_CFG, LEAVE_STAGES, LEAVE_TYPES, LEAVE_POLICIES, policyBy, typeLeave,
   yearsService, serviceBonus, entitlement, takenDays, takenHours, balance,
   reconcileLeaver, leaveShape, leaveRecalc, lv-send, lv-cancel, decideLeave,
   applyLeaveToRota, record-sick, arrange-rtw and give-days-back). Every
   function is pure: the policies, the config, the clock, the person's facts and
   their records come in as arguments, so the server refuses with exactly what
   the screen warns about.

   A request is one record (brief D1) with ISO dates. Entitlement and balance
   are derived, never stored as counters (D3): taken is the seeded base plus
   approved requests plus counted ledger adjustments. Sickness is an episode
   (D9), not a request. No money anywhere (D13): days and hours only.
   Messages are the prototype's, with each em-dash aside rewritten as its own
   sentence (listed in the module report). */
import { FULFIL_CHANNELS, LEAVE, SICK, onShift, rotaWeekId, type CellWrite, type Line, type RotaActor } from './rota';
import { addDays, addMonths, daysBetween, formatDay, formatDmy, isIsoDate, parseIso, periodStart } from './time';

/* A refusal the server sends as it is: code, message and what to do next. */
export interface LeaveRefusal { code: string; message: string; next: string; field?: string }

const round1 = (n: number) => Number(n.toFixed(1));
const round2 = (n: number) => Number(n.toFixed(2));
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/* ------------------------------------------------- types and policies */
export const LEAVE_UNITS = ['days', 'hours', 'weeks'] as const;
export type LeaveUnit = (typeof LEAVE_UNITS)[number];
/* The unit a balance is held and shown in: the employee type's display unit. */
export type BalanceUnit = 'days' | 'hours';
export interface LeaveType { code: string; name: string; icon: string; short: string; policy: string; paid: boolean; evidence: boolean; unit: LeaveUnit; active: boolean }
export interface LeavePolicy {
  code: string; name: string; method: string; unit: LeaveUnit; base: number; statutory: number; serviceRule: string; prorata: string;
  carry: number; approval: boolean; sla: number; escalate: boolean; bh: string;
}
/* LEAVE_STAGES: the booking workflow, staged and timed. */
export interface LeaveStage { n: number; who: string; action: string; wait: number; channel: string }
export const STAGE_CHANNELS = FULFIL_CHANNELS;
/* The employee type's leave policy and display unit (typeLeave), kept in the leave config by type code (D11). */
export interface TypeLeave { policy: string; unit: BalanceUnit }
export const DEFAULT_TYPE_LEAVE: TypeLeave = { policy: 'STD', unit: 'days' };
export const ESCALATE_TO = ['Service Manager', 'HR administrator', 'Head of Operations'] as const;
export const RECORD_UNITS = ['Days and hours', 'Days only', 'Hours only'] as const;
export const TOIL_WINDOWS = [3, 6, 12] as const;
export interface LeaveConfig {
  slaDays: number; escalateTo: string; unit: string; carry: number; toilMax: number; toilWindow: number; buySell: boolean;
  finYearStart: string; bhPaid: boolean; absenceTrigger: number; autoEntitlement: boolean; blocksTimesheet: boolean;
  affectsRota: boolean; minNotice: number; cancelWindow: number;
}
export const DEFAULT_LEAVE_CONFIG: LeaveConfig = {
  slaDays: 5, escalateTo: 'Service Manager', unit: 'Days and hours', carry: 5, toilMax: 24, toilWindow: 3, buySell: false,
  finYearStart: '01/04', bhPaid: true, absenceTrigger: 100, autoEntitlement: true, blocksTimesheet: true, affectsRota: true,
  minNotice: 7, cancelWindow: 7,
};

/* policyBy: an unknown code falls back to the first policy, as the prototype's does. */
export const policyBy = (policies: readonly LeavePolicy[], code: string): LeavePolicy | undefined =>
  policies.find(p => p.code === code) ?? policies[0];
export const typeLeaveFor = (types: Readonly<Record<string, TypeLeave>>, employeeType: string): TypeLeave =>
  (Object.hasOwn(types, employeeType) ? types[employeeType] : undefined) ?? DEFAULT_TYPE_LEAVE;
export const leaveTypeBy = (types: readonly LeaveType[], code: string) => types.find(t => t.code === code);
export const leaveTypeName = (types: readonly LeaveType[], code: string) => leaveTypeBy(types, code)?.name ?? code;
/* The hours in one day of leave: a fifth of the contracted week, or 7.5 for someone on no fixed hours. */
export const dailyHours = (contractedHours: number) => (contractedHours > 0 ? contractedHours / 5 : 7.5);
/* What the request form says each type draws on (the option's data-b). */
export function typeBalanceText(t: LeaveType, policy: LeavePolicy | undefined, al: string, toil: { hours: number; useBy: string }): string {
  if (t.code === 'AL') return al;
  if (t.code === 'TOIL') return `${toil.hours} hours built up${toil.useBy ? ` · use by ${formatDmy(toil.useBy)}` : ''}`;
  if (policy?.code === 'NONE') return 'No limit. Unpaid.';
  if (policy?.code === 'FIX') return `${policy.base} days a year`;
  if (policy?.code === 'HRIS') return 'Held in the HRIS';
  if (policy?.code === 'SICK') return 'Occupational scheme applies';
  return '—';
}

/* Leave setup (D11): what a save must hold. Stages 1 and 2 are fixed, so at least two stay. */
const wholeIn = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isInteger(n) && n >= lo && n <= hi;
const numIn = (n: unknown, lo: number, hi: number) => typeof n === 'number' && Number.isFinite(n) && n >= lo && n <= hi;
const FIN_START = /^(\d{2})\/(\d{2})$/;
export function leaveConfigProblem(c: LeaveConfig, types: readonly LeaveType[], policies: readonly LeavePolicy[], stages: readonly LeaveStage[],
  typeLeave: Readonly<Record<string, TypeLeave>>, employeeTypes: readonly string[]): LeaveRefusal | null {
  const bad = (field: string, message: string, next: string): LeaveRefusal => ({ code: 'VALIDATION', message, next, field });
  if (!wholeIn(c.slaDays, 1, 60)) return bad('slaDays', 'The approval SLA is a whole number of days from 1 to 60.', 'Enter the days a manager has to decide.');
  if (!(ESCALATE_TO as readonly string[]).includes(c.escalateTo)) return bad('escalateTo', 'Choose who a request escalates to from the list.', 'Pick an approver.');
  if (!(RECORD_UNITS as readonly string[]).includes(c.unit)) return bad('unit', 'Choose how leave is recorded from the list.', 'Pick a unit.');
  if (!numIn(c.carry, 0, 40)) return bad('carry', 'Carry-over is a number of days from 0 to 40.', 'Enter the days that can carry over.');
  if (!numIn(c.toilMax, 0, 400)) return bad('toilMax', 'The TOIL limit is a number of hours from 0 to 400.', 'Enter the hours that can build up.');
  if (!(TOIL_WINDOWS as readonly number[]).includes(c.toilWindow)) return bad('toilWindow', 'Choose the TOIL window from the list.', 'Pick 3, 6 or 12 months.');
  const fy = FIN_START.exec(c.finYearStart);
  if (!fy || !isIsoDate(`2026-${fy[2] ?? ''}-${fy[1] ?? ''}`)) return bad('finYearStart', 'The leave year starts on a day and month, like 01/04.', 'Enter the first day of the leave year.');
  if (!wholeIn(c.absenceTrigger, 1, 10000)) return bad('absenceTrigger', 'The absence trigger is a whole number of points from 1 to 10000.', 'Enter the Bradford score that triggers a review.');
  if (!wholeIn(c.minNotice, 0, 365)) return bad('minNotice', 'Minimum notice is a whole number of days from 0 to 365.', 'Enter the notice a request should give.');
  if (!wholeIn(c.cancelWindow, 0, 365)) return bad('cancelWindow', 'The cancellation window is a whole number of days from 0 to 365.', 'Enter the days before leave starts.');
  const pcodes = policies.map(p => p.code);
  for (const [i, t] of types.entries()) {
    if (!t.name.trim()) return bad(`types.${i}.name`, `Leave type ${t.code} needs a name.`, 'Name every leave type.');
    if (!pcodes.includes(t.policy)) return bad(`types.${i}.policy`, `Leave type ${t.code} names a policy that does not exist.`, 'Pick a policy from the list.');
    if (!(LEAVE_UNITS as readonly string[]).includes(t.unit)) return bad(`types.${i}.unit`, `Leave type ${t.code} needs a unit of days, hours or weeks.`, 'Pick a unit.');
  }
  if (new Set(types.map(t => t.code)).size !== types.length) return bad('types', 'Two leave types share a code.', 'Give each leave type its own code.');
  for (const [i, p] of policies.entries()) {
    if (!numIn(p.base, 0, 400) || !numIn(p.carry, 0, 40) || !wholeIn(p.sla, 0, 60))
      return bad(`policies.${i}`, `Policy ${p.name} needs a base from 0 to 400, carry-over from 0 to 40 and an SLA from 0 to 60 days.`, 'Correct the policy numbers.');
    if (!(LEAVE_UNITS as readonly string[]).includes(p.unit)) return bad(`policies.${i}.unit`, `Policy ${p.name} needs a unit of days, hours or weeks.`, 'Pick a unit.');
  }
  if (stages.length < 2) return bad('stages', 'Keep the first two workflow stages.', 'The employee and line manager stages cannot be removed.');
  for (const [i, s] of stages.entries()) {
    if (!s.who.trim() || !s.action.trim()) return bad(`stages.${i}`, `Stage ${s.n} needs an approver and an action.`, 'Fill in every stage.');
    if (!wholeIn(s.wait, 0, 60)) return bad(`stages.${i}.wait`, `Stage ${s.n} waits a whole number of days from 0 to 60.`, 'Correct the wait.');
    if (!(STAGE_CHANNELS as readonly string[]).includes(s.channel)) return bad(`stages.${i}.channel`, `Choose how stage ${s.n} notifies from the list.`, 'Pick a channel.');
  }
  for (const [k, v] of Object.entries(typeLeave)) {
    if (!employeeTypes.includes(k)) return bad(`typeLeave.${k}`, `There is no employee type with the code ${k}.`, 'Set a leave policy on an existing employee type.');
    if (!pcodes.includes(v.policy)) return bad(`typeLeave.${k}.policy`, `The leave policy for ${k} does not exist.`, 'Pick a policy from the list.');
    if (v.unit !== 'days' && v.unit !== 'hours') return bad(`typeLeave.${k}.unit`, `The display unit for ${k} is days or hours.`, 'Pick days or hours.');
  }
  return null;
}
/* lvt-add and lvst-add. */
export const newLeaveType = (n: number): LeaveType => ({ code: `NEW${n}`, name: 'New leave type', icon: '•', short: 'New', policy: 'FIX', paid: true,
  evidence: false, unit: 'days', active: false });
export const newLeaveStage = (n: number): LeaveStage => ({ n, who: 'New approver', action: 'Decision required', wait: 2, channel: 'In-app + email' });
export const renumberLeaveStages = (stages: readonly LeaveStage[]) => stages.map((s, i) => ({ ...s, n: i + 1 }));
export const LEAVE_TYPE_ADDED = 'Leave type added. Name it and pick its policy.';
/* Rota and leave (D7): leave reaches the rota only with the Rota module and LV_ROTA on. */
export const leaveWritesRota = (modules: Readonly<Record<string, boolean>>, flags: Readonly<Record<string, boolean>>) => !!modules.R && !!flags.LV_ROTA;

/* ------------------------------------------------------ the leave year */
/* FIN_YEAR, from finYearStart ('01/04'): the leave year the date falls in. */
export function leaveYear(date: string, finYearStart: string) {
  const m = FIN_START.exec(finYearStart), y = parseIso(date).getUTCFullYear();
  const mmdd = m ? `${m[2] ?? '04'}-${m[1] ?? '01'}` : '04-01';
  const start = `${date.slice(5) >= mmdd ? y : y - 1}-${mmdd}`, end = addDays(addMonths(start, 12), -1);
  return { start, end, label: `${start.slice(0, 4)}/${end.slice(2, 4)}` };
}
const inYear = (date: string, y: { start: string; end: string }) => date >= y.start && date <= y.end;
export type LeaveYearSpan = ReturnType<typeof leaveYear>;
export interface YearShare { year: LeaveYearSpan; days: number; hours: number }
/* A request is charged to the leave year(s) its days fall in (review I2): its
   days and hours shared out by the calendar days in each year, in date order. */
export function yearShares(r: { from: string; to: string }, total: { days: number; hours: number }, finYearStart: string): YearShare[] {
  if (!isIsoDate(r.from) || !isIsoDate(r.to) || r.to < r.from) return [];
  const span = daysBetween(r.from, r.to) + 1, out: YearShare[] = [];
  for (let y = leaveYear(r.from, finYearStart); y.start <= r.to; y = leaveYear(addDays(y.end, 1), finYearStart)) {
    const n = daysBetween(r.from > y.start ? r.from : y.start, r.to < y.end ? r.to : y.end) + 1;
    out.push({ year: y, days: round2(total.days * n / span), hours: round2(total.hours * n / span) });
  }
  return out;
}

/* -------------------------------------------------- entitlement (D3) */
export interface PersonLeaveFacts { contractedHours: number; start: string; accruedHours?: number }
export interface CalcLine { label: string; value: string }
export interface Entitlement { days: number; hours: number; policy: LeavePolicy; years: number; lines: CalcLine[] }
export const FULL_TIME_HOURS = 37.5;
export const ACCRUAL_RATE = 0.1207;
/* yearsService: whole years from the start date to the clock. A record with no start date has none. */
export const yearsService = (start: string, today: string) =>
  (isIsoDate(start) ? Math.max(0, Math.floor(daysBetween(start, today) / 365.25)) : 0);
/* serviceBonus: the policy's service rule as written, "+1 day per 3 years,
   capped at 5". The prototype tested the rule for the word "service", which the
   Standard policy's rule does not contain, so it never added the bonus it
   showed; here the rule applies. */
const SERVICE_RULE = /\+(\d+(?:\.\d+)?) days? per (\d+) years?(?:,? capped at (\d+(?:\.\d+)?))?/i;
export function serviceBonus(policy: Pick<LeavePolicy, 'serviceRule'>, years: number): number {
  const m = SERVICE_RULE.exec(policy.serviceRule || '');
  if (!m) return 0;
  const each = Number(m[1]), per = Number(m[2]), cap = m[3] === undefined ? Infinity : Number(m[3]);
  return per > 0 ? Math.min(cap, Math.floor(years / per) * each) : 0;
}
/* entitlement: a full, traceable calculation, not just a number. */
export function entitlement(p: PersonLeaveFacts, policy: LeavePolicy, today: string): Entitlement {
  const years = yearsService(p.start, today), lines: CalcLine[] = [], day = dailyHours(p.contractedHours);
  let days = 0, hours = 0;
  if (policy.code === 'ACC') {
    const worked = (p.accruedHours ?? 0) / ACCRUAL_RATE;
    hours = round1(worked * ACCRUAL_RATE);
    lines.push({ label: 'Hours worked to date', value: `${worked.toFixed(1)} h` }, { label: 'Accrual rate', value: '12.07%' },
      { label: 'Entitlement accrued', value: `${hours.toFixed(1)} h` });
    days = round1(hours / day);
  } else if (policy.code === 'NONE' || policy.code === 'HRIS') {
    lines.push({ label: 'Policy', value: policy.method });
  } else {
    const bonus = serviceBonus(policy, years);
    const ratio = p.contractedHours > 0 ? Math.min(1, p.contractedHours / FULL_TIME_HOURS) : 0;
    days = round1((policy.base + bonus) * ratio);
    hours = round2(days * day);
    lines.push({ label: 'Policy base', value: plural(policy.base, 'day') },
      { label: `Service (${plural(years, 'year')})`, value: bonus ? `+${plural(bonus, 'day')}` : 'no addition' },
      { label: 'Contracted hours', value: `${p.contractedHours} h of ${FULL_TIME_HOURS} h full time` },
      { label: 'Pro-rata factor', value: `${(ratio * 100).toFixed(1)}%` },
      { label: 'Entitlement', value: `${plural(days, 'day')} · ${hours.toFixed(2)} hours` });
  }
  return { days, hours, policy, years, lines };
}
/* The "Simulate an hours change" dialog (D3): computed on the client, nothing written. */
export function proRataSimulation(p: PersonLeaveFacts, newHours: number, policy: LeavePolicy, today: string) {
  const before = entitlement(p, policy, today), after = entitlement({ ...p, contractedHours: newHours }, policy, today);
  const delta = round1(after.days - before.days);
  return { before, after, delta, text: `${delta >= 0 ? '+' : ''}${delta} days` };
}
export const SIMULATION_NOTE = 'This is a simulation. Contracted hours change on the person record in People, and entitlement follows from there.';

/* ------------------------------------------------- requests (D1, D2) */
export const LEAVE_STATES = ['pending', 'approved', 'declined', 'cancelled'] as const;
export type LeaveState = (typeof LEAVE_STATES)[number];
export type LeaveTone = 'warn' | 'ok' | 'err' | 'neu';
export interface LeaveStateInfo { label: string; tone: LeaveTone; glyph: string; next: readonly LeaveState[] }
/* lvPill: the labels the employee sees. */
export const LEAVE_STATE: Record<LeaveState, LeaveStateInfo> = {
  pending: { label: 'Waiting', tone: 'warn', glyph: '◷', next: ['approved', 'declined', 'cancelled'] },
  approved: { label: 'Approved', tone: 'ok', glyph: '✓', next: [] },
  declined: { label: 'Declined', tone: 'err', glyph: '✕', next: [] },
  cancelled: { label: 'Cancelled', tone: 'neu', glyph: '—', next: [] },
};
export const isLeaveState = (s: unknown): s is LeaveState => typeof s === 'string' && (LEAVE_STATES as readonly string[]).includes(s);
export const leaveCan = (from: string, to: string) => isLeaveState(from) && isLeaveState(to) && LEAVE_STATE[from].next.includes(to);
const MOVE_VERB: Record<LeaveState, string> = { pending: 'sent', approved: 'approved', declined: 'declined', cancelled: 'cancelled' };
/* null when the move is allowed (D1). Approved leave cannot be withdrawn in this build (LV-15). */
export function leaveTransitionProblem(from: string, to: string): LeaveRefusal | null {
  if (leaveCan(from, to)) return null;
  if (from === 'pending') return { code: 'TRANSITION_NOT_ALLOWED', message: 'This request is already waiting for a decision.', next: 'Nothing more is needed.' };
  const was = isLeaveState(from) ? LEAVE_STATE[from].label.toLowerCase() : 'not known';
  const verb = isLeaveState(to) ? MOVE_VERB[to] : 'changed';
  return { code: 'TRANSITION_NOT_ALLOWED', message: `This request is ${was}. Only a waiting request can be ${verb}.`,
    next: from === 'approved' ? 'Ask your manager if the dates need to change.' : 'Send a new request if you still need the time off.' };
}

export const LEAVE_PARTS = ['full', 'am', 'pm', 'hours'] as const;
export type LeavePart = (typeof LEAVE_PARTS)[number];
export const PART_LABEL: Record<LeavePart, string> = { full: 'Full days', am: 'Morning only', pm: 'Afternoon only', hours: 'Hours' };
export const isLeavePart = (s: unknown): s is LeavePart => typeof s === 'string' && (LEAVE_PARTS as readonly string[]).includes(s);
export interface RequestInput { type: string; from: string; to: string; part: LeavePart }
export interface LeaveShape { from: string; to: string; part: LeavePart; days: number; hours: number; span: number; label: string; note: string; qty: number; unit: BalanceUnit }
export const PICK_BOTH_DATES = 'Pick both dates.';
export const LAST_BEFORE_FIRST = 'The last day is before the first day.';
export const halfDaySingle = (part: LeavePart) => `${PART_LABEL[part]} applies to a single day. Set both dates the same.`;
/* leaveShape: what the request comes to. Calendar days, half a day for a morning
   or afternoon, and hours at the person's day length. Bank holidays are not
   deducted (D2). A type held in weeks is stored in days. */
export function leaveShape(input: RequestInput, typeUnit: LeaveUnit, contractedHours: number): { ok: true; shape: LeaveShape } | { ok: false; field: string; message: string } {
  const { from, to, part } = input;
  if (!isIsoDate(from) || !isIsoDate(to)) return { ok: false, field: isIsoDate(from) ? 'to' : 'from', message: PICK_BOTH_DATES };
  if (daysBetween(from, to) < 0) return { ok: false, field: 'to', message: LAST_BEFORE_FIRST };
  const span = daysBetween(from, to) + 1;
  let days: number, note = '';
  if (part === 'full') days = span;
  else if (part === 'hours') { days = span; note = 'recorded in hours'; }
  else {
    if (span > 1) return { ok: false, field: 'part', message: halfDaySingle(part) };
    days = 0.5;
  }
  const hours = round2(days * dailyHours(contractedHours));
  const label = typeUnit === 'hours' || part === 'hours' ? `${hours.toFixed(2)} hours` : `${plural(days, 'day')} · ${hours.toFixed(2)} hours`;
  const unit: BalanceUnit = typeUnit === 'hours' ? 'hours' : 'days';
  return { ok: true, shape: { from, to, part, days, hours, span, label, note, qty: unit === 'hours' ? hours : days, unit } };
}
/* `year` names a leave year other than the current one ("2027/28"). */
const inLeaveYear = (year?: string) => (year ? ` in the ${year} leave year` : '');
export const moreThanLeft = (leftD: number, year?: string) => `That is more than the ${leftD} days you have left${inLeaveYear(year)}.`;
export const OVER_BALANCE = 'That is more than your remaining balance.';
export const wouldRemain = (leftD: number, days: number, year?: string) => `${round1(leftD - days)} days would remain${inLeaveYear(year)}.`;
export const CHOOSE_TYPE = 'Choose a type of leave.';
/* What the annual leave balance says of a shaped request (review I2): each
   leave year it touches is checked with its own share against what is left in
   that year. `leftIn` returns null for a year the caller holds no balance for,
   which is then left to the server. */
export interface BalanceCheckCtx { today: string; finYearStart: string; leftIn: (year: LeaveYearSpan) => number | null }
export function balanceCheck(shape: Pick<LeaveShape, 'from' | 'to' | 'days' | 'hours'>, ctx: BalanceCheckCtx): { ok: true; hint: string } | { ok: false; problem: LeaveRefusal } {
  const current = leaveYear(ctx.today, ctx.finYearStart).start, hints: string[] = [];
  for (const s of yearShares(shape, shape, ctx.finYearStart)) {
    const left = ctx.leftIn(s.year);
    if (left === null) continue;
    const named = s.year.start === current ? undefined : s.year.label;
    if (s.days > left)
      return { ok: false, problem: { code: 'OVER_BALANCE', message: moreThanLeft(left, named), next: 'Ask for fewer days, or talk to your manager.', field: 'to' } };
    hints.push(wouldRemain(left, s.days, named));
  }
  return { ok: true, hint: hints.join(' ') };
}
/* lv-send, server side (D2): a known active type, the shape, and the annual
   leave balance while automatic entitlement is on. What `leftIn` returns
   already holds back every other waiting request in that year. */
export function requestProblem(input: RequestInput, ctx: BalanceCheckCtx & { types: readonly LeaveType[]; contractedHours: number; checkBalance: boolean }):
  { ok: true; shape: LeaveShape; hint: string } | { ok: false; problem: LeaveRefusal } {
  const t = leaveTypeBy(ctx.types, input.type);
  if (!t?.active) return { ok: false, problem: { code: 'VALIDATION', message: CHOOSE_TYPE, next: 'Pick one of the leave types offered.', field: 'type' } };
  if (!isLeavePart(input.part)) return { ok: false, problem: { code: 'VALIDATION', message: 'Choose how much of each day.', next: 'Pick full days, a morning, an afternoon or hours.', field: 'part' } };
  const s = leaveShape(input, t.unit, ctx.contractedHours);
  if (!s.ok) return { ok: false, problem: { code: 'VALIDATION', message: s.message, next: 'Correct the dates and send it again.', field: s.field } };
  if (t.code === 'AL' && ctx.checkBalance) {
    const b = balanceCheck(s.shape, ctx);
    return b.ok ? { ok: true, shape: s.shape, hint: b.hint } : b;
  }
  return { ok: true, shape: s.shape, hint: s.shape.note };
}
/* A request in days and hours, whatever unit it was stored in. */
export function requestDays(r: Pick<LeaveRecord, 'qty' | 'unit'>, contractedHours: number) {
  const day = dailyHours(contractedHours);
  return r.unit === 'hours' ? { days: round2(r.qty / day), hours: r.qty } : { days: r.qty, hours: round2(r.qty * day) };
}
export const leaveRange = (from: string, to: string) => (from === to ? formatDmy(from) : `${formatDmy(from)} – ${formatDmy(to)}`);
/* "4 days" or "7.5 hours", as My requests lists it. */
export const qtyText = (qty: number, unit: string) => `${qty} ${unit}`;

/* Refusals of a decision (D4, D5). */
export const SELF_APPROVAL = 'You cannot decide your own leave request.';
export const selfApprovalProblem = (requester: string, self: string): LeaveRefusal | null =>
  (requester === self ? { code: 'SELF_APPROVAL', message: SELF_APPROVAL, next: 'Ask another approver at your location.' } : null);
export const REASON_REQUIRED = 'Give a reason for declining. The colleague sees it.';
export const declineReasonProblem = (reason: string): LeaveRefusal | null =>
  (reason.trim() ? null : { code: 'REASON_REQUIRED', message: REASON_REQUIRED, next: 'Say why the request cannot be granted.', field: 'reason' });
export const NOT_YOUR_REQUEST = 'You can cancel only your own requests.';

/* ---------------------------------------------- balance (D2, D3) */
/* The per-person base: what was taken this leave year before the seeded
   records, in the type's display unit, plus the TOIL bank and its use-by date.
   accruedHours is the bank worker's accrual to date (ACC policy). */
export interface LeaveBase { unit: BalanceUnit; taken: number; toil: number; toilBy: string; accruedHours?: number }
export interface LeaveRecord { type: string; from: string; to: string; part: LeavePart; qty: number; unit: BalanceUnit; state: string }
/* A ledger row. qty is signed, positive adds to the balance. `counts` marks
   a row that moves what is taken (days returned); an informational row (opening
   entitlement, leave approved) does not, because the request itself counts. */
export interface LedgerRow { date: string; type: string; qty: number; unit: BalanceUnit; why: string; counts: boolean; dates?: string[] }
export interface Balance { ent: Entitlement; unit: BalanceUnit; takenD: number; takenH: number; pending: number; pendingH: number; leftD: number; leftH: number;
  toil: number; toilPending: number; toilLeft: number; toilBy: string }
const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
/* balance: entitlement less what is taken and what is waiting. Annual leave
   draws on it; TOIL draws on the TOIL bank, in hours. Only the days of each
   request that fall in the leave year count (`year`, this one by default). */
export function balanceOf(o: { ent: Entitlement; base: LeaveBase; contractedHours: number; requests: readonly LeaveRecord[]; ledger: readonly LedgerRow[];
  today: string; finYearStart: string; year?: LeaveYearSpan }): Balance {
  const yr = o.year ?? leaveYear(o.today, o.finYearStart), day = dailyHours(o.contractedHours);
  const shareIn = (r: LeaveRecord) => yearShares(r, requestDays(r, o.contractedHours), o.finYearStart).find(s => s.year.start === yr.start);
  const shares = (type: string, state: string) => o.requests.filter(r => r.type === type && r.state === state).flatMap(r => {
    const s = shareIn(r);
    return s ? [s] : [];
  });
  const al = (state: string) => shares('AL', state);
  const back = o.ledger.filter(l => l.counts && inYear(l.date, yr)).map(l => (l.unit === 'hours' ? { days: l.qty / day, hours: l.qty } : { days: l.qty, hours: l.qty * day }));
  const approved = al('approved'), waiting = al('pending');
  let takenD: number, takenH: number;
  if (o.base.unit === 'hours') {
    takenH = round2(o.base.taken + sum(approved.map(x => x.hours)) - sum(back.map(x => x.hours)));
    takenD = round1(takenH / day);
  } else {
    takenD = round2(o.base.taken + sum(approved.map(x => x.days)) - sum(back.map(x => x.days)));
    takenH = round2(takenD * day);
  }
  const pending = round2(sum(waiting.map(x => x.days))), pendingH = round2(sum(waiting.map(x => x.hours)));
  const toilHours = (state: string) => sum(shares('TOIL', state).map(s => s.hours));
  const toil = round2(o.base.toil - toilHours('approved')), toilPending = round2(toilHours('pending'));
  return { ent: o.ent, unit: o.base.unit, takenD, takenH, pending, pendingH, leftD: round1(o.ent.days - takenD - pending),
    leftH: round2(o.ent.hours - takenH - pendingH), toil, toilPending, toilLeft: round2(toil - toilPending), toilBy: o.base.toilBy };
}
/* The balance of one leave year (review I2). This year's is entitlement at
   the clock less the seeded base and this year's requests. Another year's
   takes the same policy and contracted hours with service counted to that
   year's start, nothing taken before it and no carry-over (LV-17 is out of
   scope). */
export interface YearBalanceInput { facts: PersonLeaveFacts; policy: LeavePolicy; base: LeaveBase; requests: readonly LeaveRecord[]; ledger: readonly LedgerRow[];
  today: string; finYearStart: string }
export function yearBalance(o: YearBalanceInput, year: LeaveYearSpan): Balance {
  const current = inYear(o.today, year);
  return balanceOf({ ent: entitlement(o.facts, o.policy, current ? o.today : year.start), base: current ? o.base : { ...o.base, taken: 0 },
    contractedHours: o.facts.contractedHours, requests: o.requests, ledger: o.ledger, today: o.today, finYearStart: o.finYearStart, year });
}
/* What a balance reads as: "13.5 of 25 days left", or hours for a bank worker. */
export const balanceText = (b: Balance) => (b.unit === 'hours' ? `${b.leftH} of ${b.ent.hours.toFixed(1)} hours left` : `${b.leftD} of ${b.ent.days} days left`);
export const daysToTakeText = (b: Balance, yearEnd: string, toilOn: boolean) =>
  `${b.leftD} days to take by ${formatDmy(yearEnd)}${toilOn && b.toil ? ` · ${b.toil} hours TOIL expires ${formatDmy(b.toilBy)}` : ''}`;
/* "+24 days", "-2 days", "0 hours". */
export const ledgerQty = (l: Pick<LedgerRow, 'qty' | 'unit'>) => `${l.qty > 0 ? '+' : ''}${l.qty} ${l.unit}`;

/* ------------------------------------------- SLA and notice (D6) */
export interface SlaState { daysLeft: number; escalated: boolean; stage: number; tone: 'warn' | 'err' }
/* Derived from the date raised, the SLA and the clock. No timer: a request is
   escalated once its days run out, or where the seed says it already was. */
export function slaOf(r: { raised: string; escalated?: boolean }, slaDays: number, today: string, stageCount: number): SlaState {
  const daysLeft = slaDays - daysBetween(r.raised, today);
  const escalated = !!r.escalated || daysLeft < 0;
  return { daysLeft, escalated, stage: Math.min(escalated ? 3 : 2, Math.max(1, stageCount)), tone: daysLeft <= 1 || escalated ? 'err' : 'warn' };
}
export const slaPillText = (s: SlaState, slaDays: number, escalateTo: string) =>
  (s.escalated ? `Escalated · ${escalateTo}` : `${Math.max(0, s.daysLeft)} of ${slaDays} days left`);
export const slaBreachedText = (n: number, slaDays: number) => `${n} request${n > 1 ? 's have' : ' has'} breached the ${slaDays}-day approval SLA`;
export const escalationText = (escalateTo: string) => `Approval SLA breached. Escalated to ${escalateTo}.`;
export const stageText = (stages: readonly LeaveStage[], n: number) => `Stage ${n} of ${stages.length} · ${stages[n - 1]?.who ?? ''}`;
/* minNotice and cancelWindow advise; they never block (D6). */
export function noticeAdvisory(from: string, raised: string, minNotice: number): string | null {
  const n = daysBetween(raised, from);
  return n < minNotice ? `Requested with ${plural(Math.max(0, n), 'day')}' notice, less than the ${minNotice} days the policy asks for.` : null;
}
export function cancelWindowAdvisory(from: string, today: string, cancelWindow: number): string | null {
  const n = daysBetween(today, from);
  return n < cancelWindow ? `This leave starts in ${plural(Math.max(0, n), 'day')}, inside the ${cancelWindow}-day window for changes.` : null;
}
export const cancelTip = (cancelWindow: number) => `You can change or cancel up to ${cancelWindow} days before it starts.`;
/* Effect on cover, worked out when the request is sent and kept on it (as lv-send). */
export interface CoverDay { date: string; onShift: number; working: boolean; min: number }
export const ROTA_OFF_IMPACT = 'Cover is not checked. This tenant does not use Rota.';
export function coverImpact(days: readonly CoverDay[]): { text: string; short: boolean } {
  if (!days.length) return { text: 'No rota stored for these days yet.', short: false };
  for (const d of days) {
    const after = d.onShift - (d.working ? 1 : 0);
    if (after < d.min) return { text: `${formatDay(d.date).slice(4)} drops to ${after} of ${d.min}. Cover needed.`, short: true };
  }
  return { text: `Cover is met. ${Math.min(...days.map(d => d.onShift - (d.working ? 1 : 0)))} on shift.`, short: false };
}

/* --------------------------------------- notifications and audit (D12) */
export const requestedNotice = (name: string, typeName: string, range: string, label: string, slaDays: number) =>
  ({ title: 'Leave requested', body: `${name} · ${typeName} · ${range} · ${label} · decide within ${slaDays} days` });
export const sentNotice = (range: string, label: string, manager: string) => ({ title: 'Leave request sent', body: `${range} · ${label} · with ${manager}` });
export const approvedNotice = (range: string, typeName: string) => ({ title: 'Leave approved', body: `${range} · ${typeName}` });
export const declinedNotice = (range: string, reason: string) => ({ title: 'Leave declined', body: `${range} · ${reason.trim()}` });
export const cancelledNotice = (name: string, from: string) => ({ title: 'Leave request cancelled', body: `${name} · ${formatDmy(from)}` });
export const daysReturnedNotice = (n: number) => ({ title: 'Entitlement changed', body: `${plural(n, 'day')} returned to your annual leave balance` });
export const sicknessNotice = (name: string, range: string) => ({ title: 'Sickness recorded', body: `${name} · ${range}` });
export const RTW_TITLE = 'Return-to-work meeting requested';
export const rtwNotices = (managerName: string, locName: string) => ({
  employee: { title: RTW_TITLE, body: 'Your manager has asked to arrange a return-to-work meeting' },
  admin: { title: RTW_TITLE, body: `Requested by ${managerName} · ${locName}` } });
export const requestedAudit = (typeName: string, range: string, label: string) => `${typeName} · ${range} · ${label}`;
export const decidedAudit = (name: string, from: string) => `${name} · ${formatDmy(from)}`;
/* The toasts, each em-dash aside rewritten as its own sentence. */
export const requestedToast = (typeName: string, label: string, manager: string) => `${typeName} requested · ${label} · sent to ${manager}`;
export const CANCELLED_TOAST = 'Request cancelled. Your manager has been told.';
export const declinedToast = (first: string) => `${first}’s request declined. They have been told the reason.`;
export const approvedToast = (first: string, changed: boolean, gap: boolean) => (gap
  ? `${first}’s leave approved. The rota now shows them unavailable and a cover request has opened.`
  : `${first}’s leave approved${changed ? '. The rota shows them unavailable.' : ''}`);
export const sicknessToast = (short: boolean) => (short ? 'Sickness recorded. Shift removed from the rota and a cover request opened.' : 'Sickness recorded. Shift removed from the rota.');
export const RTW_TOAST = 'Return-to-work meeting requested. The colleague and HR have been notified.';
export const daysReturnedToast = (n: number, name: string) => `${plural(n, 'day')} returned to ${name}’s annual leave balance`;
export const tellManagerToast = (manager: string) => `Messaging is not built yet. Nothing has been sent to ${manager}.`;

/* ---------------------------------------------- sickness (D9) */
export const SICK_REASONS = ['Cold or flu', 'Stomach upset', 'Musculoskeletal', 'Mental health', 'Other'] as const;
export interface RtwRequest { requestedAt: string; by: RotaActor }
/* to is '' while the colleague is still off. */
export interface SickEpisode { id: string; personCode: string; from: string; to: string; reason: string; note: string; rtw: RtwRequest | null }
export const episodeEnd = (e: Pick<SickEpisode, 'from' | 'to'>, today: string) => e.to || (e.from > today ? e.from : today);
export const episodeDays = (e: Pick<SickEpisode, 'from' | 'to'>, today: string) => daysBetween(e.from, episodeEnd(e, today)) + 1;
export interface SickInput { from: string; to: string; reason: string }
export type SickPlan = { kind: 'new'; from: string; to: string } | { kind: 'extend'; id: string; from: string; to: string };
/* record-sick: a day next to an open or just-ended episode, or inside one,
   extends it rather than starting a new spell. */
export function recordSicknessPlan(episodes: readonly Pick<SickEpisode, 'id' | 'from' | 'to'>[], input: SickInput, today: string): { ok: true; plan: SickPlan } | { ok: false; problem: LeaveRefusal } {
  if (!isIsoDate(input.from)) return { ok: false, problem: { code: 'VALIDATION', message: 'Pick the first day off.', next: 'Choose the day the absence began.', field: 'from' } };
  if (input.to && (!isIsoDate(input.to) || input.to < input.from)) return { ok: false, problem: { code: 'VALIDATION', message: LAST_BEFORE_FIRST, next: 'Correct the dates.', field: 'to' } };
  if (!(SICK_REASONS as readonly string[]).includes(input.reason)) return { ok: false, problem: { code: 'VALIDATION', message: 'Choose the reason given.', next: 'Pick a reason from the list.', field: 'reason' } };
  const newEnd = input.to || input.from;
  for (const e of [...episodes].sort((a, b) => a.from.localeCompare(b.from))) {
    const end = episodeEnd(e, today);
    if (input.from > addDays(end, 1) || newEnd < addDays(e.from, -1)) continue;
    if (e.to && input.to && input.from >= e.from && input.to <= e.to)
      return { ok: false, problem: { code: 'ALREADY_RECORDED', message: `${formatDay(input.from)} is already recorded as sickness.`, next: 'Nothing more is needed.', field: 'from' } };
    const open = !e.to || !input.to;
    return { ok: true, plan: { kind: 'extend', id: e.id, from: input.from < e.from ? input.from : e.from, to: open ? '' : (newEnd > end ? newEnd : end) } };
  }
  return { ok: true, plan: { kind: 'new', from: input.from, to: input.to } };
}
/* Bradford: spells squared times days, over the 52 weeks to the clock. */
export const BRADFORD_WEEKS = 52;
export function bradford(episodes: readonly Pick<SickEpisode, 'from' | 'to'>[], today: string, trigger: number) {
  const since = addDays(today, -7 * BRADFORD_WEEKS + 1);
  const inWindow = episodes.filter(e => e.from <= today && episodeEnd(e, today) >= since);
  const days = sum(inWindow.map(e => daysBetween(e.from < since ? since : e.from, episodeEnd(e, today) > today ? today : episodeEnd(e, today)) + 1));
  const spells = inWindow.length, score = spells * spells * days;
  return { spells, days, score, triggered: score >= trigger };
}
export const latestAbsenceText = (e: Pick<SickEpisode, 'from' | 'to'>, today: string) => `${formatDmy(e.from)} · ${plural(episodeDays(e, today), 'day')}`;
/* The board's next step: a triggered colleague needs a return-to-work meeting; otherwise the latest episode's note. */
export const nextStepText = (triggered: boolean, latest: Pick<SickEpisode, 'note' | 'rtw'> | undefined) =>
  (triggered ? (latest?.rtw ? RTW_TITLE : 'Return-to-work meeting due') : latest?.note || 'No action');
export const triggerBannerText = (name: string, score: number, trigger: number) => `${name} has reached the absence trigger. Score ${score} of ${trigger}.`;
export const TRIGGER_NOTE = 'A return-to-work meeting is due within 5 days, then it escalates to HR.';
export const bradfordTip = (trigger: number) => `Spells squared, times total days, over the last ${BRADFORD_WEEKS} weeks against a threshold of ${trigger}.`;
export const RTW_ALREADY = 'A return-to-work meeting is already requested for this absence.';
export const rtwProblem = (e: Pick<SickEpisode, 'rtw'> | undefined): LeaveRefusal | null => (!e
  ? { code: 'NO_ABSENCE', message: 'There is no recorded absence to arrange a return to work for.', next: 'Record the sickness first.' }
  : e.rtw ? { code: 'ALREADY_REQUESTED', message: RTW_ALREADY, next: 'Nothing more is needed.' } : null);

/* -------------------------------- sick during booked leave (D10) */
const datesOf = (from: string, to: string) => Array.from({ length: Math.max(0, daysBetween(from, to) + 1) }, (_, i) => addDays(from, i));
/* The approved annual leave days a sickness episode covers, less any already
   returned. Each day is worth its share of the request: half for a morning. */
export function sickDuringLeave(requests: readonly (LeaveRecord & { id: string })[], episodes: readonly Pick<SickEpisode, 'from' | 'to'>[],
  returned: readonly string[], today: string) {
  const sick = new Set(episodes.flatMap(e => datesOf(e.from, episodeEnd(e, today))));
  const done = new Set(returned);
  return requests.filter(r => r.type === 'AL' && r.state === 'approved').flatMap(r => {
    const dates = datesOf(r.from, r.to), each = round2((r.part === 'am' || r.part === 'pm' ? 0.5 : 1));
    return dates.filter(d => sick.has(d) && !done.has(d)).map(date => ({ requestId: r.id, date, days: each }));
  });
}
export function giveBackProblem(picked: readonly string[], candidates: readonly { date: string }[]): LeaveRefusal | null {
  if (!picked.length) return { code: 'VALIDATION', message: 'Pick at least one day to give back.', next: 'Tick the days of leave the sickness covered.', field: 'dates' };
  const ok = new Set(candidates.map(c => c.date));
  const bad = picked.find(d => !ok.has(d));
  if (bad) return { code: 'NOT_SICK_ON_LEAVE', message: `${isIsoDate(bad) ? formatDay(bad) : bad} is not a day of approved leave covered by recorded sickness.`,
    next: 'Pick only days of approved annual leave with sickness recorded.', field: 'dates' };
  if (new Set(picked).size !== picked.length) return { code: 'VALIDATION', message: 'Each day can be given back once.', next: 'Pick each day once.', field: 'dates' };
  return null;
}
/* The one ledger row a give-back writes, in the person's display unit. */
export function giveBackRow(picked: readonly string[], candidates: readonly { date: string; days: number }[], unit: BalanceUnit, contractedHours: number, today: string): LedgerRow {
  const days = round2(sum(candidates.filter(c => picked.includes(c.date)).map(c => c.days)));
  return { date: today, type: 'Days returned', qty: unit === 'hours' ? round2(days * dailyHours(contractedHours)) : days, unit,
    why: 'Sickness recorded across booked annual leave', counts: true, dates: [...picked].sort() };
}
export const SICK_ON_LEAVE_TIP = 'Where sickness falls across annual leave, those days go back to the colleague’s balance.';

/* -------------------------------------- leaver reconciliation (D13) */
/* Whole months from the later of the leave year start and the start date, to the day after leaving. */
export function monthsWorked(yearStart: string, start: string, leaveDate: string) {
  const from = isIsoDate(start) && start > yearStart ? start : yearStart, stop = addDays(leaveDate, 1);
  let m = 0;
  while (m < 12 && addMonths(from, m + 1) <= stop) m++;
  return m;
}
export const SETTLED_IN_PAYROLL = 'Workforce identifies the amount and the direction. The monetary settlement is made in payroll.';
export function reconcileLeaver(o: { fullDays: number; takenDays: number; months: number; contractedHours: number }) {
  const prorata = round1(o.fullDays * (o.months / 12)), diff = round1(prorata - o.takenDays), day = dailyHours(o.contractedHours);
  const hours = (Math.abs(diff) * day).toFixed(2);
  return { full: o.fullDays, prorata, taken: o.takenDays, diff, hours: Number(hours),
    verdict: diff < 0 ? 'Over-taken' : diff > 0 ? 'Under-taken' : 'Settled',
    action: diff < 0 ? `Recover ${Math.abs(diff)} days (${hours} h) through the final payroll`
      : diff > 0 ? `Pay ${diff} days (${hours} h) in lieu through the final payroll` : 'No adjustment required' };
}

/* ------------------------------------------ leave to rota (D7) */
export const absenceMark = (type: string) => (type === 'SICK' ? SICK : LEAVE);
export const leaveRotaWhy = (mark: string) => (mark === SICK ? 'Sickness recorded' : 'Leave approved');
export const leaveCoverReason = (mark: string) => (mark === SICK ? 'Sickness' : 'Annual leave cover');
export interface CellPlanWeek { location: string; weekStart: string; weekId: string; days: number[] }
/* The dates grouped into the location's rota weeks (Monday first), in date order. */
export function datesCellPlan(location: string, dates: readonly string[]): CellPlanWeek[] {
  const out: CellPlanWeek[] = [];
  for (const d of [...new Set(dates)].filter(isIsoDate).sort()) {
    const weekStart = periodStart(d), day = daysBetween(weekStart, d);
    const w = out.find(x => x.weekStart === weekStart);
    if (w) w.days.push(day); else out.push({ location, weekStart, weekId: rotaWeekId(location, weekStart), days: [day] });
  }
  return out;
}
/* Every day of a request, from `from` to `to`. */
export const absenceCellPlan = (location: string, from: string, to: string) => datesCellPlan(location, datesOf(from, to));
/* Days of approved leave still booked: not given back after sickness (D10). */
export const bookedLeaveDates = (requests: readonly Pick<LeaveRecord, 'type' | 'from' | 'to' | 'state'>[], returned: readonly string[]) => {
  const back = new Set(returned);
  return new Set(requests.filter(r => r.state === 'approved' && r.type !== 'SICK').flatMap(r => datesOf(r.from, r.to)).filter(d => !back.has(d)));
};
/* A sickness episode's rota days. A day of booked annual leave stays leave (V)
   until the manager gives it back; giving it back then writes S on exactly
   those days (datesCellPlan over the returned dates). */
export const sicknessDates = (e: Pick<SickEpisode, 'from' | 'to'>, today: string, booked: ReadonlySet<string>) =>
  datesOf(e.from, episodeEnd(e, today)).filter(d => !booked.has(d));
/* The cell writes for one planned week, for the module 3 week path (setCells). */
export const absenceCellWrites = (w: CellPlanWeek, person: { code: string; name: string }, mark: string, by: RotaActor, at: string): CellWrite[] =>
  w.days.map(day => ({ personCode: person.code, name: person.name, day, to: mark, by, at, why: leaveRotaWhy(mark) }));
/* The planned days that fall below the minimum once the cells are written. */
export const shortDays = (lines: readonly Line[], days: readonly number[], min: number) => days.filter(d => onShift(lines, d) < min);

/* ------------------------------------------- leave to timesheet (D8) */
/* What absence a day carries from leave records, as the rota shows it: booked
   leave (V), else a sickness episode (S). */
export function absenceOn(date: string, requests: readonly Pick<LeaveRecord, 'type' | 'from' | 'to' | 'state'>[], episodes: readonly Pick<SickEpisode, 'from' | 'to'>[],
  today: string, returned: readonly string[] = []): '' | 'V' | 'S' {
  const back = new Set(returned);
  const r = requests.find(x => x.state === 'approved' && date >= x.from && date <= x.to && (x.type === 'SICK' || !back.has(date)));
  if (r) return r.type === 'SICK' ? SICK : LEAVE;
  return episodes.some(e => date >= e.from && date <= episodeEnd(e, today)) ? SICK : '';
}
export const absenceBlockedProblem = (mark: string): LeaveRefusal => ({ code: 'ABSENCE_BLOCKED',
  message: `${mark === SICK ? 'Sickness' : 'Annual leave'} is recorded for this day. Approved absence blocks timesheet capture while “Leave blocks timesheet capture” is on.`,
  next: 'If you did work, mark the day non-working and tick “Called in and worked anyway”.' });
/* A stored day a week submit or a multi-week catch-up would send, held back
   because absence now covers it (review I1). */
export const absenceHeldReason = (date: string, mark: string) =>
  `${formatDay(date)} was held back. ${mark === SICK ? 'Sickness' : 'Annual leave'} is recorded for that day, and approved absence blocks timesheet capture while “Leave blocks timesheet capture” is on.`;
