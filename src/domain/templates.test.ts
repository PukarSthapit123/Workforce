import meta from '@/mocks/seed/meta.json';
import { FLAGS, SWITCH_CODES, ROLE_NAME_TAKEN, switchFlag, type FlagExtras } from './modules';
import {
  IN_USE, NOT_A_TEMPLATE, NO_SUCH_TEMPLATE, SHIPPED_KEYS, SHIPPED_REMOVE, SHIPPED_TEMPLATES, TEMPLATE_NAME_REQUIRED, TEMPLATE_NAME_SHIPPED,
  TEMPLATE_SCOPES, UNREADABLE, captureTemplate, planApply, planSummary, readTemplateFile, removeProblem, templateFile, templateKey,
  ONB_LEFT_ALONE, TYPES_LEFT_ALONE, captureOnboarding, templateNameProblem, templateSummary, type CaptureSource, type Template, type TenantState, type TemplateStructure,
} from './templates';
import { CHAIN_MODULES, DEFAULT_CHAIN, defaultChainFor, type ChainModule, type ChainStep } from './approvals';
import { ALWAYS_ASKED, POLICY_NAME_TAKEN, STEP_UNAVAILABLE, type OnbPolicy, type OnbStep, type OnboardingConfig } from './onboarding';

const must = <T,>(v: T | undefined, what = 'value'): T => { if (v === undefined) throw new Error(`missing ${what}`); return v; };
const shipped = (k: string) => must(SHIPPED_TEMPLATES[k], k);
const DEFAULT_LABELS: Record<string, string> = Object.fromEntries(meta.timesheetFields.map(f => [f.c, f.label]));
const EXTRAS: FlagExtras = { weekGrid: 'times', weekLayout: 'classic', breaksMax: 5, vehiclesMax: 4 };
const EMPTY: TemplateStructure = { departments: [], costCentres: [], locations: [], jobProfiles: [], contracts: [] };
const DEFAULT_CHAINS = Object.fromEntries(CHAIN_MODULES.map(m => [m, defaultChainFor(m)])) as Record<ChainModule, ChainStep[]>;

/* The social tenant as seeded: every module on, its own template's flags and labels. */
function socialState(over: Partial<TenantState> = {}): TenantState {
  const t = shipped('social');
  return {
    name: 'Brightpath Support Services', people: 19, modules: { ...t.modules }, restore: {}, flags: { ...t.flags }, extras: { ...EXTRAS },
    labels: { ...DEFAULT_LABELS, ...t.labels }, employeeTypes: structuredClone(t.employeeTypes),
    roleNames: { employee: 'Employee', manager: 'Manager', admin: 'Admin' }, chains: DEFAULT_CHAINS,
    structure: { departments: ['CARE', 'OPS', 'PRJ', 'ADM'], costCentres: ['WH-CAM-01', 'CC-100'], locations: ['WH', 'BC'], jobProfiles: ['SW', 'ADM'], contracts: ['PRJ-114'] },
    ...over,
  };
}
/* Every key in a value, at any depth. */
const keysOf = (v: unknown): string[] => (Array.isArray(v) ? v.flatMap(keysOf)
  : v && typeof v === 'object' ? Object.entries(v).flatMap(([k, x]) => [k, ...keysOf(x)]) : []);
const MONEY = /currency|rate|amount|value|price|wage|salary|budget|cost$|paycode|allowance|allow$|rules|nmw|overtime|multiplier/i;
const noMoney = (t: unknown) => {
  expect(keysOf(t).filter(k => MONEY.test(k))).toEqual([]);
  expect(JSON.stringify(t)).not.toMatch(/[£€$]|\d+(\.\d+)?×/);
};

describe('the shipped templates', () => {
  test('are the three the brief names, each with every switch and every feature', () => {
    expect(SHIPPED_KEYS.sort()).toEqual(['mne', 'qcic', 'social']);
    for (const k of SHIPPED_KEYS) {
      expect(Object.keys(shipped(k).modules).sort(), k).toEqual([...SWITCH_CODES].sort());
      expect(Object.keys(shipped(k).flags).sort(), k).toEqual(FLAGS.map(f => f.code).sort());
      expect(shipped(k).modules.CORE).toBe(true);
    }
  });
  test('carry no money anywhere: no currency, pay codes, allowance amounts, rates or pay rules (D3)', () => {
    for (const k of SHIPPED_KEYS) noMoney(shipped(k));
  });
  test('Fusion III is M&E / Building Services: Rota off, a contract and a cost code, start and finish on a grid, two approval stages', () => {
    const t = shipped('mne');
    expect(t.name).toBe('M&E / Building Services');
    expect(Object.entries(t.modules).filter(([, on]) => on).map(([k]) => k).sort()).toEqual(['A', 'B', 'C', 'CORE', 'L', 'ON', 'TS']);
    expect(t.modules.R).toBe(false);
    expect(t.employeeTypes.map(x => x.code)).toEqual(['driver', 'salaried', 'hourly']);
    expect(t.extras).toEqual({ weekGrid: 'times', weekLayout: 'grid' });
    expect(t.labels).toMatchObject({ project: 'Contract', job_task: 'Cost code' });
    expect(t.approvalChain?.filter(s => s.module === 'Timesheet' && !s.fixed).map(s => [s.role, s.when])).toEqual([
      ['Line manager', 'Every timesheet'], ['Payroll', 'Every timesheet']]);
    expect(t.structure?.costCentres?.map(c => c.code)).toEqual(['CC-100', 'CC-110', 'CC-120', 'CC-900']);
    expect(t.structure?.jobProfiles?.length).toBe(5);
    expect(t.structure?.contracts?.map(c => c.code)).toEqual(['CON-2451', 'CON-2478', 'CON-2503', 'CON-2199', 'CON-0001']);
    expect(templateSummary(t)).toEqual({ types: ['Site Engineer', 'Contracts Manager', 'Office / Admin'], modules: ['Workforce core', 'Timesheet', 'Leave & absence', 'Onboarding'] });
  });
  test('qcic is Dogma\'s professional services with no rota; social is Brightpath\'s care setup', () => {
    expect([shipped('qcic').modules.R, shipped('qcic').labels.job_task]).toEqual([false, 'Project task']);
    expect([shipped('social').modules.R, shipped('social').labels.site, shipped('social').scope]).toEqual([true, 'Service', 'config']);
  });
  test('two capture scopes and no "everything, including people" (D2)', () => {
    expect(TEMPLATE_SCOPES.map(s => s.key)).toEqual(['config', 'structure']);
  });
});

describe('capture by scope (D2)', () => {
  const src: CaptureSource = {
    modules: { CORE: true, TS: true, A: true, B: false, C: true, R: false, L: true, ON: true }, flags: { WEEKLY: true, NOTICES: true }, extras: EXTRAS,
    labels: { ...DEFAULT_LABELS, project: 'Contract' }, defaultLabels: DEFAULT_LABELS,
    employeeTypes: [{ code: 'hourly', name: 'Consultant', category: 'Contracted', mode: 'grid', uom: 'hour', capabilities: ['project'] }],
    roleNames: { employee: 'Consultant', manager: 'Lead', admin: 'Operations' }, chain: DEFAULT_CHAIN,
    structure: { ...EMPTY, departments: [{ code: 'DEL', name: 'Delivery', manager: '' }],
      contracts: [{ code: 'J1', name: 'Job', client: '', costCentre: '', manager: '', status: 'Active', start: '', end: '', billable: true, location: '', tasks: [] }] },
  };
  test('configuration only keeps modules, every feature, extras, changed labels, employee types and role names, and no structure', () => {
    const t = captureTemplate('  Mine  ', 'For us', 'config', src);
    expect(t.name).toBe('Mine');
    expect(Object.keys(t.modules).sort()).toEqual([...SWITCH_CODES].sort());
    expect(Object.keys(t.flags)).toHaveLength(FLAGS.length);
    expect(t.flags.WEEKLY).toBe(true);
    expect(t.flags.GPS).toBe(false);
    expect(t.labels).toEqual({ project: 'Contract' });
    expect(t.roleNames).toEqual(src.roleNames);
    expect(t.approvalChain).toEqual(DEFAULT_CHAIN);
    expect(t.structure).toBeUndefined();
    expect(t).not.toHaveProperty('people');
    noMoney(t);
  });
  test('configuration and structure adds the five dimensions, never people', () => {
    const t = captureTemplate('Mine', '', 'structure', src);
    expect(t.structure?.departments).toEqual(src.structure.departments);
    expect(t.structure?.contracts?.[0]?.code).toBe('J1');
    expect(keysOf(t)).not.toContain('roster');
    noMoney(t);
  });
});

describe('the apply plan (D1)', () => {
  test('Fusion III on the care tenant: Rota off with its shifts set aside, start and finish on a grid, Contract and Cost code', () => {
    const p = planApply(shipped('mne'), socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    expect(p.steps.modules).toEqual([{ code: 'R', on: false }]);
    expect(p.steps.finalModules.R).toBe(false);
    expect(p.changes.map(l => l.text)).toEqual(expect.arrayContaining([
      'Rota off. Its scheduled shifts are set aside, not deleted, and come back when Rota is turned on.',
      'Weekly view: grid.', 'Funded programme reads as Contract.', 'Activity reads as Cost code.', 'Vehicle & movement fields on.',
      'Employee type Service Manager becomes Contracts Manager, with a new entry mode.']));
    expect(p.steps.flags).toEqual(expect.arrayContaining([{ code: 'WEEKLY', change: { weekLayout: 'grid' } }]));
    expect(p.steps.labels).toMatchObject({ project: 'Contract', job_task: 'Cost code', site: 'Site', travel: 'Travel time' });
    expect(p.steps.typesAdded.map(x => x.code)).toEqual(['driver', 'hourly']);
  });
  test('never deletes or overwrites: held structure codes and employee types the template lacks are left alone, with the people', () => {
    const p = planApply(shipped('mne'), socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    expect(p.steps.structure.costCentres.map(c => c.code)).toEqual(['CC-110', 'CC-120', 'CC-900']);
    expect(p.steps.structure.jobProfiles.map(c => c.code)).toEqual(['ENG', 'SENG', 'CM', 'PAY']);
    expect(p.added.map(l => l.text)).toContain('Employee type Site Engineer (driver).');
    const alone = p.leftAlone.map(l => l.text);
    expect(alone).toEqual(expect.arrayContaining([
      'Cost centres already here stay exactly as they are: CC-100.', 'Job profiles already here stay exactly as they are: ADM.',
      'Employee types the template does not have stay, with everyone who holds them: Support Worker and Relief / Bank Worker.',
      'Nobody’s record changes. 19 people keep their details and their employee type.',
      'Brightpath Support Services keeps its name, company details, compliance and pay periods.',
      'Approval chains the template does not have stay as they are: Rota.']));
    /* nothing in the steps can remove a record or a type */
    expect(Object.keys(p.steps)).not.toEqual(expect.arrayContaining(['typesRemoved']));
    expect(keysOf(p.steps)).not.toContain('people');
  });
  test('a contract pointing at something not here is added without it, and says so', () => {
    const t: Template = { ...shipped('social'), scope: 'structure',
      structure: { contracts: [{ code: 'NEW-1', name: 'New', client: '', costCentre: 'CC-404', manager: '', status: 'Active', start: '', end: '', billable: true, location: 'WH', tasks: [] }] } };
    const p = planApply(t, socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    expect(p.steps.structure.contracts[0]).toMatchObject({ code: 'NEW-1', costCentre: '', location: 'WH' });
    expect(p.added.map(l => l.text)).toContain('Contract NEW-1 New, without the cost centre CC-404, which is not here.');
  });
  test('a feature of a module that ends up off is left alone, through switchFlag', () => {
    const p = planApply(shipped('qcic'), socialState({ flags: { ...shipped('social').flags, RESTRULE: false } }), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    expect(p.steps.flags.find(f => f.code === 'RESTRULE')).toBeUndefined();
    expect(p.leftAlone.find(l => l.area === 'features')?.text).toMatch(/^Features of a module that is off stay as they are: .*Minimum rest checking/);
    for (const f of p.steps.flags) expect(switchFlag(p.steps.finalModules, { ...shipped('qcic').flags }, f.code, f.change).ok, f.code).toBe(true);
  });
  test('Timesheet goes off and comes back through switchModule, remembering its capture methods', () => {
    const off: Template = { ...shipped('social'), modules: { ...shipped('social').modules, TS: false, A: false, B: false, C: false } };
    const p = planApply(off, socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    expect(p.steps.modules).toEqual([{ code: 'TS', on: false }]);
    expect(p.steps.finalRestore.TS).toEqual(['A', 'B', 'C']);
    const back = planApply(shipped('qcic'), socialState({ modules: p.steps.finalModules, restore: p.steps.finalRestore }), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    expect(back.steps.modules).toEqual([{ code: 'R', on: false }, { code: 'TS', on: true }, { code: 'B', on: false }]);
    expect(back.steps.finalModules).toMatchObject({ TS: true, A: true, B: false, C: true });
  });
  test('Sites off leaves no new or changed type with the site capability', () => {
    const t: Template = { ...shipped('mne'), modules: { ...shipped('mne').modules, C: false } };
    const p = planApply(t, socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    expect(p.steps.typesAdded.find(x => x.code === 'driver')?.capabilities).toEqual(['vehicle', 'project']);
  });
  test('employee types change only for a caller who may configure employee types (I1)', () => {
    const no = planApply(shipped('mne'), socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: false });
    expect([no.steps.typesAdded, no.steps.typesUpdated]).toEqual([[], []]);
    expect([...no.changes, ...no.added].filter(l => l.area === 'types')).toEqual([]);
    expect(no.leftAlone.map(l => l.text)).toContain(TYPES_LEFT_ALONE);
    const same = planApply(shipped('social'), socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: false });
    expect(same.leftAlone.map(l => l.text)).not.toContain(TYPES_LEFT_ALONE);
  });
  test('role names change only for a caller who may rename roles, and only as a valid set', () => {
    const t: Template = { ...shipped('social'), roleNames: { employee: 'Support Worker', manager: 'Service Manager', admin: 'Admin' } };
    const yes = planApply(t, socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    expect(yes.steps.roleNames).toEqual({ employee: 'Support Worker', manager: 'Service Manager' });
    expect(yes.changes.map(l => l.text)).toContain('The Employee role is called Support Worker.');
    const no = planApply(t, socialState(), { mayRenameRoles: false, mayChangeChains: true, mayChangeTypes: true });
    expect(no.steps.roleNames).toEqual({});
    expect(no.leftAlone.map(l => l.text)).toContain('Role names stay as they are. Renaming roles needs Permissions configuration.');
    const clash = planApply({ ...t, roleNames: { employee: 'Staff', manager: 'staff', admin: 'Admin' } }, socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    expect(clash.leftAlone.map(l => l.text)).toContain(`Role names stay as they are. ${ROLE_NAME_TAKEN}`);
  });
  test('applying the template a tenant already matches changes nothing', () => {
    const p = planApply(shipped('social'), socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    expect([p.changes, p.added]).toEqual([[], []]);
    expect(planSummary(p)).toBe('Nothing needed to change. Nothing was deleted.');
    expect(planSummary({ changes: [{ area: 'modules', text: 'x' }, { area: 'modules', text: 'y' }], added: [{ area: 'types', text: 'z' }] }))
      .toBe('2 changes, 1 added. Nothing was deleted.');
  });
});

describe('names and removal (D4)', () => {
  test('every save refusal, as a sentence', () => {
    expect(templateNameProblem('  ', [])?.message).toBe(TEMPLATE_NAME_REQUIRED);
    expect(templateNameProblem('m&e / building services', [])).toMatchObject({ code: 'NAME_TAKEN', message: TEMPLATE_NAME_SHIPPED });
    expect(templateNameProblem('mne', [])?.message).toBe(TEMPLATE_NAME_SHIPPED);
    expect(templateNameProblem('Care two-stage', ['care  two stage'])).toMatchObject({ status: 409, code: 'NAME_TAKEN',
      message: 'A template called Care two-stage is already here. Nothing is replaced.' });
    expect(templateNameProblem('x'.repeat(81), [])?.code).toBe('invalid');
    expect(templateNameProblem('Care two-stage', [])).toBeNull();
    expect(templateKey('Care — two-stage approval!')).toBe('tpl_care_two_stage_approval');
  });
  test('a shipped template, a missing one and the one in use cannot be removed', () => {
    expect(removeProblem('mne', true, 'social')).toBe(SHIPPED_REMOVE);
    expect(SHIPPED_REMOVE.message).toBe('A template that ships with the app cannot be removed.');
    expect(removeProblem('tpl_gone', false, 'social')).toBe(NO_SUCH_TEMPLATE);
    expect(removeProblem('tpl_mine', true, 'tpl_mine')).toBe(IN_USE);
    expect([IN_USE.message, IN_USE.next]).toEqual(['This tenant is running on that template.', 'Switch to another first.']);
    expect(removeProblem('tpl_mine', true, 'social')).toBeNull();
  });
});

describe('the file', () => {
  test('export and import round-trip exactly, with nothing ignored', () => {
    const file = templateFile('mne', shipped('mne'));
    expect(file).toMatchObject({ kind: 'qnipay.template', v: 1, key: 'mne' });
    const r = readTemplateFile(JSON.stringify(file, null, 1));
    expect(r).toEqual({ ok: true, template: shipped('mne'), ignored: [] });
  });
  test('a file that is not JSON could not be read; one that is not a template says so', () => {
    expect(readTemplateFile('{not json')).toEqual({ ok: false, refusal: UNREADABLE });
    expect(UNREADABLE.message).toBe('That file could not be read.');
    for (const text of ['[]', '{"kind":"qnipay.state","template":{}}', '{"kind":"qnipay.template"}', '"x"'])
      expect(readTemplateFile(text), text).toEqual({ ok: false, refusal: NOT_A_TEMPLATE });
    expect(NOT_A_TEMPLATE.message).toBe('That file is not a Qnipay template.');
  });
  test('a prototype file keeps only what a template may hold and lists the rest, money included (D3)', () => {
    const p = { kind: 'qnipay.template', v: 1, key: 'tpl_x', template: {
      name: 'X', description: '', scope: 'config', custom: true, savedAt: '13/08/2026', company: { currency: 'GBP £' }, payCodes: [{ code: 'OT', value: '1.5' }],
      modules: { A: true, Z: true }, flags: { WEEKLY: true, NOPE: true }, extras: { weekGrid: 'times', rate: 3 }, labels: {},
      employeeTypes: [{ code: 'driver', name: 'Driver', category: 'Contracted', mode: 'form', uom: 'hour', capabilities: [], rules: [{ val: '£21 flat' }], allow: ['OT'] }],
      structure: { locations: [] },
    } };
    const r = readTemplateFile(JSON.stringify(p));
    if (!r.ok) throw new Error('refused');
    expect(r.ignored).toEqual(['company', 'custom', 'employeeTypes.allow', 'employeeTypes.rules', 'extras.rate', 'flags.NOPE', 'modules.Z', 'payCodes', 'savedAt', 'structure']);
    noMoney(r.template);
  });
});

describe('approval chains in a template (1c group 5)', () => {
  test('Fusion III sets its two-stage Timesheet chain, every timesheet, all departments, ending in the posting step', () => {
    const p = planApply(shipped('mne'), socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    const ts = p.steps.chains.find(c => c.module === 'Timesheet')?.steps ?? [];
    expect(ts.map(s => [s.role, s.scope, s.when])).toEqual([
      ['Line manager', 'All departments', 'Every timesheet'], ['Payroll', 'All departments', 'Every timesheet'],
      ['Business Central', '—', 'Posts on final approval']]);
    expect(p.steps.chains.map(c => c.module)).toEqual(['Timesheet', 'Profile', 'Leave']);
    expect(p.changes.filter(l => l.area === 'chain').map(l => l.text)).toEqual([
      'Timesheet approval chain: Line manager, then Payroll, then Business Central.', 'Profile approval chain: Line manager.', 'Leave approval chain: Line manager.']);
  });
  test('a chain already held is no change; without the approval framework the chains stay', () => {
    const fusion = planApply(shipped('mne'), socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    const held = Object.fromEntries(CHAIN_MODULES.map(m => [m, fusion.steps.chains.find(c => c.module === m)?.steps ?? defaultChainFor(m)])) as Record<ChainModule, ChainStep[]>;
    expect(planApply(shipped('mne'), socialState({ chains: held }), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true }).steps.chains).toEqual([]);
    const no = planApply(shipped('mne'), socialState(), { mayRenameRoles: true, mayChangeChains: false, mayChangeTypes: true });
    expect(no.steps.chains).toEqual([]);
    expect(no.leftAlone.map(l => l.text)).toContain('Approval chains stay as they are. Changing them needs the approval framework.');
  });
  test('a chain that fails the Approvals page\'s checks stays, and says why; an older file\'s blank posting step reads as the posting step', () => {
    const t: Template = { ...shipped('social'), approvalChain: [
      { module: 'Profile', role: 'Service Manager', scope: 'All departments', when: 'Every contact detail change', sla: '1 day', fixed: false },
      { module: 'Timesheet', role: 'Line manager', scope: 'All departments', when: 'Every timesheet', sla: '12 hours', fixed: false },
      { module: 'Timesheet', role: 'Business Central', scope: '', when: 'Posts on final approval', sla: '', fixed: true },
      { module: 'Payroll', role: 'Payroll', scope: 'All departments', when: 'Every timesheet', sla: '1 day', fixed: false }] };
    const p = planApply(t, socialState(), { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true });
    expect(p.steps.chains.map(c => c.module)).toEqual(['Timesheet']);
    expect(p.leftAlone.map(l => l.text)).toEqual(expect.arrayContaining([
      'The Profile approval chain stays as it is. The Profile chain can only have a line manager and payroll.',
      'Approval chains the template does not have stay as they are: Leave and Rota.',
      'Approval chains for modules this tenant does not have are not used: Payroll.']));
  });
});

describe('the onboarding setup in a template (module 5, D12)', () => {
  const step = (id: OnbStep['id'], label: string, on: boolean, fixed = false): OnbStep => ({ id, label, on, fixed, desc: '' });
  const config = (): OnboardingConfig => ({
    steps: [step('personal', 'Personal details', true, true), step('emergency', 'Emergency contacts', true), step('policies', 'Policies and sign-off', false)],
    documents: [{ id: 'addr', label: 'Proof of address', req: true, verify: 'hr', blocks: false, expiry: false, hint: '' }],
  });
  const pol = (id: string, label: string, ver: string, extra: Partial<OnbPolicy> = {}): OnbPolicy =>
    ({ id, label, ver, sum: `${label} in one line.`, body: [`${label} says this.`], order: 0, ...extra });
  const policies = () => [pol('pol_conduct', 'Code of conduct', 'v4.1', { file: { name: 'conduct.pdf', size: 10, type: 'application/pdf', at: '2026-08-13T10:00:00.000Z', kind: 'pdf' } }),
    pol('pol_privacy', 'Privacy notice', 'v2.0', { order: 1 })];
  const ALL = { mayRenameRoles: true, mayChangeChains: true, mayChangeTypes: true, mayChangeOnboarding: true };
  const src = (): CaptureSource => ({
    modules: { CORE: true, ON: true }, flags: {}, extras: EXTRAS, labels: {}, defaultLabels: {}, employeeTypes: [],
    roleNames: { employee: 'Employee', manager: 'Manager', admin: 'Admin' }, chain: [], structure: EMPTY, onboarding: { config: config(), policies: policies() },
  });
  /* the social tenant, holding the given onboarding setup, with every ONB_* feature on unless said otherwise */
  const state = (o = { config: config(), policies: policies() }, flags: Record<string, boolean> = {}) =>
    socialState({ onboarding: o, flags: { ...shipped('social').flags, ...flags } });
  const withOnb = (o: Template['onboarding']): Template => ({ ...shipped('social'), onboarding: o });
  const texts = (lines: readonly { area: string; text: string }[]) => lines.filter(l => l.area === 'onboarding').map(l => l.text);

  test('capture keeps the step switches, the document settings and each policy with its text, and never a file', () => {
    const t = captureTemplate('Ours', '', 'config', src());
    expect(t.onboarding).toEqual({
      steps: [{ id: 'personal', on: true }, { id: 'emergency', on: true }, { id: 'policies', on: false }],
      documents: [{ id: 'addr', req: true, verify: 'hr', blocks: false, expiry: false }],
      policies: [{ id: 'pol_conduct', label: 'Code of conduct', ver: 'v4.1', sum: 'Code of conduct in one line.', body: ['Code of conduct says this.'] },
        { id: 'pol_privacy', label: 'Privacy notice', ver: 'v2.0', sum: 'Privacy notice in one line.', body: ['Privacy notice says this.'] }],
    });
    expect(keysOf(t)).not.toContain('file');
    expect(keysOf(t).filter(k => MONEY.test(k))).toEqual([]);
    expect(captureTemplate('Ours', '', 'config', { ...src(), onboarding: undefined })).not.toHaveProperty('onboarding');
  });

  test('switches and settings are set by id; a step stays off while its features are off, and a fixed step stays on', () => {
    const t = withOnb({ steps: [{ id: 'personal', on: false }, { id: 'emergency', on: false }, { id: 'policies', on: true }],
      documents: [{ id: 'addr', req: false, verify: 'mgr', blocks: true, expiry: true }, { id: 'visa', req: true, verify: 'hr', blocks: true, expiry: true }], policies: [] });
    const p = planApply({ ...t, flags: { ...t.flags, ONB_POL: false } }, state(undefined, { ONB_POL: false }), ALL);
    expect(p.steps.onboarding.steps).toEqual({ emergency: false });
    expect(p.steps.onboarding.documents).toEqual({ addr: { req: false, verify: 'mgr', blocks: true, expiry: true } });
    expect(texts(p.changes)).toEqual(['Onboarding step Emergency contacts off.',
      'Onboarding document Proof of address: not required, checked by line manager, blocks the start and expiry tracked.']);
    expect(texts(p.leftAlone)).toEqual(expect.arrayContaining([
      `Onboarding step Personal details stays on. ${ALWAYS_ASKED}`, `Onboarding step Policies and sign-off stays off. ${STEP_UNAVAILABLE}`,
      'Onboarding documents this tenant does not have are not used: visa.']));
    /* judged against the features the template leaves the tenant with: this one turns Policy acknowledgement on */
    expect(planApply(t, state(undefined, { ONB_POL: false }), ALL).steps.onboarding.steps).toEqual({ emergency: false, policies: true });
  });

  test('a held policy given new wording takes a new version; a missing one is added; the tenant\'s others stay', () => {
    const t = withOnb({ steps: [], documents: [], policies: [
      { id: 'pol_conduct', label: 'Code of conduct', ver: 'v1.0', sum: 'Newer words.', body: ['A new paragraph.'] },
      { id: 'pol_safe', label: 'Safeguarding policy', ver: 'v2.3', sum: 'Raising a concern.', body: ['Tell somebody.'] }] });
    const p = planApply(t, state(), ALL);
    expect(p.steps.onboarding.policiesUpdated).toEqual([{ id: 'pol_conduct', label: 'Code of conduct', ver: 'v4.2', sum: 'Newer words.', body: ['A new paragraph.'], reask: true }]);
    expect(p.steps.onboarding.policiesAdded).toEqual([{ id: 'pol_safe', label: 'Safeguarding policy', ver: 'v2.3', sum: 'Raising a concern.', body: ['Tell somebody.'] }]);
    expect(texts(p.changes)).toEqual(['Policy Code of conduct, with the template\'s wording. It becomes v4.2. Nobody still onboarding has acknowledged it, so nobody is asked again.']);
    expect(texts(p.added)).toEqual(['Policy Safeguarding policy v2.3, without a document. Upload one in Onboarding setup.']);
    expect(texts(p.leftAlone)).toEqual(['Policies the template does not have stay, with their acknowledgements: Privacy notice.',
      'Uploaded policy documents and everybody’s onboarding progress stay as they are.']);
    expect(planSummary(p)).toBe('1 change, 1 added. Nothing was deleted.');
  });

  test('new wording or a new summary asks again the people still onboarding who acknowledged it, and the plan says how many (review M2)', () => {
    const o = { config: config(), policies: policies(), acknowledged: { pol_conduct: 2, pol_privacy: 1 } };
    const reworded = withOnb({ steps: [], documents: [], policies: [
      { id: 'pol_conduct', label: 'Code of conduct', ver: 'v4.1', sum: 'Code of conduct in one line.', body: ['Different words.'] },
      { id: 'pol_privacy', label: 'Privacy notice', ver: 'v2.0', sum: 'A new summary.', body: ['Privacy notice says this.'] }] });
    const p = planApply(reworded, state(o), ALL);
    expect(p.steps.onboarding.policiesUpdated.map(u => [u.id, u.ver, u.reask])).toEqual([['pol_conduct', 'v4.2', true], ['pol_privacy', 'v2.1', true]]);
    expect(texts(p.changes)).toEqual([
      'Policy Code of conduct, with the template\'s wording. It becomes v4.2. 2 people will be asked to read it again.',
      'Policy Privacy notice, with the template\'s wording. It becomes v2.1. 1 person will be asked to read it again.']);
    expect(texts(p.leftAlone)).toContain('Uploaded policy documents stay as they are. Everybody’s onboarding progress stays too, apart from the policies they are asked to read again.');
  });
  test('a new name alone keeps the version and the acknowledgements', () => {
    const o = { config: config(), policies: policies(), acknowledged: { pol_conduct: 2 } };
    const p = planApply(withOnb({ steps: [], documents: [], policies: [
      { id: 'pol_conduct', label: 'Conduct at work', ver: 'v9.9', sum: 'Code of conduct in one line.', body: ['Code of conduct says this.'] }] }), state(o), ALL);
    expect(p.steps.onboarding.policiesUpdated).toEqual([{ id: 'pol_conduct', label: 'Conduct at work', ver: 'v4.1', sum: 'Code of conduct in one line.', body: ['Code of conduct says this.'], reask: false }]);
    expect(texts(p.changes)).toEqual(['Policy Code of conduct becomes Conduct at work. It stays v4.1, so nobody is asked to read it again.']);
    expect(texts(p.leftAlone)).toContain('Uploaded policy documents and everybody’s onboarding progress stay as they are.');
  });
  test('a policy whose name another one has is neither renamed nor added, and says why', () => {
    const t = withOnb({ steps: [], documents: [], policies: [
      { id: 'pol_conduct', label: 'privacy NOTICE', ver: 'v4.1', sum: '', body: [] },
      { id: 'pol_other', label: 'Code of conduct', ver: 'v1.0', sum: '', body: [] }] });
    const p = planApply(t, state(), ALL);
    expect([p.steps.onboarding.policiesUpdated, p.steps.onboarding.policiesAdded]).toEqual([[], []]);
    expect(texts(p.leftAlone)).toEqual(expect.arrayContaining([
      `Policy Code of conduct stays as it is. ${POLICY_NAME_TAKEN}`, `Policy Code of conduct is not added. ${POLICY_NAME_TAKEN}`]));
  });

  test('without Configure onboarding the onboarding setup stays and says so; a matching one is no change', () => {
    const changed = withOnb({ steps: [{ id: 'emergency', on: false }], documents: [], policies: [] });
    const no = planApply(changed, state(), { ...ALL, mayChangeOnboarding: false });
    expect(no.steps.onboarding).toEqual({ steps: {}, documents: {}, policiesUpdated: [], policiesAdded: [] });
    expect(texts(no.leftAlone)).toEqual([ONB_LEFT_ALONE]);
    const same = planApply(withOnb(captureOnboarding({ config: config(), policies: policies() })), state(), ALL);
    expect([texts(same.changes), texts(same.added)]).toEqual([[], []]);
  });

  test('an imported file keeps the onboarding setup and lists a policy\'s file as ignored', () => {
    const t = { ...shipped('social'), onboarding: { steps: [], documents: [],
      policies: [{ id: 'pol_x', label: 'X', ver: 'v1.0', sum: '', body: [], file: { name: 'x.pdf' } }], progress: {} } };
    const r = readTemplateFile(JSON.stringify(templateFile('tpl_x', t as unknown as Template)));
    if (!r.ok) throw new Error('refused');
    expect(r.ignored).toEqual(['onboarding.policies.file', 'onboarding.progress']);
    expect(r.template.onboarding).toEqual({ steps: [], documents: [], policies: [{ id: 'pol_x', label: 'X', ver: 'v1.0', sum: '', body: [] }] });
  });
});
