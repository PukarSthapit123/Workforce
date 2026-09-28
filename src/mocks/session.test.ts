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
/* PERSISTENCE AND ACCOUNTS / SIGN IN: "A failed attempt does not reveal which
   half was wrong". A single branch in session.ts's handler refuses both an
   unknown address and a known address with the wrong password identically;
   this proves the two responses actually match, not just that each one's
   text happens to mention "do not match". */
test('the same message covers an unknown address and a wrong password, so neither leaks which half was wrong', async () => {
  const unknownAddress = await post('/api/v1/session', { email: 'nobody@example.org', password: 'Qnipay@123' });
  const wrongPassword = await post('/api/v1/session', { email: anyAccount('manager').email, password: 'nope' });
  expect(unknownAddress.status).toBe(401);
  expect(wrongPassword.status).toBe(401);
  const [unknownBody, wrongBody] = await Promise.all([unknownAddress.json(), wrongPassword.json()]);
  expect(unknownBody.message).toBe(wrongBody.message);
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
test('a signed-in person without the perm_cfg capability is refused view-as with a plain 403', async () => {
  const emp = anyAccount('employee'), target = anyAccount('manager');
  const { token } = await (await post('/api/v1/session', { email: emp.email, password: 'Qnipay@123' })).json();
  const r = await post('/api/v1/session/view-as', { personCode: target.personCode }, token);
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({ code: 'capability', next: expect.any(String) });
});
test('view-as refuses an unknown employee ID with a 422 naming the field', async () => {
  const admin = anyAccount('admin');
  const { token } = await (await post('/api/v1/session', { email: admin.email, password: 'Qnipay@123' })).json();
  const r = await post('/api/v1/session/view-as', { personCode: 'NOPE-0000' }, token);
  expect(r.status).toBe(422);
  expect(await r.json()).toMatchObject({ code: 'invalid', field: 'personCode', next: expect.any(String) });
});
test('view-as refuses a person with no account, rather than quietly using the viewer\'s own capabilities under their label', async () => {
  const admin = anyAccount('admin'), emp = anyAccount('employee');
  const { token } = await (await post('/api/v1/session', { email: admin.email, password: 'Qnipay@123' })).json();
  Reflect.deleteProperty(store.db.accounts as Record<string, unknown>, `acc_${emp.email}`);
  const r = await post('/api/v1/session/view-as', { personCode: emp.personCode }, token);
  expect(r.status).toBe(422);
  expect(await r.json()).toMatchObject({ code: 'invalid', field: 'personCode', next: expect.any(String) });
});
test('a view-as target whose account vanishes mid-view falls back to the real account, not a leaked, mislabelled one', async () => {
  const admin = anyAccount('admin'), emp = anyAccount('employee');
  const { token } = await (await post('/api/v1/session', { email: admin.email, password: 'Qnipay@123' })).json();
  await post('/api/v1/session/view-as', { personCode: emp.personCode }, token);
  Reflect.deleteProperty(store.db.accounts as Record<string, unknown>, `acc_${emp.email}`);
  const r = await fetch('/api/v1/session', { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status).toBe(200);
  const s = await r.json();
  expect(s.viewingAs).toBeUndefined();
  expect(s.account.email).toBe(admin.email);
  expect(s.capabilities).toContain('integration'); // the admin's own capability, not the employee's
});
test('the view-as-started audit row names the real account and records what it started viewing as, with correct before/after', async () => {
  const admin = anyAccount('admin'), emp = anyAccount('employee');
  const { token } = await (await post('/api/v1/session', { email: admin.email, password: 'Qnipay@123' })).json();
  await post('/api/v1/session/view-as', { personCode: emp.personCode }, token);
  const rows = Object.values(store.coll<{ act: string; who: { personCode: string; viewingAs?: string }; before: unknown; after: unknown }>('audit'));
  const row = rows.find(r => r.act === 'View-as started');
  expect(row).toMatchObject({ who: { personCode: admin.personCode, viewingAs: emp.personCode }, before: null, after: { viewingAs: emp.personCode } });
});
test('ending view-as writes its own audit row', async () => {
  const admin = anyAccount('admin'), emp = anyAccount('employee');
  const { token } = await (await post('/api/v1/session', { email: admin.email, password: 'Qnipay@123' })).json();
  await post('/api/v1/session/view-as', { personCode: emp.personCode }, token);
  const r = await fetch('/api/v1/session/view-as', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  expect(r.status).toBe(200);
  const rows = Object.values(store.coll<{ act: string; before: unknown; after: unknown }>('audit'));
  const row = rows.find(x => x.act === 'View-as ended');
  expect(row).toMatchObject({ before: { viewingAs: emp.personCode }, after: null });
});

/* I4: view-as is gated on perm_cfg, as in the prototype (v15:10773). Holding
   integration (the audit log) alone is not enough. */
test('an account holding integration but not perm_cfg is refused view-as', async () => {
  const emp = anyAccount('employee'), target = anyAccount('manager');
  const accounts = store.db.accounts as Record<string, { grants: string[] }>;
  const record = accounts[`acc_${emp.email}`];
  if (!record) throw new Error('no seeded employee record');
  record.grants = [...record.grants, 'integration'];
  const { token, capabilities } = await (await post('/api/v1/session', { email: emp.email, password: 'Qnipay@123' })).json();
  expect(capabilities).toContain('integration');
  const r = await post('/api/v1/session/view-as', { personCode: target.personCode }, token);
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({ code: 'capability', message: expect.stringContaining('Permissions and role configuration'), next: expect.any(String) });
});

async function viewingAsEmployee() {
  const admin = anyAccount('admin'), emp = anyAccount('employee');
  const { token } = await (await post('/api/v1/session', { email: admin.email, password: 'Qnipay@123' })).json();
  const started = await post('/api/v1/session/view-as', { personCode: emp.personCode }, token);
  expect(started.status).toBe(200);
  return { token: token as string, admin, emp };
}

test('while viewing as someone, a write is refused with 403 and the store is unchanged', async () => {
  const { token } = await viewingAsEmployee();
  const before = structuredClone(store.db);
  const r = await fetch('/api/v1/user-types/employee/capabilities/proxy', { method: 'PUT',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'If-Match': '1' }, body: JSON.stringify({ granted: true }) });
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({ code: 'viewing-as', message: expect.stringContaining('changes are off'), next: expect.stringContaining('Return to your own account') });
  expect(store.db).toEqual(before);
});

test('while viewing as someone, starting another view-as is refused too', async () => {
  const { token } = await viewingAsEmployee();
  const r = await post('/api/v1/session/view-as', { personCode: anyAccount('manager').personCode }, token);
  expect(r.status).toBe(403);
  expect(await r.json()).toMatchObject({ code: 'viewing-as' });
});

test('while viewing as someone, reads still work and ending view-as still works', async () => {
  const { token, admin } = await viewingAsEmployee();
  expect((await fetch('/api/v1/session', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(200);
  const r = await fetch('/api/v1/session/view-as', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  expect(r.status).toBe(200);
  const s = await r.json();
  expect(s.viewingAs).toBeUndefined();
  expect(s.account.email).toBe(admin.email);
});

test('while viewing as someone, signing out still works', async () => {
  const { token } = await viewingAsEmployee();
  const r = await fetch('/api/v1/session', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  expect(r.status).toBe(200);
  expect((await fetch('/api/v1/session', { headers: { Authorization: `Bearer ${token}` } })).status).toBe(401);
});

/* I6: sign-in and sign-out are audited; a failed sign-in is not a change. */
type AuditRow = { act: string; entity: string; entityId: string; who: { personCode: string; name: string }; before: unknown; after: unknown };
const auditRows = () => Object.values(store.coll<AuditRow>('audit'));

test('signing in writes one audit row naming who, with no token in it', async () => {
  const acc = anyAccount('manager');
  const { token } = await (await post('/api/v1/session', { email: acc.email, password: 'Qnipay@123' })).json();
  const rows = auditRows().filter(r => r.act === 'Signed in');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ entity: 'session', entityId: acc.email, who: { personCode: acc.personCode }, before: null, after: { signedIn: true } });
  expect(JSON.stringify(rows[0])).not.toContain(token);
});

test('a failed sign-in writes no audit row', async () => {
  await post('/api/v1/session', { email: anyAccount('manager').email, password: 'nope' });
  await post('/api/v1/session', { email: 'nobody@example.org', password: 'Qnipay@123' });
  expect(auditRows()).toEqual([]);
});

test('signing out writes one audit row naming who', async () => {
  const acc = anyAccount('employee');
  const { token } = await (await post('/api/v1/session', { email: acc.email, password: 'Qnipay@123' })).json();
  await fetch('/api/v1/session', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  const rows = auditRows().filter(r => r.act === 'Signed out');
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ entity: 'session', entityId: acc.email, who: { personCode: acc.personCode }, before: { signedIn: true }, after: null });
});

/* I5: who the account menu offers to view as. */
test('the view-as list offers one person per role, never yourself, nobody who has left, at most five', async () => {
  const admin = anyAccount('admin');
  const { token } = await (await post('/api/v1/session', { email: admin.email, password: 'Qnipay@123' })).json();
  const r = await fetch('/api/v1/session/view-as/people', { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status).toBe(200);
  const people = (await r.json()) as { personCode: string; userType: string; roleName: string; locationName: string; onboarding: boolean }[];
  expect(people.length).toBeGreaterThan(0);
  expect(people.length).toBeLessThanOrEqual(5);
  expect(people.map(p => p.personCode)).not.toContain(admin.personCode);
  expect(people.filter(p => p.userType === 'manager')).toHaveLength(1);
  const gone = Object.values(store.coll<{ code: string; state: string }>('people')).filter(p => p.state === 'leaver').map(p => p.code);
  expect(people.some(p => gone.includes(p.personCode))).toBe(false);
  expect(people.every(p => p.roleName && p.locationName)).toBe(true);
});
test('the session names the account\'s role, what it is for and where they work', async () => {
  const s = await (await post('/api/v1/session', { email: anyAccount('manager').email, password: 'Qnipay@123' })).json();
  expect(s.account).toMatchObject({ roleName: 'Manager', roleDescription: expect.stringContaining('team'), locationName: expect.any(String) });
  expect(s.account.locationName.length).toBeGreaterThan(0);
});

/* 1a minor: view-as of yourself is refused, not quietly started. */
test('view-as of yourself is refused with 422 in plain words, and nothing is recorded', async () => {
  const admin = anyAccount('admin');
  const { token } = await (await post('/api/v1/session', { email: admin.email, password: 'Qnipay@123' })).json();
  const r = await post('/api/v1/session/view-as', { personCode: admin.personCode }, token);
  expect(r.status).toBe(422);
  expect(await r.json()).toMatchObject({ code: 'invalid', field: 'personCode', message: expect.stringContaining('yourself'), next: expect.any(String) });
  expect(auditRows().some(x => x.act === 'View-as started')).toBe(false);
  expect((await (await fetch('/api/v1/session', { headers: { Authorization: `Bearer ${token as string}` } })).json()).viewingAs).toBeUndefined();
});
