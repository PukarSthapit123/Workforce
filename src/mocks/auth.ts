/* Who is asking, and what they may do. serve() calls requireSession and
   requireCapability for every endpoint, so a handler never does. Kept apart
   from the session handlers so serve.ts and every handler module can import it
   without an import cycle. */
import { store } from './store';
import { refuse } from './http';
import { resolveCapabilities } from '@/domain/capabilities';
import type { Session } from '@/contract/session';
import type { AuditEntry } from '@/contract/audit';

export interface Account { id: string; version: number; updatedAt: string; email: string; userType: Session['account']['userType']; personCode: string; grants: string[]; revocations: string[] }
export interface Person { code: string; name: string; state?: string; employeeType?: string; location?: string }
interface UserType { id: string; name?: string; description?: string; capabilities: string[] }
export interface ServerSession { token: string; email: string; viewingAs?: string }
/* What serve() hands a handler: the stored session, its account and the
   capabilities it has right now (the viewed person's, while viewing as). */
export type AuthedSession = ServerSession & { account: Account; caps: string[] };

export const sessions = () => store.coll<ServerSession>('sessions');
/* Object.hasOwn, so an address such as "__proto__" finds nothing rather than
   reaching the prototype. */
export const accountBy = (email: string): Account | undefined => {
  const accounts = store.coll<Account>('accounts'), key = `acc_${email.toLowerCase()}`;
  return Object.hasOwn(accounts, key) ? accounts[key] : undefined;
};
export const personBy = (code: string) => Object.values(store.coll<Person>('people')).find(p => p.code === code);
export const personName = (code: string) => personBy(code)?.name ?? code;
export const accountForPerson = (code: string) => Object.values(store.coll<Account>('accounts')).find(x => x.personCode === code);
const userTypeOf = (a: Account) => store.coll<UserType>('userTypes')[a.userType];
export const roleNameOf = (a: Account) => userTypeOf(a)?.name ?? a.userType.charAt(0).toUpperCase() + a.userType.slice(1);
export const locationNameOf = (p: Person | undefined) => Object.values(store.coll<{ code: string; name: string }>('locations')).find(l => l.code === p?.location)?.name ?? p?.location ?? '';
/* module 5 D8: still onboarding (candidate or preboarding) while the Onboarding module is on, as the prototype's onboarding(p) */
const STARTER = new Set(['candidate', 'preboard']);
export function onboardingNow(code: string): boolean {
  const t = store.coll<{ modules?: Record<string, boolean> }>('tenant').tenant;
  return Boolean(t?.modules?.ON) && STARTER.has(personBy(code)?.state ?? '');
}
export const capsFor = (a: Account) => resolveCapabilities(store.coll<UserType>('userTypes')[a.userType]?.capabilities ?? [], a.grants, a.revocations);

const SIGNED_OUT = { code: 'signed-out', message: 'You are signed out.', next: 'Sign in again to continue.' };

/* The session as the client sees it. */
export function sessionView(s: ServerSession): Session {
  const a = accountBy(s.email);
  /* An account can vanish (removed or revoked) while its session lingers. Treat
     that exactly like an invalid token: signed out, never an empty shell. */
  if (!a) return refuse(401, SIGNED_OUT);
  const p = personBy(a.personCode);
  const vp = s.viewingAs ? personBy(s.viewingAs) : undefined;
  const va = vp ? accountForPerson(vp.code) : undefined;
  /* The target's account can also vanish mid-view-as (removed or revoked after
     it started). Without one there is nobody valid to view as, so this drops
     back to the real signed-in account's own capabilities and omits
     viewingAs entirely, rather than quietly keeping the real account's
     capabilities under a stale, wrong-looking label. */
  const viewingAs = vp && va ? { vp, va } : undefined;
  return { token: s.token, simulated: true,
    account: { email: a.email, userType: a.userType, personCode: a.personCode, name: p?.name ?? a.email,
      roleName: roleNameOf(a), roleDescription: userTypeOf(a)?.description ?? '', locationName: locationNameOf(p) },
    capabilities: capsFor(viewingAs?.va ?? a), onboarding: onboardingNow(viewingAs?.vp.code ?? a.personCode),
    ...(viewingAs ? { viewingAs: { personCode: viewingAs.vp.code, name: viewingAs.vp.name, userType: viewingAs.va.userType, roleName: roleNameOf(viewingAs.va) } } : {}) };
}

/* View-as is a preview. While a session is viewing as someone, the only
   changes it may make are the ones its endpoint marks allowedWhileViewing
   (ending the view, signing out). Every other write is refused here, once. */
export function requireSession(request: Request, allowedWhileViewing = false): AuthedSession {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const all = sessions();
  const s = Object.hasOwn(all, token) ? all[token] : undefined;
  const a = s && accountBy(s.email);
  if (!s || !a) return refuse(401, SIGNED_OUT);
  const v = sessionView(s);
  if (v.viewingAs && request.method !== 'GET' && !allowedWhileViewing)
    refuse(403, { code: 'viewing-as', message: `You are viewing the app as ${v.viewingAs.name}, so changes are off. Nothing has been saved.`, next: 'Return to your own account first, then make the change.' });
  return { ...s, account: a, caps: v.capabilities };
}

/* The label is the capability's own, from the store, so the refusal names it
   the way the permissions page does. */
export function requireCapability(s: { caps: string[] }, cap: string) {
  if (s.caps.includes(cap)) return;
  const label = store.coll<{ label?: string }>('capabilities')[cap]?.label ?? cap;
  refuse(403, { code: 'capability', message: `This needs "${label}", which your access does not include.`, next: 'Ask an administrator to grant it on Qnipay setup → Permissions.' });
}

/* The audit row's `who`: the real signed-in person, and who they were
   viewing as at the time, if anyone. */
export const actor = (s: ServerSession & { account: Account }): AuditEntry['who'] =>
  ({ personCode: s.account.personCode, name: personBy(s.account.personCode)?.name ?? s.email, ...(s.viewingAs ? { viewingAs: s.viewingAs } : {}) });
