/* The fake server's database. In memory, persisted to localStorage so a reload
   keeps what the person did, and set aside wholesale when the seed changes. */
import socialSeed from './seed/social.json';
import qnipaySeed from './seed/qnipay.json';

export const STORE_KEY = 'qnipay.app.store';
/* Written after every save with a fresh value. Another tab compares it with
   the one it last saw before handling a request, so it never answers from a
   copy of the database that is older than what is persisted (see sync). */
export const STORE_REV_KEY = STORE_KEY + '.rev';
export type Collections = Record<string, Record<string, Record<string, unknown>>>;
export interface Seed { version: string; tenant: string; data: Collections }
/* What actually gets written to localStorage: a Seed plus the frozen clock, so
   a page reload (which throws away the in-memory `clock` closure below, along
   with everything else in the JS context) restores the same clock the person
   had set, not the wall clock. */
interface PersistedState extends Seed { clock: string | null }

const SEEDS: Record<string, { data: Collections }> = { social: socialSeed as { data: Collections }, qnipay: qnipaySeed as { data: Collections } };
export const TENANTS = Object.keys(SEEDS);
export const DEFAULT_TENANT = 'social';
export const isTenant = (t: unknown): t is string => typeof t === 'string' && Object.hasOwn(SEEDS, t);

/* Bump only when the persisted shape changes in a way the seed files do not
   show (for example a new top-level field in PersistedState). */
const STORE_FORMAT = 2;
/* FNV-1a, run twice with different offsets for 64 bits. Not cryptographic:
   it only has to change whenever a seed file's content changes. */
export function contentHash(text: string): string {
  const run = (offset: number) => {
    let h = offset;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  return run(0x811c9dc5) + run(0x01000193);
}
/* Derived from the seed files themselves, so every seed change sets aside a
   store saved under the old seed. Nobody has to remember to bump it. */
export const SEED_VERSION = `${STORE_FORMAT}.${contentHash(JSON.stringify(TENANTS.map(t => [t, SEEDS[t]])))}`;

const defaultSeed = (tenant = DEFAULT_TENANT): Seed => {
  const seed = SEEDS[tenant];
  if (!seed) throw new Error(`There is no seed for tenant "${tenant}".`);
  return { version: SEED_VERSION, tenant, data: structuredClone(seed.data) };
};

/* A persisted store is loaded only when it is exactly what this build would
   have written: the same seed version, a known tenant and a data object.
   Anything else (an older seed, a tenant this build does not have, corrupt
   or half-written JSON) is set aside and the app starts from the seed. */
function readPersisted(raw: string, knownTenant: (t: unknown) => boolean): PersistedState | null {
  let o: unknown;
  try { o = JSON.parse(raw); } catch { return null; }
  if (!o || typeof o !== 'object') return null;
  const p = o as Partial<PersistedState>;
  if (p.version !== SEED_VERSION || !knownTenant(p.tenant)) return null;
  if (!p.data || typeof p.data !== 'object' || Array.isArray(p.data)) return null;
  return { version: p.version, tenant: p.tenant as string, data: p.data, clock: typeof p.clock === 'string' ? p.clock : null };
}

export function createStore(seedFor: (tenant?: string) => Seed = defaultSeed, knownTenant: (t: unknown) => boolean = isTenant) {
  let clock: string | null = null;
  /* The revision this copy was loaded from or last saved as. */
  let rev: string | null = null;
  let revSeq = 0;
  const s = {
    db: {} as Collections,
    tenant: DEFAULT_TENANT,
    now: () => clock ?? new Date().toISOString(),
    /* Saves immediately, rather than waiting for the next unrelated write, so
       the persisted clock is never stale: e.g. a browser reload straight after
       setClock(...) (as e2e's signInAs does) must see the same clock, not the
       previous one. setClock(null) persists that too, clearing it for good. */
    setClock(iso: string | null) { clock = iso; s.save(); },
    load(seed: Seed) { s.db = structuredClone(seed.data); s.tenant = seed.tenant; },
    /* Throws for a tenant this build has no seed for; _dev/seed refuses that
       with a 422 before it gets here. */
    reset(tenant?: string) { s.load(seedFor(tenant ?? s.tenant)); s.save(); },
    save() {
      try {
        localStorage.setItem(STORE_KEY, JSON.stringify({ version: SEED_VERSION, tenant: s.tenant, data: s.db, clock } satisfies PersistedState));
        rev = `${Date.now().toString(36)}.${(revSeq++).toString(36)}.${Math.random().toString(36).slice(2)}`;
        localStorage.setItem(STORE_REV_KEY, rev);
      } catch { /* storage full or blocked: the session still works */ }
    },
    boot() {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(STORE_KEY);
        rev = localStorage.getItem(STORE_REV_KEY);
      } catch { /* storage blocked: start from the seed */ }
      const o = raw ? readPersisted(raw, knownTenant) : null;
      if (o) { s.load(o); clock = o.clock; return; }
      if (raw) { try { localStorage.setItem(STORE_KEY + '.superseded', raw); } catch { /* nowhere to keep it */ } }
      s.reset(DEFAULT_TENANT);
    },
    /* Called before every request in the browser. Each tab runs its own copy
       of the fake server with its own copy of the database, so without this
       a second tab would check a write against its own stale copy, accept it,
       and then overwrite the first tab's change and audit row when it saved.
       Reading the revision here, in the request path rather than from a
       storage event, also covers a write that lands just before the request. */
    sync() {
      let current: string | null;
      try { current = localStorage.getItem(STORE_REV_KEY); } catch { return; }
      if (current !== rev) s.boot();
    },
    coll<T>(name: string): Record<string, T> { return (s.db[name] ??= {}) as Record<string, T>; },
  };
  return s;
}
export const store = createStore();
