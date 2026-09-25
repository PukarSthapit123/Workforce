import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime } from './common';

export const AuditEntry = z.object({
  id: z.string(), at: IsoDateTime, who: z.object({ personCode: z.string(), name: z.string(), viewingAs: z.string().optional() }),
  act: z.string(), entity: z.string(), entityId: z.string(),
  before: z.unknown().optional(), after: z.unknown().optional(), reason: z.string().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
export const AuditPage = z.object({ items: z.array(AuditEntry), total: z.number().int() });
export const listAudit = defineEndpoint({ method: 'GET', path: '/api/v1/audit', response: AuditPage,
  capability: 'integration', summary: 'Audit log, newest first. Query: entity, who, q, limit.' });
