import { server } from './node';
import { store } from './store';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
let token = '';

interface SeedAccount { email: string; version: number; userType: string; personCode: string; grants: string[]; revocations: string[] }
interface SeedUserType { version: number; capabilities: string[] }
interface SeedAudit { act: string; before: unknown; after: unknown }

/* `as unknown as Record<...>` rather than a single `as`: TS's "sufficient overlap"
   heuristic refuses a direct cast from the store's `Record<string, unknown>` value
   type to an interface with several required properties. Going through `unknown`
   first is what the compiler itself suggests. */
const accounts = () => store.db.accounts as unknown as Record<string, SeedAccount>;
const userTypes = () => store.db.userTypes as unknown as Record<string, SeedUserType>;
const auditRows = () => store.db.audit as unknown as Record<string, SeedAudit>;

function acc(userType: string): SeedAccount {
  const found = Object.values(accounts()).find(a => a.userType === userType);
  if (!found) throw new Error(`no seeded account with userType "${userType}"`);
  return found;
}
function otherAccountOfSameType(email: string, userType: string): SeedAccount | undefined {
  return Object.values(accounts()).find(a => a.userType === userType && a.email !== email);
}
function accountByEmail(email: string): SeedAccount {
  const found = accounts()[`acc_${email.toLowerCase()}`];
  if (!found) throw new Error(`no seeded account for "${email}"`);
  return found;
}
function ut(id: string): SeedUserType {
  const found = userTypes()[id];
  if (!found) throw new Error(`no seeded user type "${id}"`);
  return found;
}
function audits(): SeedAudit[] { return Object.values(auditRows()); }
function findAudit(act: string): SeedAudit {
  const found = audits().find(x => x.act === act);
  if (!found) throw new Error(`no audit entry with act "${act}"`);
  return found;
}

const req = (method: string, url: string, body?: unknown, ifMatch?: number) => fetch(url, {
  method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(ifMatch === undefined ? {} : { 'If-Match': String(ifMatch) }) },
});

async function signIn(email: string): Promise<void> {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const s = (await r.json()) as { token: string };
  token = s.token;
}

beforeEach(async () => {
  store.reset('social');
  await signIn(acc('admin').email);
});

test('granting a capability to a template changes it once, bumps its version, and is audited before -> after', async () => {
  const v = ut('employee').version, had = ut('employee').capabilities.includes('proxy');
  const r = await req('PUT', '/api/v1/user-types/employee/capabilities/proxy', { granted: !had }, v);
  expect(r.status).toBe(200);
  expect(ut('employee').version).toBe(v + 1);
  expect(ut('employee').capabilities.includes('proxy')).toBe(!had);
  const a = findAudit('Permission changed');
  expect(a).toMatchObject({ before: { proxy: had }, after: { proxy: !had } });
});

test('a stale version is refused with 412 and nothing changes', async () => {
  const before = structuredClone(ut('employee'));
  const r = await req('PUT', '/api/v1/user-types/employee/capabilities/proxy', { granted: true }, before.version - 1 < 0 ? 999 : before.version - 1);
  expect(r.status).toBe(412);
  expect(ut('employee')).toEqual(before);
});

test('an admin cannot revoke their own way back to this page', async () => {
  const r = await req('PUT', '/api/v1/user-types/admin/capabilities/perm_cfg', { granted: false }, ut('admin').version);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({ code: 'locked', next: expect.any(String) });
  expect(ut('admin').capabilities).toContain('perm_cfg');
});

test('a per-user exception needs a reason, is audited, and changes that user\'s capabilities only', async () => {
  const emp = acc('employee');
  const other = otherAccountOfSameType(emp.email, 'employee');
  const account = accountByEmail(emp.email);
  const noReason = await req('POST', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, { capability: 'proxy', mode: 'grant', reason: '' }, account.version);
  expect(noReason.status).toBe(422);
  const ok = await req('POST', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, { capability: 'proxy', mode: 'grant', reason: 'Covers the rota lead on Fridays' }, account.version);
  expect(ok.status).toBe(200);
  expect(accountByEmail(emp.email).grants).toContain('proxy');
  if (other) expect(accountByEmail(other.email).grants).not.toContain('proxy');
  expect(audits().some(x => x.act === 'Access exception added')).toBe(true);
});

test('granting a capability the template already has is refused, and the count stays correct', async () => {
  const emp = acc('employee');
  const account = accountByEmail(emp.email);
  const r = await req('POST', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, { capability: 'own_ts', mode: 'grant', reason: 'Trying to add what they already have' }, account.version);
  expect(r.status).toBe(422);
  expect(await r.json()).toMatchObject({ code: 'invalid', field: 'capability' });
  const after = accountByEmail(emp.email);
  expect(after.grants).toEqual(account.grants);
  expect(after.version).toBe(account.version);
});

test('revoking a capability the template lacks is refused, and the count stays correct', async () => {
  const emp = acc('employee');
  const account = accountByEmail(emp.email);
  const r = await req('POST', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, { capability: 'proxy', mode: 'revoke', reason: 'Trying to take away what they never had' }, account.version);
  expect(r.status).toBe(422);
  expect(await r.json()).toMatchObject({ code: 'invalid', field: 'capability' });
  const after = accountByEmail(emp.email);
  expect(after.revocations).toEqual(account.revocations);
  expect(after.version).toBe(account.version);
});

test('granting the same exception twice is a no-op the second time: no version bump, no second audit row', async () => {
  const emp = acc('employee');
  const account = accountByEmail(emp.email);
  const first = await req('POST', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, { capability: 'proxy', mode: 'grant', reason: 'Covers the rota lead on Fridays' }, account.version);
  expect(first.status).toBe(200);
  const afterFirst = accountByEmail(emp.email);
  const second = await req('POST', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, { capability: 'proxy', mode: 'grant', reason: 'Same again' }, afterFirst.version);
  expect(second.status).toBe(200);
  const afterSecond = accountByEmail(emp.email);
  expect(afterSecond.version).toBe(afterFirst.version);
  expect(afterSecond.grants).toEqual(afterFirst.grants);
  expect(audits().filter(x => x.act === 'Access exception added').length).toBe(1);
});

test('removing an exception restores the template default, bumps the version, and is audited', async () => {
  const emp = acc('employee');
  const account = accountByEmail(emp.email);
  const granted = await req('POST', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, { capability: 'proxy', mode: 'grant', reason: 'Covers the rota lead on Fridays' }, account.version);
  expect(granted.status).toBe(200);
  const withGrant = accountByEmail(emp.email);
  const removed = await req('DELETE', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions/proxy`, undefined, withGrant.version);
  expect(removed.status).toBe(200);
  const after = accountByEmail(emp.email);
  expect(after.grants).not.toContain('proxy');
  expect(after.version).toBe(withGrant.version + 1);
  expect(audits().some(x => x.act === 'Access exception removed')).toBe(true);
});

test('removing a capability that is not an exception is refused', async () => {
  const emp = acc('employee');
  const account = accountByEmail(emp.email);
  const r = await req('DELETE', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions/proxy`, undefined, account.version);
  expect(r.status).toBe(422);
  expect(await r.json()).toMatchObject({ code: 'invalid', field: 'capability' });
  expect(accountByEmail(emp.email)).toEqual(account);
});

test('a stale version on removing an exception is refused with 412 and nothing changes', async () => {
  const emp = acc('employee');
  const account = accountByEmail(emp.email);
  const granted = await req('POST', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, { capability: 'proxy', mode: 'grant', reason: 'Covers the rota lead on Fridays' }, account.version);
  expect(granted.status).toBe(200);
  const before = structuredClone(accountByEmail(emp.email));
  const r = await req('DELETE', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions/proxy`, undefined, before.version - 1);
  expect(r.status).toBe(412);
  expect(accountByEmail(emp.email)).toEqual(before);
});

/* M1: revoking perm_cfg from yourself is refused unconditionally, whoever
   else still holds it, on every path that could do it. Another administrator
   has to make the change. */
const SELF_NEXT = 'Ask another administrator to make this change.';
async function grantPermCfgTo(email: string): Promise<void> {
  const r = await req('POST', `/api/v1/users/${encodeURIComponent(email)}/exceptions`, { capability: 'perm_cfg', mode: 'grant', reason: 'Covering setup while the admin is away' }, accountByEmail(email).version);
  expect(r.status).toBe(200);
}

test('revoking perm_cfg from yourself is refused even when someone else still holds it', async () => {
  const emp = acc('employee');
  await grantPermCfgTo(emp.email);
  const admin = accountByEmail(acc('admin').email);
  const r = await req('POST', `/api/v1/users/${encodeURIComponent(admin.email)}/exceptions`, { capability: 'perm_cfg', mode: 'revoke', reason: 'Handing off to the covering employee' }, admin.version);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({ code: 'locked', next: SELF_NEXT });
  expect(accountByEmail(admin.email)).toEqual(admin);
});

test('removing your own perm_cfg grant is refused even when someone else still holds it', async () => {
  const emp = acc('employee');
  await grantPermCfgTo(emp.email);
  await signIn(emp.email);
  const before = accountByEmail(emp.email);
  const r = await req('DELETE', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions/perm_cfg`, undefined, before.version);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({ code: 'locked', next: SELF_NEXT });
  expect(accountByEmail(emp.email)).toEqual(before);
});

test('removing perm_cfg from your own user type is refused, even a template that is not locked', async () => {
  /* perm_cfg's lockedFor is only ["admin"] (see seed/social.json), so the
     lockedFor guard alone would let this through for "manager". */
  const types = userTypes();
  const manager = ut('manager');
  types.manager = { ...manager, capabilities: [...manager.capabilities, 'perm_cfg'] };
  await signIn(acc('manager').email);
  const before = structuredClone(ut('manager'));
  const beforeStore = structuredClone(store.db);
  const r = await req('PUT', '/api/v1/user-types/manager/capabilities/perm_cfg', { granted: false }, before.version);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({ code: 'locked', message: expect.stringContaining('your own user type'), next: SELF_NEXT });
  expect(ut('manager')).toEqual(before);
  expect(store.db).toEqual(beforeStore);
});

test('another administrator can take perm_cfg away, since the one making the change still holds it', async () => {
  const emp = acc('employee');
  await grantPermCfgTo(emp.email);
  const admin = acc('admin');
  const r = await req('DELETE', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions/perm_cfg`, undefined, accountByEmail(emp.email).version);
  expect(r.status).toBe(200);
  expect(accountByEmail(emp.email).grants).not.toContain('perm_cfg');
  expect(accountByEmail(admin.email).revocations).not.toContain('perm_cfg');
});

test('a manager is refused, naming the capability', async () => {
  await signIn(acc('manager').email);
  const r = await req('GET', '/api/v1/user-types');
  expect(r.status).toBe(403);
  const body = (await r.json()) as { message: string };
  expect(body.message).toMatch(/Permissions and role configuration/);
});
