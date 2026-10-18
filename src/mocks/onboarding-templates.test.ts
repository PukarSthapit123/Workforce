import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { OnbTemplateDeleted, OnbTemplateRecord, OnbTemplateSaved, OnboardingConfigSaved, OnboardingSetup } from '@/contract/onboarding';
import {
  TEMPLATE_NAME_LONG, TEMPLATE_NAME_NEEDED, TEMPLATE_NAME_RESERVED, TEMPLATE_NAME_TAKEN, templateCreatedText, templateDeletedText, templateSavedText,
} from '@/domain/onboarding-templates';
import { audits, caller, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

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
});
