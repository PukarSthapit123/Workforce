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

test('a manager is refused, naming the capability', async () => {
  await signIn(acc('manager').email);
  const r = await req('GET', '/api/v1/user-types');
  expect(r.status).toBe(403);
  const body = (await r.json()) as { message: string };
  expect(body.message).toMatch(/Permissions and role configuration/);
});
