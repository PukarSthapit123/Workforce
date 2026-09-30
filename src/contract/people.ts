import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime, RecordMeta, mutation } from './common';

export const PersonState = z.enum(['candidate', 'preboard', 'active', 'suspended', 'onleave', 'leaver', 'archived']);
export const IsoDate = z.iso.date();
export const DateOrBlank = z.union([IsoDate, z.literal('')]);
export const UserTypeKey = z.enum(['employee', 'manager', 'admin']);

const editable = {
  name: z.string(), email: z.string(), phone: z.string(), jobProfile: z.string(), employeeType: z.string(),
  category: z.string(), location: z.string(), department: z.string(), manager: z.string(),
  contractedHours: z.number(), maxHours: z.number(), night: z.boolean(), resource: z.string(), cis: z.boolean(), start: DateOrBlank,
};
/* One record per person, read by every module (PRD §7.1). The bank account is
   masked in every response; `userType` is the person's account, or null. */
export const Person = RecordMeta.extend({
  code: z.string(), ...editable, address: z.string(), emergencyName: z.string(), emergencyPhone: z.string(),
  bankAccount: z.string(), bankSortCode: z.string(), state: PersonState, end: DateOrBlank, userType: UserTypeKey.nullable(),
});
export type Person = z.infer<typeof Person>;
export const STARTING_STATE = z.enum(['candidate', 'preboard', 'active'],
  { error: 'A new record starts as a candidate, preboarding or active. Later states are reached by changing state.' });
export const CreatePerson = z.object({ code: z.string(), ...editable, state: STARTING_STATE, userType: UserTypeKey });
export type CreatePerson = z.infer<typeof CreatePerson>;
/* The employee ID is immutable and the state moves only by transition, so an
   edit that carries either is refused naming that field, never quietly dropped. */
export const UpdatePerson = z.object(editable).partial().extend({
  userType: UserTypeKey.optional(),
  code: z.never({ error: 'Employee ID cannot change once it exists. Existing records reference it.' }).optional(),
  state: z.never({ error: 'A state changes through Change state, so it is recorded with a reason.' }).optional(),
});
export type UpdatePerson = z.infer<typeof UpdatePerson>;
export const HistoryEntry = z.object({
  id: z.string(), personCode: z.string(), at: IsoDateTime, by: z.object({ personCode: z.string(), name: z.string() }),
  source: z.enum(['created', 'edited', 'transition', 'profile-change']), field: z.string(), from: z.string(), to: z.string(),
  reason: z.string().optional(),
});
export type HistoryEntry = z.infer<typeof HistoryEntry>;
export const NextCode = z.object({ code: z.string() });
/* auditId is null when the edit changed nothing, as with every 1a mutation. */
export const PersonUpdated = z.object({ record: Person, auditId: z.string().nullable(), changed: z.array(z.string()) });
export type PersonUpdated = z.infer<typeof PersonUpdated>;

export const PersonParams = z.object({ id: z.string().min(1) });
export const PeopleQuery = z.object({
  state: z.union([z.enum(['here', 'all']), PersonState], { error: 'The state must be here, all or one of the seven states.' }).optional(),
  q: z.string().optional(),
});

/* No single capability: a caller needs Workforce master data (everyone) or the
   Team people list (their own location), which the handler checks. */
export const listPeople = defineEndpoint({ method: 'GET', path: '/api/v1/people', query: PeopleQuery, response: z.array(Person), errors: [403],
  summary: 'People the caller may see: everyone with master_data, otherwise their own location with team_people. Query: state (here, all or a state), q.' });
export const getNextCode = defineEndpoint({ method: 'GET', path: '/api/v1/people/next-code', response: NextCode, capability: 'emp_crud',
  summary: 'The next free employee ID, in the scheme the tenant already uses' });
export const getPerson = defineEndpoint({ method: 'GET', path: '/api/v1/people/:id', params: PersonParams, response: Person, errors: [403, 404],
  summary: 'One person: your own record, or one in your scope' });
export const createPerson = defineEndpoint({ method: 'POST', path: '/api/v1/people', request: CreatePerson, response: mutation(Person),
  capability: 'emp_crud', summary: 'Create a person, and their account when a work email is given. A non-employee user type needs perm_cfg.' });
export const updatePerson = defineEndpoint({ method: 'PATCH', path: '/api/v1/people/:id', params: PersonParams, request: UpdatePerson, response: PersonUpdated,
  capability: 'emp_crud', versioned: true, errors: [404, 409],
  summary: 'Edit a person (If-Match). The code is immutable and the state moves only by transition.' });
export const listHistory = defineEndpoint({ method: 'GET', path: '/api/v1/people/:id/history', params: PersonParams, response: z.array(HistoryEntry), errors: [403, 404],
  summary: 'Field-level history of one person, newest first' });
