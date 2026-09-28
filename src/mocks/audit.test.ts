import { server } from './node';
import { store } from './store';
import { writeAudit } from './audit';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
let token = '';
beforeEach(async () => {
  store.reset('social'); store.setClock('2026-08-13T14:30:00.000Z');
  const admin = Object.values(store.db.accounts as Record<string, { email: string; userType: string }>).find(a => a.userType === 'admin');
  if (!admin) throw new Error('no seeded admin account');
  token = (await (await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: 'Qnipay@123' }) })).json()).token;
});
const get = async (q = '') => (await fetch('/api/v1/audit' + q, { headers: { Authorization: `Bearer ${token}` } })).json();

test('newest first, stamped from the server clock', async () => {
  writeAudit({ who: { personCode: 'X', name: 'X' }, act: 'First', entity: 'e', entityId: '1' });
  store.setClock('2026-08-13T14:31:00.000Z');
  writeAudit({ who: { personCode: 'X', name: 'X' }, act: 'Second', entity: 'e', entityId: '1' });
  const r = await get();
  expect(r.items.map((i: { act: string }) => i.act).slice(0, 2)).toEqual(['Second', 'First']);
  expect(r.items[0].at).toBe('2026-08-13T14:31:00.000Z');
});
test('filters by entity and free text', async () => {
  writeAudit({ who: { personCode: 'X', name: 'Dee' }, act: 'Permission changed', entity: 'userType', entityId: 'employee' });
  writeAudit({ who: { personCode: 'X', name: 'Dee' }, act: 'View-as started', entity: 'session', entityId: 'a@b' });
  expect((await get('?entity=userType')).items.every((i: { entity: string }) => i.entity === 'userType')).toBe(true);
  expect((await get('?q=view-as')).items.map((i: { act: string }) => i.act)).toEqual(['View-as started']);
});
