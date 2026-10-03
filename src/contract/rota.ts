/* Module 3 Rota. A rota week is one record per location and week (brief D1),
   versioned on its own; every cell write, transition, copy, repeat, clear and
   plan acceptance carries If-Match on that week. Eligibility, publishing,
   generate, repeat, copy, clear and the cover stages are the server's (group 1
   domain); the screens run the same rules only to warn early. No money (D10).
   `location` in a path is a location code (WH); `weekStart` is a Monday. */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime, RecordMeta, mutation } from './common';
import { IsoDate } from './people';

const Actor = z.object({ personCode: z.string(), name: z.string() });
const Day = z.number().int().min(0).max(6);
/* A cell: a shift code, '' (rest), 'V' (leave) or 'S' (sickness). */
const CellCode = z.string().max(4);
const Line = z.array(z.string()).length(7);
const AtOrBlank = z.union([IsoDateTime, z.literal('')]);

export const RotaState = z.enum(['draft', 'review', 'published', 'amendment', 'republished']);
export type RotaState = z.infer<typeof RotaState>;
export const ShiftTone = z.enum(['E', 'L', 'N']);

/* ---------------------------------------------------------- shift types */
/* hours, cross, start and end are derived from the times (recalcShift), never typed. */
export const ShiftTypeRecord = RecordMeta.extend({
  code: z.string(), name: z.string(), from: z.string(), to: z.string(), breakMinutes: z.number().int().nonnegative(),
  night: z.boolean(), tone: ShiftTone, hours: z.number(), cross: z.boolean(), start: z.number(), end: z.number(),
});
export type ShiftTypeRecord = z.infer<typeof ShiftTypeRecord>;
export const ShiftUsage = z.object({ rota: z.number().int().nonnegative(), patterns: z.number().int().nonnegative() });
export const ShiftCatalogue = z.object({ items: z.array(ShiftTypeRecord), usage: z.record(z.string(), ShiftUsage) });
export type ShiftCatalogue = z.infer<typeof ShiftCatalogue>;
const ShiftFields = {
  name: z.string().max(60), from: z.string().max(5), to: z.string().max(5), breakMinutes: z.number().int(), night: z.boolean(), tone: ShiftTone.optional(),
};
/* eligibleAll: every employee type takes the new shift (a night shift skips types that are not night-eligible). */
export const CreateShiftType = z.object({ code: z.string().max(4), ...ShiftFields, eligibleAll: z.boolean().optional() });
export type CreateShiftType = z.infer<typeof CreateShiftType>;
export const UpdateShiftType = z.strictObject(ShiftFields).partial();
export type UpdateShiftType = z.infer<typeof UpdateShiftType>;
export const Removed = z.object({ code: z.string(), auditId: z.string() });

/* ---------------------------------------------------------------- week */
export const RotaChange = z.object({
  at: IsoDateTime, by: Actor, personCode: z.string(), name: z.string(), date: IsoDate, from: z.string(), to: z.string(), why: z.string(),
  afterPublish: z.boolean(), version: z.number().int().nonnegative(),
});
export type RotaChange = z.infer<typeof RotaChange>;
export const HoursFlag = z.object({ k: z.string(), c: z.enum(['warn', 'info', 'err', 'neu']) });
export type HoursFlag = z.infer<typeof HoursFlag>;
export const HoursPosition = z.object({
  con: z.number(), rot: z.number(), wk: z.number(), rotaVar: z.number(), workVar: z.number(), schedVar: z.number(), flags: z.array(HoursFlag), cap: z.number(),
});
/* One person on the week's roster. restIssues: the day pairs whose rest is below their need (i is the earlier day). */
export const RotaRow = z.object({
  personCode: z.string(), name: z.string(), jobProfile: z.string(), jobProfileName: z.string(), category: z.string(),
  employeeType: z.string(), typeName: z.string(), contractedHours: z.number(), line: Line, hours: HoursPosition,
  restIssues: z.array(z.object({ i: Day, rest: z.number() })),
});
export type RotaRow = z.infer<typeof RotaRow>;
export const LocationOption = z.object({ code: z.string(), name: z.string() });
export const Publication = z.object({ location: z.string(), locationName: z.string(), weekStart: IsoDate, version: z.number().int(), at: IsoDateTime, notified: z.number().int() });
export const RotaWeekView = z.object({
  /* the If-Match a write to this week sends: its version, or 0 for a week not stored yet */
  id: z.string(), version: z.number().int().nonnegative(),
  location: z.object({ code: z.string(), name: z.string(), area: z.string(), level: z.string(), minPerShift: z.number().int() }),
  /* the locations this person may manage: their own, or every active one with master data (D5) */
  locations: z.array(LocationOption),
  weekStart: IsoDate, label: z.string(), isoWeek: z.number().int(), today: IsoDate,
  state: RotaState, publishVersion: z.number().int().nonnegative(), publishedAt: AtOrBlank, publishedBy: Actor.nullable(),
  /* newest first */
  changes: z.array(RotaChange),
  /* the minimum per day (0 while MINSTAFF is off), the days below it, and how many are on each day */
  min: z.number().int().nonnegative(), gapDays: z.array(Day), onShift: z.array(z.number().int()),
  /* per day, how many are on each shift code */
  coverage: z.array(z.record(z.string(), z.number().int())),
  rows: z.array(RotaRow),
  key: z.object({ shifts: z.record(z.string(), z.number().int()), leave: z.number().int(), sick: z.number().int(), empty: z.number().int() }),
  shifts: z.array(ShiftTypeRecord),
  rules: z.object({
    publishBlockOnGap: z.boolean(), restWarn: z.boolean(), restHours: z.number(), restRule: z.boolean(), minStaff: z.boolean(),
    safeWorker: z.boolean(), fulfil: z.boolean(), patterns: z.boolean(), horizon: z.number().int(), outlook: z.boolean(),
  }),
  /* recent publications at the locations this person may manage, newest first */
  publications: z.array(Publication),
});
export type RotaWeekView = z.infer<typeof RotaWeekView>;

/* ---------------------------------------------------------------- cover */
export const CoverLogEntry = z.object({ stage: z.number().int(), at: IsoDateTime, audience: z.string(), channel: z.string(), sent: z.number().int() });
export const CoverRecord = RecordMeta.extend({
  location: z.string(), date: IsoDate, shift: z.string(), reason: z.string(), stage: z.number().int(), open: z.boolean(), urgent: z.boolean(),
  openedAt: IsoDateTime, asked: z.string(), log: z.array(CoverLogEntry),
});
export type CoverRecord = z.infer<typeof CoverRecord>;
export const Suggestion = z.object({ personCode: z.string(), name: z.string(), category: z.string(), score: z.number(), why: z.array(z.string()) });
export type Suggestion = z.infer<typeof Suggestion>;
export const RuledOut = z.object({ personCode: z.string(), name: z.string(), rule: z.string(), reason: z.string() });
/* A cover request as the screen shows it: what happens next, and who could take it now. */
export const CoverView = CoverRecord.extend({
  locationName: z.string(), shiftName: z.string(), time: z.string(), next: z.string(), suggestions: z.array(Suggestion), eligible: z.number().int(),
});
export type CoverView = z.infer<typeof CoverView>;
export const FilledShift = RecordMeta.extend({
  coverId: z.string(), location: z.string(), date: IsoDate, shift: z.string(), personCode: z.string(), name: z.string(), confirmed: z.boolean(), itRequest: z.string(),
});
export type FilledShift = z.infer<typeof FilledShift>;
export const FilledView = FilledShift.extend({ locationName: z.string(), shiftName: z.string(), time: z.string() });
export type FilledView = z.infer<typeof FilledView>;
export const ItRequest = z.object({
  id: z.string(), ref: z.string(), personCode: z.string(), name: z.string(), location: z.string(), shift: z.string(), date: IsoDate,
  worker: z.string(), status: z.string(), raisedAt: IsoDateTime, system: z.string(),
});
export type ItRequest = z.infer<typeof ItRequest>;
export const FulfilStage = z.object({ n: z.number().int(), audience: z.string(), wait: z.number().int(), channel: z.string(), next: z.string() });
export type FulfilStage = z.infer<typeof FulfilStage>;
export const CoverStatus = z.enum(['all', 'urgent', 'filled']);
export const CoverBoard = z.object({
  requests: z.array(CoverView), filled: z.array(FilledView), stages: z.array(FulfilStage),
  counts: z.object({ all: z.number().int(), urgent: z.number().int(), filled: z.number().int() }), itAccess: z.boolean(),
});
export type CoverBoard = z.infer<typeof CoverBoard>;

/* ------------------------------------------------------------- week writes */
/* One cell. code '' removes the day's shift; a filled cell is changed, an empty one assigned. */
export const CellInput = z.object({ personCode: z.string().min(1), day: Day, code: CellCode, why: z.string().max(200).optional() });
export type CellInput = z.infer<typeof CellInput>;
/* advisories: hours and rest flags on the saved line; they never block (D4). cover: the request a removal opened. */
export const CellSaved = z.object({ week: RotaWeekView, advisories: z.array(HoursFlag), cover: CoverView.nullable(), auditId: z.string() });
export type CellSaved = z.infer<typeof CellSaved>;
export const WeekTransition = z.object({ to: z.enum(['review', 'draft', 'published']) });
export const WeekMoved = z.object({ week: RotaWeekView, summary: z.string(), auditId: z.string() });
export type WeekMoved = z.infer<typeof WeekMoved>;
export const Counts = z.object({ written: z.number().int(), occupied: z.number().int(), absence: z.number().int() });
/* auditId is null when nothing was written (every target cell already filled). */
export const WeekCopied = Counts.extend({ week: RotaWeekView, summary: z.string(), auditId: z.string().nullable() });
export type WeekCopied = z.infer<typeof WeekCopied>;
export const RepeatInput = z.object({ weeks: z.number().int() });
export const WeekRepeated = Counts.extend({ week: RotaWeekView, live: z.number().int(), weeks: z.number().int(), summary: z.string(), auditId: z.string().nullable() });
export type WeekRepeated = z.infer<typeof WeekRepeated>;
export const WeekCleared = z.object({ week: RotaWeekView, cleared: z.number().int(), summary: z.string(), auditId: z.string() });
export type WeekCleared = z.infer<typeof WeekCleared>;
export const PlanItem = z.object({ day: Day, code: z.string(), none: z.boolean(), personCode: z.string(), name: z.string(), why: z.array(z.string()) });
export type PlanItem = z.infer<typeof PlanItem>;
export const WeekPlan = z.object({ items: z.array(PlanItem), summary: z.string() });
export type WeekPlan = z.infer<typeof WeekPlan>;
export const AcceptPlan = z.object({ items: z.array(z.object({ personCode: z.string().min(1), day: Day, code: CellCode })).min(1, 'Choose at least one suggestion.').max(50) });
export type AcceptPlan = z.infer<typeof AcceptPlan>;
export const PlanAccepted = z.object({ week: RotaWeekView, advisories: z.array(HoursFlag), summary: z.string(), auditId: z.string() });
export type PlanAccepted = z.infer<typeof PlanAccepted>;
export const CellSuggestions = z.object({ day: Day, code: z.string(), ok: z.array(Suggestion), no: z.array(RuledOut) });
export type CellSuggestions = z.infer<typeof CellSuggestions>;
export const SuggestQuery = z.object({ day: z.coerce.number().int().min(0).max(6), code: z.string().min(1).max(4) });

/* ------------------------------------------------------------- patterns */
export const PatternPerson = z.object({ personCode: z.string(), offset: z.number().int() });
export const PatternRecord = RecordMeta.extend({
  code: z.string(), name: z.string(), cycle: z.number().int(), locations: z.array(z.string()), jobProfiles: z.array(z.string()), costCentre: z.string(),
  starts: z.string(), horizon: z.number().int(), gen: z.string(), genFrom: z.string(), genTo: z.string(), active: z.boolean(),
  days: z.array(z.string()), people: z.array(PatternPerson),
});
export type PatternRecord = z.infer<typeof PatternRecord>;
export const PatternCandidate = z.object({ code: z.string(), name: z.string(), location: z.string(), jobProfile: z.string(), category: z.string() });
export const PatternList = z.object({ items: z.array(PatternRecord), people: z.array(PatternCandidate) });
export type PatternList = z.infer<typeof PatternList>;
const PatternFields = {
  name: z.string().max(80), cycle: z.number().int(), days: z.array(CellCode).max(28), locations: z.array(z.string()).max(20),
  jobProfiles: z.array(z.string()).max(20), costCentre: z.string().max(20), starts: z.string(), horizon: z.number().int(),
  gen: z.string(), genFrom: z.string(), genTo: z.string(),
};
/* A new pattern starts as a draft. base copies another pattern's cycle and days. */
export const CreatePattern = z.object({ ...PatternFields, days: PatternFields.days.optional(), genFrom: z.string().optional(), genTo: z.string().optional(), base: z.string().optional() });
export type CreatePattern = z.infer<typeof CreatePattern>;
/* A cycle change without days resizes them (shrinking drops days, growing adds rest days, offsets wrap). */
export const UpdatePattern = z.strictObject({ ...PatternFields, active: z.boolean(), people: z.array(PatternPerson).max(200) }).partial();
export type UpdatePattern = z.infer<typeof UpdatePattern>;
export const AddPatternPeople = z.object({ personCodes: z.array(z.string()).max(100), start: z.number().int().min(1), mode: z.enum(['stagger', 'same']) });
export type AddPatternPeople = z.infer<typeof AddPatternPeople>;
export const GeneratePattern = z.object({ gen: z.string().optional(), genFrom: z.string().optional(), genTo: z.string().optional() });
export type GeneratePattern = z.infer<typeof GeneratePattern>;
export const PatternGenerated = Counts.extend({
  record: PatternRecord, weeks: z.number().int(), live: z.number().int(), rest: z.array(z.string()), range: z.string(), people: z.number().int(),
  summary: z.string(), auditId: z.string().nullable(),
});
export type PatternGenerated = z.infer<typeof PatternGenerated>;

/* ----------------------------------------------------------------- cover */
export const CoverQuery = z.object({ status: CoverStatus.optional() });
export const OpenCover = z.object({ location: z.string().min(1), date: IsoDate, shift: z.string().min(1).max(4), reason: z.string().max(40), urgent: z.boolean() });
export type OpenCover = z.infer<typeof OpenCover>;
export const CoverReason = z.object({ reason: z.string().max(40) });
export const CoverAssign = z.object({ personCode: z.string().min(1) });
/* auditId is null when the reason sent is the one already stored */
export const CoverSaved = z.object({ record: CoverView, auditId: z.string().nullable() });
export type CoverSaved = z.infer<typeof CoverSaved>;
export const CoverFilled = z.object({ record: CoverView, filled: FilledShift, summary: z.string(), auditId: z.string() });
export type CoverFilled = z.infer<typeof CoverFilled>;
export const FilledConfirmed = z.object({ record: FilledShift, itRequest: ItRequest.nullable(), summary: z.string(), auditId: z.string() });
export type FilledConfirmed = z.infer<typeof FilledConfirmed>;

/* ------------------------------------------------------------ my shifts */
export const MyShiftDay = z.object({ date: IsoDate, code: z.string(), name: z.string(), time: z.string(), hours: z.number() });
export const OpenShift = z.object({
  id: z.string(), version: z.number().int(), date: IsoDate, shift: z.string(), shiftName: z.string(), time: z.string(),
  location: z.string(), locationName: z.string(), urgent: z.boolean(), why: z.string(),
});
export type OpenShift = z.infer<typeof OpenShift>;
/* D14: a week shows only once published (published, amendment or republished); before that
   `visible` is false and no shift times are sent. */
export const MyShifts = z.object({
  person: z.object({ code: z.string(), name: z.string(), location: z.string(), locationName: z.string() }),
  weekStart: IsoDate, label: z.string(), today: IsoDate, state: RotaState, visible: z.boolean(),
  /* only the days with a shift, when visible */
  days: z.array(MyShiftDay), restDays: z.array(IsoDate), hours: z.number(),
  next: MyShiftDay.extend({ with: z.array(z.string()) }).nullable(),
  /* the last day of the furthest published week at the person's location, or '' */
  publishedTo: z.union([IsoDate, z.literal('')]),
  openShifts: z.array(OpenShift), canClaim: z.boolean(), outlook: z.boolean(), horizon: z.number().int(),
});
export type MyShifts = z.infer<typeof MyShifts>;
export const MyShiftsQuery = z.object({ weekStart: IsoDate.optional() });

/* ---------------------------------------------------------------- config */
export const SafeRules = z.object({
  clearance: z.boolean(), quals: z.boolean(), night: z.boolean(), availability: z.boolean(), conflicts: z.boolean(),
  maxHours: z.boolean(), rest: z.boolean(), consec: z.boolean(),
});
export const TypeRota = z.object({
  shifts: z.array(z.string()), night: z.boolean(), maxHours: z.number(), restHours: z.number(), maxConsec: z.number().int(), flexible: z.boolean(),
});
export type TypeRota = z.infer<typeof TypeRota>;
const ConfigFields = {
  minDefault: z.number(), maxHours: z.number(), capTolerance: z.number(), restHours: z.number(), restWarn: z.boolean(), maxConsec: z.number(),
  horizon: z.number(), favHeadStart: z.number(), flexMilestones: z.array(z.number()).max(12), flexNotifyTo: z.string().max(80),
  itAccess: z.boolean(), agencyManual: z.boolean(), bhEnhanced: z.boolean(), outlook: z.boolean(), publishBlockOnGap: z.boolean(),
  rotaBuiltBy: z.string(),
};
export const RotaConfigRecord = RecordMeta.extend({
  ...ConfigFields, safeRules: SafeRules, fulfilStages: z.array(FulfilStage), types: z.record(z.string(), TypeRota),
});
export type RotaConfigRecord = z.infer<typeof RotaConfigRecord>;
export const RotaSetup = z.object({ config: RotaConfigRecord, employeeTypes: z.array(LocationOption), shifts: z.array(ShiftTypeRecord) });
export type RotaSetup = z.infer<typeof RotaSetup>;
/* Each key replaces the stored one, except safeRules (merged) and types (merged by type code). Stages are renumbered by position. */
export const UpdateRotaConfig = z.strictObject({
  ...ConfigFields, safeRules: SafeRules.partial(), fulfilStages: z.array(FulfilStage.extend({ n: z.number().int().optional() })).max(10),
  types: z.record(z.string(), TypeRota),
}).partial();
export type UpdateRotaConfig = z.infer<typeof UpdateRotaConfig>;

/* ------------------------------------------------------------- endpoints */
const LocWeek = z.object({ location: z.string().min(1), weekStart: IsoDate });
const ByCode = z.object({ code: z.string().min(1) });
const ById = z.object({ id: z.string().min(1) });
const WEEK = '/api/v1/rota/weeks/:location/:weekStart';

/* Where Team rota opens: the locations this person may manage (D5), the one to start on
   (their own), and the server's today with its week, so the screen never guesses either. */
export const RotaHome = z.object({ locations: z.array(LocationOption), location: z.string(), today: IsoDate, weekStart: IsoDate });
export type RotaHome = z.infer<typeof RotaHome>;
export const getRotaHome = defineEndpoint({ method: 'GET', path: '/api/v1/rota/home', response: RotaHome, capability: 'team_rota',
  summary: 'Where Team rota opens: the locations this person may manage, the one to start on, and today\'s week' });
export const getRotaWeek = defineEndpoint({ method: 'GET', path: WEEK, params: LocWeek, response: RotaWeekView, capability: 'team_rota', errors: [404],
  summary: 'One location\'s rota week: lines per person, coverage and gaps per day, hours position per person, state, version, change log and recent publications' });
export const writeRotaCell = defineEndpoint({ method: 'PUT', path: `${WEEK}/cells`, params: LocWeek, request: CellInput, response: CellSaved,
  capability: 'team_rota', versioned: true, errors: [404, 409],
  summary: 'Assign, change or remove one cell (If-Match: the week\'s version). Eligibility is checked here (ROTA_INELIGIBLE); a change to a live week records an amendment.' });
export const transitionRotaWeek = defineEndpoint({ method: 'POST', path: `${WEEK}/transition`, params: LocWeek, request: WeekTransition, response: WeekMoved,
  capability: 'team_rota', versioned: true, errors: [404, 409],
  summary: 'Send for review, return to draft, or publish (republish an amended week). Publishing is refused with COVERAGE_GAPS while gaps block it.' });
export const copyRotaWeek = defineEndpoint({ method: 'POST', path: `${WEEK}/copy`, params: LocWeek, response: WeekCopied, capability: 'team_rota',
  versioned: true, errors: [404, 409], summary: 'Copy the previous week\'s shifts into empty cells of this week. Filled cells, leave and sickness are left alone.' });
export const repeatRotaWeek = defineEndpoint({ method: 'POST', path: `${WEEK}/repeat`, params: LocWeek, request: RepeatInput, response: WeekRepeated,
  capability: 'team_rota', versioned: true, errors: [404],
  summary: 'Repeat this week forward for a number of weeks (If-Match: this week). Never overwrites; published weeks are skipped and counted.' });
export const clearRotaWeek = defineEndpoint({ method: 'POST', path: `${WEEK}/clear`, params: LocWeek, response: WeekCleared, capability: 'team_rota',
  versioned: true, errors: [404, 409], summary: 'Remove every shift from a draft or review week, each recorded as a change. Leave and sickness are kept.' });
export const planRotaWeek = defineEndpoint({ method: 'GET', path: `${WEEK}/plan`, params: LocWeek, response: WeekPlan, capability: 'team_rota', errors: [404],
  summary: 'Suggested assignments for the days below the minimum. Nothing is written.' });
export const acceptRotaPlan = defineEndpoint({ method: 'POST', path: `${WEEK}/plan/accept`, params: LocWeek, request: AcceptPlan, response: PlanAccepted,
  capability: 'team_rota', versioned: true, errors: [404, 409],
  summary: 'Write the chosen suggestions through the same path as one cell write: each is checked for eligibility, and any refusal writes none.' });
export const suggestRotaCell = defineEndpoint({ method: 'GET', path: `${WEEK}/suggestions`, params: LocWeek, query: SuggestQuery, response: CellSuggestions,
  capability: 'team_rota', errors: [404], summary: 'Who could take one shift on one day, best first with the reasons, and who is ruled out by which rule' });

export const listShiftTypes = defineEndpoint({ method: 'GET', path: '/api/v1/rota/shift-types', response: ShiftCatalogue, errors: [403],
  summary: 'The shift catalogue in its order on the 24-hour line, with how many rota and pattern days use each' });
export const createShiftType = defineEndpoint({ method: 'POST', path: '/api/v1/rota/shift-types', request: CreateShiftType, response: mutation(ShiftTypeRecord),
  capability: 'rota_shift', summary: 'Add a shift type. Its hours are worked out from the times and the break.' });
export const updateShiftType = defineEndpoint({ method: 'PATCH', path: '/api/v1/rota/shift-types/:code', params: ByCode, request: UpdateShiftType,
  response: mutation(ShiftTypeRecord), capability: 'rota_shift', versioned: true, errors: [404],
  summary: 'Change a shift type\'s name, times, break, night or colour (If-Match). Turning it into a night shift removes it from types that are not night-eligible.' });
export const deleteShiftType = defineEndpoint({ method: 'DELETE', path: '/api/v1/rota/shift-types/:code', params: ByCode, response: Removed,
  capability: 'rota_shift', versioned: true, errors: [404, 409],
  summary: 'Remove a shift type no rota or pattern day uses (If-Match). It leaves every employee type\'s rota shifts too.' });

export const listPatterns = defineEndpoint({ method: 'GET', path: '/api/v1/rota/patterns', response: PatternList, capability: 'rota_pattern',
  summary: 'Working patterns covering the locations this person manages, with the people who can be put on them' });
export const createPattern = defineEndpoint({ method: 'POST', path: '/api/v1/rota/patterns', request: CreatePattern, response: mutation(PatternRecord),
  capability: 'rota_pattern', errors: [404], summary: 'Add a working pattern as a draft, optionally copied from another' });
export const updatePattern = defineEndpoint({ method: 'PATCH', path: '/api/v1/rota/patterns/:code', params: ByCode, request: UpdatePattern,
  response: mutation(PatternRecord), capability: 'rota_pattern', versioned: true, errors: [404, 409], summary: 'Change a working pattern, its cycle, its people and their starting days (If-Match)' });
export const deletePattern = defineEndpoint({ method: 'DELETE', path: '/api/v1/rota/patterns/:code', params: ByCode, response: Removed,
  capability: 'rota_pattern', versioned: true, errors: [404], summary: 'Remove a working pattern (If-Match). Shifts it already wrote stay on the rota.' });
export const addPatternPeople = defineEndpoint({ method: 'POST', path: '/api/v1/rota/patterns/:code/people', params: ByCode, request: AddPatternPeople,
  response: mutation(PatternRecord), capability: 'rota_pattern', versioned: true, errors: [404, 409],
  summary: 'Put people on a pattern, staggered across the days that carry a shift or all on the same day (If-Match)' });
export const generatePattern = defineEndpoint({ method: 'POST', path: '/api/v1/rota/patterns/:code/generate', params: ByCode, request: GeneratePattern,
  response: PatternGenerated, capability: 'rota_pattern', versioned: true, errors: [404],
  summary: 'Write a pattern into the rota for a period (If-Match: the pattern). Never overwrites: filled cells, leave, sickness and published weeks are skipped and counted.' });

export const listCover = defineEndpoint({ method: 'GET', path: '/api/v1/rota/cover', query: CoverQuery, response: CoverBoard, capability: 'team_cover',
  summary: 'Open cover requests at the locations this person manages, with their stage and suggestions, and filled shifts waiting to be confirmed' });
export const openCover = defineEndpoint({ method: 'POST', path: '/api/v1/rota/cover', request: OpenCover, response: CoverSaved, capability: 'team_cover',
  errors: [404, 409], summary: 'Open a cover request, or add an urgent extra shift. One open request per location, day and shift.' });
export const setCoverReason = defineEndpoint({ method: 'POST', path: '/api/v1/rota/cover/:id/reason', params: ById, request: CoverReason, response: CoverSaved,
  capability: 'team_cover', versioned: true, errors: [404, 409], summary: 'Give the reason; the first one asks the location and then favourites (If-Match)' });
export const askAllCover = defineEndpoint({ method: 'POST', path: '/api/v1/rota/cover/:id/ask-all', params: ById, response: CoverSaved,
  capability: 'team_cover', versioned: true, errors: [404, 409], summary: 'Ask every cleared worker now (If-Match). Messaging is simulated.' });
export const escalateCover = defineEndpoint({ method: 'POST', path: '/api/v1/rota/cover/:id/escalate', params: ById, response: CoverSaved,
  capability: 'team_cover', versioned: true, errors: [404, 409], summary: 'Escalate to the last fulfilment stage (If-Match)' });
export const assignCover = defineEndpoint({ method: 'POST', path: '/api/v1/rota/cover/:id/assign', params: ById, request: CoverAssign, response: CoverFilled,
  capability: 'team_cover', versioned: true, errors: [404, 409],
  summary: 'Give the shift to one person through the rota week write (eligibility, change log, amendment) and close the request (If-Match: the request)' });
export const fillCover = defineEndpoint({ method: 'POST', path: '/api/v1/rota/cover/:id/fill', params: ById, response: CoverFilled,
  capability: 'team_cover', versioned: true, errors: [404, 409], summary: 'Give the shift to the best eligible person and close the request (If-Match)' });
/* No single capability: claiming needs `claim`, refused with the prototype's text, and the person's own location. */
export const claimCover = defineEndpoint({ method: 'POST', path: '/api/v1/rota/cover/:id/claim', params: ById, response: CoverFilled,
  versioned: true, errors: [404, 409], summary: 'Claim an open shift for yourself (If-Match). Only shifts you are cleared and eligible for can be claimed.' });
export const confirmFilled = defineEndpoint({ method: 'POST', path: '/api/v1/rota/filled/:id/confirm', params: ById, response: FilledConfirmed,
  capability: 'team_cover', versioned: true, errors: [404, 409],
  summary: 'Confirm a filled shift was worked (If-Match). With IT access requests on, this raises one.' });

export const getMyShifts = defineEndpoint({ method: 'GET', path: '/api/v1/rota/my-shifts', query: MyShiftsQuery, response: MyShifts, capability: 'own_shifts',
  summary: 'The signed-in person\'s week once published, their next shift and who is on it, rest days, and open shifts they can claim' });

export const getRotaConfig = defineEndpoint({ method: 'GET', path: '/api/v1/rota/config', response: RotaSetup, capability: 'mod_cfg',
  summary: 'Rota setup: staffing and rest limits, fulfilment stages, safe-worker rules, per-type rota limits' });
export const updateRotaConfig = defineEndpoint({ method: 'PATCH', path: '/api/v1/rota/config', request: UpdateRotaConfig, response: mutation(RotaConfigRecord),
  capability: 'mod_cfg', versioned: true, summary: 'Save Rota setup (If-Match). Types are merged by type code; stages are renumbered.' });
