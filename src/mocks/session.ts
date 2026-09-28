import { store } from './store';
import { refuse } from './http';
import { serve } from './serve';
import { writeAudit } from './audit';
import { accountBy, accountForPerson, actor, locationNameOf, personBy, roleNameOf, sessionView, sessions, type Account, type Person, type ServerSession } from './auth';
import { createSession, getSession, deleteSession, startViewAs, listViewAsPeople, endViewAs, listAccounts, type ViewAsPerson } from '@/contract/session';

export const DEMO_PASSWORD = 'Qnipay@123';   // stub: shared demo password, replaced by Entra ID
const ONBOARDING = new Set(['candidate', 'preboard']);
const GONE = new Set(['leaver', 'archived']);

export const sessionHandlers = [
  /* Dev-only (the endpoint is marked devOnly, so it is not in the OpenAPI
     document): the sign-in screen's demo shortcuts. */
  serve(listAccounts, () => Object.values(store.coll<Account>('accounts'))
    .map(a => ({ email: a.email, userType: a.userType, personCode: a.personCode, name: personBy(a.personCode)?.name ?? a.email }))),
  serve(createSession, ({ body: { email, password } }) => {
    const a = accountBy(email);
    if (!a || password !== DEMO_PASSWORD) return refuse(401, { code: 'credentials', message: 'That address and password do not match an account.', next: 'Check the address and password, or pick an account from the list.' });
    const token = crypto.randomUUID();
    const created: ServerSession = { token, email: a.email };
    sessions()[token] = created;
    /* A failed sign-in above is not a change to anything, so only this
       successful one is audited. The token itself is never recorded. */
    writeAudit({ who: { personCode: a.personCode, name: personBy(a.personCode)?.name ?? a.email }, act: 'Signed in', entity: 'session', entityId: a.email, before: null, after: { signedIn: true } });
    return sessionView(created);
  }),
  serve(getSession, ({ session }) => sessionView(session)),
  serve(deleteSession, ({ session }) => {
    Reflect.deleteProperty(sessions(), session.token);
    writeAudit({ who: actor(session), act: 'Signed out', entity: 'session', entityId: session.account.email, before: { signedIn: true }, after: null });
    return null;
  }),
  /* Gated on perm_cfg in the contract, as the prototype gates it
     (v15:10773, can('perm_cfg')): looking at the app as someone else is part
     of configuring access. */
  serve(startViewAs, ({ session, body: { personCode } }) => {
    const p = personBy(personCode);
    if (!p) return refuse(422, { code: 'invalid', field: 'personCode', message: 'There is nobody with that employee ID.', next: 'Pick a person from the list.' });
    if (personCode === session.account.personCode)
      return refuse(422, { code: 'invalid', field: 'personCode', message: 'You cannot view the app as yourself. You are already seeing it as you.', next: 'Pick someone else from the list.' });
    if (!accountForPerson(personCode)) return refuse(422, { code: 'invalid', field: 'personCode', message: `${p.name} has no account, so there is nothing to view.`, next: 'Pick a person who has signed in before, or ask an administrator to create one first.' });
    const updated: ServerSession = { token: session.token, email: session.email, viewingAs: personCode };
    sessions()[session.token] = updated;
    /* who names the real signed-in account, with viewingAs recording what
       they were about to view as at the moment of this very action. */
    writeAudit({ who: actor({ ...session, viewingAs: personCode }), act: 'View-as started', entity: 'session', entityId: session.account.email, before: null, after: { viewingAs: personCode } });
    return sessionView(updated);
  }),
  /* Ported from the prototype's drawMenu (v15:10776-10789): one person per
     role, and one per employee type among employees, never yourself, at
     most five, so the list shows how the app differs. People who have left
     are not offered, and neither is anyone without an account. */
  serve(listViewAsPeople, ({ session }) => {
    const seen = new Set<string>(); const out: ViewAsPerson[] = [];
    for (const p of Object.values(store.coll<Person>('people'))) {
      const a = accountForPerson(p.code);
      if (!a || p.code === session.account.personCode || GONE.has(p.state ?? '')) continue;
      const onboarding = a.userType === 'employee' && ONBOARDING.has(p.state ?? '');
      const rank = a.userType !== 'employee' ? a.userType : onboarding ? 'candidate' : `employee:${p.employeeType ?? ''}`;
      if (seen.has(rank)) continue;
      seen.add(rank);
      out.push({ personCode: p.code, name: p.name, userType: a.userType, roleName: roleNameOf(a), locationName: locationNameOf(p), onboarding });
    }
    return out.slice(0, 5);
  }),
  serve(endViewAs, ({ session }) => {
    const was = session.viewingAs;
    const updated: ServerSession = { token: session.token, email: session.email };
    sessions()[session.token] = updated;
    if (was) writeAudit({ who: actor({ ...session, viewingAs: undefined }), act: 'View-as ended', entity: 'session', entityId: session.account.email, before: { viewingAs: was }, after: null });
    return sessionView(updated);
  }),
];
