import { http, HttpResponse } from 'msw';
import { server } from './node';
import { store } from './store';
import { faults } from './faults';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());

test('POST /api/_dev/clock sets the server clock', async () => {
  const r = await fetch('/api/_dev/clock', { method: 'POST', body: JSON.stringify({ now: '2026-08-13T14:30:00.000Z' }) });
  expect(r.status).toBe(204);
  expect(store.now()).toBe('2026-08-13T14:30:00.000Z');
});
test('a fault makes the next call fail with the chosen status, then clears', async () => {
  /* a probe endpoint of the test's own, so this does not depend on a later task's handler */
  server.use(http.get('/api/v1/probe', () => HttpResponse.json({ ok: true })));
  await fetch('/api/_dev/faults', { method: 'POST', body: JSON.stringify({ method: 'GET', path: '/api/v1/probe', status: 500, times: 1 }) });
  const first = await fetch('/api/v1/probe');
  expect(first.status).toBe(500);
  expect(await first.json()).toMatchObject({ code: 'fault', next: expect.any(String) });
  const second = await fetch('/api/v1/probe');
  expect(second.status).toBe(200);
});
test('a latency-only fault delays a request once, leaving the rest of its count untouched', async () => {
  /* the request must be checked against the fault exactly once: if it were
     checked twice (e.g. once by a guard and again by the handler it falls
     through to), a two-latencyMs fault would both delay this one call twice
     and use up both of its times in a single request */
  server.use(http.get('/api/v1/probe-latency', () => HttpResponse.json({ ok: true })));
  await fetch('/api/_dev/faults', { method: 'POST', body: JSON.stringify({ method: 'GET', path: '/api/v1/probe-latency', latencyMs: 50, times: 2 }) });
  const start = Date.now();
  const res = await fetch('/api/v1/probe-latency');
  const elapsed = Date.now() - start;
  expect(res.status).toBe(200);
  expect(elapsed).toBeGreaterThanOrEqual(40);
  expect(elapsed).toBeLessThan(150); // a double-check would delay this by ~100ms+
  expect(faults.find(f => f.path === '/api/v1/probe-latency')?.times).toBe(1);
});
test('POST /api/_dev/reset restores the seed and clears faults', async () => {
  store.db.audit = { stray: { id: 'stray' } };
  server.use(http.get('/api/v1/probe-reset', () => HttpResponse.json({ ok: true })));
  await fetch('/api/_dev/faults', { method: 'POST', body: JSON.stringify({ method: 'GET', path: '/api/v1/probe-reset', status: 500, times: 1 }) });

  await fetch('/api/_dev/reset', { method: 'POST' });

  expect(store.db.audit).not.toHaveProperty('stray');
  expect(store.tenant).toBe('social');
  const afterReset = await fetch('/api/v1/probe-reset');
  expect(afterReset.status).toBe(200);
});
