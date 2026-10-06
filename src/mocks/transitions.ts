import { bump, refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { transitionPerson } from '@/contract/people';
import { LIFECYCLE, isPersonState, transitionProblem } from '@/domain/lifecycle';
import { invalid, personById } from './people';
import { activationProblem, ensureCase, markStarted } from './onboarding-cases';
import { people, personView, requireScope, today, writeHistory } from './world';

export const transitionHandlers = [
  serve(transitionPerson, ({ session, params, body: { to, reason }, checkVersion }) => {
    const p = personById(params.id);
    requireScope(session, p.location);
    checkVersion(p);
    if (!to) return invalid({ field: 'to', message: 'Choose a state to move to.' });
    if (!isPersonState(to)) return invalid({ field: 'to', message: `There is no state called ${to}.` });
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
    people()[p.id] = saved;
    /* D1: moving into candidate or preboarding brings an empty case; becoming active records the start */
    const onboardingCase = ensureCase(p.code, to);
    if (to === 'active' && (p.state === 'candidate' || p.state === 'preboard')) markStarted(p.code);
    const who = actor(session);
    writeHistory(p.code, who, 'transition', [
      { field: 'state', from: p.state, to },
      ...(end !== p.end ? [{ field: 'end', from: p.end, to: end }] : []),
    ], why);
    const auditId = writeAudit({ who, act: `Employee ${LIFECYCLE[to].label.toLowerCase()}`, entity: 'person', entityId: p.code,
      before: { state: p.state }, after: { state: to, ...(end !== p.end ? { end } : {}), ...(onboardingCase ? { onboardingCase } : {}) }, reason: why });
    return { record: personView(saved), auditId };
  }),
];
