import { createStore, STORE_KEY, SEED_VERSION } from './store';

const seed = { version: SEED_VERSION, tenant: 'social', data: { things: { a: { id: 'a', version: 1, updatedAt: '2026-08-13T14:30:00.000Z' } } } };

beforeEach(() => localStorage.clear());

test('loads a seed and persists it under the seed version', () => {
  const s = createStore(() => seed); s.reset();
  s.save();
  const raw = localStorage.getItem(STORE_KEY);
  expect(raw).not.toBeNull();
  expect(JSON.parse(raw ?? '').version).toBe(SEED_VERSION);
});
test('a store written by an older seed is set aside, not half-loaded', () => {
  localStorage.setItem(STORE_KEY, JSON.stringify({ version: 'old', tenant: 'social', data: { things: {} } }));
  const s = createStore(() => seed); s.boot();
  expect(Object.keys(s.db.things ?? {})).toEqual(['a']);
  expect(localStorage.getItem(STORE_KEY + '.superseded')).not.toBeNull();
});
test('the clock can be set and cleared', () => {
  const s = createStore(() => seed);
  s.setClock('2026-08-13T14:30:00.000Z');
  expect(s.now()).toBe('2026-08-13T14:30:00.000Z');
  s.setClock(null);
  expect(s.now()).not.toBe('2026-08-13T14:30:00.000Z');
});
