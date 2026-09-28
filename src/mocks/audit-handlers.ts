import { http, HttpResponse, type HttpResponseResolver } from 'msw';
import { AuditQuery, type AuditEntry } from '@/contract/audit';
import { store } from './store';
import { handle, readQuery } from './http';
import { requireCapability, requireSession } from './session';

/* Same inference workaround as session.ts's and access.ts's ResolverInfo: `handle`'s
   generic cannot be inferred from an unannotated destructured parameter nested inside
   http.get(...), so the real msw resolver-info type is named here once. */
type ResolverInfo = Parameters<HttpResponseResolver>[0];

export const auditHandlers = [
  http.get('/api/v1/audit', handle(({ request }: ResolverInfo) => {
    requireCapability(requireSession(request), 'integration', 'Integrations and audit log');
    const query = readQuery(request, AuditQuery);
    const entity = query.entity, who = query.who?.toLowerCase(), q = query.q?.toLowerCase();
    const limit = query.limit ?? 200;
    let items = Object.values(store.coll<AuditEntry>('audit')).sort((x, y) => y.at.localeCompare(x.at) || y.id.localeCompare(x.id));
    if (entity) items = items.filter(i => i.entity === entity);
    if (who) items = items.filter(i => i.who.name.toLowerCase().includes(who));
    if (q) items = items.filter(i => `${i.act} ${i.entityId} ${i.reason ?? ''}`.toLowerCase().includes(q));
    return HttpResponse.json({ items: items.slice(0, limit), total: items.length });
  })),
];
