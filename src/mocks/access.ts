import { http, HttpResponse, type HttpResponseResolver } from 'msw';
import { store } from './store';
import { bump, checkVersion, handle, readJson, refuse } from './http';
import { requireCapability, requireSession } from './session';
import { writeAudit } from './audit';
import { AddException, SetTemplateCapability, type Capability, type UserType } from '@/contract/access';

/* Same inference workaround as session.ts's and tenant.ts's ResolverInfo: `handle`'s
   generic cannot be inferred from an unannotated destructured parameter nested inside
   http.get/put/post/delete(...), so the real msw resolver-info type is named here once. */
type ResolverInfo = Parameters<HttpResponseResolver>[0];

interface Account { id: string; version: number; updatedAt: string; email: string; personCode: string; userType: string; grants: string[]; revocations: string[] }
const LABEL = 'Permissions and role configuration';
const gate = (request: Request) => { const s = requireSession(request); requireCapability(s, 'perm_cfg', LABEL); return s; };
const personName = (code: string) => Object.values(store.coll<{ code: string; name: string }>('people')).find(p => p.code === code)?.name ?? code;
const who = (s: ReturnType<typeof requireSession>) => ({ personCode: s.account.personCode, name: personName(s.account.personCode), ...(s.viewingAs ? { viewingAs: s.viewingAs } : {}) });
const capBy = (id: string) => store.coll<Capability>('capabilities')[id] ?? refuse(404, { code: 'not-found', message: `There is no capability "${id}".`, next: 'Reload the page.' });
const userView = (a: Account) => ({
  id: a.id, version: a.version, updatedAt: a.updatedAt, email: a.email, personCode: a.personCode,
  name: personName(a.personCode), userType: a.userType, grants: a.grants, revocations: a.revocations,
});

export const accessHandlers = [
  http.get('/api/v1/capabilities', handle(({ request }: ResolverInfo) => { gate(request); return HttpResponse.json(Object.values(store.coll('capabilities'))); })),
  http.get('/api/v1/user-types', handle(({ request }: ResolverInfo) => { gate(request); return HttpResponse.json(Object.values(store.coll('userTypes'))); })),
  http.put('/api/v1/user-types/:id/capabilities/:cap', handle(async ({ request, params }: ResolverInfo) => {
    const s = gate(request);
    const types = store.coll<UserType>('userTypes');
    const t = types[String(params.id)];
    if (!t) return refuse(404, { code: 'not-found', message: 'That user type no longer exists.', next: 'Reload the page.' });
    const c = capBy(String(params.cap));
    checkVersion(request, t);
    const { granted } = await readJson(request, SetTemplateCapability);
    const had = t.capabilities.includes(c.id);
    if (!granted && c.lockedFor.includes(t.id))
      return refuse(409, { code: 'locked', message: `"${c.label}" cannot be removed from ${t.name}. It is the only way back to this page.`, next: 'Give another user type this capability first, if you need to change who holds it.' });
    if (had === granted) return HttpResponse.json({ record: t, auditId: '' });
    const next = bump(t, { capabilities: granted ? [...t.capabilities, c.id].sort() : t.capabilities.filter(x => x !== c.id) });
    types[t.id] = next;
    const auditId = writeAudit({ who: who(s), act: 'Permission changed', entity: 'userType', entityId: t.id, before: { [c.id]: had }, after: { [c.id]: granted } });
    return HttpResponse.json({ record: next, auditId });
  })),
  http.get('/api/v1/users', handle(({ request }: ResolverInfo) => { gate(request); return HttpResponse.json(Object.values(store.coll<Account>('accounts')).map(userView)); })),
  http.post('/api/v1/users/:email/exceptions', handle(async ({ request, params }: ResolverInfo) => {
    const s = gate(request);
    const accounts = store.coll<Account>('accounts');
    const key = `acc_${String(params.email).toLowerCase()}`;
    const a = accounts[key];
    if (!a) return refuse(404, { code: 'not-found', message: 'That account no longer exists.', next: 'Reload the page.' });
    checkVersion(request, a);
    const { capability, mode, reason } = await readJson(request, AddException);
    const c = capBy(capability);
    if (mode === 'revoke' && c.lockedFor.includes(a.userType) && a.email === s.account.email)
      return refuse(409, { code: 'locked', message: `You cannot revoke "${c.label}" from yourself. It is your way back to this page.`, next: 'Ask another administrator to make this change.' });
    const grants = mode === 'grant' ? [...new Set([...a.grants, c.id])] : a.grants.filter(x => x !== c.id);
    const revocations = mode === 'revoke' ? [...new Set([...a.revocations, c.id])] : a.revocations.filter(x => x !== c.id);
    const next = bump(a, { grants, revocations });
    accounts[key] = next;
    const auditId = writeAudit({
      who: who(s), act: 'Access exception added', entity: 'account', entityId: a.email,
      before: { grants: a.grants, revocations: a.revocations }, after: { grants, revocations }, reason,
    });
    return HttpResponse.json({ record: userView(next), auditId });
  })),
  http.delete('/api/v1/users/:email/exceptions/:cap', handle(({ request, params }: ResolverInfo) => {
    const s = gate(request);
    const accounts = store.coll<Account>('accounts');
    const key = `acc_${String(params.email).toLowerCase()}`;
    const a = accounts[key];
    if (!a) return refuse(404, { code: 'not-found', message: 'That account no longer exists.', next: 'Reload the page.' });
    checkVersion(request, a);
    const capId = String(params.cap);
    const next = bump(a, { grants: a.grants.filter(x => x !== capId), revocations: a.revocations.filter(x => x !== capId) });
    accounts[key] = next;
    const auditId = writeAudit({
      who: who(s), act: 'Access exception removed', entity: 'account', entityId: a.email,
      before: { grants: a.grants, revocations: a.revocations }, after: { grants: next.grants, revocations: next.revocations },
    });
    return HttpResponse.json({ record: userView(next), auditId });
  })),
];
