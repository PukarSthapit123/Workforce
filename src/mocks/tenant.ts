import { http, HttpResponse, type HttpResponseResolver } from 'msw';
import { store } from './store';
import { handle } from './http';
import { requireSession } from './session';
import type { Tenant } from '@/contract/tenant';

/* Same inference workaround as session.ts's ResolverInfo: `handle`'s generic
   cannot be inferred from an unannotated destructured parameter nested inside
   http.get(...), so the real msw resolver-info type is named here once. */
type ResolverInfo = Parameters<HttpResponseResolver>[0];

export const tenantHandlers = [
  http.get('/api/v1/tenant', handle(({ request }: ResolverInfo) => { requireSession(request); return HttpResponse.json(store.coll<Tenant>('tenant').tenant); })),
];
