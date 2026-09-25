import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { z } from 'zod';
import { api, ApiError } from './client';
import { defineEndpoint, RecordMeta } from '@/contract';

const Thing = RecordMeta.extend({ name: z.string() });
const getThing = defineEndpoint({ method: 'GET', path: '/api/v1/things/:id', response: Thing, summary: 'test' });
const putThing = defineEndpoint({ method: 'PUT', path: '/api/v1/things/:id', request: z.object({ name: z.string() }), response: Thing, summary: 'test' });

const server = setupServer(
  http.get('/api/v1/things/:id', ({ params }) => HttpResponse.json({ id: params.id, version: 3, updatedAt: '2026-08-13T14:30:00.000Z', name: 'A' })),
  http.put('/api/v1/things/:id', ({ request }) => request.headers.get('If-Match') === '3'
    ? HttpResponse.json({ id: 't1', version: 4, updatedAt: '2026-08-13T14:30:00.000Z', name: 'B' })
    : HttpResponse.json({ code: 'stale', message: 'Somebody changed this since you opened it.', next: 'Reload and apply your change again' }, { status: 412 })),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());

test('parses a response against its schema', async () => {
  expect((await api(getThing, { params: { id: 't1' } })).version).toBe(3);
});
test('sends If-Match and surfaces a 412 as an ApiError carrying the refusal', async () => {
  await expect(api(putThing, { params: { id: 't1' }, body: { name: 'B' }, ifMatch: 2 }))
    .rejects.toMatchObject({ status: 412, refusal: { next: 'Reload and apply your change again' } });
});
test('a response that breaks its schema is an error, not data', async () => {
  server.use(http.get('/api/v1/things/:id', () => HttpResponse.json({ id: 1 })));
  await expect(api(getThing, { params: { id: 't1' } })).rejects.toBeInstanceOf(ApiError);
});
test('a network failure (offline, DNS, abort) surfaces as an ApiError, not a raw TypeError', async () => {
  server.use(http.get('/api/v1/things/:id', () => HttpResponse.error()));
  await expect(api(getThing, { params: { id: 't1' } }))
    .rejects.toMatchObject({ status: 0, refusal: { code: 'network' } });
});
test('a non-JSON error body still surfaces as an ApiError, not a parse crash', async () => {
  server.use(http.get('/api/v1/things/:id', () => new HttpResponse('<html>Internal Server Error</html>', { status: 500, headers: { 'Content-Type': 'text/html' } })));
  await expect(api(getThing, { params: { id: 't1' } })).rejects.toBeInstanceOf(ApiError);
});
