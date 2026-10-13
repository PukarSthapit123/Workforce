/* Module 3 Rota handlers. Every rule is the group 1 domain's: the handlers build
   its inputs from the store and write its outputs. A rota week is one record
   per location and week (D1), versioned on its own; every cell write goes
   through placeShift (D4, D15), so eligibility, the change log and the move to
   amendment on a live week happen the same way for the grid, accept plan, cover
   assign, cover fill and claim. One audit row per request; a refusal or a fault
   writes nothing, because serve() restores the store. Notifications are stored
   rows (D8). With the Rota module off every endpoint refuses (module-off). */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor, capsFor, requireCapability } from './auth';
import { writeAudit } from './audit';
import { invalid } from './people';
import { notifyEvent } from './notify';
import { approvesIn, chainPeople, walkNow } from './approvals';
import { roleWaiting, type ChainItem, type ChainWalk, type DecisionBlock, type DeciderPerson } from '@/domain/approvals';
import {
  accountOfPerson, accounts, codesOf, effectiveCode, nameOf, people, personByCode, recordAt, scopeOf, today, type Signed, type StoredPerson,
} from './world';
import {
  acceptRotaPlan, addPatternPeople, askAllCover, assignCover, claimCover, clearRotaWeek, confirmFilled, copyRotaWeek, createPattern,
  createShiftType, deletePattern, deleteShiftType, escalateCover, fillCover, generatePattern, getMyShifts, getRotaConfig, getRotaHome, getRotaWeek,
  listCover, listItRequests, listPatterns, listShiftTypes, openCover, planRotaWeek, repeatRotaWeek, setCoverReason, signOffRotaWeek, suggestRotaCell, transitionRotaWeek,
  updatePattern, updateRotaConfig, updateShiftType, writeRotaCell,
  type CoverRecord, type CoverView, type FilledShift, type HoursFlag, type ItRequest, type PatternRecord, type RotaConfigRecord,
  type RotaWeekView, type ShiftTypeRecord, type Suggestion as SuggestionView, type UpdateRotaConfig,
} from '@/contract/rota';
import type { AuditEntry } from '@/contract/audit';
import { dayMinutes, type RotaInput, type TimeEntry } from '@/domain/timesheet';
import { addDays, dayIndex, formatDmy, isWeekStart, isoWeek, periodStart, weekDates, weekLabel } from '@/domain/time';
import {
  COVER_REASONS, DEFAULT_ROTA_CONFIG, CLAIM_NOT_PERMITTED, NOBODY_ELIGIBLE, NO_LANDING, REASON_BEFORE_CLOSE, ACTIVATE_EMPTY, TICK_SOMEONE,
  alreadyOnPattern, amendedAuditText, amendedNotice, applyPattern, assignCheck, claimRefusal, clearAuditText, clearProblem, clearSummary,
  clearWrites, confirmEarlyProblem, confirmProblem, confirmSelfProblem, confirmSummary, copyAuditText, copyProblem, copySummary, copyWeek, coverAskAllMove, coverClosed,
  coverEscalateMove, coverFilledNotice, coverNext, coverReasonMove, coverage, coverageIssueNotice, eligibility, emptyLine, emptyWeek,
  escalationNotice, gapDays, gapsAt, generateActivates, generateAuditText, generateSummary, hoursPosition, ineligibleMessage, isAbsence, isActive, isWorking,
  itRequestFor, itRequestNotice, lineOf, lineRestIssues, minFor, newCover, onRoster, onShift, openCoverProblem, openShiftNotice,
  openShiftsFor, patternGenerateProblem, patternProblem, patternUsage, planSummary, planWeek, publishAuditText, publishNotice,
  publishProblem, publishSummary, publishWeek, recalcShift, renumberStages, repeatAuditText, repeatProblem, repeatSummary, repeatWeek,
  resizeCycle, restNeed, rotaConfigProblem, rotaDayOf, rotaDaysOf, rotaInputFor, rotaPolicyWithholds, rotaState, rotaTransitionProblem, rotaVisible, rotaWeekId,
  rotadHours, setCell, setCells, shiftAssignedNotice, shiftBy, shiftRemovalProblem, shiftTime, shiftTypeProblem, shiftUsage,
  staggerOffsets, suggest, thinnest, typeRotaFor, typesAfterNightChange, typesAfterShiftCreate, typesWithoutShift, rotaKeyCounts,
  type AssignMode, type AssignOutcome, type Candidate, type CellWrite, type PatternPersonInfo, type RotaActor, type RotaChange,
  type RotaDay, type RotaWeekCore, type RotaWorker, type RuleContext, type Suggestion, type WeekLookup,
} from '@/domain/rota';
import { absenceCellWrites, shortDays, type CellPlanWeek, type CoverDay } from '@/domain/leave';

/* ------------------------------------------------------------- the world */
interface Meta { id: string; version: number; updatedAt: string }
/* Module 8 group 4B: a week sent to publish while a later layer of the Rota
   chain applies keeps who sent it and the layers signed so far, until the last
   signs it off or a holder sends it back; sentBack is the last send-back. */
interface WeekSignOff { requestedBy: RotaActor; at: string; signed: { layer: string; by: RotaActor; at: string }[] }
interface WeekSentBack { by: RotaActor; at: string; reason: string }
interface WeekChain { signoff?: WeekSignOff | null; sentBack?: WeekSentBack | null }
type StoredWeek = Meta & RotaWeekCore & WeekChain;
interface Tenant { modules: Record<string, boolean>; flags: Record<string, unknown>; weekStart: string }
interface StoredLocation { code: string; name: string; area?: string; level?: string; minPerShift?: number; active?: boolean }
interface RotaProfile { personCode: string; cleared: boolean; dbsExpiry: string; qualifications: string; favourite: boolean; preferredDays: number[] }
interface StoredDay { entries: TimeEntry[] }

function tenant(): Tenant {
  const t = recordAt(store.coll<Tenant>('tenant'), 'tenant');
  if (!t) throw new Error('the store has no tenant record');
  return t;
}
const flagOn = (k: string) => Boolean(tenant().flags[k]);
/* D9: with the Rota module off the whole module is hidden, and so refused here. */
function requireRota() {
  if (!tenant().modules.R) refuse(403, { code: 'module-off', message: 'Rota is switched off for this organisation.', next: 'An administrator can switch the Rota module on in Qnipay setup.' });
}
function requireFlag(flag: string, what: string) {
  if (!flagOn(flag)) refuse(403, { code: 'feature-off', message: `${what} is switched off for this organisation.`, next: 'An administrator can switch it on in Qnipay setup.' });
}
function config(): RotaConfigRecord {
  return recordAt(store.coll<RotaConfigRecord>('rotaConfig'), 'rotaConfig')
    ?? { id: 'rotaConfig', version: 0, updatedAt: store.now(), ...DEFAULT_ROTA_CONFIG, fulfilStages: [], types: {} };
}
const saveConfig = (c: RotaConfigRecord, changes: Partial<RotaConfigRecord>) => {
  const saved = c.version ? bump(c, changes) : { ...c, ...changes, version: 1, updatedAt: store.now() };
  store.coll<RotaConfigRecord>('rotaConfig')[saved.id] = saved;
  return saved;
};
const shiftColl = () => store.coll<ShiftTypeRecord>('shiftTypes');
const shiftList = () => Object.values(shiftColl()).sort((a, b) => a.start - b.start);
const locations = () => Object.values(store.coll<StoredLocation>('locations'));
const locationBy = (code: string) => locations().find(l => l.code === code);
const locName = (code: string) => nameOf('locations', code);
const by = (s: Signed): RotaActor => { const w = actor(s); return { personCode: w.personCode, name: w.name }; };
const NOT_FOUND = (what: string, next = 'Reload the page.') => refuse(404, { code: 'not-found', message: `That ${what} no longer exists.`, next });

/* ------------------------------------------------------------- scope (D5) */
function requireRotaScope(s: Signed, location: string) {
  const sc = scopeOf(s);
  if (sc.all || sc.location === location) return;
  refuse(403, { code: 'scope', message: `You can manage the rota at ${locName(sc.location)} only.`, next: 'Ask an administrator to make changes at other locations.' });
}
function locationFor(s: Signed, code: string): StoredLocation {
  const l = locationBy(code) ?? NOT_FOUND('location', 'Choose a location from the list.');
  requireRotaScope(s, l.code);
  return l;
}
const manageable = (s: Signed) => {
  const sc = scopeOf(s);
  return locations().filter(l => (sc.all ? l.active !== false : l.code === sc.location)).map(l => ({ code: l.code, name: l.name }));
};
/* "Admins only" withholds pattern and shift-type building from managers, whatever the matrix says (D5). */
function requireBuilder(s: Signed, cap: 'rota_pattern' | 'rota_shift') {
  const userType = accountOfPerson(effectiveCode(s))?.userType ?? s.account.userType;
  if (rotaPolicyWithholds(cap, userType, config().rotaBuiltBy))
    refuse(403, { code: 'rota-policy', message: `Rota setup says only administrators build ${cap === 'rota_pattern' ? 'working patterns' : 'shift types'}.`,
      next: 'Ask an administrator, or change who builds the rota in Rota setup.' });
}
/* A week is named by its first day: a day the tenant's week starts on, or the
   key of a week stored before the week start changed (D4, review C1). */
function requireMonday(loc: string, weekStart: string, field = 'weekStart') {
  if (!isWeekStart(weekStart) && !weekRec(loc, weekStart)) invalid({ field, message: `A week starts on a ${tenant().weekStart}.` });
}

/* ----------------------------------------------------------- the people */
function worker(p: StoredPerson): RotaWorker {
  const prof = recordAt(store.coll<RotaProfile>('rotaProfiles'), `rp_${p.code}`);
  return {
    code: p.code, name: p.name, employeeType: p.employeeType, typeName: nameOf('employeeTypes', p.employeeType), jobProfile: p.jobProfile,
    category: p.category, contractedHours: p.contractedHours, maxHours: p.maxHours, night: p.night,
    cleared: prof?.cleared ?? p.state === 'active', dbsExpiry: prof?.dbsExpiry ?? '', qualifications: prof?.qualifications ?? 'Not yet recorded',
    favourite: prof?.favourite ?? false, preferredDays: prof?.preferredDays ?? [],
  };
}
function ctxFor(p: StoredPerson): RuleContext {
  const c = config();
  return { shifts: shiftList(), typeRota: typeRotaFor(c.types, p.employeeType), config: c, safeWorker: Boolean(tenant().modules.R) && flagOn('SAFEWORKER') };
}
const activeAt = (loc: string) => Object.values(people()).filter(p => p.location === loc && isActive(p));
const rosterOf = (loc: string, week: RotaWeekCore) => Object.values(people()).filter(p => onRoster(p, loc, lineOf(week, p.code)));
const candidatesAt = (loc: string, week: RotaWeekCore): Candidate[] => activeAt(loc).map(p => ({ worker: worker(p), line: lineOf(week, p.code), ctx: ctxFor(p) }));
const minAt = (l: StoredLocation) => minFor(l.minPerShift, flagOn('MINSTAFF'), config());
function personAt(code: string, loc: string, field = 'personCode'): StoredPerson {
  const p = personByCode(code) ?? NOT_FOUND('person record', 'Reload the rota.');
  if (p.location !== loc || !isActive(p))
    refuse(422, { code: 'invalid', field, message: `${p.name} does not work at ${locName(loc)}.`, next: 'Choose someone at this location.' });
  return p;
}
const workedHours = (code: string, ws: string) => weekDates(ws).reduce((n, d) => {
  const t = recordAt(store.coll<StoredDay>('timesheetDays'), `tsd_${code}_${d}`);
  return n + (t ? dayMinutes(t.entries) : 0);
}, 0) / 60;
const suggestionView = (x: Suggestion): SuggestionView =>
  ({ personCode: x.worker.code, name: x.worker.name, category: x.worker.category, score: x.score, why: x.why });

/* ------------------------------------------------------------- the weeks */
const weeks = () => store.coll<StoredWeek>('rotaWeeks');
const weekRec = (loc: string, ws: string) => recordAt(weeks(), rotaWeekId(loc, ws));
const coreOf = (w: StoredWeek): RotaWeekCore => ({ location: w.location, weekStart: w.weekStart, lines: w.lines, state: w.state,
  publishVersion: w.publishVersion, publishedAt: w.publishedAt, publishedBy: w.publishedBy, changes: w.changes });
const weekCore = (loc: string, ws: string): RotaWeekCore => { const w = weekRec(loc, ws); return w ? coreOf(w) : emptyWeek(loc, ws); };
/* the record If-Match is checked against: the stored week, or version 0 for one not stored yet */
const weekMeta = (loc: string, ws: string): Meta => weekRec(loc, ws) ?? { id: rotaWeekId(loc, ws), version: 0, updatedAt: store.now() };
/* Review C1 (D4): a stored week keeps its key when the tenant's week start
   changes, and stays readable. A date belongs to the stored week that covers
   it, the earliest key in the six days up to it, so a week already stored
   keeps all seven of its days. Only a date no stored week covers falls in the
   week the tenant's start gives. */
export function weekOn(loc: string, date: string): { weekStart: string; day: number } {
  for (let back = 6; back >= 0; back--) {
    const ws = addDays(date, -back);
    if (weekRec(loc, ws)) return { weekStart: ws, day: back };
  }
  return { weekStart: periodStart(date), day: dayIndex(date) };
}
/* The dates grouped into the stored weeks that cover them (weekOn), in date
   order: datesCellPlan, but a stored week keeps its days after a change of
   week start (review C1). */
function cellPlanAt(loc: string, dates: readonly string[]): CellPlanWeek[] {
  const out: CellPlanWeek[] = [];
  for (const d of [...new Set(dates)].sort()) {
    const { weekStart, day } = weekOn(loc, d), w = out.find(x => x.weekStart === weekStart);
    if (w) w.days.push(day); else out.push({ location: loc, weekStart, weekId: rotaWeekId(loc, weekStart), days: [day] });
  }
  return out;
}
function saveWeek(core: RotaWeekCore, chain: WeekChain = {}): StoredWeek {
  const id = rotaWeekId(core.location, core.weekStart), old = recordAt(weeks(), id);
  const rec: StoredWeek = old ? bump(old, { ...core, ...chain }) : { id, version: 1, updatedAt: store.now(), ...core, ...chain };
  weeks()[id] = rec;
  return rec;
}
const weekAt: WeekLookup = (loc, ws) => weekRec(loc, ws);

function publications(s: Signed) {
  const mine = new Set(manageable(s).map(l => l.code));
  return Object.values(store.coll<AuditEntry>('audit'))
    .filter(a => a.entity === 'rotaWeek' && (a.act === 'Rota published' || a.act === 'Rota republished'))
    .flatMap(a => {
      const x = a.after as { location?: unknown; weekStart?: unknown; version?: unknown; notified?: unknown } | undefined;
      if (!x || typeof x.location !== 'string' || !mine.has(x.location) || typeof x.weekStart !== 'string') return [];
      return [{ location: x.location, locationName: locName(x.location), weekStart: x.weekStart, version: Number(x.version) || 0, at: a.at, notified: Number(x.notified) || 0 }];
    })
    .sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6);
}

/* -------------------------------- the approval chain (module 8 group 4B) */
/* Publishing walks the Rota approval chain. The rota manager's publish signs
   the first layer that applies, under today's rule (Plan and publish rota at
   the location); every later layer is a sign-off by someone who holds it and
   did not sign an earlier one. A week belongs to its location and to no one,
   so Own department reads as the location. A shift has gone to agency when its
   open cover request has reached the Agency partners stage. */
function agencyIn(loc: string, ws: string): boolean {
  const dates = weekDates(ws), stages = config().fulfilStages;
  return Object.values(covers()).some(c => c.location === loc && c.open && dates.includes(c.date)
    && stages.find(st => st.n === c.stage)?.audience === 'Agency partners');
}
const weekItem = (loc: string, ws: string): ChainItem => ({ personCode: '', location: loc, facts: { agency: agencyIn(loc, ws) } });
const signedOf = (rec: StoredWeek | undefined) => rec?.signoff?.signed ?? [];
const weekWalk = (rec: StoredWeek | undefined, loc: string, ws: string, everyone?: readonly DeciderPerson[]) =>
  walkNow('Rota', weekItem(loc, ws), signedOf(rec).map(x => x.layer), everyone, signedOf(rec).map(x => x.by.personCode));
const waitingOn = (w: ChainWalk) => roleWaiting(w.current?.step.role ?? 'Service Manager');
const upperFirst = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/* Signing off needs a capability that decides some layer of the Rota chain, or a delegation in force from someone who has one. */
function requireRotaApprover(s: Signed) {
  if (!approvesIn('Rota', effectiveCode(s), s.caps)) requireCapability(s, 'team_rota');
}
/* Why the reader may not sign the week off at its current layer. */
function signOffBlocked(why: DecisionBlock, w: ChainWalk, rec: StoredWeek, l: StoredLocation, me: string): { status: number; code: string; message: string; next: string } {
  if (why === 'signed' || why === 'self') return { status: 403, code: 'ALREADY_SIGNED',
    message: rec.signoff?.requestedBy.personCode === me ? 'You sent this week to be published, so someone else signs it off.'
      : 'You signed off an earlier layer of this week, so someone else signs off the next.',
    next: `${upperFirst(waitingOn(w))} signs it off.` };
  if (why === 'scope') return { status: 403, code: 'scope', message: `This week is at ${l.name}, outside the locations you sign off rotas for.`, next: `${upperFirst(waitingOn(w))} there signs it off.` };
  if (why === 'layer') return { status: 403, code: 'WRONG_LAYER', message: `This week is waiting on ${waitingOn(w)}, not on a layer you sign off.`, next: `${upperFirst(waitingOn(w))} signs it off.` };
  const label = store.coll<{ label?: string }>('capabilities').team_rota?.label ?? 'team_rota';
  return { status: 403, code: 'capability', message: `This needs "${label}", which your access does not include.`, next: 'Ask an administrator to grant it on Qnipay setup → Permissions.' };
}
function signoffView(s: Signed, rec: StoredWeek | undefined, l: StoredLocation, ws: string): RotaWeekView['signoff'] {
  const so = rec?.signoff;
  if (!rec || !so) return null;
  const me = effectiveCode(s), { walk, block } = weekWalk(rec, l.code, ws), why = block(me);
  return { requestedBy: so.requestedBy, at: so.at, signed: so.signed, waitingOn: waitingOn(walk), final: walk.final, decide: why === null,
    why: why ? signOffBlocked(why, walk, rec, l, me).message : '' };
}
/* The weeks waiting on the reader's sign-off, at any location. */
function awaitingFor(s: Signed) {
  const me = effectiveCode(s), everyone = chainPeople();
  return Object.values(weeks()).filter(w => w.signoff && w.state === 'review')
    .filter(w => weekWalk(w, w.location, w.weekStart, everyone).block(me) === null)
    .sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.location.localeCompare(b.location))
    .map(w => ({ id: w.id, location: w.location, locationName: locName(w.location), weekStart: w.weekStart, isoWeek: isoWeek(w.weekStart),
      requestedBy: w.signoff?.requestedBy.name ?? '' }));
}
function weekView(s: Signed, l: StoredLocation, ws: string): RotaWeekView {
  const rec = weekRec(l.code, ws), w = rec ? coreOf(rec) : emptyWeek(l.code, ws), cfg = config(), sh = shiftList();
  const roster = rosterOf(l.code, w), lines = roster.map(p => lineOf(w, p.code)), min = minAt(l);
  const rows = roster.map(p => {
    const line = lineOf(w, p.code), ctx = ctxFor(p);
    return { personCode: p.code, name: p.name, jobProfile: p.jobProfile, jobProfileName: nameOf('jobProfiles', p.jobProfile), category: p.category,
      employeeType: p.employeeType, typeName: nameOf('employeeTypes', p.employeeType), contractedHours: p.contractedHours, line,
      hours: hoursPosition(worker(p), line, Number(workedHours(p.code, ws).toFixed(2)), ctx),
      restIssues: cfg.restWarn ? lineRestIssues(line, restNeed(ctx.typeRota, cfg), sh) : [] };
  });
  return {
    id: rotaWeekId(l.code, ws), version: rec?.version ?? 0,
    location: { code: l.code, name: l.name, area: l.area ?? '', level: l.level ?? '', minPerShift: l.minPerShift ?? cfg.minDefault },
    locations: manageable(s), weekStart: ws, label: weekLabel(ws), isoWeek: isoWeek(ws), today: today(),
    prevWeek: weekOn(l.code, addDays(ws, -1)).weekStart, nextWeek: weekOn(l.code, addDays(ws, 7)).weekStart,
    state: w.state, publishVersion: w.publishVersion, publishedAt: w.publishedAt, publishedBy: w.publishedBy, changes: w.changes,
    min, gapDays: gapDays(lines, min), onShift: weekDates(ws).map((_, i) => onShift(lines, i)), coverage: coverage(lines, sh),
    rows, key: rotaKeyCounts(lines), shifts: sh,
    rules: { publishBlockOnGap: cfg.publishBlockOnGap, restWarn: cfg.restWarn, restHours: cfg.restHours, restRule: flagOn('RESTRULE'),
      minStaff: flagOn('MINSTAFF'), safeWorker: flagOn('SAFEWORKER'), fulfil: flagOn('FULFIL'), patterns: flagOn('PATTERNS'),
      horizon: cfg.horizon, outlook: cfg.outlook },
    publications: publications(s),
    signoff: signoffView(s, rec, l, ws), sentBack: w.state === 'draft' ? rec?.sentBack ?? null : null,
  };
}

/* ------------------------------------------------------- notifications (D8) */
const managersAt = (loc: string) => Object.values(accounts())
  .filter(a => personByCode(a.personCode)?.location === loc && capsFor(a).includes('team_rota')).map(a => a.personCode);
const administrators = () => Object.values(accounts()).filter(a => capsFor(a).includes('mod_cfg')).map(a => a.personCode);
function nextNumId(coll: Record<string, unknown>, prefix: string) {
  const re = new RegExp(`^${prefix}_(\\d+)$`);
  let max = 0;
  for (const id of Object.keys(coll)) max = Math.max(max, Number(re.exec(id)?.[1] ?? 0));
  return `${prefix}_${max + 1}`;
}

/* ------------------------------------------- the single assignment path (D4) */
const ASSIGN_NEXT: Record<AssignOutcomeFail['code'], [number, string]> = {
  UNKNOWN_SHIFT: [422, 'Choose a shift from the catalogue.'],
  ON_LEAVE: [409, 'Leave and sickness come from the leave record. Change them there.'],
  UNCHANGED: [409, 'Nothing has been changed.'],
  ROTA_INELIGIBLE: [422, 'Choose someone else, or change the rule in Rota setup.'],
};
type AssignOutcomeFail = Extract<AssignOutcome, { ok: false }>;
function refuseAssign(out: AssignOutcomeFail, field: string): never {
  const [status, next] = ASSIGN_NEXT[out.code];
  return refuse(status, { code: out.code, message: out.message, next, field });
}
interface Placed { week: RotaWeekCore; change: RotaChange; amended: boolean; advisories: HoursFlag[] }
/* Every path that puts somebody on a shift lands here. `assign` never replaces
   a shift already on the day; `change` judges the new shift against the line without the old one. */
function placeShift(week: RotaWeekCore, p: StoredPerson, day: number, code: string, s: Signed, why: string, field: string, mode: AssignMode): Placed {
  const line = lineOf(week, p.code), cur = line[day] ?? '';
  if (mode === 'assign' && isWorking(cur) && cur !== code && shiftBy(shiftList(), code))
    refuse(422, { code: 'ROTA_INELIGIBLE', field, message: ineligibleMessage(p.name, { rule: 'Shift conflict', reason: 'Already working that day' }), next: ASSIGN_NEXT.ROTA_INELIGIBLE[1] });
  const out = assignCheck(worker(p), line, day, code, mode, ctxFor(p));
  if (!out.ok) refuseAssign(out, field);
  const r = setCell(week, { personCode: p.code, name: p.name, day, to: code, by: by(s), at: store.now(), why });
  return { ...r, advisories: out.advisories };
}
/* The colleague's notice for one written cell: an amendment to a live week, or a new shift. */
function noticeFor(p: StoredPerson, week: RotaWeekCore, day: number, code: string, amended: boolean) {
  if (amended) notifyEvent('rt_pub', 'subject', [p.code], amendedNotice(week.weekStart, day));
  else if (code) notifyEvent('rt_assign', 'subject', [p.code], shiftAssignedNotice(shiftList(), code, addDays(week.weekStart, day), locName(week.location)));
}
const cellField = (personCode: string, day: number) => `lines.${personCode}.${day}`;

/* --------------------------------------------------------------- cover */
const covers = () => store.coll<CoverRecord>('coverRequests');
const filledColl = () => store.coll<FilledShift>('filledShifts');
const itColl = () => store.coll<ItRequest>('itRequests');
const eligibleFor = (loc: string, date: string, code: string) => {
  const at = weekOn(loc, date);
  return suggest(at.day, code, candidatesAt(loc, weekCore(loc, at.weekStart))).ok;
};
function coverView(c: CoverRecord): CoverView {
  const sh = shiftList(), ok = c.open ? eligibleFor(c.location, c.date, c.shift) : [];
  return { ...c, locationName: locName(c.location), shiftName: shiftBy(sh, c.shift)?.name ?? c.shift, time: shiftTime(sh, c.shift),
    next: coverNext(c, config().fulfilStages), suggestions: ok.slice(0, 3).map(suggestionView), eligible: ok.length };
}
const filledView = (f: FilledShift) => {
  const sh = shiftList();
  return { ...f, locationName: locName(f.location), shiftName: shiftBy(sh, f.shift)?.name ?? f.shift, time: shiftTime(sh, f.shift) };
};
function createCover(o: { location: string; date: string; shift: string; reason: string; urgent: boolean }, l: StoredLocation): CoverRecord {
  const ok = o.reason ? eligibleFor(o.location, o.date, o.shift) : [];
  const core = newCover(o, config().fulfilStages, store.now(), ok.length, locName(o.location));
  const id = nextNumId(covers(), 'cov'), rec: CoverRecord = { id, version: 1, updatedAt: store.now(), ...core };
  covers()[id] = rec;
  notifyEvent('rt_cov', 'actor', managersAt(o.location), coverageIssueNotice(locName(o.location), o.date, minAt(l)));
  if (o.reason) notifyEvent('rt_cover', 'subject', ok.map(x => x.worker.code), openShiftNotice(shiftList(), o.shift, o.date, locName(o.location)));
  return rec;
}
function coverFor(s: Signed, id: string): CoverRecord {
  const c = recordAt(covers(), id) ?? NOT_FOUND('cover request');
  requireRotaScope(s, c.location);
  return c;
}
const refuseCover = (p: { code: string; message: string; next: string; field?: string }): never =>
  refuse(p.code === 'VALIDATION' ? 422 : 409, { ...p, code: p.code === 'VALIDATION' ? 'invalid' : p.code });
/* D15: the shift goes on through the week path, then the request closes and a filled row waits for confirmation. */
function fillWith(s: Signed, c: CoverRecord, p: StoredPerson, why: string, notifyPerson: boolean) {
  const at = weekOn(c.location, c.date), day = at.day, week = weekCore(c.location, at.weekStart);
  const placed = placeShift(week, p, day, c.shift, s, why, 'personCode', 'assign');
  saveWeek(placed.week);
  if (notifyPerson || placed.amended) noticeFor(p, placed.week, day, c.shift, placed.amended);
  const cover = bump(c, { open: false });
  covers()[c.id] = cover;
  const fid = nextNumId(filledColl(), 'fil');
  const filled: FilledShift = { id: fid, version: 1, updatedAt: store.now(), coverId: c.id, location: c.location, date: c.date, shift: c.shift,
    personCode: p.code, name: p.name, confirmed: false, itRequest: '' };
  filledColl()[fid] = filled;
  return { cover, filled, placed };
}
const coverDetail = (c: Pick<CoverRecord, 'location' | 'date' | 'shift'>, name?: string) =>
  `${name ? `${name} · ` : ''}${locName(c.location)} · ${c.date} · ${shiftBy(shiftList(), c.shift)?.name ?? c.shift}`;

/* ------------------------------------------------------------- patterns */
const patternColl = () => store.coll<PatternRecord>('patterns');
const patternBy = (code: string) => recordAt(patternColl(), `pat_${code}`);
/* Patterns: an administrator (mod_cfg or master_data) builds for any location;
   a manager for their own only, as P's patternBox and patternPersonBox did (D5). */
function patternScope(s: Signed): { all: true } | { all: false; location: string } {
  return s.caps.includes('mod_cfg') ? { all: true } : scopeOf(s);
}
function requirePatternScope(s: Signed, locs: readonly string[], field?: string) {
  const sc = patternScope(s);
  if (sc.all || locs.includes(sc.location)) return;
  refuse(403, { code: 'scope', ...(field ? { field } : {}), message: `This pattern does not cover ${locName(sc.location)}. You can manage patterns for your own location only.`,
    next: 'Ask an administrator to change patterns at other locations.' });
}
/* P: "A manager can only build patterns for the location they manage. An admin can span several." */
function requireOwnLocations(s: Signed, before: readonly string[], after: readonly string[]) {
  const sc = patternScope(s);
  if (sc.all) return;
  const moved = [...after.filter(c => !before.includes(c)), ...before.filter(c => !after.includes(c))];
  if (moved.some(c => c !== sc.location))
    refuse(403, { code: 'scope', field: 'locations', message: 'A manager can only build patterns for the location they manage.',
      next: `Keep the pattern to ${locName(sc.location)}, or ask an administrator to span several locations.` });
}
const notOurs = (name: string, loc: string) => `${name} does not work at ${locName(loc)}. You can put your own team on a pattern only.`;
/* A manager adds and removes only their own people; anyone else already on a shared pattern stays as they are. */
function requireOwnPeople(s: Signed, before: PatternRecord['people'], after: PatternRecord['people']) {
  const sc = patternScope(s);
  if (sc.all) return;
  const had = new Set(before.map(x => x.personCode)), has = new Set(after.map(x => x.personCode));
  after.forEach((x, i) => {
    const q = personByCode(x.personCode);
    if (!had.has(x.personCode) && q && q.location !== sc.location)
      refuse(403, { code: 'scope', field: `people.${i}.personCode`, message: notOurs(q.name, sc.location), next: 'Ask an administrator to add people from other locations.' });
  });
  for (const x of before) {
    const q = personByCode(x.personCode);
    if (!has.has(x.personCode) && q && q.location !== sc.location)
      refuse(403, { code: 'scope', field: 'people', message: `${q.name} does not work at ${locName(sc.location)}. You can take your own team off a pattern only.`,
        next: 'Ask an administrator to change people from other locations.' });
  }
}
function patternsGate(s: Signed) { requireRota(); requireFlag('PATTERNS', 'Working patterns'); requireBuilder(s, 'rota_pattern'); }
function patternFor(s: Signed, code: string): PatternRecord {
  patternsGate(s);
  const p = patternBy(code) ?? NOT_FOUND('working pattern');
  requirePatternScope(s, p.locations);
  return p;
}
function checkPatternRefs(p: Pick<PatternRecord, 'locations' | 'jobProfiles' | 'people'>) {
  const locs = codesOf('locations'), jobs = codesOf('jobProfiles');
  const badLoc = p.locations.findIndex(c => !locs.includes(c));
  if (badLoc >= 0) invalid({ field: `locations.${badLoc}`, message: `There is no location with the code ${p.locations[badLoc] ?? ''}.` });
  const badJob = p.jobProfiles.findIndex(c => !jobs.includes(c));
  if (badJob >= 0) invalid({ field: `jobProfiles.${badJob}`, message: `There is no job profile with the code ${p.jobProfiles[badJob] ?? ''}.` });
  const seen = new Set<string>();
  p.people.forEach((x, i) => {
    if (!personByCode(x.personCode)) invalid({ field: `people.${i}.personCode`, message: `There is no person with the employee ID ${x.personCode}.` });
    if (seen.has(x.personCode)) invalid({ field: `people.${i}.personCode`, message: `${x.personCode} is on this pattern twice.` });
    seen.add(x.personCode);
  });
}
function nextPatternCode() {
  let max = 0;
  for (const p of Object.values(patternColl())) max = Math.max(max, Number(/^WP-(\d+)$/.exec(p.code)?.[1] ?? 0));
  return `WP-${String(max + 1).padStart(2, '0')}`;
}
const diff = <T extends object>(was: T, is: T, keys: readonly (keyof T)[]) => {
  const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
  for (const k of keys) if (JSON.stringify(was[k]) !== JSON.stringify(is[k])) { before[String(k)] = was[k]; after[String(k)] = is[k]; }
  return { before, after };
};

/* ---------------------------------------------- the timesheet's rota line (D13, D16) */
/* The person's cell for that date in their location's week, once that week has
   been published (D14: an unpublished plan is not shown to the employee, so it
   does not reach their timesheet either). Rest, leave and sickness are not a line. */
export function rotaInputOn(personCode: string, date: string): RotaInput | undefined {
  const p = personByCode(personCode), at = p ? weekOn(p.location, date) : undefined;
  const w = p && at ? weekRec(p.location, at.weekStart) : undefined;
  if (!p || !at || !w || !rotaVisible(w.state)) return undefined;
  const c = config();
  return rotaInputFor(lineOf(w, p.code), at.day, { shifts: shiftList(), typeRota: typeRotaFor(c.types, p.employeeType), config: c,
    typeName: nameOf('employeeTypes', p.employeeType) });
}

/* What the timesheet shows of the rota (D13, D14, D16): the person's published
   week, Monday first. Nothing while the Rota module is off or the week is a
   draft or in review, so an unpublished plan never reaches a timesheet. */
const visibleWeek = (loc: string, ws: string) => {
  if (!tenant().modules.R) return undefined;
  const w = weekRec(loc, ws);
  return w && rotaVisible(w.state) ? w : undefined;
};
/* One date's published rota day for the person, from the stored week that
   covers it (review C1); nothing while that week is not published. */
export function rotaDayOn(personCode: string, date: string): RotaDay | undefined {
  const p = personByCode(personCode), at = p ? weekOn(p.location, date) : undefined;
  const w = p && at ? visibleWeek(p.location, at.weekStart) : undefined;
  return p && at && w ? rotaDayOf(lineOf(w, p.code)[at.day] ?? '', shiftList()) : undefined;
}
/* The seven days from weekStart, each from the stored week that covers it: a
   week that straddles a change of week start reads from both. */
export function rotaDaysFor(personCode: string, weekStart: string): (RotaDay | undefined)[] | undefined {
  const days = weekDates(weekStart).map(d => rotaDayOn(personCode, d));
  return days.some(Boolean) ? days : undefined;
}
/* The tone a shift is painted in on My home's month (toneOf); a code no
   longer in the catalogue reads as Early, as the prototype's toneOf does. */
export function rotaToneOf(code: string): 'E' | 'L' | 'N' {
  const t = shiftBy(shiftList(), code)?.tone;
  return t === 'L' || t === 'N' ? t : 'E';
}
/* Everyone on a location's published week, by person code, for the approver's matrix. */
export function rotaWeekDays(location: string, weekStart: string): Record<string, RotaDay[]> {
  const sh = shiftList(), w = visibleWeek(location, weekStart);
  if (w) return Object.fromEntries(Object.keys(w.lines).map(code => [code, rotaDaysOf(lineOf(w, code), sh)]));
  /* a week that straddles a change of week start (review C1): each day from the stored week covering it */
  const at = weekDates(weekStart).map(d => { const a = weekOn(location, d); return { day: a.day, w: visibleWeek(location, a.weekStart) }; });
  const codes = [...new Set(at.flatMap(x => (x.w ? Object.keys(x.w.lines) : [])))];
  return Object.fromEntries(codes.map(code => [code, at.map(x => rotaDayOf(x.w ? lineOf(x.w, code)[x.day] ?? '' : '', sh))]));
}
/* The catalogue as the timesheet's Rota line options, while the Rota module is on. */
export const rotaLineOptions = () => (tenant().modules.R ? shiftList().map(s => ({ code: s.code, name: s.name, from: s.from, to: s.to })) : undefined);

/* ------------------------------------------- leave and sickness (module 4 D7) */
/* The effect on cover of someone being away on these dates: each day in a
   stored week at their location, with how many are on shift, whether they are
   one of them, and the minimum. A week not stored yet has nothing to say. */
export function rotaCoverDays(personCode: string, dates: readonly string[]): CoverDay[] {
  const p = personByCode(personCode), l = p ? locationBy(p.location) : undefined;
  if (!p || !l) return [];
  return dates.flatMap(date => {
    const at = weekOn(l.code, date), w = weekRec(l.code, at.weekStart);
    if (!w) return [];
    const day = at.day, lines = rosterOf(l.code, w).map(x => lineOf(w, x.code));
    return [{ date, onShift: onShift(lines, day), working: isWorking(lineOf(w, p.code)[day]), min: minAt(l) }];
  });
}
export interface AbsenceWritten { written: number; weeks: string[]; amended: boolean; covers: string[] }
/* Leave or sickness reaching the rota (module 4 D7) through the same week path
   as every other cell write: setCells keeps the change log and moves a live
   week to amendment, a week not stored yet is created as a draft, and the
   colleague hears about an amended week. A day the person was working that now
   falls below the minimum opens one cover request (FULFIL), deduplicated as
   module 3 D7. The caller gates on Rota and LV_ROTA and writes the audit row. */
export function writeAbsence(o: { personCode: string; dates: readonly string[]; mark: string; by: RotaActor; coverReason: string }): AbsenceWritten {
  const out: AbsenceWritten = { written: 0, weeks: [], amended: false, covers: [] };
  const p = personByCode(o.personCode), l = p ? locationBy(p.location) : undefined;
  if (!p || !l) return out;
  const sh = shiftList();
  for (const plan of cellPlanAt(l.code, o.dates)) {
    const week = weekCore(l.code, plan.weekStart), line = lineOf(week, p.code);
    const writes = absenceCellWrites(plan, { code: p.code, name: p.name }, o.mark, o.by, store.now()).filter(w => line[w.day] !== o.mark);
    if (!writes.length) continue;
    const r = setCells(week, writes);
    saveWeek(r.week);
    out.written += writes.length; out.weeks.push(plan.weekId); out.amended ||= r.amended;
    const first = writes[0];
    if (r.amended && first) notifyEvent('rt_pub', 'subject', [p.code], amendedNotice(plan.weekStart, first.day));
    if (!flagOn('FULFIL')) continue;
    const dropped = writes.filter(w => isWorking(line[w.day])).map(w => w.day);
    const lines = rosterOf(l.code, r.week).map(x => lineOf(r.week, x.code));
    for (const day of shortDays(lines, dropped, minAt(l))) {
      const date = addDays(plan.weekStart, day), code = thinnest(day, lines, sh);
      if (!code || openCoverProblem(Object.values(covers()), l.code, date, code, sh)) continue;
      out.covers.push(createCover({ location: l.code, date, shift: code, reason: o.coverReason, urgent: false }, l).id);
    }
  }
  return out;
}

const r2 = (n: number) => Number(n.toFixed(2));

export const rotaHandlers = [
  /* ------------------------------------------------------------ the week */
  serve(getRotaHome, ({ session }) => {
    requireRota();
    const ls = manageable(session), sc = scopeOf(session), now = today();
    const own = sc.all ? personByCode(effectiveCode(session))?.location : sc.location;
    const location = ls.find(l => l.code === own)?.code ?? ls[0]?.code ?? '';
    const awaiting = awaitingFor(session);
    return { locations: ls, location, today: now, weekStart: location ? weekOn(location, now).weekStart : periodStart(now), ...(awaiting.length ? { awaiting } : {}) };
  }),

  serve(getRotaWeek, ({ session, params }) => {
    requireRota();
    const l = locationFor(session, params.location);
    requireMonday(l.code, params.weekStart);
    return weekView(session, l, params.weekStart);
  }),

  serve(writeRotaCell, ({ session, params, body, checkVersion }) => {
    requireRota();
    const l = locationFor(session, params.location), ws = params.weekStart;
    requireMonday(l.code, ws);
    checkVersion(weekMeta(l.code, ws));
    const p = personAt(body.personCode, l.code), week = weekCore(l.code, ws), field = cellField(p.code, body.day);
    const cur = lineOf(week, p.code)[body.day] ?? '', sh = shiftList();
    let placed: Placed;
    if (body.code === '') {
      if (isAbsence(cur)) refuseAssign({ ok: false, code: 'ON_LEAVE', message: `${p.name} is down as ${cur === 'V' ? 'on leave' : 'off sick'} that day.` }, field);
      if (!cur) refuse(409, { code: 'UNCHANGED', field, message: `${p.name} has no shift that day.`, next: ASSIGN_NEXT.UNCHANGED[1] });
      placed = { ...setCell(week, { personCode: p.code, name: p.name, day: body.day, to: '', by: by(session), at: store.now(), why: body.why?.trim() || 'Removed' }), advisories: [] };
    } else {
      placed = placeShift(week, p, body.day, body.code, session, body.why?.trim() || (isWorking(cur) ? 'Changed' : 'Assigned'), field, isWorking(cur) ? 'change' : 'assign');
    }
    saveWeek(placed.week);
    noticeFor(p, placed.week, body.day, body.code, placed.amended);
    /* a removal that leaves the day short opens cover on its thinnest shift (FULFIL) */
    let cover: CoverRecord | null = null;
    if (body.code === '' && flagOn('FULFIL')) {
      const lines = rosterOf(l.code, placed.week).map(x => lineOf(placed.week, x.code)), min = minAt(l);
      const date = addDays(ws, body.day), code = thinnest(body.day, lines, sh);
      if (code && onShift(lines, body.day) < min && !openCoverProblem(Object.values(covers()), l.code, date, code, sh))
        cover = createCover({ location: l.code, date, shift: code, reason: '', urgent: false }, l);
    }
    const c = placed.change;
    const detail = placed.amended ? amendedAuditText(l.name, placed.week, c, sh)
      : `${p.name} · ${c.date} · ${c.from || 'nothing'} → ${c.to || 'nothing'}`;
    const auditId = writeAudit({ who: actor(session), act: placed.amended ? 'Published rota amended' : body.code ? 'Shift assigned' : 'Shift removed',
      entity: 'rotaWeek', entityId: rotaWeekId(l.code, ws), before: { [c.personCode]: { [c.date]: c.from } },
      after: { [c.personCode]: { [c.date]: c.to }, state: placed.week.state, detail, ...(cover ? { coverOpened: cover.id } : {}) } });
    return { week: weekView(session, l, ws), advisories: placed.advisories, cover: cover ? coverView(cover) : null, auditId };
  }),

  serve(transitionRotaWeek, ({ session, params, body, checkVersion }) => {
    requireRota();
    const l = locationFor(session, params.location), ws = params.weekStart;
    requireMonday(l.code, ws);
    checkVersion(weekMeta(l.code, ws));
    const w = weekCore(l.code, ws), rec = weekRec(l.code, ws);
    if (body.to === 'published') {
      /* module 8: a week already waiting on sign-off is signed off by its holder, not published again */
      if (rec?.signoff) {
        const waiting = waitingOn(weekWalk(rec, l.code, ws).walk);
        refuse(409, { code: 'AWAITING_SIGNOFF', message: `Week ${isoWeek(ws)} is waiting on sign-off by ${waiting}.`,
          next: `${upperFirst(waiting)} signs it off or sends it back. You can return it to draft.` });
      }
      const roster = rosterOf(l.code, w);
      const problem = publishProblem(w, gapsAt(roster.map(p => lineOf(w, p.code)), minAt(l)), config().publishBlockOnGap);
      if (problem) refuse(409, problem);
      /* Module 8: publishing signs the chain's first layer that applies. With a later layer to
         come, the week goes to review until that layer signs it off. An amended week is
         already in front of colleagues, so it republishes as before. */
      const walk = w.state === 'amendment' ? null : weekWalk(undefined, l.code, ws).walk;
      if (walk?.current && !walk.final) {
        const who = by(session), at = store.now();
        const saved = saveWeek({ ...w, state: 'review' }, { signoff: { requestedBy: who, at, signed: [{ layer: walk.current.step.role, by: who, at }] }, sentBack: null });
        const next = weekWalk(saved, l.code, ws).walk, waiting = waitingOn(next);
        notifyEvent('rt_pub', 'actor', (next.current?.deciders ?? []).filter(c => c !== who.personCode),
          { title: 'Rota waiting on your sign-off', body: `${l.name} · ${formatDmy(ws)} – ${formatDmy(addDays(ws, 6))}. Sent to publish by ${who.name}.` });
        const auditId = writeAudit({ who: actor(session), act: 'Rota sent for sign-off', entity: 'rotaWeek', entityId: rotaWeekId(l.code, ws),
          before: { state: w.state }, after: { state: 'review', layer: walk.current.step.role, detail: `${l.name} · week ${isoWeek(ws)} · waiting on ${waiting}` } });
        return { week: weekView(session, l, ws), summary: `Week ${isoWeek(ws)} sent for sign-off. It is published once ${waiting} signs it off.`, auditId };
      }
      const r = publishWeek(w, by(session), store.now());
      saveWeek(r.week, { signoff: null, sentBack: null });
      notifyEvent('rt_pub', 'subject', roster.map(p => p.code), publishNotice(l.name, ws, r.version, r.republished));
      const auditId = writeAudit({ who: actor(session), act: r.republished ? 'Rota republished' : 'Rota published', entity: 'rotaWeek',
        entityId: rotaWeekId(l.code, ws), before: { state: w.state, version: w.publishVersion },
        after: { location: l.code, weekStart: ws, state: r.week.state, version: r.version, notified: roster.length, detail: publishAuditText(l.name, ws, r.version, r.amended) } });
      return { week: weekView(session, l, ws), summary: publishSummary(r.version, roster.length, r.amended, r.republished), auditId };
    }
    const problem = rotaTransitionProblem(w.state, body.to);
    if (problem) refuse(409, problem);
    /* returning a week to draft withdraws it from sign-off */
    saveWeek({ ...w, state: body.to }, { signoff: null, sentBack: null });
    const label = rotaState(body.to).label;
    const auditId = writeAudit({ who: actor(session), act: body.to === 'review' ? 'Rota sent for review' : 'Rota returned to draft', entity: 'rotaWeek',
      entityId: rotaWeekId(l.code, ws), before: { state: w.state }, after: { state: body.to, detail: `${l.name} · week ${isoWeek(ws)} · ${label}` } });
    return { week: weekView(session, l, ws), summary: `Week ${isoWeek(ws)} · ${label}`, auditId };
  }),

  /* Module 8 group 4B: the sign-off holder's decision on a week waiting on the Rota chain. */
  serve(signOffRotaWeek, ({ session, params, body, checkVersion }) => {
    requireRota(); requireRotaApprover(session);
    const l = locationBy(params.location) ?? NOT_FOUND('location', 'Choose a location from the list.'), ws = params.weekStart;
    requireMonday(l.code, ws);
    const rec = weekRec(l.code, ws);
    if (!rec?.signoff || rec.state !== 'review') return refuse(409, {
      code: 'NOT_AWAITING_SIGNOFF', message: `Week ${isoWeek(ws)} at ${l.name} is not waiting on sign-off.`, next: 'Reload the rota.' });
    const me = effectiveCode(session), { walk, block } = weekWalk(rec, l.code, ws), why = block(me);
    if (why) { const { status, ...r } = signOffBlocked(why, walk, rec, l, me); refuse(status, r); }
    checkVersion(rec);
    const w = coreOf(rec), who = by(session), at = store.now(), layer = walk.current?.step.role ?? 'Service Manager';
    const requester = rec.signoff?.requestedBy, signed = signedOf(rec);
    if (body.to === 'draft') {
      const reason = (body.reason ?? '').trim();
      if (!reason) invalid({ field: 'reason', message: 'Give a reason for sending it back. The rota manager sees it.' });
      saveWeek({ ...w, state: 'draft' }, { signoff: null, sentBack: { by: who, at, reason } });
      if (requester && requester.personCode !== me)
        notifyEvent('rt_pub', 'actor', [requester.personCode], { title: 'Rota sent back', body: `${l.name} · week ${isoWeek(ws)}. Sent back by ${who.name}: "${reason}".` });
      const auditId = writeAudit({ who: actor(session), act: 'Rota sent back', entity: 'rotaWeek', entityId: rec.id, before: { state: 'review', layer },
        after: { state: 'draft', detail: `${l.name} · week ${isoWeek(ws)} · sent back as ${layer}` }, reason });
      return { week: weekView(session, l, ws), summary: `Week ${isoWeek(ws)} sent back to ${requester?.name ?? 'the rota manager'}.`, auditId };
    }
    const nowSigned = [...signed, { layer, by: who, at }];
    if (!walk.final) {
      const saved = saveWeek(w, { signoff: { requestedBy: requester ?? who, at: rec.signoff?.at ?? at, signed: nowSigned } });
      const next = weekWalk(saved, l.code, ws).walk, waiting = waitingOn(next);
      notifyEvent('rt_pub', 'actor', (next.current?.deciders ?? []).filter(c => c !== me),
        { title: 'Rota waiting on your sign-off', body: `${l.name} · ${formatDmy(ws)} – ${formatDmy(addDays(ws, 6))}. Signed off by ${who.name}, now waiting on ${waiting}.` });
      const auditId = writeAudit({ who: actor(session), act: 'Rota signed off', entity: 'rotaWeek', entityId: rec.id, before: { state: 'review', layer },
        after: { state: 'review', layer: next.current?.step.role ?? '', detail: `${l.name} · week ${isoWeek(ws)} · signed off as ${layer} · now waiting on ${waiting}` } });
      return { week: weekView(session, l, ws), summary: `Week ${isoWeek(ws)} signed off. It now waits on ${waiting}.`, auditId };
    }
    /* the last layer: published, as the rota manager's publish would have been */
    const roster = rosterOf(l.code, w);
    const problem = publishProblem(w, gapsAt(roster.map(p => lineOf(w, p.code)), minAt(l)), config().publishBlockOnGap);
    if (problem) refuse(409, problem);
    const r = publishWeek(w, who, at);
    saveWeek(r.week, { signoff: null, sentBack: null });
    notifyEvent('rt_pub', 'subject', roster.map(p => p.code), publishNotice(l.name, ws, r.version, r.republished));
    if (requester && requester.personCode !== me)
      notifyEvent('rt_pub', 'actor', [requester.personCode], { title: 'Rota signed off', body: `${l.name} · week ${isoWeek(ws)}. Signed off by ${who.name} and published.` });
    const auditId = writeAudit({ who: actor(session), act: 'Rota published', entity: 'rotaWeek', entityId: rec.id, before: { state: 'review', version: w.publishVersion },
      after: { location: l.code, weekStart: ws, state: r.week.state, version: r.version, notified: roster.length,
        detail: `${publishAuditText(l.name, ws, r.version, r.amended)} · signed off as ${layer}` } });
    return { week: weekView(session, l, ws), summary: `${publishSummary(r.version, roster.length, r.amended, r.republished)} · signed off`, auditId };
  }),

  serve(copyRotaWeek, ({ session, params, checkVersion }) => {
    requireRota();
    const l = locationFor(session, params.location), ws = params.weekStart, src = addDays(ws, -7);
    requireMonday(l.code, ws);
    checkVersion(weekMeta(l.code, ws));
    const target = weekCore(l.code, ws), slot = weekRec(l.code, src), roster = activeAt(l.code).map(p => p.code);
    const problem = copyProblem(target, slot, roster);
    if (problem) refuse(409, problem);
    if (!slot) throw new Error('copyProblem passed without a source week');
    const r = copyWeek(slot, target, roster);
    const counts = { written: r.written, occupied: r.occupied, absence: r.absence };
    if (!r.written) return { ...counts, week: weekView(session, l, ws), summary: copySummary(0, r.occupied, src), auditId: null };
    saveWeek({ ...target, lines: r.lines });
    const auditId = writeAudit({ who: actor(session), act: 'Rota week copied', entity: 'rotaWeek', entityId: rotaWeekId(l.code, ws), before: null,
      after: { ...counts, from: src, detail: copyAuditText(l.name, src, ws, r.written) } });
    return { ...counts, week: weekView(session, l, ws), summary: copySummary(r.written, r.occupied, src), auditId };
  }),

  serve(repeatRotaWeek, ({ session, params, body, checkVersion }) => {
    requireRota();
    const l = locationFor(session, params.location), ws = params.weekStart;
    requireMonday(l.code, ws);
    checkVersion(weekMeta(l.code, ws));
    const src = weekRec(l.code, ws), roster = activeAt(l.code).map(p => p.code);
    const problem = repeatProblem(src, roster, body.weeks);
    if (problem) invalid(problem);
    if (!src) throw new Error('repeatProblem passed without a source week');
    const r = repeatWeek(l.code, ws, src, roster, body.weeks, weekAt);
    const out = { written: r.written, occupied: r.occupied, absence: r.absence, live: r.live, weeks: r.weeks, summary: repeatSummary(r) };
    if (!r.written) return { ...out, week: weekView(session, l, ws), auditId: null };
    for (const w of r.writes) saveWeek({ ...weekCore(w.location, w.weekStart), lines: w.lines });
    const auditId = writeAudit({ who: actor(session), act: 'Rota week repeated', entity: 'rotaWeek', entityId: rotaWeekId(l.code, ws), before: null,
      after: { written: r.written, occupied: r.occupied, absence: r.absence, live: r.live, weeks: r.writes.map(w => w.weekStart), detail: repeatAuditText(l.name, ws, body.weeks, r) } });
    return { ...out, week: weekView(session, l, ws), auditId };
  }),

  serve(clearRotaWeek, ({ session, params, checkVersion }) => {
    requireRota();
    const l = locationFor(session, params.location), ws = params.weekStart;
    requireMonday(l.code, ws);
    checkVersion(weekMeta(l.code, ws));
    const w = weekCore(l.code, ws), roster = activeAt(l.code).map(p => p.code);
    const problem = clearProblem(w, roster, l.name);
    if (problem) refuse(409, problem);
    const names = new Map(Object.values(people()).map(p => [p.code, p.name]));
    const writes: CellWrite[] = clearWrites(w.lines, roster, names, by(session), store.now());
    const r = setCells(w, writes);
    saveWeek(r.week);
    const auditId = writeAudit({ who: actor(session), act: 'Rota week cleared', entity: 'rotaWeek', entityId: rotaWeekId(l.code, ws),
      before: { shifts: writes.length }, after: { shifts: 0, detail: clearAuditText(l.name, ws, writes.length) } });
    return { week: weekView(session, l, ws), cleared: writes.length, summary: clearSummary(writes.length, ws), auditId };
  }),

  serve(planRotaWeek, ({ session, params }) => {
    requireRota();
    const l = locationFor(session, params.location), ws = params.weekStart;
    requireMonday(l.code, ws);
    const items = planWeek(candidatesAt(l.code, weekCore(l.code, ws)), minAt(l), shiftList())
      .map(x => (x.none ? { day: x.day, code: x.code, none: true, personCode: '', name: '', why: [] } : { ...x }));
    return { items, summary: planSummary(items.filter(x => !x.none).length) };
  }),

  serve(acceptRotaPlan, ({ session, params, body, checkVersion }) => {
    requireRota();
    const l = locationFor(session, params.location), ws = params.weekStart;
    requireMonday(l.code, ws);
    checkVersion(weekMeta(l.code, ws));
    let week = weekCore(l.code, ws), amended = false;
    const advisories: HoursFlag[] = [], placedAll: { p: StoredPerson; day: number; code: string }[] = [];
    body.items.forEach((it, i) => {
      const p = personAt(it.personCode, l.code, `items.${i}.personCode`);
      const placed = placeShift(week, p, it.day, it.code, session, 'Accepted from the plan', `items.${i}`, 'assign');
      week = placed.week; amended ||= placed.amended;
      advisories.push(...placed.advisories);
      placedAll.push({ p, day: it.day, code: it.code });
    });
    saveWeek(week);
    for (const x of placedAll) noticeFor(x.p, week, x.day, x.code, amended);
    const n = placedAll.length;
    const auditId = writeAudit({ who: actor(session), act: amended ? 'Published rota amended' : 'Shifts assigned from the plan', entity: 'rotaWeek',
      entityId: rotaWeekId(l.code, ws), before: null,
      after: { assigned: placedAll.map(x => `${x.p.code} ${addDays(ws, x.day)} ${x.code}`), state: week.state, detail: `${l.name} · week ${isoWeek(ws)} · ${n} shift(s) assigned` } });
    return { week: weekView(session, l, ws), advisories, summary: `${n} shift(s) assigned from the plan`, auditId };
  }),

  serve(suggestRotaCell, ({ session, params, query }) => {
    requireRota();
    const l = locationFor(session, params.location), ws = params.weekStart;
    requireMonday(l.code, ws);
    if (!shiftBy(shiftList(), query.code)) invalid({ field: 'code', message: `There is no shift type with the code ${query.code}.` });
    const r = suggest(query.day, query.code, candidatesAt(l.code, weekCore(l.code, ws)));
    return { day: query.day, code: query.code, ok: r.ok.map(suggestionView),
      no: r.no.map(x => ({ personCode: x.worker.code, name: x.worker.name, rule: x.rule, reason: x.reason })) };
  }),

  /* --------------------------------------------------------- shift types */
  serve(listShiftTypes, () => {
    requireRota();
    const lines = Object.values(weeks()).flatMap(w => Object.values(w.lines)), pats = Object.values(patternColl());
    const items = shiftList();
    return { items, usage: Object.fromEntries(items.map(s => [s.code, { rota: shiftUsage(s.code, lines), patterns: patternUsage(s.code, pats) }])) };
  }),

  serve(createShiftType, ({ session, body }) => {
    requireRota(); requireBuilder(session, 'rota_shift');
    const input = { ...body, code: body.code.trim().toUpperCase(), name: body.name.trim() };
    const problem = shiftTypeProblem(input, shiftList().map(s => s.code), true);
    if (problem) invalid(problem);
    const s = recalcShift(input) ?? invalid({ field: 'from', message: 'Use a 24-hour time such as 16:00.' });
    const rec: ShiftTypeRecord = { id: `sht_${s.code}`, version: 1, updatedAt: store.now(), ...s };
    shiftColl()[rec.id] = rec;
    if (body.eligibleAll) { const c = config(); saveConfig(c, { types: typesAfterShiftCreate(c.types, s, true) }); }
    const auditId = writeAudit({ who: actor(session), act: 'Shift type added', entity: 'shiftType', entityId: rec.id, before: null,
      after: { code: s.code, name: s.name, from: s.from, to: s.to, hours: s.hours, night: s.night, eligibleAll: Boolean(body.eligibleAll) } });
    return { record: rec, auditId };
  }),

  serve(updateShiftType, ({ session, params, body, checkVersion }) => {
    requireRota(); requireBuilder(session, 'rota_shift');
    const rec = recordAt(shiftColl(), `sht_${params.code}`) ?? NOT_FOUND('shift type');
    checkVersion(rec);
    const input = { code: rec.code, name: body.name?.trim() ?? rec.name, from: body.from ?? rec.from, to: body.to ?? rec.to,
      breakMinutes: body.breakMinutes ?? rec.breakMinutes, night: body.night ?? rec.night, tone: body.tone ?? rec.tone };
    const problem = shiftTypeProblem(input, shiftList().map(s => s.code), false);
    if (problem) invalid(problem);
    const s = recalcShift(input) ?? invalid({ field: 'from', message: 'Use a 24-hour time such as 16:00.' });
    const keys = ['name', 'from', 'to', 'breakMinutes', 'night', 'tone', 'hours'] as const;
    const { before, after } = diff(rec, { ...rec, ...s }, keys);
    if (!Object.keys(after).length) return { record: rec, auditId: null };
    const saved = bump(rec, s);
    shiftColl()[rec.id] = saved;
    if (s.night && !rec.night) { const c = config(); saveConfig(c, { types: typesAfterNightChange(c.types, s.code, true) }); }
    const auditId = writeAudit({ who: actor(session), act: 'Shift type changed', entity: 'shiftType', entityId: rec.id, before, after });
    return { record: saved, auditId };
  }),

  serve(deleteShiftType, ({ session, params, checkVersion }) => {
    requireRota(); requireBuilder(session, 'rota_shift');
    const rec = recordAt(shiftColl(), `sht_${params.code}`) ?? NOT_FOUND('shift type');
    checkVersion(rec);
    const rotaDays = shiftUsage(rec.code, Object.values(weeks()).flatMap(w => Object.values(w.lines)));
    const usingPatterns = Object.values(patternColl()).filter(p => p.days.includes(rec.code));
    const patternDays = patternUsage(rec.code, usingPatterns);
    const problem = shiftRemovalProblem(rec, shiftList().length, rotaDays, patternDays);
    if (problem && (rotaDays || patternDays))
      refuse(409, { code: 'IN_USE', field: problem.field, message: problem.message, next: 'Change those rota and pattern days to another shift, then remove it.',
        usedBy: [{ kind: 'rota days', count: rotaDays, examples: [] }, { kind: 'pattern days', count: patternDays, examples: usingPatterns.slice(0, 3).map(p => p.name) }] });
    if (problem) refuse(409, { code: 'LAST_SHIFT_TYPE', field: problem.field, message: problem.message, next: 'Add another shift type first.' });
    Reflect.deleteProperty(shiftColl(), rec.id);
    const c = config();
    saveConfig(c, { types: typesWithoutShift(c.types, rec.code) });
    const auditId = writeAudit({ who: actor(session), act: 'Shift type removed', entity: 'shiftType', entityId: rec.id,
      before: { code: rec.code, name: rec.name, from: rec.from, to: rec.to }, after: null });
    return { code: rec.code, auditId };
  }),

  /* ------------------------------------------------------------ patterns */
  serve(listPatterns, ({ session }) => {
    patternsGate(session);
    const sc = patternScope(session);
    const items = Object.values(patternColl()).filter(p => sc.all || p.locations.includes(sc.location));
    const ppl = Object.values(people()).filter(p => isActive(p) && (sc.all || p.location === sc.location))
      .map(p => ({ code: p.code, name: p.name, location: p.location, jobProfile: p.jobProfile, category: p.category }));
    const canCover = locations().filter(l => (sc.all ? l.active !== false : l.code === sc.location)).map(l => ({ code: l.code, name: l.name }));
    /* the people requireOwnPeople keeps a manager from taking off */
    const elsewhere = sc.all ? [] : [...new Set(items.flatMap(p => p.people.map(x => x.personCode)))]
      .filter(code => { const q = personByCode(code); return !!q && q.location !== sc.location; });
    return { items, people: ppl, canCover, today: today(), elsewhere };
  }),

  serve(createPattern, ({ session, body }) => {
    patternsGate(session);
    const base = body.base ? patternBy(body.base) ?? NOT_FOUND('working pattern to copy') : undefined;
    if (base) requirePatternScope(session, base.locations, 'base');
    requireOwnLocations(session, [], body.locations);
    const cycle = body.cycle;
    const days = body.days ?? (base ? resizeCycle(base, cycle).days : Array.from({ length: Math.max(0, Math.min(28, cycle)) }, () => ''));
    const draft = { code: nextPatternCode(), name: body.name.trim(), cycle, locations: body.locations, jobProfiles: body.jobProfiles,
      costCentre: body.costCentre, starts: body.starts, horizon: body.horizon, gen: body.gen, genFrom: body.genFrom ?? '', genTo: body.genTo ?? '',
      active: false, days, people: [] };
    requirePatternScope(session, draft.locations);
    checkPatternRefs(draft);
    const problem = patternProblem(draft, shiftList().map(s => s.code));
    if (problem) invalid(problem);
    const rec: PatternRecord = { id: `pat_${draft.code}`, version: 1, updatedAt: store.now(), ...draft };
    patternColl()[rec.id] = rec;
    const auditId = writeAudit({ who: actor(session), act: 'Working pattern added', entity: 'pattern', entityId: rec.id, before: null,
      after: { code: rec.code, name: rec.name, cycle: rec.cycle, locations: rec.locations, ...(base ? { copiedFrom: base.code } : {}) } });
    return { record: rec, auditId };
  }),

  serve(updatePattern, ({ session, params, body, checkVersion }) => {
    const p = patternFor(session, params.code);
    checkVersion(p);
    let next: PatternRecord = { ...p, ...body, ...(body.name !== undefined ? { name: body.name.trim() } : {}) };
    if (body.cycle !== undefined && body.days === undefined && body.cycle >= 1 && body.cycle <= 28) next = resizeCycle({ ...next, days: p.days, people: body.people ?? p.people }, body.cycle);
    if (body.active === true && !next.days.some(c => !!c)) refuse(422, { code: 'ACTIVATE_EMPTY', field: 'days', message: ACTIVATE_EMPTY, next: 'Put a shift on at least one day of the cycle.' });
    requireOwnLocations(session, p.locations, next.locations);
    requirePatternScope(session, next.locations);
    checkPatternRefs(next);
    requireOwnPeople(session, p.people, next.people);
    const problem = patternProblem(next, shiftList().map(s => s.code));
    if (problem) invalid(problem);
    const keys =['name', 'cycle', 'days', 'locations', 'jobProfiles', 'costCentre', 'starts', 'horizon', 'gen', 'genFrom', 'genTo', 'active', 'people'] as const;
    const { before, after } = diff(p, next, keys);
    if (!Object.keys(after).length) return { record: p, auditId: null };
    const saved = bump(p, next);
    patternColl()[p.id] = saved;
    const auditId = writeAudit({ who: actor(session), act: 'Working pattern changed', entity: 'pattern', entityId: p.id, before, after });
    return { record: saved, auditId };
  }),

  serve(deletePattern, ({ session, params, checkVersion }) => {
    const p = patternFor(session, params.code);
    checkVersion(p);
    Reflect.deleteProperty(patternColl(), p.id);
    const auditId = writeAudit({ who: actor(session), act: 'Working pattern removed', entity: 'pattern', entityId: p.id,
      before: { code: p.code, name: p.name, people: p.people.length }, after: null });
    return { code: p.code, auditId };
  }),

  serve(addPatternPeople, ({ session, params, body, checkVersion }) => {
    const p = patternFor(session, params.code);
    checkVersion(p);
    const codes = [...new Set(body.personCodes)];
    if (!codes.length) invalid({ field: 'personCodes', message: TICK_SOMEONE });
    if (body.start > p.cycle) invalid({ field: 'start', message: `A starting day must be from 1 to ${p.cycle}.` });
    const sc = patternScope(session);
    const ppl = codes.map((code, i) => {
      const x = personByCode(code) ?? invalid({ field: `personCodes.${i}`, message: `There is no person with the employee ID ${code}.` });
      if (!sc.all && x.location !== sc.location)
        refuse(403, { code: 'scope', field: `personCodes.${i}`, message: notOurs(x.name, sc.location), next: 'Ask an administrator to add people from other locations.' });
      return x;
    });
    const already = ppl.filter(x => p.people.some(y => y.personCode === x.code)).map(x => x.name);
    if (already.length) refuse(409, { code: 'ALREADY_ON_PATTERN', field: 'personCodes', message: alreadyOnPattern(already), next: 'Untick them, or change their starting day on the pattern.' });
    const offsets = staggerOffsets(p.days, body.start, body.mode, ppl.length);
    const added = ppl.map((x, i) => ({ personCode: x.code, offset: offsets[i] ?? body.start }));
    const saved = bump(p, { people: [...p.people, ...added] });
    patternColl()[p.id] = saved;
    const auditId = writeAudit({ who: actor(session), act: 'People added to a working pattern', entity: 'pattern', entityId: p.id,
      before: { people: p.people.length }, after: { people: saved.people.length, added: added.map(a => `${a.personCode} from day ${a.offset}`) } });
    return { record: saved, auditId };
  }),

  serve(generatePattern, ({ session, params, body, checkVersion }) => {
    const p = patternFor(session, params.code);
    checkVersion(p);
    const run: PatternRecord = { ...p, gen: body.gen ?? p.gen, genFrom: body.genFrom ?? p.genFrom, genTo: body.genTo ?? p.genTo };
    const sc = patternScope(session), scope = sc.all ? null : sc.location;
    const problem = patternGenerateProblem(run, scope, locName);
    if (problem) invalid(problem);
    const c = config();
    const info = new Map<string, PatternPersonInfo>(run.people.flatMap(x => {
      const q = personByCode(x.personCode);
      return q ? [[q.code, { code: q.code, name: q.name, location: q.location, state: q.state, restNeed: restNeed(typeRotaFor(c.types, q.employeeType), c) }]] : [];
    }));
    const r = applyPattern(run, { today: today(), scope, people: info, weekAt, locName, shifts: shiftList() });
    if (!r.ok) return invalid({ field: 'gen', message: r.message });
    if (!r.written && !r.occupied && !r.live && !r.absence) refuse(422, { code: 'NO_LANDING', field: 'days', message: NO_LANDING, next: 'Change the cycle or the start day, then generate again.' });
    const counts = { written: r.written, occupied: r.occupied, absence: r.absence, weeks: r.weeks, live: r.live, rest: r.rest, range: r.range, people: r.people,
      summary: generateSummary(r, generateActivates(p, r) ? p.name : undefined) };
    if (!r.written) return { ...counts, record: p, auditId: null };
    for (const w of r.writes) saveWeek({ ...weekCore(w.location, w.weekStart), lines: w.lines });
    const activated = generateActivates(p, r);
    const changed = activated || run.gen !== p.gen || run.genFrom !== p.genFrom || run.genTo !== p.genTo;
    const record = changed ? bump(p, { gen: run.gen, genFrom: run.genFrom, genTo: run.genTo, ...(activated ? { active: true } : {}) }) : p;
    patternColl()[p.id] = record;
    const auditId = writeAudit({ who: actor(session), act: 'Working pattern generated', entity: 'pattern', entityId: p.id, before: null,
      after: { written: r.written, occupied: r.occupied, absence: r.absence, live: r.live, weeks: r.writes.map(w => rotaWeekId(w.location, w.weekStart)), activated,
        detail: generateAuditText(run, r, scope ? locName(scope) : null) } });
    return { ...counts, record, auditId };
  }),

  /* --------------------------------------------------------------- cover */
  serve(listCover, ({ session, query }) => {
    requireRota(); requireFlag('FULFIL', 'Cover requests');
    const sc = scopeOf(session), mine = <T extends { location: string }>(x: T) => sc.all || x.location === sc.location;
    const all = Object.values(covers()).filter(mine), open = all.filter(c => c.open), closed = all.filter(c => !c.open);
    const status = query.status ?? 'all';
    const shown = status === 'urgent' ? open.filter(c => c.urgent) : status === 'filled' ? closed : open;
    const filled = Object.values(filledColl()).filter(mine).sort((a, b) => Number(a.confirmed) - Number(b.confirmed) || a.date.localeCompare(b.date));
    return { requests: shown.sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id)).map(coverView), filled: filled.map(filledView),
      stages: config().fulfilStages, counts: { all: open.length, urgent: open.filter(c => c.urgent).length, filled: closed.length }, itAccess: flagOn('ITACCESS') };
  }),

  serve(openCover, ({ session, body }) => {
    requireRota(); requireFlag('FULFIL', 'Cover requests');
    const l = locationFor(session, body.location);
    const reason = body.reason.trim();
    if (reason && !(COVER_REASONS as readonly string[]).includes(reason)) invalid({ field: 'reason', message: 'Choose a reason.' });
    const problem = openCoverProblem(Object.values(covers()), l.code, body.date, body.shift, shiftList());
    if (problem) refuse(problem.code === 'UNKNOWN_SHIFT' ? 422 : 409, { ...problem, field: problem.code === 'UNKNOWN_SHIFT' ? 'shift' : 'date' });
    const rec = createCover({ location: l.code, date: body.date, shift: body.shift, reason, urgent: body.urgent }, l);
    const auditId = writeAudit({ who: actor(session), act: body.urgent ? 'Extra shift added' : 'Cover request opened', entity: 'coverRequest', entityId: rec.id,
      before: null, after: { reason, urgent: body.urgent, detail: coverDetail(rec) } });
    return { record: coverView(rec), auditId };
  }),

  serve(setCoverReason, ({ session, params, body, checkVersion }) => {
    requireRota(); requireFlag('FULFIL', 'Cover requests');
    const c = coverFor(session, params.id);
    checkVersion(c);
    const ok = eligibleFor(c.location, c.date, c.shift);
    const m = coverReasonMove(c, body.reason.trim(), config().fulfilStages, store.now(), ok.length, locName(c.location));
    if ('problem' in m) return refuseCover(m.problem);
    if (m.cover.reason === c.reason) return { record: coverView(c), auditId: null };
    const saved = bump(c, m.cover);
    covers()[c.id] = saved;
    if (!c.reason) notifyEvent('rt_cover', 'subject', ok.map(x => x.worker.code), openShiftNotice(shiftList(), c.shift, c.date, locName(c.location)));
    const auditId = writeAudit({ who: actor(session), act: 'Cover reason set', entity: 'coverRequest', entityId: c.id,
      before: { reason: c.reason, stage: c.stage }, after: { reason: saved.reason, stage: saved.stage, detail: coverDetail(c) } });
    return { record: coverView(saved), auditId };
  }),

  serve(askAllCover, ({ session, params, checkVersion }) => {
    requireRota(); requireFlag('FULFIL', 'Cover requests');
    const c = coverFor(session, params.id);
    checkVersion(c);
    const ok = eligibleFor(c.location, c.date, c.shift);
    const m = coverAskAllMove(c, config().fulfilStages, store.now(), ok.length);
    if ('problem' in m) return refuseCover(m.problem);
    const saved = bump(c, m.cover);
    covers()[c.id] = saved;
    notifyEvent('rt_stage', 'subject', ok.map(x => x.worker.code), openShiftNotice(shiftList(), c.shift, c.date, locName(c.location)));
    const auditId = writeAudit({ who: actor(session), act: 'Cover asked of every cleared worker', entity: 'coverRequest', entityId: c.id,
      before: { stage: c.stage }, after: { stage: saved.stage, sent: ok.length, detail: coverDetail(c) } });
    return { record: coverView(saved), auditId };
  }),

  serve(escalateCover, ({ session, params, checkVersion }) => {
    requireRota(); requireFlag('FULFIL', 'Cover requests');
    const c = coverFor(session, params.id);
    checkVersion(c);
    const stages = config().fulfilStages, m = coverEscalateMove(c, stages, store.now());
    if ('problem' in m) return refuseCover(m.problem);
    const saved = bump(c, m.cover);
    covers()[c.id] = saved;
    const audience = stages.at(-1)?.audience ?? '';
    notifyEvent('rt_esc', 'actor', managersAt(c.location), escalationNotice(shiftList(), c.shift, c.date, audience));
    const auditId = writeAudit({ who: actor(session), act: 'Fulfilment escalated', entity: 'coverRequest', entityId: c.id,
      before: { stage: c.stage }, after: { stage: saved.stage, audience, detail: coverDetail(c) } });
    return { record: coverView(saved), auditId };
  }),

  serve(assignCover, ({ session, params, body, checkVersion }) => {
    requireRota(); requireFlag('FULFIL', 'Cover requests');
    const c = coverFor(session, params.id);
    checkVersion(c);
    const closed = coverClosed(c);
    if (closed) refuse(409, closed);
    const p = personAt(body.personCode, c.location);
    const r = fillWith(session, c, p, 'Cover', true);
    const auditId = writeAudit({ who: actor(session), act: 'Cover request filled', entity: 'coverRequest', entityId: c.id,
      before: { open: true }, after: { open: false, filled: r.filled.id, amended: r.placed.amended, detail: coverDetail(c, p.name) } });
    return { record: coverView(r.cover), filled: r.filled, summary: `${p.name} assigned and added to the rota. Confirm it once worked.`, auditId };
  }),

  serve(fillCover, ({ session, params, checkVersion }) => {
    requireRota(); requireFlag('FULFIL', 'Cover requests');
    const c = coverFor(session, params.id);
    checkVersion(c);
    const closed = coverClosed(c);
    if (closed) refuse(409, closed);
    if (!c.reason) refuse(409, { code: 'REASON_REQUIRED', field: 'reason', message: REASON_BEFORE_CLOSE, next: 'Choose why this shift needs filling.' });
    const best = eligibleFor(c.location, c.date, c.shift)[0];
    if (!best) refuse(409, { code: 'NOBODY_ELIGIBLE', message: NOBODY_ELIGIBLE, next: 'Escalate the request.' });
    const p = (best ? personByCode(best.worker.code) : undefined) ?? NOT_FOUND('person record');
    const r = fillWith(session, c, p, 'Cover', true);
    const auditId = writeAudit({ who: actor(session), act: 'Cover request filled', entity: 'coverRequest', entityId: c.id,
      before: { open: true }, after: { open: false, filled: r.filled.id, amended: r.placed.amended, detail: coverDetail(c, p.name) } });
    return { record: coverView(r.cover), filled: r.filled, summary: 'Added to the rota. Confirm it below once it has been worked.', auditId };
  }),

  serve(claimCover, ({ session, params, checkVersion }) => {
    requireRota(); requireFlag('FULFIL', 'Cover requests');
    if (!session.caps.includes('claim')) refuse(403, { code: 'capability', message: CLAIM_NOT_PERMITTED, next: 'Ask your manager to assign the shift to you.' });
    const c = recordAt(covers(), params.id) ?? NOT_FOUND('open shift');
    const me = personByCode(effectiveCode(session)) ?? NOT_FOUND('person record');
    /* claim is own-only: an open shift at somebody else's location is not offered */
    if (c.location !== me.location) refuse(403, { code: 'scope', message: 'This open shift is not at your location.', next: 'Claim open shifts from My shifts.' });
    checkVersion(c);
    const closed = coverClosed(c);
    if (closed) refuse(409, closed);
    if (!c.reason) refuse(409, { code: 'NOT_OFFERED', message: 'This shift is not open for claiming yet.', next: 'Claim open shifts from My shifts.' });
    const ctx = ctxFor(me), at = weekOn(c.location, c.date), line = lineOf(weekCore(c.location, at.weekStart), me.code);
    const ex = ctx.safeWorker ? eligibility(worker(me), line, at.day, c.shift, ctx)[0] : undefined;
    if (ex) refuse(422, { code: 'ROTA_INELIGIBLE', field: 'id', message: claimRefusal(ex), next: 'Choose another open shift.' });
    const r = fillWith(session, c, me, 'Claimed', false);
    notifyEvent('rt_assign', 'actor', managersAt(c.location), coverFilledNotice(me.name, shiftList(), c.shift, c.date));
    const auditId = writeAudit({ who: actor(session), act: 'Open shift claimed', entity: 'coverRequest', entityId: c.id,
      before: { open: true }, after: { open: false, filled: r.filled.id, amended: r.placed.amended, detail: coverDetail(c, me.name) } });
    return { record: coverView(r.cover), filled: r.filled, summary: 'Shift claimed. Your manager will confirm it, and you can log time against it.', auditId };
  }),

  serve(confirmFilled, ({ session, params, checkVersion }) => {
    requireRota(); requireFlag('FULFIL', 'Cover requests');
    const f = recordAt(filledColl(), params.id) ?? NOT_FOUND('filled shift');
    requireRotaScope(session, f.location);
    checkVersion(f);
    const self = confirmSelfProblem(f, effectiveCode(session));
    if (self) refuse(403, self);
    const problem = confirmProblem(f) ?? confirmEarlyProblem(f, today());
    if (problem) refuse(409, problem);
    let it: ItRequest | null = null;
    if (flagOn('ITACCESS')) {
      const id = nextNumId(itColl(), 'itr');
      it = { id, ...itRequestFor(f, Object.keys(itColl()).length, personByCode(f.personCode)?.category ?? '', store.now(), locName(f.location), shiftList()) };
      itColl()[id] = it;
      notifyEvent('rt_it', 'backOffice', administrators(), { ...itRequestNotice(it), ref: it.ref });
    }
    const saved = bump(f, { confirmed: true, itRequest: it?.ref ?? '' });
    filledColl()[f.id] = saved;
    const summary = confirmSummary(it?.ref ?? '');
    const auditId = writeAudit({ who: actor(session), act: 'Filled shift confirmed', entity: 'filledShift', entityId: f.id,
      before: { confirmed: false }, after: { confirmed: true, itRequest: saved.itRequest, detail: `${coverDetail(f, f.name)} · ${summary}` } });
    return { record: saved, itRequest: it, summary, auditId };
  }),

  /* The IT service desk (admIT): an integration page, so it reads with the
     integration capability and ITACCESS alone, as the nav gates it. Newest first. */
  serve(listItRequests, () => {
    if (!flagOn('ITACCESS')) refuse(403, { code: 'feature-off', message: 'IT access requests are switched off for this organisation.',
      next: 'An administrator can switch them on in Qnipay setup → Modules → Rota → Rota setup.' });
    const items = Object.values(itColl()).sort((a, b) => b.raisedAt.localeCompare(a.raisedAt) || b.ref.localeCompare(a.ref));
    return { items };
  }),

  /* ------------------------------------------------------------ my shifts */
  serve(getMyShifts, ({ session, query }) => {
    requireRota();
    const p = personByCode(effectiveCode(session)) ?? NOT_FOUND('person record');
    const now = today(), ws = query.weekStart ?? weekOn(p.location, now).weekStart;
    requireMonday(p.location, ws);
    const w = weekCore(p.location, ws), visible = rotaVisible(w.state), sh = shiftList();
    const line = visible ? lineOf(w, p.code) : emptyLine(), dates = weekDates(ws);
    const days = dates.flatMap((date, i) => {
      const s = shiftBy(sh, line[i] ?? '');
      return s ? [{ date, code: s.code, name: s.name, time: shiftTime(sh, s.code), hours: s.hours }] : [];
    });
    const nextDay = days.find(d => d.date >= now);
    const next = nextDay ? { ...nextDay, with: rosterOf(p.location, w).filter(x => x.code !== p.code && lineOf(w, x.code)[dayIndex(nextDay.date)] === nextDay.code).map(x => x.name) } : null;
    const published = Object.values(weeks()).filter(x => x.location === p.location && rotaVisible(x.state)).map(x => addDays(x.weekStart, 6)).sort();
    const open = flagOn('FULFIL')
      ? openShiftsFor({ ...worker(p), location: p.location }, Object.values(covers()).filter(c => c.date >= now), date => lineOf(weekCore(p.location, weekOn(p.location, date).weekStart), p.code), ctxFor(p))
      : [];
    return {
      person: { code: p.code, name: p.name, location: p.location, locationName: locName(p.location) },
      weekStart: ws, label: weekLabel(ws), today: now, state: w.state, visible, days,
      restDays: visible ? dates.filter((_, i) => !line[i]) : [], hours: r2(rotadHours(line, sh)), next, publishedTo: published.at(-1) ?? '',
      openShifts: open.map(({ cover: c, why }) => ({ id: c.id, version: c.version, date: c.date, shift: c.shift, shiftName: shiftBy(sh, c.shift)?.name ?? c.shift,
        time: shiftTime(sh, c.shift), location: c.location, locationName: locName(c.location), urgent: c.urgent, why })),
      canClaim: session.caps.includes('claim'), outlook: config().outlook, horizon: config().horizon,
    };
  }),

  /* --------------------------------------------------------------- config */
  serve(getRotaConfig, () => {
    requireRota();
    const types = Object.values(store.coll<{ code: string; name: string }>('employeeTypes')).map(t => ({ code: t.code, name: t.name }));
    return { config: config(), employeeTypes: types, shifts: shiftList() };
  }),

  serve(updateRotaConfig, ({ session, body, checkVersion }) => {
    requireRota();
    const c = config();
    checkVersion(c);
    const { safeRules, types, fulfilStages, ...rest } = body;
    const next: RotaConfigRecord = { ...c, ...rest, safeRules: { ...c.safeRules, ...safeRules }, types: { ...c.types, ...types },
      fulfilStages: fulfilStages ? renumberStages(fulfilStages.map(s => ({ ...s, n: s.n ?? 0 }))) : c.fulfilStages };
    const problem = rotaConfigProblem(next, next.fulfilStages, next.types, { employeeTypes: codesOf('employeeTypes'), shiftCodes: shiftList().map(s => s.code) });
    if (problem) invalid(problem);
    const keys = Object.keys(body) as (keyof UpdateRotaConfig)[];
    const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
    for (const k of keys) {
      if (k === 'safeRules' || k === 'types') {
        const was = c[k] as Record<string, unknown>, is = next[k] as Record<string, unknown>;
        const changed = Object.keys(is).filter(x => !same(was[x], is[x]));
        if (changed.length) { before[k] = Object.fromEntries(changed.map(x => [x, was[x]])); after[k] = Object.fromEntries(changed.map(x => [x, is[x]])); }
      } else if (!same(c[k], next[k])) { before[k] = c[k]; after[k] = next[k]; }
    }
    if (!Object.keys(after).length) return { record: c, auditId: null };
    const saved = saveConfig(c, next);
    const auditId = writeAudit({ who: actor(session), act: 'Rota setup saved', entity: 'rotaConfig', entityId: c.id, before, after });
    return { record: saved, auditId };
  }),
];
