/* Shared by contract and component tests: sign in against the fake server,
   call it, fault it, and read the store directly to prove what changed. */
import { store } from '@/mocks/store';
import { faults } from '@/mocks/faults';
import { setToken } from '@/api/session-token';
import type { AuditEntry } from '@/contract/audit';

export type Persona = 'employee' | 'manager' | 'admin';
export const FROZEN = '2026-08-13T14:30:00.000Z';
/* Clears faults too, so one a test set but never consumed cannot leak into the next. */
export function resetTo(tenant: 'social' | 'qnipay' = 'social') { faults.length = 0; store.reset(tenant); store.setClock(FROZEN); }

interface Acc { email: string; userType: Persona; personCode: string }
export function accountOf(t: Persona): Acc {
  const a = Object.values(store.coll<Acc>('accounts')).find(x => x.userType === t);
  if (!a) throw new Error(`the seed has no ${t} account`);
  return a;
}
export async function tokenFor(t: Persona): Promise<string> {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: accountOf(t).email, password: 'Qnipay@123' }) });
  const body = (await r.json()) as { token?: string };
  if (!body.token) throw new Error(`sign-in as ${t} failed with ${r.status}`);
  return body.token;
}
export async function signInAs(t: Persona) { const token = await tokenFor(t); setToken(token); return token; }

export interface Reply { status: number; body: unknown }
export function caller(token: string) {
  return async (method: string, url: string, body?: unknown, ifMatch?: number): Promise<Reply> => {
    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (ifMatch !== undefined) headers['If-Match'] = String(ifMatch);
    const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    return { status: r.status, body: text ? (JSON.parse(text) as unknown) : null };
  };
}
export async function fault(method: string, path: string, status = 500) {
  await fetch('/api/_dev/faults', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, path, status, times: 1 }) });
}
export const snapshot = (...collections: string[]) =>
  structuredClone(Object.fromEntries(collections.map(c => [c, store.coll(c)])));
export const audits = () => Object.values(store.coll<AuditEntry>('audit'));
export function personOf(code: string) {
  const p = Object.values(store.coll<{ id: string; code: string; version: number } & Record<string, unknown>>('people')).find(x => x.code === code);
  if (!p) throw new Error(`no person ${code} in the store`);
  return p;
}
