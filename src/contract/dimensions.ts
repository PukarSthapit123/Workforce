/* The five dimensions every rota entry and timesheet line carries. Ported from
   the prototype's DIMS table: one shape of API for all five, so a dimension
   cannot behave differently depending on which one you are editing. */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { RecordMeta, mutation } from './common';
import { DateOrBlank } from './people';

const META = { id: true, version: true, updatedAt: true } as const;
export const Location = RecordMeta.extend({ code: z.string(), name: z.string(), area: z.string(), department: z.string(),
  costCentre: z.string(), level: z.string(), minPerShift: z.number().int().nonnegative(), manager: z.string(), address: z.string(), active: z.boolean() });
export const Department = RecordMeta.extend({ code: z.string(), name: z.string(), manager: z.string() });
export const CostCentre = RecordMeta.extend({ code: z.string(), name: z.string() });
export const JobProfile = RecordMeta.extend({ code: z.string(), name: z.string(), night: z.boolean() });
export const Project = RecordMeta.extend({ code: z.string(), name: z.string(), client: z.string(), costCentre: z.string(),
  manager: z.string(), status: z.string(), start: DateOrBlank, end: DateOrBlank, budgetHours: z.string(), billable: z.boolean(), location: z.string() });
export type Location = z.infer<typeof Location>; export type Department = z.infer<typeof Department>;
export type CostCentre = z.infer<typeof CostCentre>; export type JobProfile = z.infer<typeof JobProfile>; export type Project = z.infer<typeof Project>;
export const LocationBody = Location.omit(META); export const DepartmentBody = Department.omit(META);
export const CostCentreBody = CostCentre.omit(META); export const JobProfileBody = JobProfile.omit(META); export const ProjectBody = Project.omit(META);

export const DIMENSION_KINDS = ['locations', 'departments', 'cost-centres', 'job-profiles', 'projects'] as const;
export type DimensionKind = (typeof DIMENSION_KINDS)[number];
const InUse = { inUse: z.number().int().nonnegative() };
const DimensionParams = z.object({ id: z.string().min(1) });

function crud<R extends z.ZodObject, B extends z.ZodObject>(path: `/api/v1/${string}`, singular: string, record: R, body: B) {
  const capability = 'master_data';
  return {
    /* needs a session only: the person form reads every dimension */
    list: defineEndpoint({ method: 'GET', path, response: z.array(record.extend(InUse)), summary: `Every ${singular}, with how many records use it` }),
    create: defineEndpoint({ method: 'POST', path, request: body, response: mutation(record), capability, summary: `Create a ${singular}. The code is unique.` }),
    update: defineEndpoint({ method: 'PATCH', path: `${path}/:id`, params: DimensionParams, request: body.partial(), capability, versioned: true, errors: [404],
      response: z.object({ record, auditId: z.string().nullable(), changed: z.array(z.string()) }), summary: `Edit a ${singular} (If-Match). The code is immutable.` }),
    remove: defineEndpoint({ method: 'DELETE', path: `${path}/:id`, params: DimensionParams, response: z.object({ auditId: z.string() }), capability, versioned: true, errors: [404, 409],
      summary: `Remove a ${singular} (If-Match). 409 with usedBy while anything uses it.` }),
  };
}
export const DIMENSIONS = {
  locations: { label: 'Locations', singular: 'location', api: crud('/api/v1/locations', 'location', Location, LocationBody) },
  departments: { label: 'Departments', singular: 'department', api: crud('/api/v1/departments', 'department', Department, DepartmentBody) },
  'cost-centres': { label: 'Cost centres', singular: 'cost centre', api: crud('/api/v1/cost-centres', 'cost centre', CostCentre, CostCentreBody) },
  'job-profiles': { label: 'Job profiles', singular: 'job profile', api: crud('/api/v1/job-profiles', 'job profile', JobProfile, JobProfileBody) },
  projects: { label: 'Projects', singular: 'project', api: crud('/api/v1/projects', 'project', Project, ProjectBody) },
} satisfies Record<DimensionKind, unknown>;
export type DimensionRow = { id: string; version: number; updatedAt: string; code: string; name: string } & Record<string, unknown>;
