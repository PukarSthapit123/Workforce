import socialSeed from './seed/social.json';
import qnipaySeed from './seed/qnipay.json';
import { createStore, contentHash, STORE_KEY, STORE_REV_KEY, SEED_VERSION, DEFAULT_TENANT } from './store';

const seed = { version: SEED_VERSION, tenant: 'social', data: { things: { a: { id: 'a', version: 1, updatedAt: '2026-08-13T14:30:00.000Z' } } } };
const saved = (o: unknown) => localStorage.setItem(STORE_KEY, JSON.stringify(o));
const superseded = () => localStorage.getItem(STORE_KEY + '.superseded');

beforeEach(() => localStorage.clear());

test('loads a seed and persists it under the seed version', () => {
  const s = createStore(() => seed); s.reset();
  s.save();
  const raw = localStorage.getItem(STORE_KEY);
  expect(raw).not.toBeNull();
  expect(JSON.parse(raw ?? '').version).toBe(SEED_VERSION);
});

/* I2: the version is derived from the seed files, so nobody has to remember
   to bump it. It must at least look like a content hash, not a hand-typed
   date, and it must be stable for the same content. */
test('the seed version is derived from the seed content', () => {
  expect(SEED_VERSION).toMatch(/^\d+\.[0-9a-f]{16}$/);
  const content = JSON.stringify([['social', socialSeed], ['qnipay', qnipaySeed]]);
  expect(SEED_VERSION.split('.')[1]).toBe(contentHash(content));
  /* one changed character anywhere in a seed changes the version */
  const edited = structuredClone(socialSeed) as { data: { people: Record<string, { name: string }> } };
  const first = Object.values(edited.data.people)[0];
  if (!first) throw new Error('the social seed has no people');
  first.name += 'x';
  expect(contentHash(JSON.stringify([['social', edited], ['qnipay', qnipaySeed]]))).not.toBe(contentHash(content));
});

test('a store saved at the current version is loaded as saved', () => {
  saved({ version: SEED_VERSION, tenant: 'social', data: { things: { b: { id: 'b', version: 4, updatedAt: '2026-08-13T14:30:00.000Z' } } }, clock: null });
  const s = createStore(() => seed); s.boot();
  expect(Object.keys(s.db.things ?? {})).toEqual(['b']);
  expect(superseded()).toBeNull();
});

test('a store written by an older seed is set aside, not half-loaded', () => {
  saved({ version: '2026-09-25.1a', tenant: 'social', data: { things: {} } });
  const s = createStore(() => seed); s.boot();
  expect(Object.keys(s.db.things ?? {})).toEqual(['a']);
  expect(superseded()).not.toBeNull();
});

test('corrupt JSON boots cleanly on the seed', () => {
  localStorage.setItem(STORE_KEY, '{"version": "2.');
  const s = createStore(() => seed);
  expect(() => s.boot()).not.toThrow();
  expect(Object.keys(s.db.things ?? {})).toEqual(['a']);
  expect(superseded()).toBe('{"version": "2.');
});

test('a store for a tenant this build has no seed for boots on the default tenant', () => {
  saved({ version: SEED_VERSION, tenant: 'qcic', data: { things: {} }, clock: null });
  const s = createStore(); s.boot();
  expect(s.tenant).toBe(DEFAULT_TENANT);
  expect(Object.keys(s.db.accounts ?? {}).length).toBeGreaterThan(0);
  expect(superseded()).not.toBeNull();
  /* and a reset afterwards works, rather than throwing on SEEDS['qcic'] */
  expect(() => s.reset()).not.toThrow();
});

test('a same-version store with no data object is set aside', () => {
  saved({ version: SEED_VERSION, tenant: 'social', clock: null });
  const s = createStore(() => seed); s.boot();
  expect(Object.keys(s.db.things ?? {})).toEqual(['a']);
  expect(superseded()).not.toBeNull();
});

test('a same-version store whose data is not an object is set aside', () => {
  saved({ version: SEED_VERSION, tenant: 'social', data: [1, 2], clock: null });
  const s = createStore(() => seed); s.boot();
  expect(Object.keys(s.db.things ?? {})).toEqual(['a']);
});

test('the clock can be set and cleared', () => {
  const s = createStore(() => seed);
  s.setClock('2026-08-13T14:30:00.000Z');
  expect(s.now()).toBe('2026-08-13T14:30:00.000Z');
  s.setClock(null);
  expect(s.now()).not.toBe('2026-08-13T14:30:00.000Z');
});
test('the clock survives a reload: a fresh store boots up with what save persisted', () => {
  const s = createStore(() => seed);
  s.reset();
  s.setClock('2026-08-13T14:30:00.000Z');
  const rebooted = createStore(() => seed);
  rebooted.boot();
  expect(rebooted.now()).toBe('2026-08-13T14:30:00.000Z');
});
test('setClock(null) clears the persisted clock too, not just the in-memory one', () => {
  const s = createStore(() => seed);
  s.reset();
  s.setClock('2026-08-13T14:30:00.000Z');
  s.setClock(null);
  const rebooted = createStore(() => seed);
  rebooted.boot();
  expect(rebooted.now()).not.toBe('2026-08-13T14:30:00.000Z');
});

/* I1: two tabs share localStorage but each holds its own copy in memory. */
describe('sync between tabs', () => {
  test('a tab reloads before a request when another tab has saved since', () => {
    const tabA = createStore(() => seed); tabA.boot();
    const tabB = createStore(() => seed); tabB.boot();
    tabA.coll<{ id: string; version: number }>('things').a = { id: 'a', version: 2 };
    tabA.save();
    expect(tabB.coll<{ version: number }>('things').a?.version).toBe(1);
    tabB.sync();
    expect(tabB.coll<{ version: number }>('things').a?.version).toBe(2);
  });
  test('a tab keeps its own copy when nothing new was saved, so in-memory state is not thrown away', () => {
    const tab = createStore(() => seed); tab.boot();
    tab.coll<{ id: string }>('things').c = { id: 'c' };
    tab.sync();
    expect(Object.keys(tab.db.things ?? {})).toContain('c');
  });
  test('every save writes a new revision', () => {
    const tab = createStore(() => seed); tab.boot();
    const first = localStorage.getItem(STORE_REV_KEY);
    tab.save();
    expect(localStorage.getItem(STORE_REV_KEY)).not.toBe(first);
  });
});
