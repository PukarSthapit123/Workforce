/* What every 1b handler reads: people, accounts, scope, who is acting, and the
   views the contract promises. One place, so two handlers cannot disagree. */
import { store } from './store';
import { refuse } from './http';
import type { AuthedSession } from './auth';
import type { Person } from '@/contract/people';
import { maskBank } from '@/domain/selfService';
import type { UsageWorld } from '@/domain/usage';
import type { PersonContext } from '@/domain/people';

export type Signed = AuthedSession;
export type StoredPerson = Omit<Person, 'userType'>;
export interface StoredAccount {
  id: string; version: number; updatedAt: string; email: string; personCode: string;
  userType: 'employee' | 'manager' | 'admin'; grants: string[]; revocations: string[];
}
interface Coded { code: string; name: string }

export const people = () => store.coll<StoredPerson>('people');
export const accounts = () => store.coll<StoredAccount>('accounts');
export const personByCode = (code: string) => Object.values(people()).find(p => p.code === code);
export const accountOfPerson = (code: string) => Object.values(accounts()).find(a => a.personCode === code);
export const codesOf = (collection: string) => Object.values(store.coll<Coded>(collection)).map(r => r.code);
export const nameOf = (collection: string, code: string) => Object.values(store.coll<Coded>(collection)).find(r => r.code === code)?.name ?? code;
export const today = () => store.now().slice(0, 10);
/* Object.hasOwn, so an id such as "__proto__" finds nothing. */
export const recordAt = <T>(coll: Record<string, T>, id: string): T | undefined => (Object.hasOwn(coll, id) ? coll[id] : undefined);

/* the person whose eyes the caller is using: their own, or the one they view as */
export const effectiveCode = (s: Signed) => s.viewingAs ?? s.account.personCode;
export const personView = (p: StoredPerson): Person =>
  ({ ...p, bankAccount: maskBank(p.bankAccount), userType: accountOfPerson(p.code)?.userType ?? null });

export const personContext = (): PersonContext => ({
  people: Object.values(people()), locations: codesOf('locations'), departments: codesOf('departments'),
  jobProfiles: codesOf('jobProfiles'), employeeTypes: codesOf('employeeTypes'),
});
export const usageWorld = (): UsageWorld => ({
  people: Object.values(people()),
  locations: Object.values(store.coll<UsageWorld['locations'][number]>('locations')),
  projects: Object.values(store.coll<UsageWorld['projects'][number]>('projects')),
});

/* Ids are a zero-padded counter, one past the highest stored, as audit ids
   are: they sort in write order even when the frozen clock gives two entries
   the same timestamp, and stay unique across a reload and across tabs. */
const HIST = /^hist_(\d{12})$/;
function nextHistoryId(): string {
  let max = 0;
  for (const id of Object.keys(store.coll('personHistory'))) max = Math.max(max, Number(HIST.exec(id)?.[1] ?? 0));
  return `hist_${String(max + 1).padStart(12, '0')}`;
}
export function writeHistory(personCode: string, by: { personCode: string; name: string },
  source: 'created' | 'edited' | 'transition' | 'profile-change', changes: readonly { field: string; from: string; to: string }[], reason?: string) {
  for (const c of changes) {
    const id = nextHistoryId();
    store.coll('personHistory')[id] = { id, personCode, at: store.now(), by: { personCode: by.personCode, name: by.name }, source, ...c, ...(reason ? { reason } : {}) };
  }
}

/* D5 and D6: master data reaches everyone; otherwise the caller's own location */
export function scopeOf(s: Signed): { all: true } | { all: false; location: string } {
  if (s.caps.includes('master_data')) return { all: true };
  return { all: false, location: personByCode(effectiveCode(s))?.location ?? '' };
}
export const inScope = (s: Signed, location: string) => { const sc = scopeOf(s); return sc.all || sc.location === location; };
export function requireScope(s: Signed, location: string) {
  const sc = scopeOf(s);
  if (sc.all || sc.location === location) return;
  refuse(403, { code: 'scope', message: `You can add, edit and move people at ${nameOf('locations', sc.location)} only.`,
    next: 'Ask an administrator to make changes at other locations.' });
}
export const isSelf = (s: Signed, p: StoredPerson) => p.code === effectiveCode(s);
