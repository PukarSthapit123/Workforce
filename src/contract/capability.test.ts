import { server } from '@/mocks/node';
import { store } from '@/mocks/store';
import { ENDPOINTS, pathParamNames, type Endpoint } from '@/contract';

/* I9: x-capability in the contract must match the capability each handler
   actually checks. For every endpoint that names one, an account holding
   every capability except that one is refused with 403, and the same account
   holding all of them is not. A handler checking a different capability from
   the one its contract names fails one of the two. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => store.reset('social'));

interface Account { email: string; userType: string; personCode: string; grants: string[]; revocations: string[] }
const everyCapability = () => Object.keys(store.coll('capabilities'));
function employeeHolding(caps: string[]): Account {
  const emp = Object.values(store.coll<Account>('accounts')).find(a => a.userType === 'employee');
  if (!emp) throw new Error('no seeded employee');
  emp.grants = caps; emp.revocations = [];
  return emp;
}
async function tokenFor(email: string): Promise<string> {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  return ((await r.json()) as { token: string }).token;
}
const call = (e: Endpoint, token: string) => {
  let path: string = e.path;
  for (const k of pathParamNames(e.path)) path = path.replace(`:${k}`, 'no-such-record');
  return fetch(path, { method: e.method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'If-Match': '1' },
    body: e.method === 'GET' || e.method === 'DELETE' ? undefined : JSON.stringify({}) });
};

const gated = ENDPOINTS.filter(e => e.capability);
test('there are capability-gated endpoints to check', () => expect(gated.length).toBeGreaterThan(0));

for (const e of gated) {
  test(`${e.method} ${e.path} refuses a session without ${e.capability ?? ''} with 403, and lets one with it through`, async () => {
    const all = everyCapability();
    const without = employeeHolding(all.filter(c => c !== e.capability));
    const refused = await call(e, await tokenFor(without.email));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: 'capability', next: expect.any(String) });

    const withIt = employeeHolding(all);
    const allowed = await call(e, await tokenFor(withIt.email));
    expect(allowed.status).not.toBe(403);
  });
}
