import {
  APPROVER_ROLES, CHAIN_MODULES, CHAIN_ROLE_RULES, CONDITIONS, DEFAULT_CHAIN, POSTING_STEP, STEP_SCOPES, actingFor, chainCapabilities, chainProblem, chainText,
  decisionBlock, defaultChainFor, delegationProblem, roleOptions, roleRule, walkChain, type ChainItem, type DeciderPerson, type ItemFacts, type WalkInput,
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
  test('a delegate without the access a Profile stage needs cannot cover it (M1)', () => {
    const lacks = (_who: string, to: string, m: string) => (m === 'Profile' && to === 'O' ? ['Approve profile changes'] : []);
    expect(delegationProblem(draft({ modules: ['Leave', 'Profile'] }), [], { ...ctx, lacks })).toEqual({ status: 422, code: 'invalid', field: 'to',
      message: 'Owen Clarke cannot cover Dee Fitzgerald’s Profile approvals without "Approve profile changes".',
      next: 'Choose someone who has it in Permissions, or leave Profile out.' });
    expect(delegationProblem(draft({ modules: ['Leave'] }), [], { ...ctx, lacks })).toBeNull();
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

describe('module 8 group 4: the role table and the layer walker', () => {
  const ts = (o: Partial<ChainStep> = {}): ChainStep =>
    ({ module: 'Timesheet', role: 'Line manager', scope: 'Own department', when: 'Every timesheet', sla: '24 hours', fixed: false, ...o });
  const payroll = ts({ role: 'Payroll', scope: 'All departments', when: 'Only above a premium threshold', sla: '48 hours' });
  const person = (code: string, caps: string[], o: Partial<DeciderPerson> = {}): DeciderPerson =>
    ({ code, location: 'WH', department: 'CARE', active: true, caps, allLocations: false, ...o });
  const people = [person('E', []), person('M', ['team_ts']), person('P', ['pay_appr'], { location: 'FS', department: 'ADM', allLocations: true }),
    person('O', ['team_ts'], { location: 'BC' }), person('D', ['team_leave'])];
  const item = (facts: ItemFacts = {}): ChainItem => ({ personCode: 'E', location: 'WH', department: 'CARE', facts });
  const walk = (o: Partial<WalkInput> = {}) => walkChain({ module: 'Timesheet', steps: [ts(), payroll, POSTING_STEP], item: item(), signed: [],
    date: '2026-08-13', people, delegations: [], ...o });

  test('each role maps to one capability: the line manager is team_ts in scope, payroll is pay_appr', () => {
    expect(CHAIN_ROLE_RULES.Timesheet).toEqual({ 'Line manager': { capability: 'team_ts', scoped: true }, Payroll: { capability: 'pay_appr', scoped: false } });
    expect(roleRule('Profile', 'Payroll')?.capability).toBe('bank_verify');
    expect(roleOptions('Timesheet')).toEqual(['Line manager', 'Payroll']);
    expect(roleOptions('Rota')).toEqual(['Service Manager']);
    expect(chainCapabilities('Timesheet')).toEqual(['team_ts', 'pay_appr']);
  });
  test('a role with no row is refused clearly, and a Timesheet chain is ordered, once each, and covers every timesheet', () => {
    expect(chainProblem('Timesheet', [ts({ role: 'HR administrator' }), POSTING_STEP])).toMatchObject({ field: 'steps.0.role',
      message: 'The Timesheet chain can only have a line manager and payroll.', next: 'Choose one of those two.' });
    expect(chainProblem('Rota', [step({ module: 'Rota', role: 'Payroll', when: 'Only for agency booking' })])?.message).toBe('The Rota chain can only have a Service Manager.');
    expect(chainProblem('Timesheet', [ts(), ts({ when: 'Only for proxy entries' }), POSTING_STEP])?.message)
      .toBe('Line manager appears twice in the Timesheet chain. Each approver signs off once.');
    expect(chainProblem('Timesheet', [ts({ role: 'Payroll' }), ts({ when: 'Only for proxy entries' }), POSTING_STEP])).toMatchObject({ field: 'steps.1.role',
      message: 'The line manager signs off first in the Timesheet chain.' });
    expect(chainProblem('Timesheet', [ts({ when: 'Only for proxy entries' }), POSTING_STEP])?.message).toBe('Every timesheet needs an approver.');
    expect(chainProblem('Timesheet', [ts({ when: 'Every leave request' }), POSTING_STEP])?.field).toBe('steps.0.when');
    expect(whenOptions('Timesheet')).toEqual(['Every timesheet', 'Only above a premium threshold', 'Only for absence or non-working days', 'Only for proxy entries']);
    expect(chainProblem('Timesheet', [ts({ role: 'Payroll', scope: 'All departments' }), POSTING_STEP])).toBeNull();
  });
  test('every condition reads its fact, and an unknown condition never applies', () => {
    expect(CONDITIONS['Every timesheet']?.({})).toBe(true);
    expect([CONDITIONS['Only above a premium threshold']?.({}), CONDITIONS['Only above a premium threshold']?.({ premium: true })]).toEqual([false, true]);
    expect(CONDITIONS['Only for proxy entries']?.({ proxy: true })).toBe(true);
    expect(CONDITIONS['Only for absence or non-working days']?.({ absence: true })).toBe(true);
    expect(walk({ steps: [ts({ when: 'Some day' })] }).layers).toEqual([]);
  });
  test('the applicable layers come in order, with the current one and who may decide it', () => {
    const plain = walk();
    expect(plain.layers.map(l => l.step.role)).toEqual(['Line manager']);
    expect(plain).toMatchObject({ final: true, current: { holders: ['M'], deciders: ['M'] } });
    const premium = walk({ item: item({ premium: true }) });
    expect(premium.layers.map(l => [l.step.role, l.deciders])).toEqual([['Line manager', ['M']], ['Payroll', ['P']]]);
    expect([premium.current?.step.role, premium.final]).toEqual(['Line manager', false]);
    const signed = walk({ item: item({ premium: true }), signed: ['Line manager'] });
    expect([signed.current?.step.role, signed.final]).toEqual(['Payroll', true]);
    /* a chain changed under the item: every layer has signed, so the last one closes it */
    expect(walk({ signed: ['Line manager'] }).current?.step.role).toBe('Line manager');
    expect(walk({ steps: [] })).toEqual({ layers: [], current: null, final: true, complete: true });
  });
  test('a walk with nothing left to sign is settled by the last layer\'s holders, its signers included (review I5)', () => {
    /* the payroll layer was taken out after the line manager signed: M settles the day */
    const done = walk({ steps: [ts(), POSTING_STEP], item: item({ premium: true }), signed: ['Line manager'], signers: ['M'] });
    expect([done.complete, done.final, done.current?.step.role, done.current?.deciders]).toEqual([true, true, 'Line manager', ['M']]);
    expect(decisionBlock(done, { module: 'Timesheet', item: item({ premium: true }), people, signers: ['M'] }, 'M')).toBeNull();
    /* while a layer is still to sign, a signer decides no later one */
    const waiting = walk({ item: item({ premium: true }), signed: ['Line manager'], signers: ['M'] });
    expect([waiting.complete, decisionBlock(waiting, { module: 'Timesheet', item: item({ premium: true }), people, signers: ['M'] }, 'M')]).toEqual([false, 'signed']);
    /* no layer applies any more: the chain's layer that was signed settles it */
    const none = walk({ steps: [ts({ when: 'Only for proxy entries' }), POSTING_STEP], signed: ['Line manager'], signers: ['M'] });
    expect([none.layers, none.complete, none.current?.step.when, none.current?.deciders]).toEqual([[], true, 'Only for proxy entries', ['M']]);
  });
  test('scope narrows a layer: the line manager in their access scope and the layer\'s own, never the person themself', () => {
    expect(walk({ item: { ...item(), location: 'BC' } }).current?.holders).toEqual(['O']);
    expect(walk({ item: { ...item(), department: 'OPS' } }).current?.holders).toEqual([]);
    expect(walk({ steps: [ts({ scope: 'All departments' })], item: { ...item(), department: 'OPS' } }).current?.holders).toEqual(['M']);
    expect(walk({ item: { ...item(), personCode: 'M' } }).current?.holders).toEqual([]);
    expect(walk({ people: people.map(p => (p.code === 'M' ? { ...p, active: false } : p)) }).current?.holders).toEqual([]);
  });
  test('delegation applies at every layer while it is in force, and never to the person themself', () => {
    const m: Delegation = { id: 'dlg_1', who: 'M', to: 'D', from: '2026-08-10', until: '2026-08-20', modules: ['Timesheet'] };
    const p: Delegation = { ...m, id: 'dlg_2', who: 'P' };
    expect(walk({ item: item({ premium: true }), delegations: [m, p] }).layers.map(l => l.deciders)).toEqual([['M', 'D'], ['P', 'D']]);
    expect(walk({ delegations: [m], date: '2026-08-21' }).current?.deciders).toEqual(['M']);
    expect(walk({ delegations: [{ ...m, to: 'E' }] }).current?.deciders).toEqual(['M']);
    expect(walk({ delegations: [{ ...m, modules: ['Leave'] }] }).current?.deciders).toEqual(['M']);
  });
  test('why someone may not decide: their own, out of scope, another layer, or nothing in the chain', () => {
    const input = { module: 'Timesheet' as const, item: item({ premium: true }), people };
    const first = walk({ item: input.item }), second = walk({ item: input.item, signed: ['Line manager'] });
    expect(decisionBlock(first, input, 'M')).toBeNull();
    expect(decisionBlock(first, input, 'E')).toBe('self');
    expect(decisionBlock(first, input, 'O')).toBe('scope');
    expect(decisionBlock(first, input, 'P')).toBe('layer');
    expect(decisionBlock(second, input, 'M')).toBe('layer');
    expect(decisionBlock(second, input, 'P')).toBeNull();
    expect(decisionBlock(first, input, 'D')).toBe('capability');
  });
});
