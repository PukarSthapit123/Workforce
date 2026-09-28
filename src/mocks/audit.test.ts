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
test('filters by who, case-insensitively, to one person\'s rows only', async () => {
  writeAudit({ who: { personCode: 'A', name: 'Dee Fitzgerald' }, act: 'Permission changed', entity: 'userType', entityId: 'employee' });
  writeAudit({ who: { personCode: 'B', name: 'Sam Okafor' }, act: 'Access exception added', entity: 'account', entityId: 'sam@x.com' });
  const r = await get('?who=FITZ');
  const names: string[] = r.items.map((i: { who: { name: string } }) => i.who.name);
  expect(names.length).toBeGreaterThan(0);
  expect(new Set(names)).toEqual(new Set(['Dee Fitzgerald']));
});

/* I9: the query is typed and validated, so a bad limit is refused, not clamped. */
test.each(['0', '-1', '1.5', 'lots', '1001'])('a limit of %s is refused with 422 naming limit', async limit => {
  const r = await fetch('/api/v1/audit?limit=' + limit, { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status).toBe(422);
  expect(await r.json()).toMatchObject({ code: 'invalid', field: 'limit', next: expect.any(String) });
});
test('a valid limit caps the page', async () => {
  for (let i = 0; i < 3; i++) writeAudit({ who: { personCode: 'X', name: 'X' }, act: 'Row ' + i, entity: 'e', entityId: '1' });
  const r = await get('?limit=2');
  expect(r.items).toHaveLength(2);
  expect(r.total).toBeGreaterThanOrEqual(3);
});
