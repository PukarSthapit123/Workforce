/* Module 6 group 4: Payroll readiness (integration, as the prototype's
   SETUP_NEED gates ipay). The readiness is derived on every read from the
   period Organisation's settings give (brief P3) and the data as it stands,
   at every location. The run for a period is stored once someone acts on it:
   its state and its history of exports, reconciliations and reopenings. Each
   move is its own endpoint, versioned on the run (a period nobody has acted
   on is version 0), with one audit row. The export returns the file's rows:
   hours and pay codes only, no amount (P1). */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime, RecordMeta } from './common';
import { IsoDate } from './people';

export const PayrollState = z.enum(['notready', 'warnings', 'ready', 'exported', 'reconciled']);
export const RunState = z.enum(['open', 'exported', 'reconciled']);
export const ReadinessKey = z.enum(['settings', 'missing', 'awaiting', 'back', 'mgrok', 'failed', 'critical', 'compliance', 'resource',
  'queued', 'unreconciled', 'exceptions', 'drafts']);
const Who = z.object({ personCode: z.string(), name: z.string() });
const When = z.object({ date: IsoDate, time: z.string() });

export const RunStep = z.object({
  from: RunState, to: RunState, by: Who, at: IsoDateTime,
  /* an export: the rows in its file; a reopening: why */
  rows: z.number().int().nonnegative().nullable(), reason: z.string(),
});
export const PayrollRun = RecordMeta.extend({
  periodStart: IsoDate, periodEnd: IsoDate, state: RunState,
  exported: z.object({ at: IsoDateTime, by: Who, rows: z.number().int().nonnegative(), fileName: z.string() }).nullable(),
  reconciled: z.object({ at: IsoDateTime, by: Who }).nullable(),
  history: z.array(RunStep),
});
export type PayrollRun = z.infer<typeof PayrollRun>;

/* `go`: the view the item is put right on */
export const ReadinessItem = z.object({ key: ReadinessKey, label: z.string(), count: z.number().int().positive(), text: z.string(), go: z.string() });
export const PayrollReadiness = z.object({
  period: z.object({ start: IsoDate, end: IsoDate, frequency: z.string(), anchored: z.boolean(), closesAt: When }),
  previous: z.object({ start: IsoDate, end: IsoDate, locked: z.boolean(), closesAt: When }),
  /* the Timesheet cut-off, and whether the period lock is enforced */
  cutoff: z.string(), enforced: z.boolean(),
  state: PayrollState, blockers: z.array(ReadinessItem), warnings: z.array(ReadinessItem),
  /* P's four figures: missing days, days not finally approved, failed postings, open exceptions */
  figures: z.object({ missing: z.number().int(), awaiting: z.number().int(), failed: z.number().int(), exceptions: z.number().int() }),
  run: PayrollRun,
});
export type PayrollReadiness = z.infer<typeof PayrollReadiness>;

export const ReopenRun = z.strictObject({ reason: z.string().max(500) });
export type ReopenRun = z.infer<typeof ReopenRun>;
export const RunMoved = z.object({ run: PayrollRun, auditId: z.string(), message: z.string() });
export type RunMoved = z.infer<typeof RunMoved>;
/* rows: the file, its header first; count: the approved days in it */
export const PayrollExported = RunMoved.extend({
  fileName: z.string(), rows: z.array(z.array(z.union([z.string(), z.number()]))), count: z.number().int().nonnegative(),
});
export type PayrollExported = z.infer<typeof PayrollExported>;

const RunParams = z.object({ id: z.string().min(1).max(40) });
const CAP = 'integration';
export const getPayrollReadiness = defineEndpoint({ method: 'GET', path: '/api/v1/payroll/readiness', response: PayrollReadiness, capability: CAP,
  summary: 'The current pay period (from Organisation\'s pay frequency, week ending day and first pay date), the previous period\'s lock and the Timesheet cut-off, and whether the period can be handed to payroll: the state, the blockers and the warnings, at every location, with the period\'s run.' });
export const exportPayroll = defineEndpoint({ method: 'POST', path: '/api/v1/payroll/runs/:id/export', params: RunParams, response: PayrollExported,
  capability: CAP, versioned: true, errors: [404, 409],
  summary: 'Export the period\'s approved hours (If-Match on the run): the rows of a CSV, hours and pay codes only, no amount. Refused with NOT_READY while blockers remain, NOTHING_APPROVED when no day is approved, and ILLEGAL_TRANSITION unless the run is open. One audit row naming the file and its row count.' });
export const reconcilePayroll = defineEndpoint({ method: 'POST', path: '/api/v1/payroll/runs/:id/reconcile', params: RunParams, response: RunMoved,
  capability: CAP, versioned: true, errors: [404, 409],
  summary: 'Mark the period reconciled against Business Central (If-Match). From EXPORTED only; otherwise ILLEGAL_TRANSITION. One audit row.' });
export const reopenPayroll = defineEndpoint({ method: 'POST', path: '/api/v1/payroll/runs/:id/reopen', params: RunParams, request: ReopenRun,
  response: RunMoved, capability: CAP, versioned: true, errors: [404, 409],
  summary: 'Reopen an exported or reconciled period with a reason (If-Match); without one, 422 on reason. Readiness is computed again. One audit row.' });
