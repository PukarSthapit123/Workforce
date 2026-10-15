import { bump, refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { transitionEmployee } from '@/contract/employees';
import { LIFECYCLE, isEmployeeState, transitionProblem } from '@/domain/lifecycle';
import { invalid, employeeById } from './employees';
import { activationProblem, ensureCase, markStarted } from './onboarding-cases';
import { employees, employeeView, requireScope, today, writeHistory } from './world';

export const transitionHandlers = [
  serve(transitionEmployee, ({ session, params, body: { to, reason }, checkVersion }) => {
    const p = employeeById(params.id);
    requireScope(session, p.location);
    checkVersion(p);
    if (!to) return invalid({ field: 'to', message: 'Choose a state to move to.' });
    if (!isEmployeeState(to)) return invalid({ field: 'to', message: `There is no state called ${to}.` });
    const why = reason.trim();
    if (!why) return invalid({ field: 'reason', message: 'A reason is required. It is kept on the record.' });
    const problem = transitionProblem(p.state, to);
    if (problem) return refuse(409, { code: 'transition', ...problem });
    /* module 5 D6: a starter becomes active only with nothing outstanding, whichever path asks */
    const blocked = activationProblem(p, to);
    if (blocked) return refuse(409, blocked);
    /* the consequence travels with the move: a leaver gets a leaving date (D11) */
    const end = to === 'leaver' && !p.end ? today() : p.end;
    const saved = bump(p, { state: to, end });
    employees()[p.id] = saved;
    /* D1: moving into candidate or preboarding brings an empty case; becoming active records the start */
    const onboardingCase = ensureCase(p.code, to);
    if (to === 'active') markStarted(p.code);
    const who = actor(session);
    writeHistory(p.code, who, 'transition', [
      { field: 'state', from: p.state, to },
      ...(end !== p.end ? [{ field: 'end', from: p.end, to: end }] : []),
    ], why);
    const auditId = writeAudit({ who, act: `Employee ${LIFECYCLE[to].label.toLowerCase()}`, entity: 'employee', entityId: p.code,
      before: { state: p.state }, after: { state: to, ...(end !== p.end ? { end } : {}), ...(onboardingCase ? { onboardingCase } : {}) }, reason: why });
    return { record: employeeView(saved), auditId };
  }),
];
