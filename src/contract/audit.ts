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
/* Every value arrives as a string; limit is read as a whole number from 1 to
   1000, and anything else is refused with 422 rather than quietly clamped. */
export const AuditQuery = z.object({
  entity: z.string().min(1).optional(), who: z.string().min(1).optional(), q: z.string().min(1).optional(),
  limit: z.coerce.number().int('The limit must be a whole number.').min(1, 'The limit must be at least 1.').max(1000, 'The limit can be at most 1000.').optional(),
});
export const listAudit = defineEndpoint({ method: 'GET', path: '/api/v1/audit', query: AuditQuery, response: AuditPage,
  capability: 'integration', summary: 'Audit log, newest first, filtered by record type, who and free text' });
