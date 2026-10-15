import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { LeaveDecided, LeaveMoved, LeaveRequested, MyLeave, TeamRequests } from '@/contract/leave';
import { SELF_APPROVAL, SIGNED_EARLIER } from '@/domain/leave';
import { FROZEN, audits, caller, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

/* Module 8 group 4B: a leave request walks the Leave approval chain. It stays
   waiting until the last layer that applies approves it; only then do its
   days count as taken and reach the rota. On social, Rachel Hussain (CP-1001)
   is the line manager at Willow House and Dee Fitzgerald (CP-1002) the
   administrator, who is Rachel's own line manager. Dee is given "Decide team
   leave" here so there is a second employee to decide a later layer. Amara
   Okafor (CP-1042, the employee persona) works nights on Thursday and Friday
   of week 33. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

type Call = ReturnType<typeof caller>;
const as = async (p: Persona) => caller(await tokenFor(p));
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const WRITES = ['leaveRequests', 'leaveLedger', 'rotaWeeks', 'coverRequests', 'notifications', 'audit'];
interface Note { employeeId: string; event?: string; title: string; body: string }
const told = (event: string) => Object.values(store.coll<Note>('notifications')).filter(n => n.event === event).map(n => [n.employeeId, n.title, n.body]);
interface Req { id: string; version: number; state: string; history: { from: string; to: string; layer?: string; by: { employeeCode: string } }[] }
const req = (id: string) => store.coll<Req>('leaveRequests')[id];
const lineOf = (code: string) => store.coll<{ lines: Record<string, string[]> }>('rotaWeeks')['rw_WH_2026-08-10']?.lines[code];
const approve = (call: Call, id: string, v: number) => call('POST', `/api/v1/leave/requests/${id}/approve`, undefined, v);
const decline = (call: Call, id: string, reason: string, v: number) => call('POST', `/api/v1/leave/requests/${id}/decline`, { reason }, v);
const queue = async (call: Call) => TeamRequests.parse((await call('GET', '/api/v1/leave/team/requests')).body);
const layer = (role: string, when: string, scope: string, sla = '5 days') => ({ role, scope, when, sla, fixed: false });
function adminDecidesLeave() {
  const admin = store.coll<{ capabilities: string[] }>('userTypes').admin;
  if (!admin) throw new Error('no admin type');
  admin.capabilities = [...admin.capabilities, 'team_leave'];
}
/* the line manager, then a Service Manager for every request */
async function twoLayers() {
  adminDecidesLeave();
  const r = await (await as('admin'))('PUT', '/api/v1/approvals/chains/Leave',
    { steps: [layer('Line manager', 'Every leave request', 'Own department'), layer('Service Manager', 'Every leave request', 'All departments', '2 days')] }, 0);
  expect(r.status).toBe(200);
}
/* Amara asks for Friday 14 August, a night she is on the rota for */
const askFriday = async () => LeaveRequested.parse((await (await as('employee'))('POST', '/api/v1/leave/requests',
  { type: 'AL', from: '2026-08-14', to: '2026-08-14', part: 'full' })).body).record;
const WAITING = 'Approved by the line manager, waiting on the Service Manager';

describe('two layers: the line manager, then the Service Manager', () => {
  test('a request is approved, and reaches the rota, only after the last layer approves', async () => {
    await twoLayers();
    const mine = await askFriday(), mgr = await as('manager'), admin = await as('admin'), emp = await as('employee');
    const before = lineOf('CP-1042'), asked = MyLeave.parse((await emp('GET', '/api/v1/leave/me')).body).balance;
    const first = LeaveDecided.parse((await approve(mgr, mine.id, 1)).body);
    expect(first.record).toMatchObject({ state: 'pending', stateLabel: WAITING, decidedBy: null });
    expect(first.record.history.at(-1)).toMatchObject({ from: 'pending', to: 'pending', layer: 'Line manager', by: { employeeCode: 'CP-1001' } });
    expect(first.summary).toBe('Amara’s request approved by you. It now waits on the Service Manager.');
    expect(first.rota.written).toBe(0);
    expect(lineOf('CP-1042')).toEqual(before);
    expect(audits().find(a => a.id === first.auditId)).toMatchObject({ act: 'Leave passed to the Service Manager', after: { state: 'pending', layer: 'Service Manager' } });
    /* still waiting, so it is held back as pending in the balance, not taken */
    const waiting = MyLeave.parse((await emp('GET', '/api/v1/leave/me')).body);
    expect(waiting.requests.find(r => r.id === mine.id)?.stateLabel).toBe(WAITING);
    expect([waiting.balance.pending, waiting.balance.takenD]).toEqual([asked.pending, asked.takenD]);
    const second = LeaveDecided.parse((await approve(admin, mine.id, 2)).body);
    expect(second.record).toMatchObject({ state: 'approved', stateLabel: 'Approved', decidedBy: { employeeCode: 'CP-1002' } });
    expect(second.record.history.at(-1)).toMatchObject({ from: 'pending', to: 'approved', layer: 'Service Manager' });
    expect(lineOf('CP-1042')?.[4]).toBe('V');
    expect(audits().find(a => a.id === second.auditId)?.act).toBe('Leave approved');
    const after = MyLeave.parse((await emp('GET', '/api/v1/leave/me')).body);
    expect([after.balance.takenD - waiting.balance.takenD, waiting.balance.pending - after.balance.pending]).toEqual([1, 1]);
  });
  test('the waiting request shows in the second holder\'s queue, at their layer, and leaves the first holder\'s', async () => {
    await twoLayers();
    const mine = await askFriday(), mgr = await as('manager'), admin = await as('admin');
    expect((await queue(admin)).requests.map(r => r.id)).not.toContain(mine.id);
    expect((await queue(mgr)).requests.find(r => r.id === mine.id)?.layer).toEqual({ n: 1, of: 2, role: 'Line manager', text: 'Layer 1 of 2 · Line manager.' });
    await approve(mgr, mine.id, 1);
    expect((await queue(mgr)).requests.map(r => r.id)).not.toContain(mine.id);
    const theirs = (await queue(admin)).requests.find(r => r.id === mine.id);
    expect(theirs).toMatchObject({ stateLabel: WAITING,
      layer: { n: 2, of: 2, role: 'Service Manager', text: 'Layer 2 of 2 · Service Manager. Approved by Rachel Hussain as the line manager.' } });
    /* the SLA job counts the Service Manager's wait from the line manager's approval, against the tenant's 5 days (D3) */
    expect(theirs?.sla).toMatchObject({ escalated: false, text: '5 of 5 days left' });
    store.setClock('2026-08-16T09:00:00.000Z');
    expect((await queue(await as('admin'))).requests.find(r => r.id === mine.id)?.sla.text).toBe('2 of 5 days left');
  });
  test('the second layer declines with a reason, and the request is declined', async () => {
    await twoLayers();
    const mine = await askFriday(), admin = await as('admin');
    await approve(await as('manager'), mine.id, 1);
    expect(refusal(await decline(admin, mine.id, ' ', 2))).toMatchObject({ code: 'REASON_REQUIRED', field: 'reason' });
    const d = LeaveMoved.parse((await decline(admin, mine.id, 'Two others are off that night', 2)).body);
    expect(d.record).toMatchObject({ state: 'declined', reason: 'Two others are off that night' });
    expect(d.record.history.at(-1)).toMatchObject({ from: 'pending', to: 'declined', layer: 'Service Manager' });
    expect(told('lv_no')).toEqual([['CP-1042', 'Leave declined', '14/08/2026 · Two others are off that night']]);
  });
});

describe('the seeded chain keeps today\'s behaviour (D6)', () => {
  test('no chain is stored: one approval approves, and the escalated request goes to the Service Manager, who is the same manager', async () => {
    const mgr = await as('manager');
    const q = await queue(mgr);
    expect(q.requests.map(r => [r.id, r.layer.of, r.sla.text])).toEqual([
      ['lr_1', 1, 'Escalated · Service Manager'], ['lr_2', 1, '3 of 5 days left'], ['lr_3', 1, '4 of 5 days left']]);
    expect(q.requests.find(r => r.id === 'lr_1')?.layer.role).toBe('Service Manager');
    const escalated = LeaveDecided.parse((await approve(mgr, 'lr_1', 1)).body);
    expect(escalated.record).toMatchObject({ state: 'approved' });
    expect(escalated.record.history.at(-1)).toMatchObject({ layer: 'Service Manager' });
    const plain = LeaveDecided.parse((await approve(mgr, 'lr_3', 1)).body);
    expect(plain.record).toMatchObject({ state: 'approved' });
    expect(plain.record.history.at(-1)).toMatchObject({ layer: 'Line manager' });
  });
});

describe('delegation applies at every layer', () => {
  test('while Rachel\'s seeded delegation is in force, Dee decides Rachel\'s layer for her, without the capability', async () => {
    store.setClock('2026-08-25T09:00:00.000Z');
    const admin = await as('admin');
    expect((await queue(admin)).requests.map(r => r.id)).toEqual(['lr_1', 'lr_2', 'lr_3']);
    const r = LeaveDecided.parse((await approve(admin, 'lr_3', 1)).body);
    expect(r.record).toMatchObject({ state: 'approved', decidedBy: { employeeCode: 'CP-1002' } });
    store.setClock(FROZEN);
    const dee = await as('admin'), before = snapshot(...WRITES);
    const early = await approve(dee, 'lr_2', 1);
    expect([early.status, refusal(early).code]).toEqual([403, 'capability']);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a delegate covers the Service Manager layer for its holder', async () => {
    await twoLayers();
    const mine = await askFriday();
    await approve(await as('manager'), mine.id, 1);
    store.coll('delegations').dlg_9 = { id: 'dlg_9', version: 1, updatedAt: FROZEN, who: 'CP-1002', to: 'CP-1153', from: '2026-08-13', until: '2026-08-20', modules: ['Leave'] };
    const jo = caller(await tokenForEmail('jo.baptiste@brightpath.org'));
    expect((await queue(jo)).requests.map(r => r.id)).toEqual([mine.id]);
    const r = LeaveDecided.parse((await approve(jo, mine.id, 2)).body);
    expect(r.record).toMatchObject({ state: 'approved', decidedBy: { employeeCode: 'CP-1153' } });
  });
});

describe('permissions on every layer', () => {
  test('self-approval is refused at both layers, and whoever approved one layer cannot approve the next', async () => {
    await twoLayers();
    const own = LeaveRequested.parse((await (await as('manager'))('POST', '/api/v1/leave/requests', { type: 'AL', from: '2026-09-21', to: '2026-09-21', part: 'full' })).body).record;
    const mgr = await as('manager'), admin = await as('admin');
    const before = snapshot(...WRITES);
    expect(refusal(await approve(mgr, own.id, 1))).toEqual({ code: 'SELF_APPROVAL', message: SELF_APPROVAL, next: 'Ask another approver at your location.' });
    expect(snapshot(...WRITES)).toEqual(before);
    /* Dee is Rachel's own line manager, so she holds the line manager's layer for her whatever her department */
    expect(LeaveDecided.parse((await approve(admin, own.id, 1)).body).record.state).toBe('pending');
    for (const r of [await approve(mgr, own.id, 2), await decline(mgr, own.id, 'x', 2)])
      expect([r.status, refusal(r).code]).toEqual([403, 'SELF_APPROVAL']);
    const again = await approve(admin, own.id, 2);
    expect([again.status, refusal(again).code, refusal(again).message]).toEqual([403, 'ALREADY_SIGNED', SIGNED_EARLIER]);
    expect(req(own.id)?.state).toBe('pending');
  });
  test('the wrong layer, no capability and out of scope are each refused, and nothing is written', async () => {
    await twoLayers();
    const mine = await askFriday();
    const lr1 = store.coll<Record<string, unknown>>('leaveRequests').lr_1;
    store.coll('leaveRequests').lr_9 = { ...lr1, id: 'lr_9', employeeCode: 'EMP-2044', history: [] };
    /* Jo covers Dee, who decides only the Service Manager's layer, so the line manager's is not Jo's */
    store.coll('delegations').dlg_9 = { id: 'dlg_9', version: 1, updatedAt: FROZEN, who: 'CP-1002', to: 'CP-1153', from: '2026-08-13', until: '2026-08-20', modules: ['Leave'] };
    const jo = caller(await tokenForEmail('jo.baptiste@brightpath.org')), emp = await as('employee'), mgr = await as('manager');
    const before = snapshot(...WRITES);
    const wrong = await approve(jo, mine.id, 1);
    expect([wrong.status, refusal(wrong).code, refusal(wrong).message, refusal(wrong).next]).toEqual([403, 'WRONG_LAYER',
      'This request is waiting on the line manager, not on a layer you decide.', 'The line manager decides it now.']);
    for (const r of [await approve(emp, 'lr_1', 1), await decline(emp, 'lr_1', 'No', 1), await emp('GET', '/api/v1/leave/team/requests')])
      expect([r.status, refusal(r).code]).toEqual([403, 'capability']);
    const out = await approve(mgr, 'lr_9', 1);
    expect([out.status, refusal(out).code, refusal(out).message]).toEqual([403, 'scope', 'You can decide leave for employees at Willow House only.']);
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

describe('notifications', () => {
  test('a request tells the line manager; the line manager\'s approval tells the Service Manager and the colleague; the last approval tells the colleague', async () => {
    await twoLayers();
    const mine = await askFriday();
    expect(told('lv_req').filter(n => n[0] === 'CP-1001').map(n => n[1])).toEqual(['Leave requested']);
    await approve(await as('manager'), mine.id, 1);
    expect(told('lv_esc')).toEqual([
      ['CP-1002', 'Leave request awaiting approval', 'Amara Okafor · Annual leave · 14/08/2026. Approved by Rachel Hussain, now waiting on the Service Manager.'],
      ['CP-1042', 'Leave request moved on', '14/08/2026. Approved by Rachel Hussain. The Service Manager decides it next.']]);
    expect(told('lv_ok')).toEqual([]);
    await approve(await as('admin'), mine.id, 2);
    expect(told('lv_ok')).toEqual([['CP-1042', 'Leave approved', '14/08/2026 · Annual leave']]);
  });
});

describe('a chain edited while a request waits part-way along it (review I5)', () => {
  const lineManagerOnly = [layer('Line manager', 'Every leave request', 'Own department')];
  test('a save that would leave a request signed at every layer still applying, with nobody to decide it, is refused and names it', async () => {
    await twoLayers();
    const mine = await askFriday();
    await approve(await as('manager'), mine.id, 1);
    const admin = await as('admin'), before = snapshot('approvalChains', 'audit');
    const r = await admin('PUT', '/api/v1/approvals/chains/Leave', { steps: lineManagerOnly }, 1);
    expect([r.status, refusal(r).code, refusal(r).usedBy]).toEqual([409, 'in-use',
      [{ kind: 'leave requests', count: 1, examples: ['Amara Okafor (CP-1042) · 14/08/2026'] }]]);
    expect(refusal(r).message).toBe('Saving this chain would leave 1 leave request with every layer that still applies signed, and nobody left to decide it.');
    expect(snapshot('approvalChains', 'audit')).toEqual(before);
    /* adding a layer is saved: the request still has the Service Manager's to wait on */
    const more = await admin('PUT', '/api/v1/approvals/chains/Leave', { steps: [...lineManagerOnly,
      layer('Service Manager', 'Every leave request', 'All departments', '2 days'), layer('Service Manager', 'Only when the SLA is breached', 'Own location', '2 days')] }, 1);
    expect(more.status).toBe(200);
  });
  test('a request whose chain changed under it anyway is settled by the next decision, its earlier signer included', async () => {
    await twoLayers();
    const mine = await askFriday();
    await approve(await as('manager'), mine.id, 1);
    const stored = store.coll<{ steps: unknown[] }>('approvalChains').chain_leave;
    if (!stored) throw new Error('no stored Leave chain');
    stored.steps = lineManagerOnly.map(s => ({ ...s, module: 'Leave' }));
    expect((await queue(await as('manager'))).requests.map(r => r.id)).toContain(mine.id);
    const r = LeaveDecided.parse((await approve(await as('manager'), mine.id, 2)).body);
    expect(r.record).toMatchObject({ state: 'approved', decidedBy: { employeeCode: 'CP-1001' } });
    expect(lineOf('CP-1042')?.[4]).toBe('V');
  });
});

async function tokenForEmail(email: string): Promise<string> {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  return ((await r.json()) as { token: string }).token;
}
