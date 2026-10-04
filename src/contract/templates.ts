/* Templates (D1-D4): the shipped ones and the ones saved or imported here,
   saving this tenant as one, the plan an apply would carry out and the
   apply itself, the export file, importing one and removing one. A template
   never carries money (D3): no currency, pay-code values, allowance amounts,
   rates or pay rules, and an imported file's other keys are listed as
   ignored. */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime } from './common';
import { DateOrBlank } from './people';
import { Tenant } from './tenant';
import { WeekGrid, WeekLayout } from './timesheets';
import { EntryMode, PayBasis, TypeCapability, WorkerCategory } from './employee-types';

const Text = (max: number) => z.string().trim().max(max);
const Code = z.string().trim().regex(/^[A-Z0-9][A-Z0-9_.-]{0,19}$/, 'A code is capital letters, digits, a dash, a dot or an underscore, with no spaces.');
export const TemplateScope = z.enum(['config', 'structure']);
export const TemplateType = z.object({
  code: z.string().regex(/^[a-z][a-z0-9_]{1,31}$/, 'A type code is lower-case letters, digits or an underscore.'),
  name: Text(60).min(1), category: WorkerCategory, mode: EntryMode, uom: PayBasis, capabilities: z.array(TypeCapability).max(4),
});
export const ChainStep = z.object({ module: Text(40), role: Text(40), scope: Text(60), when: Text(80), sla: Text(40), fixed: z.boolean() });
const Structure = z.object({
  departments: z.array(z.object({ code: Code, name: Text(80).min(1), manager: Text(80) })).max(200),
  costCentres: z.array(z.object({ code: Code, name: Text(80).min(1) })).max(200),
  locations: z.array(z.object({ code: Code, name: Text(80).min(1), area: Text(80), department: z.string().max(20), costCentre: z.string().max(20),
    level: Text(40), minPerShift: z.number().int().nonnegative().max(999), manager: Text(80), address: Text(200), active: z.boolean() })).max(200),
  jobProfiles: z.array(z.object({ code: Code, name: Text(80).min(1), night: z.boolean() })).max(200),
  contracts: z.array(z.object({ code: Code, name: Text(120).min(1), client: Text(120), costCentre: z.string().max(20), manager: Text(80), status: Text(40),
    start: DateOrBlank, end: DateOrBlank, billable: z.boolean(), location: z.string().max(20),
    tasks: z.array(z.object({ name: Text(120).min(1), group: Text(60), billable: z.boolean() })).max(200) })).max(500),
}).partial();
const RoleNames = z.object({ employee: Text(24).min(1), manager: Text(24).min(1), admin: Text(24).min(1) });
export const Template = z.object({
  name: Text(80).min(1), description: Text(300), scope: TemplateScope,
  modules: z.record(z.string(), z.boolean()), flags: z.record(z.string(), z.boolean()),
  extras: z.object({ weekGrid: WeekGrid, weekLayout: WeekLayout, breaksMax: z.number().int().min(1).max(5), vehiclesMax: z.number().int().min(1).max(4) }).partial(),
  labels: z.record(z.string(), Text(60).min(1)),
  employeeTypes: z.array(TemplateType).max(50),
  roleNames: RoleNames.optional(), approvalChain: z.array(ChainStep).max(40).optional(), structure: Structure.optional(),
});
export type Template = z.infer<typeof Template>;
export const TemplateFile = z.object({ kind: z.literal('qnipay.template'), v: z.literal(1), key: z.string(), template: Template });
export type TemplateFile = z.infer<typeof TemplateFile>;

/* One template as the Organisation page lists it: a card for every one, and a
   row in the saved table for those saved or imported here. */
export const TemplateRow = z.object({
  key: z.string(), name: z.string(), description: z.string(), scope: TemplateScope, source: z.enum(['shipped', 'saved', 'imported']),
  /* this tenant runs on it */
  inUse: z.boolean(),
  /* the employee types it brings, and the modules it turns on, by name */
  types: z.array(z.string()), modules: z.array(z.string()),
  savedAt: IsoDateTime.nullable(), savedBy: z.string().nullable(), from: z.string().nullable(),
  /* a saved one's version, for If-Match on remove; null for a shipped one */
  version: z.number().int().nonnegative().nullable(),
});
export type TemplateRow = z.infer<typeof TemplateRow>;
export const TemplateList = z.object({ templates: z.array(TemplateRow), inUse: z.string() });
export type TemplateList = z.infer<typeof TemplateList>;

export const PlanLine = z.object({
  area: z.enum(['modules', 'features', 'labels', 'types', 'roles', 'chain', 'structure', 'people', 'organisation']), text: z.string(),
});
export type PlanLine = z.infer<typeof PlanLine>;
/* D1: what an apply changes, what it adds and what it leaves alone. */
export const TemplatePlan = z.object({
  key: z.string(), name: z.string(), changes: z.array(PlanLine), added: z.array(PlanLine), leftAlone: z.array(PlanLine), summary: z.string(),
});
export type TemplatePlan = z.infer<typeof TemplatePlan>;
export const TemplateApplied = z.object({ record: Tenant, auditId: z.string().nullable(), plan: TemplatePlan, message: z.string() });
export type TemplateApplied = z.infer<typeof TemplateApplied>;

export const SaveTemplate = z.strictObject({ name: z.string().max(200), description: z.string().max(300), scope: TemplateScope });
export type SaveTemplate = z.infer<typeof SaveTemplate>;
/* the file's text as it was read, so the server says whether it could be read */
export const ImportTemplate = z.strictObject({ text: z.string().max(2_000_000, 'That file is too large to be a Qnipay template.') });
export const TemplateSaved = z.object({ record: TemplateRow, auditId: z.string() });
export const TemplateImported = TemplateSaved.extend({ ignored: z.array(z.string()) });
export type TemplateImported = z.infer<typeof TemplateImported>;

const cap = 'mod_cfg';
const KeyParams = z.object({ key: z.string().min(1).max(120) });
export const listTemplates = defineEndpoint({ method: 'GET', path: '/api/v1/templates', response: TemplateList, capability: cap,
  summary: 'Every template: the shipped ones, then those saved or imported here, with the one this tenant runs on marked' });
export const saveTemplate = defineEndpoint({ method: 'POST', path: '/api/v1/templates', request: SaveTemplate, response: TemplateSaved, capability: cap,
  errors: [409], summary: 'Save this tenant as a template: configuration only, or with its structure too (that needs Workforce master data). Never its people. A name a template already has is NAME_TAKEN.' });
export const getTemplatePlan = defineEndpoint({ method: 'GET', path: '/api/v1/templates/:key/plan', params: KeyParams, response: TemplatePlan, capability: cap,
  errors: [404], summary: 'What applying a template would change, add and leave alone, read before it is applied' });
export const applyTemplate = defineEndpoint({ method: 'POST', path: '/api/v1/templates/:key/apply', params: KeyParams, response: TemplateApplied, capability: cap,
  versioned: true, errors: [404], summary: 'Apply a template (If-Match: the tenant\'s version). Sets configuration and adds structure whose codes are new; never deletes or overwrites people or structure, never renames the organisation. One audit row.' });
export const exportTemplate = defineEndpoint({ method: 'GET', path: '/api/v1/templates/:key/export', params: KeyParams, response: TemplateFile, capability: cap,
  errors: [404], summary: 'A template as a file to keep or hand over' });
export const importTemplate = defineEndpoint({ method: 'POST', path: '/api/v1/templates/import', request: ImportTemplate, response: TemplateImported, capability: cap,
  errors: [409], summary: 'Import a template file. Never replaces one: a name already here is NAME_TAKEN. Keys a template may not hold, money among them, are left out and listed.' });
export const removeTemplate = defineEndpoint({ method: 'DELETE', path: '/api/v1/templates/:key', params: KeyParams, response: z.object({ auditId: z.string() }),
  capability: cap, versioned: true, errors: [404, 409], summary: 'Remove a template saved here (If-Match). A shipped one is SHIPPED; the one this tenant runs on is IN_USE.' });
