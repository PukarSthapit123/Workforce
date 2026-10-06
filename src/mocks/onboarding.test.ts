import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { Session } from '@/contract/session';
import { MyNotifications } from '@/contract/notifications';
import {
  CaseChanged, CaseSubmitted, OnboardingConfigSaved, OnboardingDetail, OnboardingSetup, PolicySaved, PolicyUploaded, StarterChased, StarterMoved, TeamOnboarding,
} from '@/contract/onboarding';
import {
  ALWAYS_ASKED, INVITE_REASON, POLICY_NAME_NEEDED, POLICY_NAME_TAKEN, REASON_NEEDED, START_REASON, STEP_MESSAGES, CONSENT_NEEDED,
  noEmailText, notReadyText, outstandingText, stepSwitchText, tooLargeText, type Blocker,
} from '@/domain/onboarding';
import { audits, caller, fault, personOf, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

type Call = ReturnType<typeof caller>;
const as = async (p: Persona) => caller(await tokenFor(p));
async function asEmail(email: string): Promise<Call> {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const { token } = (await r.json()) as { token: string };
  return caller(token);
}
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const WRITES = ['onboardingCases', 'onboardingConfig', 'onboardingPolicies', 'people', 'personHistory', 'accounts', 'notifications', 'audit'];
/* the module's own rows: signing in writes one too */
const onbAudits = () => audits().filter(a => a.act !== 'Signed in');
interface Note { id: string; personId: string; title: string; body: string; event?: string; delivery?: { inApp: boolean; email: string | null } }
const notes = (personId?: string) => Object.values(store.coll<Note>('notifications')).filter(n => !n.id.startsWith('ntf_seed_') && (!personId || n.personId === personId));
interface Case { id: string; version: number; steps: Record<string, string>; docs: Record<string, string>; acks: Record<string, string>; read: Record<string, boolean>;
  rejections: Record<string, string>; submittedAt: string; startedAt: string; invitedAt: string; data: { personal: { ni: string } } }
const caseOf = (code: string) => store.coll<Case>('onboardingCases')[`onb_${code}`];
const version = (code: string) => caseOf(code)?.version ?? 0;
const tenant = () => store.coll<{ version: number; modules: Record<string, boolean>; flags: Record<string, boolean> }>('tenant').tenant;
const setModule = (k: string, on: boolean) => { const t = tenant(); if (t) t.modules[k] = on; };
const setFlag = (k: string, on: boolean) => { const t = tenant(); if (t) t.flags[k] = on; };
const setPerson = (code: string, patch: Record<string, unknown>) => { const p = personOf(code); store.coll('people')[p.id] = { ...p, ...patch }; };
/* Every step but review done and every required document verified: nothing blocks the start. */
function complete(code: string) {
  const c = caseOf(code);
  if (!c) throw new Error(`no case for ${code}`);
  store.coll('onboardingCases')[c.id] = { ...c, steps: { personal: 'done', contact: 'done', emergency: 'done', additional: 'done', documents: 'done', policies: 'done' },
    docs: { rtw: 'verified', addr: 'verified', photo: 'verified' } };
}

const PRIYA = 'priya.raman@brightpath.org', TOM = 'tom.achterberg@brightpath.org', AMARA = 'amara.okafor@brightpath.org';
const PERSONAL = { dob: '1990-04-02', nat: 'British', ni: 'qq 12 34 56 c' };
const PHOTO = { name: 'face.jpg', size: 120_000, type: 'image/jpeg', preview: 'data:image/jpeg;base64,AAAA' };
const save = (call: Call, step: string, body: Record<string, unknown>, v: number) => call('PUT', `/api/v1/onboarding/me/steps/${step}`, body, v);
const upload = (call: Call, doc: string, file: Record<string, unknown>, v: number) => call('POST', `/api/v1/onboarding/me/documents/${doc}`, file, v);
const team = (call: Call, code: string, what: string, body: unknown, v?: number) => call('POST', `/api/v1/onboarding/team/${code}/${what}`, body, v);

/* ------------------------------------------------------------- my case */
describe('my onboarding: the starter acts on their own case only (D5)', () => {
  test('a preboarding starter reads their steps, documents, policies and what is still to do', async () => {
    const d = OnboardingDetail.parse((await (await asEmail(TOM))('GET', '/api/v1/onboarding/me')).body);
    expect(d.person).toMatchObject({ code: 'CP-1502', first: 'Tom', stateLabel: 'Preboarding' });
    expect(d.steps.map(s => s.id)).toEqual(['personal', 'contact', 'emergency', 'additional', 'documents', 'policies', 'review']);
    expect(d.documents.map(x => x.id)).toEqual(['rtw', 'addr', 'photo', 'licence', 'cert']);
    expect(d.policies).toHaveLength(4);
    expect(d.progress.text).toBe('0 of 7 done');
    expect(d.toSubmit[0]?.why).toBe('Personal details not completed');
    expect(d.filesNote).toContain('not sent to a document store');
  });
  test('somebody who is not a candidate or preboarding is refused on every own endpoint, and nothing is written', async () => {
    const call = await asEmail(AMARA), before = snapshot(...WRITES);
    const tries: [string, string, unknown, number | undefined][] = [
      ['GET', '/api/v1/onboarding/me', undefined, undefined],
      ['PUT', '/api/v1/onboarding/me/steps/personal', { mode: 'quiet', personal: PERSONAL }, 0],
      ['POST', '/api/v1/onboarding/me/documents/photo', PHOTO, 0],
      ['POST', '/api/v1/onboarding/me/policies/pol_conduct/read', undefined, 0],
      ['POST', '/api/v1/onboarding/me/policies/pol_conduct/ack', { on: true }, 0],
      ['POST', '/api/v1/onboarding/me/submit', { consent: true, signature: 'Amara Okafor' }, 0],
    ];
    for (const [method, path, body, v] of tries) {
      const r = await call(method, path, body, v);
      expect(r.status, path).toBe(409);
      expect(refusal(r).code, path).toBe('NOT_ONBOARDING');
    }
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a starter has no way onto another starter\'s case: the tracker and its actions need Track onboarding', async () => {
    const call = await asEmail(TOM), before = snapshot(...WRITES);
    for (const [method, path] of [['GET', '/api/v1/onboarding/team'], ['GET', '/api/v1/onboarding/team/CP-1501'], ['POST', '/api/v1/onboarding/team/CP-1501/chase']]) {
      const r = await call(method ?? 'GET', path ?? '');
      expect(r.status, path).toBe(403);
      expect(refusal(r).code).toBe('capability');
    }
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('Save and continue checks the step on the server and marks it done; the audit names the fields, never their values', async () => {
    const call = await asEmail(TOM);
    const r = CaseChanged.parse((await save(call, 'personal', { mode: 'check', personal: PERSONAL }, 1)).body);
    expect(r.record.steps.personal).toBe('done');
    expect(r.record.data.personal.ni).toBe('QQ 12 34 56 C');
    expect(r.summary).toBe('Personal details saved.');
    expect(onbAudits()).toHaveLength(1);
    expect(onbAudits()[0]).toMatchObject({ act: 'Onboarding step completed', entityId: 'onb_CP-1502', after: { step: 'personal', state: 'done', fields: ['personal'] } });
    expect(JSON.stringify(onbAudits()[0])).not.toContain('QQ 12');
  });
  test('a step missing what it needs is refused with the prototype\'s sentence, and nothing is written', async () => {
    const call = await asEmail(TOM), before = snapshot(...WRITES);
    const r = await save(call, 'personal', { mode: 'check', personal: { dob: '1990-04-02', nat: 'British' } }, 1);
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ code: 'invalid', field: 'ni', message: STEP_MESSAGES.ni });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a step switched off, or one that does not exist, cannot be saved', async () => {
    const cfg = store.coll<{ steps: { id: string; on: boolean }[] }>('onboardingConfig').onboardingConfig;
    const em = cfg?.steps.find(s => s.id === 'emergency');
    if (em) em.on = false;
    const call = await asEmail(TOM);
    for (const step of ['emergency', 'payroll']) {
      const r = await save(call, step, { mode: 'quiet' }, 1);
      expect(r.status, step).toBe(404);
      expect(refusal(r).code).toBe('NOT_FOUND');
    }
  });
  test('every case write needs If-Match on the case: missing is 428, stale is 412, and nothing is written', async () => {
    const call = await asEmail(TOM), before = snapshot(...WRITES);
    expect((await call('PUT', '/api/v1/onboarding/me/steps/personal', { mode: 'quiet', personal: PERSONAL })).status).toBe(428);
    expect((await save(call, 'personal', { mode: 'quiet', personal: PERSONAL }, 7)).status).toBe(412);
    expect((await upload(call, 'photo', PHOTO, 7)).status).toBe(412);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('an upload keeps the file record and waits for a check; a file over 8 MB is refused; with verification off it is accepted at once', async () => {
    const call = await asEmail(TOM);
    const r = CaseChanged.parse((await upload(call, 'photo', PHOTO, 1)).body);
    expect(r.record.docs.photo).toBe('done');
    expect(r.record.files.photo).toMatchObject({ name: 'face.jpg', size: 120_000, kind: 'image', preview: PHOTO.preview });
    expect(r.summary).toBe('Photograph: face.jpg is waiting to be checked.');
    const before = snapshot(...WRITES);
    const big = await upload(call, 'addr', { name: 'bill.pdf', size: 9 * 1024 * 1024, type: 'application/pdf' }, 2);
    expect(big.status).toBe(422);
    expect(refusal(big)).toMatchObject({ field: 'file', message: tooLargeText('bill.pdf', 9 * 1024 * 1024) });
    expect(snapshot(...WRITES)).toEqual(before);
    setFlag('ONB_VERIFY', false);
    const pdf = CaseChanged.parse((await upload(call, 'addr', { name: 'bill.pdf', size: 40_000, type: 'application/pdf', preview: PHOTO.preview }, 2)).body);
    expect(pdf.record.docs.addr).toBe('verified');
    expect(pdf.record.files.addr?.preview).toBeUndefined();
  });
  test('reading and acknowledging a policy keeps the version acknowledged', async () => {
    const call = await asEmail(TOM);
    expect(CaseChanged.parse((await call('POST', '/api/v1/onboarding/me/policies/pol_conduct/read', undefined, 1)).body).record.read.pol_conduct).toBe(true);
    const r = CaseChanged.parse((await call('POST', '/api/v1/onboarding/me/policies/pol_conduct/ack', { on: true }, 2)).body);
    expect(r.record.acks.pol_conduct).toBe('v4.1');
    expect(r.summary).toBe('Code of conduct v4.1 acknowledged.');
    expect(onbAudits().map(a => a.act)).toEqual(['Policy opened', 'Policy acknowledged']);
  });
  test('submit refuses what is outstanding, then a missing confirmation; with everything done it gives a reference and tells the line manager and the checkers', async () => {
    const call = await asEmail(TOM);
    const early = await call('POST', '/api/v1/onboarding/me/submit', { consent: true, signature: 'Tom Achterberg' }, 1);
    expect(early.status).toBe(409);
    expect(refusal(early)).toMatchObject({ code: 'OUTSTANDING', message: expect.stringContaining('Personal details not completed.') });
    complete('CP-1502');
    const before = snapshot(...WRITES);
    const noTick = await call('POST', '/api/v1/onboarding/me/submit', { consent: false, signature: 'Tom Achterberg' }, 1);
    expect(refusal(noTick)).toMatchObject({ code: 'invalid', field: 'consent', message: CONSENT_NEEDED });
    expect(snapshot(...WRITES)).toEqual(before);
    const r = CaseSubmitted.parse((await call('POST', '/api/v1/onboarding/me/submit', { consent: true, signature: 'Tom Achterberg' }, 1)).body);
    expect(r).toMatchObject({ ref: 'ONB-1001', summary: 'Submitted with reference ONB-1001. HR has been told.' });
    expect(r.record).toMatchObject({ submittedAt: '2026-08-13T14:30:00.000Z', signature: 'Tom Achterberg', consent: true, steps: { review: 'done' } });
    /* Rachel Hussain is his line manager and checks documents at Willow House; Dee Fitzgerald checks everywhere */
    expect(notes().filter(n => n.event === 'ob_submitted').map(n => n.personId).sort()).toEqual(['CP-1001', 'CP-1002']);
    expect(onbAudits().map(a => a.act)).toEqual(['Onboarding submitted']);
  });
});

/* -------------------------------------------------------------- tracker */
describe('the tracker and its scope: own location, or every location with Configure onboarding (D5)', () => {
  test('the manager sees the starters at their own location; the administrator sees every location', async () => {
    setPerson('CP-1502', { location: 'BC' });
    const mine = TeamOnboarding.parse((await (await as('manager'))('GET', '/api/v1/onboarding/team')).body);
    expect(mine.rows.map(r => r.person.code)).toEqual(['CP-1501']);
    expect(mine).toMatchObject({ all: false, locationName: 'Willow House' });
    expect(mine.rows[0]).toMatchObject({ canInvite: true, progress: { text: '0 of 7 done' } });
    const all = TeamOnboarding.parse((await (await as('admin'))('GET', '/api/v1/onboarding/team')).body);
    expect(all.rows.map(r => r.person.code)).toEqual(['CP-1501', 'CP-1502']);
    expect(all.all).toBe(true);
  });
  test('a manager is refused every action on a starter at another location, and nothing is written', async () => {
    setPerson('CP-1502', { location: 'BC' });
    await upload(await asEmail(TOM), 'photo', PHOTO, 1);
    const call = await as('manager'), before = snapshot(...WRITES);
    const tries: [string, string, unknown, number | undefined][] = [
      ['GET', '/api/v1/onboarding/team/CP-1502', undefined, undefined],
      ['POST', '/api/v1/onboarding/team/CP-1502/documents/photo/verify', undefined, 2],
      ['POST', '/api/v1/onboarding/team/CP-1502/documents/photo/reject', { reason: 'Too dark' }, 2],
      ['POST', '/api/v1/onboarding/team/CP-1502/invite', undefined, 2],
      ['POST', '/api/v1/onboarding/team/CP-1502/start', undefined, 2],
      ['POST', '/api/v1/onboarding/team/CP-1502/chase', undefined, undefined],
    ];
    for (const [method, path, body, v] of tries) {
      const r = await call(method, path, body, v);
      expect(r.status, path).toBe(403);
      expect(refusal(r)).toMatchObject({ code: 'scope', message: 'You can look after onboarding for people at Willow House only.' });
    }
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('each tracker action needs its own capability on the server: Track onboarding, Verify onboarding documents, Configure onboarding', async () => {
    await upload(await asEmail(TOM), 'photo', PHOTO, 1);
    const mgr = Object.values(store.coll<{ personCode: string; revocations: string[] }>('accounts')).find(a => a.personCode === 'CP-1001');
    if (!mgr) throw new Error('no manager account');
    mgr.revocations = ['onb_verify', 'onb_track'];
    const call = await as('manager'), before = snapshot(...WRITES);
    const tries: [string, string, unknown, number | undefined, string][] = [
      ['GET', '/api/v1/onboarding/team', undefined, undefined, 'Track onboarding'],
      ['POST', '/api/v1/onboarding/team/CP-1502/invite', undefined, 2, 'Track onboarding'],
      ['POST', '/api/v1/onboarding/team/CP-1502/start', undefined, 2, 'Track onboarding'],
      ['POST', '/api/v1/onboarding/team/CP-1502/chase', undefined, undefined, 'Track onboarding'],
      ['POST', '/api/v1/onboarding/team/CP-1502/documents/photo/verify', undefined, 2, 'Verify onboarding documents'],
      ['POST', '/api/v1/onboarding/team/CP-1502/documents/photo/reject', { reason: 'Too dark' }, 2, 'Verify onboarding documents'],
      ['GET', '/api/v1/onboarding/config', undefined, undefined, 'Configure onboarding'],
      ['PUT', '/api/v1/onboarding/config', { steps: [], documents: [] }, 1, 'Configure onboarding'],
      ['POST', '/api/v1/onboarding/policies', { label: 'Fire safety' }, undefined, 'Configure onboarding'],
      ['POST', '/api/v1/onboarding/policies/pol_conduct/file', PHOTO, 1, 'Configure onboarding'],
      ['DELETE', '/api/v1/onboarding/policies/pol_conduct', undefined, 1, 'Configure onboarding'],
    ];
    for (const [method, path, body, v, label] of tries) {
      const r = await call(method, path, body, v);
      expect(r.status, path).toBe(403);
      expect(refusal(r)).toMatchObject({ code: 'capability', message: `This needs "${label}", which your access does not include.` });
    }
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a holder of Verify onboarding documents alone reads the tracker and one case, and verifies, but cannot invite, start or chase', async () => {
    await upload(await asEmail(TOM), 'photo', PHOTO, 1);
    const mgr = Object.values(store.coll<{ personCode: string; revocations: string[] }>('accounts')).find(a => a.personCode === 'CP-1001');
    if (!mgr) throw new Error('no manager account');
    mgr.revocations = ['onb_track'];
    const call = await as('manager');
    const list = TeamOnboarding.parse((await call('GET', '/api/v1/onboarding/team')).body);
    expect(list.queue.map(q => `${q.person.code}/${q.document.id}`)).toEqual(['CP-1502/photo']);
    expect(list.location).not.toBe('');
    const one = await call('GET', '/api/v1/onboarding/team/CP-1502');
    expect(one.status).toBe(200);
    const ok = await team(call, 'CP-1502', 'documents/photo/verify', undefined, 2);
    expect(ok.status).toBe(200);
    expect(caseOf('CP-1502')?.docs.photo).toBe('verified');
    const r = await team(call, 'CP-1502', 'chase', undefined);
    expect(r.status).toBe(403);
    expect(refusal(r)).toMatchObject({ code: 'capability', message: 'This needs "Track onboarding", which your access does not include.' });
  });
  test('a person who is not onboarding is not on the tracker\'s actions; nobody checks their own documents', async () => {
    const call = await as('manager');
    const r = await team(call, 'CP-1042', 'chase', undefined);
    expect(r.status).toBe(409);
    expect(refusal(r).code).toBe('NOT_ONBOARDING');
    setPerson('CP-1001', { state: 'preboard' });
    const self = await team(call, 'CP-1001', 'documents/photo/verify', undefined, 0);
    expect(self.status).toBe(403);
    expect(refusal(self).code).toBe('SELF_CHECK');
  });
  test('a document is rejected with a reason (which reopens the documents step), replaced, then verified; the starter is told each time (D4)', async () => {
    const tom = await asEmail(TOM);
    await upload(tom, 'photo', PHOTO, 1);
    store.coll<Case>('onboardingCases')['onb_CP-1502'] = { ...(caseOf('CP-1502') as Case), steps: { documents: 'done' } };
    const call = await as('manager');
    const q = TeamOnboarding.parse((await call('GET', '/api/v1/onboarding/team')).body);
    expect(q.queue.map(x => [x.person.code, x.document.id])).toEqual([['CP-1502', 'photo']]);
    expect(q.toVerify).toBe(1);
    const before = snapshot(...WRITES);
    const blank = await team(call, 'CP-1502', 'documents/photo/reject', { reason: '  ' }, 2);
    expect(refusal(blank)).toMatchObject({ code: 'invalid', field: 'reason', message: REASON_NEEDED });
    expect(snapshot(...WRITES)).toEqual(before);
    const no = CaseChanged.parse((await team(call, 'CP-1502', 'documents/photo/reject', { reason: 'The photograph is too dark to read' }, 2)).body);
    expect(no.record).toMatchObject({ docs: { photo: 'rejected' }, steps: { documents: 'prog' }, rejections: { photo: 'The photograph is too dark to read' } });
    expect(no.summary).toBe('Photograph rejected. Tom Achterberg has been told.');
    expect(notes('CP-1502').map(n => [n.title, n.body])).toEqual([['Document rejected', 'Photograph was rejected. The photograph is too dark to read. Upload it again from your onboarding.']]);
    await upload(tom, 'photo', { ...PHOTO, name: 'face-2.jpg' }, 3);
    const ok = CaseChanged.parse((await team(call, 'CP-1502', 'documents/photo/verify', undefined, 4)).body);
    expect(ok.record.docs.photo).toBe('verified');
    expect(ok.record.rejections).toEqual({});
    expect(notes('CP-1502').map(n => n.title)).toEqual(['Document rejected', 'Document accepted']);
    expect(onbAudits().filter(a => a.act.startsWith('Onboarding document')).map(a => a.act))
      .toEqual(['Onboarding document uploaded', 'Onboarding document rejected', 'Onboarding document uploaded', 'Onboarding document verified']);
  });
  test('chasing tells the starter what is outstanding, once, with one audit row; with nothing outstanding there is nothing to chase', async () => {
    const call = await as('manager');
    const r = StarterChased.parse((await team(call, 'CP-1502', 'chase', undefined)).body);
    const out = OnboardingDetail.parse((await call('GET', '/api/v1/onboarding/team/CP-1502')).body).toStart;
    expect(r.summary).toBe(`Tom Achterberg reminded. ${out.length} outstanding.`);
    expect(notes('CP-1502').map(n => [n.event, n.body])).toEqual([['ob_chased', outstandingText(out as Blocker[])]]);
    expect(onbAudits().map(a => a.act)).toEqual(['Onboarding chased']);
    complete('CP-1502');
    expect(refusal(await team(call, 'CP-1502', 'chase', undefined)).code).toBe('NOTHING_OUTSTANDING');
  });
});

/* ----------------------------------------------------------- activation */
describe('activation is refused on the server while start blockers remain, through every path (D6)', () => {
  test('Start them with anything outstanding is refused with the count and the first reason, and nothing is written', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await team(call, 'CP-1502', 'start', undefined, 1);
    expect(r.status).toBe(409);
    const out = OnboardingDetail.parse((await call('GET', '/api/v1/onboarding/team/CP-1502')).body).toStart;
    expect(refusal(r)).toMatchObject({ code: 'NOT_READY', message: notReadyText('Tom Achterberg', out as Blocker[]) });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('the lifecycle dialog (the transition endpoint) is refused alike, and nothing is written', async () => {
    const call = await as('admin'), p = personOf('CP-1502'), before = snapshot(...WRITES);
    const r = await call('POST', `/api/v1/people/${p.id}/transitions`, { to: 'active', reason: 'First day' }, p.version);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'NOT_READY', message: expect.stringMatching(/^Tom Achterberg cannot start yet\. \d+ outstanding\. Personal details not completed\.$/) });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a required document not yet verified still blocks the start while verification is on', async () => {
    complete('CP-1502');
    store.coll<Case>('onboardingCases')['onb_CP-1502'] = { ...(caseOf('CP-1502') as Case), docs: { rtw: 'done', addr: 'verified', photo: 'verified' } };
    const r = await team(await as('manager'), 'CP-1502', 'start', undefined, 1);
    expect(refusal(r).message).toBe('Tom Achterberg cannot start yet. 1 outstanding. Right to work not verified.');
  });
  test('with nothing outstanding Start them makes them active with the reason "Onboarding complete", one audit row', async () => {
    complete('CP-1502');
    const r = StarterMoved.parse((await team(await as('manager'), 'CP-1502', 'start', undefined, 1)).body);
    expect(r.person.state).toBe('active');
    expect(r.record.startedAt).toBe('2026-08-13T14:30:00.000Z');
    expect(r.summary).toBe('Tom Achterberg is active. They can now be scheduled and paid.');
    const hist = Object.values(store.coll<{ personCode: string; to: string; reason?: string }>('personHistory')).filter(h => h.personCode === 'CP-1502');
    expect(hist.map(h => [h.to, h.reason])).toEqual([['active', START_REASON]]);
    expect(onbAudits()).toHaveLength(1);
    expect(onbAudits()[0]).toMatchObject({ act: 'Employee active', entityId: 'CP-1502', reason: START_REASON });
  });
  test('with nothing outstanding the transition endpoint moves them too, and the case records the start', async () => {
    complete('CP-1502');
    const call = await as('admin'), p = personOf('CP-1502');
    expect((await call('POST', `/api/v1/people/${p.id}/transitions`, { to: 'active', reason: 'First day' }, p.version)).status).toBe(200);
    expect(caseOf('CP-1502')?.startedAt).toBe('2026-08-13T14:30:00.000Z');
  });
  test('a candidate cannot be started: they are invited first', async () => {
    complete('CP-1501');
    const r = await team(await as('manager'), 'CP-1501', 'start', undefined, 1);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'transition', message: 'A candidate record cannot become active.' });
  });
  test('with the Onboarding module off the lifecycle alone decides, as in the prototype', async () => {
    setModule('ON', false);
    const call = await as('admin'), p = personOf('CP-1502');
    expect((await call('POST', `/api/v1/people/${p.id}/transitions`, { to: 'active', reason: 'First day' }, p.version)).status).toBe(200);
  });
});

describe('invite (D6)', () => {
  test('a candidate is invited: preboarding with the reason, the invitation time on the case, told in the app only, and the toast says no email is sent', async () => {
    const r = StarterMoved.parse((await team(await as('manager'), 'CP-1501', 'invite', undefined, 1)).body);
    expect(r.person.state).toBe('preboard');
    expect(r.record.invitedAt).toBe('2026-08-13T14:30:00.000Z');
    expect(r.summary).toBe('Priya Raman is invited. They sign in with priya.raman@brightpath.org. No email is sent in this build.');
    const n = notes('CP-1501');
    expect(n.map(x => x.event)).toEqual(['ob_invited']);
    expect(n[0]?.delivery).toMatchObject({ inApp: true, email: null });
    const hist = Object.values(store.coll<{ personCode: string; to: string; reason?: string }>('personHistory')).filter(h => h.personCode === 'CP-1501');
    expect(hist.map(h => [h.to, h.reason])).toEqual([['preboard', INVITE_REASON]]);
    expect(onbAudits().map(a => [a.act, a.reason])).toEqual([['Onboarding invited', INVITE_REASON]]);
  });
  test('without a work email there is nowhere to send it; someone already preboarding cannot be invited again; nothing is written', async () => {
    setPerson('CP-1501', { email: '' });
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await team(call, 'CP-1501', 'invite', undefined, 1);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'NO_EMAIL', message: noEmailText('Priya Raman') });
    const again = await team(call, 'CP-1502', 'invite', undefined, 1);
    expect(refusal(again).code).toBe('transition');
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

/* --------------------------------------------------------- D1, D7, D8 */
const newStarter = (over: Record<string, unknown> = {}) => ({
  code: 'CP-9001', name: 'Hannah Vogel', email: 'hannah.vogel@brightpath.org', phone: '', jobProfile: 'SW', employeeType: 'shift', category: '', location: 'WH',
  department: '', manager: 'Rachel Hussain', contractedHours: 30, maxHours: 0, night: false, resource: '', cis: false, start: '2026-09-01', state: 'candidate', userType: 'employee', ...over,
});
describe('a case for every starter (D1)', () => {
  test('a person created as a candidate gets an empty case; one created active does not', async () => {
    const call = await as('admin');
    expect((await call('POST', '/api/v1/people', newStarter())).status).toBe(200);
    expect(caseOf('CP-9001')).toMatchObject({ id: 'onb_CP-9001', version: 1, steps: {}, submittedAt: '' });
    expect(onbAudits().find(a => a.act === 'Employee created')?.after).toMatchObject({ onboardingCase: 'onb_CP-9001' });
    expect((await call('POST', '/api/v1/people', newStarter({ code: 'CP-9002', email: 'x.y@brightpath.org', state: 'active' }))).status).toBe(200);
    expect(caseOf('CP-9002')).toBeUndefined();
  });
  test('moving into preboarding creates a case when there is none, and keeps one that exists', async () => {
    const call = await as('admin');
    Reflect.deleteProperty(store.coll('onboardingCases'), 'onb_CP-1501');
    const p = personOf('CP-1501');
    expect((await call('POST', `/api/v1/people/${p.id}/transitions`, { to: 'preboard', reason: 'Offer accepted' }, p.version)).status).toBe(200);
    expect(caseOf('CP-1501')).toMatchObject({ version: 1, steps: {} });
    resetTo('social');
    const kept = caseOf('CP-1501');
    if (kept) kept.data.personal.ni = 'QQ123456C';
    const q = personOf('CP-1501');
    expect((await (await as('admin'))('POST', `/api/v1/people/${q.id}/transitions`, { to: 'preboard', reason: 'Offer accepted' }, q.version)).status).toBe(200);
    expect(caseOf('CP-1501')?.data.personal.ni).toBe('QQ123456C');
  });
});
describe('people create refuses a missing, malformed or duplicate work email for a starter (D7)', () => {
  test('each is refused with its sentence, and nothing is written', async () => {
    const call = await as('admin'), before = snapshot(...WRITES);
    const cases: [Record<string, unknown>, string][] = [
      [{ email: '' }, 'A work email address is required. It is how they sign in.'],
      [{ email: 'hannah at brightpath' }, 'That does not look like an email address.'],
      [{ email: AMARA, state: 'preboard' }, `${AMARA} is already used by Amara Okafor. One address, one account.`],
    ];
    for (const [over, message] of cases) {
      const r = await call('POST', '/api/v1/people', newStarter(over));
      expect(r.status).toBe(422);
      expect(refusal(r)).toMatchObject({ field: 'email', message });
    }
    expect(snapshot(...WRITES)).toEqual(before);
  });
});
describe('a new starter sees the portal only (D8)', () => {
  const sessionOf = async (email: string) => {
    const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
    return Session.parse(await r.json());
  };
  test('session.onboarding is true for a candidate or preboarding person while Onboarding is on, false otherwise', async () => {
    expect((await sessionOf(PRIYA)).onboarding).toBe(true);
    expect((await sessionOf(TOM)).onboarding).toBe(true);
    expect((await sessionOf(AMARA)).onboarding).toBe(false);
    setModule('ON', false);
    expect((await sessionOf(PRIYA)).onboarding).toBe(false);
  });
  test('the inbox builds its links from the portal-only nav: a leave item opens nothing for a starter', async () => {
    store.coll('notifications').ntf_000000000901 = { id: 'ntf_000000000901', version: 1, updatedAt: '2026-08-13T14:00:00.000Z', personId: 'CP-1501', area: 'Leave',
      title: 'Leave approved', body: 'x', at: '2026-08-13T14:00:00.000Z', read: false };
    const mine = MyNotifications.parse((await (await asEmail(PRIYA))('GET', '/api/v1/notifications/me')).body);
    expect(mine.items.find(i => i.id === 'ntf_000000000901')?.link).toBeNull();
  });
});

/* ---------------------------------------------------------------- setup */
describe('onboarding setup (D2, D10, D11)', () => {
  const setup = async (call: Call) => OnboardingSetup.parse((await call('GET', '/api/v1/onboarding/config')).body);
  test('switching a step saves the whole config once, with before and after; a fixed step cannot be switched off', async () => {
    const call = await as('admin'), s = await setup(call);
    const steps = s.config.steps.map(x => (x.id === 'emergency' ? { ...x, on: false } : x));
    const r = OnboardingConfigSaved.parse((await call('PUT', '/api/v1/onboarding/config', { steps, documents: s.config.documents }, 1)).body);
    expect(r.summary).toBe(stepSwitchText('Emergency contacts', false));
    expect(r.record.version).toBe(2);
    expect(onbAudits()).toHaveLength(1);
    expect(onbAudits()[0]).toMatchObject({ act: 'Onboarding setup saved', before: { steps: { emergency: true } }, after: { steps: { emergency: false } } });
    const before = snapshot(...WRITES);
    const fixed = await call('PUT', '/api/v1/onboarding/config', { steps: r.record.steps.map(x => (x.id === 'personal' ? { ...x, on: false } : x)), documents: r.record.documents }, 2);
    expect(fixed.status).toBe(409);
    expect(refusal(fixed)).toMatchObject({ code: 'FIXED', message: ALWAYS_ASKED });
    expect((await call('PUT', '/api/v1/onboarding/config', { steps, documents: s.config.documents }, 1)).status).toBe(412);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a policy needs a name and no two share one; a new one starts at v1.0', async () => {
    const call = await as('admin'), before = snapshot(...WRITES);
    expect(refusal(await call('POST', '/api/v1/onboarding/policies', { label: ' ' }))).toMatchObject({ field: 'label', message: POLICY_NAME_NEEDED });
    expect(refusal(await call('POST', '/api/v1/onboarding/policies', { label: 'code of CONDUCT!' }))).toMatchObject({ field: 'label', message: POLICY_NAME_TAKEN });
    expect(snapshot(...WRITES)).toEqual(before);
    const r = PolicySaved.parse((await call('POST', '/api/v1/onboarding/policies', { label: 'Fire safety', sum: 'Exits and drills.' })).body);
    expect(r.record).toMatchObject({ id: 'pol_fire_safety', ver: 'v1.0', order: 4, ackCount: 0 });
    expect(r.summary).toBe('Fire safety saved. Upload the document to make it readable.');
  });
  test('a new upload raises the version and asks everyone who acknowledged it again, exactly once (D10)', async () => {
    for (const email of [TOM, PRIYA]) await (await asEmail(email))('POST', '/api/v1/onboarding/me/policies/pol_conduct/ack', { on: true }, 1);
    const call = await as('admin');
    expect((await setup(call)).policies.find(p => p.id === 'pol_conduct')?.ackCount).toBe(2);
    const first = PolicyUploaded.parse((await call('POST', '/api/v1/onboarding/policies/pol_conduct/file', { name: 'conduct-v4-2.pdf', size: 200_000, type: 'application/pdf' }, 1)).body);
    expect(first).toMatchObject({ asked: 2, summary: 'Code of conduct is now v4.2. 2 people will be asked again.', record: { ver: 'v4.2', ackCount: 0, file: { name: 'conduct-v4-2.pdf' } } });
    expect([caseOf('CP-1501')?.acks, caseOf('CP-1502')?.acks]).toEqual([{}, {}]);
    const second = PolicyUploaded.parse((await call('POST', '/api/v1/onboarding/policies/pol_conduct/file', { name: 'conduct-v4-3.pdf', size: 200_000, type: 'application/pdf' }, 2)).body);
    expect(second).toMatchObject({ asked: 0, summary: 'Code of conduct is now v4.3. It is ready to read.' });
    expect(onbAudits().filter(a => a.act === 'Policy document uploaded').map(a => (a.after as { askedAgain: number }).askedAgain)).toEqual([2, 0]);
  });
  test('removing a policy keeps past acknowledgements in the audit trail and on the cases', async () => {
    await (await asEmail(TOM))('POST', '/api/v1/onboarding/me/policies/pol_itsec/ack', { on: true }, 1);
    const call = await as('admin');
    expect((await setup(call)).policies.find(p => p.id === 'pol_itsec')?.removeText).toContain('1 person has acknowledged this policy.');
    expect((await call('DELETE', '/api/v1/onboarding/policies/pol_itsec', undefined, 1)).status).toBe(200);
    expect(store.coll('onboardingPolicies').pol_itsec).toBeUndefined();
    expect(caseOf('CP-1502')?.acks.pol_itsec).toBe('v3.2');
    expect(onbAudits().filter(a => a.act.startsWith('Policy')).map(a => a.act)).toEqual(['Policy acknowledged', 'Policy removed']);
  });
});

describe('the Onboarding module switch', () => {
  test('with the module off every endpoint refuses', async () => {
    setModule('ON', false);
    const r = await (await asEmail(TOM))('GET', '/api/v1/onboarding/me');
    expect(r.status).toBe(403);
    expect(refusal(r).code).toBe('module-off');
  });
  test('turning it off reports the cases still in progress, which are kept', async () => {
    const r = await (await as('admin'))('PATCH', '/api/v1/tenant/modules/ON', { on: false }, tenant()?.version);
    expect(r.status).toBe(200);
    expect((r.body as { effect: { kept: unknown[] } }).effect.kept).toEqual([{ what: 'onboarding cases in progress', count: 2 }]);
    expect(Object.keys(store.coll('onboardingCases'))).toHaveLength(2);
  });
});

/* --------------------------------------------------------------- faults */
describe('a fault on each write leaves no case change, notification or audit row (Review Focus 5)', () => {
  const writes: [string, string, string, string, unknown, number | undefined][] = [
    ['save a step', TOM, 'PUT', '/api/v1/onboarding/me/steps/personal', { mode: 'check', personal: PERSONAL }, 1],
    ['upload', TOM, 'POST', '/api/v1/onboarding/me/documents/photo', PHOTO, 1],
    ['read a policy', TOM, 'POST', '/api/v1/onboarding/me/policies/pol_conduct/read', undefined, 1],
    ['acknowledge', TOM, 'POST', '/api/v1/onboarding/me/policies/pol_conduct/ack', { on: true }, 1],
    ['submit', TOM, 'POST', '/api/v1/onboarding/me/submit', { consent: true, signature: 'Tom Achterberg' }, 1],
    ['invite', 'rachel.hussain@brightpath.org', 'POST', '/api/v1/onboarding/team/CP-1501/invite', undefined, 1],
    ['start', 'rachel.hussain@brightpath.org', 'POST', '/api/v1/onboarding/team/CP-1502/start', undefined, 1],
    ['chase', 'rachel.hussain@brightpath.org', 'POST', '/api/v1/onboarding/team/CP-1502/chase', undefined, undefined],
    ['save setup', 'dee.fitzgerald@brightpath.org', 'PUT', '/api/v1/onboarding/config', { steps: [], documents: [] }, 1],
    ['add a policy', 'dee.fitzgerald@brightpath.org', 'POST', '/api/v1/onboarding/policies', { label: 'Fire safety' }, undefined],
    ['edit a policy', 'dee.fitzgerald@brightpath.org', 'PATCH', '/api/v1/onboarding/policies/pol_conduct', { label: 'Conduct' }, 1],
    ['upload a policy', 'dee.fitzgerald@brightpath.org', 'POST', '/api/v1/onboarding/policies/pol_conduct/file', PHOTO, 1],
    ['remove a policy', 'dee.fitzgerald@brightpath.org', 'DELETE', '/api/v1/onboarding/policies/pol_conduct', undefined, 1],
  ];
  for (const [what, email, method, path, body, v] of writes) {
    test(what, async () => {
      const call = await asEmail(email), before = snapshot(...WRITES);
      await fault(method, path);
      const r = await call(method, path, body, v);
      expect(r.status).toBe(500);
      expect(refusal(r).code).toBe('fault');
      expect(snapshot(...WRITES)).toEqual(before);
    });
  }
  test('verify and reject', async () => {
    await upload(await asEmail(TOM), 'photo', PHOTO, 1);
    const call = await as('manager');
    for (const [kind, body] of [['verify', undefined], ['reject', { reason: 'Too dark' }]] as const) {
      const before = snapshot(...WRITES), path = `/api/v1/onboarding/team/CP-1502/documents/photo/${kind}`;
      await fault('POST', path);
      expect((await call('POST', path, body, version('CP-1502'))).status).toBe(500);
      expect(snapshot(...WRITES)).toEqual(before);
    }
  });
  test('a throw after the case and the notification are written rolls both back', async () => {
    complete('CP-1502');
    const call = await asEmail(TOM), before = snapshot(...WRITES);
    store.db.audit = Object.freeze({ ...store.db.audit });
    const r = await call('POST', '/api/v1/onboarding/me/submit', { consent: true, signature: 'Tom Achterberg' }, 1);
    expect(r.status).toBe(500);
    expect(snapshot(...WRITES.filter(c => c !== 'audit'))).toEqual(Object.fromEntries(Object.entries(before).filter(([k]) => k !== 'audit')));
  });
});
