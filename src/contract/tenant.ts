import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { RecordMeta, mutation } from './common';
import { IsoDate } from './people';
import { WeekGrid, WeekLayout } from './timesheets';

/* The organisation's own details. No currency: money stays in Business Central. */
export const Company = z.object({
  registration: z.string(), address: z.string(), country: z.string(), nmwCheck: z.boolean(),
  bankHolidayRegion: z.string(), payFrequency: z.string(), weekEnding: z.string(), firstPayDate: z.union([IsoDate, z.literal('')]),
});
export const FinancialYear = z.object({ start: IsoDate, end: IsoDate, label: z.string() });
export const BankHoliday = z.object({ date: IsoDate, name: z.string() });
/* Settings that hang off a feature (D6). weekGrid and weekLayout are read
   from timesheetConfig, which module 2 keeps reading; breaksMax and
   vehiclesMax have no other home. */
export const FlagExtras = z.object({ weekGrid: WeekGrid, weekLayout: WeekLayout, breaksMax: z.number().int(), vehiclesMax: z.number().int() });
export const Tenant = RecordMeta.extend({
  name: z.string(), template: z.string(), modules: z.record(z.string(), z.boolean()), flags: z.record(z.string(), z.boolean()),
  company: Company, financialYear: FinancialYear, weekStart: z.string(), bankHolidays: z.array(BankHoliday),
  /* months, from rotaConfig (its one home), 12 when Rota has never been set up */
  rotaHorizon: z.number().int(),
  extras: FlagExtras,
  /* what turning a master module back on restores: Timesheet's capture methods while it is off */
  restore: z.record(z.string(), z.array(z.string())),
  /* scheduled shifts kept aside while Rota is off, restored when it is turned on */
  rotaSetAside: z.number().int().nonnegative(),
});
export type Tenant = z.infer<typeof Tenant>;
export type Company = z.infer<typeof Company>;
export type FlagExtras = z.infer<typeof FlagExtras>;

/* What a module switch did, so the screen can say it in the server's words. */
export const ModuleEffect = z.object({
  message: z.string(),
  /* records left exactly as they were, by kind */
  kept: z.array(z.object({ what: z.string(), count: z.number().int().nonnegative() })),
  shiftsSetAside: z.number().int().nonnegative(), shiftsRestored: z.number().int().nonnegative(),
  /* kept shifts not put back because the person is on leave or off sick that day */
  shiftsNotRestored: z.number().int().nonnegative(),
  /* capture methods Timesheet brought back (on) or remembered (off) */
  capturesRestored: z.array(z.string()), capturesRemembered: z.array(z.string()),
  /* employee types Sites off took the site capability from */
  siteRemovedFrom: z.array(z.string()),
});
export type ModuleEffect = z.infer<typeof ModuleEffect>;
export const ModuleSwitched = mutation(Tenant).extend({ effect: ModuleEffect });
export type ModuleSwitched = z.infer<typeof ModuleSwitched>;
export const FlagChanged = mutation(Tenant).extend({ message: z.string() });
export type FlagChanged = z.infer<typeof FlagChanged>;

export const SetModule = z.strictObject({ on: z.boolean() });
export const SetFlag = z.strictObject({
  on: z.boolean().optional(), weekGrid: WeekGrid.optional(), weekLayout: WeekLayout.optional(),
  breaksMax: z.number().optional(), vehiclesMax: z.number().optional(),
});
export type SetFlag = z.infer<typeof SetFlag>;
export const UpdateTenantSettings = z.strictObject({
  rotaHorizon: z.literal([12, 6, 3], { error: 'Choose a rota horizon of 12, 6 or 3 months.' }).optional(),
  name: z.string().trim().min(1, 'The organisation needs a name.').max(80).optional(),
  company: z.strictObject({
    registration: z.string().trim().max(20), address: z.string().trim().max(200),
    country: z.enum(['United Kingdom', 'Ireland', 'Nepal']), nmwCheck: z.boolean(),
    bankHolidayRegion: z.enum(['England & Wales', 'Scotland', 'Northern Ireland', 'Republic of Ireland']),
    payFrequency: z.enum(['Weekly', 'Fortnightly', 'Four-weekly', 'Monthly']), weekEnding: z.enum(['Sunday', 'Saturday', 'Friday']),
    firstPayDate: z.union([IsoDate, z.literal('')]),
  }).partial().optional(),
});
export type UpdateTenantSettings = z.infer<typeof UpdateTenantSettings>;

const ModuleParams = z.object({ code: z.string().min(1) });
export const getTenant = defineEndpoint({ method: 'GET', path: '/api/v1/tenant', response: Tenant, errors: [404],
  summary: 'The tenant: name, template, modules and flags with their extras, company details, financial year, week start, bank holidays, rota horizon and what a switch would restore' });
export const setModule = defineEndpoint({ method: 'PATCH', path: '/api/v1/tenant/modules/:code', params: ModuleParams, request: SetModule,
  response: ModuleSwitched, capability: 'mod_cfg', versioned: true, errors: [404, 409],
  summary: 'Turn a module or a Timesheet capture method on or off (If-Match: the tenant\'s version). Off keeps every record and reports counts; Workforce core is LOCKED; a capture method while Timesheet is off is MODULE_OFF.' });
export const setFlag = defineEndpoint({ method: 'PATCH', path: '/api/v1/tenant/flags/:code', params: ModuleParams, request: SetFlag,
  response: FlagChanged, capability: 'mod_cfg', versioned: true, errors: [404, 409],
  summary: 'Turn a feature on or off and set its extras (If-Match: the tenant\'s version). A feature of a module that is not live is MODULE_OFF; extras of a feature that is off are FLAG_OFF.' });
export const updateTenantSettings = defineEndpoint({ method: 'PATCH', path: '/api/v1/tenant/settings', request: UpdateTenantSettings,
  response: mutation(Tenant), capability: 'master_data', versioned: true,
  summary: 'Change the rota horizon, the organisation name or company details (If-Match: the tenant\'s version)' });
