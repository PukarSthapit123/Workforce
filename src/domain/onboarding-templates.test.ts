import {
  ALL_FEATURES, STEP_IDS, applyUpload, askedNow, askedOf, blockers, emptyCase,
  type OnboardingCase, type OnboardingConfig,
} from './onboarding';
import {
  TEMPLATE_NAME_LONG, TEMPLATE_NAME_NEEDED, TEMPLATE_NAME_RESERVED, TEMPLATE_NAME_TAKEN,
  configFor, newTemplateFrom, normaliseTemplate, onbTemplateId, onbTemplateNameProblem, onbTemplateProblem, templateFor, withPolicies,
  type BaseConfig, type OnbTemplate, type OnbTemplateDraft, type TemplateRuleContext,
} from './onboarding-templates';

const AT = '2026-08-13T08:00:00.000Z';
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
    { id: 'rtw', label: 'Right to work', req: true, verify: 'hr', blocks: true, expiry: true, hint: '', on: true, custom: false },
    { id: 'addr', label: 'Proof of address', req: true, verify: 'hr', blocks: false, expiry: false, hint: '', on: true, custom: false },
    { id: 'photo', label: 'Photograph', req: true, verify: 'either', blocks: false, expiry: false, hint: '', on: true, custom: false },
    { id: 'licence', label: 'Driving licence', req: false, verify: 'mgr', blocks: false, expiry: true, hint: '', on: true, custom: false },
    { id: 'cert', label: 'Certificates', req: false, verify: 'mgr', blocks: false, expiry: true, hint: '', on: true, custom: false },
  ],
};
const BASE: BaseConfig = { ...CONFIG, policies: ['pol_conduct', 'pol_privacy'] };
const SENIOR: OnbTemplate = {
  id: 'onbt-senior', name: 'Senior consultants', jobProfiles: ['SCONS'],
  steps: STEP_IDS.map(id => ({ id, on: id !== 'additional' })),
  documents: [{ id: 'rtw', on: true, req: true, blocks: true }, { id: 'addr', on: false, req: true, blocks: false }, { id: 'photo', on: true, req: false, blocks: false }],
  policies: ['pol_conduct'],
};
const OTHER: OnbTemplate = { ...SENIOR, id: 'onbt-other', name: 'Other', jobProfiles: [] };
const draftOf = (t: OnbTemplate): OnbTemplateDraft => ({ name: t.name, jobProfiles: t.jobProfiles, steps: t.steps, documents: t.documents, policies: t.policies });
const ctx = (was: OnbTemplate | null): TemplateRuleContext => ({
  base: BASE, was, others: [SENIOR],
  jobProfiles: [{ code: 'CONS', name: 'Consultant' }, { code: 'SCONS', name: 'Senior Consultant' }, { code: 'PM', name: 'Project Manager' }],
  policyIds: ['pol_conduct', 'pol_privacy'], features: ALL_FEATURES,
});
const PDF = { name: 'scan.pdf', size: 2048, type: 'application/pdf', at: AT, kind: 'pdf' as const };
const must = <T>(o: { ok: true; value: T } | { ok: false }): T => { if (!o.ok) throw new Error('refused'); return o.value; };

/* A case with every step done and each document the template asks uploaded. */
function completeFor(t: OnbTemplate): OnboardingCase {
  const { config } = configFor(t, BASE);
  let c = emptyCase('E1');
  for (const d of config.documents.filter(x => x.on)) c = must(applyUpload(c, d, PDF, ALL_FEATURES));
  return { ...c, steps: { personal: 'done', contact: 'done', emergency: 'done', additional: 'done', documents: 'done', policies: 'done' } };
}

describe('resolution', () => {
  test('the starter\'s job profile picks the template that lists it', () => {
    expect(templateFor('SCONS', [SENIOR])).toBe(SENIOR);
  });
  test('a profile no template lists, and no profile at all, get the default', () => {
    expect(templateFor('PM', [SENIOR])).toBeNull();
    expect(templateFor('', [SENIOR])).toBeNull();
  });
  test('the default resolves to the base config and its own policies; absent policies read as every policy', () => {
    expect(configFor(null, BASE)).toEqual({ config: { steps: CONFIG.steps, documents: CONFIG.documents }, policies: ['pol_conduct', 'pol_privacy'] });
    expect(withPolicies({ steps: CONFIG.steps, documents: CONFIG.documents }, ['a', 'b']).policies).toEqual(['a', 'b']);
  });
  test('a template takes labels and shared settings from the base, and on, req and blocks from its row', () => {
    const r = configFor(SENIOR, BASE);
    expect(r.config.steps.find(s => s.id === 'additional')).toMatchObject({ label: 'Additional information', on: false });
    expect(r.config.steps.filter(s => s.fixed).every(s => s.on)).toBe(true);
    expect(r.config.documents.find(d => d.id === 'photo')).toMatchObject({ verify: 'either', expiry: false, req: false, on: true });
    expect(r.policies).toEqual(['pol_conduct']);
  });
  test('a document in the shared list but missing from the template row counts as off', () => {
    expect(configFor(SENIOR, BASE).config.documents.filter(d => d.on).map(d => d.id)).toEqual(['rtw', 'photo']);
  });
});

describe('what was asked, judged against the resolved template', () => {
  test('before submission the case follows the template live', () => {
    const c = { config: configFor(SENIOR, BASE).config, features: ALL_FEATURES };
    expect(askedOf(emptyCase('E1'), c).documents.map(d => d.id)).toEqual(['rtw', 'photo']);
  });
  test('a profile change before submission switches what is asked', () => {
    const c = emptyCase('E1');
    const asSenior = blockers(c, { config: configFor(templateFor('SCONS', [SENIOR]), BASE).config, features: ALL_FEATURES }, 'submit');
    const asOther = blockers(c, { config: configFor(templateFor('PM', [SENIOR]), BASE).config, features: ALL_FEATURES }, 'submit');
    expect(asSenior.some(b => b.id === 'addr')).toBe(false);
    expect(asOther.some(b => b.id === 'addr')).toBe(true);
  });
  test('after submission a profile change or a template edit never adds a requirement', () => {
    const submitted = { ...completeFor(SENIOR), submittedAt: AT, asked: askedNow({ config: configFor(SENIOR, BASE).config, features: ALL_FEATURES }) };
    expect(blockers(submitted, { config: configFor(null, BASE).config, features: ALL_FEATURES }, 'start').map(b => b.id)).not.toContain('addr');
    expect(blockers(submitted, { config: configFor({ ...SENIOR, steps: SENIOR.steps.map(s => ({ ...s, on: true })) }, BASE).config, features: ALL_FEATURES }, 'start')
      .map(b => b.id)).not.toContain('additional');
  });
});

describe('normalising, copying and ids', () => {
  test('normaliseTemplate orders documents as the shared list, adds missing ones switched off and drops unknown ones', () => {
    const t = normaliseTemplate({ ...SENIOR, documents: [...SENIOR.documents, { id: 'gone', on: true, req: true, blocks: true }] }, BASE);
    expect(t.documents.map(d => d.id)).toEqual(['rtw', 'addr', 'photo', 'licence', 'cert']);
    expect(t.documents.find(d => d.id === 'licence')).toEqual({ id: 'licence', on: false, req: false, blocks: false });
  });
  test('a new template copies the source\'s steps, documents and policies, with no job profiles', () => {
    expect(newTemplateFrom('onbt-a', 'A', null, BASE)).toMatchObject({ jobProfiles: [], policies: ['pol_conduct', 'pol_privacy'] });
    expect(newTemplateFrom('onbt-b', 'B', SENIOR, BASE)).toMatchObject({ jobProfiles: [], policies: ['pol_conduct'] });
    expect(newTemplateFrom('onbt-b', 'B', SENIOR, BASE).steps.find(s => s.id === 'additional')?.on).toBe(false);
  });
  test('ids are onbt- and a slug, made unique', () => {
    expect(onbTemplateId('Senior consultants', [])).toBe('onbt-senior-consultants');
    expect(onbTemplateId('Senior  Consultants!', ['onbt-senior-consultants'])).toBe('onbt-senior-consultants-2');
  });
});

describe('the save rules', () => {
  test('a name is needed, at most 60 characters, unique ignoring case, and Default is reserved', () => {
    const others = [SENIOR];
    expect(onbTemplateNameProblem(' ', others)?.message).toBe(TEMPLATE_NAME_NEEDED);
    expect(onbTemplateNameProblem('x'.repeat(61), others)?.message).toBe(TEMPLATE_NAME_LONG);
    expect(onbTemplateNameProblem(' default ', others)?.message).toBe(TEMPLATE_NAME_RESERVED);
    expect(onbTemplateNameProblem(' senior CONSULTANTS ', others)?.message).toBe(TEMPLATE_NAME_TAKEN);
    expect(onbTemplateNameProblem('Senior consultants', others, 'onbt-senior')).toBeNull();
  });
  test('a job profile another template holds is refused, naming that template; an unknown code is refused', () => {
    expect(onbTemplateProblem({ ...draftOf(OTHER), jobProfiles: ['SCONS'] }, ctx(OTHER))).toEqual({ code: 'PROFILE_TAKEN', field: 'jobProfiles',
      message: 'Senior Consultant (SCONS) is already in Senior consultants. Take it out of Senior consultants first.', next: 'Reload the page to see who holds it.' });
    expect(onbTemplateProblem({ ...draftOf(OTHER), jobProfiles: ['XX'] }, ctx(OTHER))).toMatchObject({ code: 'VALIDATION', field: 'jobProfiles', message: 'There is no job profile with the code XX.' });
  });
  test('a fixed step cannot be switched off, a step whose features are off cannot be switched on, and unknown documents or policies are refused', () => {
    const off = (id: string) => ({ ...draftOf(OTHER), steps: draftOf(OTHER).steps.map(s => (s.id === id ? { ...s, on: false } : s)) });
    expect(onbTemplateProblem(off('personal'), ctx(OTHER))?.code).toBe('FIXED');
    expect(onbTemplateProblem({ ...draftOf(OTHER), documents: [{ id: 'nope', on: true, req: false, blocks: false }] }, ctx(OTHER))?.field).toBe('documents');
    expect(onbTemplateProblem({ ...draftOf(OTHER), policies: ['pol_nope'] }, ctx(OTHER))?.field).toBe('policies');
  });
  test('a valid draft passes, and a feature-off step cannot be newly switched on', () => {
    expect(onbTemplateProblem(draftOf(OTHER), ctx(OTHER))).toBeNull();
    const was = { ...OTHER, steps: OTHER.steps.map(s => (s.id === 'policies' ? { ...s, on: false } : s)) };
    const noPol = { ...ctx(was), features: { ...ALL_FEATURES, pol: false } };
    expect(onbTemplateProblem({ ...draftOf(was), steps: SENIOR.steps.map(s => ({ ...s, on: true })) }, noPol)?.code).toBe('FLAG_OFF');
  });
});
