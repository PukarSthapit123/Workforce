/* Module 4 Leave handlers. Every rule is the group 1 domain's
   (src/domain/leave.ts): the handlers build its inputs from the store and
   write its outputs. Entitlement and balance are derived on every read from the
   policy, the person record, the seeded base, the requests and the counted
   ledger rows (D3), so approve, cancel and give-days-back move a balance
   exactly once and nothing can drift. A request is one versioned record moved
   only along LEAVE_STATE (D1). Approved leave and recorded sickness reach the
   rota through module 3's week path (writeAbsence) only with Rota and LV_ROTA
   on (D7). One audit row per request; a refusal or a fault writes nothing,
   because serve() restores the store. Notifications are stored rows (D12).
   With the Leave module off every endpoint refuses (module-off). */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor, capsFor, requireCapability } from './auth';
import { writeAudit } from './audit';
import { invalid } from './people';
import { notify as notifyIn } from './notify';
import { rotaCoverDays, writeAbsence, type AbsenceWritten } from './rota';
import { accounts, codesOf, effectiveCode, inScope, nameOf, people, personByCode, recordAt, scopeOf, today, type Signed, type StoredPerson } from './world';
import {
  approveLeave, arrangeRtw, cancelLeave, declineLeave, getEntitlement, getLeaveConfig, getMyLeave, getSicknessBoard, getTeamBalances, giveDaysBack,
  listLeavers, listTeamLeave, recordSickness, requestLeave, updateLeaveConfig,
  type BalanceView, type EntitlementView, type LeaveConfigRecord, type LeaveRequestRecord, type LeaveRequestView, type LedgerView,
  type SickEpisodeRecord, type TeamRequestView, type UpdateLeaveConfig,
} from '@/contract/leave';
import {
  CANCELLED_TOAST, LEAVE_STATE, NOT_YOUR_REQUEST, ROTA_OFF_IMPACT, RTW_TOAST, SETTLED_IN_PAYROLL, SICK_REASONS, TRIGGER_NOTE,
  absenceMark, absenceOn, approvedNotice, approvedToast, balanceText, bookedLeaveDates, bradford, bradfordTip, cancelTip,
  cancelWindowAdvisory, cancelledNotice, coverImpact, daysReturnedNotice, daysReturnedToast, daysToTakeText, decidedAudit, declineReasonProblem,
  declinedNotice, declinedToast, entitlement, giveBackProblem, giveBackRow, isLeaveState, latestAbsenceText, leaveConfigProblem, leaveCoverReason,
  leaveRange, leaveTransitionProblem, leaveTypeName, leaveWritesRota, leaveYear, ledgerQty, monthsWorked, nextStepText, noticeAdvisory, policyBy,
  qtyText, reconcileLeaver, recordSicknessPlan, renumberLeaveStages, requestProblem, requestedAudit, requestedNotice, requestedToast,
  rtwNotices, rtwProblem, selfApprovalProblem, sentNotice, sickDuringLeave, sicknessDates, sicknessNotice, sicknessToast, slaBreachedText,
  slaOf, slaPillText, stageText, triggerBannerText, typeBalanceText, typeLeaveFor, yearBalance,
  type Balance, type LeaveYearSpan, type BalanceUnit, type LeavePart, type Entitlement, type LeaveRefusal, type LedgerRow,
} from '@/domain/leave';
import { SICK, isActive, type RotaActor } from '@/domain/rota';
import { addDays, daysBetween } from '@/domain/time';

/* ------------------------------------------------------------- the world */
interface Meta { id: string; version: number; updatedAt: string }
type StoredRequest = LeaveRequestRecord;
type StoredEpisode = SickEpisodeRecord;
type StoredLedger = Meta & LedgerRow & { personCode: string; by: RotaActor | null };
interface StoredBase extends Meta { personCode: string; unit: BalanceUnit; taken: number; toil: number; toilBy: string; accruedHours?: number }
interface StoredLeaver extends Meta { personCode: string; leaveDate: string; note: string }
interface Tenant { modules: Record<string, boolean>; flags: Record<string, unknown> }

function tenant(): Tenant {
  const t = recordAt(store.coll<Tenant>('tenant'), 'tenant');
  if (!t) throw new Error('the store has no tenant record');
  return t;
}
const flagOn = (k: string) => Boolean(tenant().flags[k]);
const flags = () => Object.fromEntries(Object.entries(tenant().flags).map(([k, v]) => [k, Boolean(v)]));
/* With the Leave module off the whole module is hidden, and so refused here. */
function requireLeave() {
  if (!tenant().modules.L) refuse(403, { code: 'module-off', message: 'Leave is switched off for this organisation.', next: 'An administrator can switch the Leave module on in Qnipay setup.' });
}
function requireFlag(flag: string, what: string) {
  if (!flagOn(flag)) refuse(403, { code: 'feature-off', message: `${what} is switched off for this organisation.`, next: 'An administrator can switch it on in Qnipay setup.' });
}
function config(): LeaveConfigRecord {
  const c = recordAt(store.coll<LeaveConfigRecord>('leaveConfig'), 'leaveConfig');
  if (!c) throw new Error('the store has no leave config');
  return c;
}
const requests = () => store.coll<StoredRequest>('leaveRequests');
const ledgerColl = () => store.coll<StoredLedger>('leaveLedger');
const episodesColl = () => store.coll<StoredEpisode>('sickEpisodes');
const requestsOf = (code: string) => Object.values(requests()).filter(r => r.personCode === code);
const ledgerOf = (code: string) => Object.values(ledgerColl()).filter(l => l.personCode === code);
const episodesOf = (code: string) => Object.values(episodesColl()).filter(e => e.personCode === code).sort((a, b) => a.from.localeCompare(b.from));
/* The leave days a give-back already returned (D10). */
const returnedDates = (code: string) => ledgerOf(code).filter(l => l.counts).flatMap(l => l.dates ?? []);
const locName = (code: string) => nameOf('locations', code);
const by = (s: Signed): RotaActor => { const w = actor(s); return { personCode: w.personCode, name: w.name }; };
const firstName = (name: string) => name.split(/\s/)[0] ?? name;
const managerOf = (p: StoredPerson) => p.manager.trim() || 'your manager';
const NOT_FOUND = (what: string, next = 'Reload the page.') => refuse(404, { code: 'not-found', message: `That ${what} no longer exists.`, next });
const datesBetween = (from: string, to: string) => Array.from({ length: Math.max(0, daysBetween(from, to) + 1) }, (_, i) => addDays(from, i));
function nextNumId(coll: Record<string, unknown>, prefix: string, pad = 0) {
  const re = new RegExp(`^${prefix}_(\\d+)$`);
  let max = 0;
  for (const id of Object.keys(coll)) max = Math.max(max, Number(re.exec(id)?.[1] ?? 0));
  return `${prefix}_${String(max + 1).padStart(pad, '0')}`;
}
const notify = (codes: Iterable<string>, n: { title: string; body: string }) => notifyIn(codes, n, 'Leave');
/* The approvers at a location (team_leave), never the person themselves. */
const approversAt = (loc: string, except: string) => Object.values(accounts())
  .filter(a => a.personCode !== except && personByCode(a.personCode)?.location === loc && capsFor(a).includes('team_leave')).map(a => a.personCode);
const administrators = () => Object.values(accounts()).filter(a => capsFor(a).includes('mod_cfg')).map(a => a.personCode);

/* A refusal from the domain, with the status its code carries. */
const STATUS: Record<string, number> = { SELF_APPROVAL: 403, TRANSITION_NOT_ALLOWED: 409, ALREADY_RECORDED: 409, ALREADY_REQUESTED: 409, NO_ABSENCE: 409 };
const refuseLeave = (p: LeaveRefusal): never =>
  refuse(STATUS[p.code] ?? 422, { ...p, code: p.code === 'VALIDATION' ? 'invalid' : p.code });

/* ------------------------------------------------------------- scope (D5) */
function requireTeamScope(s: Signed, p: StoredPerson, what: string) {
  if (inScope(s, p.location)) return;
  const sc = scopeOf(s);
  refuse(403, { code: 'scope', message: `You can ${what} for people at ${sc.all ? 'any location' : locName(sc.location)} only.`,
    next: 'Ask an approver at their location.' });
}
const inMyScope = (s: Signed) => (p: StoredPerson) => inScope(s, p.location);
const managedLocations = (s: Signed) => {
  const sc = scopeOf(s);
  return Object.values(store.coll<{ code: string; name: string; active?: boolean }>('locations'))
    .filter(l => (sc.all ? l.active !== false : l.code === sc.location)).map(l => ({ code: l.code, name: l.name }));
};

/* ------------------------------------------- entitlement and balance (D3) */
function leaveOf(p: StoredPerson) {
  const c = config(), tl = typeLeaveFor(c.typeLeave, p.employeeType), policy = policyBy(c.policies, tl.policy);
  if (!policy) throw new Error('the leave config has no policies');
  const stored = recordAt(store.coll<StoredBase>('leaveBases'), `lb_${p.code}`);
  const base = stored ?? { unit: tl.unit, taken: 0, toil: 0, toilBy: '' };
  const contractedHours = Math.max(0, p.contractedHours);
  const facts = { contractedHours, start: p.start, ...(stored?.accruedHours !== undefined ? { accruedHours: stored.accruedHours } : {}) };
  const ent = entitlement(facts, policy, today());
  const mine = requestsOf(p.code), ledger = ledgerOf(p.code);
  const input = { facts, policy, base: { unit: base.unit, taken: base.taken, toil: base.toil, toilBy: base.toilBy }, requests: mine, ledger,
    today: today(), finYearStart: c.finYearStart };
  const bal = yearBalance(input, leaveYear(today(), c.finYearStart));
  /* any leave year's balance: a request is charged to the year(s) its days fall in (review I2) */
  return { policy, unit: base.unit, facts, ent, bal, mine, ledger, balIn: (y: LeaveYearSpan) => yearBalance(input, y) };
}
const entitlementView = (e: Entitlement): EntitlementView => ({ days: e.days, hours: e.hours, years: e.years, policy: e.policy, lines: e.lines });
const balanceView = (b: Balance): BalanceView => ({ unit: b.unit, takenD: b.takenD, takenH: b.takenH, pending: b.pending, pendingH: b.pendingH,
  leftD: b.leftD, leftH: b.leftH, toil: b.toil, toilPending: b.toilPending, toilLeft: b.toilLeft, toilBy: b.toilBy, text: balanceText(b) });
function requestView(r: StoredRequest): LeaveRequestView {
  const s = isLeaveState(r.state) ? LEAVE_STATE[r.state] : LEAVE_STATE.pending;
  return { ...r, typeName: leaveTypeName(config().types, r.type), range: leaveRange(r.from, r.to), qtyText: qtyText(r.qty, r.unit),
    stateLabel: s.label, tone: s.tone, glyph: s.glyph };
}
const ledgerView = (l: StoredLedger): LedgerView => ({ id: l.id, date: l.date, type: l.type, qty: l.qty, unit: l.unit, why: l.why, counts: l.counts,
  ...(l.dates ? { dates: l.dates } : {}), qtyText: ledgerQty(l) });
const newestFirst = <T extends { id: string }>(key: (x: T) => string) => (a: T, b: T) => key(b).localeCompare(key(a)) || b.id.localeCompare(a.id);
const yearNow = () => leaveYear(today(), config().finYearStart);
/* Leaver reconciliation in days and hours at the leaving date (D13), for the people `mine` lets through:
   a manager's locations on Team leave, the whole tenant on Leave setup. */
function leaversIn(mine: (p: StoredPerson) => boolean) {
  const yr = yearNow();
  const rows = Object.values(store.coll<StoredLeaver>('leavers')).flatMap(x => {
    const p = personByCode(x.personCode);
    if (!p || !mine(p)) return [];
    const L = leaveOf(p), months = monthsWorked(yr.start, p.start, x.leaveDate);
    const r = reconcileLeaver({ fullDays: L.ent.days, takenDays: L.bal.takenD, months, contractedHours: L.facts.contractedHours });
    return [{ personCode: p.code, name: p.name, leaveDate: x.leaveDate, note: x.note, months, full: r.full, prorata: r.prorata, taken: r.taken,
      diff: r.diff, hours: r.hours, verdict: r.verdict, tone: r.diff < 0 ? 'err' as const : r.diff > 0 ? 'warn' as const : 'ok' as const, action: r.action }];
  });
  return { rows, settled: SETTLED_IN_PAYROLL };
}

/* ------------------------------------------------------- the leave record */
function requestFor(id: string): StoredRequest {
  return recordAt(requests(), id) ?? NOT_FOUND('leave request');
}
function personOf(code: string): StoredPerson {
  return personByCode(code) ?? NOT_FOUND('person record');
}
function moved(r: StoredRequest, to: StoredRequest['state'], who: RotaActor, reason = ''): Partial<StoredRequest> {
  return { state: to, history: [...r.history, { from: r.state, to, by: who, at: store.now(), reason }] };
}
const NO_ROTA: AbsenceWritten = { written: 0, weeks: [], amended: false, covers: [] };
/* D7: only with the Rota module and LV_ROTA on. */
const rotaLinked = () => leaveWritesRota(tenant().modules, flags());
const rotaAfter = (r: AbsenceWritten) => (r.written ? { rotaWeeks: r.weeks, cells: r.written, ...(r.covers.length ? { coversOpened: r.covers } : {}) } : {});

/* ---------------------------------------------- the timesheet's link (D8) */
/* The absence a day carries from leave records: booked leave (V), else
   sickness (S). Read for every tenant, with or without the rota. */
export function leaveAbsenceOn(personCode: string, date: string): '' | 'V' | 'S' {
  if (!tenant().modules.L) return '';
  return absenceOn(date, requestsOf(personCode), episodesOf(personCode), today(), returnedDates(personCode));
}
/* LEAVE_CFG.blocksTimesheet, while the Leave module is on. */
export const leaveBlocksTimesheet = () => Boolean(tenant().modules.L) && Boolean(recordAt(store.coll<LeaveConfigRecord>('leaveConfig'), 'leaveConfig')?.blocksTimesheet);

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export const leaveHandlers = [
  /* -------------------------------------------------------------- my leave */
  serve(getMyLeave, ({ session }) => {
    requireLeave();
    const p = personOf(effectiveCode(session)), c = config(), L = leaveOf(p), yr = yearNow(), toilOn = flagOn('LV_TOIL');
    const next = leaveYear(addDays(yr.end, 1), c.finYearStart);
    const al = L.unit === 'hours' ? `${L.bal.leftH} hours left` : `${L.bal.leftD} of ${L.ent.days} days left`;
    return {
      person: { code: p.code, name: p.name, manager: managerOf(p), employeeType: p.employeeType },
      today: today(), year: yr, entitlement: entitlementView(L.ent), balance: balanceView(L.bal), facts: L.facts,
      nextYear: { ...next, leftD: L.balIn(next).leftD },
      daysToTake: L.bal.leftD > 0 ? daysToTakeText(L.bal, yr.end, toilOn) : '',
      types: c.types.filter(t => t.active).map(t => ({ code: t.code, name: t.name, unit: t.unit, evidence: t.evidence,
        hint: typeBalanceText(t, policyBy(c.policies, t.policy), al, { hours: L.bal.toil, useBy: L.bal.toilBy }) })),
      requests: [...L.mine].sort(newestFirst(r => r.raisedAt)).map(requestView),
      ledger: [...L.ledger].sort(newestFirst(l => l.date)).map(ledgerView),
      cancelTip: cancelTip(c.cancelWindow),
      rules: { entitlement: flagOn('LV_ENT'), toil: toilOn, toilMax: c.toilMax, toilWindow: c.toilWindow, slaDays: c.slaDays, escalateTo: c.escalateTo },
    };
  }),

  serve(requestLeave, ({ session, body }) => {
    requireLeave();
    const p = personOf(effectiveCode(session)), c = config(), L = leaveOf(p);
    /* the part is checked by requestProblem (isLeavePart), which refuses with the domain's sentence */
    const checked = requestProblem({ type: body.type, from: body.from, to: body.to, part: body.part as LeavePart },
      { types: c.types, contractedHours: L.facts.contractedHours, checkBalance: flagOn('LV_ENT'), today: today(), finYearStart: c.finYearStart,
        leftIn: y => L.balIn(y).leftD });
    if (!checked.ok) return refuseLeave(checked.problem);
    const s = checked.shape, who = by(session), at = store.now();
    const impact = tenant().modules.R ? coverImpact(rotaCoverDays(p.code, datesBetween(s.from, s.to))) : { text: ROTA_OFF_IMPACT, short: false };
    const id = nextNumId(requests(), 'lr');
    const rec: StoredRequest = { id, version: 1, updatedAt: at, personCode: p.code, type: body.type, from: s.from, to: s.to, part: s.part, qty: s.qty,
      unit: s.unit, state: 'pending', raisedAt: at, note: body.note?.trim() ?? '', impact: impact.text, short: impact.short, escalated: false,
      decidedAt: '', decidedBy: null, reason: '', history: [{ from: '', to: 'pending', by: who, at, reason: '' }] };
    requests()[id] = rec;
    const typeName = leaveTypeName(c.types, rec.type), range = leaveRange(rec.from, rec.to);
    notify(approversAt(p.location, p.code), requestedNotice(p.name, typeName, range, s.label, c.slaDays));
    notify([p.code], sentNotice(range, s.label, managerOf(p)));
    const auditId = writeAudit({ who: actor(session), act: 'Leave requested', entity: 'leaveRequest', entityId: id, before: null,
      after: { state: 'pending', type: rec.type, from: rec.from, to: rec.to, qty: rec.qty, unit: rec.unit, detail: requestedAudit(typeName, range, s.label) } });
    return { record: requestView(rec), hint: checked.hint, summary: requestedToast(typeName, s.label, managerOf(p)), auditId };
  }),

  serve(cancelLeave, ({ session, params, checkVersion }) => {
    requireLeave();
    const r = requestFor(params.id);
    if (r.personCode !== effectiveCode(session))
      refuse(403, { code: 'NOT_YOUR_REQUEST', message: NOT_YOUR_REQUEST, next: 'Only the colleague who asked for it can cancel it.' });
    const t = leaveTransitionProblem(r.state, 'cancelled');
    if (t) refuseLeave(t);
    checkVersion(r);
    const p = personOf(r.personCode);
    const saved = bump(r, moved(r, 'cancelled', by(session)));
    requests()[r.id] = saved;
    notify(approversAt(p.location, p.code), cancelledNotice(p.name, r.from));
    const auditId = writeAudit({ who: actor(session), act: 'Leave request cancelled', entity: 'leaveRequest', entityId: r.id,
      before: { state: r.state }, after: { state: 'cancelled', detail: decidedAudit(p.name, r.from) } });
    return { record: requestView(saved), summary: CANCELLED_TOAST, auditId };
  }),

  /* ------------------------------------------------------------ team leave */
  serve(listTeamLeave, ({ session, query }) => {
    requireLeave();
    const c = config(), now = today(), self = effectiveCode(session), mine = inMyScope(session);
    /* the approver's own request is not theirs to decide (D5), as module 2's queue leaves out their own timesheet */
    const pend = Object.values(requests()).flatMap(r => {
      const p = r.state === 'pending' && r.personCode !== self ? personByCode(r.personCode) : undefined;
      return p && mine(p) ? [{ r, p }] : [];
    }).sort((a, b) => a.r.raisedAt.localeCompare(b.r.raisedAt) || a.r.id.localeCompare(b.r.id));
    const views: TeamRequestView[] = pend.map(({ r, p }) => {
      const sla = slaOf({ raised: r.raisedAt.slice(0, 10), escalated: r.escalated }, c.slaDays, now, c.stages.length);
      return { ...requestView(r), name: p.name, location: p.location, balance: balanceText(leaveOf(p).bal),
        sla: { daysLeft: sla.daysLeft, escalated: sla.escalated, tone: sla.tone, text: slaPillText(sla, c.slaDays, c.escalateTo) },
        stage: { n: sla.stage, text: stageText(c.stages, sla.stage), action: c.stages[sla.stage - 1]?.action ?? '' },
        advisories: [noticeAdvisory(r.from, r.raisedAt.slice(0, 10), c.minNotice), cancelWindowAdvisory(r.from, now, c.cancelWindow)].filter((x): x is string => !!x) };
    });
    const q = (query.q ?? '').trim().toLowerCase();
    const shown = views.filter(v => (!q || v.name.toLowerCase().includes(q) || v.personCode.toLowerCase().includes(q))
      && (!query.type || v.type === query.type) && (query.short !== 'true' || v.short));
    const escalated = views.filter(v => v.sla.escalated).length;
    return { requests: shown, counts: { pending: views.length, escalated, shown: shown.length }, breached: escalated ? slaBreachedText(escalated, c.slaDays) : '',
      escalateTo: c.escalateTo, slaDays: c.slaDays, stages: c.stages, types: c.types.filter(t => t.active).map(t => ({ code: t.code, name: t.name })),
      locations: managedLocations(session) };
  }),

  serve(approveLeave, ({ session, params, checkVersion }) => {
    requireLeave();
    const r = requestFor(params.id), p = personOf(r.personCode);
    requireTeamScope(session, p, 'decide leave');
    const self = selfApprovalProblem(r.personCode, effectiveCode(session));
    if (self) refuseLeave(self);
    const t = leaveTransitionProblem(r.state, 'approved');
    if (t) refuseLeave(t);
    checkVersion(r);
    const who = by(session), c = config();
    const saved = bump(r, { ...moved(r, 'approved', who), decidedAt: store.now(), decidedBy: who });
    requests()[r.id] = saved;
    notify([p.code], approvedNotice(leaveRange(r.from, r.to), leaveTypeName(c.types, r.type)));
    const mark = absenceMark(r.type);
    const rota = rotaLinked() ? writeAbsence({ personCode: p.code, dates: datesBetween(r.from, r.to), mark, by: who, coverReason: leaveCoverReason(mark) }) : NO_ROTA;
    const auditId = writeAudit({ who: actor(session), act: 'Leave approved', entity: 'leaveRequest', entityId: r.id,
      before: { state: r.state }, after: { state: 'approved', detail: decidedAudit(p.name, r.from), ...rotaAfter(rota) } });
    return { record: requestView(saved), summary: approvedToast(firstName(p.name), rota.written > 0, rota.covers.length > 0), rota, auditId };
  }),

  serve(declineLeave, ({ session, params, body, checkVersion }) => {
    requireLeave();
    const r = requestFor(params.id), p = personOf(r.personCode);
    requireTeamScope(session, p, 'decide leave');
    const self = selfApprovalProblem(r.personCode, effectiveCode(session));
    if (self) refuseLeave(self);
    const t = leaveTransitionProblem(r.state, 'declined');
    if (t) refuseLeave(t);
    checkVersion(r);
    const reason = body.reason.trim(), rp = declineReasonProblem(reason);
    if (rp) refuseLeave(rp);
    const who = by(session);
    const saved = bump(r, { ...moved(r, 'declined', who, reason), decidedAt: store.now(), decidedBy: who, reason });
    requests()[r.id] = saved;
    notify([p.code], declinedNotice(leaveRange(r.from, r.to), reason));
    const auditId = writeAudit({ who: actor(session), act: 'Leave declined', entity: 'leaveRequest', entityId: r.id,
      before: { state: r.state }, after: { state: 'declined', detail: decidedAudit(p.name, r.from) }, reason });
    return { record: requestView(saved), summary: declinedToast(firstName(p.name)), auditId };
  }),

  serve(getTeamBalances, ({ session }) => {
    requireLeave();
    const now = today(), mine = inMyScope(session);
    const rows = Object.values(people()).filter(p => isActive(p) && mine(p)).sort((a, b) => a.name.localeCompare(b.name)).map(p => {
      const L = leaveOf(p);
      const next = L.mine.filter(r => (r.state === 'pending' || r.state === 'approved') && r.to >= now).sort((a, b) => a.from.localeCompare(b.from))[0];
      return { personCode: p.code, name: p.name, policyName: L.policy.name, unit: L.unit, entDays: L.ent.days, entHours: L.ent.hours,
        takenD: L.bal.takenD, leftD: L.bal.leftD, leftH: L.bal.leftH, toil: L.bal.toil, toilBy: L.bal.toilBy,
        next: next ? { from: next.from, state: next.state } : null };
    });
    return { rows, toil: flagOn('LV_TOIL') };
  }),

  serve(getEntitlement, ({ session, params }) => {
    requireLeave();
    const p = personOf(params.personCode);
    if (p.code === effectiveCode(session)) requireCapability(session, 'own_leave');
    else { requireCapability(session, 'team_leave'); requireTeamScope(session, p, 'see leave'); }
    const L = leaveOf(p);
    return { person: { code: p.code, name: p.name, employeeType: p.employeeType }, today: today(), year: yearNow(),
      entitlement: entitlementView(L.ent), balance: balanceView(L.bal), facts: L.facts };
  }),

  serve(listLeavers, ({ session }) => {
    requireLeave(); requireFlag('LV_LEAVER', 'Leaver reconciliation');
    return leaversIn(inMyScope(session));
  }),

  /* -------------------------------------------------------------- sickness */
  serve(getSicknessBoard, ({ session }) => {
    requireLeave();
    const c = config(), now = today(), mine = inMyScope(session);
    const team = Object.values(people()).filter(mine).sort((a, b) => a.name.localeCompare(b.name));
    const rows = team.flatMap(p => {
      const eps = episodesOf(p.code), latest = eps.at(-1);
      if (!latest) return [];
      const b = bradford(eps, now, c.absenceTrigger);
      return [{ personCode: p.code, name: p.name, latest: latestAbsenceText(latest, now), spells: b.spells, days: b.days, score: b.score,
        triggered: b.triggered, next: nextStepText(b.triggered, latest), episode: latest }];
    });
    const first = rows.find(r => r.triggered);
    const sickOnLeave = team.flatMap(p => sickDuringLeave(requestsOf(p.code), episodesOf(p.code), returnedDates(p.code), now)
      .map(x => ({ personCode: p.code, name: p.name, ...x })));
    return {
      rows, banner: first ? { personCode: first.personCode, text: triggerBannerText(first.name, first.score, c.absenceTrigger), note: TRIGGER_NOTE, episode: first.episode } : null,
      counts: { triggered: rows.filter(r => r.triggered).length, colleagues: rows.length }, trigger: c.absenceTrigger, tip: bradfordTip(c.absenceTrigger), today: now,
      colleagues: team.filter(isActive).map(p => ({ code: p.code, name: p.name })), reasons: [...SICK_REASONS], sickOnLeave,
    };
  }),

  serve(recordSickness, ({ session, body }) => {
    requireLeave();
    const p = personOf(body.personCode);
    requireTeamScope(session, p, 'record sickness');
    const now = today(), eps = episodesOf(p.code);
    const planned = recordSicknessPlan(eps, { from: body.from, to: body.to, reason: body.reason }, now);
    if (!planned.ok) return refuseLeave(planned.problem);
    const plan = planned.plan, was = plan.kind === 'extend' ? eps.find(e => e.id === plan.id) : undefined;
    let rec: StoredEpisode;
    if (plan.kind === 'extend' && was) rec = bump(was, { from: plan.from, to: plan.to });
    else {
      const id = nextNumId(episodesColl(), 'sk', 3);
      rec = { id, version: 1, updatedAt: store.now(), personCode: p.code, from: plan.from, to: plan.to, reason: body.reason, note: body.note?.trim() ?? '', rtw: null };
    }
    episodesColl()[rec.id] = rec;
    const rota = rotaLinked()
      ? writeAbsence({ personCode: p.code, dates: sicknessDates(rec, now, bookedLeaveDates(requestsOf(p.code), returnedDates(p.code))), mark: SICK, by: by(session),
        coverReason: leaveCoverReason(SICK) })
      : NO_ROTA;
    const range = leaveRange(body.from, body.to || body.from);
    notify([p.code], sicknessNotice(p.name, range));
    const auditId = writeAudit({ who: actor(session), act: 'Sickness recorded', entity: 'sickEpisode', entityId: rec.id,
      before: was ? { from: was.from, to: was.to } : null,
      after: { from: rec.from, to: rec.to, reason: rec.reason, extended: !!was, detail: `${p.name} · ${range} · ${body.reason}`, ...rotaAfter(rota) } });
    const summary = rota.written ? sicknessToast(rota.covers.length > 0) : `Sickness recorded for ${p.name}.`;
    return { record: rec, extended: !!was, rota, summary, auditId };
  }),

  serve(arrangeRtw, ({ session, params, checkVersion }) => {
    requireLeave();
    const e = recordAt(episodesColl(), params.id) ?? NOT_FOUND('absence');
    const p = personOf(e.personCode);
    requireTeamScope(session, p, 'arrange a return to work');
    const problem = rtwProblem(e);
    if (problem) refuseLeave(problem);
    checkVersion(e);
    const who = by(session), saved = bump(e, { rtw: { requestedAt: store.now(), by: who } });
    episodesColl()[e.id] = saved;
    const n = rtwNotices(who.name, locName(p.location));
    notify([p.code], n.employee);
    notify(administrators(), n.admin);
    const auditId = writeAudit({ who: actor(session), act: 'Return-to-work meeting requested', entity: 'sickEpisode', entityId: e.id,
      before: { rtw: null }, after: { rtw: saved.rtw, detail: `${p.name} · ${locName(p.location)}` } });
    return { record: saved, summary: RTW_TOAST, auditId };
  }),

  serve(giveDaysBack, ({ session, body }) => {
    requireLeave();
    const p = personOf(body.personCode);
    requireTeamScope(session, p, 'give days back');
    const now = today(), L = leaveOf(p);
    const candidates = sickDuringLeave(requestsOf(p.code), episodesOf(p.code), returnedDates(p.code), now);
    const problem = giveBackProblem(body.dates, candidates);
    if (problem) refuseLeave(problem);
    const row = giveBackRow(body.dates, candidates, L.unit, L.facts.contractedHours, now);
    const days = Number(candidates.filter(x => body.dates.includes(x.date)).reduce((n, x) => n + x.days, 0).toFixed(2));
    const id = nextNumId(ledgerColl(), 'led', 3), who = by(session);
    const rec: StoredLedger = { id, version: 1, updatedAt: store.now(), personCode: p.code, ...row, by: who };
    ledgerColl()[id] = rec;
    /* the returned days are sickness now, not leave: S over exactly those days (D10) */
    const rota = rotaLinked() ? writeAbsence({ personCode: p.code, dates: row.dates ?? [], mark: SICK, by: who, coverReason: leaveCoverReason(SICK) }) : NO_ROTA;
    notify([p.code], daysReturnedNotice(days));
    const auditId = writeAudit({ who: actor(session), act: 'Days returned', entity: 'leaveLedger', entityId: id, before: null,
      after: { qty: rec.qty, unit: rec.unit, dates: rec.dates, detail: daysReturnedToast(days, p.name), ...rotaAfter(rota) } });
    return { record: ledgerView(rec), rota, summary: daysReturnedToast(days, p.name), auditId };
  }),

  /* ------------------------------------------------------------- setup (D11) */
  serve(getLeaveConfig, () => {
    requireLeave();
    const types = Object.values(store.coll<{ code: string; name: string }>('employeeTypes')).map(t => ({ code: t.code, name: t.name }));
    const lv = Object.fromEntries(Object.entries(flags()).filter(([k]) => k.startsWith('LV_')));
    const requestCounts: Record<string, number> = {};
    for (const r of Object.values(requests())) requestCounts[r.type] = (requestCounts[r.type] ?? 0) + 1;
    return { config: config(), employeeTypes: types, flags: lv, rotaOn: Boolean(tenant().modules.R), requestCounts,
      leavers: flagOn('LV_LEAVER') ? leaversIn(() => true) : null };
  }),

  serve(updateLeaveConfig, ({ session, body, checkVersion }) => {
    requireLeave();
    const c = config();
    checkVersion(c);
    const { typeLeave, stages, ...rest } = body;
    const next: LeaveConfigRecord = { ...c, ...rest, typeLeave: { ...c.typeLeave, ...typeLeave },
      stages: stages ? renumberLeaveStages(stages.map(s => ({ ...s, n: s.n ?? 0 }))) : c.stages };
    const problem = leaveConfigProblem(next, next.types, next.policies, next.stages, next.typeLeave, codesOf('employeeTypes'));
    if (problem) invalid({ field: problem.field ?? 'config', message: problem.message });
    const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    for (const k of Object.keys(body) as (keyof UpdateLeaveConfig)[]) {
      if (k === 'typeLeave') {
        const changed = Object.keys(next.typeLeave).filter(x => !sameJson(c.typeLeave[x], next.typeLeave[x]));
        if (changed.length) { before[k] = Object.fromEntries(changed.map(x => [x, c.typeLeave[x] ?? null])); after[k] = Object.fromEntries(changed.map(x => [x, next.typeLeave[x]])); }
      } else if (!sameJson(c[k], next[k])) { before[k] = c[k]; after[k] = next[k]; }
    }
    if (!Object.keys(after).length) return { record: c, auditId: null };
    const saved = bump(c, next);
    store.coll<LeaveConfigRecord>('leaveConfig')[c.id] = saved;
    const auditId = writeAudit({ who: actor(session), act: 'Leave setup saved', entity: 'leaveConfig', entityId: c.id, before, after });
    return { record: saved, auditId };
  }),
];
