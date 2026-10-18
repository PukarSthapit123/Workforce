import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import {
  OnbTemplateDeleted, OnbTemplateRecord, OnbTemplateSaved, OnboardingConfigSaved, OnboardingDetail, OnboardingSetup, StarterOnboarding, TeamOnboarding,
} from '@/contract/onboarding';
import {
  TEMPLATE_NAME_LONG, TEMPLATE_NAME_NEEDED, TEMPLATE_NAME_RESERVED, TEMPLATE_NAME_TAKEN, templateCreatedText, templateDeletedText, templateSavedText,
} from '@/domain/onboarding-templates';
import { audits, caller, employeeOf, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('qnipay'));

const as = async (p: Persona) => caller(await tokenFor(p));
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const WRITES = ['onboardingTemplates', 'onboardingConfig', 'onboardingPolicies', 'onboardingCases', 'audit'];
const onbAudits = () => audits().filter(a => a.act !== 'Signed in');
const SENIOR = 'onbt-senior-consultants', POLICIES = ['pol_conduct', 'pol_privacy', 'pol_handbook', 'pol_itsec'];
const URL = '/api/v1/onboarding/templates';
type Call = Awaited<ReturnType<typeof as>>;
const read = async (call: Call, id: string) => OnbTemplateRecord.parse((await call('GET', `${URL}/${id}`)).body);
const draft = (r: OnbTemplateRecord) => ({ name: r.name, jobProfiles: r.jobProfiles, steps: r.steps, documents: r.documents, policies: r.policies });
const tenant = () => store.coll<{ modules: Record<string, boolean> }>('tenant').tenant;
const setModule = (k: string, on: boolean) => { const t = tenant(); if (t) t.modules[k] = on; };

describe('onboarding templates: reads', () => {
  test('the setup lists the templates with their job profiles, starters and version; a tenant with none lists none', async () => {
    resetTo('qnipay');
    const s = OnboardingSetup.parse((await (await as('admin'))('GET', '/api/v1/onboarding/config')).body);
    expect(s.templates).toEqual([{ id: SENIOR, name: 'Senior consultants', version: 1, jobProfiles: [{ code: 'SCONS', name: 'Senior Consultant' }], starters: 0 }]);
    expect(s.jobProfiles.map(j => j.code)).toEqual(['ADM', 'CONS', 'PM', 'SCONS']);
    expect(s.config.policies).toEqual(POLICIES);
    resetTo('social');
    expect(OnboardingSetup.parse((await (await as('admin'))('GET', '/api/v1/onboarding/config')).body).templates).toEqual([]);
  });
  test('a template reads whole, with a row for every document in the shared list', async () => {
    const r = await read(await as('admin'), SENIOR);
    expect(r.documents.map(d => d.id)).toEqual(['rtw', 'addr', 'photo', 'licence', 'cert']);
    expect(r.steps.find(s => s.id === 'additional')?.on).toBe(false);
    expect(r.policies).toEqual(['pol_conduct', 'pol_privacy', 'pol_itsec']);
    expect((await (await as('admin'))('GET', `${URL}/onbt-gone`)).status).toBe(404);
  });
});

describe('onboarding templates: writes', () => {
  test('creating copies the default steps, documents and policies with no job profiles, in one audit row; copyFrom copies another template', async () => {
    const call = await as('admin'), before = onbAudits().length;
    const r = await call('POST', URL, { name: 'Consultants' });
    expect(r.status).toBe(200);
    const saved = OnbTemplateSaved.parse(r.body);
    expect(saved.record).toMatchObject({ id: 'onbt-consultants', version: 1, jobProfiles: [], policies: POLICIES });
    expect(saved.summary).toBe(templateCreatedText('Consultants'));
    expect(onbAudits().slice(before).map(a => ({ act: a.act, entity: a.entity, entityId: a.entityId })))
      .toEqual([{ act: 'Onboarding template created', entity: 'onboardingTemplate', entityId: 'onbt-consultants' }]);
    const leads = OnbTemplateSaved.parse((await call('POST', URL, { name: 'Leads', copyFrom: SENIOR })).body).record;
    expect(leads.steps.find(s => s.id === 'additional')?.on).toBe(false);
    expect(leads.policies).not.toContain('pol_handbook');
    expect(leads.jobProfiles).toEqual([]);
    const snap = snapshot(...WRITES);
    expect((await call('POST', URL, { name: 'Other', copyFrom: 'onbt-gone' })).status).toBe(404);
    expect(snapshot(...WRITES)).toEqual(snap);
  });
  test('saving takes the whole row with If-Match: missing is 428, stale is 412, and nothing is written', async () => {
    const call = await as('admin'), row = draft(await read(call, SENIOR)), before = snapshot(...WRITES);
    expect((await call('PUT', `${URL}/${SENIOR}`, row)).status).toBe(428);
    expect((await call('PUT', `${URL}/${SENIOR}`, row, 0)).status).toBe(412);
    expect((await call('DELETE', `${URL}/${SENIOR}`)).status).toBe(428);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a template is not refused for holding its own job profiles: saving it unchanged is accepted', async () => {
    const call = await as('admin'), row = draft(await read(call, SENIOR));
    const r = await call('PUT', `${URL}/${SENIOR}`, row, 1);
    expect(r.status).toBe(200);
    expect(OnbTemplateSaved.parse(r.body)).toMatchObject({ summary: 'Nothing has changed.', auditId: null });
  });
  test('a job profile another template holds is refused with a field error naming it, and nothing is written', async () => {
    const call = await as('admin');
    const made = OnbTemplateSaved.parse((await call('POST', URL, { name: 'Consultants' })).body).record, before = snapshot(...WRITES);
    const r = await call('PUT', `${URL}/${made.id}`, { ...draft(made), jobProfiles: ['SCONS'] }, 1);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'PROFILE_TAKEN', field: 'jobProfiles',
      message: 'Senior Consultant (SCONS) is already in Senior consultants. Take it out of Senior consultants first.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('names are needed, at most 60 characters, unique ignoring case and not Default; an unknown job profile is refused', async () => {
    const call = await as('admin');
    const made = OnbTemplateSaved.parse((await call('POST', URL, { name: 'Consultants' })).body).record, before = snapshot(...WRITES);
    const named = (name: string) => call('PUT', `${URL}/${made.id}`, { ...draft(made), name }, 1);
    for (const [name, message] of [[' ', TEMPLATE_NAME_NEEDED], ['x'.repeat(61), TEMPLATE_NAME_LONG], ['DEFAULT', TEMPLATE_NAME_RESERVED], [' senior CONSULTANTS ', TEMPLATE_NAME_TAKEN]] as const) {
      const r = await named(name);
      expect(r.status, name).toBe(422);
      expect(refusal(r), name).toMatchObject({ code: 'invalid', field: 'name', message });
    }
    const unknown = await call('PUT', `${URL}/${made.id}`, { ...draft(made), jobProfiles: ['XX'] }, 1);
    expect(unknown.status).toBe(422);
    expect(refusal(unknown)).toMatchObject({ code: 'invalid', field: 'jobProfiles', message: 'There is no job profile with the code XX.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a save writes one audit row with what changed, and an unchanged save writes none', async () => {
    const call = await as('admin');
    const made = OnbTemplateSaved.parse((await call('POST', URL, { name: 'Consultants' })).body).record, rows = onbAudits().length;
    const body = { ...draft(made), jobProfiles: ['CONS'], documents: made.documents.map(d => (d.id === 'addr' ? { ...d, on: false } : d)) };
    const r = await call('PUT', `${URL}/${made.id}`, body, 1);
    expect(r.status).toBe(200);
    const saved = OnbTemplateSaved.parse(r.body);
    expect(saved).toMatchObject({ summary: templateSavedText('Consultants'), record: { version: 2 } });
    const written = onbAudits().slice(rows);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ act: 'Onboarding template saved', entity: 'onboardingTemplate', entityId: made.id,
      before: { jobProfiles: [], documents: { addr: { on: true, req: true, blocks: false } } },
      after: { jobProfiles: ['CONS'], documents: { addr: { on: false, req: true, blocks: false } } } });
    const again = await call('PUT', `${URL}/${made.id}`, body, 2);
    expect(OnbTemplateSaved.parse(again.body)).toMatchObject({ summary: 'Nothing has changed.', auditId: null, record: { version: 2 } });
    expect(onbAudits()).toHaveLength(rows + 1);
  });
  test('a save without a document added since stores it switched off', async () => {
    const call = await as('admin'), old = draft(await read(call, SENIOR));
    const cfg = store.coll<{ version: number }>('onboardingConfig').onboardingConfig;
    const add = await call('POST', '/api/v1/onboarding/documents', { label: 'DBS check' }, cfg?.version);
    expect(OnboardingConfigSaved.parse(add.body).record.documents.map(d => d.id)).toContain('dbs-check');
    const r = await call('PUT', `${URL}/${SENIOR}`, { ...old, name: 'Senior consultants 2' }, 1);
    expect(r.status).toBe(200);
    expect((await read(call, SENIOR)).documents.find(d => d.id === 'dbs-check')).toEqual({ id: 'dbs-check', on: false, req: false, blocks: false });
  });
  test('a template with several hundred job profiles saves', async () => {
    const call = await as('admin'), jp = store.coll<Record<string, unknown>>('jobProfiles');
    const codes = Array.from({ length: 300 }, (_, i) => `JP${String(i + 1).padStart(3, '0')}`);
    for (const code of codes) jp[code] = { id: code, code, name: `Profile ${code}`, version: 1, updatedAt: '2026-08-13T14:30:00.000Z' };
    const made = OnbTemplateSaved.parse((await call('POST', URL, { name: 'Many' })).body).record;
    const r = await call('PUT', `${URL}/${made.id}`, { ...draft(made), jobProfiles: codes }, 1);
    expect(r.status).toBe(200);
    expect((await read(call, made.id)).jobProfiles).toHaveLength(300);
  });
  test('deleting needs If-Match, writes one audit row, and its job profiles fall back to the default', async () => {
    const call = await as('admin'), rows = onbAudits().length;
    const r = await call('DELETE', `${URL}/${SENIOR}`, undefined, 1);
    expect(r.status).toBe(200);
    expect(OnbTemplateDeleted.parse(r.body).summary).toBe(templateDeletedText('Senior consultants'));
    const written = onbAudits().slice(rows);
    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({ act: 'Onboarding template deleted', entityId: SENIOR, before: { name: 'Senior consultants', jobProfiles: ['SCONS'] }, after: null });
    expect(OnboardingSetup.parse((await call('GET', '/api/v1/onboarding/config')).body).templates).toEqual([]);
    expect((await call('GET', `${URL}/${SENIOR}`)).status).toBe(404);
  });
  test('with the module off every template endpoint refuses; without Configure onboarding they are refused', async () => {
    const admin = await as('admin'), employee = await as('employee'), row = draft(await read(admin, SENIOR));
    const tries: [string, string, unknown, number | undefined][] = [
      ['GET', `${URL}/${SENIOR}`, undefined, undefined], ['POST', URL, { name: 'New' }, undefined], ['PUT', `${URL}/${SENIOR}`, row, 1], ['DELETE', `${URL}/${SENIOR}`, undefined, 1],
    ];
    const before = snapshot(...WRITES);
    for (const [m, path, body, v] of tries) {
      const r = await employee(m, path, body, v);
      expect(r.status, `${m} ${path}`).toBe(403);
      expect(refusal(r).code).toBe('capability');
    }
    setModule('ON', false);
    for (const [m, path, body, v] of tries) {
      const r = await admin(m, path, body, v);
      expect(r.status, `${m} ${path}`).toBe(403);
      expect(refusal(r).code).toBe('module-off');
    }
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('the config Save also takes the default template policies; an unknown one is refused', async () => {
    const call = await as('admin'), s = OnboardingSetup.parse((await call('GET', '/api/v1/onboarding/config')).body);
    const body = { steps: s.config.steps, documents: s.config.documents };
    const rows = onbAudits().length, three = ['pol_conduct', 'pol_privacy', 'pol_itsec'];
    const r = await call('PUT', '/api/v1/onboarding/config', { ...body, policies: three }, s.config.version);
    expect(r.status).toBe(200);
    const saved = OnboardingConfigSaved.parse(r.body);
    expect(saved.record.policies).toEqual(three);
    expect(saved.summary).toContain('Policy choices saved.');
    expect(onbAudits().slice(rows)[0]).toMatchObject({ before: { policies: POLICIES }, after: { policies: three } });
    const before = snapshot(...WRITES);
    const bad = await call('PUT', '/api/v1/onboarding/config', { ...body, policies: ['pol_nope'] }, saved.record.version);
    expect(bad.status).toBe(422);
    expect(refusal(bad).field).toBe('policies');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('removing a policy only a named template asked for leaves the default config alone but strips the template', async () => {
    const call = await as('admin'), s = OnboardingSetup.parse((await call('GET', '/api/v1/onboarding/config')).body);
    const three = ['pol_conduct', 'pol_privacy', 'pol_itsec'];
    const saved = OnboardingConfigSaved.parse((await call('PUT', '/api/v1/onboarding/config', { steps: s.config.steps, documents: s.config.documents, policies: three }, s.config.version)).body);
    const senior = await read(call, SENIOR);
    expect((await call('PUT', `${URL}/${SENIOR}`, { ...draft(senior), policies: [...senior.policies, 'pol_handbook'] }, senior.version)).status).toBe(200);
    const rows = onbAudits().length;
    expect((await call('DELETE', '/api/v1/onboarding/policies/pol_handbook', undefined, s.policies.find(p => p.id === 'pol_handbook')?.version)).status).toBe(200);
    expect(configRow()?.version).toBe(saved.record.version);
    expect((await read(call, SENIOR)).policies).not.toContain('pol_handbook');
    expect(onbAudits().length - rows).toBe(1);
    expect((await call('DELETE', '/api/v1/onboarding/policies/pol_itsec', undefined, s.policies.find(p => p.id === 'pol_itsec')?.version)).status).toBe(200);
    expect(configRow()?.version).toBe(saved.record.version + 1);
  });
});

/* ------------------------------------------------- each case, its own template */
const TOM = 'tom.achterberg@brightpath.org';
async function asEmail(email: string): Promise<Call> {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const { token } = (await r.json()) as { token: string };
  return caller(token);
}
const setEmployee = (code: string, patch: Record<string, unknown>) => { const p = employeeOf(code); store.coll('employees')[p.id] = { ...p, ...patch }; };
interface Case { id: string; version: number; acks: Record<string, string>; read: Record<string, boolean> }
const caseOf = (code: string) => store.coll<Case>('onboardingCases')[`onb_${code}`];
const putCase = (code: string, patch: Record<string, unknown>) => { const c = caseOf(code); if (c) store.coll('onboardingCases')[c.id] = { ...c, ...patch }; };
const configRow = () => store.coll<{ version: number; policies: string[] }>('onboardingConfig').onboardingConfig;
/* Every step done and the photo and right to work verified: only what the template asks can still block. */
const finished = (code: string) => putCase(code, { steps: { personal: 'done', contact: 'done', emergency: 'done', additional: 'done', documents: 'done', policies: 'done' }, docs: { rtw: 'verified', photo: 'verified' } });
async function supportTemplate(patch: Record<string, unknown> = {}) {
  const call = await as('admin');
  const made = OnbTemplateSaved.parse((await call('POST', URL, { name: 'Support workers' })).body).record, row = draft(made);
  const body = { ...row, jobProfiles: ['SW'], steps: row.steps.map(s => (s.id === 'additional' ? { ...s, on: false } : s)),
    documents: row.documents.map(d => (d.id === 'addr' ? { ...d, on: false } : d)), policies: row.policies.filter(p => p !== 'pol_itsec'), ...patch };
  const r = await call('PUT', `${URL}/${made.id}`, body, 1);
  expect(r.status).toBe(200);
  return OnbTemplateSaved.parse(r.body).record;
}
const SUPPORT = 'onbt-support-workers';
const detailOf = async (email: string) => OnboardingDetail.parse((await (await asEmail(email))('GET', '/api/v1/onboarding/me')).body);

describe('each case is judged against its own template', () => {
  beforeEach(() => resetTo('social'));
  test('a starter whose job profile a template lists is asked what it asks, and the case view names the template', async () => {
    await supportTemplate();
    const d = await detailOf(TOM);
    expect(d.template).toEqual({ id: SUPPORT, name: 'Support workers' });
    expect(d.documents.map(x => x.id)).toEqual(['rtw', 'photo', 'licence', 'cert']);
    expect(d.steps.map(s => s.id)).not.toContain('additional');
    expect(d.policies.map(p => p.id)).toEqual(['pol_conduct', 'pol_privacy', 'pol_handbook']);
  });
  test('a starter on a profile no template lists gets the default, and the tracker says Default', async () => {
    await supportTemplate(); setEmployee('CP-1501', { jobProfile: 'SSW' });
    const s = StarterOnboarding.parse((await (await as('manager'))('GET', '/api/v1/onboarding/team/CP-1501')).body);
    expect(s.template).toEqual({ id: null, name: 'Default' });
    expect(s.documents.map(x => x.id)).toContain('addr');
  });
  test('a job profile change before submission switches what is asked', async () => {
    await supportTemplate();
    expect((await detailOf(TOM)).documents.map(x => x.id)).not.toContain('addr');
    setEmployee('CP-1502', { jobProfile: 'SSW' });
    const d = await detailOf(TOM);
    expect(d.template).toEqual({ id: null, name: 'Default' });
    expect(d.documents.map(x => x.id)).toContain('addr');
    expect(d.steps.map(s => s.id)).toContain('additional');
  });
  test('after submission a profile change never adds a requirement: what was asked holds', async () => {
    await supportTemplate(); finished('CP-1502');
    const call = await asEmail(TOM);
    const sub = await call('POST', '/api/v1/onboarding/me/submit', { consent: true, signature: 'Tom Achterberg' }, caseOf('CP-1502')?.version);
    expect(sub.status).toBe(200);
    setEmployee('CP-1502', { jobProfile: 'SSW' });
    const t = TeamOnboarding.parse((await (await as('manager'))('GET', '/api/v1/onboarding/team')).body);
    const row = t.rows.find(r => r.employee.code === 'CP-1502');
    expect(row?.blockers.map(b => b.why)).not.toContain('Proof of address not uploaded');
    const s = StarterOnboarding.parse((await (await as('manager'))('GET', '/api/v1/onboarding/team/CP-1502')).body);
    expect(s.toStart.map(b => b.why)).not.toContain('Proof of address not uploaded');
  });
  test('uploads, step saves, acknowledgements and the start gate read the case\'s template', async () => {
    await supportTemplate();
    const call = await asEmail(TOM), v = () => caseOf('CP-1502')?.version;
    const up = await call('POST', '/api/v1/onboarding/me/documents/addr', { name: 'bill.jpg', size: 1000, type: 'image/jpeg', preview: 'data:image/jpeg;base64,AAAA' }, v());
    expect(up.status).toBe(404);
    const step = await call('PUT', '/api/v1/onboarding/me/steps/additional', { mode: 'quiet', additional: { conv: 'no' } }, v());
    expect(step.status).toBe(404);
    const ack = await call('POST', '/api/v1/onboarding/me/policies/pol_itsec/ack', { on: true }, v());
    expect(ack.status).toBe(404);
    expect(refusal(ack).message).toBe('That policy is no longer asked for.');
    finished('CP-1502');
    const manager = await as('manager');
    expect((await manager('POST', '/api/v1/onboarding/team/CP-1502/start', undefined, v())).status).toBe(200);
    resetTo('social'); await supportTemplate(); finished('CP-1502');
    const p = employeeOf('CP-1502');
    const r = await (await as('admin'))('POST', `/api/v1/employees/${p.id}/transitions`, { to: 'active', reason: 'First day' }, p.version);
    expect(r.status).toBe(200);
  });
  test('the team list names each starter\'s template', async () => {
    await supportTemplate(); setEmployee('CP-1501', { jobProfile: 'SSW' });
    const t = TeamOnboarding.parse((await (await as('manager'))('GET', '/api/v1/onboarding/team')).body);
    expect(t.rows.map(r => [r.employee.code, r.template.name])).toEqual(expect.arrayContaining([['CP-1501', 'Default'], ['CP-1502', 'Support workers']]));
  });
  test('a new policy version asks again only those whose template asks for it', async () => {
    putCase('CP-1501', { acks: { pol_itsec: 'v3.2' }, read: { pol_itsec: true } });
    putCase('CP-1502', { acks: { pol_itsec: 'v3.2' }, read: { pol_itsec: true } });
    await supportTemplate(); setEmployee('CP-1501', { jobProfile: 'SSW' });
    const pol = store.coll<{ version: number }>('onboardingPolicies').pol_itsec;
    const r = await (await as('admin'))('POST', '/api/v1/onboarding/policies/pol_itsec/file', { name: 'it.pdf', size: 1000, type: 'application/pdf' }, pol?.version);
    expect(r.status).toBe(200);
    expect((r.body as { asked: number }).asked).toBe(1);
    expect(caseOf('CP-1502')?.acks.pol_itsec).toBe('v3.2');
    expect(caseOf('CP-1501')?.acks.pol_itsec).toBeUndefined();
  });
  test('deleting the template falls back to the default for starters part-way through', async () => {
    await supportTemplate();
    const r = await (await as('admin'))('DELETE', `${URL}/${SUPPORT}`, undefined, 2);
    expect(r.status).toBe(200);
    const d = await detailOf(TOM);
    expect(d.template).toEqual({ id: null, name: 'Default' });
    expect(d.documents.map(x => x.id)).toContain('addr');
  });
});

describe('shared-list changes keep the templates in step', () => {
  beforeEach(() => resetTo('social'));
  const stored = () => store.coll<{ documents: { id: string }[]; policies: string[] }>('onboardingTemplates')[SUPPORT];
  test('a new policy joins the default template only', async () => {
    const admin = await as('admin');
    await supportTemplate();
    const r = await admin('POST', '/api/v1/onboarding/policies', { label: 'Fire safety' });
    expect(r.status).toBe(200);
    expect(configRow()?.policies).toContain('pol_fire_safety');
    expect((await read(admin, SUPPORT)).policies).not.toContain('pol_fire_safety');
    expect((await detailOf(TOM)).policies.map(p => p.id)).not.toContain('pol_fire_safety');
    resetTo('social');
    await (await as('admin'))('POST', '/api/v1/onboarding/policies', { label: 'Fire safety' });
    expect((await detailOf(TOM)).policies.map(p => p.id)).toContain('pol_fire_safety');
  });
  test('a document added to the shared list joins every template switched off', async () => {
    const admin = await as('admin');
    await supportTemplate();
    const r = await admin('POST', '/api/v1/onboarding/documents', { label: 'DBS check' }, configRow()?.version);
    expect(r.status).toBe(200);
    expect((await read(admin, SUPPORT)).documents.find(d => d.id === 'dbs-check')).toEqual({ id: 'dbs-check', on: false, req: false, blocks: false });
    expect((await detailOf(TOM)).documents.map(d => d.id)).not.toContain('dbs-check');
  });
  test('removing a policy or a document takes it off every template, so one re-added under the same name is not asked there', async () => {
    const admin = await as('admin');
    await admin('POST', '/api/v1/onboarding/policies', { label: 'Fire safety' });
    await admin('POST', '/api/v1/onboarding/documents', { label: 'DBS check' }, configRow()?.version);
    const made = await supportTemplate({ policies: ['pol_conduct', 'pol_fire_safety'] });
    const both = await admin('PUT', `${URL}/${SUPPORT}`, { ...draft(made), documents: made.documents.map(d => (d.id === 'dbs-check' ? { ...d, on: true } : d)) }, made.version);
    expect(both.status).toBe(200);
    expect(stored()?.policies).toContain('pol_fire_safety');
    const rows = onbAudits().length;
    const pol = store.coll<{ version: number }>('onboardingPolicies').pol_fire_safety;
    expect((await admin('DELETE', '/api/v1/onboarding/policies/pol_fire_safety', undefined, pol?.version)).status).toBe(200);
    expect((await admin('DELETE', '/api/v1/onboarding/documents/dbs-check', undefined, configRow()?.version)).status).toBe(200);
    expect(stored()?.policies).not.toContain('pol_fire_safety');
    expect(stored()?.documents.map(d => d.id)).not.toContain('dbs-check');
    expect(configRow()?.policies).not.toContain('pol_fire_safety');
    expect(onbAudits().slice(rows).map(a => a.act)).toEqual(['Policy removed', 'Onboarding document removed']);
    await admin('POST', '/api/v1/onboarding/policies', { label: 'Fire safety' });
    await admin('POST', '/api/v1/onboarding/documents', { label: 'DBS check' }, configRow()?.version);
    const again = await read(admin, SUPPORT);
    expect(again.policies).not.toContain('pol_fire_safety');
    expect(again.documents.find(d => d.id === 'dbs-check')?.on).toBe(false);
  });
});

describe('long policy ids and large policy lists', () => {
  const setupOf = async (call: Call) => OnboardingSetup.parse((await call('GET', '/api/v1/onboarding/config')).body);
  test('an 80-character policy name is added and the setup still loads, saves on the default and on a template', async () => {
    const call = await as('admin'), label = 'a'.repeat(80), id = `pol_${label}`;
    expect((await call('POST', '/api/v1/onboarding/policies', { label })).status).toBe(200);
    const s = await setupOf(call);
    expect(s.config.policies).toContain(id);
    const put = await call('PUT', '/api/v1/onboarding/config', { steps: s.config.steps, documents: s.config.documents, policies: s.config.policies.slice(1) }, s.config.version);
    expect(put.status).toBe(200);
    const senior = await read(call, SENIOR);
    const r = await call('PUT', `${URL}/${SENIOR}`, { ...draft(senior), policies: [...senior.policies, id] }, senior.version);
    expect(r.status).toBe(200);
    expect((await read(call, SENIOR)).policies).toContain(id);
  });
  test('more than 40 policies: the setup still loads and the default saves', async () => {
    const call = await as('admin');
    for (let n = 0; n < 40; n++) expect((await call('POST', '/api/v1/onboarding/policies', { label: `Extra policy ${n}` })).status).toBe(200);
    const s = await setupOf(call);
    expect(s.policies.length).toBeGreaterThan(40);
    expect(s.config.policies.length).toBeGreaterThan(40);
    const put = await call('PUT', '/api/v1/onboarding/config', { steps: s.config.steps, documents: s.config.documents, policies: s.config.policies.slice(1) }, s.config.version);
    expect(put.status).toBe(200);
    const senior = await read(call, SENIOR);
    expect((await call('PUT', `${URL}/${SENIOR}`, { ...draft(senior), policies: s.config.policies }, senior.version)).status).toBe(200);
  });
  test('a stored config without a policy list gains a new policy once', async () => {
    const call = await as('admin'), row = store.coll<Record<string, unknown>>('onboardingConfig').onboardingConfig;
    if (!row) throw new Error('no config');
    delete row.policies;
    await call('POST', '/api/v1/onboarding/policies', { label: 'Fire safety' });
    const list = (await setupOf(call)).config.policies;
    expect(list.filter(p => p === 'pol_fire_safety')).toHaveLength(1);
    expect(list).toEqual([...POLICIES, 'pol_fire_safety']);
  });
});

describe('a save that only reorders changes nothing', () => {
  test('the default config with its policies in another order is "Nothing has changed", no version, no audit row', async () => {
    const call = await as('admin'), s = OnboardingSetup.parse((await call('GET', '/api/v1/onboarding/config')).body), rows = onbAudits().length;
    const r = await call('PUT', '/api/v1/onboarding/config', { steps: s.config.steps, documents: s.config.documents, policies: [...s.config.policies].reverse() }, s.config.version);
    expect(r.status).toBe(200);
    expect(OnboardingConfigSaved.parse(r.body)).toMatchObject({ summary: 'Nothing has changed.', auditId: null, record: { version: s.config.version } });
    expect(onbAudits()).toHaveLength(rows);
  });
  test('a template with its job profiles and policies in another order is "Nothing has changed"', async () => {
    const call = await as('admin'), jp = store.coll<Record<string, unknown>>('jobProfiles');
    jp.CONS2 = { id: 'CONS2', code: 'CONS2', name: 'Consultant Two', version: 1, updatedAt: '2026-08-13T14:30:00.000Z' };
    const made = OnbTemplateSaved.parse((await call('POST', URL, { name: 'Consultants' })).body).record;
    const first = OnbTemplateSaved.parse((await call('PUT', `${URL}/${made.id}`, { ...draft(made), jobProfiles: ['CONS', 'CONS2'] }, 1)).body).record;
    const rows = onbAudits().length;
    const r = await call('PUT', `${URL}/${made.id}`, { ...draft(first), jobProfiles: ['CONS2', 'CONS'], policies: [...first.policies].reverse() }, first.version);
    expect(r.status).toBe(200);
    expect(OnbTemplateSaved.parse(r.body)).toMatchObject({ summary: 'Nothing has changed.', auditId: null, record: { version: first.version } });
    expect(onbAudits()).toHaveLength(rows);
  });
});
