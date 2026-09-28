import { z } from 'zod';
import { server } from './node';
import { store } from './store';
import { serve } from './serve';
import { refuse } from './http';
import { writeAudit } from './audit';
import { RecordMeta, mutation, type Endpoint } from '@/contract';

/* Endpoints of this test's own, as plain objects rather than defineEndpoint,
   so they never join the contract registry. */
const Thing = RecordMeta.extend({ name: z.string() });
type Thing = z.infer<typeof Thing>;
const getThing = { method: 'GET', path: '/api/v1/test-things/:id', params: z.object({ id: z.string().regex(/^t\d+$/, 'The thing id must look like t1.') }), response: Thing, summary: 'test' } as const satisfies Endpoint;
const listThings = { method: 'GET', path: '/api/v1/test-things', query: z.object({ size: z.coerce.number().int().min(1).optional() }), response: z.array(Thing), summary: 'test' } as const satisfies Endpoint;
const putThing = { method: 'PUT', path: '/api/v1/test-things/:id', params: z.object({ id: z.string() }), request: z.object({ name: z.string().min(1) }), response: mutation(Thing), versioned: true, summary: 'test' } as const satisfies Endpoint;
const adminThing = { method: 'POST', path: '/api/v1/test-admin-things', response: z.null(), capability: 'perm_cfg', summary: 'test' } as const satisfies Endpoint;
const publicThing = { method: 'GET', path: '/api/v1/test-public-thing', response: z.object({ ok: z.boolean() }), public: true, summary: 'test' } as const satisfies Endpoint;

const things = () => store.coll<Thing>('things');
const t1 = (): Thing => { const t = things().t1; if (!t) throw new Error('no t1'); return t; };
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
afterEach(() => server.resetHandlers());

let token = '';
async function signInAs(userType: string) {
  const acc = Object.values(store.db.accounts as Record<string, { email: string; userType: string }>).find(a => a.userType === userType);
  if (!acc) throw new Error(`no seeded ${userType}`);
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: acc.email, password: 'Qnipay@123' }) });
  token = ((await r.json()) as { token: string }).token;
}
beforeEach(async () => {
  store.reset('social');
  things().t1 = { id: 't1', version: 2, updatedAt: '2026-08-13T14:30:00.000Z', name: 'One' };
  await signInAs('admin');
});
const call = (method: string, url: string, init: { body?: unknown; ifMatch?: string; auth?: boolean } = {}) => fetch(url, {
  method, body: init.body === undefined ? undefined : JSON.stringify(init.body),
  headers: { 'Content-Type': 'application/json', ...(init.auth === false ? {} : { Authorization: `Bearer ${token}` }), ...(init.ifMatch === undefined ? {} : { 'If-Match': init.ifMatch }) },
});

/* The shared order a handler never repeats: session, capability, then validation. */
test('without a session the endpoint answers 401 before its parameters are even looked at', async () => {
  server.use(serve(getThing, ({ params }) => things()[params.id] ?? refuse(404, { code: 'not-found', message: 'No such thing.', next: 'Reload.' })));
  const r = await call('GET', '/api/v1/test-things/bad', { auth: false });
  expect(r.status).toBe(401);
});
test('a public endpoint needs no session', async () => {
  server.use(serve(publicThing, ({ session }) => ({ ok: session === undefined })));
  const r = await call('GET', '/api/v1/test-public-thing', { auth: false });
  expect(await r.json()).toEqual({ ok: true });
});
test('the capability the contract names is checked for the handler', async () => {
  let ran = false;
  server.use(serve(adminThing, () => { ran = true; return null; }));
  await signInAs('employee');
  const r = await call('POST', '/api/v1/test-admin-things');
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({ code: 'capability', message: expect.stringContaining('Permissions and role configuration') });
  expect(ran).toBe(false);
});
test('a path parameter that breaks its schema is refused with 422 naming it, before the handler runs', async () => {
  let ran = false;
  server.use(serve(getThing, () => { ran = true; return t1(); }));
  const r = await call('GET', '/api/v1/test-things/nope');
  expect(r.status).toBe(422);
  expect(await r.json()).toMatchObject({ code: 'invalid', field: 'id', message: 'The thing id must look like t1.', next: expect.any(String) });
  expect(ran).toBe(false);
});
test.each([['lots', 'The size must be a number.'], ['0', 'The size must be at least 1.'], ['1.5', 'The size must be a whole number.']])(
  'a query value of %s is refused in plain words: %s', async (size, message) => {
    server.use(serve(listThings, () => Object.values(things())));
    const r = await call('GET', `/api/v1/test-things?size=${size}`);
    expect(r.status).toBe(422);
    const body = (await r.json()) as { message: string };
    expect(body).toMatchObject({ code: 'invalid', field: 'size', message });
    expect(body.message).not.toMatch(/expected|received|NaN|Invalid input/);
  });
test('a body that breaks its schema is refused with 422 in plain words', async () => {
  server.use(serve(putThing, ({ checkVersion }) => { checkVersion(t1()); return { record: t1(), auditId: null }; }));
  const missing = await call('PUT', '/api/v1/test-things/t1', { body: {}, ifMatch: '2' });
  expect(await missing.json()).toMatchObject({ code: 'invalid', field: 'name', message: 'The name is missing.' });
  const empty = await call('PUT', '/api/v1/test-things/t1', { body: { name: '' }, ifMatch: '2' });
  expect(await empty.json()).toMatchObject({ code: 'invalid', field: 'name', message: 'The name cannot be empty.' });
});

describe('a versioned write', () => {
  const put = () => serve(putThing, ({ params, body, session, checkVersion }) => {
    const t = things()[params.id] ?? refuse(404, { code: 'not-found', message: 'No such thing.', next: 'Reload.' });
    checkVersion(t);
    const next = { ...t, name: body.name, version: t.version + 1 };
    things()[t.id] = next;
    return { record: next, auditId: writeAudit({ who: { personCode: session.account.personCode, name: 'x' }, act: 'Thing renamed', entity: 'thing', entityId: t.id }) };
  });
  test('gets typed params, body and session, and checks the version after the lookup', async () => {
    server.use(put());
    const ok = await call('PUT', '/api/v1/test-things/t1', { body: { name: 'Two' }, ifMatch: '2' });
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({ record: { name: 'Two', version: 3 }, auditId: expect.stringMatching(/^aud_\d{12}$/) });
    expect((await call('PUT', '/api/v1/test-things/t9', { body: { name: 'Two' }, ifMatch: '2' })).status).toBe(404);
    expect((await call('PUT', '/api/v1/test-things/t1', { body: { name: 'Three' }, ifMatch: '2' })).status).toBe(412);
  });
  test.each([[undefined, 428, 'version-required'], ['', 428, 'version-required'], ['"2"', 412, 'version-unreadable'], ['W/"2"', 412, 'version-unreadable'], ['2.0', 412, 'version-unreadable']])(
    'an If-Match of %j is refused with %i (%s) and changes nothing', async (ifMatch, status, code) => {
      server.use(put());
      const before = structuredClone(store.db);
      const r = await call('PUT', '/api/v1/test-things/t1', { body: { name: 'Two' }, ...(ifMatch === undefined ? {} : { ifMatch }) });
      expect(r.status).toBe(status);
      expect(await r.json()).toMatchObject({ code, message: expect.stringContaining('not been saved'), next: expect.any(String) });
      expect(store.db).toEqual(before);
    });
  test('a handler that forgets checkVersion is a loud 500 that names the endpoint, and its write is undone', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server.use(serve(putThing, ({ body }) => {
      const t = t1();
      things().t1 = { ...t, name: body.name };
      return { record: t, auditId: null };
    }));
    const r = await call('PUT', '/api/v1/test-things/t1', { body: { name: 'Two' }, ifMatch: '2' });
    expect(r.status).toBe(500);
    expect(await r.json()).toMatchObject({ code: 'server-defect', message: expect.stringContaining('PUT /api/v1/test-things/:id') });
    expect(t1().name).toBe('One');
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

test('a refusal thrown after a write undoes the write and its audit row, so a refusal never half-applies', async () => {
  server.use(serve(putThing, ({ checkVersion }) => {
    const t = t1();
    things().t1 = { ...t, name: 'Half' };
    writeAudit({ who: { personCode: 'X', name: 'X' }, act: 'Half', entity: 'thing', entityId: 't1' });
    checkVersion(t);
    return { record: t, auditId: null };
  }));
  const before = structuredClone(store.db);
  const r = await call('PUT', '/api/v1/test-things/t1', { body: { name: 'Two' }, ifMatch: '1' });
  expect(r.status).toBe(412);
  expect(store.db).toEqual(before);
});
test('a response that breaks its contract is a loud 500 naming the endpoint', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  server.use(serve(getThing, () => ({ id: 't1' }) as never));
  const r = await call('GET', '/api/v1/test-things/t1');
  expect(r.status).toBe(500);
  expect(await r.json()).toMatchObject({ code: 'server-defect', message: expect.stringContaining('GET /api/v1/test-things/:id answered with a response its contract does not allow') });
  error.mockRestore();
});
