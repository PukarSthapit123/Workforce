/* Module 2 Timesheet. One record per person per day (brief D1), each with its
   own state and version; the week endpoint aggregates days. Capture rules are
   the server's (D3): the same domain functions run on the client only so the
   form can warn early. No money anywhere (D11): allowances and pay rules carry
   codes, labels, elements, multipliers and thresholds, never an amount.
   `personId` in a path is the person's employee ID (CP-1042, EMP004). */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime, RecordMeta, mutation } from './common';
import { IsoDate } from './people';

export const TsState = z.enum(['draft', 'pend', 'back', 'resub', 'ok']);
export type TsStateKey = z.infer<typeof TsState>;
export const BreakInput = z.object({ start: z.string().max(5), end: z.string().max(5) });
const FieldValue = z.union([z.string().max(500), z.boolean()]);
/* Times as HH:MM. `hours` is the hours-only capture (weekGrid "hours"), read
   only when there are no times. `fields` holds the other capture fields by code. */
export const TimeEntry = z.object({
  start: z.string().max(5), finish: z.string().max(5), breaks: z.array(BreakInput).max(5),
  hours: z.number().min(0).max(24).nullable().optional(), fields: z.record(z.string(), FieldValue).optional(),
});
export type TimeEntry = z.infer<typeof TimeEntry>;
const Actor = z.object({ personCode: z.string(), name: z.string() });
export const TsHistory = z.object({ from: TsState, to: TsState, by: Actor, at: IsoDateTime, reason: z.string() });
export const AttemptState = z.enum(['queued', 'posted', 'failed']);
/* What the approver's dot shows: the last state the server read (D4). */
export const PostingState = z.enum(['none', 'queued', 'posted', 'failed']);

export const TimesheetDay = RecordMeta.extend({
  personCode: z.string(), date: IsoDate, state: TsState, entries: z.array(TimeEntry), workType: z.string(),
  allowances: z.array(z.string()), shift: z.string(), nonWorkingReason: z.string(),
  captureSource: z.enum(['self', 'proxy', 'clock']), enteredBy: z.string(), enteredByName: z.string(),
  submittedAt: z.union([IsoDateTime, z.literal('')]), returnReason: z.string(), warnings: z.array(z.string()),
  history: z.array(TsHistory), integrationAttemptId: z.string(),
  /* "Called in and worked anyway", stored with the day so a later week submit
     or catch-up can tell it from time on an absence day (module 4 D8) */
  workedAnyway: z.boolean().optional(),
  /* derived on every read, never stored */
  minutes: z.number().int().nonnegative(), posting: PostingState,
});
export type TimesheetDay = z.infer<typeof TimesheetDay>;

export const IntegrationAttempt = RecordMeta.extend({
  event: z.string(), ref: z.string(), summary: z.string(), state: AttemptState, attempt: z.number().int().positive(),
  simulated: z.boolean(), dayId: z.string(), at: IsoDateTime, cause: z.string().optional(), reason: z.string().optional(),
});
export type IntegrationAttempt = z.infer<typeof IntegrationAttempt>;

/* ---------------------------------------------------------------- config */
export const CaptureRules = z.object({
  maxDaily: z.number(), warnDaily: z.number(), minNet: z.number(), varianceWarn: z.number(),
  blockFuture: z.boolean(), enforceRest: z.boolean(), enforceLock: z.boolean(),
  otDaily: z.number(), otWeekly: z.number(), nightFrom: z.string(), nightTo: z.string(),
});
export type CaptureRules = z.infer<typeof CaptureRules>;
export const FieldSetting = z.object({ vis: z.boolean(), mand: z.boolean() });
export const FieldDefault = FieldSetting.extend({ label: z.string() });
/* `value` is a multiplier or a threshold (1.5×, 8 h). The server refuses a currency value. */
export const TypeRule = z.object({ trigger: z.string(), when: z.string(), code: z.string(), value: z.string(), how: z.string() });
export const Overtime = z.object({ threshold: z.number(), multiplier: z.number(), weekendMultiplier: z.number() });
export const TypeCapture = z.object({
  fields: z.record(z.string(), FieldSetting), allowances: z.array(z.string()), rules: z.array(TypeRule), overtime: Overtime.nullable(),
});
export type TypeCapture = z.infer<typeof TypeCapture>;
/* Strict, so an allowance sent with an amount is refused rather than stored. */
export const AllowanceDef = z.strictObject({
  code: z.string(), label: z.string(), payCode: z.string(), tier: z.string(), element: z.string().optional(), basis: z.string().optional(),
});
export const WeekGrid = z.enum(['hours', 'times']);
export const WeekLayout = z.enum(['classic', 'grid', 'days']);
export const TimeFormat = z.enum(['HH:MM', 'h m']);
export const TimesheetConfig = RecordMeta.extend({
  rules: CaptureRules, cutoff: z.string(), timeFormat: TimeFormat, returnReasonRequired: z.boolean(),
  weekGrid: WeekGrid, weekLayout: WeekLayout, fieldDefaults: z.record(z.string(), FieldDefault),
  allowances: z.record(z.string(), AllowanceDef), types: z.record(z.string(), TypeCapture),
});
export type TimesheetConfig = z.infer<typeof TimesheetConfig>;
/* One entry of the capture field catalogue (the prototype's FIELDS). */
export const TimesheetField = z.object({
  c: z.string(), tier: z.string(), label: z.string(), cat: z.string(), input: z.string(), grp: z.string(),
  t: z.string().optional(), opts: z.array(z.string()).optional(), val: z.string().optional(), src: z.string().optional(),
  flag: z.string().optional(), mod: z.string().optional(), req: z.string().optional(), driverOnly: z.boolean().optional(),
  repeat: z.string().optional(), seq: z.number().optional(), pay: z.string().optional(),
});
export type TimesheetField = z.infer<typeof TimesheetField>;
/* Read-only here; pay code upkeep is module 6. A flat code's value would be money, so it is blank. */
export const PayCode = z.object({ code: z.string(), basis: z.string(), value: z.string(), element: z.string(), label: z.string(), workType: z.boolean() });
export type PayCode = z.infer<typeof PayCode>;

/* ------------------------------------------------------------------ week */
export const AdvisoryFlag = z.object({ code: z.enum(['long', 'variance', 'rest', 'proxy', 'resub', 'locked']), text: z.string() });
export const Clock = z.object({ date: IsoDate, time: z.string() });
/* One day of the person's published rota (module 3 D13, D14, D16): the shift
   with its times and hours, a rest day (code ''), or leave (V) or sickness (S).
   Present only while the Rota module is on and the person's location week is
   published, amended or republished; a draft or review week shows nothing. */
export const RotaDay = z.object({
  code: z.string(), name: z.string(), from: z.string(), to: z.string(), time: z.string(), hours: z.number().nonnegative(), cross: z.boolean(),
});
export type RotaDay = z.infer<typeof RotaDay>;
/* A clocked day's marks (module 2b): a late first clock in (D5), a forgotten clock closed later (D6). */
export const ClockMark = z.object({ late: z.boolean(), closedLate: z.boolean() });
/* A shift in the tenant's catalogue, offered as the Rota line while the Rota module is on. */
export const RotaLineOption = z.object({ code: z.string(), name: z.string(), from: z.string(), to: z.string() });
/* One of the tenant's open projects with its own tasks: the Project and Job task options (fieldOpts). */
export const OpenProject = z.object({ code: z.string(), name: z.string(), tasks: z.array(z.string()) });
/* Everything the form needs to render this person's capture and to run the
   same checks the server runs: the rules, the clock, and the field inputs to
   fieldVisible, weekModel and missingMandatory. Read from the target person,
   so a proxy grid is the target's form, never the manager's (D6). */
export const CaptureSetup = z.object({
  rules: CaptureRules, cutoff: z.string(), timeFormat: TimeFormat, returnReasonRequired: z.boolean(),
  weekGrid: WeekGrid, weekLayout: WeekLayout, fields: z.array(TimesheetField), type: TypeCapture.nullable(),
  modules: z.record(z.string(), z.boolean()), flags: z.array(z.string()), capabilities: z.array(z.string()),
  fieldDefaults: z.record(z.string(), FieldDefault), allowances: z.array(AllowanceDef), payCodes: z.array(PayCode),
  /* the employee type's entry mode: a grid type opens My timesheet on the week while WEEKLY is on (defaultTsView) */
  mode: z.enum(['form', 'grid', 'clock']),
  /* the tenant's open projects; a Project or Job task value outside them is refused (TS_INVALID) */
  projects: z.array(OpenProject),
  /* the tenant's shift catalogue, the Rota line's options, while the Rota module is on */
  rotaLines: z.array(RotaLineOption).optional(),
});
export type CaptureSetup = z.infer<typeof CaptureSetup>;
export const WeekDay = z.object({
  date: IsoDate, record: TimesheetDay.nullable(), state: z.union([TsState, z.literal('none')]),
  /* the If-Match a write to this day sends: the record's version, or 0 when there is none yet */
  version: z.number().int().nonnegative(), minutes: z.number().int().nonnegative(),
  future: z.boolean(), locked: z.boolean(), lockNote: z.string(), flags: z.array(AdvisoryFlag),
  /* Leave or sickness on the day: a V or S cell on the published rota (module 3),
     or an approved leave request or recorded sickness (module 4 D8, any tenant).
     The day view shows the absence banner when it is set. */
  absence: z.enum(['leave', 'sickness']).nullable().optional(),
  /* the day on the person's published rota; absent with the Rota module off or the week unpublished */
  rota: RotaDay.optional(),
  /* the day was clocked (module 2b): late against the rota line (D5), or a forgotten clock closed later (D6) */
  clock: ClockMark.optional(),
});
export type WeekDay = z.infer<typeof WeekDay>;
export const EarlierWeek = z.object({
  weekStart: IsoDate, label: z.string(), minutes: z.number().int().nonnegative(), status: z.enum(['ready', 'submitted']),
  locked: z.boolean(), lockNote: z.string(),
});
export const TimesheetPerson = z.object({ code: z.string(), name: z.string(), employeeType: z.string(), typeName: z.string(), location: z.string(), manager: z.string(),
  /* the week's contracted line: 0 for bank and zero-hours colleagues */
  contractedHours: z.number().nonnegative() });
export const TimesheetWeek = z.object({
  person: TimesheetPerson, weekStart: IsoDate, label: z.string(), now: Clock, days: z.array(WeekDay),
  weekMinutes: z.number().int().nonnegative(), byAllocation: z.record(z.string(), z.number()),
  capture: CaptureSetup, earlierWeeks: z.array(EarlierWeek),
});
export type TimesheetWeek = z.infer<typeof TimesheetWeek>;

/* ---------------------------------------------------------------- writes */
/* One day as the form sends it. No entries and a reason is a non-working day. */
export const DayInput = z.object({
  entries: z.array(TimeEntry).max(6), allowances: z.array(z.string()).max(20).optional(), shift: z.string().max(10).optional(),
  nonWorkingReason: z.string().max(200).optional(),
  /* "Called in and worked anyway": time on a day of approved leave or sickness is
     accepted while Leave blocks timesheet capture (module 4 D8). */
  workedAnyway: z.boolean().optional(),
});
export type DayInput = z.infer<typeof DayInput>;
export const DaySaved = z.object({ record: TimesheetDay, warnings: z.array(z.string()), auditId: z.string().nullable() });
export type DaySaved = z.infer<typeof DaySaved>;
export const HeldDay = z.object({ date: IsoDate, reason: z.string() });
/* Only the days sent are acted on. Each carries the version it was read at (0
   for a day with no record), as If-Match does for one record. A changed day
   carries its entries; a day sent without entries is submitted as it was read,
   keeping who entered it, and a sent-back day sent that way is held, not resubmitted. */
export const WeekSubmitDay = DayInput.extend({ date: IsoDate, version: z.number().int().nonnegative(), entries: z.array(TimeEntry).max(6).optional() });
export const WeekSubmit = z.object({ days: z.array(WeekSubmitDay).max(7) });
export type WeekSubmit = z.infer<typeof WeekSubmit>;
export const WeekSubmitted = z.object({
  submitted: z.array(TimesheetDay), held: z.array(HeldDay), flagged: z.array(z.string()),
  warnings: z.array(z.object({ date: IsoDate, warnings: z.array(z.string()) })), weekMinutes: z.number().int().nonnegative(),
  auditId: z.string(),
});
export type WeekSubmitted = z.infer<typeof WeekSubmitted>;
export const MultiweekSubmit = z.object({ weeks: z.array(IsoDate).min(1, 'Select at least one week.').max(8) });
export const MultiweekSubmitted = z.object({
  weeks: z.array(z.object({ weekStart: IsoDate, label: z.string(), outcome: z.enum(['submitted', 'held']), reason: z.string(),
    submitted: z.array(TimesheetDay), held: z.array(HeldDay) })),
  /* null when every selected week was held back, so nothing changed */
  auditId: z.string().nullable(),
});
export type MultiweekSubmitted = z.infer<typeof MultiweekSubmitted>;
export const DayTransition = z.object({ to: z.enum(['ok', 'back']), reason: z.string().max(500) });
export const DayDecided = z.object({ record: TimesheetDay, attempt: IntegrationAttempt.nullable(), auditId: z.string() });

/* ----------------------------------------------------------------- queue */
export const QueueStatus = z.enum(['pend', 'all', 'resub', 'ok', 'back']);
/* clock: as WeekDay.clock, for the Late and closed-later pills on a clocked day (module 2b D5, D6) */
export const QueueRow = TimesheetDay.extend({ personName: z.string(), location: z.string(), locationName: z.string(), flags: z.array(AdvisoryFlag),
  clock: ClockMark.optional() });
export type QueueRow = z.infer<typeof QueueRow>;
/* What "approve all" would do, computed by the server over every pending day
   the approver may decide (IMP-008), with the checksum the bulk call returns. */
export const BulkSet = z.object({
  ids: z.array(z.string()), checksum: z.string(), people: z.number().int().nonnegative(), minutes: z.number().int().nonnegative(),
  flagged: z.array(z.object({ id: z.string(), personName: z.string(), date: IsoDate, why: z.array(z.string()) })),
  outside: z.number().int().nonnegative(),
});
export const ApprovalQueue = z.object({
  rows: z.array(QueueRow), nextCursor: z.string().nullable(),
  counts: z.object({ pend: z.number().int(), resub: z.number().int(), ok: z.number().int(), back: z.number().int(), all: z.number().int() }),
  oldestPending: IsoDate.nullable(), bulk: BulkSet,
  /* the server's clock (the matrix opens on its week) and whether a return needs a reason (returnBox) */
  now: Clock, returnReasonRequired: z.boolean(),
  /* On a weekStart read with the Rota module on: each person's published rota
     for the week, Monday first, by person code, for the people in the approver's scope. */
  rota: z.record(z.string(), z.array(RotaDay).length(7)).optional(),
});
export type ApprovalQueue = z.infer<typeof ApprovalQueue>;
export const QueueQuery = z.object({
  status: QueueStatus.optional(), q: z.string().max(100).optional(),
  cursor: z.string().regex(/^\d+$/, 'The cursor is not one this server gave out.').optional(), weekStart: IsoDate.optional(),
});
export const BulkApprove = z.object({ ids: z.array(z.string().min(1)).min(1, 'Choose at least one timesheet.').max(500), checksum: z.string().min(1) });
export const BulkApproved = z.object({
  approved: z.array(TimesheetDay), held: z.array(z.object({ id: z.string(), code: z.string(), reason: z.string() })),
  people: z.number().int().nonnegative(), minutes: z.number().int().nonnegative(), auditId: z.string().nullable(),
});
export type BulkApproved = z.infer<typeof BulkApproved>;

/* ------------------------------------------------------------ setup (mts) */
export const TimesheetSetup = z.object({ config: TimesheetConfig, fields: z.array(TimesheetField), payCodes: z.array(PayCode) });
export type TimesheetSetup = z.infer<typeof TimesheetSetup>;
/* Each key replaces the stored one, except rules (merged) and types (merged by type code). */
export const UpdateTimesheetConfig = z.strictObject({
  rules: CaptureRules.partial().optional(), cutoff: z.string().optional(), timeFormat: TimeFormat.optional(),
  returnReasonRequired: z.boolean().optional(), weekGrid: WeekGrid.optional(), weekLayout: WeekLayout.optional(),
  fieldDefaults: z.record(z.string(), FieldDefault).optional(), allowances: z.record(z.string(), AllowanceDef).optional(),
  types: z.record(z.string(), TypeCapture).optional(),
});
export type UpdateTimesheetConfig = z.infer<typeof UpdateTimesheetConfig>;

const PersonDay = z.object({ personId: z.string().min(1), date: IsoDate });
const PersonWeek = z.object({ personId: z.string().min(1), weekStart: IsoDate });
const PersonOnly = z.object({ personId: z.string().min(1) });
const ById = z.object({ id: z.string().min(1) });

/* No single capability on the person endpoints: your own needs own_ts; anyone
   else's needs team_ts and your location, and a write as proxy needs proxy too. */
export const getTimesheetWeek = defineEndpoint({ method: 'GET', path: '/api/v1/timesheets/:personId/weeks/:weekStart', params: PersonWeek,
  response: TimesheetWeek, errors: [403, 404],
  summary: 'One person\'s week in one call: days, entries, totals, flags, lock and state per day, and their capture setup' });
export const saveTimesheetDay = defineEndpoint({ method: 'PUT', path: '/api/v1/timesheets/:personId/days/:date', params: PersonDay,
  request: DayInput, response: DaySaved, versioned: true, errors: [403, 404, 409],
  summary: 'Save one day as a draft (If-Match: the day\'s version, 0 for a new day). Errors refuse with TS_INVALID or PERIOD_LOCKED; warnings come back.' });
export const submitTimesheetDay = defineEndpoint({ method: 'POST', path: '/api/v1/timesheets/:personId/days/:date/submit', params: PersonDay,
  request: DayInput, response: DaySaved, versioned: true, errors: [403, 404, 409],
  summary: 'Save and submit one day, or correct and resubmit a sent-back day (If-Match). A day already submitted is refused with ALREADY_SUBMITTED.' });
export const submitTimesheetWeek = defineEndpoint({ method: 'POST', path: '/api/v1/timesheets/:personId/weeks/:weekStart/submit', params: PersonWeek,
  request: WeekSubmit, response: WeekSubmitted, errors: [403, 404, 409, 412],
  summary: 'Save and submit a week in one request. Any invalid day refuses the whole week; future and already submitted days are held back with a reason.' });
export const submitMultiweek = defineEndpoint({ method: 'POST', path: '/api/v1/timesheets/:personId/multiweek/submit', params: PersonOnly,
  request: MultiweekSubmit, response: MultiweekSubmitted, errors: [403, 404],
  summary: 'Submit selected earlier weeks. Each week routes separately; a week in a closed period is held back with the lock note.' });
export const transitionTimesheetDay = defineEndpoint({ method: 'POST', path: '/api/v1/timesheet-days/:id/transition', params: ById,
  request: DayTransition, response: DayDecided, capability: 'team_ts', versioned: true, errors: [404, 409],
  summary: 'Approve or return one day (If-Match). Approval queues a posting for Business Central; it never posts.' });
export const listTimesheetApprovals = defineEndpoint({ method: 'GET', path: '/api/v1/approvals/timesheets', query: QueueQuery,
  response: ApprovalQueue, capability: 'team_ts',
  summary: 'The approver\'s queue at their location, cursor-paged. Query: status (pend, all, resub, ok, back), q, cursor, weekStart. A weekStart read returns the whole week in one page. Reading it runs the posting dispatcher.' });
export const bulkApproveTimesheets = defineEndpoint({ method: 'POST', path: '/api/v1/approvals/timesheets/bulk', request: BulkApprove,
  response: BulkApproved, capability: 'team_ts', errors: [409],
  summary: 'Approve the listed days, checked against the checksum of what the approver was shown. Any change since refuses the whole batch (QUEUE_CHANGED).' });
export const getTimesheetConfig = defineEndpoint({ method: 'GET', path: '/api/v1/timesheet-config', response: TimesheetSetup, capability: 'mod_cfg',
  summary: 'Timesheet setup: capture rules, fields per employee type, allowances and pay rules per type, overtime, weekly layout' });
export const updateTimesheetConfig = defineEndpoint({ method: 'PATCH', path: '/api/v1/timesheet-config', request: UpdateTimesheetConfig,
  response: mutation(TimesheetConfig), capability: 'mod_cfg', versioned: true,
  summary: 'Save Timesheet setup (If-Match). It applies to the next save or submission.' });
export const retryIntegrationAttempt = defineEndpoint({ method: 'POST', path: '/api/v1/integration/attempts/:id/retry', params: ById,
  response: mutation(IntegrationAttempt), capability: 'integration', versioned: true, errors: [404, 409],
  summary: 'Re-queue a failed posting (If-Match). The attempt count goes up by one; the dispatcher decides the outcome.' });
