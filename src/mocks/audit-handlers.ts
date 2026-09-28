import { listAudit, type AuditEntry } from '@/contract/audit';
import { store } from './store';
import { serve } from './serve';

export const auditHandlers = [
  serve(listAudit, ({ query }) => {
    const entity = query.entity, who = query.who?.toLowerCase(), q = query.q?.toLowerCase();
    const limit = query.limit ?? 200;
    /* Newest first. Ids come from a monotonic, zero-padded counter (see
       audit.ts), so rows stamped in the same instant still sort stably. */
    let items = Object.values(store.coll<AuditEntry>('audit')).sort((x, y) => y.at.localeCompare(x.at) || y.id.localeCompare(x.id));
    if (entity) items = items.filter(i => i.entity === entity);
    if (who) items = items.filter(i => i.who.name.toLowerCase().includes(who));
    if (q) items = items.filter(i => `${i.act} ${i.entityId} ${i.reason ?? ''}`.toLowerCase().includes(q));
    return { items: items.slice(0, limit), total: items.length };
  }),
];
