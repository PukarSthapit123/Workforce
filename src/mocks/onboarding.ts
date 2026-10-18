/* Module 5 Onboarding handlers. Every rule is the group 1 domain's
   (src/domain/onboarding.ts): the handlers build its inputs from the store and
   write its outputs. One case per starter (D1), written only with If-Match on
   it; the config is one versioned record saved whole (D2); each policy is a
   row with its own version. Scope (D5): a starter acts only on their own
   case, and only while a candidate or preboarding; a manager tracks and checks
   starters at their own location; Configure onboarding sees every location.
   Activation is refused while start blockers remain (D6), here and in the 1b
   transition handler alike. One audit row per write; a refusal or a fault
   writes nothing, because serve() restores the store. Notifications are the
   1c catalogue's ob_* events (D9). No money anywhere (D14). With the
   Onboarding module off every endpoint refuses (module-off). */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor, capsFor, requireCapability } from './auth';
import { writeAudit } from './audit';
import { notifyEvent } from './notify';
import { accountOfEmployee, accounts, effectiveCode, nameOf, employees, employeeByCode, employeeView, recordAt, today, writeHistory, type Signed, type StoredEmployee } from './world';
import {
  caseContext, caseOf, casesColl, featuresNow, onbConfig, policiesColl, policiesNow, putCase, refuseOnb, requireOnboarding, resolvedFor, stillOnboarding, templateRef, templatesColl, templatesNow,
  type StoredCase, type StoredConfig, type StoredPolicy,
} from './onboarding-cases';
import {
  ackOnboardingPolicy, addOnboardingDocument, addOnboardingPolicy, removeOnboardingDocument, renameOnboardingDocument, chaseStarter, editOnboardingPolicy, getMyOnboarding, getOnboardingSetup, getStarterOnboarding,
  getTeamOnboarding, inviteStarter, readOnboardingPolicy, rejectOnboardingDocument, removeOnboardingPolicy, saveOnboardingStep, startStarter,
  submitOnboarding, updateOnboardingConfig, uploadOnboardingDocument, uploadOnboardingPolicy, verifyOnboardingDocument,
  type OnbDocumentView, type OnboardingDetail, type OnbEmployee, type OnbPolicySetupView, type OnbStepView, type StarterOnboarding, type TrackerRow, type OnbQueueRow,
} from '@/contract/onboarding';
import {
  ALREADY_SUBMITTED, DEFAULT_POLICY_VER, FILES_NOTE, INVITE_REASON, START_REASON, STEP_NEEDS, VERIFIERS,
  ackCount, acknowledgedText, applyPolicyUpload, askedOf, applyUpload, blockers, decideDocument, decidedText, docsAsked, fileRecord, fileSize, isStepId,
  markRead, nextRef, noEmailText, outstandingText, policyAcknowledged, policyFromDraft, policyProblem, policyRemovedText, policySavedText,
  policyUploadedText, progress, progressText, removePolicyText, saveStep, setPolicyAck, startProblem, stepAvailable, stepNotAsked, stepOpen,
  stepSavedText, stepSwitchText, stepsAsked, submitCase, submittedText, taskState, configProblem, uploadedText, uploadProblem, verifierLabel,
  BUILT_IN_DOC, documentAddedText, documentProblem, documentRemovedText, documentRenamedText, documentUsers, newCustomDocument,
  isStarterState, type OnbDocument, type OnboardingCase, type OnboardingConfig, type OnbFeatures, type StepContext, type Decision,
} from '@/domain/onboarding';
import { sameSet, templateFor } from '@/domain/onboarding-templates';
import { LIFECYCLE, isEmployeeState, transitionProblem } from '@/domain/lifecycle';

/* ------------------------------------------------------------- the world */
/* Policies are asked only while Policy acknowledgement is on, and only those the starter's template lists. */
const policiesAsked = (f: OnbFeatures, ids: readonly string[]) => (f.pol ? policiesNow().filter(p => ids.includes(p.id)) : []);
const locName = (code: string) => nameOf('locations', code);
const firstName = (name: string) => name.split(/\s/)[0] ?? name;
const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const NOT_FOUND = (message: string, next = 'Reload the page.'): never => refuse(404, { code: 'not-found', message, next });

/* A document the tenant added: a built-in one is switched off, never renamed or removed. */
function customDoc(c: StoredConfig, id: string): OnbDocument {
  const d = c.documents.find(x => x.id === id) ?? NOT_FOUND(`There is no document "${id}".`, 'Reload the page to see the documents.');
  if (!d.custom) refuse(409, { code: 'built-in', field: `documents.${d.id}`, message: BUILT_IN_DOC, next: 'Switch it off and save if new starters should not be asked for it.' });
  return d;
}
/* ----------------------------------------------------------- scope (D5) */
const seesAll = (s: Signed) => s.caps.includes('onb_cfg');
const myLocation = (s: Signed) => employeeByCode(effectiveCode(s))?.location ?? '';
const inOnbScope = (s: Signed) => (p: StoredEmployee) => seesAll(s) || p.location === myLocation(s);
/* The tracker and one starter's case are read with Track onboarding or Verify onboarding documents. */
function requireTracker(s: Signed) {
  if (!s.caps.includes('onb_verify')) requireCapability(s, 'onb_track');
}
const starters = () => Object.values(employees()).filter(p => isStarterState(p.state));
/* The starter a tracker action names: found, in scope, and still onboarding. */
function starterAt(s: Signed, code: string): StoredEmployee {
  const p = employeeByCode(code) ?? NOT_FOUND('That employee record no longer exists.');
  if (!inOnbScope(s)(p))
    refuse(403, { code: 'scope', message: `You can look after onboarding for employees at ${locName(myLocation(s))} only.`, next: 'Ask a manager at their location, or HR.' });
  if (!isStarterState(p.state))
    refuse(409, { code: 'NOT_ONBOARDING', message: `${p.name} is not onboarding. Onboarding is for candidates and employees preboarding.`, next: 'Reload the page to see who is onboarding.' });
  return p;
}
/* The signed-in starter: only their own case, and only while they are a candidate or preboarding. */
function me(s: Signed): StoredEmployee {
  const p = employeeByCode(effectiveCode(s));
  if (!p || !isStarterState(p.state))
    return refuse(409, { code: 'NOT_ONBOARDING', message: 'There is no onboarding for you to complete. It is open only while you are a new starter.', next: 'Ask your manager if you expected to see it.' });
  return p;
}

/* ---------------------------------------------------------------- views */
function employeeOf(p: StoredEmployee): OnbEmployee {
  const st = isEmployeeState(p.state) ? LIFECYCLE[p.state] : LIFECYCLE.candidate;
  return { code: p.code, id: p.id, name: p.name, first: firstName(p.name), email: p.email, start: p.start, state: p.state, stateLabel: st.label, stateTone: st.tone,
    stateGlyph: st.glyph, location: p.location, locationName: locName(p.location), employeeType: p.employeeType, employeeTypeName: nameOf('employeeTypes', p.employeeType),
    manager: p.manager.trim() };
}
const shown = (s: unknown) => { const t = taskState(s); return { stateLabel: t.label, tone: t.tone, glyph: t.glyph }; };
function stepViews(c: OnboardingCase, cfg: OnboardingConfig, f: OnbFeatures): OnbStepView[] {
  return stepsAsked(cfg, f).map(st => {
    /* review counts once submitted */
    const state = st.id === 'review' && c.submittedAt ? 'done' : c.steps[st.id] ?? 'todo';
    return { id: st.id, label: st.label, desc: st.desc, fixed: st.fixed, state, ...shown(state) };
  });
}
function docViews(c: OnboardingCase, cfg: OnboardingConfig, f: OnbFeatures): OnbDocumentView[] {
  return docsAsked(cfg, f).map(d => {
    const state = c.docs[d.id] ?? 'todo', file = c.files[d.id] ?? null;
    return { ...d, state, ...shown(state), verifierLabel: verifierLabel(d.verify), file, sizeText: file ? fileSize(file.size) : '', rejection: c.rejections[d.id] ?? '' };
  });
}
function progressOf(c: OnboardingCase) {
  const pr = progress(c, caseContext(c.employeeCode));
  return { done: pr.done, total: pr.total, pc: pr.total ? Math.round((pr.done / pr.total) * 100) : 0, text: progressText(pr) };
}
const caseView = (c: StoredCase) => ({ ...c });
function detailOf(p: StoredEmployee): OnboardingDetail {
  const c = caseOf(p.code), r = resolvedFor(p.code), cfg = r.config, f = featuresNow(), ctx = { config: cfg, features: f };
  return {
    employee: employeeOf(p), template: templateRef(r.template), case: caseView(c), features: f, steps: stepViews(c, cfg, f), documents: docViews(c, cfg, f),
    policies: policiesAsked(f, r.policies).map(pol => ({ ...pol, acknowledged: policyAcknowledged(c, pol), read: Boolean(c.read[pol.id]) })),
    progress: progressOf(c), toSubmit: blockers(c, ctx, 'submit'), toStart: blockers(c, ctx, 'start'),
    open: !c.submittedAt || Object.values(c.steps).includes('prog'), submitted: c.submittedAt ? submittedText(c.ref) : '', filesNote: FILES_NOTE, today: today(),
  };
}
/* A step sent back after submission is judged against the documents they were asked then (askedOf). */
/* The tracker's view of one starter (review I3): states, files and blockers, never their answers. */
function starterViewOf(p: StoredEmployee): StarterOnboarding {
  const c = caseOf(p.code), r = resolvedFor(p.code), cfg = r.config, f = featuresNow();
  return { employee: employeeOf(p), template: templateRef(r.template), caseRef: { id: c.id, version: c.version }, steps: stepViews(c, cfg, f), documents: docViews(c, cfg, f),
    progress: progressOf(c), toStart: blockers(c, { config: cfg, features: f }, 'start'), submittedAt: c.submittedAt, ref: c.ref };
}
const stepContext = (c: OnboardingCase, cfg: OnboardingConfig, f: OnbFeatures, policyIds: readonly string[]): StepContext =>
  ({ features: f, documents: askedOf(c, { config: cfg, features: f }).documents, policies: policiesAsked(f, policyIds), today: today() });
function docAsked(id: string, cfg: OnboardingConfig): OnbDocument {
  return docsAsked(cfg, featuresNow()).find(d => d.id === id) ?? NOT_FOUND(`There is no document "${id}" to upload or check.`, 'Reload the page to see the documents asked for.');
}
function policyAsked(id: string, ids: readonly string[]): StoredPolicy {
  const p = featuresNow().pol && ids.includes(id) ? recordAt(policiesColl(), id) : undefined;
  return p ?? NOT_FOUND('That policy is no longer asked for.', 'Reload the page to see the policies to read.');
}
function policyRow(id: string): StoredPolicy {
  return recordAt(policiesColl(), id) ?? NOT_FOUND('That policy no longer exists.');
}
const anyAck = (id: string) => Object.values(casesColl()).filter(c => id in c.acks).length;
const policySetupView = (p: StoredPolicy): OnbPolicySetupView => ({ ...p, ackCount: ackCount(p, Object.values(casesColl())), removeText: removePolicyText(anyAck(p.id)) });

/* ------------------------------------------------------- who is told (D9) */
const lineManager = (p: StoredEmployee) => Object.values(employees()).find(x => x.name === p.manager.trim() && x.code !== p.code);
/* The document checkers who can see this starter: onb_verify at their location, or onb_verify with onb_cfg anywhere. */
const checkersOf = (p: StoredEmployee) => Object.values(accounts()).filter(a => {
  if (a.employeeCode === p.code) return false;
  const caps = capsFor(a), loc = employeeByCode(a.employeeCode)?.location;
  return caps.includes('onb_verify') && (caps.includes('onb_cfg') || loc === p.location);
}).map(a => a.employeeCode);

/* What a step save changed, as field names: values (an NI number, an address) are not copied into the audit trail. */
function changedFields(a: OnboardingCase, b: OnboardingCase): string[] {
  const out: string[] = [];
  for (const k of Object.keys(b.data) as (keyof OnboardingCase['data'])[]) if (!sameJson(a.data[k], b.data[k])) out.push(k);
  if (a.signature !== b.signature) out.push('signature');
  return out;
}

/* Verify or reject (D4): the onb_verify holder, never on their own documents. */
function decide(session: Signed, params: { employeeCode: string; doc: string }, checkVersion: (r: StoredCase) => void, decision: Decision) {
  requireOnboarding();
  const p = starterAt(session, params.employeeCode);
  if (p.code === effectiveCode(session))
    refuse(403, { code: 'SELF_CHECK', message: 'You cannot check your own documents.', next: 'Ask another manager or HR to check them.' });
  const doc = docAsked(params.doc, resolvedFor(p.code).config), c = caseOf(p.code);
  checkVersion(c);
  const r = decideDocument(c, doc, decision);
  if (!r.ok) return refuseOnb(r.refusal);
  const saved = putCase(c, r.value), reason = decision.ok ? '' : decision.reason;
  notifyEvent('ob_doc_decided', 'subject', [p.code], decision.ok
    ? { title: 'Document accepted', body: `${doc.label} was checked and accepted.` }
    : { title: 'Document rejected', body: `${doc.label} was rejected. ${/[.!?]$/.test(reason) ? reason : `${reason}.`} Upload it again from your onboarding.` });
  const auditId = writeAudit({ who: actor(session), act: decision.ok ? 'Onboarding document verified' : 'Onboarding document rejected', entity: 'onboardingCase', entityId: c.id,
    before: { document: doc.id, state: c.docs[doc.id] ?? 'todo' },
    after: { document: doc.id, state: saved.docs[doc.id] ?? 'todo', detail: `${p.name}. ${doc.label}.`, ...(saved.steps.documents !== c.steps.documents ? { documentsStep: saved.steps.documents } : {}) },
    ...(decision.ok ? {} : { reason }) });
  return { record: caseView(saved), summary: decidedText(doc.label, decision.ok, p.name), auditId };
}

export const onboardingHandlers = [
  /* -------------------------------------------------------------- my case */
  serve(getMyOnboarding, ({ session }) => {
    requireOnboarding();
    return detailOf(me(session));
  }),

  serve(saveOnboardingStep, ({ session, params, body, checkVersion }) => {
    requireOnboarding();
    const p = me(session), res = resolvedFor(p.code), cfg = res.config, f = featuresNow();
    const step = isStepId(params.step) ? stepsAsked(cfg, f).find(s => s.id === params.step) : undefined;
    if (!step) return refuseOnb(stepNotAsked(params.step));
    const c = caseOf(p.code);
    checkVersion(c);
    const { mode, ...patch } = body;
    const r = saveStep(c, step.id, patch, stepContext(c, cfg, f, res.policies), mode);
    if (!r.ok) return refuseOnb(r.refusal);
    const summary = mode === 'check' ? stepSavedText(step.label) : 'All changes saved.';
    if (sameJson({ ...c, ...r.value }, c)) return { record: caseView(c), summary, auditId: null };
    const saved = putCase(c, r.value);
    const auditId = writeAudit({ who: actor(session), act: mode === 'check' ? 'Onboarding step completed' : 'Onboarding step saved', entity: 'onboardingCase', entityId: c.id,
      before: { step: step.id, state: c.steps[step.id] ?? 'todo' }, after: { step: step.id, state: saved.steps[step.id] ?? 'todo', fields: changedFields(c, saved) } });
    return { record: caseView(saved), summary, auditId };
  }),

  serve(uploadOnboardingDocument, ({ session, params, body, checkVersion }) => {
    requireOnboarding();
    const p = me(session), doc = docAsked(params.doc, resolvedFor(p.code).config), c = caseOf(p.code);
    checkVersion(c);
    const bad = uploadProblem(body);
    if (bad) return refuseOnb(bad);
    const file = fileRecord(body, store.now()), r = applyUpload(c, doc, file, featuresNow());
    if (!r.ok) return refuseOnb(r.refusal);
    const saved = putCase(c, r.value), state = saved.docs[doc.id] ?? 'done';
    const auditId = writeAudit({ who: actor(session), act: 'Onboarding document uploaded', entity: 'onboardingCase', entityId: c.id,
      before: { document: doc.id, state: c.docs[doc.id] ?? 'todo', ...(c.files[doc.id] ? { replaced: c.files[doc.id]?.name } : {}) },
      after: { document: doc.id, state, name: file.name, size: fileSize(file.size), type: file.type } });
    return { record: caseView(saved), summary: uploadedText(doc.label, file.name, state), auditId };
  }),

  serve(readOnboardingPolicy, ({ session, params, checkVersion }) => {
    requireOnboarding();
    const p = me(session), pol = policyAsked(params.id, resolvedFor(p.code).policies), c = caseOf(p.code);
    checkVersion(c);
    if (c.read[pol.id]) return { record: caseView(c), summary: `${pol.label} opened.`, auditId: null };
    const saved = putCase(c, markRead(c, pol));
    const auditId = writeAudit({ who: actor(session), act: 'Policy opened', entity: 'onboardingCase', entityId: c.id, before: null, after: { policy: pol.id, ver: pol.ver } });
    return { record: caseView(saved), summary: `${pol.label} opened.`, auditId };
  }),

  serve(ackOnboardingPolicy, ({ session, params, body, checkVersion }) => {
    requireOnboarding();
    const p = me(session), pol = policyAsked(params.id, resolvedFor(p.code).policies), c = caseOf(p.code);
    checkVersion(c);
    /* a tick can always be given (a new version asks again, even after submission); taking one back only while the step is open */
    if (!body.on && !stepOpen(c, 'policies')) return refuseOnb(ALREADY_SUBMITTED);
    const next = setPolicyAck(c, pol, body.on);
    const summary = body.on ? acknowledgedText(pol) : `${pol.label} is no longer acknowledged.`;
    if (sameJson(next.acks, c.acks) && sameJson(next.read, c.read)) return { record: caseView(c), summary, auditId: null };
    const saved = putCase(c, next);
    const auditId = writeAudit({ who: actor(session), act: body.on ? 'Policy acknowledged' : 'Policy acknowledgement withdrawn', entity: 'onboardingCase', entityId: c.id,
      before: { policy: pol.id, acknowledged: c.acks[pol.id] ?? null }, after: { policy: pol.id, acknowledged: saved.acks[pol.id] ?? null, detail: `${pol.label} ${pol.ver}` } });
    return { record: caseView(saved), summary, auditId };
  }),

  serve(submitOnboarding, ({ session, body, checkVersion }) => {
    requireOnboarding();
    const p = me(session), c = caseOf(p.code);
    checkVersion(c);
    const ref = nextRef(Object.values(casesColl()).map(x => x.ref).filter(Boolean));
    const r = submitCase(c, { consent: body.consent, ...(body.signature !== undefined ? { signature: body.signature } : {}), ref, at: store.now() }, caseContext(p.code));
    if (!r.ok) return refuseOnb(r.refusal);
    const saved = putCase(c, r.value);
    const m = lineManager(p);
    notifyEvent('ob_submitted', 'actor', [...(m ? [m.code] : []), ...checkersOf(p)],
      { title: 'Onboarding submitted', body: `${p.name} submitted their onboarding with reference ${ref}. It is ready to check.`, ref });
    const auditId = writeAudit({ who: actor(session), act: 'Onboarding submitted', entity: 'onboardingCase', entityId: c.id,
      before: { submittedAt: '' }, after: { submittedAt: saved.submittedAt, ref, signed: Boolean(saved.signature) } });
    return { record: caseView(saved), ref, summary: submittedText(ref), auditId };
  }),

  /* ----------------------------------------------------------------- team */
  serve(getTeamOnboarding, ({ session }) => {
    requireTracker(session);
    requireOnboarding();
    const f = featuresNow();
    const list = starters().filter(inOnbScope(session)).sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
    const rows: TrackerRow[] = [], queue: OnbQueueRow[] = [];
    for (const p of list) {
      const c = caseOf(p.code), r = resolvedFor(p.code), employee = employeeOf(p), caseRef = { id: c.id, version: c.version };
      rows.push({ employee, template: templateRef(r.template), caseRef, progress: progressOf(c), blockers: blockers(c, { config: r.config, features: f }, 'start'), canInvite: p.state === 'candidate', submittedAt: c.submittedAt, ref: c.ref });
      for (const d of docsAsked(r.config, f)) {
        const file = c.files[d.id];
        if (c.docs[d.id] === 'done' && file) queue.push({ employee, caseRef, document: d, file, sizeText: fileSize(file.size) });
      }
    }
    return { rows, queue, toVerify: queue.length, verify: f.verify, all: seesAll(session),
      locationName: seesAll(session) ? 'every location' : locName(myLocation(session)), location: myLocation(session) };
  }),

  serve(getStarterOnboarding, ({ session, params }) => {
    requireTracker(session);
    requireOnboarding();
    return starterViewOf(starterAt(session, params.employeeCode));
  }),

  serve(verifyOnboardingDocument, ({ session, params, checkVersion }) => decide(session, params, checkVersion, { ok: true })),
  serve(rejectOnboardingDocument, ({ session, params, body, checkVersion }) => decide(session, params, checkVersion, { ok: false, reason: body.reason.trim() })),

  serve(inviteStarter, ({ session, params, checkVersion }) => {
    requireOnboarding();
    const p = starterAt(session, params.employeeCode), c = caseOf(p.code);
    checkVersion(c);
    if (!p.email.trim()) refuse(409, { code: 'NO_EMAIL', field: 'email', message: noEmailText(p.name), next: 'Open their record and add a work email.' });
    const t = isEmployeeState(p.state) ? transitionProblem(p.state, 'preboard') : null;
    if (t) refuse(409, { code: 'transition', ...t });
    const employee = bump(p, { state: 'preboard' });
    employees()[p.id] = employee;
    /* the account is how they sign in (P's syncUsers); 1b gives one with the work email, so this only fills a gap */
    const email = p.email.trim().toLowerCase();
    const madeAccount = !accountOfEmployee(p.code) && !recordAt(accounts(), `acc_${email}`);
    if (madeAccount) accounts()[`acc_${email}`] = { id: `acc_${email}`, version: 1, updatedAt: store.now(), email, employeeCode: p.code, userType: 'employee', grants: [], revocations: [] };
    const saved = putCase(c, { ...c, invitedAt: store.now() }), who = actor(session);
    writeHistory(p.code, who, 'transition', [{ field: 'state', from: p.state, to: 'preboard' }], INVITE_REASON);
    notifyEvent('ob_invited', 'subject', [p.code], { title: 'Onboarding invitation', body: `You are invited to complete your onboarding. Sign in with ${p.email} to start.` });
    const auditId = writeAudit({ who, act: 'Onboarding invited', entity: 'employee', entityId: p.code, before: { state: p.state },
      after: { state: 'preboard', email: p.email, invitedAt: saved.invitedAt, emailSent: false, ...(madeAccount ? { account: email } : {}) }, reason: INVITE_REASON });
    return { record: caseView(saved), employee: employeeView(employee), summary: `${p.name} is invited. They sign in with ${p.email}. Invitation emails are a future enhancement, so tell them yourself.`, auditId };
  }),

  serve(startStarter, ({ session, params, checkVersion }) => {
    requireOnboarding();
    const p = starterAt(session, params.employeeCode), c = caseOf(p.code);
    checkVersion(c);
    /* the lifecycle first, as the transition handler checks it: a candidate is invited before they can start */
    const t = isEmployeeState(p.state) ? transitionProblem(p.state, 'active') : null;
    if (t) refuse(409, { code: 'transition', ...t });
    const bl = startProblem(p.name, c, caseContext(p.code));
    if (bl) return refuseOnb(bl);
    const employee = bump(p, { state: 'active' });
    employees()[p.id] = employee;
    const saved = putCase(c, { ...c, startedAt: store.now() }), who = actor(session);
    writeHistory(p.code, who, 'transition', [{ field: 'state', from: p.state, to: 'active' }], START_REASON);
    const auditId = writeAudit({ who, act: `Employee ${LIFECYCLE.active.label.toLowerCase()}`, entity: 'employee', entityId: p.code,
      before: { state: p.state }, after: { state: 'active', startedAt: saved.startedAt }, reason: START_REASON });
    return { record: caseView(saved), employee: employeeView(employee), summary: `${p.name} is active. They can now be scheduled and paid.`, auditId };
  }),

  serve(chaseStarter, ({ session, params }) => {
    requireOnboarding();
    const p = starterAt(session, params.employeeCode), c = caseOf(p.code);
    const bl = blockers(c, caseContext(p.code), 'start');
    if (!bl.length) refuse(409, { code: 'NOTHING_OUTSTANDING', message: `${p.name} has nothing outstanding.`, next: 'Start them instead.' });
    notifyEvent('ob_chased', 'subject', [p.code], { title: 'Onboarding outstanding', body: outstandingText(bl) });
    const auditId = writeAudit({ who: actor(session), act: 'Onboarding chased', entity: 'onboardingCase', entityId: c.id, before: null,
      after: { outstanding: bl.length, detail: outstandingText(bl) } });
    return { outstanding: bl.length, summary: `${p.name} reminded. ${bl.length} outstanding.`, auditId };
  }),

  /* ---------------------------------------------------------------- setup */
  serve(getOnboardingSetup, () => {
    requireOnboarding();
    const cfg = onbConfig(), f = featuresNow(), templates = templatesNow();
    const profiles = Object.values(store.coll<{ code: string; name: string }>('jobProfiles')).sort((a, b) => a.name.localeCompare(b.name) || a.code.localeCompare(b.code));
    return {
      config: cfg, policies: policiesNow().map(policySetupView), features: f,
      steps: cfg.steps.map(s => ({ id: s.id, available: stepAvailable(s.id, f), needs: STEP_NEEDS[s.id] ?? '' })),
      verifiers: VERIFIERS.map(([value, label]) => ({ value, label })),
      inProgress: starters().filter(p => recordAt(casesColl(), `onb_${p.code}`)).length,
      templates: templates.map(t => ({ id: t.id, name: t.name, version: t.version, jobProfiles: t.jobProfiles.flatMap(code => { const j = profiles.find(x => x.code === code); return j ? [{ code, name: j.name }] : []; }),
        starters: starters().filter(p => templateFor(p.jobProfile, templates)?.id === t.id).length })),
      jobProfiles: profiles.map(j => ({ code: j.code, name: j.name })),
    };
  }),

  serve(updateOnboardingConfig, ({ session, body, checkVersion }) => {
    requireOnboarding();
    const c = onbConfig();
    checkVersion(c);
    const problem = configProblem(c, body, featuresNow(), policiesNow().map(pol => pol.id));
    if (problem) return refuseOnb(problem);
    /* only the switches and the settings are taken from what was sent: names and descriptions stay the stored ones */
    const steps = c.steps.map((s, i) => ({ ...s, on: s.fixed ? true : body.steps[i]?.on ?? s.on }));
    const documents = c.documents.map((d, i) => {
      const n = body.documents[i];
      return n ? { ...d, req: n.req, verify: n.verify, blocks: n.blocks, expiry: n.expiry, on: n.on } : d;
    });
    const policies = body.policies && !sameSet(body.policies, c.policies) ? body.policies : c.policies;
    const switched = steps.filter((s, i) => s.on !== c.steps[i]?.on);
    const docsChanged = documents.filter((d, i) => !sameJson(d, c.documents[i]));
    const policiesChanged = !sameSet(policies, c.policies);
    if (!switched.length && !docsChanged.length && !policiesChanged) return { record: c, summary: 'Nothing has changed.', auditId: null };
    const saved = bump(c, { steps, documents, policies });
    store.coll<StoredConfig>('onboardingConfig')[c.id] = saved;
    const byId = <T extends { id: string }>(list: readonly T[], pick: (x: T) => unknown) => Object.fromEntries(list.map(x => [x.id, pick(x)]));
    const before = { ...(switched.length ? { steps: byId(switched, s => c.steps.find(x => x.id === s.id)?.on) } : {}),
      ...(docsChanged.length ? { documents: byId(docsChanged, d => c.documents.find(x => x.id === d.id)) } : {}),
      ...(policiesChanged ? { policies: c.policies } : {}) };
    const after = { ...(switched.length ? { steps: byId(switched, s => s.on) } : {}), ...(docsChanged.length ? { documents: byId(docsChanged, d => d) } : {}), ...(policiesChanged ? { policies } : {}) };
    const summary = [...switched.map(s => stepSwitchText(s.label, s.on)), ...(docsChanged.length ? ['Document settings saved.'] : []), ...(policiesChanged ? ['Policy choices saved.'] : [])].join(' ');
    const auditId = writeAudit({ who: actor(session), act: 'Onboarding setup saved', entity: 'onboardingConfig', entityId: c.id, before, after: { ...after, detail: summary } });
    return { record: saved, summary, auditId };
  }),

  /* Module 8: a document the tenant adds, renames or removes, each a write of its own on the config (If-Match), with one audit row. */
  serve(addOnboardingDocument, ({ session, body, checkVersion }) => {
    requireOnboarding();
    const c = onbConfig();
    checkVersion(c);
    const bad = documentProblem(body, c.documents);
    if (bad) return refuseOnb(bad);
    if (c.documents.length >= 20) return refuseOnb({ code: 'VALIDATION', field: 'label', message: 'There can be at most 20 documents.', next: 'Remove one you added, or switch one off.' });
    const doc = newCustomDocument(body, c.documents);
    const saved = bump(c, { documents: [...c.documents, doc] });
    store.coll<StoredConfig>('onboardingConfig')[c.id] = saved;
    const summary = documentAddedText(doc.label);
    const auditId = writeAudit({ who: actor(session), act: 'Onboarding document added', entity: 'onboardingConfig', entityId: c.id, before: null,
      after: { document: doc.id, label: doc.label, hint: doc.hint, detail: summary } });
    return { record: saved, summary, auditId };
  }),

  serve(renameOnboardingDocument, ({ session, params, body, checkVersion }) => {
    requireOnboarding();
    const c = onbConfig();
    checkVersion(c);
    const d = customDoc(c, params.doc);
    const bad = documentProblem(body, c.documents, d.id);
    if (bad) return refuseOnb(bad);
    const label = body.label.trim(), hint = (body.hint ?? '').trim(), summary = documentRenamedText(label);
    if (label === d.label && hint === d.hint) return { record: c, summary, auditId: null };
    const saved = bump(c, { documents: c.documents.map(x => (x.id === d.id ? { ...x, label, hint } : x)) });
    store.coll<StoredConfig>('onboardingConfig')[c.id] = saved;
    const auditId = writeAudit({ who: actor(session), act: 'Onboarding document renamed', entity: 'onboardingConfig', entityId: c.id,
      before: { document: d.id, label: d.label, hint: d.hint }, after: { document: d.id, label, hint } });
    return { record: saved, summary, auditId };
  }),

  serve(removeOnboardingDocument, ({ session, params, checkVersion }) => {
    requireOnboarding();
    const c = onbConfig();
    checkVersion(c);
    const d = customDoc(c, params.doc);
    /* D2: nothing in use is deleted; the refusal names who holds it */
    const users = documentUsers(d.id, Object.values(casesColl()));
    if (users.length) {
      const names = users.map(code => employeeByCode(code)?.name ?? code);
      return refuse(409, { code: 'in-use', field: `documents.${d.id}`,
        message: `${d.label} is on the onboarding of ${names.length > 3 ? `${names.slice(0, 3).join(', ')} and ${names.length - 3} more` : names.join(', ')}, so it cannot be removed.`,
        next: 'Switch it off instead, so new starters are no longer asked for it.',
        usedBy: [{ kind: 'onboarding', count: users.length, examples: names.slice(0, 3) }] });
    }
    const saved = bump(c, { documents: c.documents.filter(x => x.id !== d.id) });
    store.coll<StoredConfig>('onboardingConfig')[c.id] = saved;
    /* a document re-added under the same name gets the same id, so no template may keep a row for the old one */
    for (const t of templatesNow().filter(x => x.documents.some(r => r.id === d.id))) templatesColl()[t.id] = bump(t, { documents: t.documents.filter(r => r.id !== d.id) });
    const summary = documentRemovedText(d.label);
    const auditId = writeAudit({ who: actor(session), act: 'Onboarding document removed', entity: 'onboardingConfig', entityId: c.id,
      before: { document: d.id, label: d.label, hint: d.hint }, after: null });
    return { record: saved, summary, auditId };
  }),

  serve(addOnboardingPolicy, ({ session, body }) => {
    requireOnboarding();
    const all = policiesNow(), bad = policyProblem(body, all);
    if (bad) return refuseOnb(bad);
    const pol = policyFromDraft(body, all.reduce((m, p) => Math.max(m, p.order + 1), 0));
    const rec: StoredPolicy = { ...pol, version: 1, updatedAt: store.now() };
    /* read before the new row exists: a config with no stored list reads as every policy, which must not include it yet */
    const base = onbConfig();
    policiesColl()[rec.id] = rec;
    /* a new policy is asked by the default template only; every other template opts in */
    store.coll<StoredConfig>('onboardingConfig')[base.id] = bump(base, { policies: [...base.policies, rec.id] });
    const auditId = writeAudit({ who: actor(session), act: 'Policy added', entity: 'onboardingPolicy', entityId: rec.id, before: null,
      after: { label: rec.label, ver: rec.ver, sum: rec.sum } });
    return { record: policySetupView(rec), summary: policySavedText(rec.label), auditId };
  }),

  serve(editOnboardingPolicy, ({ session, params, body, checkVersion }) => {
    requireOnboarding();
    const p = policyRow(params.id);
    checkVersion(p);
    const bad = policyProblem(body, policiesNow(), p.id);
    if (bad) return refuseOnb(bad);
    const label = body.label.trim(), ver = body.ver?.trim() || DEFAULT_POLICY_VER, sum = body.sum?.trim() ?? '';
    const readable = Boolean(p.file) || p.body.length > 0;
    const summary = readable ? `${label} saved.` : policySavedText(label);
    if (label === p.label && ver === p.ver && sum === p.sum) return { record: policySetupView(p), summary, auditId: null };
    const saved = bump(p, { label, ver, sum });
    policiesColl()[p.id] = saved;
    const auditId = writeAudit({ who: actor(session), act: 'Policy edited', entity: 'onboardingPolicy', entityId: p.id,
      before: { label: p.label, ver: p.ver, sum: p.sum }, after: { label, ver, sum } });
    return { record: policySetupView(saved), summary, auditId };
  }),

  serve(uploadOnboardingPolicy, ({ session, params, body, checkVersion }) => {
    requireOnboarding();
    const p = policyRow(params.id);
    checkVersion(p);
    const bad = uploadProblem(body);
    if (bad) return refuseOnb(bad);
    const file = fileRecord(body, store.now());
    /* only employees still onboarding are asked again; somebody who has started keeps what they agreed to as the record */
    const r = applyPolicyUpload(p, file, Object.values(casesColl()).filter(c => stillOnboarding(c) && resolvedFor(c.employeeCode).policies.includes(p.id)));
    const saved = bump(p, r.policy);
    policiesColl()[p.id] = saved;
    /* D10: everyone who acknowledged it is asked again, once */
    for (const changed of r.changed) {
      const was = recordAt(casesColl(), `onb_${changed.employeeCode}`);
      if (was) putCase(was, changed);
    }
    const auditId = writeAudit({ who: actor(session), act: 'Policy document uploaded', entity: 'onboardingPolicy', entityId: p.id,
      before: { ver: p.ver, file: p.file?.name ?? null }, after: { ver: saved.ver, file: file.name, size: fileSize(file.size), askedAgain: r.asked } });
    return { record: policySetupView(saved), asked: r.asked, summary: policyUploadedText(saved.label, saved.ver, r.asked), auditId };
  }),

  serve(removeOnboardingPolicy, ({ session, params, checkVersion }) => {
    requireOnboarding();
    const p = policyRow(params.id);
    checkVersion(p);
    Reflect.deleteProperty(policiesColl(), p.id);
    /* a policy re-added under the same name gets the same id, so no template may keep asking for the old one */
    const base = onbConfig(), holders = templatesNow().filter(t => t.policies.includes(p.id));
    if (base.policies.includes(p.id)) store.coll<StoredConfig>('onboardingConfig')[base.id] = bump(base, { policies: base.policies.filter(id => id !== p.id) });
    for (const t of holders) templatesColl()[t.id] = bump(t, { policies: t.policies.filter(id => id !== p.id) });
    /* past acknowledgements stay on the cases and in the audit trail */
    const auditId = writeAudit({ who: actor(session), act: 'Policy removed', entity: 'onboardingPolicy', entityId: p.id,
      before: { label: p.label, ver: p.ver, acknowledgedBy: anyAck(p.id), ...(holders.length ? { templates: holders.map(t => t.name) } : {}) }, after: null });
    return { id: p.id, summary: policyRemovedText(p.label), auditId };
  }),
];
