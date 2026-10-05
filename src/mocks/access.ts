import { seededCollection, store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor, personName, type Account } from './auth';
import { writeAudit } from './audit';
import { resolveCapabilities } from '@/domain/capabilities';
import { roleNameProblem } from '@/domain/modules';
import {
  listCapabilities, listCapabilityGroups, listUserTypes, setTemplateCapability, listUsers, addException, removeException, renameUserType,
  type Capability, type CapabilityGroup, type UserType, type UserAccess,
} from '@/contract/access';

/* The one capability every endpoint here is gated on (in the contract), and
   so the one capability that must always keep at least one holder: lose the
   last one and nobody, anywhere, can reach this page to put it back. */
const PERM_CAP = 'perm_cfg';
const SELF_NEXT = 'Ask another administrator to make this change.';
type StoredUserType = Omit<UserType, 'defaults'>;
const capBy = (id: string) => store.coll<Capability>('capabilities')[id] ?? refuse(404, { code: 'not-found', message: `There is no capability "${id}".`, next: 'Reload the page.' });
const accountKey = (email: string) => `acc_${email.toLowerCase()}`;
const accountAt = (email: string) => {
  const accounts = store.coll<Account>('accounts'), key = accountKey(email);
  return (Object.hasOwn(accounts, key) ? accounts[key] : undefined)
    ?? refuse(404, { code: 'not-found', message: 'That account no longer exists.', next: 'Reload the page.' });
};
const userView = (a: Account): UserAccess => ({
  id: a.id, version: a.version, updatedAt: a.updatedAt, email: a.email, personCode: a.personCode,
  name: personName(a.personCode), userType: a.userType, grants: a.grants, revocations: a.revocations,
});
/* Whether any account, across the whole tenant, would still effectively hold
   `capId` under the given (possibly simulated) templates and accounts. Used
   to refuse a change before it happens, never to undo one after. */
const holderExists = (capId: string, types: Record<string, StoredUserType>, accounts: Record<string, Account>): boolean =>
  Object.values(accounts).some(a => resolveCapabilities(types[a.userType]?.capabilities ?? [], a.grants, a.revocations).includes(capId));

/* A user type as the API gives it: with the capabilities its seed gave it. */
const typeView = (t: StoredUserType): UserType => {
  const seeded = seededCollection(store.tenant, 'userTypes')[t.id]?.capabilities;
  return { ...t, defaults: Array.isArray(seeded) ? seeded.filter((c): c is string => typeof c === 'string') : t.capabilities };
};

export const accessHandlers = [
  serve(listCapabilities, () => Object.values(store.coll<Capability>('capabilities'))),
  serve(listCapabilityGroups, () => Object.values(store.coll<CapabilityGroup>('capabilityGroups')).sort((a, b) => a.order - b.order)),
  serve(listUserTypes, () => Object.values(store.coll<StoredUserType>('userTypes')).map(typeView)),
  serve(setTemplateCapability, ({ session, params, body: { granted }, checkVersion }) => {
    const types = store.coll<StoredUserType>('userTypes');
    const t = Object.hasOwn(types, params.id) ? types[params.id] : undefined;
    if (!t) return refuse(404, { code: 'not-found', message: 'That user type no longer exists.', next: 'Reload the page.' });
    const c = capBy(params.capability);
    checkVersion(t);
    const had = t.capabilities.includes(c.id);
    /* M1: nobody removes their own way back to this page, whoever else
       still holds it. Another administrator has to make that change. */
    if (!granted && c.id === PERM_CAP && t.id === session.account.userType)
      return refuse(409, { code: 'locked', message: `You cannot remove "${c.label}" from ${t.name}, your own user type. It is your way back to this page.`, next: SELF_NEXT });
    if (!granted && c.lockedFor.includes(t.id))
      return refuse(409, { code: 'locked', message: `"${c.label}" cannot be removed from ${t.name}. It is the only way back to this page.`, next: 'Give another user type this capability first, if you need to change who holds it.' });
    if (!granted && c.id === PERM_CAP) {
      const simulatedTypes = { ...types, [t.id]: { ...t, capabilities: t.capabilities.filter(x => x !== c.id) } };
      if (!holderExists(PERM_CAP, simulatedTypes, store.coll<Account>('accounts')))
        return refuse(409, { code: 'locked', message: `Removing "${c.label}" from ${t.name} would leave nobody able to configure permissions.`, next: 'Grant it to another user type or account first, if you need to change who holds it.' });
    }
    if (had === granted) return { record: typeView(t), auditId: null };
    const next = bump(t, { capabilities: granted ? [...t.capabilities, c.id].sort() : t.capabilities.filter(x => x !== c.id) });
    types[t.id] = next;
    const auditId = writeAudit({ who: actor(session), act: 'Permission changed', entity: 'userType', entityId: t.id, before: { [c.id]: had }, after: { [c.id]: granted } });
    return { record: typeView(next), auditId };
  }),
  /* Configurable role names (D11): only the display name changes. The session's
     roleName, the switcher and the matrix all read it from here. */
  serve(renameUserType, ({ session, params, body: { name }, checkVersion }) => {
    const types = store.coll<StoredUserType>('userTypes');
    const t = Object.hasOwn(types, params.id) ? types[params.id] : undefined;
    if (!t) return refuse(404, { code: 'not-found', message: 'That user type no longer exists.', next: 'Reload the page.' });
    checkVersion(t);
    const problem = roleNameProblem(name, Object.values(types).filter(x => x.id !== t.id).map(x => x.name));
    if (problem) return refuse(problem.taken ? 409 : 422, { code: problem.taken ? 'NAME_TAKEN' : 'invalid', field: problem.field, message: problem.message,
      next: problem.taken ? 'Choose a name no other role uses.' : 'Correct the name and save again.' });
    const next = name.trim();
    if (next === t.name) return { record: typeView(t), auditId: null };
    const saved = bump(t, { name: next });
    types[t.id] = saved;
    const auditId = writeAudit({ who: actor(session), act: 'Roles renamed', entity: 'userType', entityId: t.id, before: { name: t.name }, after: { name: next } });
    return { record: typeView(saved), auditId };
  }),
  serve(listUsers, () => Object.values(store.coll<Account>('accounts')).map(userView)),
  serve(addException, ({ session, params, body: { capability, mode, reason }, checkVersion }) => {
    const accounts = store.coll<Account>('accounts');
    const a = accountAt(params.email), key = accountKey(params.email);
    checkVersion(a);
    const c = capBy(capability);
    const types = store.coll<StoredUserType>('userTypes');
    const template = types[a.userType];
    const templateName = template?.name ?? a.userType;
    const templateHas = !!template?.capabilities.includes(c.id);
    /* An exception only means something as a difference from the template: a
       grant the template already covers, or a revoke of something it never
       had, changes nothing about what this person can do. */
    if (mode === 'grant' && templateHas)
      return refuse(422, { code: 'invalid', field: 'capability', message: `${templateName} already includes "${c.label}", so there is nothing to grant.`, next: 'Choose a capability their template does not already include.' });
    if (mode === 'revoke' && !templateHas)
      return refuse(422, { code: 'invalid', field: 'capability', message: `${templateName} does not include "${c.label}", so there is nothing to revoke.`, next: 'Choose a capability their template already includes.' });
    if (mode === 'revoke' && c.id === PERM_CAP && a.email === session.account.email)
      return refuse(409, { code: 'locked', message: `You cannot revoke "${c.label}" from yourself. It is your way back to this page.`, next: SELF_NEXT });
    if (mode === 'revoke' && c.id === PERM_CAP) {
      const simulated: Account = { ...a, grants: a.grants.filter(x => x !== c.id), revocations: [...new Set([...a.revocations, c.id])] };
      if (!holderExists(PERM_CAP, types, { ...accounts, [key]: simulated }))
        return refuse(409, { code: 'locked', message: `Revoking "${c.label}" from ${a.email} would leave nobody able to configure permissions.`, next: 'Grant it to another account first, if you need to change who holds it.' });
    }
    const alreadyGranted = mode === 'grant' && a.grants.includes(c.id);
    const alreadyRevoked = mode === 'revoke' && a.revocations.includes(c.id);
    if (alreadyGranted || alreadyRevoked) return { record: userView(a), auditId: null };
    const grants = mode === 'grant' ? [...new Set([...a.grants, c.id])] : a.grants.filter(x => x !== c.id);
    const revocations = mode === 'revoke' ? [...new Set([...a.revocations, c.id])] : a.revocations.filter(x => x !== c.id);
    const next = bump(a, { grants, revocations });
    accounts[key] = next;
    const auditId = writeAudit({
      who: actor(session), act: 'Access exception added', entity: 'account', entityId: a.email,
      before: { grants: a.grants, revocations: a.revocations }, after: { grants, revocations }, reason,
    });
    return { record: userView(next), auditId };
  }),
  serve(removeException, ({ session, params, checkVersion }) => {
    const accounts = store.coll<Account>('accounts');
    const a = accountAt(params.email), key = accountKey(params.email);
    checkVersion(a);
    const c = capBy(params.capability);
    if (!a.grants.includes(c.id) && !a.revocations.includes(c.id))
      return refuse(422, { code: 'invalid', field: 'capability', message: `"${c.label}" is not an exception for ${a.email}.`, next: 'Choose one of their current exceptions.' });
    /* Removing your own perm_cfg grant takes away your own way back, just as a revoke would. */
    if (c.id === PERM_CAP && a.email === session.account.email && a.grants.includes(c.id))
      return refuse(409, { code: 'locked', message: `You cannot remove "${c.label}" from yourself. It is your way back to this page.`, next: SELF_NEXT });
    const simulated: Account = { ...a, grants: a.grants.filter(x => x !== c.id), revocations: a.revocations.filter(x => x !== c.id) };
    if (c.id === PERM_CAP && !holderExists(PERM_CAP, store.coll<StoredUserType>('userTypes'), { ...accounts, [key]: simulated }))
      return refuse(409, { code: 'locked', message: `Removing "${c.label}" from ${a.email} would leave nobody able to configure permissions.`, next: 'Grant it to another account first, if you need to change who holds it.' });
    const next = bump(a, { grants: simulated.grants, revocations: simulated.revocations });
    accounts[key] = next;
    const auditId = writeAudit({
      who: actor(session), act: 'Access exception removed', entity: 'account', entityId: a.email,
      before: { grants: a.grants, revocations: a.revocations }, after: { grants: next.grants, revocations: next.revocations },
    });
    return { record: userView(next), auditId };
  }),
];
