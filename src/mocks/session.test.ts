import { server } from './node';
import { store } from './store';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => store.reset('social'));
const post = (url: string, body?: unknown, token?: string) => fetch(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
/* Explicit guard rather than `!`: a missing seeded account is a broken test
   fixture, and this fails with a clear message instead of a TypeError. */
const anyAccount = (type: string) => {
  const found = Object.values(store.db.accounts as Record<string, { email: string; userType: string; personCode: string }>).find(a => a.userType === type);
  if (!found) throw new Error(`no seeded account with userType "${type}"`);
  return found;
};

test('signing in with the demo password returns a session with capabilities', async () => {
  const r = await post('/api/v1/session', { email: anyAccount('manager').email, password: 'Qnipay@123' });
  expect(r.status).toBe(200);
  const s = await r.json();
  expect(s.account.userType).toBe('manager');
  expect(s.capabilities).toContain('team_people');
});
test('a wrong password is refused with a next step, and nothing is issued', async () => {
  const r = await post('/api/v1/session', { email: anyAccount('manager').email, password: 'nope' });
  expect(r.status).toBe(401);
  expect(await r.json()).toMatchObject({ code: 'credentials', next: expect.any(String) });
});
test('a session whose account has gone is refused, so the client signs out', async () => {
  const acc = anyAccount('employee');
  const { token } = await (await post('/api/v1/session', { email: acc.email, password: 'Qnipay@123' })).json();
  Reflect.deleteProperty(store.db.accounts as Record<string, unknown>, `acc_${acc.email}`);
  const r = await fetch('/api/v1/session', { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status).toBe(401);
});
test('view-as is audited, and the session says who is really signed in', async () => {
  const admin = anyAccount('admin'), emp = anyAccount('employee');
  const { token } = await (await post('/api/v1/session', { email: admin.email, password: 'Qnipay@123' })).json();
  const r = await post('/api/v1/session/view-as', { personCode: emp.personCode }, token);
  const s = await r.json();
  expect(s.viewingAs.personCode).toBe(emp.personCode);
  expect(s.account.email).toBe(admin.email);
  expect(Object.values(store.coll<{ act: string }>('audit')).some(a => a.act === 'View-as started')).toBe(true);
});
