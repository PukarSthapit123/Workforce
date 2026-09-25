import { http, HttpResponse } from 'msw';
import { store } from './store';
import { faults } from './faults';

/* Test and development control. Not part of the product API, and never in a production build. */
export const devHandlers = [
  http.post('/api/_dev/reset', () => { faults.length = 0; store.reset(); return new HttpResponse(null, { status: 204 }); }),
  http.post('/api/_dev/seed/:tenant', ({ params }) => { store.reset(String(params.tenant)); return new HttpResponse(null, { status: 204 }); }),
  http.post('/api/_dev/clock', async ({ request }) => {
    const { now } = (await request.json()) as { now: string | null };
    store.setClock(now); return new HttpResponse(null, { status: 204 }); }),
  http.post('/api/_dev/faults', async ({ request }) => {
    const f = (await request.json()) as { method: string; path: string; status?: number; latencyMs?: number; times?: number };
    faults.push({ ...f, times: f.times ?? 1 }); return new HttpResponse(null, { status: 204 }); }),
];
