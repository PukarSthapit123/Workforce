/* Module 4 Leave. A request is one record (brief D1), versioned on its own;
   cancel, approve and decline carry If-Match on it. Entitlement and balance
   are derived on the server from the policy, the employee record and the leave
   records, never stored as counters (D3). Sickness is an episode (D9). Every
   rule is the group 1 domain's (src/domain/leave.ts); the screens run the same
   rules only to warn early. No money anywhere (D13): days and hours only.
   With the Leave module off every endpoint refuses (module-off). */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime, RecordMeta, mutation } from './common';
import { IsoDate } from './employees';
import { BANK_HOLIDAY_HANDLING, LEAVE_METHODS } from '@/domain/leave';

const Actor = z.object({ employeeCode: z.string(), name: z.string() });
const AtOrBlank = z.union([IsoDateTime, z.literal('')]);
const DateOrBlank = z.union([IsoDate, z.literal('')]);
const Tone = z.enum(['warn', 'ok', 'err', 'neu']);
const Option = z.object({ code: z.string(), name: z.string() });

export const LeaveState = z.enum(['pending', 'approved', 'declined', 'cancelled']);
export type LeaveState = z.infer<typeof LeaveState>;
export const LeavePart = z.enum(['full', 'am', 'pm', 'hours']);
export type LeavePart = z.infer<typeof LeavePart>;
export const BalanceUnit = z.enum(['days', 'hours']);
export const LeaveUnit = z.enum(['days', 'hours', 'weeks']);
export const LeaveMethod = z.enum(LEAVE_METHODS);
export const ServiceRule = z.object({ afterYears: z.number(), add: z.number(), cap: z.number() });

/* ----------------------------------------------------------- the request */
/* layer: the approval chain role an approval was made as (module 8 group 4B). A layer that
   is not the last is a move from pending to pending: the request still waits on the next. */
export const LeaveMove = z.object({ from: z.string(), to: z.string(), by: Actor, at: IsoDateTime, reason: z.string(), layer: z.string().optional() });
export const LeaveRequestRecord = RecordMeta.extend({
  employeeCode: z.string(), type: z.string(), from: IsoDate, to: IsoDate, part: LeavePart, qty: z.number(), unit: BalanceUnit, state: LeaveState,
  raisedAt: IsoDateTime, note: z.string(),
  /* the effect on cover worked out when it was sent, and whether it drops a day below the minimum */
  impact: z.string(), short: z.boolean(), escalated: z.boolean(),
  decidedAt: AtOrBlank, decidedBy: Actor.nullable(),
  /* the decline reason the colleague sees; '' otherwise */
  reason: z.string(), history: z.array(LeaveMove),
});
export type LeaveRequestRecord = z.infer<typeof LeaveRequestRecord>;
/* As My requests lists it: the type's name, "24/08/2026 – 28/08/2026", "5 days", and the state pill.
   A request one layer of the approval chain has approved and a later one has still
   to reads "Approved by the line manager, waiting on the Service Manager" (module 8). */
export const LeaveRequestView = LeaveRequestRecord.extend({
  typeName: z.string(), range: z.string(), qtyText: z.string(), stateLabel: z.string(), tone: Tone, glyph: z.string(),
});
export type LeaveRequestView = z.infer<typeof LeaveRequestView>;

/* ------------------------------------------------- entitlement and balance */
export const CalcLine = z.object({ label: z.string(), value: z.string() });
export const LeavePolicy = z.object({
  code: z.string(), name: z.string(), method: LeaveMethod, unit: LeaveUnit, base: z.number(), serviceRules: z.array(ServiceRule),
  prorata: z.boolean(), carry: z.number(), approval: z.boolean(), sla: z.number().int().nullable(),
  bankHolidayHandling: z.enum(BANK_HOLIDAY_HANDLING),
});
export type LeavePolicy = z.infer<typeof LeavePolicy>;
/* The traceable calculation ("How this was worked out"). */
export const EntitlementView = z.object({ days: z.number(), hours: z.number(), years: z.number().int(), policy: LeavePolicy, lines: z.array(CalcLine) });
export type EntitlementView = z.infer<typeof EntitlementView>;
/* Days and hours, with pending already held back. toil is the TOIL bank in hours. text: "13.5 of 25 days left". */
export const BalanceView = z.object({
  unit: BalanceUnit, takenD: z.number(), takenH: z.number(), pending: z.number(), pendingH: z.number(), leftD: z.number(), leftH: z.number(),
  toil: z.number(), toilPending: z.number(), toilLeft: z.number(), toilBy: DateOrBlank, text: z.string(),
});
export type BalanceView = z.infer<typeof BalanceView>;
export const LedgerView = z.object({
  id: z.string(), date: IsoDate, type: z.string(), qty: z.number(), unit: BalanceUnit, why: z.string(), counts: z.boolean(),
  /* the leave days a give-back returned */
  dates: z.array(IsoDate).optional(),
  /* "+24 days", "-2 days" */
  qtyText: z.string(),
});
export type LedgerView = z.infer<typeof LedgerView>;
export const LeaveYear = z.object({ start: IsoDate, end: IsoDate, label: z.string() });
/* A request form option: what the type draws on (typeBalanceText), and whether it needs evidence (upload is not built). */
export const LeaveTypeOption = z.object({ code: z.string(), name: z.string(), unit: LeaveUnit, hint: z.string(), evidence: z.boolean() });
export type LeaveTypeOption = z.infer<typeof LeaveTypeOption>;
/* The facts the entitlement comes from, for the client-side "Simulate an hours change" (it writes nothing, D3). */
export const LeaveFacts = z.object({ contractedHours: z.number(), start: DateOrBlank, accruedHours: z.number().optional() });

export const MyLeave = z.object({
  employee: z.object({ code: z.string(), name: z.string(), manager: z.string(), employeeType: z.string() }),
  today: IsoDate, year: LeaveYear, entitlement: EntitlementView, balance: BalanceView, facts: LeaveFacts,
  /* the next leave year and the annual leave days left in it, so the request form checks leave booked there against that year */
  nextYear: LeaveYear.extend({ leftD: z.number() }),
  /* "13.5 days to take by 31/03/2027 · 6 hours TOIL expires 30/09/2026", or '' with nothing left */
  daysToTake: z.string(),
  types: z.array(LeaveTypeOption),
  /* newest first */
  requests: z.array(LeaveRequestView), ledger: z.array(LedgerView),
  /* "You can change or cancel up to 7 days before it starts." */
  cancelTip: z.string(),
  /* escalateTo: who a request goes to once the SLA is breached (the request form's banner) */
  rules: z.object({ entitlement: z.boolean(), toil: z.boolean(), toilMax: z.number(), toilWindow: z.number().int(), slaDays: z.number().int(), escalateTo: z.string() }),
});
export type MyLeave = z.infer<typeof MyLeave>;

/* ------------------------------------------------------------- requesting */
export const RequestLeave = z.object({
  type: z.string().min(1).max(10), from: z.string().max(10), to: z.string().max(10), part: z.string().max(10), note: z.string().max(200).optional(),
});
export type RequestLeave = z.infer<typeof RequestLeave>;
/* hint: "8.5 days would remain", or the shape's note. summary: the toast. */
export const LeaveRequested = z.object({ record: LeaveRequestView, hint: z.string(), summary: z.string(), auditId: z.string() });
export type LeaveRequested = z.infer<typeof LeaveRequested>;
export const LeaveMoved = z.object({ record: LeaveRequestView, summary: z.string(), auditId: z.string() });
export type LeaveMoved = z.infer<typeof LeaveMoved>;
/* What reaching the rota did (D7): cells written, the weeks they were in, and the cover requests opened. */
export const RotaEffect = z.object({ written: z.number().int(), weeks: z.array(z.string()), amended: z.boolean(), covers: z.array(z.string()) });
export type RotaEffect = z.infer<typeof RotaEffect>;
export const LeaveDecided = LeaveMoved.extend({ rota: RotaEffect });
export type LeaveDecided = z.infer<typeof LeaveDecided>;
export const DeclineLeave = z.object({ reason: z.string().max(300) });

/* ------------------------------------------------------------ team leave */
export const TeamRequestView = LeaveRequestView.extend({
  name: z.string(), location: z.string(), balance: z.string(),
  sla: z.object({ daysLeft: z.number().int(), escalated: z.boolean(), tone: z.enum(['warn', 'err']), text: z.string() }),
  stage: z.object({ n: z.number().int(), text: z.string(), action: z.string() }),
  /* the approval chain layer the reader decides (module 8 group 4B): n of the layers this
     request needs, its role, and who approved the layers before it. text is shown once
     the request needs more than one layer. */
  layer: z.object({ n: z.number().int(), of: z.number().int(), role: z.string(), text: z.string() }),
  /* minNotice and cancelWindow advise the approver; they never block (D6) */
  advisories: z.array(z.string()),
});
export type TeamRequestView = z.infer<typeof TeamRequestView>;
export const LeaveStage = z.object({ n: z.number().int(), who: z.string(), action: z.string(), wait: z.number().int(), channel: z.string() });
export type LeaveStage = z.infer<typeof LeaveStage>;
export const TeamRequestsQuery = z.object({ q: z.string().max(80).optional(), type: z.string().max(10).optional(), short: z.enum(['true', 'false']).optional() });
export const TeamRequests = z.object({
  /* the waiting requests at the locations this employee decides for, filtered */
  requests: z.array(TeamRequestView),
  counts: z.object({ pending: z.number().int(), escalated: z.number().int(), shown: z.number().int() }),
  /* "2 requests have breached the 5-day approval SLA", or '' */
  breached: z.string(),
  escalateTo: z.string(), slaDays: z.number().int(), stages: z.array(LeaveStage), types: z.array(Option), locations: z.array(Option),
});
export type TeamRequests = z.infer<typeof TeamRequests>;
export const TeamBalanceRow = z.object({
  employeeCode: z.string(), name: z.string(), policyName: z.string(), unit: BalanceUnit, entDays: z.number(), entHours: z.number(),
  takenD: z.number(), leftD: z.number(), leftH: z.number(), toil: z.number(), toilBy: DateOrBlank,
  /* the first request not declined or cancelled */
  next: z.object({ from: IsoDate, state: LeaveState }).nullable(),
});
export type TeamBalanceRow = z.infer<typeof TeamBalanceRow>;
export const TeamBalances = z.object({ rows: z.array(TeamBalanceRow), toil: z.boolean() });
export type TeamBalances = z.infer<typeof TeamBalances>;
export const EntitlementDetail = z.object({
  employee: z.object({ code: z.string(), name: z.string(), employeeType: z.string() }),
  today: IsoDate, year: LeaveYear, entitlement: EntitlementView, balance: BalanceView, facts: LeaveFacts,
});
export type EntitlementDetail = z.infer<typeof EntitlementDetail>;
export const LeaverRow = z.object({
  employeeCode: z.string(), name: z.string(), leaveDate: IsoDate, note: z.string(), months: z.number().int(),
  full: z.number(), prorata: z.number(), taken: z.number(), diff: z.number(), hours: z.number(),
  verdict: z.string(), tone: Tone, action: z.string(),
});
export type LeaverRow = z.infer<typeof LeaverRow>;
export const Leavers = z.object({ rows: z.array(LeaverRow), settled: z.string() });
export type Leavers = z.infer<typeof Leavers>;

/* ------------------------------------------------------------- sickness */
export const RtwRequest = z.object({ requestedAt: IsoDateTime, by: Actor });
export const SickEpisodeRecord = RecordMeta.extend({
  employeeCode: z.string(), from: IsoDate,
  /* '' while the colleague is still off */
  to: DateOrBlank, reason: z.string(), note: z.string(), rtw: RtwRequest.nullable(),
});
export type SickEpisodeRecord = z.infer<typeof SickEpisodeRecord>;
export const SicknessRow = z.object({
  employeeCode: z.string(), name: z.string(), latest: z.string(), spells: z.number().int(), days: z.number().int(), score: z.number().int(),
  triggered: z.boolean(), next: z.string(),
  /* the latest episode, which Arrange return to work acts on */
  episode: SickEpisodeRecord,
});
export type SicknessRow = z.infer<typeof SicknessRow>;
export const SickOnLeaveDay = z.object({ employeeCode: z.string(), name: z.string(), requestId: z.string(), date: IsoDate, days: z.number() });
export type SickOnLeaveDay = z.infer<typeof SickOnLeaveDay>;
export const SicknessBoard = z.object({
  rows: z.array(SicknessRow),
  /* the first colleague over the trigger: the banner and its Arrange it */
  banner: z.object({ employeeCode: z.string(), text: z.string(), note: z.string(), episode: SickEpisodeRecord }).nullable(),
  counts: z.object({ triggered: z.number().int(), colleagues: z.number().int() }),
  trigger: z.number().int(), tip: z.string(), today: IsoDate,
  /* who can be recorded: active employees at the locations this employee looks after */
  colleagues: z.array(Option), reasons: z.array(z.string()),
  /* approved annual leave days a sickness episode covers, not yet given back (D10) */
  sickOnLeave: z.array(SickOnLeaveDay),
});
export type SicknessBoard = z.infer<typeof SicknessBoard>;
export const RecordSickness = z.object({
  employeeCode: z.string().min(1), from: z.string().max(10), to: z.string().max(10), reason: z.string().max(40), note: z.string().max(200).optional(),
});
export type RecordSickness = z.infer<typeof RecordSickness>;
/* extended: the day joined an open or just-ended episode instead of starting a new spell (D9). */
export const SicknessRecorded = z.object({ record: SickEpisodeRecord, extended: z.boolean(), rota: RotaEffect, summary: z.string(), auditId: z.string() });
export type SicknessRecorded = z.infer<typeof SicknessRecorded>;
export const RtwArranged = z.object({ record: SickEpisodeRecord, summary: z.string(), auditId: z.string() });
export type RtwArranged = z.infer<typeof RtwArranged>;
export const GiveDaysBack = z.object({ employeeCode: z.string().min(1), dates: z.array(z.string().max(10)).max(60) });
export type GiveDaysBack = z.infer<typeof GiveDaysBack>;
export const DaysGivenBack = z.object({ record: LedgerView, rota: RotaEffect, summary: z.string(), auditId: z.string() });
export type DaysGivenBack = z.infer<typeof DaysGivenBack>;

/* ---------------------------------------------------------------- setup */
export const LeaveTypeRecord = z.object({
  code: z.string().min(1).max(10), name: z.string().max(60), icon: z.string().max(4), short: z.string().max(20), policy: z.string().max(10),
  paid: z.boolean(), evidence: z.boolean(), unit: LeaveUnit, active: z.boolean(),
});
export type LeaveTypeRecord = z.infer<typeof LeaveTypeRecord>;
export const TypeLeave = z.object({ policy: z.string().max(10), unit: BalanceUnit });
export const LeaveConfigData = z.object({
  slaDays: z.number(), toilMax: z.number(), toilWindow: z.number(), bhPaid: z.boolean(), absenceTrigger: z.number(),
  autoEntitlement: z.boolean(), blocksTimesheet: z.boolean(), affectsRota: z.boolean(), minNotice: z.number(), cancelWindow: z.number(),
  sicknessReasons: z.array(z.string().trim().min(1).max(40)).max(30), types: z.array(LeaveTypeRecord).max(30),
  policies: z.array(LeavePolicy).max(20), stages: z.array(LeaveStage).max(10), typeLeave: z.record(z.string(), TypeLeave),
});
export type LeaveConfigData = z.infer<typeof LeaveConfigData>;
const LeaveConfigFields = LeaveConfigData.shape;
export const LeaveConfigRecord = RecordMeta.extend({
  ...LeaveConfigFields, finYearStart: z.string().max(5),
});
export type LeaveConfigRecord = z.infer<typeof LeaveConfigRecord>;
/* The module flags are shown read-only: they change under Modules & features (D11). requestCounts: how
   many requests name each leave type. leavers: the tenant's leaver reconciliation while LV_LEAVER is on
   (an administrator holds no location, so it is the whole tenant), null otherwise. */
export const LeaveSetup = z.object({
  config: LeaveConfigRecord, employeeTypes: z.array(Option), flags: z.record(z.string(), z.boolean()), rotaOn: z.boolean(),
  requestCounts: z.record(z.string(), z.number().int()), leavers: Leavers.nullable(),
});
export type LeaveSetup = z.infer<typeof LeaveSetup>;
/* Each key replaces the stored one, except typeLeave (merged by employee type code). Stages are renumbered by position. */
export const UpdateLeaveConfig = z.strictObject({
  slaDays: z.number().optional(), toilMax: z.number().optional(), toilWindow: z.number().optional(), bhPaid: z.boolean().optional(),
  absenceTrigger: z.number().optional(), autoEntitlement: z.boolean().optional(), blocksTimesheet: z.boolean().optional(),
  affectsRota: z.boolean().optional(), minNotice: z.number().optional(), cancelWindow: z.number().optional(),
  sicknessReasons: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  types: z.array(LeaveTypeRecord).max(30).optional(), policies: z.array(LeavePolicy.extend({ code: z.string().min(1).max(10), name: z.string().max(60) })).max(20).optional(),
  stages: z.array(LeaveStage.extend({ n: z.number().int().optional(), who: z.string().max(60), action: z.string().max(120), channel: z.string().max(40) })).max(10).optional(),
  typeLeave: z.record(z.string(), TypeLeave).optional(),
}).strict();
export type UpdateLeaveConfig = z.infer<typeof UpdateLeaveConfig>;

/* ------------------------------------------------------------- endpoints */
const ById = z.object({ id: z.string().min(1) });
const ByEmployee = z.object({ employeeCode: z.string().min(1) });

export const getMyLeave = defineEndpoint({ method: 'GET', path: '/api/v1/leave/me', response: MyLeave, capability: 'own_leave',
  summary: 'My leave: balances in days and hours, TOIL, the request form\'s types, my requests and the adjustment ledger' });
export const requestLeave = defineEndpoint({ method: 'POST', path: '/api/v1/leave/requests', request: RequestLeave, response: LeaveRequested,
  capability: 'own_leave', errors: [409],
  summary: 'Ask for leave. Validated on the server (dates, half days, the annual leave balance with pending held back); the manager is notified.' });
export const cancelLeave = defineEndpoint({ method: 'POST', path: '/api/v1/leave/requests/:id/cancel', params: ById, response: LeaveMoved,
  capability: 'own_leave', versioned: true, errors: [404, 409], summary: 'Cancel one of my own waiting requests (If-Match)' });
/* Module 8 group 4B: no single capability on the queue and the two decisions. A
   request walks the Leave approval chain, and each layer is decided by its role's
   capability (team_leave for the line manager and the Service Manager) or by a
   delegate covering a holder. Anyone holding neither, and covering nobody, is
   refused with 403 capability. */
export const listTeamLeave = defineEndpoint({ method: 'GET', path: '/api/v1/leave/team/requests', query: TeamRequestsQuery, response: TeamRequests,
  errors: [403], summary: 'Waiting requests whose current approval layer this employee decides, with balance, effect on cover, layer, stage and the SLA of that layer' });
export const approveLeave = defineEndpoint({ method: 'POST', path: '/api/v1/leave/requests/:id/approve', params: ById, response: LeaveDecided,
  versioned: true, errors: [403, 404, 409],
  summary: 'Approve a waiting request at its current approval layer (If-Match). With a later layer to come it stays waiting, on that layer. Only an approval at the last layer approves it; with Rota and Leave to rota on, the days then go onto the rota as leave and cover opens below the minimum. Refused with SELF_APPROVAL, ALREADY_SIGNED, scope, WRONG_LAYER or capability.' });
export const declineLeave = defineEndpoint({ method: 'POST', path: '/api/v1/leave/requests/:id/decline', params: ById, request: DeclineLeave, response: LeaveMoved,
  versioned: true, errors: [403, 404, 409], summary: 'Decline a waiting request at its current approval layer, with a reason the colleague sees (If-Match)' });
export const getTeamBalances = defineEndpoint({ method: 'GET', path: '/api/v1/leave/team/balances', response: TeamBalances, capability: 'team_leave',
  summary: 'Entitlement, taken and remaining for everyone at the locations this employee looks after' });
/* No single capability: your own needs own_leave; someone else's needs team_leave and their location. */
export const getEntitlement = defineEndpoint({ method: 'GET', path: '/api/v1/leave/entitlement/:employeeCode', params: ByEmployee, response: EntitlementDetail,
  errors: [403, 404], summary: 'How an employee\'s entitlement and balance were worked out' });
export const listLeavers = defineEndpoint({ method: 'GET', path: '/api/v1/leave/leavers', response: Leavers, capability: 'team_leave', errors: [403],
  summary: 'Leaver reconciliation in days and hours at the leaving date. Payroll settles the money.' });
export const getSicknessBoard = defineEndpoint({ method: 'GET', path: '/api/v1/leave/sickness', response: SicknessBoard, capability: 'team_sick',
  summary: 'Sickness at the locations this employee looks after: episodes, Bradford scores and triggers, and sickness during booked leave' });
export const recordSickness = defineEndpoint({ method: 'POST', path: '/api/v1/leave/sickness', request: RecordSickness, response: SicknessRecorded,
  capability: 'team_sick', errors: [404, 409],
  summary: 'Record sickness. A day next to an open or just-ended episode extends it. With Leave to rota on, the days go onto the rota as sickness.' });
export const arrangeRtw = defineEndpoint({ method: 'POST', path: '/api/v1/leave/sickness/:id/rtw', params: ById, response: RtwArranged,
  capability: 'team_sick', versioned: true, errors: [404, 409], summary: 'Ask for a return-to-work meeting for an absence (If-Match: the episode)' });
export const giveDaysBack = defineEndpoint({ method: 'POST', path: '/api/v1/leave/give-back', request: GiveDaysBack, response: DaysGivenBack,
  capability: 'team_sick', errors: [404],
  summary: 'Return the approved annual leave days a sickness episode covered to the colleague\'s balance, as one ledger adjustment' });
export const getLeaveConfig = defineEndpoint({ method: 'GET', path: '/api/v1/leave/config', response: LeaveSetup, capability: 'mod_cfg',
  summary: 'Leave setup: types, policies, entitlement rules, the booking workflow, Leave and Rota, and the per-type leave policy' });
export const updateLeaveConfig = defineEndpoint({ method: 'PATCH', path: '/api/v1/leave/config', request: UpdateLeaveConfig, response: mutation(LeaveConfigRecord),
  capability: 'mod_cfg', versioned: true, errors: [409], summary: 'Save Leave setup (If-Match). The per-type leave policy is merged by type code; stages are renumbered.' });
