import {
  ALL_FEATURES, ALREADY_SUBMITTED, ALWAYS_ASKED, CONSENT_NEEDED, CONVICTIONS_NOTE, FILES_NOTE, POLICY_NAME_NEEDED, POLICY_NAME_TAKEN, REASON_NEEDED,
  SIGNATURE_NEEDED, STEP_MESSAGES, STEP_UNAVAILABLE, TASK_STATE, UPLOAD_MAX_BYTES, WORKING_TIME_NOTE, ackCount, acknowledgedText, applyPolicyUpload,
  applyUpload, blockers, caseId, configProblem, decideDocument, decidedText, docsAsked, emptyCase, fieldProblem, fileKind, fileRecord, fileSize, hasPreview,
  isStarterState, markRead, nextPolVer, nextRef, noEmailText, normaliseField, notReadyText, onbFeatures, outstandingText, policyAcknowledged, policyFromDraft,
  policyKey, policyProblem, policyRemovedText, policySavedText, policyUploadedText, progress, progressText, readyToStart, removePolicyText, saveStep,
  setPolicyAck, startProblem, stepAvailable, stepNotAsked, stepProblem, stepSavedText, stepSwitchProblem, stepSwitchText, stepsAsked, stillToDoText,
  submitCase, submittedText, taskState, tooLargeText, uploadProblem, uploadState, uploadedText, PERSONAL_FIELDS, CONTACT_FIELDS, QUALIFICATION_FIELDS,
  type BlockerContext, type OnbDocument, type OnbFeatures, type OnbFile, type OnbPolicy, type OnboardingCase, type OnboardingConfig, type StepContext,
} from './onboarding';

const TODAY = '2026-08-13';
const AT = '2026-08-13T08:00:00.000Z';
/* P's ONB_STEPS and ONB_DOCS (v15 4112-4145), descriptions shortened where no rule reads them. */
const CONFIG: OnboardingConfig = {
  steps: [
    { id: 'personal', label: 'Personal details', on: true, fixed: true, desc: '' },
    { id: 'contact', label: 'Contact information', on: true, fixed: true, desc: '' },
    { id: 'emergency', label: 'Emergency contacts', on: true, fixed: false, desc: '' },
    { id: 'additional', label: 'Additional information', on: true, fixed: false, desc: '' },
    { id: 'documents', label: 'Documents', on: true, fixed: false, desc: '' },
    { id: 'policies', label: 'Policies and sign-off', on: true, fixed: false, desc: '' },
    { id: 'review', label: 'Review and submit', on: true, fixed: true, desc: '' },
  ],
  documents: [
    { id: 'rtw', label: 'Right to work', req: true, verify: 'hr', blocks: true, expiry: true, hint: '' },
    { id: 'addr', label: 'Proof of address', req: true, verify: 'hr', blocks: false, expiry: false, hint: '' },
    { id: 'photo', label: 'Photograph', req: true, verify: 'either', blocks: false, expiry: false, hint: '' },
    { id: 'licence', label: 'Driving licence', req: false, verify: 'mgr', blocks: false, expiry: true, hint: '' },
    { id: 'cert', label: 'Certificates', req: false, verify: 'mgr', blocks: false, expiry: true, hint: '' },
  ],
};
const POLICIES: OnbPolicy[] = [
  { id: 'pol_conduct', label: 'Code of conduct', ver: 'v4.1', sum: '', body: [], order: 0 },
  { id: 'pol_privacy', label: 'Privacy notice', ver: 'v2.0', sum: '', body: [], order: 1 },
];
const doc = (id: string): OnbDocument => { const d = CONFIG.documents.find(x => x.id === id); if (!d) throw new Error(id); return d; };
const F = ALL_FEATURES;
const off = (k: keyof OnbFeatures): OnbFeatures => ({ ...F, [k]: false });
const ctx = (features: OnbFeatures = F): BlockerContext => ({ config: CONFIG, features });
const sctx = (features: OnbFeatures = F): StepContext => ({ features, documents: CONFIG.documents, policies: POLICIES, today: TODAY });
const PDF: OnbFile = { name: 'scan.pdf', size: 2048, type: 'application/pdf', at: AT, kind: 'pdf' };
const must = <T>(o: { ok: true; value: T } | { ok: false }): T => { if (!o.ok) throw new Error('refused'); return o.value; };
const refusal = (o: { ok: true } | { ok: false; refusal: { message: string } }) => (o.ok ? null : o.refusal.message);

/* A case with every own duty done and every required document uploaded (waiting on a check). */
function complete(c: OnboardingCase = emptyCase('EMP002')): OnboardingCase {
  let x = c;
  for (const d of CONFIG.documents.filter(d => d.req)) x = must(applyUpload(x, d, PDF, F));
  for (const p of POLICIES) x = setPolicyAck(x, p, true);
  const steps = { personal: 'done', contact: 'done', emergency: 'done', additional: 'done', documents: 'done', policies: 'done' } as const;
  return { ...x, steps };
}

describe('features and availability', () => {
  test('a feature counts only while Onboarding is on', () => {
    const flags = { ONB_RTW: true, ONB_CONV: false, ONB_WTD: true, ONB_QUAL: true, ONB_POL: true, ONB_SIGN: true, ONB_VERIFY: true };
    expect(onbFeatures({ ON: true }, flags)).toEqual({ ...F, conv: false });
    expect(Object.values(onbFeatures({ ON: false }, flags)).some(Boolean)).toBe(false);
  });
  test('additional needs convictions, working time or qualifications; policies needs ONB_POL; others always', () => {
    expect(stepAvailable('additional', { ...F, conv: false, wtd: false })).toBe(true);
    expect(stepAvailable('additional', { ...F, conv: false, wtd: false, qual: false })).toBe(false);
    expect(stepAvailable('policies', off('pol'))).toBe(false);
    expect(stepAvailable('documents', off('rtw'))).toBe(true);
  });
  test('the steps asked are the ones switched on and available; fixed ones always', () => {
    expect(stepsAsked(CONFIG, F).map(s => s.id)).toHaveLength(7);
    const cfg = { ...CONFIG, steps: CONFIG.steps.map(s => (s.id === 'emergency' || s.id === 'personal' ? { ...s, on: false } : s)) };
    expect(stepsAsked(cfg, off('pol')).map(s => s.id)).toEqual(['personal', 'contact', 'additional', 'documents', 'review']);
  });
  test('the right-to-work document is asked only while ONB_RTW is on', () => {
    expect(docsAsked(CONFIG, F).map(d => d.id)).toContain('rtw');
    expect(docsAsked(CONFIG, off('rtw')).map(d => d.id)).toEqual(['addr', 'photo', 'licence', 'cert']);
  });
  test('task states carry P\'s labels, and anything unknown reads as not started', () => {
    expect(Object.values(TASK_STATE).map(s => s.label)).toEqual(['Not started', 'In progress', 'Submitted', 'Verified', 'Rejected']);
    expect(taskState('nonsense').label).toBe('Not started');
  });
  test('a case is empty, keyed onb_<code>, and starters are candidates or preboarding', () => {
    const c = emptyCase('EMP002');
    expect([caseId('EMP002'), c.steps, c.docs, c.acks, c.data.emergency.length, c.consent, c.ref]).toEqual(['onb_EMP002', {}, {}, {}, 1, false, '']);
    expect(['candidate', 'preboard', 'active'].map(isStarterState)).toEqual([true, true, false]);
  });
});

describe('fields', () => {
  const ni = PERSONAL_FIELDS.find(f => f.key === 'ni'), post = CONTACT_FIELDS.find(f => f.key === 'post');
  const dob = PERSONAL_FIELDS.find(f => f.key === 'dob'), exp = QUALIFICATION_FIELDS.find(f => f.key === 'exp');
  test('the NI number and postcode are upper-cased and length-limited; email and phone are typed', () => {
    if (!ni || !post || !dob || !exp) throw new Error('fields');
    expect([ni.maxlength, post.maxlength, normaliseField(ni, ' qq123456c '), normaliseField(post, 'm50 2yr')]).toEqual([13, 8, 'QQ123456C', 'M50 2YR']);
    expect(PERSONAL_FIELDS.find(f => f.key === 'email')?.type).toBe('email');
    expect(CONTACT_FIELDS.filter(f => f.type === 'tel').map(f => f.key)).toEqual(['mob', 'alt']);
    expect(fieldProblem(ni, 'QQ 12 34 56 C XX', TODAY)?.message).toBe('National insurance number can be at most 13 characters.');
  });
  test('a birth date is a real date not after today; an expiry not before today', () => {
    if (!dob || !exp) throw new Error('fields');
    expect(fieldProblem(dob, '1994-05-14', TODAY)).toBeNull();
    expect(fieldProblem(dob, '14/05/1994', TODAY)?.message).toBe('Date of birth must be a date.');
    expect(fieldProblem(dob, '2026-08-14', TODAY)?.message).toBe('Date of birth cannot be in the future.');
    expect(fieldProblem(exp, '2026-08-12', TODAY)?.message).toBe('Expires cannot be in the past.');
    expect(fieldProblem(exp, '', TODAY)).toBeNull();
  });
  test('the convictions and working time notes are kept as P words them (D13)', () => {
    expect(CONVICTIONS_NOTE).toMatch(/does not by itself prevent you starting\.$/);
    expect(WORKING_TIME_NOTE).toMatch(/voluntary/);
    expect(WORKING_TIME_NOTE).toMatch(/withdraw it later/);
  });
});

describe('step validation (onbSaveStep)', () => {
  const save = (id: Parameters<typeof saveStep>[1], patch: Parameters<typeof saveStep>[2], c = emptyCase('EMP002'), f = F) =>
    saveStep(c, id, patch, sctx(f), 'check');
  test('personal: date of birth, nationality, then NI number, each as a sentence', () => {
    expect(refusal(save('personal', {}))).toBe(STEP_MESSAGES.dob);
    expect(refusal(save('personal', { personal: { dob: '1994-05-14' } }))).toBe('A nationality is required.');
    expect(refusal(save('personal', { personal: { dob: '1994-05-14', nat: 'British' } })))
      .toBe('A national insurance number is required. Payroll cannot report you without it.');
    const c = must(save('personal', { personal: { dob: '1994-05-14', nat: 'British', ni: 'qq123456c' } }));
    expect([c.steps.personal, c.data.personal.ni]).toEqual(['done', 'QQ123456C']);
    expect(stepSavedText('Personal details')).toBe('Personal details saved.');
  });
  test('contact: mobile, address, town, postcode', () => {
    const full = { mob: '07700 900123', a1: '4 Mill Lane', city: 'Manchester', post: 'M50 2YR' };
    expect(refusal(save('contact', {}))).toBe('A mobile number is required.');
    expect(refusal(save('contact', { contact: { mob: full.mob } }))).toBe('An address is required.');
    expect(refusal(save('contact', { contact: { mob: full.mob, a1: full.a1 } }))).toBe('A town or city is required.');
    expect(refusal(save('contact', { contact: { ...full, post: '' } }))).toBe('A postcode is required.');
    expect(must(save('contact', { contact: full })).steps.contact).toBe('done');
  });
  test('emergency: only the first contact is required, name then phone', () => {
    expect(refusal(save('emergency', {}))).toBe('At least one emergency contact is required.');
    expect(refusal(save('emergency', { emergency: [{ nm: 'Anita Raman' }] }))).toBe('The emergency contact needs a phone number.');
    const c = must(save('emergency', { emergency: [{ nm: 'Anita Raman', rel: 'Parent', ph: '07700 900456' }, {}] }));
    expect(c.data.emergency).toHaveLength(2);
  });
  test('additional: convictions answered, details when Yes, working time answered; switched-off questions are not asked', () => {
    expect(refusal(save('additional', {}))).toBe('Answer the convictions question.');
    expect(refusal(save('additional', { additional: { conv: 'Yes' } }))).toBe('Give details of the conviction.');
    expect(refusal(save('additional', { additional: { conv: 'No' } }))).toBe('Answer the working time question.');
    expect(refusal(save('additional', { additional: { conv: 'Maybe' } }))).toBe('Do you have any unspent convictions? must be one of the choices offered.');
    expect(save('additional', {}, emptyCase('X'), { ...F, conv: false, wtd: false }).ok).toBe(true);
    expect(must(save('additional', { additional: { conv: 'No', wtd: 'No, I do not opt out', quals: [{ nm: 'NVQ 3' }] } })).data.additional.quals)
      .toEqual([{ nm: 'NVQ 3', by: '', exp: '' }]);
  });
  test('documents: the right-to-work type, then the first required document missing or rejected', () => {
    expect(refusal(save('documents', {}))).toBe('Say which document proves your right to work.');
    expect(refusal(save('documents', { documents: { rtwType: 'Passport' } }))).toBe('Right to work is required.');
    expect(refusal(save('documents', {}, emptyCase('X'), off('rtw')))).toBe('Proof of address is required.');
    let c = emptyCase('X');
    for (const id of ['rtw', 'addr', 'photo']) c = must(applyUpload(c, doc(id), PDF, F));
    c = { ...c, docs: { ...c.docs, addr: 'rejected' } };
    expect(refusal(save('documents', { documents: { rtwType: 'Passport' } }, c))).toBe('Proof of address is required.');
  });
  test('policies: each must be acknowledged for its current version', () => {
    expect(refusal(save('policies', {}))).toBe('Acknowledge Code of conduct before continuing.');
    let c = setPolicyAck(emptyCase('X'), POLICIES[0] ?? POLICIES[1] as OnbPolicy, true);
    expect(refusal(save('policies', {}, c))).toBe('Acknowledge Privacy notice before continuing.');
    c = POLICIES.reduce((x, p) => setPolicyAck(x, p, true), c);
    expect(save('policies', {}, c).ok).toBe(true);
  });
  test('quiet saves keep the data without judging or ticking; a malformed value is still refused', () => {
    const c = must(saveStep(emptyCase('X'), 'personal', { personal: { nat: 'British' } }, sctx(), 'quiet'));
    expect([c.data.personal.nat, c.steps.personal]).toEqual(['British', undefined]);
    expect(saveStep(emptyCase('X'), 'personal', { personal: { dob: 'soon' } }, sctx(), 'quiet').ok).toBe(false);
    expect(stepProblem('review', emptyCase('X'), sctx())).toBeNull();
  });
  test('a submitted case is closed, except a step sent back', () => {
    const sub = { ...emptyCase('X'), submittedAt: AT };
    expect(refusal(save('personal', {}, sub))).toBe(ALREADY_SUBMITTED.message);
    expect(refusal(save('documents', {}, { ...sub, steps: { documents: 'prog' } }))).toBe('Say which document proves your right to work.');
    expect(stepNotAsked('banking').message).toBe('There is no step "banking" to complete.');
  });
});

describe('blockers and progress', () => {
  test('an empty case: every step but review, and each required document not uploaded', () => {
    const bl = blockers(emptyCase('X'), ctx());
    expect(bl.map(b => b.why)).toEqual(['Personal details not completed', 'Contact information not completed', 'Emergency contacts not completed',
      'Additional information not completed', 'Documents not completed', 'Policies and sign-off not completed',
      'Right to work not uploaded', 'Proof of address not uploaded', 'Photograph not uploaded']);
    expect(bl.some(b => b.id === 'review')).toBe(false);
  });
  test('submit counts the person\'s own duties; start adds a blocking document not yet verified', () => {
    const c = complete();
    expect(blockers(c, ctx(), 'submit')).toEqual([]);
    expect(blockers(c, ctx(), 'start').map(b => b.why)).toEqual(['Right to work not verified']);
    expect(blockers(c, ctx(off('verify')), 'start')).toEqual([]);
    expect(readyToStart(must(decideDocument(c, doc('rtw'), { ok: true })), ctx())).toBe(true);
  });
  test('a rejected required document blocks both stages; optional documents never block', () => {
    const c = must(decideDocument(complete(), doc('addr'), { ok: false, reason: 'Too old' }));
    expect(blockers(c, ctx(), 'submit').map(b => b.why)).toEqual(['Documents not completed', 'Proof of address was rejected']);
    expect(blockers(c, ctx()).some(b => b.id === 'licence')).toBe(false);
    expect(outstandingText(blockers(c, ctx(), 'submit'))).toBe('Documents not completed. Proof of address was rejected.');
  });
  test('progress counts done steps, and review once submitted', () => {
    expect(progress(emptyCase('X'), ctx())).toEqual({ done: 0, total: 7 });
    expect(progress(complete(), ctx())).toEqual({ done: 6, total: 7 });
    expect(progressText(progress({ ...complete(), submittedAt: AT }, ctx()))).toBe('7 of 7 done');
    expect(progress(emptyCase('X'), ctx(off('pol')))).toEqual({ done: 0, total: 6 });
  });
});

describe('submit', () => {
  const sub = (c: OnboardingCase, consent: boolean, signature?: string, f = F) =>
    submitCase(c, { consent, ...(signature === undefined ? {} : { signature }), ref: 'ONB-1001', at: AT }, ctx(f));
  test('outstanding duties are refused with the count and the first reason', () => {
    expect(refusal(sub(emptyCase('X'), true, 'Priya Raman'))).toBe('9 things are still to do. Personal details not completed.');
    expect(stillToDoText([{ kind: 'doc', id: 'rtw', why: 'Right to work not uploaded' }])).toBe('1 thing is still to do. Right to work not uploaded.');
  });
  test('the consent tick, then the typed signature while ONB_SIGN is on', () => {
    expect(refusal(sub(complete(), false, 'Priya Raman'))).toBe(CONSENT_NEEDED);
    expect(refusal(sub(complete(), true, '  '))).toBe(SIGNATURE_NEEDED);
    expect(sub(complete(), true, '', off('sign')).ok).toBe(true);
  });
  test('a good submission ticks review, stamps the time and reference, and cannot be repeated', () => {
    const c = must(sub(complete(), true, 'Priya Raman'));
    expect([c.steps.review, c.submittedAt, c.ref, c.signature, c.consent]).toEqual(['done', AT, 'ONB-1001', 'Priya Raman', true]);
    expect(refusal(sub(c, true, 'Priya Raman'))).toBe(ALREADY_SUBMITTED.message);
    expect(submittedText('ONB-1001')).toBe('Submitted with reference ONB-1001. HR has been told.');
  });
  test('the reference is ONB- and four digits, one past the highest given', () => {
    expect(nextRef([])).toBe('ONB-1001');
    expect(nextRef(['ONB-1001', 'ONB-1007', '', 'X-9999'])).toBe('ONB-1008');
    expect(nextRef([])).toMatch(/^ONB-\d{4}$/);
  });
});

describe('uploads (D3) and verification (D4)', () => {
  test('8 MB is the limit, refused with the file\'s size', () => {
    expect(uploadProblem({ name: 'scan.pdf', size: UPLOAD_MAX_BYTES })).toBeNull();
    expect(uploadProblem({ name: 'scan.pdf', size: UPLOAD_MAX_BYTES + 1 })?.message).toBe('scan.pdf is 8.0 MB. 8 MB is the most this browser can hold.');
    expect(tooLargeText('big.jpg', 9.6 * 1048576)).toBe('big.jpg is 9.6 MB. 8 MB is the most this browser can hold.');
    expect([fileSize(10), fileSize(2048), fileSize(1572864)]).toEqual(['1 KB', '2 KB', '1.5 MB']);
  });
  test('only an image keeps a preview; a PDF is named as one', () => {
    expect([fileKind('image/png'), fileKind('application/pdf'), fileKind('text/plain')]).toEqual(['image', 'pdf', 'file']);
    expect([hasPreview('image/jpeg'), hasPreview('application/pdf')]).toEqual([true, false]);
    expect(fileRecord({ name: 'a.pdf', size: 1, type: 'application/pdf', preview: 'data:x' }, AT)).toEqual({ name: 'a.pdf', size: 1, type: 'application/pdf', at: AT, kind: 'pdf' });
    expect(fileRecord({ name: 'a.jpg', size: 1, type: 'image/jpeg', preview: 'data:x' }, AT).preview).toBe('data:x');
    expect(FILES_NOTE).toMatch(/not sent to a document store/);
  });
  test('an upload waits on a check; a "none" document or verification off is verified at once', () => {
    expect(uploadState(doc('rtw'), F)).toBe('done');
    expect(uploadState({ verify: 'none' }, F)).toBe('verified');
    expect(uploadState(doc('rtw'), off('verify'))).toBe('verified');
    expect(uploadedText('Right to work', 'passport.pdf', 'done')).toBe('Right to work: passport.pdf is waiting to be checked.');
  });
  test('reject needs a reason, and a rejected required document reopens the documents step', () => {
    const c = complete();
    expect(refusal(decideDocument(c, doc('rtw'), { ok: false, reason: ' ' }))).toBe(REASON_NEEDED);
    const r = must(decideDocument(c, doc('rtw'), { ok: false, reason: 'The photograph is too dark to read' }));
    expect([r.docs.rtw, r.rejections.rtw, r.steps.documents]).toEqual(['rejected', 'The photograph is too dark to read', 'prog']);
    const opt = must(applyUpload(c, doc('cert'), PDF, F));
    expect(must(decideDocument(opt, doc('cert'), { ok: false, reason: 'Wrong file' })).steps.documents).toBe('done');
    expect(decidedText('Photograph', false, 'Priya Raman')).toBe('Photograph rejected. Priya Raman has been told.');
  });
  test('a replacement clears the rejection; nothing uploaded or already decided is refused', () => {
    const r = must(decideDocument(complete(), doc('rtw'), { ok: false, reason: 'Blurred' }));
    const again = must(applyUpload({ ...r, submittedAt: AT }, doc('rtw'), PDF, F));
    expect([again.docs.rtw, again.rejections.rtw]).toEqual(['done', undefined]);
    expect(refusal(decideDocument(emptyCase('X'), doc('rtw'), { ok: true }))).toBe('Nothing was uploaded for that document.');
    expect(refusal(decideDocument(r, doc('rtw'), { ok: true }))).toBe('Right to work is not waiting for a check.');
    expect(applyUpload({ ...complete(), submittedAt: AT }, doc('addr'), PDF, F).ok).toBe(false);
  });
});

describe('policies (D10)', () => {
  const conduct = POLICIES[0] as OnbPolicy;
  test('nextPolVer: v2.3 becomes v2.4, anything unparseable v1.1', () => {
    expect([nextPolVer('v2.3'), nextPolVer('4.1'), nextPolVer('v4.9'), nextPolVer('draft'), nextPolVer('')]).toEqual(['v2.4', 'v4.2', 'v4.10', 'v1.1', 'v1.1']);
  });
  test('an acknowledgement records the version; unticking removes it; reading is remembered', () => {
    const c = setPolicyAck(emptyCase('X'), conduct, true);
    expect([c.acks.pol_conduct, c.read.pol_conduct, policyAcknowledged(c, conduct)]).toEqual(['v4.1', true, true]);
    expect(policyAcknowledged(c, { ...conduct, ver: 'v4.2' })).toBe(false);
    expect(setPolicyAck(c, conduct, false).acks).toEqual({});
    expect(markRead(emptyCase('X'), conduct).read).toEqual({ pol_conduct: true });
    expect(acknowledgedText(conduct)).toBe('Code of conduct v4.1 acknowledged.');
  });
  test('a new upload bumps the version, clears that policy\'s acknowledgements and says how many are asked again', () => {
    const a = setPolicyAck(emptyCase('A'), conduct, true), b = setPolicyAck(emptyCase('B'), POLICIES[1] as OnbPolicy, true);
    const r = applyPolicyUpload(conduct, PDF, [a, b, emptyCase('C')]);
    expect([r.policy.ver, r.policy.file?.name, r.asked, r.changed.map(c => c.personCode)]).toEqual(['v4.2', 'scan.pdf', 1, ['A']]);
    expect(r.changed[0]?.acks).toEqual({});
    expect(ackCount(r.policy, [a, b])).toBe(0);
    expect(ackCount(conduct, [a, b])).toBe(1);
    expect(policyUploadedText('Code of conduct', 'v4.2', 2)).toBe('Code of conduct is now v4.2. 2 people will be asked again.');
    expect(policyUploadedText('Code of conduct', 'v4.2', 0)).toBe('Code of conduct is now v4.2. It is ready to read.');
  });
  test('adding needs a name that is not already taken; editing keeps its id', () => {
    expect(policyProblem({ label: ' ' }, POLICIES)?.message).toBe(POLICY_NAME_NEEDED);
    expect(policyProblem({ label: 'Code of Conduct!' }, POLICIES)?.message).toBe(POLICY_NAME_TAKEN);
    expect(policyProblem({ label: 'Code of conduct' }, POLICIES, 'pol_conduct')).toBeNull();
    expect(policyProblem({ label: 'Privacy notice' }, POLICIES, 'pol_conduct')?.message).toBe(POLICY_NAME_TAKEN);
    expect(policyKey('Safeguarding policy')).toBe('pol_safeguarding_policy');
    expect(policyFromDraft({ label: 'Safeguarding policy', ver: '' }, 4)).toMatchObject({ id: 'pol_safeguarding_policy', ver: 'v1.0', body: [], order: 4 });
    expect(policySavedText('Safeguarding policy')).toBe('Safeguarding policy saved. Upload the document to make it readable.');
  });
  test('removing asks first, and says past acknowledgements stay in the audit trail', () => {
    expect(removePolicyText(2)).toMatch(/^2 people have acknowledged this policy\. .*audit trail/);
    expect(removePolicyText(1)).toMatch(/^1 person has acknowledged/);
    expect(removePolicyText(0)).toBe('New starters will no longer be asked to read it.');
    expect(policyRemovedText('Privacy notice')).toBe('Privacy notice removed.');
  });
});

describe('step switches and config (D11, D2)', () => {
  const step = (id: string) => { const s = CONFIG.steps.find(x => x.id === id); if (!s) throw new Error(id); return s; };
  test('a fixed step is always asked', () => {
    expect(stepSwitchProblem(step('contact'), false, F)?.message).toBe(ALWAYS_ASKED);
  });
  test('a step whose features are off cannot be switched on, and says why', () => {
    const p = stepSwitchProblem({ ...step('policies'), on: false }, true, off('pol'));
    expect(p?.message).toBe(`Policies and sign-off cannot be switched on. ${STEP_UNAVAILABLE}`);
    expect(p?.next).toBe('Switch on Policy acknowledgement under Modules and features first.');
    expect(stepSwitchProblem(step('emergency'), false, F)).toBeNull();
    expect(stepSwitchText('Emergency contacts', false)).toBe('Emergency contacts will not be asked for. People part-way through keep what they have already given.');
  });
  test('Save takes switches and document settings only', () => {
    const swap = { ...CONFIG, steps: [...CONFIG.steps].reverse() };
    expect(configProblem(CONFIG, swap, F)?.message).toBe('Steps can be switched on or off, not added, removed or reordered.');
    const changed = { steps: CONFIG.steps.map(s => (s.id === 'emergency' ? { ...s, on: false } : s)),
      documents: CONFIG.documents.map(d => (d.id === 'rtw' ? { ...d, verify: 'none' as const, blocks: false } : d)) };
    expect(configProblem(CONFIG, changed, F)).toBeNull();
    expect(configProblem(CONFIG, { ...CONFIG, steps: CONFIG.steps.map(s => (s.id === 'review' ? { ...s, on: false } : s)) }, F)?.code).toBe('FIXED');
    expect(configProblem(CONFIG, { ...CONFIG, documents: CONFIG.documents.slice(1) }, F)?.message).toBe('Documents can be set, not added, removed or reordered.');
    const bad = { ...CONFIG, documents: CONFIG.documents.map(d => (d.id === 'cert' ? { ...d, verify: 'anyone' } : d)) } as unknown as OnboardingConfig;
    expect(configProblem(CONFIG, bad, F)?.field).toBe('documents.cert.verify');
  });
});

describe('activation (D6)', () => {
  test('a person with anything outstanding cannot start, and is told the count and the first reason', () => {
    const p = startProblem('Priya Raman', complete(), ctx());
    expect(p?.message).toBe('Priya Raman cannot start yet. 1 outstanding. Right to work not verified.');
    expect(notReadyText('Tom Achterberg', blockers(emptyCase('X'), ctx()))).toBe('Tom Achterberg cannot start yet. 9 outstanding. Personal details not completed.');
    expect(startProblem('Priya Raman', must(decideDocument(complete(), doc('rtw'), { ok: true })), ctx())).toBeNull();
  });
  test('an invitation needs an email address', () => {
    expect(noEmailText('Hannah Vogel')).toBe('Hannah Vogel has no email address, so there is nowhere to send an invitation. Add one on their record.');
  });
});
