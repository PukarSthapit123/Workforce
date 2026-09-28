import { ENDPOINTS } from '@/contract';
import { handlers } from './handlers';
import { faultsHandler } from './faults';
import { devHandlers } from './dev';
import { SERVED, SERVED_HANDLERS } from './serve';

/* Every endpoint in the contract registry reaches the fake server through
   serve(), so session, capability, validation and version checks can never be
   skipped by a handler written by hand. */
const key = (e: { method: string; path: string }) => `${e.method} ${e.path}`;
test('every endpoint in the registry is served through serve(), and serve() serves nothing else', () => {
  expect(ENDPOINTS.length).toBeGreaterThan(0);
  expect(ENDPOINTS.filter(e => !SERVED.has(e)).map(key)).toEqual([]);
  expect([...SERVED].filter(e => !ENDPOINTS.includes(e)).map(key)).toEqual([]);
});
test('every handler the fake server runs is a serve() handler, apart from faults and the _dev controls', () => {
  const others = handlers.filter(h => h !== faultsHandler && !devHandlers.includes(h) && !SERVED_HANDLERS.has(h));
  expect(others.map(h => h.info.header)).toEqual([]);
});
