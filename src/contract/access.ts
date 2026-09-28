import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { RecordMeta, mutation } from './common';

export const Capability = RecordMeta.extend({ group: z.enum(['own', 'team', 'cfg']), label: z.string(), gate: z.string(), lockedFor: z.array(z.string()) });
/* A row group in the matrix. order is the position the prototype shows it in. */
export const CapabilityGroup = RecordMeta.extend({ label: z.string(), description: z.string(), order: z.number().int() });
export const UserType = RecordMeta.extend({ name: z.string(), description: z.string(), capabilities: z.array(z.string()) });
export const UserAccess = RecordMeta.extend({ email: z.string(), name: z.string(), personCode: z.string(), userType: z.string(), grants: z.array(z.string()), revocations: z.array(z.string()) });
export const SetTemplateCapability = z.object({ granted: z.boolean() });
export const AddException = z.object({ capability: z.string(), mode: z.enum(['grant', 'revoke']), reason: z.string().trim().min(1, 'Give a reason. Exceptions are reviewed.') });
export type Capability = z.infer<typeof Capability>;
export type CapabilityGroup = z.infer<typeof CapabilityGroup>;
export type UserType = z.infer<typeof UserType>;
export type UserAccess = z.infer<typeof UserAccess>;

const cap = 'perm_cfg';
const TemplateCapabilityParams = z.object({ id: z.string().min(1), cap: z.string().min(1) });
const UserParams = z.object({ email: z.string().min(1) });
const UserCapabilityParams = z.object({ email: z.string().min(1), cap: z.string().min(1) });
export const listCapabilities = defineEndpoint({ method: 'GET', path: '/api/v1/capabilities', response: z.array(Capability), capability: cap, summary: 'Every capability the matrix controls' });
export const listCapabilityGroups = defineEndpoint({ method: 'GET', path: '/api/v1/capability-groups', response: z.array(CapabilityGroup), capability: cap, summary: 'The groups the matrix rows sit under, in order' });
export const listUserTypes = defineEndpoint({ method: 'GET', path: '/api/v1/user-types', response: z.array(UserType), capability: cap, summary: 'User-type templates' });
export const setTemplateCapability = defineEndpoint({ method: 'PUT', path: '/api/v1/user-types/:id/capabilities/:cap', params: TemplateCapabilityParams, request: SetTemplateCapability, response: mutation(UserType), capability: cap, versioned: true, errors: [404, 409], summary: 'Grant or remove a capability on a template' });
export const listUsers = defineEndpoint({ method: 'GET', path: '/api/v1/users', response: z.array(UserAccess), capability: cap, summary: 'Accounts with their template and exceptions' });
export const addException = defineEndpoint({ method: 'POST', path: '/api/v1/users/:email/exceptions', params: UserParams, request: AddException, response: mutation(UserAccess), capability: cap, versioned: true, errors: [404, 409], summary: 'Grant or revoke one capability for one user, with a reason' });
export const removeException = defineEndpoint({ method: 'DELETE', path: '/api/v1/users/:email/exceptions/:cap', params: UserCapabilityParams, response: mutation(UserAccess), capability: cap, versioned: true, errors: [404, 409, 422], summary: 'Remove an exception' });
