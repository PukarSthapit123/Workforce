import { server } from './node';
import { store, STORE_BACKUP_KEY } from './store';
import { SavedData, SavedDataExport } from '@/contract/saved-data';
import { audits, caller, resetTo, tokenFor } from '@/test/api-helpers';

/* Saved data (D14): reset sets what was here aside and returns to the seed,
   restore brings the set-aside session back once, and the person doing it
   stays signed in throughout. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => { resetTo('social'); localStorage.removeItem(STORE_BACKUP_KEY); });
const S = '/api/v1/saved-data';
const tenantName = () => (store.coll<{ name: string }>('tenant').tenant?.name ?? '');
const rename = (name: string) => { const t = store.coll<{ name: string }>('tenant').tenant; if (t) t.name = name; };

test('reset returns to the seed, sets the session aside, keeps the caller signed in with one audit row, and restore brings it back once', async () => {
  const call = caller(await tokenFor('admin'));
  rename('Renamed in this session');
  expect(SavedData.parse((await call('GET', S)).body)).toMatchObject({ setAside: false, saving: true });

  const reset = await call('POST', `${S}/reset`);
  expect(reset.status).toBe(200);
  expect(SavedData.parse(reset.body).setAside).toBe(true);
  expect(tenantName()).not.toBe('Renamed in this session');
  expect(audits().map(a => a.act)).toEqual(['Saved data reset']);
  expect((await call('GET', S)).status).toBe(200);

  const restored = await call('POST', `${S}/restore`);
  expect(restored.status).toBe(200);
  expect(SavedData.parse(restored.body).setAside).toBe(false);
  expect(tenantName()).toBe('Renamed in this session');
  expect(audits().filter(a => a.act === 'Earlier session brought back')).toHaveLength(1);

  const again = await call('POST', `${S}/restore`);
  expect(again).toMatchObject({ status: 409, body: { code: 'NOTHING_SET_ASIDE', message: 'Nothing was set aside to bring back.' } });
});

test('the export holds every collection but the sign-in sessions, and an employee cannot read it', async () => {
  const file = SavedDataExport.parse((await caller(await tokenFor('admin'))('GET', `${S}/export`)).body);
  expect(file).toMatchObject({ kind: 'qnipay.state', v: 1, tenant: 'social' });
  expect(file.data.tenant).toBeDefined();
  expect(file.data.sessions).toBeUndefined();
  expect((await caller(await tokenFor('employee'))('GET', `${S}/export`)).status).toBe(403);
});
