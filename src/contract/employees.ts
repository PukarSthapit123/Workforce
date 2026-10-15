import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime, RecordMeta, mutation } from './common';

export const EmployeeState = z.enum(['candidate', 'preboard', 'active', 'suspended', 'onleave', 'leaver', 'archived']);
export const IsoDate = z.iso.date();
export const DateOrBlank = z.union([IsoDate, z.literal('')]);
export const UserTypeKey = z.enum(['employee', 'manager', 'admin']);

const editable = {
  name: z.string(), email: z.string(), phone: z.string(), jobProfile: z.string(), employeeType: z.string(),
  category: z.string(), location: z.string(), department: z.string(), manager: z.string(),
  contractedHours: z.number(), maxHours: z.number(), night: z.boolean(), resource: z.string(), cis: z.boolean(), start: DateOrBlank,
};
/* One record per employee, read by every module (PRD §7.1). The bank account is
   masked in every response; `userType` is the employee's account, or null. */
export const Employee = RecordMeta.extend({
  code: z.string(), ...editable, address: z.string(), emergencyName: z.string(), emergencyPhone: z.string(),
  bankAccount: z.string(), bankSortCode: z.string(), state: EmployeeState, end: DateOrBlank, userType: UserTypeKey.nullable(),
});
export type Employee = z.infer<typeof Employee>;
export const STARTING_STATE = z.enum(['candidate', 'preboard', 'active'],
  { error: 'A new record starts as a candidate, preboarding or active. Later states are reached by changing state.' });
export const CreateEmployee = z.object({ code: z.string(), ...editable, state: STARTING_STATE, userType: UserTypeKey });
export type CreateEmployee = z.infer<typeof CreateEmployee>;
/* The employee ID is immutable and the state moves only by transition, so an
   edit that carries either is refused naming that field, never quietly dropped. */
export const UpdateEmployee = z.object(editable).partial().extend({
  userType: UserTypeKey.optional(),
  code: z.never({ error: 'Employee ID cannot change once it exists. Existing records reference it.' }).optional(),
  state: z.never({ error: 'A state changes through Change state, so it is recorded with a reason.' }).optional(),
});
export type UpdateEmployee = z.infer<typeof UpdateEmployee>;
export const HistoryEntry = z.object({
  id: z.string(), employeeCode: z.string(), at: IsoDateTime, by: z.object({ employeeCode: z.string(), name: z.string() }),
  source: z.enum(['created', 'edited', 'transition', 'profile-change']), field: z.string(), from: z.string(), to: z.string(),
  reason: z.string().optional(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;
export const NextCode = z.object({ code: z.string() });
/* auditId is null when the edit changed nothing, as with every 1a mutation. */
export const EmployeeUpdated = z.object({ record: Employee, auditId: z.string().nullable(), changed: z.array(z.string()) });
export type EmployeeUpdated = z.infer<typeof EmployeeUpdated>;

export const EmployeeParams = z.object({ id: z.string().min(1) });
export const EmployeesQuery = z.object({
  state: z.union([z.enum(['here', 'all']), EmployeeState], { error: 'The state must be here, all or one of the seven states.' }).optional(),
  q: z.string().optional(),
});

/* No single capability: a caller needs Workforce master data (everyone) or the
   Team employees list (their own location), which the handler checks. */
export const listEmployees = defineEndpoint({ method: 'GET', path: '/api/v1/employees', query: EmployeesQuery, response: z.array(Employee), errors: [403],
  summary: 'Employees the caller may see: everyone with master_data, otherwise their own location with team_employees. Query: state (here, all or a state), q.' });
export const getNextCode = defineEndpoint({ method: 'GET', path: '/api/v1/employees/next-code', response: NextCode, capability: 'emp_crud',
  summary: 'The next free employee ID, in the scheme the tenant already uses' });
export const getEmployee = defineEndpoint({ method: 'GET', path: '/api/v1/employees/:id', params: EmployeeParams, response: Employee, errors: [403, 404],
  summary: 'One employee: your own record, or one in your scope' });
export const createEmployee = defineEndpoint({ method: 'POST', path: '/api/v1/employees', request: CreateEmployee, response: mutation(Employee),
  capability: 'emp_crud', summary: 'Create an employee, and their account when a work email is given. A non-employee user type needs perm_cfg.' });
export const updateEmployee = defineEndpoint({ method: 'PATCH', path: '/api/v1/employees/:id', params: EmployeeParams, request: UpdateEmployee, response: EmployeeUpdated,
  capability: 'emp_crud', versioned: true, errors: [404, 409],
  summary: 'Edit an employee (If-Match). The code is immutable and the state moves only by transition.' });
export const listHistory = defineEndpoint({ method: 'GET', path: '/api/v1/employees/:id/history', params: EmployeeParams, response: z.array(HistoryEntry), errors: [403, 404],
  summary: 'Field-level history of one employee, newest first' });

export const Transition = z.object({ to: z.string(), reason: z.string() });
export type Transition = z.infer<typeof Transition>;
export const transitionEmployee = defineEndpoint({ method: 'POST', path: '/api/v1/employees/:id/transitions', params: EmployeeParams, request: Transition,
  response: mutation(Employee), capability: 'emp_crud', versioned: true, errors: [404, 409],
  summary: 'Move an employee along the lifecycle, with a reason (If-Match). 409 names the states it can move to, or what a new starter still has outstanding before they can become active.' });
