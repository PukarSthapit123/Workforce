import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor, requireCapability, sessions } from './auth';
import { writeAudit } from './audit';
import { ensureCase } from './onboarding-cases';
import {
  listEmployees, getNextCode, getEmployee, createEmployee, updateEmployee, listHistory, type HistoryEntry,
} from '@/contract/employees';
import { nextEmployeeCode, normaliseCode, type Problem } from '@/domain/codes';
import { newEmployeeProblem, employeeEditProblem } from '@/domain/employees';
import { diffFields } from '@/domain/history';
import { isHere } from '@/domain/lifecycle';
import { resolveCapabilities } from '@/domain/capabilities';
import {
  accountOfEmployee, accounts, inScope, isSelf, nameOf, employees, employeeContext, employeeView, recordAt, requireScope, scopeOf,
  writeHistory, type Signed, type StoredAccount, type StoredEmployee,
} from './world';

export const EDITABLE = ['name', 'email', 'phone', 'jobProfile', 'employeeType', 'category', 'location', 'department',
  'manager', 'contractedHours', 'maxHours', 'night', 'resource', 'cis', 'start'] as const;
export const invalid = (p: Problem): never =>
  refuse(422, { code: 'invalid', field: p.field, message: p.message, next: 'Correct the highlighted field and try again.' });

export function employeeById(id: string): StoredEmployee {
  return recordAt(employees(), id) ?? refuse(404, { code: 'not-found', message: 'That employee record no longer exists.', next: 'Reload the page.' });
}
/* listing needs master data (everyone) or the team list (their own location) */
function requireList(s: Signed) { if (!s.caps.includes('master_data')) requireCapability(s, 'team_employees'); }
/* an employee may always read themself; anyone else needs the list and the scope */
export function requireSight(s: Signed, p: StoredEmployee) {
  if (isSelf(s, p)) return;
  requireList(s);
  if (!inScope(s, p.location)) refuse(403, { code: 'scope', message: 'This employee is outside the employees you look after.', next: 'Ask an administrator if you need their record.' });
}
/* D7: choosing a user type is an access decision */
const requireUserTypeRight = (s: Signed) => requireCapability(s, 'perm_cfg');
const accountKey = (email: string) => `acc_${email.toLowerCase()}`;
function addAccount(email: string, employeeCode: string, userType: StoredAccount['userType']) {
  const id = accountKey(email);
  accounts()[id] = { id, version: 1, updatedAt: store.now(), email, employeeCode, userType, grants: [], revocations: [] };
}
/* The same guard the permissions page keeps (1a M1): nobody changes their own
   user type, and no change may leave the tenant without a perm_cfg holder. */
function userTypeChangeProblem(s: Signed, acc: StoredAccount, to: StoredAccount['userType']) {
  if (acc.email.toLowerCase() === s.account.email.toLowerCase())
    refuse(409, { code: 'locked', message: 'You cannot change your own user type.', next: 'Ask another administrator to make this change.' });
  const types = store.coll<{ capabilities: string[] }>('userTypes');
  const holds = (a: StoredAccount) => resolveCapabilities(types[a.userType]?.capabilities ?? [], a.grants, a.revocations).includes('perm_cfg');
  const after = Object.values(accounts()).map(a => (a.id === acc.id ? { ...a, userType: to } : a));
  if (!after.some(holds))
    refuse(409, { code: 'locked', message: 'That change would leave nobody able to configure permissions.', next: 'Give another account the administrator user type first.' });
}

export const employeesHandlers = [
  /* before /employees/:id, so MSW matches it first */
  serve(getNextCode, () => ({ code: nextEmployeeCode(Object.values(employees()).map(p => p.code)) })),
  serve(listEmployees, ({ session, query }) => {
    requireList(session);
    const state = query.state ?? 'here', q = (query.q ?? '').trim().toLowerCase();
    const sc = scopeOf(session);
    return Object.values(employees())
      .filter(p => sc.all || p.location === sc.location)
      .filter(p => state === 'all' || (state === 'here' ? isHere(p.state) : p.state === state))
      /* name, employee ID or job profile, as the prototype's admEmployees search (v15:6066) */
      .filter(p => !q || [p.name, p.code, p.jobProfile ? nameOf('jobProfiles', p.jobProfile) : ''].some(s => s.toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(employeeView);
  }),
  serve(getEmployee, ({ session, params }) => {
    const p = employeeById(params.id);
    requireSight(session, p);
    return employeeView(p);
  }),
  serve(listHistory, ({ session, params }) => {
    const p = employeeById(params.id);
    requireSight(session, p);
    return Object.values(store.coll<HistoryEntry>('employeeHistory')).filter(e => e.employeeCode === p.code)
      .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
  }),
  serve(createEmployee, ({ session, body }) => {
    const d = { ...body, code: normaliseCode(body.code), email: body.email.trim().toLowerCase(), resource: body.resource.trim().toUpperCase(), name: body.name.trim() };
    const problem = newEmployeeProblem(d, employeeContext());
    if (problem) return invalid(problem);
    if (d.userType !== 'employee') requireUserTypeRight(session);
    requireScope(session, d.location);
    const { userType, ...fields } = d;
    const rec: StoredEmployee = { ...fields, id: `emp_${d.code}`, version: 1, updatedAt: store.now(), address: '', emergencyName: '',
      emergencyPhone: '', bankAccount: '', bankSortCode: '', end: '' };
    employees()[rec.id] = rec;
    if (d.email) addAccount(d.email, d.code, userType);
    /* module 5 D1: a starter gets an empty onboarding case */
    const onboardingCase = ensureCase(d.code, d.state);
    const who = actor(session);
    writeHistory(d.code, who, 'created', [{ field: 'state', from: '', to: d.state }], 'Record created');
    const auditId = writeAudit({ who, act: 'Employee created', entity: 'employee', entityId: d.code, before: null,
      after: { code: d.code, name: d.name, employeeType: d.employeeType, location: d.location, contractedHours: d.contractedHours,
        state: d.state, account: d.email || null, userType: d.email ? userType : null, ...(onboardingCase ? { onboardingCase } : {}) } });
    return { record: employeeView(rec), auditId };
  }),
  serve(updateEmployee, ({ session, params, body, checkVersion }) => {
    const p = employeeById(params.id);
    requireScope(session, p.location);
    checkVersion(p);
    /* code and state are refused by the contract, so they never reach here */
    const { userType, ...patch } = body;
    if (patch.email !== undefined) patch.email = patch.email.trim().toLowerCase();
    if (patch.resource !== undefined) patch.resource = patch.resource.trim().toUpperCase();
    if (patch.name !== undefined) patch.name = patch.name.trim();
    const problem = employeeEditProblem(p, patch, employeeContext());
    if (problem) return invalid(problem);
    if (patch.location !== undefined) requireScope(session, patch.location);
    const acc = accountOfEmployee(p.code);
    const typeChange = userType !== undefined && userType !== (acc?.userType ?? null) ? userType : null;
    if (typeChange) {
      requireUserTypeRight(session);
      if (!acc) return invalid({ field: 'userType', message: 'This employee has no account yet. Give them a work email first.' });
      userTypeChangeProblem(session, acc, typeChange);
    }
    /* D8 makes the work email the sign-in identity, so changing it re-keys the
       account. For an account with more than an employee's rights that is an
       access decision, as the user type is: without perm_cfg, a manager could
       move an admin's account to an address of their choosing. */
    const rekeys = acc !== undefined && patch.email !== undefined && patch.email !== acc.email.toLowerCase();
    if (rekeys && acc.userType !== 'employee') requireUserTypeRight(session);
    const next = { ...p, ...patch };
    const changes = diffFields(p, next, EDITABLE);
    if (typeChange && acc) changes.push({ field: 'userType', from: acc.userType, to: typeChange });
    if (!changes.length) return { record: employeeView(p), auditId: null, changed: [] };
    const saved = bump(p, patch);
    employees()[p.id] = saved;
    /* D8: the account follows the work email; a session signed in under the
       old address follows it too, so the employee stays signed in. */
    if (acc && patch.email !== undefined && patch.email !== acc.email.toLowerCase()) {
      Reflect.deleteProperty(accounts(), acc.id);
      const id = accountKey(patch.email);
      accounts()[id] = { ...acc, id, email: patch.email, version: acc.version + 1, updatedAt: store.now() };
      for (const s of Object.values(sessions())) if (s.email.toLowerCase() === acc.email.toLowerCase()) s.email = patch.email;
    } else if (!acc && patch.email && !recordAt(accounts(), accountKey(patch.email))) addAccount(patch.email, saved.code, 'employee');
    const current = accountOfEmployee(p.code);
    if (typeChange && current) accounts()[current.id] = bump(current, { userType: typeChange });
    const who = actor(session);
    writeHistory(p.code, who, 'edited', changes);
    const auditId = writeAudit({ who, act: 'Employee record edited', entity: 'employee', entityId: p.code,
      before: Object.fromEntries(changes.map(c => [c.field, c.from])), after: Object.fromEntries(changes.map(c => [c.field, c.to])) });
    return { record: employeeView(saved), auditId, changed: changes.map(c => c.field) };
  }),
];
