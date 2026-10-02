/* The day form's model, shared by My timesheet and proxy entry: which fields a
   person's type captures (the prototype's GROUPS, FIELD_HINTS, buildForm,
   readDayTimes, renderDaySummary and validateEntry, qnipay-workforce-v15.html:
   6097-6228, 6778-6823, 3357-3373), how the form's values become the DayInput
   the server takes, and the client-side checks. Every check is a domain
   function the server also runs (brief D3): the client only warns early. */
import type { CaptureSetup, DayInput, WeekDay } from '@/contract/timesheets';
import {
  deriveWorkType, fieldProblem, fieldSettingFor, fieldVisible, formatMinutes, missingMandatory, rotaFor, toMin, validateTimes,
  type BreakInput, type Clock, type DerivedRate, type FieldDef, type FieldDefault, type FieldEnv, type TypeCapture,
} from '@/domain/timesheet';

export const envOf = (c: CaptureSetup): FieldEnv =>
  ({ modules: c.modules, flagOn: f => c.flags.includes(f), capabilities: c.capabilities, defaults: c.fieldDefaults });
export const typeOf = (c: CaptureSetup): TypeCapture | undefined => c.type ?? undefined;
export const flagOn = (c: CaptureSetup, code: string) => c.flags.includes(code);
export const hm = (c: CaptureSetup, min: number) => formatMinutes(min, c.timeFormat);

/* GROUPS: the open groups sit in the entry card; the closed ones become
   "Shift details" in the side column (wireDayForm moves them there). */
export interface FieldGroup { key: string; name: string; open: boolean; tip?: string }
export const GROUPS: readonly FieldGroup[] = [
  { key: 'core', name: 'Shift details', open: true },
  { key: 'alloc', name: 'Allocation', open: true, tip: 'Where this time is charged.' },
  { key: 'vehicle', name: 'Vehicles & movements', open: false, tip: 'Add a vehicle only if you drove one.' },
  { key: 'driving', name: 'Driving detail', open: false, tip: 'Drive time, period of availability and double-manning.' },
  { key: 'breaks', name: 'Breaks', open: false, tip: 'Add a break only if you took one. It comes off net working hours.' },
  { key: 'extra', name: 'Additional details', open: false, tip: 'Mileage, equipment, checks and handovers.' },
  { key: 'allow', name: 'Allowances', open: true, tip: 'Tick the allowances that apply to this shift.' },
];
/* FIELD_HINTS: the `i` beside a field's label. */
export const FIELD_HINTS: Readonly<Record<string, string>> = {
  start: 'When the shift began.',
  finish: 'When the shift ended. Crossing midnight is fine. The calculation handles it.',
  travel: 'Time spent travelling that counts as working time, entered separately from the shift itself.',
  shift_code: 'Which rota line this day belongs to. It comes from the rota, and premiums can derive from it.',
  project: 'What this time is charged to. Drives cost allocation, not your pay.',
  job_task: 'The activity within the project. The list comes from that project’s own tasks.',
  cost_c: 'Where the cost lands in the ledger. Usually inherited from the location or project.',
  billable: 'Tick when this time can be invoiced to the funder or client.',
  dept: 'Your department. Scopes who can see and approve this timesheet.',
  work_order: 'The job or work-order reference this time belongs to, if your team uses one.',
  site: 'Where the work happened. Rate cards and location checks depend on it.',
  vehicle: 'The vehicle you drove. Add another block only if you changed vehicle.',
  movement: 'Where the vehicle went: start, destinations, return.',
  drive: 'Read-only. Derived from the tachograph or the movements you recorded.',
  poa: 'Waiting time you were on duty but not driving. Counts differently for working-time rules.',
  passenger: 'Tick when you travelled as a second driver rather than driving.',
  codriver: 'Who you were double-manned with, for the working-time record.',
  break_s: 'Unpaid breaks come off net working hours. Add a row only if you took one.',
  mileage: 'Business miles in your own vehicle. Reimbursed separately from hours.',
  training_hours: 'Hours spent on training rather than normal duties.',
  plant: 'Plant or equipment operated, for the site record.',
  ppe: 'Confirm the briefing and PPE check happened before work started.',
  lone_work: 'Confirm your lone-working check-in was completed for this shift.',
  visits: 'How many visits or sessions you completed on this shift.',
  handover: 'What the next person on shift needs to know.',
  client_sign: 'Tick when the client or funder signed off the work.',
  notes: 'Anything your approver should know. Visible to your manager and payroll.',
};
/* The non-working reasons: the leave types the prototype seeds, then Rest day and Other.
   Leave is module 4; until it lands the list is the prototype's. */
export const NON_WORKING_REASONS = ['Annual leave', 'Time off in lieu', 'Sickness', 'Compassionate leave', 'Training leave', 'Unpaid leave',
  'Parental leave', 'Jury service', 'Rest day', 'Other'] as const;

/* --------------------------------------------------------------- fields */
export const BREAK_PAIRS: readonly (readonly [string, string])[] = ['', '2', '3', '4', '5'].map(n => [`break_s${n}`, `break_e${n}`] as const);
export const MAX_BREAKS = BREAK_PAIRS.length;
const isBreak = (code: string) => /^break_[se]\d?$/.test(code);
/* 0 for break_s or break_e, 1 for break_s2, and so on; -1 for anything else */
export const breakIndex = (code: string) => (isBreak(code) ? Math.max(0, Number(code.replace(/^break_[se]/, '') || '1') - 1) : -1);
export const isAllowance = (f: FieldDef) => f.cat === 'Allowance' && Boolean(f.pay);

export interface FormField { def: FieldDef; setting: FieldDefault; hint?: string }
/* The fields this person's type shows, in catalogue order, grouped by GROUPS. */
export function formGroups(c: CaptureSetup): { group: FieldGroup; fields: FormField[] }[] {
  const env = envOf(c), type = typeOf(c);
  return GROUPS.map(group => ({ group, fields: c.fields
    .filter(f => (f.grp || 'core') === group.key && fieldVisible(f, type, env))
    .map(def => ({ def, setting: fieldSettingFor(def, type, env), hint: FIELD_HINTS[def.c] })) }))
    .filter(g => g.fields.length > 0);
}
/* fieldOpts: a select's choices. A rate type lists the pay codes marked as work types. */
export function fieldOptions(def: FieldDef, c: CaptureSetup): { value: string; label: string }[] {
  if (def.c === 'work_type') return c.payCodes.filter(p => p.workType).map(p => ({ value: p.code, label: p.label || p.code }));
  return (def.opts ?? []).map(o => ({ value: o, label: o }));
}

/* ---------------------------------------------------------- form values */
export type FormValues = Record<string, string | boolean>;
const str = (v: string | boolean | undefined) => (typeof v === 'string' ? v : '');

/* A saved day as the form shows it: the first entry's times, breaks and fields, the rota line, the allowances ticked. */
export function valuesFromDay(day: WeekDay | undefined, c: CaptureSetup): FormValues {
  const rec = day?.record, out: FormValues = {};
  if (!rec) return out;
  const e = rec.entries[0];
  if (e) {
    Object.assign(out, e.fields ?? {});
    out.start = e.start;
    out.finish = e.finish;
    e.breaks.forEach((b, i) => { const p = BREAK_PAIRS[i]; if (p) { out[p[0]] = b.start; out[p[1]] = b.end; } });
  }
  if (rec.shift) out.shift_code = rec.shift;
  for (const code of rec.allowances) { const f = c.fields.find(x => isAllowance(x) && x.pay === code); if (f) out[f.c] = true; }
  return out;
}
export const breaksOf = (v: FormValues): BreakInput[] =>
  BREAK_PAIRS.map(([s, e]) => ({ start: str(v[s]).trim(), end: str(v[e]).trim() })).filter(b => b.start || b.end);
/* How many break rows to show: one, or as many as hold a value (applyOptIn). */
export const breaksShown = (v: FormValues) => Math.max(1, ...BREAK_PAIRS.map(([s, e], i) => (str(v[s]) || str(v[e]) ? i + 1 : 0)));

/* The form as the server takes it: one entry, its breaks and fields, the ticked allowances and the rota line. */
export function dayInputFrom(v: FormValues, c: CaptureSetup): DayInput {
  const visible = formGroups(c).flatMap(g => g.fields.map(f => f.def));
  const fields: Record<string, string | boolean> = {};
  const allowances: string[] = [];
  for (const f of visible) {
    const val = v[f.c];
    if (isAllowance(f)) { if (val === true && f.pay) allowances.push(f.pay); continue; }
    if (f.c === 'start' || f.c === 'finish' || f.c === 'shift_code' || isBreak(f.c) || f.input === 'calc') continue;
    if (val === true || (typeof val === 'string' && val.trim())) fields[f.c] = typeof val === 'string' ? val.trim() : val;
  }
  const shift = str(v.shift_code).trim();
  return {
    entries: [{ start: str(v.start).trim(), finish: str(v.finish).trim(), breaks: breaksOf(v), fields }],
    allowances, ...(shift ? { shift } : {}),
  };
}

/* ---------------------------------------------------------- the checks */
export interface Check { field: string; message: string }
export interface LocalCheck { errors: Check[]; warnings: string[]; net: number | null }
/* validateTimes names breaks.N; the form names the break's start field. */
const formFieldOf = (field: string) => {
  const m = /^breaks(?:\.(\d+))?$/.exec(field);
  if (!m) return field;
  return BREAK_PAIRS[Number(m[1] ?? 0)]?.[0] ?? 'break_s';
};
/* validateEntry: mandatory fields first, then the times. Errors block the save; warnings never do. */
export function checkDay(v: FormValues, c: CaptureSetup, date: string, now: Clock): LocalCheck {
  const missing = missingMandatory(c.fields, typeOf(c), envOf(c), v);
  if (missing) return { errors: [{ field: missing.field, message: missing.message }], warnings: [], net: null };
  const r = validateTimes({ start: str(v.start), finish: str(v.finish), breaks: breaksOf(v) },
    { date, now, rules: c.rules, cutoff: c.cutoff, timeFormat: c.timeFormat, rota: rotaFor(c.modules, undefined) });
  const errors = r.errors.map(e => ({ field: formFieldOf(e.field), message: e.message }));
  if (!errors.length && toMin(str(v.start)) == null && toMin(str(v.finish)) == null)
    errors.push({ field: 'start', message: 'Add a start and finish time.' });
  return { errors, warnings: r.warnings, net: r.net };
}
/* validateField: the check a field gets when it loses focus. */
export function checkField(code: string, v: FormValues, c: CaptureSetup): string | null {
  const def = c.fields.find(f => f.c === code);
  const setting = def ? fieldSettingFor(def, typeOf(c), envOf(c)) : undefined;
  return fieldProblem(code, str(v[code]), setting, v);
}
/* The server names a field as the request does (entries.0.start, entries.0.breaks.1); the form field it belongs to. */
export function serverField(code: string): string {
  const i = breakIndex(code);
  return i >= 0 ? `entries.0.breaks.${i}` : `entries.0.${code}`;
}

/* ------------------------------------------------------ the day summary */
export interface DayStats { net: number | null; breaks: number; nBreaks: number; extra: { label: string; value: string }; rate: DerivedRate | null }
/* readDayTimes and renderDaySummary: net working, breaks, one figure the type cares about, and the rate its rules resolve. */
export function dayStats(v: FormValues, c: CaptureSetup, date: string): DayStats {
  const sm = toMin(str(v.start)), fm = toMin(str(v.finish));
  let net: number | null = null, brk = 0, n = 0;
  if (sm != null && fm != null) {
    let worked = fm - sm;
    if (worked < 0) worked += 1440;
    for (const b of breaksOf(v)) {
      const bs = toMin(b.start), be = toMin(b.end);
      if (bs == null || be == null) continue;
      let d = be - bs;
      if (d < 0) d += 1440;
      brk += d; n++;
    }
    net = Math.max(0, worked - brk);
  }
  const visible = new Set(formGroups(c).flatMap(g => g.fields.map(f => f.def.c)));
  const extra = c.capabilities.includes('vehicle')
    ? { label: 'Drive time', value: str(v.drive) || '—' }
    : visible.has('travel')
      ? { label: c.fieldDefaults.travel?.label || 'Travel time', value: str(v.travel) || '—' }
      : (() => { const k = c.fields.filter(f => isAllowance(f) && visible.has(f.c) && v[f.c] === true).length; return { label: 'Allowances claimed', value: k ? String(k) : 'None' }; })();
  const rate = deriveWorkType(c.type?.rules ?? [], { date, start: sm, net, travel: Boolean(str(v.travel)) }, c.rules, c.payCodes);
  return { net, breaks: brk, nBreaks: n, extra, rate };
}
