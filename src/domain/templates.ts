/* Templates. Ported from the prototype (qnipay-workforce-v15.html: TEMPLATES
   2563-2793, TPL_SCOPES and captureTemplate 4565-4623, applyTemplate
   2931-3012, and the tpl-save, tpl-export, tpl-delete and tpl-import cases
   11979-12030). A template is data: what a tenant has decided, which can
   start another tenant already configured.

   Where the prototype and the brief part company, the brief wins:
   - D1: applying one sets configuration (modules, features with their
     extras, labels, the capture layout, employee types and role names) and
     adds structure records whose codes are new. It never deletes or
     overwrites people or structure already here, and never renames the
     organisation. The prototype replaced the master data and reset the
     company; here those are left alone and the plan says so.
   - D2: two capture scopes. The prototype's third ("everything, including
     people") is not offered.
   - D3: no money. No currency, pay-code values, allowance amounts, rates or
     pay rules: the prototype's company, tweaks.rules, tweaks.allow, payCodes
     and budget hours are left out of the shipped data, and an imported file
     that carries them has them listed as ignored.
   - Approval chains (1c group 5): a template carries every module's chain;
     applying it sets each chain it holds that passes the same checks as the
     Approvals page, needs the approval framework, and leaves the others.
   - Onboarding setup (module 5, D12): a template keeps the step switches,
     the document settings and each policy with its text, as the prototype
     kept onbDocs and onbPolicies, never an uploaded file or anybody's
     progress. Applying it needs Configure onboarding, switches only what
     the features allow, takes a held policy's wording without raising its
     version (nobody is asked again), adds the policies not here, and leaves
     the tenant's other policies alone.

   Every function is pure: the tenant comes in as arguments, so the server
   refuses with exactly what the screen shows. Copy is the prototype's, with
   each "·" aside rewritten as its own sentence. */
import {
  FLAGS, FLAG_EXTRAS, MODULES, SWITCH_CODES, WEEK_GRIDS, WEEK_LAYOUTS, flagBy, moduleLive, roleNameProblem, subName,
  switchFlag, switchModule, type FlagChange, type FlagExtras, type ModuleState, type Refusal,
} from './modules';
import { CHAIN_MODULES, POSTING_ROLE, POSTING_STEP, chainProblem, chainText, isChainModule, type ChainModule, type ChainStep } from './approvals';
import {
  STEP_UNAVAILABLE, isVerifier, onbFeatures, policyProblem, stepSwitchProblem, verifierLabel,
  type OnboardingConfig, type OnbPolicy, type OnbStepId, type Verifier,
} from './onboarding';

/* ------------------------------------------------------------- shapes */
export type TemplateScope = 'config' | 'structure';
export type RoleKey = 'employee' | 'manager' | 'admin';
export const ROLE_KEYS: readonly RoleKey[] = ['employee', 'manager', 'admin'];
export interface TemplateType {
  code: string; name: string; category: 'Contracted' | 'Bank' | 'Agency' | 'Salaried'; mode: 'form' | 'grid' | 'clock'; uom: 'hour' | 'day';
  capabilities: ('vehicle' | 'site' | 'project' | 'shift')[];
}
/* One stage of an approval chain, as the prototype's APPROVAL_CHAIN rows (src/domain/approvals.ts). */
export type { ChainStep };
export interface TemplateLocation {
  code: string; name: string; area: string; department: string; costCentre: string; level: string; minPerShift: number; manager: string; address: string; active: boolean;
}
export interface TemplateDepartment { code: string; name: string; manager: string }
export interface TemplateCostCentre { code: string; name: string }
export interface TemplateJobProfile { code: string; name: string; night: boolean }
export interface TemplateTask { name: string; group: string; billable: boolean }
/* A project, which the prototype's templates call a contract. No budget: hours
   booked against it belong to the tenant, not to a template. */
export interface TemplateContract {
  code: string; name: string; client: string; costCentre: string; manager: string; status: string; start: string; end: string;
  billable: boolean; location: string; tasks: TemplateTask[];
}
export interface TemplateStructure {
  departments: TemplateDepartment[]; costCentres: TemplateCostCentre[]; locations: TemplateLocation[];
  jobProfiles: TemplateJobProfile[]; contracts: TemplateContract[];
}
export type StructureKind = keyof TemplateStructure;
/* In the order they are added, so a location finds its department and cost
   centre, and a contract its cost centre and location. */
export const STRUCTURE_KINDS: readonly StructureKind[] = ['departments', 'costCentres', 'locations', 'jobProfiles', 'contracts'];
export const STRUCTURE_LABEL: Readonly<Record<StructureKind, { many: string; one: string }>> = {
  departments: { many: 'Departments', one: 'department' }, costCentres: { many: 'Cost centres', one: 'cost centre' },
  locations: { many: 'Locations', one: 'location' }, jobProfiles: { many: 'Job profiles', one: 'job profile' },
  contracts: { many: 'Contracts', one: 'contract' },
};
/* The onboarding setup a template keeps (D12): switches and settings by id, and each policy's text. No file. */
export interface TemplateOnbStep { id: OnbStepId; on: boolean }
export interface TemplateOnbDocument { id: string; req: boolean; verify: Verifier; blocks: boolean; expiry: boolean }
export interface TemplateOnbPolicy { id: string; label: string; ver: string; sum: string; body: string[] }
export interface TemplateOnboarding { steps: TemplateOnbStep[]; documents: TemplateOnbDocument[]; policies: TemplateOnbPolicy[] }
export interface Template {
  name: string; description: string; scope: TemplateScope;
  /* every switch: Workforce core, Timesheet and its capabilities, Rota, Leave, Onboarding */
  modules: Record<string, boolean>;
  flags: Record<string, boolean>;
  /* the settings that hang off a feature (D6); the weekly grid's are the capture layout */
  extras: Partial<FlagExtras>;
  /* field code to the label this tenant reads it by */
  labels: Record<string, string>;
  employeeTypes: TemplateType[];
  roleNames?: Record<RoleKey, string>;
  approvalChain?: ChainStep[];
  structure?: Partial<TemplateStructure>;
  onboarding?: TemplateOnboarding;
}

export const TEMPLATE_SCOPES: readonly { key: TemplateScope; label: string; note: string }[] = [
  { key: 'config', label: 'Configuration only',
    note: 'Modules, features, employee types, labels, the capture layout, the approval chain, role names and the onboarding setup. Nothing about this organisation’s structure or people.' },
  { key: 'structure', label: 'Configuration and structure',
    note: 'The above, plus locations, departments, cost centres, job profiles and contracts. Never its people.' },
];
export const scopeLabel = (s: TemplateScope) => TEMPLATE_SCOPES.find(x => x.key === s)?.label ?? s;

/* ------------------------------------------------------ shipped templates */
type Bit = 0 | 1;
/* A template's switches from the prototype's capability map: Timesheet is
   licensed when it gives any capability (buildConfig), Workforce core always. */
function switches(m: { A: Bit; B: Bit; C: Bit; R: Bit; L: Bit; ON: Bit }): Record<string, boolean> {
  return { CORE: true, TS: Boolean(m.A || m.B || m.C), A: Boolean(m.A), B: Boolean(m.B), C: Boolean(m.C), R: Boolean(m.R), L: Boolean(m.L), ON: Boolean(m.ON) };
}
const bools = (o: Record<string, Bit>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v === 1]));
const ONB: Record<string, Bit> = { ONB_RTW: 1, ONB_CONV: 1, ONB_WTD: 1, ONB_QUAL: 1, ONB_POL: 1, ONB_SIGN: 1, ONB_VERIFY: 1, ONB_PORTAL: 1 };
const type = (code: string, name: string, category: TemplateType['category'], mode: TemplateType['mode'], uom: TemplateType['uom'],
  capabilities: TemplateType['capabilities']): TemplateType => ({ code, name, category, mode, uom, capabilities });
/* dd/mm/yyyy, as the prototype writes a date, to ISO */
const iso = (dmy: string) => { const [d = '', m = '', y = ''] = dmy.split('/'); return dmy ? `${y}-${m}-${d}` : ''; };
const contract = (code: string, name: string, client: string, costCentre: string, manager: string, status: string, start: string, end: string,
  billable: boolean, task: TemplateTask): TemplateContract =>
  /* the prototype points these at sites (SPC, BRD, SQY) it never defines, so they carry no location */
  ({ code, name, client, costCentre, manager, status, start: iso(start), end: iso(end), billable, location: '', tasks: [task] });

export const SHIPPED_TEMPLATES: Readonly<Record<string, Template>> = {
  /* QCIC / Dogma: professional services on Business Central Projects. Its
     8 projects and 85 tasks are the tenant's own export and are seeded with
     the qnipay tenant rather than carried here. */
  qcic: {
    name: 'Professional Services — Projects', scope: 'structure',
    description: 'Consultants booking time to projects and project tasks, with resources mapped to Business Central. Weekly capture, no rota.',
    modules: switches({ A: 1, B: 0, C: 1, R: 0, L: 1, ON: 1 }),
    flags: bools({ ...ONB, AUTO_OT: 0, LATE_FINISH: 0, UNSOCIAL: 0, EMAIL_APPROVAL: 1, SHOW_PAY: 0, VEHICLE: 0, PROJECT: 1, SHIFT: 0,
      BREAKS: 1, DOCS: 1, NOTICES: 1, SELF_EDIT: 1, DAILY: 1, WEEKLY: 1, MULTIWEEK: 1, GPS: 0, GEOFENCE: 0, PATTERNS: 0, MINSTAFF: 0, FULFIL: 0,
      SAFEWORKER: 0, FLEXMON: 0, ITACCESS: 0, RESTRULE: 1, PREFS: 0, LV_ENT: 1, LV_PRORATA: 1, LV_LEAVER: 1, LV_SLA: 1, LV_ROTA: 0, LV_TOIL: 1 }),
    extras: { weekGrid: 'times', weekLayout: 'classic' },
    labels: { project: 'Project', job_task: 'Project task', cost_c: 'Cost centre', site: 'Office' },
    employeeTypes: [type('salaried', 'Project Manager', 'Salaried', 'form', 'day', ['project']), type('hourly', 'Consultant', 'Contracted', 'grid', 'hour', ['project'])],
    structure: {
      locations: [
        { code: 'MCR', name: 'Manchester', area: 'North West', department: 'DEL', costCentre: 'CC-100', level: 'Floating', minPerShift: 1, manager: 'Manish Nepal', address: '', active: true },
        { code: 'REM', name: 'Remote', area: '', department: 'DEL', costCentre: 'CC-100', level: 'Floating', minPerShift: 1, manager: 'Manish Nepal', address: '', active: true }],
      departments: [{ code: 'DEL', name: 'Delivery', manager: 'Manish Nepal' }, { code: 'ADM', name: 'Administration', manager: 'Manish Nepal' }],
      costCentres: [{ code: 'CC-100', name: 'Delivery — Billable' }, { code: 'CC-900', name: 'Internal — Overhead' }],
      jobProfiles: [{ code: 'CONS', name: 'Consultant', night: false }, { code: 'SCONS', name: 'Senior Consultant', night: false },
        { code: 'PM', name: 'Project Manager', night: false }, { code: 'ADM', name: 'Administrator', night: false }],
    },
  },
  /* Fusion III Ltd: M&E contracting. Two-level approval, contract-level
     booking, no rota. Their six rates are pay rules and stay in Business
     Central (D3). */
  mne: {
    name: 'M&E / Building Services', scope: 'structure',
    description: 'Site engineers on contracts, with travel and overtime that follow the day and the hour. Time books to the contract, not to individual tasks.',
    modules: switches({ A: 1, B: 1, C: 1, R: 0, L: 1, ON: 1 }),
    flags: bools({ ...ONB, AUTO_OT: 1, LATE_FINISH: 0, UNSOCIAL: 0, EMAIL_APPROVAL: 1, SHOW_PAY: 0, VEHICLE: 1, PROJECT: 1, SHIFT: 0,
      BREAKS: 1, DOCS: 1, NOTICES: 1, SELF_EDIT: 1, DAILY: 1, WEEKLY: 1, MULTIWEEK: 1, GPS: 0, GEOFENCE: 0, PATTERNS: 0, MINSTAFF: 0, FULFIL: 0,
      SAFEWORKER: 0, FLEXMON: 0, ITACCESS: 0, RESTRULE: 1, PREFS: 0, LV_ENT: 0, LV_PRORATA: 0, LV_LEAVER: 0, LV_SLA: 0, LV_ROTA: 0, LV_TOIL: 0 }),
    extras: { weekGrid: 'times', weekLayout: 'grid' },
    /* their language: a contract, not a project */
    labels: { project: 'Contract', job_task: 'Cost code', cost_c: 'Cost centre', site: 'Site', travel: 'Travel time' },
    employeeTypes: [
      type('driver', 'Site Engineer', 'Contracted', 'clock', 'hour', ['vehicle', 'project', 'site']),
      type('salaried', 'Contracts Manager', 'Salaried', 'form', 'day', ['project']),
      type('hourly', 'Office / Admin', 'Contracted', 'grid', 'hour', ['project'])],
    /* two stages before anything reaches Business Central, and stage 2 applies to every timesheet */
    approvalChain: [
      { module: 'Timesheet', role: 'Line manager', scope: 'All departments', when: 'Every timesheet', sla: '24 hours', fixed: false },
      { module: 'Timesheet', role: 'Payroll', scope: 'All departments', when: 'Every timesheet', sla: '48 hours', fixed: false },
      { module: 'Timesheet', role: 'Business Central', scope: '—', when: 'Posts on final approval', sla: '—', fixed: true },
      { module: 'Profile', role: 'Line manager', scope: 'All departments', when: 'Every contact detail change', sla: '3 days', fixed: false },
      { module: 'Leave', role: 'Line manager', scope: 'All departments', when: 'Every leave request', sla: '5 days', fixed: false }],
    structure: {
      costCentres: [{ code: 'CC-100', name: 'Contracting — Fit-out' }, { code: 'CC-110', name: 'Contracting — Plant & Mechanical' },
        { code: 'CC-120', name: 'Reactive & Maintenance' }, { code: 'CC-900', name: 'Overhead — Internal' }],
      jobProfiles: [{ code: 'ENG', name: 'Site Engineer', night: true }, { code: 'SENG', name: 'Senior Engineer', night: true },
        { code: 'CM', name: 'Contracts Manager', night: false }, { code: 'PAY', name: 'Payroll', night: false }, { code: 'ADM', name: 'Administrator', night: false }],
      /* one task per contract, named as the income cost code: Business Central will not take a job journal line with a blank task */
      contracts: [
        contract('CON-2451', 'Spinnaker Court M&E Fit-out', 'Manchester Waterside Ltd', 'CC-100', 'Ben Lester', 'Active', '06/01/2026', '19/12/2026', true, { name: '4010 · Labour', group: 'Labour', billable: true }),
        contract('CON-2478', 'Broadway Retail — Electrical 2nd Fix', 'Broadway Estates', 'CC-100', 'Ben Lester', 'Active', '02/03/2026', '30/10/2026', true, { name: '4010 · Labour', group: 'Labour', billable: true }),
        contract('CON-2503', 'Salford Quays Plant Room Upgrade', 'Peel L&P', 'CC-110', 'Jack Manifold', 'Active', '11/05/2026', '26/02/2027', true, { name: '4010 · Labour', group: 'Labour', billable: true }),
        contract('CON-2199', 'Reactive / Call-out', 'Various', 'CC-120', 'Jack Manifold', 'Always open', '01/01/2026', '', true, { name: '4020 · Reactive labour', group: 'Labour', billable: true }),
        contract('CON-0001', 'Internal — Training, Yard, Vehicle checks', '', 'CC-900', 'Jack Manifold', 'Always open', '01/01/2026', '', false, { name: '8010 · Internal time', group: 'Overhead', billable: false })],
    },
  },
  /* Brightpath Support Services: rota-based support work across services. */
  social: {
    name: 'Social Care & Charity', scope: 'config',
    description: 'Rota-based support work across services. Sleep-ins, waking nights, on-call standby and time charged to the funder that pays for it.',
    modules: switches({ A: 1, B: 1, C: 1, R: 1, L: 1, ON: 1 }),
    flags: bools({ ...ONB, AUTO_OT: 1, LATE_FINISH: 0, UNSOCIAL: 1, EMAIL_APPROVAL: 1, SHOW_PAY: 0, VEHICLE: 0, PROJECT: 1, SHIFT: 1,
      BREAKS: 1, DOCS: 1, NOTICES: 1, SELF_EDIT: 1, DAILY: 1, WEEKLY: 1, MULTIWEEK: 0, GPS: 0, GEOFENCE: 0, PATTERNS: 1, MINSTAFF: 1, FULFIL: 1,
      SAFEWORKER: 1, FLEXMON: 1, ITACCESS: 1, RESTRULE: 1, PREFS: 1, LV_ENT: 1, LV_PRORATA: 1, LV_LEAVER: 1, LV_SLA: 1, LV_ROTA: 1, LV_TOIL: 1 }),
    extras: { weekGrid: 'times', weekLayout: 'classic' },
    labels: { site: 'Service', shift_code: 'Rota line', project: 'Funded programme', job_task: 'Activity', cost_c: 'Fund / grant code', travel: 'Travel between services' },
    employeeTypes: [
      type('shift', 'Support Worker', 'Contracted', 'clock', 'hour', ['shift', 'site', 'project']),
      type('casual', 'Relief / Bank Worker', 'Bank', 'clock', 'hour', ['shift', 'site']),
      type('salaried', 'Service Manager', 'Salaried', 'grid', 'day', ['project'])],
  },
};
export const SHIPPED_KEYS = Object.keys(SHIPPED_TEMPLATES);
export const isShipped = (key: string) => Object.hasOwn(SHIPPED_TEMPLATES, key);
export const shippedTemplate = (key: string): Template | undefined => (isShipped(key) ? SHIPPED_TEMPLATES[key] : undefined);

/* What a template card lists: its employee types, then the modules it turns on. */
export function templateSummary(t: Template): { types: string[]; modules: string[] } {
  return { types: t.employeeTypes.map(x => x.name), modules: MODULES.filter(m => moduleLive(t.modules, m)).map(m => m.name) };
}

/* -------------------------------------------------------------- refusals */
export const TEMPLATE_NAME_MAX = 80;
export const TEMPLATE_NAME_REQUIRED = 'A template needs a name.';
export const TEMPLATE_NAME_SHIPPED = 'That name matches a template that ships with the app. Choose another.';
export const NOT_A_TEMPLATE: Refusal = { status: 422, code: 'NOT_A_TEMPLATE', message: 'That file is not a Qnipay template.',
  next: 'Choose a file that Qnipay exported as a template.' };
export const UNREADABLE: Refusal = { status: 422, code: 'UNREADABLE', message: 'That file could not be read.',
  next: 'Check it is the JSON file Qnipay exported, then try again.' };
export const NO_SUCH_TEMPLATE: Refusal = { status: 404, code: 'not-found', message: 'That template no longer exists.', next: 'Reload the page.' };
export const SHIPPED_REMOVE: Refusal = { status: 409, code: 'SHIPPED', message: 'A template that ships with the app cannot be removed.',
  next: 'Remove a template saved here instead.' };
export const IN_USE: Refusal = { status: 409, code: 'IN_USE', message: 'This tenant is running on that template.', next: 'Switch to another first.' };
const nameTaken = (name: string): Refusal => ({ status: 409, code: 'NAME_TAKEN', field: 'name',
  message: `A template called ${name} is already here. Nothing is replaced.`, next: 'Choose another name, or remove the one here first.' });

/* tpl_ and the name in lower case, every run of anything else an underscore. */
export const templateKey = (name: string) => `tpl_${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')}`;
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/* tpl-save's checks, and D4's: a name is needed, cannot be a shipped
   template's, and cannot be one already saved here (the prototype replaced
   it silently; here nothing is ever replaced). `saved` is every saved
   template's name. */
export function templateNameProblem(name: string, saved: readonly string[]): Refusal | null {
  const v = name.trim();
  if (!v) return { status: 422, code: 'invalid', field: 'name', message: TEMPLATE_NAME_REQUIRED, next: 'Give it a name, then save.' };
  if (v.length > TEMPLATE_NAME_MAX) return { status: 422, code: 'invalid', field: 'name', message: `A template name can be at most ${TEMPLATE_NAME_MAX} characters.`, next: 'Shorten the name, then save.' };
  const key = templateKey(v);
  if (Object.entries(SHIPPED_TEMPLATES).some(([k, t]) => same(t.name, v) || same(k, v) || templateKey(t.name) === key))
    return { status: 409, code: 'NAME_TAKEN', field: 'name', message: TEMPLATE_NAME_SHIPPED, next: 'Choose another name.' };
  if (saved.some(s => same(s, v) || templateKey(s) === key)) return nameTaken(v);
  return null;
}

/* tpl-delete: a shipped template stays, and so does the one this tenant runs on. */
export function removeProblem(key: string, exists: boolean, inUse: string): Refusal | null {
  if (isShipped(key)) return SHIPPED_REMOVE;
  if (!exists) return NO_SUCH_TEMPLATE;
  if (key === inUse) return IN_USE;
  return null;
}

/* ---------------------------------------------------------------- capture */
export interface CaptureSource {
  modules: Readonly<Record<string, boolean>>; flags: Readonly<Record<string, boolean>>; extras: FlagExtras;
  labels: Readonly<Record<string, string>>; defaultLabels: Readonly<Record<string, string>>;
  employeeTypes: readonly TemplateType[]; roleNames: Record<RoleKey, string>;
  /* every module's approval chain, in module order */
  chain: readonly ChainStep[];
  structure: TemplateStructure;
  /* the onboarding setup and its policies, when this tenant has them */
  onboarding?: { config: OnboardingConfig; policies: readonly OnbPolicy[] };
}
/* The onboarding part (D12): the prototype's onbDocs and onbPolicies, with the step switches. */
export function captureOnboarding(o: { config: OnboardingConfig; policies: readonly OnbPolicy[] }): TemplateOnboarding {
  return {
    steps: o.config.steps.map(x => ({ id: x.id, on: x.on })),
    documents: o.config.documents.map(d => ({ id: d.id, req: d.req, verify: d.verify, blocks: d.blocks, expiry: d.expiry })),
    policies: o.policies.map(p => ({ id: p.id, label: p.label, ver: p.ver, sum: p.sum, body: [...p.body] })),
  };
}
/* captureTemplate: what the tenant has decided, not what it contains. Labels
   are kept where they differ from the field's own name. The structure scope
   adds the five dimensions; people are never kept (D2). */
export function captureTemplate(name: string, description: string, scope: TemplateScope, src: CaptureSource): Template {
  const t: Template = {
    name: name.trim(), description: description.trim(), scope,
    modules: Object.fromEntries(SWITCH_CODES.map(c => [c, src.modules[c] === true])),
    flags: Object.fromEntries(FLAGS.map(f => [f.code, src.flags[f.code] === true])),
    extras: { ...src.extras },
    labels: Object.fromEntries(Object.entries(src.labels).filter(([c, l]) => l !== src.defaultLabels[c])),
    employeeTypes: src.employeeTypes.map(x => ({ code: x.code, name: x.name, category: x.category, mode: x.mode, uom: x.uom, capabilities: [...x.capabilities] })),
    roleNames: { ...src.roleNames },
    approvalChain: src.chain.map(x => ({ ...x })),
  };
  if (src.onboarding) t.onboarding = captureOnboarding(src.onboarding);
  if (scope === 'structure') t.structure = structuredClone(src.structure);
  return t;
}

/* ------------------------------------------------------------- the file */
export interface TemplateFile { kind: 'qnipay.template'; v: 1; key: string; template: Template }
export const templateFile = (key: string, template: Template): TemplateFile => ({ kind: 'qnipay.template', v: 1, key, template });
export const templateFileName = (key: string) => `qnipay-template-${key}.json`;

/* The keys a template may hold, at each level. Anything else in a file is
   left out and listed (D3): the prototype's company details, pay codes, pay
   rules, allowances and roster among them. */
const TOP = ['name', 'description', 'scope', 'modules', 'flags', 'extras', 'labels', 'employeeTypes', 'roleNames', 'approvalChain', 'structure', 'onboarding'];
const EXTRA_KEYS = ['weekGrid', 'weekLayout', 'breaksMax', 'vehiclesMax'];
const ROW_KEYS: Record<string, readonly string[]> = {
  employeeTypes: ['code', 'name', 'category', 'mode', 'uom', 'capabilities'],
  approvalChain: ['module', 'role', 'scope', 'when', 'sla', 'fixed'],
  departments: ['code', 'name', 'manager'], costCentres: ['code', 'name'], jobProfiles: ['code', 'name', 'night'],
  locations: ['code', 'name', 'area', 'department', 'costCentre', 'level', 'minPerShift', 'manager', 'address', 'active'],
  contracts: ['code', 'name', 'client', 'costCentre', 'manager', 'status', 'start', 'end', 'billable', 'location', 'tasks'],
  tasks: ['name', 'group', 'billable'],
  onbSteps: ['id', 'on'], onbDocuments: ['id', 'req', 'verify', 'blocks', 'expiry'], onbPolicies: ['id', 'label', 'ver', 'sum', 'body'],
};
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export type FileRead = { ok: false; refusal: Refusal } | { ok: true; template: Record<string, unknown>; ignored: string[] };
/* tpl-import, before the shape is checked: the text must be JSON, must say it
   is a Qnipay template, and keeps only what a template may hold. The
   structure goes when the template says it keeps configuration only. */
export function readTemplateFile(text: string): FileRead {
  let o: unknown;
  try { o = JSON.parse(text); } catch { return { ok: false, refusal: UNREADABLE }; }
  if (!isObj(o) || o.kind !== 'qnipay.template' || !isObj(o.template)) return { ok: false, refusal: NOT_A_TEMPLATE };
  const ignored = new Set<string>();
  const keep = (obj: Record<string, unknown>, allowed: readonly string[], path: string) =>
    Object.fromEntries(Object.entries(obj).filter(([k]) => {
      if (allowed.includes(k)) return true;
      ignored.add(path ? `${path}.${k}` : k);
      return false;
    }));
  const rows = (v: unknown, kind: string, path: string) => (Array.isArray(v)
    ? v.map(r => {
      if (!isObj(r)) return r;
      const row = keep(r, ROW_KEYS[kind] ?? [], path);
      if (kind === 'contracts' && Array.isArray(row.tasks)) row.tasks = rows(row.tasks, 'tasks', `${path}.tasks`);
      return row;
    })
    : v);
  const t = keep(o.template, TOP, '');
  if (isObj(t.modules)) t.modules = keep(t.modules, SWITCH_CODES, 'modules');
  if (isObj(t.flags)) t.flags = keep(t.flags, FLAGS.map(f => f.code), 'flags');
  if (isObj(t.extras)) t.extras = keep(t.extras, EXTRA_KEYS, 'extras');
  if (isObj(t.roleNames)) t.roleNames = keep(t.roleNames, ROLE_KEYS, 'roleNames');
  if ('employeeTypes' in t) t.employeeTypes = rows(t.employeeTypes, 'employeeTypes', 'employeeTypes');
  if ('approvalChain' in t) t.approvalChain = rows(t.approvalChain, 'approvalChain', 'approvalChain');
  /* a policy's file is never part of a template: it is left out and listed */
  if (isObj(t.onboarding)) {
    const o = keep(t.onboarding, ['steps', 'documents', 'policies'], 'onboarding');
    if ('steps' in o) o.steps = rows(o.steps, 'onbSteps', 'onboarding.steps');
    if ('documents' in o) o.documents = rows(o.documents, 'onbDocuments', 'onboarding.documents');
    if ('policies' in o) o.policies = rows(o.policies, 'onbPolicies', 'onboarding.policies');
    t.onboarding = o;
  }
  if (isObj(t.structure)) {
    if (t.scope !== 'structure') { ignored.add('structure'); delete t.structure; }
    else {
      const s = keep(t.structure, STRUCTURE_KINDS, 'structure');
      for (const k of STRUCTURE_KINDS) if (k in s) s[k] = rows(s[k], k, `structure.${k}`);
      t.structure = s;
    }
  }
  return { ok: true, template: t, ignored: [...ignored].sort() };
}
/* A file's role names, checked together as the Rename roles dialog checks them. */
export function roleNamesProblem(names: Readonly<Record<RoleKey, string>>): string | null {
  for (const [i, k] of ROLE_KEYS.entries()) {
    const p = roleNameProblem(names[k], ROLE_KEYS.slice(0, i).map(o => names[o]));
    if (p) return p.message;
  }
  return null;
}

/* ------------------------------------------------------------ the plan */
export interface TenantState {
  name: string; people: number;
  modules: Readonly<Record<string, boolean>>; restore: Readonly<Record<string, string[]>>; flags: Readonly<Record<string, boolean>>;
  extras: FlagExtras;
  /* field code to the label it reads by now; a field not here is not on this tenant */
  labels: Readonly<Record<string, string>>;
  employeeTypes: readonly TemplateType[];
  roleNames: Record<RoleKey, string>;
  /* each module's approval chain now */
  chains: Readonly<Record<ChainModule, readonly ChainStep[]>>;
  /* the codes already held, per kind */
  structure: Readonly<Record<StructureKind, readonly string[]>>;
  /* the onboarding setup and its policies now, when this tenant has them */
  onboarding?: { config: OnboardingConfig; policies: readonly OnbPolicy[] };
}
export type PlanArea = 'modules' | 'features' | 'labels' | 'types' | 'roles' | 'chain' | 'structure' | 'people' | 'organisation' | 'onboarding';
export interface PlanLine { area: PlanArea; text: string }
export interface ApplySteps {
  /* module switches in the order they run, and where they leave the tenant */
  modules: { code: string; on: boolean }[]; finalModules: Record<string, boolean>; finalRestore: Record<string, string[]>;
  /* feature switches and extras, each one switchFlag accepts against the final modules */
  flags: { code: string; change: FlagChange }[];
  labels: Record<string, string>;
  typesAdded: TemplateType[]; typesUpdated: { code: string; change: Partial<Omit<TemplateType, 'code'>> }[];
  roleNames: Partial<Record<RoleKey, string>>;
  /* the chains to set, each whole */
  chains: { module: ChainModule; steps: ChainStep[] }[];
  structure: TemplateStructure;
  /* the onboarding switches and settings to set by id, the held policies whose wording changes, and the policies added */
  onboarding: {
    steps: Record<string, boolean>; documents: Record<string, Omit<TemplateOnbDocument, 'id'>>;
    policiesUpdated: Pick<TemplateOnbPolicy, 'id' | 'label' | 'sum' | 'body'>[]; policiesAdded: TemplateOnbPolicy[];
  };
}
export interface ApplyPlan { changes: PlanLine[]; added: PlanLine[]; leftAlone: PlanLine[]; steps: ApplySteps }

const list = (xs: readonly string[]) => xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1] ?? ''}`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const TYPE_FIELDS = ['name', 'category', 'mode', 'uom', 'capabilities'] as const;
const TYPE_FIELD_WORD: Record<(typeof TYPE_FIELDS)[number], string> = { name: 'name', category: 'category', mode: 'entry mode', uom: 'pay basis', capabilities: 'capabilities' };
const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every(x => b.includes(x));
const gridWords = (k: string) => WEEK_GRIDS.find(([v]) => v === k)?.[1] ?? k;
const layoutWords = (k: string) => (WEEK_LAYOUTS.find(([v]) => v === k)?.[1] ?? k).split(' · ')[0] ?? k;

/* whether the template says anything about this switch */
const says = (t: Template, code: string) => Object.hasOwn(t.modules, code);
/* Module switches in an order switchModule accepts: the plain modules, then
   Timesheet, then (while Timesheet is on) its capabilities. */
function moduleSteps(t: Template, s: TenantState) {
  let st: ModuleState = { modules: { ...s.modules }, restore: { ...s.restore } };
  const steps: { code: string; on: boolean }[] = [];
  const run = (code: string, on: boolean) => {
    const r = switchModule(st, code, on);
    if (r.ok && r.changed) { st = { modules: r.modules, restore: r.restore }; steps.push({ code, on }); }
  };
  const target = (c: string) => t.modules[c] === true;
  for (const m of MODULES) if (!m.locked && !m.master && says(t, m.code)) run(m.code, target(m.code));
  const ts = MODULES.find(m => m.master);
  if (ts && says(t, ts.code)) {
    if (target(ts.code)) {
      run(ts.code, true);
      for (const sub of ts.subs ?? []) if (says(t, sub)) run(sub, target(sub));
    } else run(ts.code, false);
  }
  return { steps, modules: st.modules, restore: st.restore };
}

/* applyTemplate, as D1 has it: what changes, what is added, and what is left
   alone. Nothing here deletes or overwrites a person or a structure record,
   or renames the organisation; employee types the template does not have
   stay with the people who hold them. `mayRenameRoles` is false when the
   caller lacks Permissions configuration: role names are then left alone.
   `mayChangeChains` is false without the approval framework: the chains are
   then left alone. `mayChangeTypes` is false without Employee types and
   configuration: employee types are then left alone (Sites off still takes the
   site capability away, as the module switch does). */
export const TYPES_LEFT_ALONE = 'Employee types stay as they are. Changing them needs Employee types and configuration.';
export function planApply(t: Template, s: TenantState,
  opts: { mayRenameRoles: boolean; mayChangeChains: boolean; mayChangeTypes: boolean; mayChangeOnboarding?: boolean }): ApplyPlan {
  const changes: PlanLine[] = [], added: PlanLine[] = [], leftAlone: PlanLine[] = [];
  const steps: ApplySteps = { modules: [], finalModules: {}, finalRestore: {}, flags: [], labels: {}, typesAdded: [], typesUpdated: [], roleNames: {}, chains: [],
    structure: { departments: [], costCentres: [], locations: [], jobProfiles: [], contracts: [] },
    onboarding: { steps: {}, documents: {}, policiesUpdated: [], policiesAdded: [] } };

  /* modules */
  const mods = moduleSteps(t, s);
  steps.modules = mods.steps; steps.finalModules = mods.modules; steps.finalRestore = mods.restore;
  for (const m of mods.steps) changes.push({ area: 'modules', text: m.code === 'R' && !m.on
    ? 'Rota off. Its scheduled shifts are set aside, not deleted, and come back when Rota is turned on.'
    : `${subName(m.code)} ${m.on ? 'on' : 'off'}.` });

  /* features, then their extras, through switchFlag against the final modules */
  const flags: Record<string, boolean> = { ...s.flags };
  const offModule: string[] = [];
  for (const f of FLAGS) {
    if (!Object.hasOwn(t.flags, f.code)) continue;
    const want = t.flags[f.code] === true;
    if (Boolean(flags[f.code]) === want) continue;
    const r = switchFlag(mods.modules, flags, f.code, { on: want });
    if (!r.ok) { offModule.push(f.label); continue; }
    flags[f.code] = want;
    steps.flags.push({ code: f.code, change: { on: want } });
    changes.push({ area: 'features', text: `${f.label} ${want ? 'on' : 'off'}.` });
  }
  if (offModule.length) leftAlone.push({ area: 'features', text: `Features of a module that is off stay as they are: ${list(offModule)}.` });
  for (const [owner, keys] of Object.entries(FLAG_EXTRAS)) {
    const change: FlagChange = {};
    for (const k of keys) {
      const v = t.extras[k];
      if (v !== undefined && v !== s.extras[k]) Object.assign(change, { [k]: v });
    }
    if (!Object.keys(change).length) continue;
    const f = flagBy(owner);
    const r = switchFlag(mods.modules, flags, owner, change);
    if (!r.ok || !f) { leftAlone.push({ area: 'features', text: `${f?.label ?? owner} settings stay as they are. ${r.ok ? '' : r.refusal.message}`.trim() }); continue; }
    steps.flags.push({ code: owner, change });
    if (change.weekGrid) changes.push({ area: 'features', text: `Weekly grid: ${gridWords(change.weekGrid).toLowerCase()}.` });
    if (change.weekLayout) changes.push({ area: 'features', text: `Weekly view: ${layoutWords(change.weekLayout).toLowerCase()}.` });
    if (change.breaksMax !== undefined) changes.push({ area: 'features', text: `Breaks per entry: ${change.breaksMax}.` });
    if (change.vehiclesMax !== undefined) changes.push({ area: 'features', text: `Vehicles per entry: ${change.vehiclesMax}.` });
  }

  /* labels */
  const unknownFields: string[] = [];
  for (const [code, label] of Object.entries(t.labels)) {
    const now = Object.hasOwn(s.labels, code) ? s.labels[code] : undefined;
    if (now === undefined) { unknownFields.push(code); continue; }
    if (now === label) continue;
    steps.labels[code] = label;
    changes.push({ area: 'labels', text: `${now} reads as ${label}.` });
  }
  if (unknownFields.length) leftAlone.push({ area: 'labels', text: `Labels for fields this tenant does not have are not used: ${list(unknownFields)}.` });

  /* employee types: set or added, never removed. Sites off leaves no type with the site capability. */
  const sitesOn = mods.modules.C === true;
  const typeAdds: ApplySteps['typesAdded'] = [], typeUpdates: ApplySteps['typesUpdated'] = [], typeAdded: PlanLine[] = [], typeChanges: PlanLine[] = [];
  for (const want of t.employeeTypes) {
    const caps = sitesOn ? want.capabilities : want.capabilities.filter(x => x !== 'site');
    const have = s.employeeTypes.find(x => x.code === want.code);
    if (!have) {
      typeAdds.push({ ...want, capabilities: caps });
      typeAdded.push({ area: 'types', text: `Employee type ${want.name} (${want.code}).` });
      continue;
    }
    const next = { ...want, capabilities: caps };
    const diff = TYPE_FIELDS.filter(k => (k === 'capabilities' ? !sameSet(have.capabilities, next.capabilities) : have[k] !== next[k]));
    if (!diff.length) continue;
    typeUpdates.push({ code: want.code, change: Object.fromEntries(diff.map(k => [k, next[k]])) });
    typeChanges.push({ area: 'types', text: diff.includes('name')
      ? `Employee type ${have.name} becomes ${next.name}${diff.length > 1 ? `, with a new ${list(diff.filter(k => k !== 'name').map(k => TYPE_FIELD_WORD[k]))}` : ''}.`
      : `Employee type ${have.name}: new ${list(diff.map(k => TYPE_FIELD_WORD[k]))}.` });
  }
  if (!opts.mayChangeTypes && (typeAdds.length || typeUpdates.length)) leftAlone.push({ area: 'types', text: TYPES_LEFT_ALONE });
  else if (opts.mayChangeTypes) {
    steps.typesAdded = typeAdds; steps.typesUpdated = typeUpdates;
    added.push(...typeAdded); changes.push(...typeChanges);
  }
  const kept = s.employeeTypes.filter(x => !t.employeeTypes.some(w => w.code === x.code)).map(x => x.name);
  if (kept.length) leftAlone.push({ area: 'types', text: `Employee types the template does not have stay, with everyone who holds them: ${list(kept)}.` });

  /* role names: all three or none, checked together */
  const names = t.roleNames;
  if (names) {
    const renamed = ROLE_KEYS.filter(k => names[k].trim() !== s.roleNames[k]);
    const problem = roleNamesProblem(names);
    if (renamed.length && !opts.mayRenameRoles) leftAlone.push({ area: 'roles', text: 'Role names stay as they are. Renaming roles needs Permissions configuration.' });
    else if (renamed.length && problem) leftAlone.push({ area: 'roles', text: `Role names stay as they are. ${problem}` });
    else for (const k of renamed) {
      const v = names[k].trim();
      steps.roleNames[k] = v;
      changes.push({ area: 'roles', text: `The ${s.roleNames[k]} role is called ${v}.` });
    }
  }

  /* approval chains: each module the template has, set whole once it passes the Approvals page's checks */
  planChains(t, s, opts.mayChangeChains, changes, leftAlone, steps);

  /* onboarding setup (D12): against the modules and features the template leaves the tenant with */
  planOnboarding(t, s, opts.mayChangeOnboarding === true, onbFeatures(mods.modules, flags), { changes, added, leftAlone }, steps);

  /* structure: new codes are added, held codes stay exactly as they are */
  const held = Object.fromEntries(STRUCTURE_KINDS.map(k => [k, new Set(s.structure[k].map(x => x.toUpperCase()))])) as Record<StructureKind, Set<string>>;
  const has = (k: StructureKind, code: string) => !code || held[k].has(code.toUpperCase());
  for (const kind of STRUCTURE_KINDS) {
    const rows = t.structure?.[kind] ?? [];
    const stay: string[] = [];
    for (const row of rows) {
      if (held[kind].has(row.code.toUpperCase())) { stay.push(row.code); continue; }
      const next = structuredClone(row) as typeof row & Record<string, unknown>;
      const missing: string[] = [];
      const ref = (field: 'department' | 'costCentre' | 'location', k: StructureKind) => {
        const v = next[field];
        if (typeof v === 'string' && !has(k, v)) { missing.push(`${STRUCTURE_LABEL[k].one} ${v}`); next[field] = ''; }
      };
      if (kind === 'locations') { ref('department', 'departments'); ref('costCentre', 'costCentres'); }
      if (kind === 'contracts') { ref('costCentre', 'costCentres'); ref('location', 'locations'); }
      (steps.structure[kind] as (typeof row)[]).push(next);
      held[kind].add(row.code.toUpperCase());
      added.push({ area: 'structure', text: `${STRUCTURE_LABEL[kind].one[0]?.toUpperCase() ?? ''}${STRUCTURE_LABEL[kind].one.slice(1)} ${row.code} ${row.name}${missing.length ? `, without the ${list(missing)}, which is not here` : ''}.` });
    }
    if (stay.length) leftAlone.push({ area: 'structure', text: `${STRUCTURE_LABEL[kind].many} already here stay exactly as they are: ${list(stay)}.` });
  }

  leftAlone.push({ area: 'people', text: `Nobody’s record changes. ${plural(s.people, 'person', 'people')} keep their details and their employee type.` });
  leftAlone.push({ area: 'organisation', text: `${s.name} keeps its name, company details, compliance and pay periods.` });
  return { changes, added, leftAlone, steps };
}
/* A template's chain, per module. A posting step written before the
   Approvals page existed (a blank scope and SLA) reads as the posting step. */
function chainsOf(t: Template): { known: Map<ChainModule, ChainStep[]>; unknown: string[] } {
  const known = new Map<ChainModule, ChainStep[]>(), unknown: string[] = [];
  for (const x of t.approvalChain ?? []) {
    if (!isChainModule(x.module)) { if (!unknown.includes(x.module)) unknown.push(x.module); continue; }
    const step = x.fixed && x.role === POSTING_ROLE && x.module === 'Timesheet' ? { ...POSTING_STEP } : { ...x };
    known.set(x.module, [...(known.get(x.module) ?? []), step]);
  }
  return { known, unknown };
}
const sameChain = (a: readonly ChainStep[], b: readonly ChainStep[]) => a.length === b.length &&
  a.every((x, i) => { const y = b[i]; return y !== undefined && x.role === y.role && x.scope === y.scope && x.when === y.when && x.sla === y.sla && x.fixed === y.fixed; });
function planChains(t: Template, s: TenantState, may: boolean, changes: PlanLine[], leftAlone: PlanLine[], steps: ApplySteps) {
  if (!t.approvalChain?.length) return;
  const { known, unknown } = chainsOf(t);
  const differ = CHAIN_MODULES.filter(m => known.has(m) && !sameChain(known.get(m) ?? [], s.chains[m]));
  if (differ.length && !may) { leftAlone.push({ area: 'chain', text: 'Approval chains stay as they are. Changing them needs the approval framework.' }); return; }
  for (const m of differ) {
    const want = known.get(m) ?? [];
    const problem = chainProblem(m, want);
    if (problem) { leftAlone.push({ area: 'chain', text: `The ${m} approval chain stays as it is. ${problem.message}` }); continue; }
    steps.chains.push({ module: m, steps: want });
    changes.push({ area: 'chain', text: `${m} approval chain: ${chainText(want)}` });
  }
  const without = CHAIN_MODULES.filter(m => !known.has(m));
  if (without.length) leftAlone.push({ area: 'chain', text: `Approval chains the template does not have stay as they are: ${list(without)}.` });
  if (unknown.length) leftAlone.push({ area: 'chain', text: `Approval chains for modules this tenant does not have are not used: ${list(unknown)}.` });
}

/* The onboarding part of a plan (D12). Steps and documents are matched by
   id and only their switches and settings change; a step goes on only while
   its features are on, and a fixed step stays on, as Onboarding setup
   refuses. Policies are matched by id: a held one takes the template's name,
   summary and text but keeps its version and its acknowledgements; one not
   here is added without a document; the tenant's others stay. */
export const ONB_LEFT_ALONE = 'Onboarding setup stays as it is. Changing it needs Configure onboarding.';
type DocSettings = Omit<TemplateOnbDocument, 'id'>;
const docWords = (d: DocSettings, was: DocSettings) => [
  d.req !== was.req ? (d.req ? 'required' : 'not required') : '',
  d.verify !== was.verify ? (d.verify === 'none' ? 'no check needed' : `checked by ${verifierLabel(d.verify).replace(/^Line/, 'line')}`) : '',
  d.blocks !== was.blocks ? (d.blocks ? 'blocks the start' : 'does not block the start') : '',
  d.expiry !== was.expiry ? (d.expiry ? 'expiry tracked' : 'expiry not tracked') : '',
].filter(Boolean);
const sameText = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
function planOnboarding(t: Template, s: TenantState, may: boolean, f: ReturnType<typeof onbFeatures>,
  out: { changes: PlanLine[]; added: PlanLine[]; leftAlone: PlanLine[] }, steps: ApplySteps) {
  const want = t.onboarding, have = s.onboarding;
  if (!want || !have) return;
  const changes: PlanLine[] = [], added: PlanLine[] = [], leftAlone: PlanLine[] = [];
  const next: ApplySteps['onboarding'] = { steps: {}, documents: {}, policiesUpdated: [], policiesAdded: [] };
  const line = (text: string): PlanLine => ({ area: 'onboarding', text });

  const unknownSteps: string[] = [];
  for (const w of want.steps) {
    const h = have.config.steps.find(x => x.id === w.id);
    if (!h) { unknownSteps.push(w.id); continue; }
    if (h.on === w.on || (h.fixed && w.on)) continue;
    const problem = stepSwitchProblem(h, w.on, f);
    if (problem) {
      leftAlone.push(line(`Onboarding step ${h.label} stays ${h.on ? 'on' : 'off'}. ${problem.code === 'FLAG_OFF' ? STEP_UNAVAILABLE : problem.message}`));
      continue;
    }
    next.steps[h.id] = w.on;
    changes.push(line(`Onboarding step ${h.label} ${w.on ? 'on' : 'off'}.`));
  }
  if (unknownSteps.length) leftAlone.push(line(`Onboarding steps this tenant does not have are not used: ${list(unknownSteps)}.`));

  const unknownDocs: string[] = [];
  for (const w of want.documents) {
    const h = have.config.documents.find(x => x.id === w.id);
    if (!h) { unknownDocs.push(w.id); continue; }
    if (!isVerifier(w.verify)) continue;
    const d: DocSettings = { req: w.req, verify: w.verify, blocks: w.blocks, expiry: w.expiry };
    const words = docWords(d, h);
    if (!words.length) continue;
    next.documents[h.id] = d;
    changes.push(line(`Onboarding document ${h.label}: ${list(words)}.`));
  }
  if (unknownDocs.length) leftAlone.push(line(`Onboarding documents this tenant does not have are not used: ${list(unknownDocs)}.`));

  /* the names a policy is checked against, as each one is renamed or added */
  const names: OnbPolicy[] = have.policies.map(p => ({ ...p }));
  for (const w of want.policies) {
    const label = w.label.trim();
    const h = have.policies.find(x => x.id === w.id);
    if (h) {
      if (h.label === label && h.sum === w.sum && sameText(h.body, w.body)) continue;
      const problem = policyProblem({ label }, names, h.id);
      if (problem) { leftAlone.push(line(`Policy ${h.label} stays as it is. ${problem.message}`)); continue; }
      next.policiesUpdated.push({ id: h.id, label, sum: w.sum, body: [...w.body] });
      const i = names.findIndex(x => x.id === h.id);
      if (i >= 0) names[i] = { ...h, label };
      changes.push(line(`Policy ${h.label}${label !== h.label ? ` becomes ${label}` : ''}, with the template's wording. It stays ${h.ver}, so nobody is asked to read it again.`));
      continue;
    }
    const problem = policyProblem({ label }, names);
    if (problem) { leftAlone.push(line(`Policy ${label || w.id} is not added. ${problem.message}`)); continue; }
    const p: TemplateOnbPolicy = { ...w, label, body: [...w.body] };
    next.policiesAdded.push(p);
    names.push({ ...p, order: names.length });
    added.push(line(`Policy ${p.label} ${p.ver}, without a document. Upload one in Onboarding setup.`));
  }
  const kept = have.policies.filter(p => !want.policies.some(w => w.id === p.id)).map(p => p.label);

  if ((changes.length || added.length) && !may) { out.leftAlone.push(line(ONB_LEFT_ALONE)); return; }
  steps.onboarding = next;
  out.changes.push(...changes); out.added.push(...added); out.leftAlone.push(...leftAlone);
  if (kept.length) out.leftAlone.push(line(`Policies the template does not have stay, with their acknowledgements: ${list(kept)}.`));
  out.leftAlone.push(line('Uploaded policy documents and everybody’s onboarding progress stay as they are.'));
}

/* One line for the toast and the audit row. */
export function planSummary(p: Pick<ApplyPlan, 'changes' | 'added'>): string {
  const parts = [p.changes.length ? plural(p.changes.length, 'change') : '', p.added.length ? `${p.added.length} added` : ''].filter(Boolean);
  return parts.length ? `${parts.join(', ')}. Nothing was deleted.` : 'Nothing needed to change. Nothing was deleted.';
}
