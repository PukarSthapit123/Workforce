import {
  CONDITIONS, chainProblem, decisionBlock, defaultChainFor, newLayer, walkChain, walkProgress, whenOptions,
  type ChainItem, type ChainStep, type DeciderPerson, type WalkInput,
} from './approvals';
import { firstLayerBreached, layerStartedAt, layerText, layerWaitingLabel, leaveSignedLayers, leaveSigners, type LeaveSign } from './leave';

/* Module 8 group 4B: the walker as Leave and Rota use it. Every role of those
   chains needs the same capability, so the walker matches a signed role to the
   first unsigned layer of that role, keeps whoever signed one layer from the
   next, lets an escalation layer take over from the layers before it, and lets
   the person's own line manager hold the Line manager layer. */
const step = (o: Partial<ChainStep> = {}): ChainStep => ({ module: 'Leave', role: 'Line manager', scope: 'Own department', when: 'Every leave request', sla: '5 days', fixed: false, ...o });
const person = (code: string, o: Partial<DeciderPerson> = {}): DeciderPerson =>
  ({ code, location: 'WH', department: 'CARE', active: true, caps: ['team_leave'], allLocations: false, ...o });
/* M manages the team; S is a second Service Manager at the location; A is an administrator elsewhere, and E's own line manager */
const people = [person('M'), person('S'), person('A', { location: 'FS', department: 'ADM', allLocations: true }), person('E', { caps: [] })];
const item = (o: Partial<ChainItem> = {}): ChainItem => ({ personCode: 'E', location: 'WH', department: 'CARE', facts: {}, ...o });
const input = (o: Partial<WalkInput> = {}): WalkInput =>
  ({ module: 'Leave', steps: [step()], item: item(), signed: [], date: '2026-08-13', people, delegations: [], ...o });
const twoLayers = [step(), step({ role: 'Service Manager', scope: 'Own location' })];

describe('the conditions Leave and Rota offer are the ones the server reads', () => {
  test('Leave: every request, or the escalation; Rota: every week, or agency booking', () => {
    expect(whenOptions('Leave')).toEqual(['Every leave request', 'Only when the SLA is breached']);
    expect(whenOptions('Rota')).toEqual(['Every rota week', 'Only for agency booking']);
    expect([CONDITIONS['Every rota week']?.({}), CONDITIONS['Only for agency booking']?.({ agency: true }), CONDITIONS['Only when the SLA is breached']?.({})])
      .toEqual([true, true, false]);
    expect(newLayer('Rota')).toMatchObject({ role: 'Service Manager', when: 'Every rota week' });
  });
  test('the defaults stay valid, a Leave chain needs a layer for every request, and a condition from elsewhere is refused', () => {
    expect([chainProblem('Leave', defaultChainFor('Leave')), chainProblem('Rota', defaultChainFor('Rota'))]).toEqual([null, null]);
    expect(chainProblem('Leave', [step({ when: 'Only when the SLA is breached' })])?.message).toBe('Every leave request needs an approver.');
    expect(chainProblem('Leave', [step({ when: 'Only for proxy entries' })])).toMatchObject({ field: 'steps.0.when' });
    expect(chainProblem('Rota', [step({ module: 'Rota', role: 'Service Manager', when: 'Every leave request' })])).toMatchObject({ field: 'steps.0.when' });
  });
});

describe('walking a Leave or Rota chain', () => {
  test('two layers of the same role are signed one at a time', () => {
    const rota = (signed: string[]) => walkChain(input({ module: 'Rota', steps: [step({ module: 'Rota', role: 'Service Manager', when: 'Every rota week' }),
      step({ module: 'Rota', role: 'Service Manager', when: 'Every rota week', scope: 'All departments' })], item: item({ personCode: '' }),
    people: people.map(p => ({ ...p, caps: p.caps.length ? ['team_rota'] : [] })), signed }));
    expect([rota([]).current?.step.scope, rota([]).final]).toEqual(['Own department', false]);
    expect([rota(['Service Manager']).current?.step.scope, rota(['Service Manager']).final]).toEqual(['All departments', true]);
  });
  test('whoever signed a layer decides no later one, and is told so', () => {
    const i = input({ steps: twoLayers, signed: ['Line manager'], signers: ['M'] });
    const w = walkChain(i);
    expect([w.current?.step.role, w.current?.deciders]).toEqual(['Service Manager', ['S']]);
    expect([decisionBlock(w, i, 'M'), decisionBlock(w, i, 'S'), decisionBlock(w, i, 'E')]).toEqual(['signed', null, 'self']);
    expect(walkProgress(i).signed.map(l => l.step.role)).toEqual(['Line manager']);
  });
  test('the escalation layer applies once the SLA is breached and takes over from the unsigned layer before it', () => {
    const steps = [step(), step({ role: 'Service Manager', scope: 'Own location', when: 'Only when the SLA is breached' })];
    expect(walkChain(input({ steps })).layers.map(l => l.step.role)).toEqual(['Line manager']);
    const breached = input({ steps, item: item({ facts: { slaBreached: true } }) });
    expect([walkChain(breached).current?.step.role, walkChain(breached).final]).toEqual(['Service Manager', true]);
    expect(walkProgress(breached).passed.map(l => l.step.role)).toEqual(['Line manager']);
    /* the line manager signed within the SLA: the escalation does not apply */
    expect(walkChain(input({ steps, signed: ['Line manager'] })).final).toBe(true);
  });
  test('the person\'s own line manager holds the Line manager layer whatever their department, given the capability and the access', () => {
    expect(walkChain(input({ item: item({ manager: 'A' }) })).current?.holders).toEqual(['M', 'S', 'A']);
    expect(walkChain(input({ item: item({ manager: 'A' }), people: people.map(p => (p.code === 'A' ? { ...p, caps: [] } : p)) })).current?.holders).toEqual(['M', 'S']);
  });
  test('a rota week has no department, so Own department reads as its location', () => {
    const w = walkChain(input({ module: 'Rota', steps: [step({ module: 'Rota', role: 'Service Manager', when: 'Every rota week' })],
      item: { personCode: '', location: 'WH', facts: {} }, people: people.map(p => ({ ...p, caps: p.caps.length ? ['team_rota'] : [] })) }));
    expect(w.current?.holders).toEqual(['M', 'S']);
  });
});

describe('a leave request\'s layers', () => {
  const by = (code: string, name: string) => ({ personCode: code, name });
  const history: LeaveSign[] = [
    { from: '', to: 'pending', by: by('E', 'Amara Okafor'), at: '2026-08-12T08:00:00.000Z' },
    { from: 'pending', to: 'pending', by: by('M', 'Rachel Hussain'), at: '2026-08-14T09:00:00.000Z', layer: 'Line manager' },
  ];
  test('the signed layers and who signed them come from the history; the next layer waits from the last approval', () => {
    expect([leaveSignedLayers(history), leaveSigners(history)]).toEqual([['Line manager'], ['M']]);
    expect(layerStartedAt(history, '2026-08-12T08:00:00.000Z')).toBe('2026-08-14T09:00:00.000Z');
    expect(layerStartedAt(history.slice(0, 1), '2026-08-12T08:00:00.000Z')).toBe('2026-08-12T08:00:00.000Z');
    expect(leaveSignedLayers([...history, { from: 'pending', to: 'declined', by: by('S', 'Dee'), at: '2026-08-15T09:00:00.000Z', layer: 'Service Manager' }])).toEqual(['Line manager']);
  });
  test('the first layer breaches the SLA after its days, counted to its approval or to today', () => {
    expect(firstLayerBreached({ raised: '2026-08-08' }, 5, '2026-08-13')).toBe(false);
    expect(firstLayerBreached({ raised: '2026-08-08' }, 5, '2026-08-14')).toBe(true);
    expect(firstLayerBreached({ raised: '2026-08-08', firstSigned: '2026-08-10' }, 5, '2026-08-20')).toBe(false);
    expect(firstLayerBreached({ raised: '2026-08-12', escalated: true }, 5, '2026-08-13')).toBe(true);
  });
  test('the waiting label and the layer line read from the roles', () => {
    expect(layerWaitingLabel('Line manager', 'Service Manager')).toBe('Approved by the line manager, waiting on the Service Manager');
    expect(layerText(2, 2, 'Service Manager', [{ layer: 'Line manager', name: 'Rachel Hussain' }])).toBe('Layer 2 of 2 · Service Manager. Approved by Rachel Hussain as the line manager.');
    expect(layerText(1, 2, 'Line manager', [])).toBe('Layer 1 of 2 · Line manager.');
  });
});
