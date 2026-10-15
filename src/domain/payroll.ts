/* Module 6 group 4: Payroll readiness, the prototype's payrollReadiness,
   PAY_STATES and admPayroll (qnipay-workforce-v15.html:9782-9910) with the
   payroll-export, payroll-reconcile and payroll-reset actions (12474-12503).
   Pure: the server gathers the facts, this turns them into one answer.

   - The pay period comes from Organisation's pay frequency, week ending day
     and first pay date (brief P3), not the prototype's fixed week. Weekly,
     fortnightly and four-weekly periods end on the week ending day; the
     fortnightly and four-weekly cycle is anchored on the period paid on the
     first pay date, the one ending on the last week ending day on or before
     it (pay in arrears). A monthly period is the calendar month.
   - The previous period's lock is the Timesheet cut-off's (module 8): it is
     closed once the cut-off for the timesheet week holding its last day has
     passed, and only while the lock is enforced.
   - The states are P's, less LOCKED, which P defines and never produces.
     A stored run per period records EXPORTED and RECONCILED, which P kept
     in memory only.
   No money (P1): the file carries hours and pay codes, never an amount. */
import { addDays, daysBetween, dowMon, formatDmy, isIsoDate, parseIso, toIso, type Clock } from './time';
import { cutoffFor, periodLocked } from './timesheet';

/* ------------------------------------------------------------ the period */
export const PAY_FREQUENCIES = ['Weekly', 'Fortnightly', 'Four-weekly', 'Monthly'] as const;
export type PayFrequency = (typeof PAY_FREQUENCIES)[number];
export const WEEK_ENDINGS = ['Sunday', 'Saturday', 'Friday'] as const;
const WEEKDAY: Readonly<Record<string, number>> = { Monday: 0, Tuesday: 1, Wednesday: 2, Thursday: 3, Friday: 4, Saturday: 5, Sunday: 6 };
const DAYS: Readonly<Record<Exclude<PayFrequency, 'Monthly'>, number>> = { Weekly: 7, Fortnightly: 14, 'Four-weekly': 28 };
export const payFrequency = (s: string): PayFrequency => PAY_FREQUENCIES.find(f => f === s) ?? 'Weekly';

/* Organisation's settings, as Tenant.company holds them */
export interface PaySettings { payFrequency: string; weekEnding: string; firstPayDate: string }
export interface PayPeriod {
  start: string; end: string; frequency: PayFrequency;
  /* false: a fortnightly or four-weekly cycle with no first pay date to anchor it, so it is counted from this week */
  anchored: boolean;
}

/* The week ending day on or after `iso`. */
function weekEndFrom(iso: string, weekEnding: string): string {
  const we = WEEKDAY[weekEnding] ?? 6;
  return addDays(iso, (we - dowMon(iso) + 7) % 7);
}
/* The week ending day on or before `iso`. */
function weekEndBefore(iso: string, weekEnding: string): string {
  const we = WEEKDAY[weekEnding] ?? 6;
  return addDays(iso, -((dowMon(iso) - we + 7) % 7));
}
const monthEnd = (iso: string) => { const d = parseIso(iso); return toIso(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0))); };

/* The pay period `date` falls in. */
export function payPeriodOn(date: string, s: PaySettings): PayPeriod {
  const frequency = payFrequency(s.payFrequency);
  if (frequency === 'Monthly') return { start: `${date.slice(0, 7)}-01`, end: monthEnd(date), frequency, anchored: true };
  const length = DAYS[frequency], weeks = length / 7, end = weekEndFrom(date, s.weekEnding);
  const anchored = weeks === 1 || isIsoDate(s.firstPayDate);
  /* period ends fall on anchor + n × length; the first at or after this week's end is this period's */
  const anchor = anchored && weeks > 1 ? weekEndBefore(s.firstPayDate, s.weekEnding) : end;
  const k = daysBetween(anchor, end) / 7, r = ((k % weeks) + weeks) % weeks;
  const periodEnd = addDays(end, ((weeks - r) % weeks) * 7);
  return { start: addDays(periodEnd, 1 - length), end: periodEnd, frequency, anchored };
}
export const previousPeriod = (p: PayPeriod, s: PaySettings) => payPeriodOn(addDays(p.start, -1), s);
export const periodDates = (p: { start: string; end: string }) =>
  Array.from({ length: daysBetween(p.start, p.end) + 1 }, (_, i) => addDays(p.start, i));
export const periodLabel = (p: { start: string; end: string }) => `${formatDmy(p.start)} – ${formatDmy(p.end)}`;
export const inPeriod = (p: { start: string; end: string }, date: string) => date >= p.start && date <= p.end;

/* The run's id is its period's first day; a day that is not one under the current settings names no period. */
export const runIdOf = (p: { start: string }) => `run_${p.start}`;
export function periodOfRun(id: string, s: PaySettings): PayPeriod | null {
  const start = /^run_(\d{4}-\d{2}-\d{2})$/.exec(id)?.[1];
  if (!start || !isIsoDate(start)) return null;
  const p = payPeriodOn(start, s);
  return p.start === start ? p : null;
}

/* ----------------------------------------------------- the lock and cut-off */
export interface LockRules { enforceLock: boolean; cutoff: string }
export interface PeriodLock { locked: boolean; closesAt: { date: string; time: string } }
/* When the period closes and whether it has: the Timesheet cut-off for the
   timesheet week holding its last day. Never closed while the lock is not enforced. */
export function periodLock(p: { end: string }, rules: LockRules, now: Clock): PeriodLock {
  return { locked: periodLocked(p.end, rules, now), closesAt: cutoffFor(p.end, rules.cutoff) };
}

/* -------------------------------------------------------- the readiness */
export const PAYROLL_STATES = ['notready', 'warnings', 'ready', 'exported', 'reconciled'] as const;
export type PayrollState = (typeof PAYROLL_STATES)[number];
export type StateTone = 'err' | 'warn' | 'ok' | 'info';
/* P's PAY_STATES, less LOCKED. The glyph is P's, as the banner shows it. */
export const PAY_STATES: Readonly<Record<PayrollState, { label: string; tone: StateTone }>> = {
  notready: { label: 'NOT READY', tone: 'err' },
  warnings: { label: 'READY WITH WARNINGS', tone: 'warn' },
  ready: { label: 'READY', tone: 'ok' },
  exported: { label: 'EXPORTED', tone: 'info' },
  reconciled: { label: 'RECONCILED', tone: 'ok' },
};

export const RUN_STATES = ['open', 'exported', 'reconciled'] as const;
export type RunState = (typeof RUN_STATES)[number];

/* What the server counts for the period, at every location. */
export interface ReadinessFacts {
  /* settings: a fortnightly or four-weekly cycle with no first pay date */
  unanchored: boolean;
  /* days before today the published rota scheduled with nothing recorded and no leave or sickness */
  missing: number;
  /* days not finally approved: awaiting a decision (pend, resub), sent back (back), and approved by the manager and waiting on payroll (mgrok) */
  awaiting: number; back: number; mgrok: number;
  /* days before today with time recorded and not yet submitted */
  drafts: number;
  /* postings for the period's days, and batch postings, by state */
  failed: number; queued: number; posted: number;
  /* open exceptions (open, in progress, reopened) by severity */
  critical: number; lowerExceptions: number;
  /* colleagues not cleared to work who recorded hours in the period */
  uncleared: number;
  /* colleagues with days in the period past draft and no Business Central resource number (P5: a blocker only) */
  noResource: number;
}
export const NO_FACTS: ReadinessFacts = Object.freeze({
  unanchored: false, missing: 0, awaiting: 0, back: 0, mgrok: 0, drafts: 0, failed: 0, queued: 0, posted: 0, critical: 0, lowerExceptions: 0,
  uncleared: 0, noResource: 0,
});

export const READINESS_KEYS = ['settings', 'missing', 'awaiting', 'back', 'mgrok', 'failed', 'critical', 'compliance', 'resource',
  'queued', 'unreconciled', 'exceptions', 'drafts'] as const;
export type ReadinessKey = (typeof READINESS_KEYS)[number];
/* `go` is the view the item is put right on, as P's data-go names it */
export interface ReadinessItem { key: ReadinessKey; label: string; count: number; text: string; go: string }

const n = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
export function readinessItems(f: ReadinessFacts, run: RunState): { blockers: ReadinessItem[]; warnings: ReadinessItem[] } {
  const blockers: ReadinessItem[] = [], warnings: ReadinessItem[] = [];
  const add = (to: ReadinessItem[], key: ReadinessKey, label: string, count: number, text: string, go: string) => {
    if (count > 0) to.push({ key, label, count, text, go });
  };
  add(blockers, 'settings', 'Pay periods', f.unanchored ? 1 : 0,
    'There is no first pay date, so the period is counted from this week. Set it on Organisation.', 'aorg');
  add(blockers, 'missing', 'Missing timesheets', f.missing, `${n(f.missing, 'rota’d day')} in the past with no hours recorded`, 'tteam');
  add(blockers, 'awaiting', 'Pending approvals', f.awaiting, `${n(f.awaiting, 'timesheet day')} awaiting a manager decision, resubmissions included`, 'tteam');
  add(blockers, 'back', 'Sent back', f.back, `${n(f.back, 'timesheet day')} sent back and not yet resubmitted`, 'tteam');
  add(blockers, 'mgrok', 'Waiting on payroll', f.mgrok, `${n(f.mgrok, 'timesheet day')} approved by the manager and waiting on the payroll layer`, 'tteam');
  add(blockers, 'failed', 'Posting failures', f.failed, `${n(f.failed, 'posting')} failed and not yet re-queued successfully`, 'ibc');
  add(blockers, 'critical', 'Critical exceptions', f.critical, `${n(f.critical, 'unresolved exception')} at the highest severity`, 'texc');
  add(blockers, 'compliance', 'Compliance', f.uncleared, `${n(f.uncleared, 'colleague')} recorded hours while not cleared to work`, 'temployees');
  add(blockers, 'resource', 'No resource number', f.noResource,
    `${n(f.noResource, 'colleague')} with hours in this period ${f.noResource === 1 ? 'has' : 'have'} no Business Central resource number`, 'aemployees');
  add(warnings, 'queued', 'Postings in flight', f.queued, `${n(f.queued, 'posting')} queued and not yet resolved`, 'ibc');
  if (run !== 'reconciled') add(warnings, 'unreconciled', 'Unreconciled', f.posted, `${n(f.posted, 'posted record')} not yet reconciled against Business Central`, 'ibc');
  add(warnings, 'exceptions', 'Open exceptions', f.lowerExceptions, `${n(f.lowerExceptions, 'open exception')} below critical`, 'texc');
  add(warnings, 'drafts', 'Not submitted', f.drafts, `${n(f.drafts, 'past day')} with time recorded and not yet submitted`, 'tteam');
  return { blockers, warnings };
}
/* P's order: what has happened first, then what is in the way. */
export function readinessState(run: RunState, blockers: number, warnings: number): PayrollState {
  if (run === 'reconciled') return 'reconciled';
  if (run === 'exported') return 'exported';
  if (blockers) return 'notready';
  return warnings ? 'warnings' : 'ready';
}
export function bannerText(state: PayrollState, blockers: number, warnings: number, exported?: { at: string; by: string }): string {
  switch (state) {
    case 'notready': return `${n(blockers, 'item')} must be cleared before this period can be handed over.`;
    case 'warnings': return `Nothing is blocking the handover, but ${n(warnings, 'item')} should be reviewed first.`;
    case 'exported': return `Exported ${exported?.at ?? ''} by ${exported?.by ?? ''}. Awaiting reconciliation against Business Central.`;
    case 'reconciled': return 'Reconciled against Business Central. This period is closed.';
    case 'ready': return 'No blockers and no warnings. This period can be handed to payroll.';
  }
}

/* ---------------------------------------------------------- the run's moves */
export const RUN_MOVES = ['export', 'reconcile', 'reopen'] as const;
export type RunMove = (typeof RUN_MOVES)[number];
const MOVE_FROM: Readonly<Record<RunMove, readonly RunState[]>> = { export: ['open'], reconcile: ['exported'], reopen: ['exported', 'reconciled'] };
export const RUN_TO: Readonly<Record<RunMove, RunState>> = { export: 'exported', reconcile: 'reconciled', reopen: 'open' };
export const canMove = (from: RunState, m: RunMove) => MOVE_FROM[m].includes(from);

export interface RunRefusal { status: 409 | 422; code: string; message: string; next: string; field?: string }
const ILLEGAL: Readonly<Record<RunMove, (from: RunState) => RunRefusal>> = {
  export: from => ({ status: 409, code: 'ILLEGAL_TRANSITION', message: `This period is already ${from}.`, next: 'Reopen the period to export it again.' }),
  reconcile: from => ({ status: 409, code: 'ILLEGAL_TRANSITION',
    message: from === 'open' ? 'Export before reconciling.' : 'This period is already reconciled.',
    next: from === 'open' ? 'Export the approved hours first.' : 'Reopen the period to change it.' }),
  reopen: () => ({ status: 409, code: 'ILLEGAL_TRANSITION', message: 'This period is already open.', next: 'Nothing to reopen.' }),
};
export const NOT_READY: RunRefusal = { status: 409, code: 'NOT_READY', message: 'Clear the blockers before exporting.',
  next: 'Open each blocker and put it right, then export again.' };
export const NOTHING_APPROVED: RunRefusal = { status: 409, code: 'NOTHING_APPROVED', message: 'Nothing approved to export for this period.',
  next: 'Approve the period’s timesheets first.' };
export const REASON_REQUIRED: RunRefusal = { status: 422, code: 'invalid', field: 'reason', message: 'A reason for reopening is required.',
  next: 'Say why the period is being reopened.' };
/* What stops a move from `from`, in order: an illegal transition, then a missing reason, then the readiness. */
export function runMoveProblem(from: RunState, m: RunMove, o: { reason?: string; state?: PayrollState; rows?: number } = {}): RunRefusal | null {
  if (!canMove(from, m)) return ILLEGAL[m](from);
  if (m === 'reopen' && !(o.reason ?? '').trim()) return REASON_REQUIRED;
  if (m === 'export' && o.state === 'notready') return NOT_READY;
  if (m === 'export' && o.rows === 0) return NOTHING_APPROVED;
  return null;
}
export const RUN_AUDIT: Readonly<Record<RunMove, string>> = { export: 'Payroll exported', reconcile: 'Payroll reconciled', reopen: 'Payroll period reopened' };
export const runToast = (m: RunMove, rows = 0, fileName = '') =>
  m === 'export' ? `Exported · ${n(rows, 'approved record')} · ${fileName}`
    : m === 'reconcile' ? 'Reconciled · recorded against the period and the audit log' : 'Period reopened · readiness recalculated';

/* ------------------------------------------------------------- the file */
/* P's columns, with the pay code beside the element: hours and codes only, no amount (P1). */
export const PAYROLL_CSV_HEADER = ['Employee ID', 'Name', 'Resource no.', 'Date', 'Shift', 'Pay code', 'Pay elements', 'Allowances', 'Hours', 'State', 'Integration'];
export interface ApprovedDay {
  employeeCode: string; name: string; resource: string; date: string; shift: string; payCode: string; element: string;
  allowances: readonly string[]; hours: number; state: string; posting: string;
}
export const payrollCsv = (days: readonly ApprovedDay[]): (string | number)[][] => [PAYROLL_CSV_HEADER,
  ...days.map(d => [d.employeeCode, d.name, d.resource, formatDmy(d.date), d.shift, d.payCode, d.element, d.allowances.join(' '), d.hours, d.state, d.posting])];
export const payrollFileName = (p: { start: string }) => `qnipay-payroll-${formatDmy(p.start, 'dd/mm/yyyy').replace(/\//g, '-')}.csv`;
