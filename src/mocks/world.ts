/* What every 1b handler reads: employees, accounts, scope, who is acting, and the
   views the contract promises. One place, so two handlers cannot disagree. */
import { store } from './store';
import { refuse } from './http';
import type { AuthedSession } from './auth';
import type { Employee } from '@/contract/employees';
import { maskBank } from '@/domain/selfService';
import type { UsageWorld } from '@/domain/usage';
import type { EmployeeContext } from '@/domain/employees';
import { clockAt, localeOf } from '@/domain/time';

export type Signed = AuthedSession;
export type StoredEmployee = Omit<Employee, 'userType'>;
export interface StoredAccount {
  id: string; version: number; updatedAt: string; email: string; employeeCode: string;
  userType: 'employee' | 'manager' | 'admin'; grants: string[]; revocations: string[];
}
interface Coded { code: string; name: string }

export const employees = () => store.coll<StoredEmployee>('employees');
export const accounts = () => store.coll<StoredAccount>('accounts');
export const employeeByCode = (code: string) => Object.values(employees()).find(p => p.code === code);
export const accountOfEmployee = (code: string) => Object.values(accounts()).find(a => a.employeeCode === code);
export const codesOf = (collection: string) => Object.values(store.coll<Coded>(collection)).map(r => r.code);
export const nameOf = (collection: string, code: string) => Object.values(store.coll<Coded>(collection)).find(r => r.code === code)?.name ?? code;
export const today = () => clockAt(store.now(), localeOf(store.coll<Record<string, unknown>>('tenant').tenant).timezone).date;
/* Object.hasOwn, so an id such as "__proto__" finds nothing. */
export const recordAt = <T>(coll: Record<string, T>, id: string): T | undefined => (Object.hasOwn(coll, id) ? coll[id] : undefined);

/* the employee whose eyes the caller is using: their own, or the one they view as */
export const effectiveCode = (s: Signed) => s.viewingAs ?? s.account.employeeCode;
export const employeeView = (p: StoredEmployee): Employee =>
  ({ ...p, bankAccount: maskBank(p.bankAccount), userType: accountOfEmployee(p.code)?.userType ?? null });

export const employeeContext = (): EmployeeContext => ({
  employees: Object.values(employees()), locations: codesOf('locations'), departments: codesOf('departments'),
  jobProfiles: codesOf('jobProfiles'), employeeTypes: codesOf('employeeTypes'),
});
export const usageWorld = (): UsageWorld => ({
  employees: Object.values(employees()),
  locations: Object.values(store.coll<UsageWorld['locations'][number]>('locations')),
  projects: Object.values(store.coll<UsageWorld['projects'][number]>('projects')),
  onboardingTemplates: Object.values(store.coll<NonNullable<UsageWorld['onboardingTemplates']>[number]>('onboardingTemplates')),
});

/* Ids are a zero-padded counter, one past the highest stored, as audit ids
   are: they sort in write order even when the frozen clock gives two entries
   the same timestamp, and stay unique across a reload and across tabs. */
const HIST = /^hist_(\d{12})$/;
function nextHistoryId(): string {
  let max = 0;
  for (const id of Object.keys(store.coll('employeeHistory'))) max = Math.max(max, Number(HIST.exec(id)?.[1] ?? 0));
  return `hist_${String(max + 1).padStart(12, '0')}`;
}
export function writeHistory(employeeCode: string, by: { employeeCode: string; name: string },
  source: 'created' | 'edited' | 'transition' | 'profile-change', changes: readonly { field: string; from: string; to: string }[], reason?: string) {
  for (const c of changes) {
    const id = nextHistoryId();
    store.coll('employeeHistory')[id] = { id, employeeCode, at: store.now(), by: { employeeCode: by.employeeCode, name: by.name }, source, ...c, ...(reason ? { reason } : {}) };
  }
}

/* D5 and D6: master data reaches everyone; otherwise the caller's own location */
export function scopeOf(s: Signed): { all: true } | { all: false; location: string } {
  if (s.caps.includes('master_data')) return { all: true };
  return { all: false, location: employeeByCode(effectiveCode(s))?.location ?? '' };
}
export const inScope = (s: Signed, location: string) => { const sc = scopeOf(s); return sc.all || sc.location === location; };
export function requireScope(s: Signed, location: string) {
  const sc = scopeOf(s);
  if (sc.all || sc.location === location) return;
  refuse(403, { code: 'scope', message: `You can add, edit and move employees at ${nameOf('locations', sc.location)} only.`,
    next: 'Ask an administrator to make changes at other locations.' });
}
export const isSelf = (s: Signed, p: StoredEmployee) => p.code === effectiveCode(s);
