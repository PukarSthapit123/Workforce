import {
  APPROVER_ROLES, CHAIN_MODULES, DEFAULT_CHAIN, POSTING_STEP, STEP_SCOPES, actingFor, chainProblem, chainText, defaultChainFor, delegationProblem,
  parseSla, slaProblem, slaText, whenOptions, whoDecides, withLayer, type ApproverWorld, type ChainStep, type Delegation, type DelegationContext,
} from './approvals';

const step = (o: Partial<ChainStep> = {}): ChainStep =>
  ({ module: 'Leave', role: 'Line manager', scope: 'Own department', when: 'Every leave request', sla: '5 days', fixed: false, ...o });

describe('the default chains are the prototype\'s', () => {
  test('one chain per module, the Timesheet one ending in the posting step', () => {
    expect(CHAIN_MODULES).toEqual(['Timesheet', 'Profile', 'Leave', 'Rota']);
    expect(defaultChainFor('Timesheet').map(s => s.role)).toEqual(['Line manager', 'Payroll', 'Business Central']);
    expect(defaultChainFor('Timesheet').at(-1)).toEqual(POSTING_STEP);
    expect(DEFAULT_CHAIN).toHaveLength(8);
    for (const m of CHAIN_MODULES) expect(chainProblem(m, defaultChainFor(m))).toBeNull();
  });
  test('a new layer goes in before the posting step', () => {
    const t = withLayer(defaultChainFor('Timesheet'), 'Timesheet');
    expect(t.map(s => s.role)).toEqual(['Line manager', 'Payroll', 'Line manager', 'Business Central']);
    expect(withLayer(defaultChainFor('Rota'), 'Rota').map(s => s.role)).toEqual(['Service Manager', 'Service Manager']);
  });
  test('roles are the four, scopes leave out the dash, Profile has its own two conditions', () => {
    expect(APPROVER_ROLES).toEqual(['Line manager', 'Service Manager', 'Payroll', 'HR administrator']);
    expect(STEP_SCOPES).not.toContain('—');
    expect(whenOptions('Profile')).toEqual(['Every contact detail change', 'Only bank details']);
    expect(whenOptions('Leave')).not.toContain('Posts on final approval');
    expect(chainText(defaultChainFor('Timesheet'))).toBe('Line manager, then Payroll, then Business Central.');
  });
});

describe('a chain is checked whole (D8)', () => {
  test('the posting step cannot be removed, edited, moved or added elsewhere', () => {
    const t = defaultChainFor('Timesheet');
    expect(chainProblem('Timesheet', t.filter(s => !s.fixed))?.code).toBe('FIXED');
    expect(chainProblem('Timesheet', t.map(s => (s.fixed ? { ...s, sla: '24 hours' } : s)))?.code).toBe('FIXED');
    expect(chainProblem('Timesheet', [POSTING_STEP, ...t.filter(s => !s.fixed)])?.code).toBe('FIXED');
    expect(chainProblem('Leave', [step(), { ...POSTING_STEP, module: 'Leave' }])).toMatchObject({ code: 'FIXED', message: 'The Leave chain has no posting step. Only the Timesheet chain ends in Business Central.' });
  });
  test('at least one approver and at most six', () => {
    expect(chainProblem('Leave', [])).toMatchObject({ status: 422, field: 'steps', message: 'A chain needs at least one approver.' });
    expect(chainProblem('Timesheet', [POSTING_STEP])?.message).toBe('A chain needs at least one approver.');
    expect(chainProblem('Leave', Array.from({ length: 7 }, () => step()))?.message).toBe('A chain has at most 6 approval layers.');
  });
  test('the role is one of the four; scope and condition come from the lists', () => {
    expect(chainProblem('Leave', [step({ role: 'Owen Clarke' })])).toMatchObject({ field: 'steps.0.role' });
    expect(chainProblem('Leave', [step(), step({ scope: '—' })])).toMatchObject({ field: 'steps.1.scope' });
    expect(chainProblem('Leave', [step({ when: 'Only bank details' })])).toMatchObject({ field: 'steps.0.when', message: 'A Leave layer cannot apply "Only bank details".' });
  });
  test('the SLA is hours or days within bounds', () => {
    expect(parseSla('24 hours')).toEqual({ n: 24, unit: 'hours' });
    expect(parseSla('1 day')).toEqual({ n: 1, unit: 'days' });
    expect(slaText(1, 'hours')).toBe('1 hour');
    expect(slaText(3, 'days')).toBe('3 days');
    expect(slaProblem('soon')).toBe('Give the SLA as a number of hours or days, for example 24 hours.');
    expect(slaProblem('0 hours')).toBe('An SLA is between 1 and 168 hours.');
    expect(slaProblem('169 hours')).toBe('An SLA is between 1 and 168 hours.');
    expect(slaProblem('31 days')).toBe('An SLA is between 1 and 30 days.');
    expect(slaProblem('168 hours')).toBeNull();
    expect(chainProblem('Leave', [step({ sla: '45 days' })])).toMatchObject({ field: 'steps.0.sla' });
  });
  test('the Profile chain has only a line manager and payroll, each once, and covers every contact change', () => {
    const p = (o: Partial<ChainStep>) => step({ module: 'Profile', when: 'Every contact detail change', ...o });
    expect(chainProblem('Profile', [p({ role: 'Service Manager' })])).toMatchObject({ field: 'steps.0.role', message: 'The Profile chain can only have a line manager and payroll.' });
    expect(chainProblem('Profile', [p({}), p({})])?.message).toBe('Line manager appears twice in the Profile chain. Each approver signs off once.');
    expect(chainProblem('Profile', [p({ role: 'Payroll', when: 'Only bank details' })])?.message).toBe('Every contact detail change needs an approver.');
    expect(chainProblem('Profile', [p({ role: 'Payroll' })])).toBeNull();
  });
});

describe('delegations (D8)', () => {
  const NAMES: Record<string, string> = { R: 'Rachel Hussain', D: 'Dee Fitzgerald', O: 'Owen Clarke', E: 'Ellie Warren' };
  const ctx: DelegationContext = { today: '2026-08-13', approver: c => (c === 'E' ? undefined : NAMES[c]), nameOf: c => NAMES[c] ?? c };
  const seeded: Delegation = { id: 'dlg_1', who: 'R', to: 'D', from: '2026-08-24', until: '2026-08-31', modules: ['Timesheet', 'Leave'] };
  const draft = (o: Partial<Delegation> = {}) => ({ who: 'D', to: 'O', from: '2026-09-01', until: '2026-09-07', modules: ['Leave' as const], ...o });

  test('a clean one passes', () => {
    expect(delegationProblem(draft(), [seeded], ctx)).toBeNull();
  });
  test('covering yourself is a loop of one', () => {
    expect(delegationProblem(draft({ to: 'D' }), [], ctx)).toEqual({ status: 409, code: 'LOOP', field: 'to',
      message: 'Dee Fitzgerald cannot cover their own approvals.', next: 'Choose someone else to cover them.' });
  });
  test('handing approvals back over the same days is a loop', () => {
    expect(delegationProblem(draft({ who: 'D', to: 'R', from: '2026-08-30', until: '2026-09-02', modules: ['Leave'] }), [seeded], ctx)).toMatchObject({
      status: 409, code: 'LOOP', field: 'to', message: 'Rachel Hussain already delegates Leave to Dee Fitzgerald over those dates. The approvals would go round in a circle.' });
    /* not a loop once the dates part, or for a module not delegated */
    expect(delegationProblem(draft({ who: 'D', to: 'R', from: '2026-09-01', until: '2026-09-02' }), [seeded], ctx)).toBeNull();
    expect(delegationProblem(draft({ who: 'D', to: 'R', from: '2026-08-25', until: '2026-08-26', modules: ['Rota'] }), [seeded], ctx)).toBeNull();
  });
  test('a loop through a third person is found', () => {
    const dToO: Delegation = { id: 'dlg_2', who: 'D', to: 'O', from: '2026-08-20', until: '2026-08-31', modules: ['Leave'] };
    expect(delegationProblem(draft({ who: 'O', to: 'R', from: '2026-08-25', until: '2026-08-25', modules: ['Leave'] }), [seeded, dToO], ctx)?.message)
      .toBe('Rachel Hussain already passes Leave approvals on to Dee Fitzgerald, and from there to Owen Clarke, over those dates. They would go round in a circle.');
  });
  test('a second delegation for the same approver, module and days overlaps', () => {
    expect(delegationProblem(draft({ who: 'R', to: 'O', from: '2026-08-31', until: '2026-09-04', modules: ['Leave', 'Rota'] }), [seeded], ctx)).toEqual({
      status: 409, code: 'OVERLAP', field: 'from', message: 'Rachel Hussain already delegates Leave to Dee Fitzgerald from 24/08/2026 to 31/08/2026.',
      next: 'Remove that delegation first, or choose dates that do not overlap.' });
    /* both days are included: starting the day after is fine */
    expect(delegationProblem(draft({ who: 'R', to: 'O', from: '2026-09-01', until: '2026-09-04' }), [seeded], ctx)).toBeNull();
    expect(delegationProblem(draft({ who: 'R', to: 'O', from: '2026-08-24', until: '2026-08-31', modules: ['Profile'] }), [seeded], ctx)).toBeNull();
  });
  test('people, dates and modules', () => {
    expect(delegationProblem(draft({ who: 'E' }), [], ctx)).toMatchObject({ field: 'who', message: 'Ellie Warren does not approve anything, so there is no queue to cover.' });
    expect(delegationProblem(draft({ to: 'E' }), [], ctx)).toMatchObject({ field: 'to', message: 'Ellie Warren cannot approve, so cannot cover a queue.' });
    expect(delegationProblem(draft({ until: '2026-08-31' }), [], ctx)).toMatchObject({ field: 'until', message: 'The last day cannot be before the first day.' });
    expect(delegationProblem(draft({ from: '2026-08-01', until: '2026-08-12' }), [], ctx)).toMatchObject({ field: 'until', message: 'That delegation would already have ended.' });
    expect(delegationProblem(draft({ modules: [] }), [], ctx)).toMatchObject({ field: 'modules' });
  });
});

describe('who decides', () => {
  const world: ApproverWorld = {
    people: [
      { code: 'E', name: 'Ellie Warren', manager: 'Rachel Hussain', location: 'WH', department: 'CARE', active: true },
      { code: 'R', name: 'Rachel Hussain', manager: 'Dee Fitzgerald', location: 'WH', department: 'CARE', active: true },
      { code: 'D', name: 'Dee Fitzgerald', manager: '', location: 'FS', department: 'ADM', active: true },
      { code: 'S', name: 'Sam Other', manager: '', location: 'BC', department: 'CARE', active: true },
    ],
    holders: { 'Service Manager': ['R', 'S'], Payroll: ['D'], 'HR administrator': ['D'] },
  };
  const delegations: Delegation[] = [{ id: 'dlg_1', who: 'R', to: 'D', from: '2026-08-24', until: '2026-08-31', modules: ['Timesheet', 'Leave'] }];
  test('chain role, then the person who holds it, then an active delegation', () => {
    const leave = defaultChainFor('Leave');
    expect(whoDecides(leave, 'Leave', 'E', '2026-08-13', world, delegations).map(l => [l.role, l.deciders])).toEqual([
      ['Line manager', [{ approver: 'R', acting: 'R' }]], ['Service Manager', [{ approver: 'R', acting: 'R' }]]]);
    /* during the delegation, both days included, Dee acts for Rachel */
    expect(whoDecides(leave, 'Leave', 'E', '2026-08-24', world, delegations)[0]?.deciders).toEqual([{ approver: 'R', acting: 'D' }]);
    expect(whoDecides(leave, 'Leave', 'E', '2026-08-31', world, delegations)[0]?.deciders).toEqual([{ approver: 'R', acting: 'D' }]);
    expect(whoDecides(leave, 'Leave', 'E', '2026-09-01', world, delegations)[0]?.deciders).toEqual([{ approver: 'R', acting: 'R' }]);
    /* Profile is not delegated */
    expect(actingFor('R', 'Profile', '2026-08-25', delegations)).toBe('R');
  });
  test('scope narrows a role\'s holders; nobody decides their own', () => {
    const own = [step({ role: 'Service Manager', scope: 'Own department' })];
    expect(whoDecides(own, 'Leave', 'E', '2026-08-13', world, [])[0]?.deciders.map(d => d.approver)).toEqual(['R', 'S']);
    const loc = [step({ role: 'Service Manager', scope: 'Own location' })];
    expect(whoDecides(loc, 'Leave', 'E', '2026-08-13', world, [])[0]?.deciders.map(d => d.approver)).toEqual(['R']);
    expect(whoDecides(loc, 'Leave', 'R', '2026-08-13', world, [])[0]?.deciders).toEqual([]);
    expect(whoDecides([step({ role: 'Payroll', scope: 'All departments' })], 'Leave', 'E', '2026-08-13', world, [])[0]?.deciders.map(d => d.approver)).toEqual(['D']);
  });
});
