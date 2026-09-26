import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { RecordMeta } from './common';

export const Tenant = RecordMeta.extend({ name: z.string(), template: z.string(), modules: z.record(z.string(), z.boolean()), flags: z.record(z.string(), z.boolean()) });
export type Tenant = z.infer<typeof Tenant>;
export const getTenant = defineEndpoint({ method: 'GET', path: '/api/v1/tenant', response: Tenant, summary: 'The tenant: name, template, modules and flags' });
