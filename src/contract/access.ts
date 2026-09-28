import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { RecordMeta, mutation } from './common';

export const Capability = RecordMeta.extend({ group: z.enum(['own', 'team', 'cfg']), label: z.string(), gate: z.string(), lockedFor: z.array(z.string()) });
export const UserType = RecordMeta.extend({ name: z.string(), description: z.string(), capabilities: z.array(z.string()) });
export const UserAccess = RecordMeta.extend({ email: z.string(), name: z.string(), personCode: z.string(), userType: z.string(), grants: z.array(z.string()), revocations: z.array(z.string()) });
export const SetTemplateCapability = z.object({ granted: z.boolean() });
export const AddException = z.object({ capability: z.string(), mode: z.enum(['grant', 'revoke']), reason: z.string().trim().min(1, 'Give a reason. Exceptions are reviewed.') });
export type Capability = z.infer<typeof Capability>;
export type UserType = z.infer<typeof UserType>;
export type UserAccess = z.infer<typeof UserAccess>;

const cap = 'perm_cfg';
export const listCapabilities = defineEndpoint({ method: 'GET', path: '/api/v1/capabilities', response: z.array(Capability), capability: cap, summary: 'Every capability the matrix controls' });
export const listUserTypes = defineEndpoint({ method: 'GET', path: '/api/v1/user-types', response: z.array(UserType), capability: cap, summary: 'User-type templates' });
export const setTemplateCapability = defineEndpoint({ method: 'PUT', path: '/api/v1/user-types/:id/capabilities/:cap', request: SetTemplateCapability, response: mutation(UserType), capability: cap, summary: 'Grant or remove a capability on a template (If-Match)' });
export const listUsers = defineEndpoint({ method: 'GET', path: '/api/v1/users', response: z.array(UserAccess), capability: cap, summary: 'Accounts with their template and exceptions' });
export const addException = defineEndpoint({ method: 'POST', path: '/api/v1/users/:email/exceptions', request: AddException, response: mutation(UserAccess), capability: cap, summary: 'Grant or revoke one capability for one user, with a reason (If-Match)' });
export const removeException = defineEndpoint({ method: 'DELETE', path: '/api/v1/users/:email/exceptions/:cap', response: mutation(UserAccess), capability: cap, summary: 'Remove an exception (If-Match)' });
