import { store } from './store';
import { refuse } from './http';
import { serve } from './serve';
import { writeAudit } from './audit';
import { accountBy, accountForEmployee, actor, locationNameOf, employeeBy, roleNameOf, sessionView, sessions, type Account, type Employee, type ServerSession } from './auth';
import { createSession, getSession, deleteSession, startViewAs, listViewAsEmployees, endViewAs, listAccounts, type ViewAsEmployee } from '@/contract/session';

export const DEMO_PASSWORD = 'Qnipay@123';   // stub: shared demo password, replaced by Entra ID
const ONBOARDING = new Set(['candidate', 'preboard']);
const GONE = new Set(['leaver', 'archived']);

export const sessionHandlers = [
  /* Dev-only (the endpoint is marked devOnly, so it is not in the OpenAPI
     document): the sign-in screen's demo shortcuts. */
  serve(listAccounts, () => Object.values(store.coll<Account>('accounts'))
    .map(a => ({ email: a.email, userType: a.userType, employeeCode: a.employeeCode, name: employeeBy(a.employeeCode)?.name ?? a.email }))),
  serve(createSession, ({ body: { email, password } }) => {
    const a = accountBy(email);
    if (!a || password !== DEMO_PASSWORD) return refuse(401, { code: 'credentials', message: 'That address and password do not match an account.', next: 'Check the address and password, or pick an account from the list.' });
    const token = crypto.randomUUID();
    const created: ServerSession = { token, email: a.email };
    sessions()[token] = created;
    /* A failed sign-in above is not a change to anything, so only this
       successful one is audited. The token itself is never recorded. */
    writeAudit({ who: { employeeCode: a.employeeCode, name: employeeBy(a.employeeCode)?.name ?? a.email }, act: 'Signed in', entity: 'session', entityId: a.email, before: null, after: { signedIn: true } });
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
  serve(startViewAs, ({ session, body: { employeeCode } }) => {
    const p = employeeBy(employeeCode);
    if (!p) return refuse(422, { code: 'invalid', field: 'employeeCode', message: 'There is nobody with that employee ID.', next: 'Pick an employee from the list.' });
    if (employeeCode === session.account.employeeCode)
      return refuse(422, { code: 'invalid', field: 'employeeCode', message: 'You cannot view the app as yourself. You are already seeing it as you.', next: 'Pick someone else from the list.' });
    if (!accountForEmployee(employeeCode)) return refuse(422, { code: 'invalid', field: 'employeeCode', message: `${p.name} has no account, so there is nothing to view.`, next: 'Pick an employee who has signed in before, or ask an administrator to create one first.' });
    const updated: ServerSession = { token: session.token, email: session.email, viewingAs: employeeCode };
    sessions()[session.token] = updated;
    /* who names the real signed-in account, with viewingAs recording what
       they were about to view as at the moment of this very action. */
    writeAudit({ who: actor({ ...session, viewingAs: employeeCode }), act: 'View-as started', entity: 'session', entityId: session.account.email, before: null, after: { viewingAs: employeeCode } });
    return sessionView(updated);
  }),
  /* Ported from the prototype's drawMenu (v15:10776-10789): one employee per
     role, and one per employee type among employees, never yourself, at
     most five, so the list shows how the app differs. Employees who have left
     are not offered, and neither is anyone without an account. */
  serve(listViewAsEmployees, ({ session }) => {
    const seen = new Set<string>(); const out: ViewAsEmployee[] = [];
    for (const p of Object.values(store.coll<Employee>('employees'))) {
      const a = accountForEmployee(p.code);
      if (!a || p.code === session.account.employeeCode || GONE.has(p.state ?? '')) continue;
      const onboarding = a.userType === 'employee' && ONBOARDING.has(p.state ?? '');
      const rank = a.userType !== 'employee' ? a.userType : onboarding ? 'candidate' : `employee:${p.employeeType ?? ''}`;
      if (seen.has(rank)) continue;
      seen.add(rank);
      out.push({ employeeCode: p.code, name: p.name, userType: a.userType, roleName: roleNameOf(a), locationName: locationNameOf(p), onboarding });
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
