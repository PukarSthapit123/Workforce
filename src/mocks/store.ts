/* The fake server's database. In memory, persisted to localStorage so a reload
   keeps what the person did, and set aside wholesale when the seed changes. */
import socialSeed from './seed/social.json';
import qcicSeed from './seed/qcic.json';

export const STORE_KEY = 'qnipay.app.store';
export const SEED_VERSION = '2026-09-25.1a';
export type Collections = Record<string, Record<string, Record<string, unknown>>>;
export interface Seed { version: string; tenant: string; data: Collections }

const SEEDS: Record<string, unknown> = { social: socialSeed, qcic: qcicSeed };
const defaultSeed = (tenant = 'social') => ({ version: SEED_VERSION, tenant, data: structuredClone((SEEDS[tenant] as { data: Collections }).data) });

export function createStore(seedFor: (tenant?: string) => Seed = defaultSeed) {
  let clock: string | null = null;
  const s = {
    db: {} as Collections,
    tenant: 'social',
    now: () => clock ?? new Date().toISOString(),
    setClock(iso: string | null) { clock = iso; },
    load(seed: Seed) { s.db = structuredClone(seed.data); s.tenant = seed.tenant; },
    reset(tenant?: string) { s.load(seedFor(tenant ?? s.tenant)); s.save(); },
    save() { try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: SEED_VERSION, tenant: s.tenant, data: s.db })); } catch { /* storage full or blocked: the session still works */ } },
    boot() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          const o = JSON.parse(raw) as Seed;
          if (o.version === SEED_VERSION) { s.load(o); return; }
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
