import { http, HttpResponse, type HttpResponseResolver } from 'msw';
import { store } from './store';
import { handle, readJson, refuse } from './http';
import { writeAudit } from './audit';
import { SignInRequest, ViewAsRequest, type Session } from '@/contract/session';

/* `handle`'s own generic (A extends unknown[]) cannot be inferred from an
   unannotated destructured parameter nested two calls deep (handle(...) inside
   http.post(...)), so TypeScript falls back to a bare `{ request: any }` that
   is missing msw's other resolver-info fields (params, cookies, requestId).
   Naming the real parameter type here, once, fixes every handler below without
   touching the shared `handle` helper in http.ts. */
type ResolverInfo = Parameters<HttpResponseResolver>[0];

export const DEMO_PASSWORD = 'Qnipay@123';   // stub: shared demo password, replaced by Entra ID
interface Account { email: string; userType: Session['account']['userType']; personCode: string; grants: string[]; revocations: string[] }
interface Person { code: string; name: string }
interface UserType { id: string; capabilities: string[] }
export interface ServerSession { token: string; email: string; viewingAs?: string }

const sessions = () => store.coll<ServerSession>('sessions');
const accountBy = (email: string) => store.coll<Account>('accounts')[`acc_${email.toLowerCase()}`];
const personBy = (code: string) => Object.values(store.coll<Person>('people')).find(p => p.code === code);
/* moved to domain/capabilities.ts in Task 8 */
export const capsFor = (a: Account) => {
  const base = store.coll<UserType>('userTypes')[a.userType]?.capabilities ?? [];
  return [...new Set([...base, ...a.grants])].filter(c => !a.revocations.includes(c)).sort();
};
function view(s: ServerSession): Session {
  const a = accountBy(s.email);
  /* An account can vanish (removed or revoked) while its session lingers. Treat
     that exactly like an invalid token: signed out, never an empty shell. */
  if (!a) return refuse(401, { code: 'signed-out', message: 'You are signed out.', next: 'Sign in again to continue.' });
  const p = personBy(a.personCode);
  const vp = s.viewingAs ? personBy(s.viewingAs) : undefined;
  const va = vp ? Object.values(store.coll<Account>('accounts')).find(x => x.personCode === vp.code) : undefined;
  return { token: s.token, simulated: true,
    account: { email: a.email, userType: a.userType, personCode: a.personCode, name: p?.name ?? a.email },
    capabilities: capsFor(va ?? a),
    ...(vp ? { viewingAs: { personCode: vp.code, name: vp.name, userType: va?.userType ?? 'employee' } } : {}) };
}
export function requireSession(request: Request): ServerSession & { account: Account; caps: string[] } {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const s = sessions()[token];
  const a = s && accountBy(s.email);
  if (!s || !a) return refuse(401, { code: 'signed-out', message: 'You are signed out.', next: 'Sign in again to continue.' });
  return { ...s, account: a, caps: view(s).capabilities };
}
export function requireCapability(s: { caps: string[] }, cap: string, label: string) {
  if (!s.caps.includes(cap)) refuse(403, { code: 'capability', message: `This needs "${label}", which your access does not include.`, next: 'Ask an administrator to grant it on Qnipay setup → Permissions.' });
}
const who = (s: ServerSession & { account: Account }) => ({ personCode: s.account.personCode, name: personBy(s.account.personCode)?.name ?? s.email, ...(s.viewingAs ? { viewingAs: s.viewingAs } : {}) });

export const sessionHandlers = [
  http.get('/api/v1/session/accounts', () => HttpResponse.json(Object.values(store.coll<Account>('accounts'))
    .map(a => ({ email: a.email, userType: a.userType, personCode: a.personCode, name: personBy(a.personCode)?.name ?? a.email })))),
  http.post('/api/v1/session', handle(async ({ request }: ResolverInfo) => {
    const { email, password } = await readJson(request, SignInRequest);
    const a = accountBy(email);
    if (!a || password !== DEMO_PASSWORD) return refuse(401, { code: 'credentials', message: 'That address and password do not match an account.', next: 'Check the address and password, or pick an account from the list.' });
    const token = crypto.randomUUID();
    const created: ServerSession = { token, email: a.email };
    sessions()[token] = created;
    return HttpResponse.json(view(created));
  })),
  http.get('/api/v1/session', handle(({ request }: ResolverInfo) => HttpResponse.json(view(requireSession(request))))),
  http.delete('/api/v1/session', handle(({ request }: ResolverInfo) => { const s = requireSession(request); Reflect.deleteProperty(sessions(), s.token); return HttpResponse.json(null); })),
  http.post('/api/v1/session/view-as', handle(async ({ request }: ResolverInfo) => {
    const s = requireSession(request); requireCapability(s, 'integration', 'Integrations and audit log');
    const { personCode } = await readJson(request, ViewAsRequest);
    const p = personBy(personCode);
    if (!p) return refuse(422, { code: 'invalid', field: 'personCode', message: 'There is nobody with that employee ID.', next: 'Pick a person from the list.' });
    const updated: ServerSession = { token: s.token, email: s.email, viewingAs: personCode };
    sessions()[s.token] = updated;
    writeAudit({ who: who(s), act: 'View-as started', entity: 'session', entityId: s.account.email, before: null, after: { viewingAs: personCode } });
    return HttpResponse.json(view(updated));
  })),
  http.delete('/api/v1/session/view-as', handle(({ request }: ResolverInfo) => {
    const s = requireSession(request); const was = s.viewingAs;
    const updated: ServerSession = { token: s.token, email: s.email };
    sessions()[s.token] = updated;
    if (was) writeAudit({ who: who({ ...s, viewingAs: undefined }), act: 'View-as ended', entity: 'session', entityId: s.account.email, before: { viewingAs: was }, after: null });
    return HttpResponse.json(view(updated));
  })),
];
