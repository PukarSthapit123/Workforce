import { http, HttpResponse } from 'msw';
import { isTenant, store, TENANTS } from './store';
import { faults } from './faults';
import type { Refusal } from '@/contract/common';

/* Test and development control. Not part of the product API, and never in a production build. */
export const devHandlers = [
  http.post('/api/_dev/reset', () => { faults.length = 0; store.reset(); return new HttpResponse(null, { status: 204 }); }),
  http.post('/api/_dev/seed/:tenant', ({ params }) => {
    const tenant = String(params.tenant);
    if (!isTenant(tenant)) return HttpResponse.json({ code: 'invalid', field: 'tenant',
      message: `There is no seed for "${tenant}", so nothing was loaded.`,
      next: `Use one of: ${TENANTS.join(', ')}.` } satisfies Refusal, { status: 422 });
    store.reset(tenant); return new HttpResponse(null, { status: 204 }); }),
  http.post('/api/_dev/clock', async ({ request }) => {
    const { now } = (await request.json()) as { now: string | null };
    store.setClock(now); return new HttpResponse(null, { status: 204 }); }),
  /* Lets a test read back the frozen clock it just set, e.g. across the page
     reload a Playwright fixture does to sign in as someone. */
  http.get('/api/_dev/clock', () => HttpResponse.json({ now: store.now() })),
  http.post('/api/_dev/faults', async ({ request }) => {
    const f = (await request.json()) as { method: string; path: string; status?: number; latencyMs?: number; times?: number };
    faults.push({ ...f, times: f.times ?? 1 }); return new HttpResponse(null, { status: 204 }); }),
];
