/* Module 6 group 4: Payroll readiness (integration, as the prototype gates
   ipay). The period is Organisation's (Tenant.company: pay frequency, week
   ending day, first pay date; brief P3); its lock and cut-off are Timesheet
   setup's. The readiness is derived on every read, at every location, from
   what is stored: the timesheet days in the period and the published rota
   behind them (./rota, ./leave), the postings for those days and the batch
   postings, the exceptions as the exception centre derives them now
   (./exceptions), the rota profiles' clearance and the people's Business
   Central resource numbers. Nothing is written on a read; approval and
   posting are unchanged (P5). The run for a period is stored in payrollRuns
   the first time someone exports it; each move checks If-Match against it
   (version 0 before then) and writes one audit row. A refusal or a fault
   writes nothing, because serve() restores the store. No money (P1). */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { people, personByCode, recordAt, today, type Signed, type StoredPerson } from './world';
import { hoursRulesFor, rotaDayOn } from './rota';
import { leaveAbsenceOn } from './leave';
import { exceptionsEverywhere } from './exceptions';
import {
  exportPayroll, getPayrollReadiness, reconcilePayroll, reopenPayroll, type PayrollReadiness, type PayrollRun,
} from '@/contract/payroll';
import type { IntegrationAttempt, TimesheetDay } from '@/contract/timesheets';
import type { RecordMeta } from '@/contract/common';
import {
  RUN_AUDIT, RUN_TO, inPeriod, payPeriodOn, payrollCsv, payrollFileName, periodDates, periodLock, periodOfRun, previousPeriod, readinessItems,
  readinessState, runIdOf, runMoveProblem, runToast, type ApprovedDay, type PayPeriod, type PaySettings, type ReadinessFacts, type RunMove,
  type RunRefusal,
} from '@/domain/payroll';
import { dayStatus, minutesToHours } from '@/domain/hours';
import { needsAction } from '@/domain/exceptions';
import { isActive } from '@/domain/rota';
import { dayMinutes, tsLabel } from '@/domain/timesheet';
import { clockFromIso } from '@/domain/time';

type StoredDay = Omit<TimesheetDay, 'minutes' | 'posting' | 'waitingOn' | 'enteredByName'>;
interface TenantRecord { company: PaySettings; modules: Record<string, boolean> }
interface TsConfig { rules: { enforceLock: boolean }; cutoff: string }
interface StoredLocation { code: string; active?: boolean }
interface StoredPayCode { code: string; element: string }

const runs = () => store.coll<PayrollRun>('payrollRuns');
function tenant(): TenantRecord {
  const t = recordAt(store.coll<TenantRecord>('tenant'), 'tenant');
  if (!t) throw new Error('the store has no tenant record');
  return t;
}
function tsConfig(): TsConfig {
  const c = recordAt(store.coll<TsConfig>('timesheetConfig'), 'timesheetConfig');
  if (!c) throw new Error('the store has no timesheet config');
  return c;
}
const settings = () => tenant().company;
const lockRules = () => { const c = tsConfig(); return { enforceLock: c.rules.enforceLock, cutoff: c.cutoff }; };
const nowClock = () => clockFromIso(store.now());
const refuseWith = (r: RunRefusal): never =>
  refuse(r.status, { code: r.code, message: r.message, next: r.next, ...(r.field ? { field: r.field } : {}) });

/* ------------------------------------------------------------ the facts */
const daysIn = (p: PayPeriod) => Object.values(store.coll<StoredDay>('timesheetDays')).filter(d => inPeriod(p, d.date));
const attemptsIn = (p: PayPeriod) => {
  const days = store.coll<StoredDay>('timesheetDays');
  /* a posting is its day's period's; a batch posting (no day) is every period's */
  return Object.values(store.coll<IntegrationAttempt>('integrationAttempts')).filter(a => {
    const d = a.dayId ? recordAt(days, a.dayId) : undefined;
    return d ? inPeriod(p, d.date) : !a.dayId;
  });
};
const activeLocations = () => new Set(Object.values(store.coll<StoredLocation>('locations')).filter(l => l.active !== false).map(l => l.code));
/* P's missing timesheets: a day before today the published rota scheduled, with nothing recorded and no leave or sickness. Rota off: none. */
function missingIn(p: PayPeriod, days: readonly StoredDay[]): number {
  if (!tenant().modules.R) return 0;
  const now = today(), at = activeLocations(), dates = periodDates(p).filter(d => d < now);
  return Object.values(people()).filter(x => isActive(x) && at.has(x.location)).reduce((n, x) => n + dates.filter(date => {
    const r = rotaDayOn(x.code, date), d = days.find(y => y.personCode === x.code && y.date === date);
    return dayStatus({ cell: r?.code ?? '', absence: leaveAbsenceOn(x.code, date), state: d?.state ?? null, scheduled: r?.hours ?? 0, future: false }).kind === 'missing';
  }).length, 0);
}
function factsFor(p: PayPeriod): ReadinessFacts {
  const days = daysIn(p), attempts = attemptsIn(p), now = today();
  const count = (...states: string[]) => days.filter(d => states.includes(d.state)).length;
  const exc = exceptionsEverywhere().filter(x => needsAction(x.state));
  const codesWith = (f: (d: StoredDay) => boolean) => new Set(days.filter(f).map(d => d.personCode));
  const recorded = codesWith(d => dayMinutes(d.entries) > 0), crossing = codesWith(d => d.state !== 'draft');
  const person = (code: string): StoredPerson[] => { const x = personByCode(code); return x ? [x] : []; };
  return {
    unanchored: !payPeriodOn(p.start, settings()).anchored,
    missing: missingIn(p, days),
    awaiting: count('pend', 'resub'), back: count('back'), mgrok: count('mgrok'),
    drafts: days.filter(d => d.state === 'draft' && d.date < now && dayMinutes(d.entries) > 0).length,
    failed: attempts.filter(a => a.state === 'failed').length, queued: attempts.filter(a => a.state === 'queued').length,
    posted: attempts.filter(a => a.state === 'posted').length,
    critical: exc.filter(x => x.severity >= 4).length, lowerExceptions: exc.filter(x => x.severity < 4).length,
    uncleared: [...recorded].flatMap(person).filter(x => !hoursRulesFor(x).worker.cleared).length,
    noResource: [...crossing].flatMap(person).filter(x => !x.resource.trim()).length,
  };
}

/* ------------------------------------------------------------- the views */
const blankRun = (p: PayPeriod): PayrollRun => ({ id: runIdOf(p), version: 0, updatedAt: store.now(), periodStart: p.start, periodEnd: p.end,
  state: 'open', exported: null, reconciled: null, history: [] });
const runOf = (p: PayPeriod) => recordAt(runs(), runIdOf(p)) ?? blankRun(p);
function readinessOf(p: PayPeriod) {
  const run = runOf(p), f = factsFor(p), { blockers, warnings } = readinessItems(f, run.state);
  return { run, f, blockers, warnings, state: readinessState(run.state, blockers.length, warnings.length) };
}
function readinessView(p: PayPeriod): PayrollReadiness {
  const s = settings(), rules = lockRules(), now = nowClock(), prev = previousPeriod(p, s), r = readinessOf(p);
  return {
    period: { start: p.start, end: p.end, frequency: p.frequency, anchored: p.anchored, closesAt: periodLock(p, rules, now).closesAt },
    previous: { start: prev.start, end: prev.end, ...periodLock(prev, rules, now) },
    cutoff: rules.cutoff, enforced: rules.enforceLock,
    state: r.state, blockers: r.blockers, warnings: r.warnings,
    figures: { missing: r.f.missing, awaiting: r.f.awaiting + r.f.back + r.f.mgrok, failed: r.f.failed, exceptions: r.f.critical + r.f.lowerExceptions },
    run: r.run,
  };
}

/* The period's approved days, as the file lists them: hours and codes, no amount. */
const POSTING: Readonly<Record<string, string>> = { queued: 'Queued', posted: 'Posted', failed: 'Failed' };
function approvedDays(p: PayPeriod): ApprovedDay[] {
  const attempts = store.coll<IntegrationAttempt>('integrationAttempts'), codes = Object.values(store.coll<StoredPayCode>('payCodes'));
  return daysIn(p).filter(d => d.state === 'ok').sort((a, b) => a.date.localeCompare(b.date) || a.personCode.localeCompare(b.personCode)).map(d => {
    const x = personByCode(d.personCode), a = d.integrationAttemptId ? recordAt(attempts, d.integrationAttemptId) : undefined;
    return { personCode: d.personCode, name: x?.name ?? d.personCode, resource: x?.resource ?? '', date: d.date, shift: d.shift, payCode: d.workType,
      element: codes.find(c => c.code === d.workType)?.element ?? '', allowances: d.allowances, hours: minutesToHours(dayMinutes(d.entries)),
      state: tsLabel(d.state), posting: (a && POSTING[a.state]) ?? 'Not sent' };
  });
}

/* ------------------------------------------------------------- the moves */
/* The period a run id names under the current settings, if it has started. */
function periodFor(id: string): PayPeriod {
  const p = periodOfRun(id, settings());
  return p && p.start <= today() ? p : refuse(404, { code: 'not-found', message: 'That pay period does not exist under the current pay frequency.',
    next: 'Reload Payroll readiness to see the current period.' });
}
function move(m: RunMove, s: Signed, id: string, reason: string, checkVersion: (r: RecordMeta) => void) {
  const p = periodFor(id), r = readinessOf(p);
  checkVersion(r.run);
  const days = m === 'export' ? approvedDays(p) : [];
  const problem = runMoveProblem(r.run.state, m, { reason, state: r.state, rows: days.length });
  if (problem) return refuseWith(problem);
  const w = actor(s), by = { personCode: w.personCode, name: w.name }, at = store.now(), to = RUN_TO[m];
  const fileName = payrollFileName(p), rows = m === 'export' ? days.length : null;
  const step = { from: r.run.state, to, by, at, rows, reason: m === 'reopen' ? reason.trim() : '' };
  const changes: Partial<PayrollRun> = {
    state: to, history: [...r.run.history, step],
    ...(m === 'export' ? { exported: { at, by, rows: days.length, fileName } } : {}),
    ...(m === 'reconcile' ? { reconciled: { at, by } } : {}),
    ...(m === 'reopen' ? { exported: null, reconciled: null } : {}),
  };
  const saved: PayrollRun = r.run.version ? bump(r.run, changes) : { ...r.run, ...changes, version: 1, updatedAt: at };
  runs()[saved.id] = saved;
  const auditId = writeAudit({ who: w, act: RUN_AUDIT[m], entity: 'payrollRun', entityId: saved.id,
    before: { state: r.run.state },
    after: { state: to, period: `${p.start} to ${p.end}`, ...(m === 'export' ? { rows: days.length, fileName } : {}),
      ...(m === 'reconcile' ? { posted: r.f.posted } : {}), ...(m === 'reopen' ? { reason: step.reason } : {}) } });
  return { run: saved, auditId, message: runToast(m, days.length, fileName), days, fileName };
}

export const payrollHandlers = [
  serve(getPayrollReadiness, () => readinessView(payPeriodOn(today(), settings()))),
  serve(exportPayroll, ({ session, params, checkVersion }) => {
    const { days, ...out } = move('export', session, params.id, '', checkVersion);
    return { ...out, rows: payrollCsv(days), count: days.length };
  }),
  serve(reconcilePayroll, ({ session, params, checkVersion }) => {
    const { run, auditId, message } = move('reconcile', session, params.id, '', checkVersion);
    return { run, auditId, message };
  }),
  serve(reopenPayroll, ({ session, params, body, checkVersion }) => {
    const { run, auditId, message } = move('reopen', session, params.id, body.reason, checkVersion);
    return { run, auditId, message };
  }),
];
