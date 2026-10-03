/* Timesheet rules. Ported from the prototype (qnipay-workforce-v15.html,
   "9a-i. TIMESHEET STATE MACHINE", "9a-ii. CAPTURE RULES + PAY-PERIOD LOCK",
   "RATE DERIVATION", weekModel, readDayTimes, submitWeekGrid, bulkApprovalSet,
   restGap). Every function is pure: the rules, the clock and any rota line come
   in as arguments, so the server refuses with exactly what the client warns
   about (brief D3). Rota-dependent checks run only when the caller passes a rota
   line, which it does only while the Rota module is on (D9). Messages are the
   prototype's, with each em-dash aside rewritten as its own sentence. */
import type { Problem } from './codes';

/* ---------------------------------------------------------------- states (D2) */
export const TS_STATES = ['draft', 'pend', 'back', 'resub', 'ok'] as const;
export type TsState = (typeof TS_STATES)[number];
export type TsTone = 'neu' | 'info' | 'err' | 'ok';
export interface TsStateInfo { label: string; tone: TsTone; glyph: string; next: readonly TsState[] }

export const TS_STATE: Record<TsState, TsStateInfo> = {
  draft: { label: 'Draft', tone: 'neu', glyph: '—', next: ['pend'] },
  pend: { label: 'Awaiting approval', tone: 'info', glyph: '◷', next: ['ok', 'back'] },
  back: { label: 'Sent back', tone: 'err', glyph: '✕', next: ['resub'] },
  resub: { label: 'Resubmitted', tone: 'info', glyph: '↻', next: ['ok', 'back'] },
  ok: { label: 'Approved', tone: 'ok', glyph: '✓', next: [] },
};

export const isTsState = (s: unknown): s is TsState => typeof s === 'string' && (TS_STATES as readonly string[]).includes(s);
/* Unknown states read as draft, as the prototype's tsState does. */
export const tsStateInfo = (s: string): TsStateInfo => (isTsState(s) ? TS_STATE[s] : TS_STATE.draft);
export const tsCan = (from: string, to: string): boolean => isTsState(from) && isTsState(to) && TS_STATE[from].next.includes(to);
/* Awaiting a manager decision: a first submission or a resubmission. */
export const tsPending = (s: string): boolean => s === 'pend' || s === 'resub';

const article = (word: string) => (/^[aeiou]/i.test(word) ? 'An' : 'A');
const listStates = (states: readonly TsState[]) => {
  const labels = states.map(s => TS_STATE[s].label.toLowerCase());
  return labels.length <= 1 ? labels.join('') : `${labels.slice(0, -1).join(', ')} or ${labels.at(-1) ?? ''}`;
};

/* null when the move is allowed. The message is tsTransition's toast. */
export function tsTransitionProblem(from: string, to: string): { message: string; next: string } | null {
  if (tsCan(from, to)) return null;
  const f = tsStateInfo(from), fromWord = f.label.toLowerCase();
  return {
    message: `Not allowed. ${article(fromWord)} ${fromWord} timesheet cannot move to ${tsStateInfo(to).label.toLowerCase()}.`,
    next: f.next.length ? `From ${f.label.toLowerCase()} it can move to ${listStates(f.next)}.` : `${article(fromWord)} ${fromWord} timesheet is final.`,
  };
}

export interface TsActor { personCode: string; name: string }
export interface TsHistoryEntry { from: TsState; to: TsState; by: TsActor; at: string; reason: string }
/* The history row a transition appends; the audit text that goes with it. */
export const historyEntry = (from: TsState, to: TsState, by: TsActor, at: string, reason = ''): TsHistoryEntry =>
  ({ from, to, by, at, reason });
export const transitionAuditText = (personName: string, date: string, from: TsState, to: TsState, reason = '') =>
  `${personName} · ${formatDmy(date)} · ${TS_STATE[from].label} → ${TS_STATE[to].label}${reason ? ` · "${reason}"` : ''}`;

/* ------------------------------------------------------------- time and dates */
export type TimeFormat = 'HH:MM' | 'h m';
/* 'HH:MM' to minutes from midnight. The prototype accepted 25:99; a server must not. */
export function toMin(t: string | null | undefined): number | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(t ?? '').trim());
  if (!m) return null;
  const h = Number(m[1]), mm = Number(m[2]);
  return h < 24 && mm < 60 ? h * 60 + mm : null;
}
const pad = (n: number) => String(n).padStart(2, '0');
/* The prototype's hm(): the tenant's time format decides 07:30 or 7h 30m. */
export function formatMinutes(min: number, fmt: TimeFormat): string {
  const v = Math.max(0, Math.round(min)), h = Math.floor(v / 60), m = v % 60;
  return fmt === 'HH:MM' ? `${pad(h)}:${pad(m)}` : `${h}h ${pad(m)}m`;
}

const DOW_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;
const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
const parseIso = (iso: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : new Date(Number.NaN);
};
const toIso = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDays = (iso: string, n: number) => { const d = parseIso(iso); d.setUTCDate(d.getUTCDate() + n); return toIso(d); };
/* 0 is Monday, 6 is Sunday. */
export const dowMon = (iso: string) => (parseIso(iso).getUTCDay() + 6) % 7;
/* "Thu 13 Aug" */
export const formatDay = (iso: string) => { const d = parseIso(iso); return `${DOW_SHORT[dowMon(iso)] ?? ''} ${d.getUTCDate()} ${MONTH_SHORT[d.getUTCMonth()] ?? ''}`; };
/* "13/08/2026" */
export const formatDmy = (iso: string) => { const d = parseIso(iso); return `${pad(d.getUTCDate())}/${pad(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`; };
export function isoWeek(iso: string): number {
  const j = parseIso(iso), day = (j.getUTCDay() + 6) % 7;
  j.setUTCDate(j.getUTCDate() - day + 3);
  const first = new Date(Date.UTC(j.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((j.getTime() - first.getTime()) / 86400000 - 3 + ((first.getUTCDay() + 6) % 7)) / 7);
}
/* The multi-week card's label: "Week 32 · 03–09 Aug 2026", or across a month "Week 31 · 27 Jul – 02 Aug 2026". */
export function weekLabel(weekStart: string): string {
  const a = parseIso(weekStart), b = parseIso(addDays(weekStart, 6));
  const mon = (d: Date) => MONTH_SHORT[d.getUTCMonth()] ?? '';
  const span = a.getUTCMonth() === b.getUTCMonth()
    ? `${pad(a.getUTCDate())}–${pad(b.getUTCDate())} ${mon(b)}`
    : `${pad(a.getUTCDate())} ${mon(a)} – ${pad(b.getUTCDate())} ${mon(b)}`;
  return `Week ${isoWeek(weekStart)} · ${span} ${b.getUTCFullYear()}`;
}

/* The clock every rule reads: a London date and time. The prototype froze it at 13/08/2026 09:12. */
export interface Clock { date: string; time: string }
const LONDON = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
export function clockFromIso(iso: string): Clock {
  const part = (k: string) => LONDON.formatToParts(new Date(iso)).find(p => p.type === k)?.value ?? '00';
  return { date: `${part('year')}-${part('month')}-${part('day')}`, time: `${part('hour')}:${part('minute')}` };
}

/* ------------------------------------------------------ capture rules and lock */
export interface CaptureRules {
  maxDaily: number; warnDaily: number; minNet: number; varianceWarn: number;
  blockFuture: boolean; enforceRest: boolean; enforceLock: boolean;
  otDaily: number; otWeekly: number; nightFrom: string; nightTo: string;
}
/* The prototype's TS_RULES defaults. */
export const DEFAULT_RULES: CaptureRules = {
  maxDaily: 16, warnDaily: 12, minNet: 0.25, varianceWarn: 2, blockFuture: true, enforceRest: true,
  enforceLock: true, otDaily: 8, otWeekly: 40, nightFrom: '20:00', nightTo: '06:00',
};

const CUTOFF_DAYS: Record<string, number> = { Sunday: 6, Monday: 7, Tuesday: 8, Wednesday: 9, Thursday: 10 };
/* The Monday of the pay week containing the date. */
export const periodStart = (iso: string) => addDays(iso, -dowMon(iso));
/* When the period beginning `weekStart` closes, from the tenant's cut-off ("Monday 12:00"). */
export function cutoffFor(weekStart: string, cutoff: string): { date: string; time: string } {
  const [day = '', time] = String(cutoff || 'Monday 12:00').split(' ');
  return { date: addDays(weekStart, CUTOFF_DAYS[day] ?? 7), time: time || '12:00' };
}
const isPast = (c: { date: string; time: string }, now: Clock) =>
  c.date < now.date || (c.date === now.date && (toMin(c.time) ?? 0) <= (toMin(now.time) ?? 0));
/* A closed period takes no new time. The current and future periods are always open. */
export function periodLocked(iso: string, s: { enforceLock: boolean; cutoff: string }, now: Clock): boolean {
  if (!s.enforceLock) return false;
  const ws = periodStart(iso);
  if (ws >= periodStart(now.date)) return false;
  return isPast(cutoffFor(ws, s.cutoff), now);
}
export function lockNote(iso: string, cutoff: string): string {
  const ws = periodStart(iso), c = cutoffFor(ws, cutoff);
  return `Pay period ${formatDmy(ws)} – ${formatDmy(addDays(ws, 6))} closed at ${cutoff} (${formatDmy(c.date)} ${c.time})`;
}

export interface BreakInput { start: string; end: string }
export interface ReadBreak { n: number; index: number; raw: [string, string]; s: number | null; e: number | null; from: number | null; to: number | null }
/* Break intervals in minutes from midnight, wrapped forward so a night shift's
   breaks sit on the same line as the shift. Rows with neither time are skipped. */
export function readBreaks(breaks: readonly BreakInput[], startMin: number): ReadBreak[] {
  const out: ReadBreak[] = [];
  breaks.forEach((b, index) => {
    const bs = toMin(b.start), be = toMin(b.end);
    if (bs == null && be == null) return;
    out.push({ n: out.length + 1, index, raw: [b.start, b.end], s: bs, e: be,
      from: bs == null ? null : bs < startMin ? bs + 1440 : bs,
      to: be == null ? null : be < startMin ? be + 1440 : be });
  });
  return out;
}

/* A rota line the day is checked against, and the rest check that goes with it. Both only with Rota on (D9). */
export interface RotaLine { code: string; name: string; hours: number; cross: boolean }
export interface RestCheck { gapHours: number; ruleHours: number; typeName: string }
export interface RotaInput { line: RotaLine; rest?: RestCheck }
/* The rota line reaches the checks only while the tenant has the Rota module (R) on.
   Server and client both pass their rota through this, so neither can warn about a
   rota the tenant does not have (D9). */
export const rotaFor = (modules: Record<string, boolean>, rota: RotaInput | undefined): RotaInput | undefined =>
  (modules.R ? rota : undefined);

export interface TimesInput { start: string; finish: string; breaks: readonly BreakInput[] }
export interface CheckContext {
  date: string; now: Clock; rules: CaptureRules; cutoff: string; timeFormat: TimeFormat; rota?: RotaInput;
}
export interface TimesResult { errors: Problem[]; warnings: string[]; net: number | null }

/* The one validation entry point. Errors block a save or a submission (TS_INVALID
   with `field`); warnings travel with the saved record and never block. */
export function validateTimes(input: TimesInput, ctx: CheckContext): TimesResult {
  const errors: Problem[] = [], warnings: string[] = [];
  const { rules, timeFormat } = ctx, hm = (m: number) => formatMinutes(m, timeFormat);
  const sRaw = input.start.trim(), fRaw = input.finish.trim();
  const sm = toMin(sRaw), fm = toMin(fRaw);

  if (rules.blockFuture && ctx.date > ctx.now.date)
    errors.push({ field: 'date', message: `You cannot record time for ${formatDay(ctx.date)}. It is in the future.` });
  if (periodLocked(ctx.date, { enforceLock: rules.enforceLock, cutoff: ctx.cutoff }, ctx.now))
    errors.push({ field: 'date', message: `${lockNote(ctx.date, ctx.cutoff)}. This day can no longer be submitted.` });

  if (sRaw && sm == null) errors.push({ field: 'start', message: 'Start time must be a 24-hour time such as 07:00.' });
  if (fRaw && fm == null) errors.push({ field: 'finish', message: 'Finish time must be a 24-hour time such as 15:00.' });
  if (sm != null && fm == null && fRaw === '') errors.push({ field: 'finish', message: 'Add a finish time.' });
  if (fm != null && sm == null && sRaw === '') errors.push({ field: 'start', message: 'Add a start time.' });
  if (sm == null || fm == null) return { errors, warnings, net: null };

  let span = fm - sm;
  const crossed = span <= 0;
  if (crossed) span += 1440;
  const sched = ctx.rota?.line;
  if (crossed && !sched?.cross)
    warnings.push(`Finish is at or before start, so this is being read as crossing midnight (${(span / 60).toFixed(2)} h).`);

  const brks = readBreaks(input.breaks, sm);
  let brkTotal = 0;
  for (const b of brks) {
    const field = `breaks.${b.index}`;
    if (b.from == null || b.to == null) { errors.push({ field, message: `Break ${b.n} needs both a start and an end.` }); continue; }
    let d = b.to - b.from;
    if (d < 0) d += 1440;
    if (d === 0) { errors.push({ field, message: `Break ${b.n} starts and ends at the same time.` }); continue; }
    if (b.from < sm || b.to > sm + span)
      errors.push({ field, message: `Break ${b.n} (${b.raw[0]}–${b.raw[1]}) falls outside the shift.` });
    brkTotal += d;
  }
  for (let a = 0; a < brks.length; a++) for (let c = a + 1; c < brks.length; c++) {
    const x = brks[a], y = brks[c];
    if (!x || !y || x.from == null || y.from == null || x.to == null || y.to == null) continue;
    if (x.from < y.to && y.from < x.to) errors.push({ field: `breaks.${y.index}`, message: `Breaks ${x.n} and ${y.n} overlap.` });
  }
  if (brkTotal >= span) errors.push({ field: 'breaks', message: `Breaks (${hm(brkTotal)}) are longer than the shift (${hm(span)}).` });

  const net = Math.max(0, span - brkTotal);
  if (!errors.length) {
    if (net / 60 < rules.minNet) errors.push({ field: 'finish', message: `Net time is ${hm(net)}. Record at least ${rules.minNet} h.` });
    if (net / 60 > rules.maxDaily) errors.push({ field: 'finish', message: `Net time is ${hm(net)}, above the ${rules.maxDaily}-hour daily maximum.` });
    else if (net / 60 > rules.warnDaily) warnings.push(`That is ${hm(net)} in one day. It is above the ${rules.warnDaily}-hour review threshold.`);
    if (sched && Math.abs(net / 60 - sched.hours) > rules.varianceWarn)
      warnings.push(`That is ${net / 60 > sched.hours ? '+' : ''}${(net / 60 - sched.hours).toFixed(2)} h against the rota line (${sched.name} ${sched.hours} h).`);
    const rest = ctx.rota?.rest;
    if (rules.enforceRest && sched && rest && rest.gapHours >= 0 && rest.gapHours < rest.ruleHours)
      warnings.push(`Only ${rest.gapHours} h rest against an adjacent shift. The rule for ${rest.typeName} is ${rest.ruleHours} h.`);
  }
  return { errors, warnings, net };
}

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

/* -------------------------------------------------------- mandatory fields */
export interface FieldDef {
  c: string; tier: string; label: string; cat: string; input: string; grp: string;
  t?: string; opts?: readonly string[]; val?: string; src?: string; flag?: string; mod?: string; req?: string;
  driverOnly?: boolean; repeat?: string; seq?: number; pay?: string;
}
export interface FieldSetting { vis: boolean; mand: boolean }
export interface FieldDefault extends FieldSetting { label: string }
export interface TypeRule { trigger: string; when: string; code: string; value: string; how: string }
export interface Overtime { threshold: number; multiplier: number; weekendMultiplier: number }
export interface TypeCapture {
  fields: Record<string, FieldSetting>; allowances: readonly string[]; rules: readonly TypeRule[]; overtime: Overtime | null;
}
/* What decides whether a field is offered: the tenant's modules and flags, the
   type's capabilities (from employee types) and the tenant's field defaults. */
export interface FieldEnv {
  modules: Record<string, boolean>; flagOn: (code: string) => boolean;
  capabilities: readonly string[]; defaults: Record<string, FieldDefault>;
}
const own = <T>(rec: Record<string, T>, k: string): T | undefined => (Object.hasOwn(rec, k) ? rec[k] : undefined);

/* Offered when its module and flag are on, the type holds the capability, and the type's own field map includes it. */
export function fieldActive(f: FieldDef, type: TypeCapture | undefined, env: FieldEnv): boolean {
  if (f.mod && !env.modules[f.mod]) return false;
  if (f.flag && !env.flagOn(f.flag)) return false;
  if (f.driverOnly && !env.capabilities.includes('vehicle')) return false;
  if (f.req && !env.capabilities.includes(f.req)) return false;
  if (!type) return true;
  if (f.cat === 'Allowance' && f.pay) return type.allowances.includes(f.pay);
  return Object.hasOwn(type.fields, f.c);
}
export function fieldVisible(f: FieldDef, type: TypeCapture | undefined, env: FieldEnv): boolean {
  if (!fieldActive(f, type, env)) return false;
  const t = type ? own(type.fields, f.c) : undefined;
  return t ? t.vis : (own(env.defaults, f.c)?.vis ?? true);
}
export function fieldSettingFor(f: FieldDef, type: TypeCapture | undefined, env: FieldEnv): FieldDefault {
  const base = own(env.defaults, f.c) ?? { vis: true, mand: false, label: f.label };
  const t = type ? own(type.fields, f.c) : undefined;
  return t ? { vis: t.vis, mand: t.mand, label: base.label } : base;
}
/* validateForm: every visible mandatory field must be filled before the times are checked. */
export function missingMandatory(fields: readonly FieldDef[], type: TypeCapture | undefined, env: FieldEnv,
  values: Record<string, string | boolean | undefined>): Problem | null {
  const missing = fields.filter(f => {
    if (!fieldVisible(f, type, env) || !fieldSettingFor(f, type, env).mand) return false;
    const v = own(values, f.c);
    return typeof v === 'boolean' ? !v : !v || !v.trim();
  });
  const first = missing[0];
  if (!first) return null;
  return { field: first.c, message: `Submission blocked. Fill in: ${missing.map(f => fieldSettingFor(f, type, env).label).join(', ')}.` };
}
/* validateField: the inline check a field gets when it loses focus. null when it is fine. */
export function fieldProblem(code: string, value: string, setting: FieldDefault | undefined,
  values: Record<string, string | boolean | undefined>): string | null {
  const val = value.trim();
  if (setting?.mand && !val) return `${setting.label || 'This field'} is required.`;
  const other = (c: string) => { const v = own(values, c); return toMin(typeof v === 'string' ? v : ''); };
  if (code === 'finish' && val) {
    const s = other('start'), f = toMin(val);
    if (s != null && f != null && f === s) return 'Finish cannot equal start.';
  }
  if (/^break_e/.test(code) && val) {
    const bs = other(code.replace('_e', '_s')), be = toMin(val);
    if (bs != null && be != null && be < bs) return 'Break end is before its start.';
  }
  return null;
}

/* ----------------------------------------------------------- rate derivation */
/* A base pay code, read-only here (pay code upkeep is module 6). `value` holds a
   multiplier or a unit count; a flat code's value would be money, so it is blank. */
export interface PayCode { code: string; basis: string; value: string; element: string; label: string; workType: boolean }
/* An allowance the employee declares on the day. No amount: the value is Business Central's (D11). */
export interface AllowanceDef { code: string; label: string; payCode: string; tier: string; element?: string; basis?: string }
export const PAY_BASIS = {
  multiplier: { label: 'Multiplier on base rate', unit: '×', hint: 'value × hours × base rate' },
  flat: { label: 'Flat amount per occurrence', unit: '£', hint: 'value posted once per shift claimed' },
  hours: { label: 'Hours at base rate', unit: 'hrs', hint: 'value treated as hours' },
  days: { label: 'Day units', unit: 'days', hint: 'value × day rate' },
  units: { label: 'Units (no value)', unit: '—', hint: 'posted as a marker, e.g. absence' },
} as const;
export type PayBasis = keyof typeof PAY_BASIS;
const baseCode = (codes: readonly PayCode[], c: string) => codes.find(x => x.code === c);
const hasAllowance = (lib: Record<string, AllowanceDef>, c: string) => Object.hasOwn(lib, c);
export const payLabel = (codes: readonly PayCode[], c: string) => baseCode(codes, c)?.label || c;
export const payElement = (codes: readonly PayCode[], lib: Record<string, AllowanceDef>, c: string) =>
  baseCode(codes, c)?.element ?? (hasAllowance(lib, c) ? (lib[c]?.element || `PE-${c.split('_')[0] ?? c}`) : '—');
export const payBasisOf = (codes: readonly PayCode[], lib: Record<string, AllowanceDef>, c: string): string =>
  baseCode(codes, c)?.basis ?? (hasAllowance(lib, c) ? (lib[c]?.basis || 'flat') : 'units');
export const payCodeList = (codes: readonly PayCode[], lib: Record<string, AllowanceDef>) => [...codes.map(x => x.code), ...Object.keys(lib)];

export interface RateContext { date: string; start: number | null; net: number | null; travel: boolean }
type RateSettings = Pick<CaptureRules, 'nightFrom' | 'nightTo' | 'otDaily'>;
/* `when` is the trigger the engine matches; a rule's `trigger` is the sentence a person reads. */
export const RATE_TRIGGERS: Record<string, { label: string; test: (c: RateContext, s: RateSettings) => boolean }> = {
  sat: { label: 'Saturday', test: c => dowMon(c.date) === 5 },
  sun: { label: 'Sunday', test: c => dowMon(c.date) === 6 },
  night: { label: 'night window', test: (c, s) => c.start != null
    && (c.start >= (toMin(s.nightFrom || '20:00') ?? 1200) || c.start < (toMin(s.nightTo || '06:00') ?? 360)) },
  travel: { label: 'travel recorded', test: c => c.travel },
  over_daily: { label: 'over the daily threshold', test: (c, s) => c.net != null && c.net / 60 > (s.otDaily || 8) },
  /* the prototype has no calendar behind this trigger, so it never matches */
  bh: { label: 'bank holiday', test: () => false },
  else: { label: 'everything else', test: () => true },
};
export interface DerivedRate { code: string; label: string; rule: string; when: string; why: string }
/* First matching rule wins; `else` is the fallback. null when the type has no usable rules. */
export function deriveWorkType(rules: readonly TypeRule[], ctx: RateContext, settings: RateSettings, codes: readonly PayCode[]): DerivedRate | null {
  const usable = rules.filter(r => r.when && Object.hasOwn(RATE_TRIGGERS, r.when));
  if (!usable.length) return null;
  for (const r of usable) {
    if (r.when === 'else') continue;
    if (RATE_TRIGGERS[r.when]?.test(ctx, settings)) {
      const label = payLabel(codes, r.code);
      return { code: r.code, label, rule: r.trigger, when: r.when, why: `${r.trigger}. ${label} applied automatically.` };
    }
  }
  const fallback = usable.find(r => r.when === 'else');
  if (!fallback) return null;
  const label = payLabel(codes, fallback.code);
  return { code: fallback.code, label, rule: fallback.trigger, when: 'else', why: `No premium trigger matched. ${label} applied.` };
}

/* ------------------------------------------------------------- week totals */
export interface TimeEntry {
  start: string; finish: string; breaks: readonly BreakInput[];
  /* hours-only capture (weekGrid "hours"): used when there are no times */
  hours?: number | null;
  fields?: Record<string, string | boolean>;
}
export interface DayEntries { date: string; entries: readonly TimeEntry[] }
/* readDayTimes: worked time less complete breaks, never below zero. */
export function entryMinutes(e: TimeEntry): number {
  const sm = toMin(e.start), fm = toMin(e.finish);
  if (sm == null || fm == null) return e.hours != null && Number.isFinite(e.hours) ? Math.max(0, Math.round(e.hours * 60)) : 0;
  let worked = fm - sm;
  if (worked < 0) worked += 1440;
  let brk = 0;
  for (const b of e.breaks) {
    const bs = toMin(b.start), be = toMin(b.end);
    if (bs == null || be == null) continue;
    let d = be - bs;
    if (d < 0) d += 1440;
    brk += d;
  }
  return Math.max(0, worked - brk);
}
export const dayMinutes = (entries: readonly TimeEntry[]) => entries.reduce((a, e) => a + entryMinutes(e), 0);
export const weekDates = (weekStart: string) => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
/* Per-day minutes, minutes per allocation (the first allocation field that has a value) and the week total. */
export function weekTotals(weekStart: string, days: readonly DayEntries[], allocationFields: readonly string[] = []) {
  const dates = weekDates(weekStart);
  const dayMin = dates.map(() => 0), byAllocation: Record<string, number> = {};
  for (const d of days) {
    const i = dates.indexOf(d.date);
    if (i < 0) continue;
    for (const e of d.entries) {
      const m = entryMinutes(e);
      dayMin[i] = (dayMin[i] ?? 0) + m;
      const key = allocationFields.map(f => e.fields?.[f]).find((v): v is string => typeof v === 'string' && v !== '');
      if (key && m) byAllocation[key] = (byAllocation[key] ?? 0) + m;
    }
  }
  return { dates, dayMinutes: dayMin, byAllocation, weekMinutes: dayMin.reduce((a, b) => a + b, 0) };
}

/* ------------------------------------------------------------ weekly layout */
export const WEEK_GRIDS = ['hours', 'times'] as const;
export type WeekGrid = (typeof WEEK_GRIDS)[number];
export const WEEK_LAYOUTS = ['classic', 'grid', 'days'] as const;
export type WeekLayout = (typeof WEEK_LAYOUTS)[number];
export const WEEK_LAYOUT_LABEL: Record<WeekLayout, string> = {
  classic: 'Classic · allocation in the first column',
  grid: 'Grid · allocation as a section header',
  days: 'List · one row per day',
};
export const WEEK_GRID_LABEL: Record<WeekGrid, string> = { hours: 'Captures total hours', times: 'Captures start & finish' };
/* A phone gets the day list whatever the tenant configured (renderWeekGrid). */
export const weekLayoutFor = (layout: WeekLayout, narrow: boolean): WeekLayout => (narrow ? 'days' : layout);
export interface AllocationField { c: string; label: string; opts: readonly string[] }
export interface WeekModel { ctx: AllocationField[]; hasTime: boolean; multi: boolean; times: boolean }
/* weekModel: which allocation selects the week grid carries, and whether it captures times or hours. */
export function weekModel(fields: readonly FieldDef[], type: TypeCapture | undefined, env: FieldEnv, weekGrid: WeekGrid): WeekModel {
  const ctx: AllocationField[] = [];
  let hasTime = false;
  for (const f of fields) {
    if (!fieldVisible(f, type, env)) continue;
    if (f.cat === 'Time') { hasTime = true; continue; }
    if (f.input === 'calc') continue;
    if (f.input === 'select' && (f.cat === 'Project' || f.cat === 'Location'))
      ctx.push({ c: f.c, label: fieldSettingFor(f, type, env).label, opts: f.opts ?? [] });
  }
  return { ctx, hasTime, multi: ctx.length > 0, times: weekGrid === 'times' };
}
export const NO_TIME_FIELDS = 'No time fields are enabled for this employee type. Turn Start or Finish back on under Timesheet setup.';

/* submitWeekGrid's per-day check, before anything is written: a future day is
   held back rather than blocking the week; a closed period or an impossible total blocks it. */
export type WeekDayOutcome = { kind: 'empty' } | { kind: 'held'; reason: string } | { kind: 'blocked'; reason: string } | { kind: 'ready' };
export const NOTHING_TO_SUBMIT = 'Nothing to submit. No hours are entered on this week.';
export function weekDayOutcome(date: string, minutes: number, ctx: Omit<CheckContext, 'date' | 'rota'>): WeekDayOutcome {
  const { rules } = ctx, hm = (m: number) => formatMinutes(m, ctx.timeFormat);
  if (!minutes) return { kind: 'empty' };
  if (rules.blockFuture && date > ctx.now.date)
    return { kind: 'held', reason: `${formatDay(date)} is in the future, so it is held back until it happens.` };
  if (periodLocked(date, { enforceLock: rules.enforceLock, cutoff: ctx.cutoff }, ctx.now))
    return { kind: 'blocked', reason: `${formatDay(date)}: ${lockNote(date, ctx.cutoff)}.` };
  if (minutes / 60 > rules.maxDaily)
    return { kind: 'blocked', reason: `${formatDay(date)} records ${hm(minutes)}, above the ${rules.maxDaily}-hour daily maximum.` };
  if (minutes / 60 < rules.minNet) return { kind: 'blocked', reason: `${formatDay(date)} records only ${hm(minutes)}.` };
  return { kind: 'ready' };
}

/* The one-request week submission (brief Review Focus 3), planned before anything
   is written. Any blocked day refuses the whole week, so a week is never part
   submitted around an invalid day. A future day, or a day already with the approver
   or decided, is held back with its reason and the rest go ahead. A saved draft
   moves draft to pend; a sent-back day is corrected and moves back to resub. */
export interface WeekDayInput {
  date: string; minutes: number;
  /* the day's record state, when there is one */
  state?: TsState | null;
  /* validateTimes errors for the day's entries */
  errors?: readonly Problem[];
  /* true when the request left the day's entries as they were read: a sent-back day is then not resubmitted unchanged */
  unchanged?: boolean;
}
export interface HeldDay { date: string; reason: string }
export interface WeekPlan { blocked: string[]; submit: string[]; resubmit: string[]; held: HeldDay[]; flagged: string[] }
export function planWeekSubmit(days: readonly WeekDayInput[], ctx: Omit<CheckContext, 'date' | 'rota'>): WeekPlan {
  const plan: WeekPlan = { blocked: [], submit: [], resubmit: [], held: [], flagged: [] };
  for (const d of days) {
    if (!d.minutes) continue;
    if (d.state && d.state !== 'draft' && d.state !== 'back') {
      plan.held.push({ date: d.date, reason: `${formatDay(d.date)} is already ${TS_STATE[d.state].label.toLowerCase()}, so it was left alone.` });
      continue;
    }
    if (d.state === 'back' && d.unchanged) { plan.held.push({ date: d.date, reason: sentBackUnchanged(d.date) }); continue; }
    const o = weekDayOutcome(d.date, d.minutes, ctx);
    if (o.kind === 'held') { plan.held.push({ date: d.date, reason: o.reason }); continue; }
    if (o.kind === 'blocked') { plan.blocked.push(o.reason); continue; }
    if (d.errors?.length) { plan.blocked.push(...d.errors.map(e => `${formatDay(d.date)}: ${e.message}`)); continue; }
    (d.state === 'back' ? plan.resubmit : plan.submit).push(d.date);
    if (d.minutes / 60 > ctx.rules.warnDaily) plan.flagged.push(`${formatDay(d.date)} ${formatMinutes(d.minutes, ctx.timeFormat)}`);
  }
  return plan;
}
export const sentBackUnchanged = (date: string) => `${formatDay(date)} was sent back and has not been corrected, so it was left alone.`;
export const weekBlockedMessage = (blocked: readonly string[]) => `Submission blocked. ${blocked.join(' ')}`;
export const allSubmittedMessage = (manager: string) => `Already submitted. Every day on this week is with ${manager} or decided.`;
/* A second submission of a day that already has one (D8's ALREADY_SUBMITTED). */
export const alreadySubmittedMessage = (date: string, state: string) =>
  `You already have an entry for ${formatDmy(date)}. It is ${tsStateInfo(state).label.toLowerCase()}.`;
/* confirm-return: the tenant decides whether a reason is required (TENANT.returnReason). */
export const returnReasonProblem = (reason: string, required: boolean): Problem | null =>
  (required && !reason.trim() ? { field: 'reason', message: 'A reason is required.' } : null);

/* ---------------------------------------------------------- advisory flags */
/* Why a row is flagged for the approver (GUIDES.tteam and bulkApprovalSet). Never blocks. */
export type FlagCode = 'long' | 'variance' | 'rest' | 'proxy' | 'resub' | 'locked';
export interface AdvisoryFlag { code: FlagCode; text: string }
export interface FlagInput { date: string; minutes: number; state: string; captureSource: 'self' | 'proxy' }
export function advisoryFlags(day: FlagInput, ctx: Omit<CheckContext, 'date'>): AdvisoryFlag[] {
  const { rules } = ctx, out: AdvisoryFlag[] = [];
  if (day.minutes / 60 > rules.warnDaily) out.push({ code: 'long', text: `${formatMinutes(day.minutes, ctx.timeFormat)} in one day` });
  const line = ctx.rota?.line;
  if (line && Math.abs(day.minutes / 60 - line.hours) > rules.varianceWarn) {
    const diff = day.minutes / 60 - line.hours;
    out.push({ code: 'variance', text: `${diff > 0 ? '+' : ''}${diff.toFixed(2)} h against the rota line` });
  }
  const rest = ctx.rota?.rest;
  if (rules.enforceRest && line && rest && rest.gapHours >= 0 && rest.gapHours < rest.ruleHours)
    out.push({ code: 'rest', text: `only ${rest.gapHours} h rest against an adjacent shift` });
  if (day.state === 'resub') out.push({ code: 'resub', text: 'resubmitted after correction' });
  if (day.captureSource === 'proxy') out.push({ code: 'proxy', text: 'entered by a manager as proxy' });
  if (periodLocked(day.date, { enforceLock: rules.enforceLock, cutoff: ctx.cutoff }, ctx.now)) out.push({ code: 'locked', text: 'pay period closed' });
  return out;
}

/* ---------------------------------------------------- integration attempts (D4) */
/* Approval never posts: it queues an attempt, and only the dispatcher resolves one.
   An unresolved `cause` (a data fault) fails every time, so a retry re-queues and
   fails again, as a real retry would. */
export const ATTEMPT_STATES = ['queued', 'posted', 'failed'] as const;
export type AttemptState = (typeof ATTEMPT_STATES)[number];
export interface IntegrationAttemptCore { state: AttemptState; attempt: number; cause?: string; reason?: string }
export const queuedAttempt = (cause?: string): IntegrationAttemptCore =>
  (cause ? { state: 'queued', attempt: 1, cause } : { state: 'queued', attempt: 1 });
/* dispatchInt: a queued attempt resolves to posted (simulated) or, with a cause, failed. Anything else is left as it is. */
export function dispatchAttempt<T extends IntegrationAttemptCore>(a: T): T {
  if (a.state !== 'queued') return a;
  if (a.cause) return { ...a, state: 'failed', reason: a.cause };
  const out: T = { ...a, state: 'posted' };
  delete out.reason;
  return out;
}
/* data-retry: only a failed attempt is re-queued, and the count goes up by one. */
export function retryProblem(a: IntegrationAttemptCore): { message: string; next: string } | null {
  if (a.state === 'failed') return null;
  return a.state === 'queued'
    ? { message: 'This posting is already queued.', next: 'Wait for the dispatcher to resolve it.' }
    : { message: 'This posting has already been posted.', next: 'Nothing needs retrying.' };
}
export const retryAttempt = <T extends IntegrationAttemptCore>(a: T): T => ({ ...a, state: 'queued', attempt: a.attempt + 1 });
export const retryAuditText = (ref: string, attempt: number) => `${ref} · attempt ${attempt}`;
export const retryToast = (attempt: number) => `Re-queued. Attempt ${attempt} is waiting on Business Central.`;
export const APPROVAL_AUDIT_SUFFIX = 'queued for Business Central';
/* The posting dot on the approver's queue: the prototype's four tooltips, verbatim. */
export type PostingDot = AttemptState | 'none';
export const POSTING_DOT: Record<PostingDot, { tone: 'success' | 'warning' | 'error' | 'hollow'; text: string }> = {
  posted: { tone: 'success', text: 'Posted (simulated) · not a Business Central confirmation' },
  queued: { tone: 'warning', text: 'Queued for Business Central · no result yet' },
  failed: { tone: 'error', text: 'Posting failed · see Integrations → Business Central' },
  none: { tone: 'hollow', text: 'Front-end estimate · not sent yet' },
};

/* ------------------------------------------------------ bulk approval (D7) */
/* A checksum of the rows the approver was shown: id, state and version, in id order.
   The server recomputes it and refuses the batch (409 QUEUE_CHANGED) when any row
   has moved since. FNV-1a, run twice for 64 bits; it only has to notice a change. */
export interface QueueRow { id: string; state: string; version: number }
export function queueChecksum(rows: readonly QueueRow[]): string {
  const text = [...rows].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)).map(r => `${r.id}:${r.state}:${r.version}`).join('|');
  const run = (offset: number) => {
    let h = offset;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  return run(0x811c9dc5) + run(0x01000193);
}

/* ---------------------------------------------------- setup (D11, D12) */
/* What Timesheet setup may hold. Checked by the server on every save, so a
   config that the capture rules could not run on is never stored. Rule values
   are multipliers and thresholds; an amount belongs to Business Central. */
export interface ConfigInput {
  rules: CaptureRules; cutoff: string; allowances: Record<string, AllowanceDef>; types: Record<string, TypeCapture>;
}
export interface ConfigContext { employeeTypes: readonly string[]; payCodes: readonly string[] }
const CURRENCY = /[£$€]/;
export const CUTOFF_PATTERN = /^(Sunday|Monday|Tuesday|Wednesday|Thursday) (\d{2}:\d{2})$/;
export function timesheetConfigProblem(c: ConfigInput, ctx: ConfigContext): Problem | null {
  const r = c.rules;
  const bad = (field: string, message: string): Problem => ({ field, message });
  if (!(r.maxDaily > 0 && r.maxDaily <= 24)) return bad('rules.maxDaily', 'The daily maximum must be more than 0 and at most 24 hours.');
  if (!(r.warnDaily > 0 && r.warnDaily <= r.maxDaily)) return bad('rules.warnDaily', 'The review threshold must be more than 0 and no higher than the daily maximum.');
  if (!(r.minNet >= 0 && r.minNet < r.maxDaily)) return bad('rules.minNet', 'The minimum net time must be 0 or more and below the daily maximum.');
  if (!(r.varianceWarn >= 0)) return bad('rules.varianceWarn', 'The rota variance must be 0 or more hours.');
  if (!(r.otDaily > 0 && r.otDaily <= 24)) return bad('rules.otDaily', 'The daily overtime threshold must be more than 0 and at most 24 hours.');
  if (!(r.otWeekly > 0 && r.otWeekly <= 168)) return bad('rules.otWeekly', 'The weekly overtime threshold must be more than 0 and at most 168 hours.');
  if (toMin(r.nightFrom) == null) return bad('rules.nightFrom', 'The night window must start at a 24-hour time such as 20:00.');
  if (toMin(r.nightTo) == null) return bad('rules.nightTo', 'The night window must end at a 24-hour time such as 06:00.');
  const cut = CUTOFF_PATTERN.exec(c.cutoff);
  if (!cut || toMin(cut[2]) == null) return bad('cutoff', 'The cut-off must be a day from Sunday to Thursday and a 24-hour time, such as Monday 12:00.');
  for (const [key, a] of Object.entries(c.allowances)) {
    if (a.code !== key) return bad(`allowances.${key}.code`, `The allowance stored as ${key} must have the code ${key}.`);
    if (!a.label.trim()) return bad(`allowances.${key}.label`, 'Give the allowance a label.');
    if (CURRENCY.test(a.label)) return bad(`allowances.${key}.label`, 'An allowance label names the allowance, never an amount. Business Central holds the rates.');
  }
  const payable = (code: string) => ctx.payCodes.includes(code) || Object.hasOwn(c.allowances, code);
  for (const [code, t] of Object.entries(c.types)) {
    if (!ctx.employeeTypes.includes(code)) return bad(`types.${code}`, `There is no employee type with the code ${code}.`);
    const unknown = t.allowances.find(a => !payable(a));
    if (unknown) return bad(`types.${code}.allowances`, `${unknown} is neither an allowance nor a pay code.`);
    for (const [i, rule] of t.rules.entries()) {
      const at = `types.${code}.rules.${i}`;
      if (rule.when && !Object.hasOwn(RATE_TRIGGERS, rule.when)) return bad(`${at}.when`, 'Choose a trigger from the list.');
      if (!payable(rule.code)) return bad(`${at}.code`, `${rule.code} is not a pay code.`);
      if (CURRENCY.test(rule.value)) return bad(`${at}.value`, 'A rule value is a multiplier or a threshold, never an amount. Business Central holds the rates.');
    }
    const ot = t.overtime;
    if (ot && !(ot.threshold > 0 && ot.threshold <= 168)) return bad(`types.${code}.overtime.threshold`, 'The overtime threshold must be more than 0 and at most 168 hours.');
    if (ot && !(ot.multiplier >= 1 && ot.weekendMultiplier >= 1)) return bad(`types.${code}.overtime.multiplier`, 'An overtime multiplier must be at least 1.');
  }
  return null;
}
