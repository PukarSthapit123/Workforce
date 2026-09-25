/* The fake server's database. In memory, persisted to localStorage so a reload
   keeps what the person did, and set aside wholesale when the seed changes. */
import socialSeed from './seed/social.json';
import qcicSeed from './seed/qcic.json';

export const STORE_KEY = 'qnipay.app.store';
export const SEED_VERSION = '2026-09-25.1a';
export type Collections = Record<string, Record<string, Record<string, unknown>>>;
export interface Seed { version: string; tenant: string; data: Collections }
/* What actually gets written to localStorage: a Seed plus the frozen clock, so
   a page reload (which throws away the in-memory `clock` closure below, along
   with everything else in the JS context) restores the same clock the person
   had set, not the wall clock. */
interface PersistedState extends Seed { clock: string | null }

const SEEDS: Record<string, unknown> = { social: socialSeed, qcic: qcicSeed };
const defaultSeed = (tenant = 'social') => ({ version: SEED_VERSION, tenant, data: structuredClone((SEEDS[tenant] as { data: Collections }).data) });

export function createStore(seedFor: (tenant?: string) => Seed = defaultSeed) {
  let clock: string | null = null;
  const s = {
    db: {} as Collections,
    tenant: 'social',
    now: () => clock ?? new Date().toISOString(),
    /* Saves immediately, rather than waiting for the next unrelated write, so
       the persisted clock is never stale: e.g. a browser reload straight after
       setClock(...) (as e2e's signInAs does) must see the same clock, not the
       previous one. setClock(null) persists that too, clearing it for good. */
    setClock(iso: string | null) { clock = iso; s.save(); },
    load(seed: Seed) { s.db = structuredClone(seed.data); s.tenant = seed.tenant; },
    reset(tenant?: string) { s.load(seedFor(tenant ?? s.tenant)); s.save(); },
    save() { try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: SEED_VERSION, tenant: s.tenant, data: s.db, clock } satisfies PersistedState)); } catch { /* storage full or blocked: the session still works */ } },
    boot() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          const o = JSON.parse(raw) as PersistedState;
          if (o.version === SEED_VERSION) { s.load(o); clock = o.clock ?? null; return; }
          localStorage.setItem(STORE_KEY + '.superseded', raw);
        }
      } catch { /* unreadable store: start from the seed */ }
      s.reset();
    },
    coll<T>(name: string): Record<string, T> { return (s.db[name] ??= {}) as Record<string, T>; },
  };
  return s;
}
export const store = createStore();
