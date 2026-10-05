import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { getTenant } from '@/contract/tenant';
import { ApprovalSetup } from '@/contract/approvals';
import { TemplateApplied, TemplateFile, TemplateImported, TemplateList, TemplatePlan } from '@/contract/templates';
import { SHIPPED_TEMPLATES, TEMPLATE_NAME_SHIPPED, TYPES_LEFT_ALONE } from '@/domain/templates';
import { accountOf, audits, caller, fault, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
const as = async (p: Persona) => caller(await tokenFor(p));
let admin: Awaited<ReturnType<typeof as>>;
/* signed in before each test, so its sign-in audit row is in every snapshot taken after */
beforeEach(async () => { resetTo('social'); admin = await as('admin'); });
const T = '/api/v1/templates';
const PLAN = (k: string) => `${T}/${k}/plan`, APPLY = (k: string) => `${T}/${k}/apply`, EXPORT = (k: string) => `${T}/${k}/export`, ONE = (k: string) => `${T}/${k}`;
const WRITES = ['tenant', 'templates', 'timesheetConfig', 'employeeTypes', 'userTypes', 'departments', 'costCentres', 'locations', 'jobProfiles',
  'projects', 'projectTasks', 'rotaWeeks', 'rotaSetAside', 'people', 'approvalChains', 'audit'];
const chainOf = async (m: string) => ApprovalSetup.parse((await admin('GET', '/api/v1/approvals/chains')).body).chains.find(c => c.module === m);
const tenantVer = () => store.coll<{ version: number }>('tenant').tenant?.version ?? -1;
const savedVer = (k: string) => store.coll<{ version: number }>('templates')[k]?.version ?? -1;
const revoke = (cap: string) => {
  const acc = store.coll<{ revocations: string[] }>('accounts')[`acc_${accountOf('admin').email}`];
  if (!acc) throw new Error('no admin account');
  acc.revocations = [cap];
};
const labels = () => Object.fromEntries(Object.entries(store.coll<{ fieldDefaults: Record<string, { label: string }> }>('timesheetConfig').timesheetConfig?.fieldDefaults ?? {})
  .map(([c, f]) => [c, f.label]));
const save = (name: string, scope: 'config' | 'structure' = 'config') => admin('POST', T, { name, description: '', scope });
const list = async () => TemplateList.parse((await admin('GET', T)).body);
const refusal = (body: unknown) => Refusal.parse(body);

describe('listing', () => {
  test('the three shipped templates, then those saved here, with the one in use marked', async () => {
    const l = await list();
    expect(l.templates.map(t => [t.key, t.source, t.inUse])).toEqual([['qcic', 'shipped', false], ['mne', 'shipped', false], ['social', 'shipped', true]]);
    expect(l.inUse).toBe('social');
    expect(l.templates.find(t => t.key === 'mne')).toMatchObject({ name: 'M&E / Building Services', types: ['Site Engineer', 'Contracts Manager', 'Office / Admin'], version: null });
  });
  test('the qnipay tenant runs on the professional services template', async () => {
    resetTo('qnipay');
    admin = await as('admin');
    expect((await list()).inUse).toBe('qcic');
  });
});

describe('who may (Review Focus 1, D4)', () => {
  test('a manager and an employee are refused every template call, and nothing changes', async () => {
    const calls = { manager: await as('manager'), employee: await as('employee') }, before = snapshot(...WRITES);
    for (const p of ['manager', 'employee'] as const) {
      const call = calls[p];
      for (const [m, url, body] of [['GET', T, undefined], ['POST', T, { name: 'X', description: '', scope: 'config' }], ['GET', PLAN('mne'), undefined],
        ['POST', APPLY('mne'), undefined], ['POST', `${T}/import`, { text: '{}' }], ['DELETE', ONE('tpl_x'), undefined]] as const) {
        const r = await call(m, url, body, tenantVer());
        expect([r.status, refusal(r.body).code], `${p} ${m} ${url}`).toEqual([403, 'capability']);
      }
    }
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('saving with the structure, or applying or importing a template with structure, also needs Workforce master data', async () => {
    revoke('master_data');
    const call = admin;
    const r = await call('POST', T, { name: 'With structure', description: '', scope: 'structure' });
    expect([r.status, refusal(r.body).message]).toEqual([403, 'This needs "Workforce master data", which your access does not include.']);
    expect((await call('POST', APPLY('mne'), undefined, tenantVer())).status).toBe(403);
    expect((await call('POST', T, { name: 'Config only', description: '', scope: 'config' })).status).toBe(200);
    expect((await call('POST', APPLY('social'), undefined, tenantVer())).status).toBe(200);
  });
  test('without Permissions configuration, an apply leaves role names alone and says so', async () => {
    store.coll<{ name: string }>('userTypes').employee = { ...store.coll<{ name: string }>('userTypes').employee, name: 'Support Worker' } as { name: string };
    expect((await save('Renamed')).status).toBe(200);
    store.coll<{ name: string }>('userTypes').employee = { ...store.coll<{ name: string }>('userTypes').employee, name: 'Employee' } as { name: string };
    revoke('perm_cfg');
    const r = TemplateApplied.parse((await (await as('admin'))('POST', APPLY('tpl_renamed'), undefined, tenantVer())).body);
    expect(r.plan.leftAlone.map(l => l.text)).toContain('Role names stay as they are. Renaming roles needs Permissions configuration.');
    expect(store.coll<{ name: string }>('userTypes').employee?.name).toBe('Employee');
  });
  test('without Employee types and configuration, an apply leaves employee types alone and says so (I1)', async () => {
    revoke('type_cfg');
    const before = snapshot('employeeTypes');
    const call = await as('admin');
    expect((await call('POST', '/api/v1/employee-types', {})).status).toBe(403);
    const r = await call('POST', APPLY('mne'), undefined, tenantVer());
    expect(r.status).toBe(200);
    const done = TemplateApplied.parse(r.body);
    expect(done.plan.leftAlone.map(l => l.text)).toContain(TYPES_LEFT_ALONE);
    expect(snapshot('employeeTypes')).toEqual(before);
  });
});

describe('saving (D2)', () => {
  test('every refusal, as P words it, and nothing is kept', async () => {
    const before = snapshot('templates', 'audit');
    const blank = await save('  ');
    expect([blank.status, refusal(blank.body)]).toEqual([422, expect.objectContaining({ code: 'invalid', field: 'name', message: 'A template needs a name.' })]);
    const shipped = await save('M&E / Building Services');
    expect([shipped.status, refusal(shipped.body)]).toEqual([409, expect.objectContaining({ code: 'NAME_TAKEN', message: TEMPLATE_NAME_SHIPPED })]);
    expect(snapshot('templates', 'audit')).toEqual(before);
  });
  test('configuration only keeps what the tenant decided, not its structure or people, with one audit row', async () => {
    const r = await save('Care, two-stage approval');
    expect(r.status).toBe(200);
    const kept = store.coll<{ template: Record<string, unknown>; savedBy: string; from: string }>('templates').tpl_care_two_stage_approval;
    expect(kept?.template).toMatchObject({ name: 'Care, two-stage approval', description: 'Saved from Brightpath Support Services', scope: 'config',
      labels: expect.objectContaining({ project: 'Funded programme' }), roleNames: { employee: 'Employee', manager: 'Manager', admin: 'Admin' } });
    expect(kept?.template).not.toHaveProperty('structure');
    expect(JSON.stringify(kept?.template)).not.toMatch(/currency|[£€$]|payCode|allowance|"rules"|budget|people/i);
    expect(kept?.from).toBe('Brightpath Support Services');
    expect(audits().filter(a => a.entity === 'template').map(a => a.act)).toEqual(['Template saved']);
    const row = (await list()).templates.find(t => t.key === 'tpl_care_two_stage_approval');
    expect(row).toMatchObject({ source: 'saved', scope: 'config', inUse: false, version: 1, savedBy: expect.any(String) });
  });
  test('configuration and structure adds the five dimensions with their tasks; a second save under that name is NAME_TAKEN and replaces nothing', async () => {
    expect((await save('Everything but people', 'structure')).status).toBe(200);
    const t = store.coll<{ template: { structure: Record<string, { code: string; tasks?: unknown[] }[]> } }>('templates').tpl_everything_but_people?.template;
    expect(t?.structure.locations).toHaveLength(7);
    expect(t?.structure.contracts?.[0]?.tasks?.length).toBeGreaterThan(0);
    const before = snapshot('templates', 'audit');
    const again = await save('everything but people');
    expect([again.status, refusal(again.body).code]).toEqual([409, 'NAME_TAKEN']);
    expect(snapshot('templates', 'audit')).toEqual(before);
  });
});

describe('applying (D1, Review Focus 3)', () => {
  test('the plan is read first and changes nothing', async () => {
    const before = snapshot(...WRITES);
    const p = TemplatePlan.parse((await admin('GET', PLAN('mne'))).body);
    expect(p.changes.map(l => l.text)).toContain('Activity reads as Cost code.');
    expect(p.leftAlone.map(l => l.area)).toEqual(expect.arrayContaining(['people', 'organisation']));
    expect(snapshot(...WRITES)).toEqual(before);
    expect((await admin('GET', PLAN('nope'))).status).toBe(404);
  });
  test('Fusion III makes the tenant read through the template: start and finish on a grid, Contract and Cost code, Rota off', async () => {
    const people = snapshot('people'), heldCc = store.coll('costCentres')['cc_CC-104'], heldLoc = snapshot('locations');
    const call = admin;
    const out = TemplateApplied.parse((await call('POST', APPLY('mne'), undefined, tenantVer())).body);
    const t = getTenant.response.parse((await call('GET', '/api/v1/tenant')).body);
    expect(t.extras).toMatchObject({ weekGrid: 'times', weekLayout: 'grid' });
    expect([t.modules.R, t.template, t.name]).toEqual([false, 'mne', 'Brightpath Support Services']);
    expect(labels()).toMatchObject({ project: 'Contract', job_task: 'Cost code', site: 'Site' });
    expect(t.rotaSetAside).toBeGreaterThan(0);
    /* never deletes or overwrites: people, held structure and the types the template lacks stay exactly as they were */
    expect(snapshot('people')).toEqual(people);
    expect(store.coll('costCentres')['cc_CC-104']).toEqual(heldCc);
    expect(snapshot('locations')).toEqual(heldLoc);
    expect(Object.values(store.coll<{ code: string }>('employeeTypes')).map(x => x.code).sort()).toEqual(['casual', 'driver', 'hourly', 'salaried', 'shift']);
    expect(store.coll('projects')['prj_CON-2451']).toMatchObject({ code: 'CON-2451', costCentre: 'CC-100', location: '', budgetHours: '' });
    expect(store.coll('projectTasks')['tsk_CON-2451_001']).toMatchObject({ projectCode: 'CON-2451', name: '4010 · Labour' });
    /* the two-stage chain: line manager then payroll, every timesheet, all departments, then Business Central */
    const ts = await chainOf('Timesheet');
    expect(ts?.steps.map(x => [x.role, x.scope, x.when])).toEqual([['Line manager', 'All departments', 'Every timesheet'],
      ['Payroll', 'All departments', 'Every timesheet'], ['Business Central', '—', 'Posts on final approval']]);
    expect(ts?.version).toBe(1);
    expect((await chainOf('Rota'))?.version).toBe(0);
    expect(out.plan.changes).toEqual(expect.arrayContaining([{ area: 'chain', text: 'Timesheet approval chain: Line manager, then Payroll, then Business Central.' }]));
    /* one audit row carrying the summary */
    const rows = audits().filter(a => a.entity === 'template');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: out.auditId, act: 'Template applied', entityId: 'mne', before: { template: 'social' } });
    expect(out.message).toMatch(/^M&E \/ Building Services applied\. \d+ changes, \d+ added\. Nothing was deleted\.$/);
    expect(audits().filter(a => a.entity !== 'session')).toHaveLength(1);
  });
  test('a saved template brings its configuration back, and applying the one in force again writes nothing', async () => {
    const call = admin;
    expect((await save('Care as it was')).status).toBe(200);
    expect((await call('POST', APPLY('mne'), undefined, tenantVer())).status).toBe(200);
    const back = TemplateApplied.parse((await call('POST', APPLY('tpl_care_as_it_was'), undefined, tenantVer())).body);
    expect(back.auditId).not.toBeNull();
    expect(labels()).toMatchObject({ project: 'Funded programme', job_task: 'Activity' });
    /* the saved template captured the chains as they were, and puts them back */
    expect(store.coll<{ template: { approvalChain?: unknown[] } }>('templates').tpl_care_as_it_was?.template.approvalChain).toHaveLength(8);
    expect((await chainOf('Timesheet'))?.steps.map(x => x.when)).toEqual(['Every timesheet', 'Only above a premium threshold', 'Posts on final approval']);
    expect(store.coll<{ modules: Record<string, boolean>; template: string }>('tenant').tenant).toMatchObject({ modules: expect.objectContaining({ R: true }), template: 'tpl_care_as_it_was' });
    const n = audits().length;
    const again = TemplateApplied.parse((await call('POST', APPLY('tpl_care_as_it_was'), undefined, tenantVer())).body);
    expect([again.auditId, again.message, audits().length]).toEqual([null, 'Care as it was applied. Nothing needed to change. Nothing was deleted.', n]);
  });
  test('a template that turns Rota back on never restores a shift over leave approved while it was off, and says so (I2)', async () => {
    const line = () => store.coll<{ lines: Record<string, string[]> }>('rotaWeeks')['rw_WH_2026-08-10']?.lines['CP-1042'];
    expect(line()).toEqual(['E', 'E', '', 'N', 'N', '', '']);
    expect((await admin('POST', APPLY('mne'), undefined, tenantVer())).status).toBe(200);
    const emp = await as('employee'), mgr = await as('manager');
    const asked = await emp('POST', '/api/v1/leave/requests', { type: 'AL', part: 'full', from: '2026-08-14', to: '2026-08-14' });
    expect((await mgr('POST', `/api/v1/leave/requests/${(asked.body as { record: { id: string } }).record.id}/approve`, undefined, 1)).status).toBe(200);
    const back = TemplateApplied.parse((await admin('POST', APPLY('social'), undefined, tenantVer())).body);
    expect(line()).toEqual(['E', 'E', '', 'N', 'V', '', '']);
    expect(back.message).toMatch(/ 1 shift was not put back because the person is on leave or off sick that day\.$/);
  });
  test('the tenant\'s version is needed: missing is 428, stale is 412, and nothing changes', async () => {
    const call = admin, before = snapshot(...WRITES);
    expect((await call('POST', APPLY('mne'))).status).toBe(428);
    expect((await call('POST', APPLY('mne'), undefined, tenantVer() + 1)).status).toBe(412);
    expect((await call('POST', APPLY('nope'), undefined, tenantVer())).status).toBe(404);
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

describe('export, import and remove (D4)', () => {
  test('export is the file, and it imports back under its own name once the original is gone', async () => {
    const call = admin;
    await save('Round trip');
    const file = TemplateFile.parse((await call('GET', EXPORT('tpl_round_trip'))).body);
    expect(file).toMatchObject({ kind: 'qnipay.template', v: 1, key: 'tpl_round_trip', template: { name: 'Round trip' } });
    expect(TemplateFile.parse((await call('GET', EXPORT('mne'))).body).template).toEqual(SHIPPED_TEMPLATES.mne);
    expect((await call('DELETE', ONE('tpl_round_trip'), undefined, savedVer('tpl_round_trip'))).status).toBe(200);
    const r = TemplateImported.parse((await call('POST', `${T}/import`, { text: JSON.stringify(file) })).body);
    expect([r.record.key, r.record.source, r.ignored]).toEqual(['tpl_round_trip', 'imported', []]);
    expect(store.coll<{ template: unknown }>('templates').tpl_round_trip?.template).toEqual(file.template);
    expect(audits().filter(a => a.entity === 'template').map(a => a.act)).toEqual(['Template saved', 'Template removed', 'Template imported']);
  });
  test('import never overwrites: a name already here, or a shipped one, is NAME_TAKEN and the one here is untouched', async () => {
    const call = admin;
    await save('Mine');
    const file = TemplateFile.parse((await call('GET', EXPORT('tpl_mine'))).body);
    const before = snapshot('templates', 'audit');
    const clash = await call('POST', `${T}/import`, { text: JSON.stringify({ ...file, template: { ...file.template, description: 'Different' } }) });
    expect([clash.status, refusal(clash.body)]).toEqual([409, expect.objectContaining({ code: 'NAME_TAKEN', message: 'A template called Mine is already here. Nothing is replaced.' })]);
    const shipped = await call('POST', `${T}/import`, { text: JSON.stringify(TemplateFile.parse((await call('GET', EXPORT('mne'))).body)) });
    expect([shipped.status, refusal(shipped.body).message]).toEqual([409, TEMPLATE_NAME_SHIPPED]);
    expect(snapshot('templates', 'audit')).toEqual(before);
  });
  test('a file that cannot be read, is not a template, or holds what Qnipay cannot use is refused; ignored keys are listed', async () => {
    const call = admin;
    for (const [text, message] of [['{oops', 'That file could not be read.'], ['{"kind":"something"}', 'That file is not a Qnipay template.'],
      [JSON.stringify({ kind: 'qnipay.template', v: 1, key: 'x', template: { name: 'Bad', modules: 'all' } }), 'That file is not a Qnipay template.']] as const) {
      const r = await call('POST', `${T}/import`, { text });
      expect([r.status, refusal(r.body).message], text).toEqual([422, message]);
    }
    const p = { kind: 'qnipay.template', v: 1, key: 'tpl_p', template: { ...SHIPPED_TEMPLATES.social, name: 'From the prototype', company: { currency: 'GBP £' }, payCodes: [] } };
    const r = TemplateImported.parse((await call('POST', `${T}/import`, { text: JSON.stringify(p) })).body);
    expect(r.ignored).toEqual(['company', 'payCodes']);
    expect(JSON.stringify(store.coll('templates'))).not.toMatch(/currency|£/);
  });
  test('a shipped template cannot be removed, nor the one in use, nor one that is gone; a stale version is 412', async () => {
    const call = admin;
    const shipped = await call('DELETE', ONE('mne'), undefined, 1);
    expect([shipped.status, refusal(shipped.body)]).toEqual([409, expect.objectContaining({ code: 'SHIPPED', message: 'A template that ships with the app cannot be removed.' })]);
    expect((await call('DELETE', ONE('tpl_gone'), undefined, 1)).status).toBe(404);
    await save('In use');
    expect((await call('POST', APPLY('tpl_in_use'), undefined, tenantVer())).status).toBe(200);
    expect((await call('DELETE', ONE('tpl_in_use'), undefined, savedVer('tpl_in_use') + 1)).status).toBe(412);
    const before = snapshot('templates', 'audit');
    const inUse = await call('DELETE', ONE('tpl_in_use'), undefined, savedVer('tpl_in_use'));
    expect([inUse.status, refusal(inUse.body)]).toEqual([409, expect.objectContaining({ code: 'IN_USE', message: 'This tenant is running on that template.', next: 'Switch to another first.' })]);
    expect(snapshot('templates', 'audit')).toEqual(before);
  });
});

test('a fault on each write leaves no change and no audit row (Review Focus 7)', async () => {
  const call = admin;
  await save('Faulted');
  const file = TemplateFile.parse((await call('GET', EXPORT('tpl_faulted'))).body);
  for (const [m, url, body, ver] of [['POST', T, { name: 'Other', description: '', scope: 'structure' }, undefined], ['POST', APPLY('mne'), undefined, tenantVer()],
    ['POST', `${T}/import`, { text: JSON.stringify({ ...file, template: { ...file.template, name: 'Other' } }) }, undefined],
    ['DELETE', ONE('tpl_faulted'), undefined, savedVer('tpl_faulted')]] as const) {
    const before = snapshot(...WRITES);
    await fault(m, url);
    expect((await call(m, url, body, ver)).status, url).toBe(500);
    expect(snapshot(...WRITES), url).toEqual(before);
  }
});
