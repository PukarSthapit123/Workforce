import { http, HttpResponse, type HttpResponseResolver } from 'msw';
import type { AuditEntry } from '@/contract/audit';
import { store } from './store';
import { handle } from './http';
import { requireCapability, requireSession } from './session';

/* Same inference workaround as session.ts's and access.ts's ResolverInfo: `handle`'s
   generic cannot be inferred from an unannotated destructured parameter nested inside
   http.get(...), so the real msw resolver-info type is named here once. */
type ResolverInfo = Parameters<HttpResponseResolver>[0];

export const auditHandlers = [
  http.get('/api/v1/audit', handle(({ request }: ResolverInfo) => {
    requireCapability(requireSession(request), 'integration', 'Integrations and audit log');
    const u = new URL(request.url);
    const entity = u.searchParams.get('entity'), who = u.searchParams.get('who')?.toLowerCase(), q = u.searchParams.get('q')?.toLowerCase();
    const limit = Math.min(Number(u.searchParams.get('limit') ?? 200), 1000);
    let items = Object.values(store.coll<AuditEntry>('audit')).sort((x, y) => y.at.localeCompare(x.at) || y.id.localeCompare(x.id));
    if (entity) items = items.filter(i => i.entity === entity);
    if (who) items = items.filter(i => i.who.name.toLowerCase().includes(who));
    if (q) items = items.filter(i => `${i.act} ${i.entityId} ${i.reason ?? ''}`.toLowerCase().includes(q));
    return HttpResponse.json({ items: items.slice(0, limit), total: items.length });
  })),
];
