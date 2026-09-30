/* The employee type record: what somebody is. Which timesheet fields a type
   captures belongs to sub-project 2; rota eligibility and leave policy to 3 and 4. */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { RecordMeta, mutation } from './common';

export const WorkerCategory = z.enum(['Contracted', 'Bank', 'Agency', 'Salaried']);
export const EntryMode = z.enum(['form', 'grid', 'clock']);
export const PayBasis = z.enum(['hour', 'day']);
export const TypeCapability = z.enum(['vehicle', 'site', 'project', 'shift']);
export const EmployeeType = RecordMeta.extend({ code: z.string(), name: z.string(), category: WorkerCategory, mode: EntryMode,
  uom: PayBasis, capabilities: z.array(TypeCapability) });
export type EmployeeType = z.infer<typeof EmployeeType>;
export const EmployeeTypeRow = EmployeeType.extend({ inUse: z.number().int().nonnegative() });
export type EmployeeTypeRow = z.infer<typeof EmployeeTypeRow>;
const META = { id: true, version: true, updatedAt: true } as const;
export const CreateEmployeeType = EmployeeType.omit(META).extend({ startedFrom: z.string() });
export type CreateEmployeeType = z.infer<typeof CreateEmployeeType>;
/* The code is immutable, so an edit that carries one is refused naming it. */
export const UpdateEmployeeType = EmployeeType.omit({ ...META, code: true }).partial().extend({
  code: z.never({ error: 'A type code cannot change once it exists. Existing records reference it.' }).optional(),
});
export type UpdateEmployeeType = z.infer<typeof UpdateEmployeeType>;
export const Archetype = z.object({ key: z.string(), name: z.string(), mode: EntryMode, uom: PayBasis, capabilities: z.array(TypeCapability) });
export type Archetype = z.infer<typeof Archetype>;
export const TypeLibrary = z.object({ archetypes: z.array(Archetype),
  capabilities: z.array(z.object({ code: TypeCapability, label: z.string(), desc: z.string() })) });
export type TypeLibrary = z.infer<typeof TypeLibrary>;

const cap = 'type_cfg';
const TypeParams = z.object({ id: z.string().min(1) });
export const listEmployeeTypes = defineEndpoint({ method: 'GET', path: '/api/v1/employee-types', response: z.array(EmployeeTypeRow),
  summary: 'Employee types, each with how many people hold it' });
export const getTypeLibrary = defineEndpoint({ method: 'GET', path: '/api/v1/employee-types/library', response: TypeLibrary, capability: cap,
  summary: 'The archetypes a new type can start from, and the capabilities a type can have' });
export const createEmployeeType = defineEndpoint({ method: 'POST', path: '/api/v1/employee-types', request: CreateEmployeeType,
  response: mutation(EmployeeType), capability: cap, summary: 'Create an employee type. The code is unique.' });
export const updateEmployeeType = defineEndpoint({ method: 'PATCH', path: '/api/v1/employee-types/:id', params: TypeParams, request: UpdateEmployeeType,
  response: z.object({ record: EmployeeType, auditId: z.string().nullable(), changed: z.array(z.string()) }), capability: cap, versioned: true, errors: [404],
  summary: 'Edit an employee type (If-Match). The code is immutable.' });
export const removeEmployeeType = defineEndpoint({ method: 'DELETE', path: '/api/v1/employee-types/:id', params: TypeParams, response: z.object({ auditId: z.string() }),
  capability: cap, versioned: true, errors: [404, 409], summary: 'Remove an employee type nobody holds (If-Match). 409 with usedBy otherwise.' });
