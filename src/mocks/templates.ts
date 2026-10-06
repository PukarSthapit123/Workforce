/* 1c group 3: templates (D1-D4). Every rule is src/domain/templates.ts's; the
   handlers build its inputs from the store and write its outputs, each to
   the setting's own home: modules and features on the tenant through the
   group 1 rules (switchModule, switchFlag, with Rota's shifts set aside and
   Sites' capability taken off as a switch does), labels and the weekly grid
   on timesheetConfig, employee types on employeeTypes, role names on
   userTypes, structure in its five collections, and the onboarding setup on
   onboardingConfig and onboardingPolicies (module 5, D12). One audit row per
   request; a refusal or a fault writes nothing, because serve() restores the
   store. Saved and imported templates are kept in `templates`. */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor, requireCapability } from './auth';
import { writeAudit } from './audit';
import { people, recordAt } from './world';
import { rotaActor, rotaOff, rotaOn, saveTenant, sitesOff, tenantRec, tsConfig, view, type StoredTenant } from './tenant';
import meta from './seed/meta.json';
import { chainRecord, chainsNow, writeChain } from './approvals';
import { policiesColl, policiesNow, type StoredConfig } from './onboarding-cases';
import { CHAIN_MODULES, type ChainModule, type ChainStep } from '@/domain/approvals';
import {
  Template as TemplateSchema, applyTemplate, exportTemplate, getTemplatePlan, importTemplate, listTemplates, removeTemplate, saveTemplate,
  type TemplatePlan, type TemplateRow,
} from '@/contract/templates';
import type { TimesheetConfig } from '@/contract/timesheets';
import type { EmployeeType } from '@/contract/employee-types';
import type { UserType } from '@/contract/access';
import { notRestoredText, type Refusal as DomainRefusal } from '@/domain/modules';
import type { RotaActor } from '@/domain/rota';
import {
  NOT_A_TEMPLATE, NO_SUCH_TEMPLATE, ROLE_KEYS, SHIPPED_KEYS, STRUCTURE_KINDS, captureTemplate, isShipped, planApply, planSummary, readTemplateFile,
  removeProblem, roleNamesProblem, shippedTemplate, templateFile, templateKey, templateNameProblem, templateSummary,
  type ApplyPlan, type RoleKey, type StructureKind, type Template, type TemplateStructure, type TemplateType, type TenantState,
} from '@/domain/templates';

interface Meta { id: string; version: number; updatedAt: string }
interface Saved extends Meta {
  key: string; source: 'saved' | 'imported'; savedAt: string; savedBy: string; from: string; template: Template;
}
interface Row extends Meta { code: string; name: string }
interface Task extends Meta { projectCode: string; name: string; group: string; billable: boolean }

const COLL = 'templates';
const saved = () => store.coll<Saved>(COLL);
const refuseWith = (r: DomainRefusal): never =>
  refuse(r.status, { code: r.code, message: r.message, next: r.next, ...(r.field ? { field: r.field } : {}) });
/* The store's collection and the id prefix for each kind of structure. */
const HOME: Readonly<Record<StructureKind, { coll: string; prefix: string }>> = {
  departments: { coll: 'departments', prefix: 'dep' }, costCentres: { coll: 'costCentres', prefix: 'cc' }, locations: { coll: 'locations', prefix: 'loc' },
  jobProfiles: { coll: 'jobProfiles', prefix: 'job' }, contracts: { coll: 'projects', prefix: 'prj' },
};
const DEFAULT_LABELS: Record<string, string> = Object.fromEntries(meta.timesheetFields.map(f => [f.c, f.label]));
const strip = <T extends Meta>(r: T) => { const { id: _i, version: _v, updatedAt: _u, ...rest } = r; void _i; void _v; void _u; return rest; };

function templateAt(key: string): Template {
  return shippedTemplate(key) ?? recordAt(saved(), key)?.template ?? refuseWith(NO_SUCH_TEMPLATE);
}
function rowOf(key: string, t: Template, inUse: string, s?: Saved): TemplateRow {
  const sum = templateSummary(t);
  return { key, name: t.name, description: t.description, scope: t.scope, source: s?.source ?? 'shipped', inUse: key === inUse, types: sum.types, modules: sum.modules,
    savedAt: s?.savedAt ?? null, savedBy: s?.savedBy ?? null, from: s?.from ?? null, version: s?.version ?? null };
}
/* Structure needs Workforce master data, as every other structure write does (D4). */
const hasStructure = (t: Template) => t.scope === 'structure' && STRUCTURE_KINDS.some(k => (t.structure?.[k]?.length ?? 0) > 0);

/* ----------------------------------------------------- the tenant, read */
const labelsNow = (): Record<string, string> =>
  Object.fromEntries(Object.entries(tsConfig()?.fieldDefaults ?? {}).map(([c, f]) => [c, f.label]));
const typesNow = (): TemplateType[] => Object.values(store.coll<EmployeeType>('employeeTypes'))
  .map(t => ({ code: t.code, name: t.name, category: t.category, mode: t.mode, uom: t.uom, capabilities: [...t.capabilities] }));
function roleNamesNow(): Record<RoleKey, string> {
  const types = store.coll<UserType>('userTypes');
  return Object.fromEntries(ROLE_KEYS.map(k => [k, recordAt(types, k)?.name ?? k])) as Record<RoleKey, string>;
}
/* the onboarding setup and its policies, when this tenant has them (D12) */
function onboardingNow(): TenantState['onboarding'] {
  const config = recordAt(store.coll<StoredConfig>('onboardingConfig'), 'onboardingConfig');
  return config ? { config, policies: policiesNow() } : undefined;
}
const codes = (kind: StructureKind) => Object.values(store.coll<Row>(HOME[kind].coll)).map(r => r.code);
function stateOf(t: StoredTenant): TenantState {
  const v = view(t);
  return {
    name: t.name, people: Object.keys(people()).length, modules: t.modules, restore: t.restore ?? {}, flags: v.flags,
    extras: v.extras, labels: labelsNow(), employeeTypes: typesNow(), roleNames: roleNamesNow(),
    chains: Object.fromEntries(CHAIN_MODULES.map(m => [m, chainRecord(m).steps])) as Record<ChainModule, ChainStep[]>,
    structure: Object.fromEntries(STRUCTURE_KINDS.map(k => [k, codes(k)])) as Record<StructureKind, string[]>,
    onboarding: onboardingNow(),
  };
}
function structureNow(): TemplateStructure {
  const rows = <T,>(kind: StructureKind) => Object.values(store.coll<Row>(HOME[kind].coll)).sort((a, b) => a.code.localeCompare(b.code)).map(r => strip(r) as T);
  const tasks = Object.values(store.coll<Task>('projectTasks'));
  return {
    departments: rows('departments'), costCentres: rows('costCentres'), locations: rows('locations'), jobProfiles: rows('jobProfiles'),
    contracts: Object.values(store.coll<Row & Record<string, unknown>>('projects')).sort((a, b) => a.code.localeCompare(b.code)).map(p => ({
      code: p.code, name: p.name, client: String(p.client ?? ''), costCentre: String(p.costCentre ?? ''), manager: String(p.manager ?? ''),
      status: String(p.status ?? ''), start: String(p.start ?? ''), end: String(p.end ?? ''), billable: p.billable === true, location: String(p.location ?? ''),
      tasks: tasks.filter(x => x.projectCode === p.code).sort((a, b) => a.id.localeCompare(b.id)).map(x => ({ name: x.name, group: x.group, billable: x.billable })),
    })),
  };
}
const planView = (key: string, t: Template, p: ApplyPlan): TemplatePlan =>
  ({ key, name: t.name, changes: p.changes, added: p.added, leftAlone: p.leftAlone, summary: planSummary(p) });

/* ----------------------------------------------------- the tenant, written */
function carryOut(t: StoredTenant, plan: ApplyPlan, key: string, by: RotaActor): { tenant: StoredTenant; notRestored: number } {
  const s = plan.steps;
  /* what a module switch does beyond the switch, as group 1's handler does it;
     Rota on waits for the saved tenant, so its absence write sees Rota live */
  for (const m of s.modules) {
    if (m.code === 'R' && !m.on) rotaOff();
    if (m.code === 'C' && !m.on) sitesOff();
  }
  const flags = { ...t.flags };
  const extras = { ...t.extras };
  const tc = tsConfig();
  const tcChange: Partial<TimesheetConfig> = {};
  for (const f of s.flags) {
    if (f.change.on !== undefined) flags[f.code] = f.change.on;
    if (f.change.weekGrid !== undefined) tcChange.weekGrid = f.change.weekGrid;
    if (f.change.weekLayout !== undefined) tcChange.weekLayout = f.change.weekLayout;
    if (f.change.breaksMax !== undefined) extras.breaksMax = f.change.breaksMax;
    if (f.change.vehiclesMax !== undefined) extras.vehiclesMax = f.change.vehiclesMax;
  }
  if (Object.keys(s.labels).length) {
    tcChange.fieldDefaults = Object.fromEntries(Object.entries(tc?.fieldDefaults ?? {})
      .map(([c, f]) => [c, Object.hasOwn(s.labels, c) ? { ...f, label: s.labels[c] ?? f.label } : f]));
  }
  if (Object.keys(tcChange).length) {
    if (!tc) throw new Error('the store has no timesheet config');
    store.coll<TimesheetConfig>('timesheetConfig')[tc.id] = bump(tc, tcChange);
  }
  const types = store.coll<EmployeeType>('employeeTypes');
  for (const x of s.typesAdded) types[`typ_${x.code}`] = { ...x, id: `typ_${x.code}`, version: 1, updatedAt: store.now() };
  for (const u of s.typesUpdated) {
    const have = Object.values(types).find(x => x.code === u.code);
    if (have) types[have.id] = bump<EmployeeType>(have, u.change);
  }
  const userTypes = store.coll<UserType>('userTypes');
  for (const [k, name] of Object.entries(s.roleNames)) {
    const ut = recordAt(userTypes, k);
    if (ut && name) userTypes[k] = bump(ut, { name });
  }
  /* each chain whole, through the Approvals page's own store */
  for (const c of s.chains) writeChain(c.module, c.steps);
  for (const kind of STRUCTURE_KINDS) {
    const coll = store.coll<Record<string, unknown>>(HOME[kind].coll);
    for (const row of s.structure[kind]) {
      const id = `${HOME[kind].prefix}_${row.code}`;
      if (kind === 'contracts' && 'tasks' in row) {
        const { tasks, ...rest } = row;
        coll[id] = { ...rest, budgetHours: '', id, version: 1, updatedAt: store.now() };
        tasks.forEach((x, i) => {
          const tid = `tsk_${row.code}_${String(i + 1).padStart(3, '0')}`;
          store.coll<Task>('projectTasks')[tid] = { id: tid, version: 1, updatedAt: store.now(), projectCode: row.code, ...x };
        });
      } else coll[id] = { ...row, id, version: 1, updatedAt: store.now() };
    }
  }
  /* the onboarding setup (D12): switches and settings by id; a held policy's wording without a new version, so nobody is asked again; new policies after the last */
  const o = s.onboarding;
  const cfg = recordAt(store.coll<StoredConfig>('onboardingConfig'), 'onboardingConfig');
  if (cfg && (Object.keys(o.steps).length || Object.keys(o.documents).length)) {
    store.coll<StoredConfig>('onboardingConfig')[cfg.id] = bump(cfg, {
      steps: cfg.steps.map(x => ({ ...x, on: x.fixed ? true : o.steps[x.id] ?? x.on })),
      documents: cfg.documents.map(d => ({ ...d, ...(o.documents[d.id] ?? {}) })),
    });
  }
  const pols = policiesColl();
  for (const u of o.policiesUpdated) {
    const have = recordAt(pols, u.id);
    if (have) pols[u.id] = bump(have, { label: u.label, sum: u.sum, body: u.body });
  }
  let order = policiesNow().reduce((m, x) => Math.max(m, x.order + 1), 0);
  for (const a of o.policiesAdded) pols[a.id] = { ...a, order: order++, id: a.id, version: 1, updatedAt: store.now() };
  const saved = saveTenant(t, { modules: s.finalModules, restore: s.finalRestore, flags, extras, template: key });
  const notRestored = s.modules.some(m => m.code === 'R' && m.on) ? rotaOn(by).notRestored : 0;
  return { tenant: saved, notRestored };
}

export const templateHandlers = [
  serve(listTemplates, () => {
    const inUse = tenantRec().template;
    const mine = Object.values(saved()).sort((a, b) => a.savedAt.localeCompare(b.savedAt) || a.key.localeCompare(b.key));
    return { inUse, templates: [
      ...SHIPPED_KEYS.map(k => rowOf(k, templateAt(k), inUse)),
      ...mine.map(s => rowOf(s.key, s.template, inUse, s))] };
  }),

  serve(saveTemplate, ({ session, body }) => {
    if (body.scope === 'structure') requireCapability(session, 'master_data');
    const problem = templateNameProblem(body.name, Object.values(saved()).map(s => s.template.name));
    if (problem) return refuseWith(problem);
    const t = tenantRec(), v = view(t);
    const template = captureTemplate(body.name, body.description || `Saved from ${t.name}`, body.scope, {
      modules: t.modules, flags: v.flags, extras: v.extras, labels: labelsNow(), defaultLabels: DEFAULT_LABELS,
      employeeTypes: typesNow(), roleNames: roleNamesNow(), chain: chainsNow(), structure: structureNow(), onboarding: onboardingNow(),
    });
    const key = templateKey(template.name);
    const who = actor(session);
    const rec: Saved = { id: key, version: 1, updatedAt: store.now(), key, source: 'saved', savedAt: store.now(), savedBy: who.name, from: t.name, template };
    saved()[key] = rec;
    const auditId = writeAudit({ who, act: 'Template saved', entity: 'template', entityId: key, before: null,
      after: { name: template.name, scope: template.scope, from: t.name } });
    return { record: rowOf(key, template, t.template, rec), auditId };
  }),

  serve(getTemplatePlan, ({ session, params }) => {
    const template = templateAt(params.key);
    return planView(params.key, template, planApply(template, stateOf(tenantRec()), { mayRenameRoles: session.caps.includes('perm_cfg'), mayChangeChains: session.caps.includes('framework'), mayChangeTypes: session.caps.includes('type_cfg'), mayChangeOnboarding: session.caps.includes('onb_cfg') }));
  }),

  serve(applyTemplate, ({ session, params, checkVersion }) => {
    const t = tenantRec();
    checkVersion(t);
    const template = templateAt(params.key);
    if (hasStructure(template)) requireCapability(session, 'master_data');
    const plan = planApply(template, stateOf(t), { mayRenameRoles: session.caps.includes('perm_cfg'), mayChangeChains: session.caps.includes('framework'), mayChangeTypes: session.caps.includes('type_cfg'), mayChangeOnboarding: session.caps.includes('onb_cfg') });
    const pv = planView(params.key, template, plan);
    const message = `${template.name} applied. ${pv.summary}`;
    if (!plan.changes.length && !plan.added.length && t.template === params.key) return { record: view(t), auditId: null, plan: pv, message };
    const { tenant: done, notRestored } = carryOut(t, plan, params.key, rotaActor(session));
    const held = notRestoredText(notRestored);
    const auditId = writeAudit({ who: actor(session), act: 'Template applied', entity: 'template', entityId: params.key,
      before: { template: t.template }, after: { template: params.key, name: template.name, detail: [pv.summary, held].filter(Boolean).join(' '),
        changed: plan.changes.map(l => l.text), added: plan.added.map(l => l.text), leftAlone: plan.leftAlone.map(l => l.text) } });
    return { record: view(done), auditId, plan: pv, message: [message, held].filter(Boolean).join(' ') };
  }),

  serve(exportTemplate, ({ params }) => templateFile(params.key, templateAt(params.key))),

  serve(importTemplate, ({ session, body }) => {
    const read = readTemplateFile(body.text);
    if (!read.ok) return refuseWith(read.refusal);
    const parsed = TemplateSchema.safeParse(read.template);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return refuseWith({ ...NOT_A_TEMPLATE, next: `${issue ? `It has ${issue.path.join('.') || 'a part'} that Qnipay cannot use. ` : ''}${NOT_A_TEMPLATE.next}` });
    }
    const template: Template = parsed.data;
    const roles = template.roleNames ? roleNamesProblem(template.roleNames) : null;
    if (roles) return refuseWith({ ...NOT_A_TEMPLATE, next: `Its role names cannot be used. ${roles}` });
    if (hasStructure(template)) requireCapability(session, 'master_data');
    const problem = templateNameProblem(template.name, Object.values(saved()).map(s => s.template.name));
    if (problem) return refuseWith(problem);
    const key = templateKey(template.name);
    const who = actor(session), t = tenantRec();
    const rec: Saved = { id: key, version: 1, updatedAt: store.now(), key, source: 'imported', savedAt: store.now(), savedBy: who.name, from: '', template };
    saved()[key] = rec;
    const auditId = writeAudit({ who, act: 'Template imported', entity: 'template', entityId: key, before: null,
      after: { name: template.name, scope: template.scope, ...(read.ignored.length ? { ignored: read.ignored } : {}) } });
    return { record: rowOf(key, template, t.template, rec), auditId, ignored: read.ignored };
  }),

  serve(removeTemplate, ({ session, params, checkVersion }) => {
    const rec = recordAt(saved(), params.key);
    const shipped = isShipped(params.key);
    if (shipped || !rec) return refuseWith(removeProblem(params.key, Boolean(rec), '') ?? NO_SUCH_TEMPLATE);
    checkVersion(rec);
    const problem = removeProblem(params.key, true, tenantRec().template);
    if (problem) return refuseWith(problem);
    Reflect.deleteProperty(saved(), params.key);
    const auditId = writeAudit({ who: actor(session), act: 'Template removed', entity: 'template', entityId: params.key,
      before: { name: rec.template.name, scope: rec.template.scope }, after: null });
    return { auditId };
  }),
];
