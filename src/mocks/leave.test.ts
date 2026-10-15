import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import {
  DaysGivenBack, EntitlementDetail, LeaveDecided, LeaveMoved, LeaveRequested, LeaveSetup, Leavers, MyLeave, RtwArranged, SicknessBoard,
  SicknessRecorded, TeamBalances, TeamRequests,
} from '@/contract/leave';
import { MultiweekSubmitted, TimesheetWeek, WeekSubmitted } from '@/contract/timesheets';
import {
  CHOOSE_TYPE, LAST_BEFORE_FIRST, PICK_BOTH_DATES, REASON_REQUIRED, RTW_ALREADY, SELF_APPROVAL, absenceHeldReason, approvedToast, halfDaySingle, moreThanLeft,
  triggerBannerText,
} from '@/domain/leave';
import { audits, caller, fault, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

type Call = ReturnType<typeof caller>;
const as = async (p: Persona) => caller(await tokenFor(p));
async function asEmail(email: string): Promise<Call> {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const { token } = (await r.json()) as { token: string };
  return caller(token);
}
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const WRITES = ['leaveRequests', 'leaveLedger', 'sickEpisodes', 'leaveConfig', 'rotaWeeks', 'coverRequests', 'notifications', 'audit'];
interface Week { id: string; version: number; state: string; lines: Record<string, string[]>; changes: { afterPublish: boolean; to: string; employeeCode: string; why: string; by: { employeeCode: string } }[] }
const week = (loc: string, ws: string) => store.coll<Week>('rotaWeeks')[`rw_${loc}_${ws}`];
interface Note { id: string; employeeId: string; title: string; body: string; area: string; event?: string; channel?: string }
/* the rows this test raised: the seeded feeds (1c) are left out */
const notes = (employeeId?: string) => Object.values(store.coll<Note>('notifications')).filter(n => !n.id.startsWith('ntf_seed_') && (!employeeId || n.employeeId === employeeId));
const titles = (employeeId: string) => notes(employeeId).map(n => n.title);
/* the module's own rows: signing in writes one too */
const leaveAudits = () => audits().filter(a => a.act !== 'Signed in');
interface Req { id: string; version: number; state: string; employeeCode: string; reason: string; history: { from: string; to: string }[]; decidedBy: { employeeCode: string } | null }
const req = (id: string) => store.coll<Req>('leaveRequests')[id];
const setFlag = (k: string, on: boolean) => { const t = store.coll<{ flags: Record<string, boolean> }>('tenant').tenant; if (t) t.flags[k] = on; };
const setModule = (k: string, on: boolean) => { const t = store.coll<{ modules: Record<string, boolean> }>('tenant').tenant; if (t) t.modules[k] = on; };
/* A waiting request planted straight into the store, for scope checks. */
function plant(id: string, employeeCode: string, from = '2026-09-07', to = '2026-09-08') {
  const lr1 = store.coll<Record<string, unknown>>('leaveRequests').lr_1;
  store.coll('leaveRequests')[id] = { ...lr1, id, employeeCode, from, to, qty: 2, history: [] };
}
const AMARA = 'amara.okafor@brightpath.org', ROSA = 'rosa.mendes@brightpath.org', BIGYAN = 'bigyan.poudel@dogmagroup.co.uk', PUKAR = 'pukar.sthapit@dogmagroup.co.uk';
const ask = (call: Call, body: Record<string, unknown>) => call('POST', '/api/v1/leave/requests', { type: 'AL', part: 'full', ...body });
const approve = (call: Call, id: string, v = 1) => call('POST', `/api/v1/leave/requests/${id}/approve`, undefined, v);
const decline = (call: Call, id: string, reason: string, v = 1) => call('POST', `/api/v1/leave/requests/${id}/decline`, { reason }, v);
const cancel = (call: Call, id: string, v = 1) => call('POST', `/api/v1/leave/requests/${id}/cancel`, undefined, v);
const myLeave = async (call: Call) => MyLeave.parse((await call('GET', '/api/v1/leave/me')).body);

/* Module 8 group 3: the policies moved from words to methods, and carry-over and
   bank-holiday handling were added, without moving any seeded number (D6).
   Every employee on both tenants, as the entitlement read gave them before the
   change (040cbe8): entitlement days and hours, taken, waiting, and left in
   days and hours. The admin is given both leave reads so nobody is out of reach. */
const SEEDED_BALANCES: Record<'social' | 'qnipay', Record<string, number[]>> = {
  social: {
    'CP-1042': [25, 187.5, 9.5, 2, 13.5, 101.25], 'CP-1088': [20, 120, 15, 0, 5, 30], 'CP-1153': [26, 195, 11, 0, 15, 112.5],
    'CP-1201': [14.4, 64.8, 9, 5, 0.4, 1.8], 'CP-1266': [22.9, 151.14, 6, 0, 16.9, 111.54], 'CP-1402': [25, 187.5, 8, 0, 17, 127.5],
    'CP-1310': [5.1, 38.6, 0, 0, 5.1, 38.6], 'CP-1455': [6.9, 52.1, 1, 0, 5.9, 44.6], 'CP-1377': [2.2, 16.4, 0, 0, 2.2, 16.4],
    'CP-1490': [3.2, 24.2, 0, 0, 3.2, 24.2], 'CP-1001': [27, 202.5, 12, 0, 15, 112.5], 'CP-1002': [27, 202.5, 5, 0, 22, 165],
    'CP-1288': [14.4, 64.8, 16, 0, -1.6, -7.2], 'EMP-2044': [25, 200, 10, 0, 15, 120], 'EMP-2062': [25, 187.5, 7, 0, 18, 135],
    'EMP-2071': [25, 200, 4, 0, 21, 168], 'EMP-2088': [24, 180, 9, 0, 15, 112.5], 'CP-1501': [24, 180, 0, 0, 24, 180],
    'CP-1502': [19.2, 115.2, 0, 0, 19.2, 115.2],
  },
  qnipay: {
    EMP001: [24, 180, 0, 0, 24, 180], EMP002: [24, 180, 0, 0, 24, 180], EMP003: [24, 192, 0, 0, 24, 192], EMP004: [24, 192, 9.5, 2, 12.5, 100],
    EMP005: [24, 180, 11.5, 5, 7.5, 56.25], EMP006: [24, 180, 0, 0, 24, 180], EMP007: [24, 180, 8, 0, 16, 120], EMP008: [24, 180, 16, 0, 8, 60],
    EMP009: [24, 180, 15, 0, 9, 67.5], EMP010: [24, 180, 11, 0, 13, 97.5], EMP011: [24, 180, 6, 0, 18, 135], EMP012: [24, 192, 0, 0, 24, 192],
    EMP013: [24, 192, 0, 0, 24, 192], EMP014: [24, 192, 0, 0, 24, 192], EMP015: [24, 192, 0, 0, 24, 192], EMP016: [24, 192, 0, 0, 24, 192],
    EMP017: [24, 192, 0, 0, 24, 192], EMP018: [24, 180, 0, 0, 24, 180], EMP019: [24, 180, 0, 0, 24, 180], EMP020: [24, 180, 0, 0, 24, 180],
  },
};
test.each(['social', 'qnipay'] as const)('every seeded employee on %s keeps the entitlement and balance they had before leave became configurable', async tenant => {
  resetTo(tenant);
  const admin = store.coll<{ capabilities: string[] }>('userTypes').admin;
  admin?.capabilities.push('team_leave', 'own_leave');
  const call = await as('admin'), seen: Record<string, number[]> = {};
  for (const code of Object.values(store.coll<{ code: string }>('employees')).map(p => p.code)) {
    const { entitlement: e, balance: b } = EntitlementDetail.parse((await call('GET', `/api/v1/leave/entitlement/${code}`)).body);
    seen[code] = [e.days, e.hours, b.takenD, b.pending, b.leftD, b.leftH];
  }
  expect(seen).toEqual(SEEDED_BALANCES[tenant]);
});

describe('requesting leave (Review Focus 2)', () => {
  test('an employee asks for leave: a waiting record, the balance holds it back, the manager and the employee are told, one audit row', async () => {
    const call = await as('employee'), before = await myLeave(call);
    const r = LeaveRequested.parse((await ask(call, { from: '2026-09-14', to: '2026-09-15', note: 'Wedding' })).body);
    expect(r.record).toMatchObject({ id: 'lr_6', employeeCode: 'CP-1042', state: 'pending', qty: 2, unit: 'days', note: 'Wedding', stateLabel: 'Waiting', range: '14/09/2026 – 15/09/2026' });
    expect(r.hint).toBe(`${Number((before.balance.leftD - 2).toFixed(1))} days would remain.`);
    expect(r.summary).toBe('Annual leave requested · 2 days · 15.00 hours · sent to Rachel Hussain');
    const after = await myLeave(call);
    expect(after.balance.leftD).toBe(Number((before.balance.leftD - 2).toFixed(1)));
    expect(after.balance.pending).toBe(before.balance.pending + 2);
    expect(after.requests[0]?.id).toBe('lr_6');
    expect(titles('CP-1001')).toEqual(['Leave requested']);
    expect(titles('CP-1042')).toEqual(['Leave request sent']);
    expect(leaveAudits().map(a => a.act)).toEqual(['Leave requested']);
  });
  test('each validation is refused with the prototype\'s sentence and its field, and nothing is written', async () => {
    const call = await as('employee'), before = snapshot(...WRITES);
    const cases: [Record<string, unknown>, string, string][] = [
      [{ from: '', to: '2026-09-15' }, 'from', PICK_BOTH_DATES],
      [{ from: '2026-09-15', to: '2026-09-14' }, 'to', LAST_BEFORE_FIRST],
      [{ from: '2026-09-14', to: '2026-09-15', part: 'am' }, 'part', halfDaySingle('am')],
      [{ from: '2026-09-14', to: '2026-09-14', type: 'XX' }, 'type', CHOOSE_TYPE],
    ];
    for (const [body, field, message] of cases) {
      const r = await ask(call, body);
      expect(r.status).toBe(422);
      expect(refusal(r)).toMatchObject({ code: 'invalid', field, message });
    }
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('the balance is enforced on the server, and a waiting request already holds its days back', async () => {
    const call = await as('employee'), left = (await myLeave(call)).balance.leftD;
    expect((await ask(call, { from: '2026-09-14', to: '2026-09-15' })).status).toBe(200);
    const before = snapshot(...WRITES);
    const r = await ask(call, { from: '2026-10-01', to: '2026-12-31' });
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ code: 'OVER_BALANCE', field: 'to', message: moreThanLeft(Number((left - 2).toFixed(1))) });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  /* review M1: the same day cannot be asked for twice, so it is never charged twice */
  test('a request overlapping the employee\'s own waiting or approved leave is refused with OVERLAPS, and nothing is written', async () => {
    const call = await as('employee');
    const first = LeaveRequested.parse((await ask(call, { from: '2026-09-14', to: '2026-09-15' })).body).record;
    const before = snapshot(...WRITES);
    const r = await ask(call, { from: '2026-09-15', to: '2026-09-15' });
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'OVERLAPS', field: 'from', message: 'You already have leave booked on some of those days.' });
    expect(snapshot(...WRITES)).toEqual(before);
    LeaveMoved.parse((await cancel(call, first.id)).body);
    expect((await ask(call, { from: '2026-09-15', to: '2026-09-15' })).status).toBe(200);
  });
  /* review I2: leave in the next leave year is checked against that year and holds back that year's balance */
  test('requests in the next leave year are charged to it: each holds its days back there, and one too many is refused naming the year', async () => {
    const call = await as('employee'), was = await myLeave(call);
    expect(was.nextYear).toMatchObject({ start: '2027-04-01', end: '2028-03-31', label: '2027/28' });
    const nextLeft = was.nextYear.leftD;
    expect((await ask(call, { from: '2027-04-05', to: '2027-04-16' })).status).toBe(200);
    expect((await ask(call, { from: '2027-05-03', to: '2027-05-12' })).status).toBe(200);
    const mid = await myLeave(call);
    expect(mid.balance).toEqual(was.balance);
    expect(mid.nextYear.leftD).toBe(nextLeft - 22);
    const before = snapshot(...WRITES);
    const r = await ask(call, { from: '2027-06-07', to: '2027-06-18' });
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ code: 'OVER_BALANCE', field: 'to', message: moreThanLeft(nextLeft - 22, '2027/28') });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a request across the year end is split: this year holds back only its own days', async () => {
    const call = await as('employee'), was = await myLeave(call);
    const r = LeaveRequested.parse((await ask(call, { from: '2027-03-29', to: '2027-04-02' })).body);
    expect(r.record.qty).toBe(5);
    expect(r.hint).toBe(`${Number((was.balance.leftD - 3).toFixed(1))} days would remain. ${was.nextYear.leftD - 2} days would remain in the 2027/28 leave year.`);
    const after = await myLeave(call);
    expect([after.balance.pending - was.balance.pending, was.nextYear.leftD - after.nextYear.leftD]).toEqual([3, 2]);
  });
  test('the approver sees short notice and a start inside the change window as advice, never a block', async () => {
    const r = LeaveRequested.parse((await ask(await as('employee'), { from: '2026-08-15', to: '2026-08-15' })).body);
    const q = TeamRequests.parse((await (await as('manager'))('GET', '/api/v1/leave/team/requests')).body);
    expect(q.requests.find(x => x.id === r.record.id)?.advisories).toEqual([
      'Requested with 2 days\' notice, less than the 7 days the policy asks for.', 'This leave starts in 2 days, inside the 7-day window for changes.']);
  });
});

describe('scope and self (Review Focus 1)', () => {
  test('a manager cannot decide, read, record sickness or give days back for someone at another location', async () => {
    plant('lr_9', 'EMP-2044');
    store.coll('sickEpisodes').sk_099 = { id: 'sk_099', version: 1, updatedAt: '2026-08-13T14:30:00.000Z', employeeCode: 'EMP-2044', from: '2026-08-03', to: '2026-08-04', reason: 'Other', note: '', rtw: null };
    const call = await as('manager'), before = snapshot(...WRITES);
    for (const r of [await approve(call, 'lr_9'), await decline(call, 'lr_9', 'No'), await call('GET', '/api/v1/leave/entitlement/EMP-2044'),
      await call('POST', '/api/v1/leave/sickness', { employeeCode: 'EMP-2044', from: '2026-08-12', to: '2026-08-12', reason: 'Other' }),
      await call('POST', '/api/v1/leave/sickness/sk_099/rtw', undefined, 1),
      await call('POST', '/api/v1/leave/give-back', { employeeCode: 'EMP-2044', dates: ['2026-08-03'] })]) {
      expect(r.status).toBe(403);
      expect(refusal(r).code).toBe('scope');
    }
    const q = TeamRequests.parse((await call('GET', '/api/v1/leave/team/requests')).body);
    expect(q.requests.map(x => x.id)).not.toContain('lr_9');
    const b = TeamBalances.parse((await call('GET', '/api/v1/leave/team/balances')).body);
    expect(b.rows.map(x => x.employeeCode)).not.toContain('EMP-2044');
    const s = SicknessBoard.parse((await call('GET', '/api/v1/leave/sickness')).body);
    expect(s.rows.map(x => x.employeeCode)).not.toContain('EMP-2044');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a manager cannot approve or decline their own request, and it is not in their queue', async () => {
    const call = await as('manager');
    const mine = LeaveRequested.parse((await ask(call, { from: '2026-09-21', to: '2026-09-21' })).body).record;
    const before = snapshot(...WRITES);
    for (const r of [await approve(call, mine.id), await decline(call, mine.id, 'Busy')]) {
      expect(r.status).toBe(403);
      expect(refusal(r)).toEqual({ code: 'SELF_APPROVAL', message: SELF_APPROVAL, next: 'Ask another approver at your location.' });
    }
    expect(TeamRequests.parse((await call('GET', '/api/v1/leave/team/requests')).body).requests.map(x => x.id)).not.toContain(mine.id);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a manager whose own leave an administrator approves is told, in the Employee column (I3)', async () => {
    const admin = store.coll<{ capabilities: string[] }>('userTypes').admin;
    if (!admin) throw new Error('no admin type');
    admin.capabilities = [...admin.capabilities, 'team_leave'];
    const mine = LeaveRequested.parse((await ask(await as('manager'), { from: '2026-09-21', to: '2026-09-22' })).body).record;
    expect((await approve(await as('admin'), mine.id)).status).toBe(200);
    expect(notes('CP-1001').filter(n => n.event === 'lv_ok').map(n => n.channel)).toEqual(['In-app + email']);
  });
  test('an employee cancels only their own requests, and cannot decide or read the team', async () => {
    const call = await as('employee'), before = snapshot(...WRITES);
    const c = await cancel(call, 'lr_1');
    expect(c.status).toBe(403);
    expect(refusal(c)).toMatchObject({ code: 'NOT_YOUR_REQUEST', message: 'You can cancel only your own requests.' });
    for (const r of [await approve(call, 'lr_1'), await call('GET', '/api/v1/leave/team/requests'), await call('GET', '/api/v1/leave/entitlement/CP-1201'),
      await call('GET', '/api/v1/leave/sickness')]) {
      expect(r.status).toBe(403);
      expect(refusal(r).code).toBe('capability');
    }
    expect((await myLeave(call)).requests.every(r => r.employeeCode === 'CP-1042')).toBe(true);
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

describe('the request moves only as D1 allows (Review Focus 2)', () => {
  test('approved, declined and cancelled requests do not move again', async () => {
    const mgr = await as('manager'), emp = await as('employee'), before = snapshot(...WRITES);
    const a = await approve(mgr, 'lr_4');
    expect(a.status).toBe(409);
    expect(refusal(a)).toMatchObject({ code: 'TRANSITION_NOT_ALLOWED', message: 'This request is approved. Only a waiting request can be approved.' });
    const c = await cancel(emp, 'lr_5');
    expect(refusal(c)).toMatchObject({ code: 'TRANSITION_NOT_ALLOWED', message: 'This request is approved. Only a waiting request can be cancelled.', next: 'Ask your manager if the dates need to change.' });
    expect(snapshot(...WRITES)).toEqual(before);
    expect((await cancel(emp, 'lr_3')).status).toBe(200);
    const again = await approve(mgr, 'lr_3', 2);
    expect(refusal(again)).toMatchObject({ code: 'TRANSITION_NOT_ALLOWED', message: 'This request is cancelled. Only a waiting request can be approved.' });
  });
  test('a stale version is refused with 412 and nothing is written', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await approve(call, 'lr_1', 0);
    expect(r.status).toBe(412);
    expect(refusal(r).code).toBe('stale');
    expect((await decline(call, 'lr_1', 'No', 2)).status).toBe(412);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('declining needs a reason, and the colleague is told it', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await decline(call, 'lr_1', '   ');
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ code: 'REASON_REQUIRED', field: 'reason', message: REASON_REQUIRED });
    expect(snapshot(...WRITES)).toEqual(before);
    const d = LeaveMoved.parse((await decline(call, 'lr_1', 'Two others are already off that week')).body);
    expect(d.record).toMatchObject({ state: 'declined', reason: 'Two others are already off that week', version: 2, stateLabel: 'Declined' });
    expect(d.summary).toBe('Priya’s request declined. They have been told the reason.');
    expect(req('lr_1')?.history.at(-1)).toMatchObject({ from: 'pending', to: 'declined' });
    expect(notes('CP-1201')).toEqual([expect.objectContaining({ title: 'Leave declined', body: '24/08/2026 – 28/08/2026 · Two others are already off that week', area: 'Leave' })]);
    expect(leaveAudits()).toEqual([expect.objectContaining({ act: 'Leave declined', entityId: 'lr_1', reason: 'Two others are already off that week' })]);
  });
});

describe('derived balances move exactly once (Review Focus 3)', () => {
  test('approve moves waiting to taken, cancel gives the days back, and nothing is stored as a counter', async () => {
    const emp = await asEmail(AMARA), mgr = await as('manager'), start = (await myLeave(emp)).balance, ledger = snapshot('leaveLedger', 'leaveBases');
    const one = LeaveRequested.parse((await ask(emp, { from: '2026-09-14', to: '2026-09-15' })).body).record;
    const two = LeaveRequested.parse((await ask(emp, { from: '2026-10-05', to: '2026-10-05' })).body).record;
    LeaveDecided.parse((await approve(mgr, one.id)).body);
    let b = (await myLeave(emp)).balance;
    expect(b.takenD).toBe(start.takenD + 2);
    expect(b.pending).toBe(start.pending + 1);
    expect(b.leftD).toBe(Number((start.leftD - 3).toFixed(1)));
    LeaveMoved.parse((await cancel(emp, two.id)).body);
    b = (await myLeave(emp)).balance;
    expect(b.pending).toBe(start.pending);
    expect(b.leftD).toBe(Number((start.leftD - 2).toFixed(1)));
    expect(snapshot('leaveLedger', 'leaveBases')).toEqual(ledger);
  });
});

describe('leave reaches the rota through the week path (Review Focus 4, D7)', () => {
  test('approving writes V on every day across two weeks: an amendment on the live week, a new draft week, and cover below the minimum', async () => {
    const r0 = LeaveRequested.parse((await ask(await asEmail(ROSA), { from: '2026-08-15', to: '2026-08-18' })).body).record;
    expect(r0.impact).toBe('16 Aug drops to 3 of 4. Cover needed.');
    const before = leaveAudits().length;
    const d = LeaveDecided.parse((await approve(await as('manager'), r0.id)).body);
    expect(d.rota).toMatchObject({ written: 4, weeks: ['rw_WH_2026-08-10', 'rw_WH_2026-08-17'], amended: true });
    expect(d.rota.covers).toHaveLength(1);
    expect(d.summary).toBe(approvedToast('Rosa', true, true));
    const live = week('WH', '2026-08-10');
    expect(live?.lines['CP-1402']).toEqual(['E', 'L', 'E', '', '', 'V', 'V']);
    expect(live?.state).toBe('amendment');
    expect(live?.changes.slice(0, 2)).toEqual([
      expect.objectContaining({ employeeCode: 'CP-1402', to: 'V', afterPublish: true, why: 'Leave approved', by: expect.objectContaining({ employeeCode: 'CP-1001' }) }),
      expect.objectContaining({ employeeCode: 'CP-1402', to: 'V', afterPublish: true })]);
    expect(week('WH', '2026-08-17')).toMatchObject({ state: 'draft', version: 1, lines: { 'CP-1402': ['V', 'V', '', '', '', '', ''] } });
    const cover = store.coll<{ date: string; reason: string; open: boolean }>('coverRequests')[d.rota.covers[0] ?? ''];
    expect(cover).toMatchObject({ date: '2026-08-16', reason: 'Annual leave cover', open: true });
    expect(titles('CP-1402')).toEqual(expect.arrayContaining(['Leave approved', 'Rota amended']));
    expect(titles('CP-1001')).toContain('Coverage issue · Willow House');
    const rows = leaveAudits().slice(before);
    expect(rows).toEqual([expect.objectContaining({ act: 'Leave approved', after: expect.objectContaining({ rotaWeeks: ['rw_WH_2026-08-10', 'rw_WH_2026-08-17'], coversOpened: d.rota.covers }) })]);
    /* the rota still refuses a manual edit of the leave cell */
    const edit = await (await as('manager'))('PUT', '/api/v1/rota/weeks/WH/2026-08-10/cells', { employeeCode: 'CP-1402', day: 5, code: '' }, live?.version);
    expect(refusal(edit).code).toBe('ON_LEAVE');
  });
  test('with LV_ROTA off nothing reaches the rota', async () => {
    setFlag('LV_ROTA', false);
    const before = snapshot('rotaWeeks', 'coverRequests');
    const d = LeaveDecided.parse((await approve(await as('manager'), 'lr_1')).body);
    expect(d.rota).toEqual({ written: 0, weeks: [], amended: false, covers: [] });
    expect(snapshot('rotaWeeks', 'coverRequests')).toEqual(before);
  });
  test('on qnipay (Rota off) approval writes no rota at all', async () => {
    resetTo('qnipay');
    const before = snapshot('rotaWeeks', 'coverRequests');
    const d = LeaveDecided.parse((await approve(await asEmail(PUKAR), 'lr_1')).body);
    expect(d.record.state).toBe('approved');
    expect(d.rota.written).toBe(0);
    expect(d.summary).toBe('Bijay’s leave approved');
    expect(snapshot('rotaWeeks', 'coverRequests')).toEqual(before);
    expect(titles('EMP005')).toEqual(['Leave approved']);
  });
});

describe('the timesheet reads leave records (Review Focus 5, D8)', () => {
  const save = (call: Call, code: string, date: string, extra: Record<string, unknown> = {}) =>
    call('PUT', `/api/v1/timesheets/${code}/days/${date}`, { entries: [{ start: '07:00', finish: '15:00', breaks: [{ start: '11:00', end: '11:30' }] }], shift: 'E', ...extra }, 0);
  test('on qnipay, with no rota, approved leave and sickness show on the week', async () => {
    resetTo('qnipay');
    const w = TimesheetWeek.parse((await (await asEmail(BIGYAN))('GET', '/api/v1/timesheets/EMP004/weeks/2026-08-17')).body);
    expect(w.days.map(d => d.absence ?? '')).toEqual(['leave', 'leave', '', '', '', '', '']);
    resetTo('social');
    const s = TimesheetWeek.parse((await (await as('manager'))('GET', '/api/v1/timesheets/CP-1153/weeks/2026-07-20')).body);
    expect(s.days[2]?.absence).toBe('sickness');
  });
  test('time on an approved leave day is refused while leave blocks capture; worked anyway passes', async () => {
    const emp = await asEmail(AMARA);
    const lr = LeaveRequested.parse((await ask(emp, { from: '2026-08-11', to: '2026-08-11' })).body).record;
    LeaveDecided.parse((await approve(await as('manager'), lr.id)).body);
    const before = snapshot('timesheetDays', 'audit');
    const r = await save(emp, 'CP-1042', '2026-08-11');
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'ABSENCE_BLOCKED', field: 'date',
      message: 'Annual leave is recorded for this day. Approved absence blocks timesheet capture while “Leave blocks timesheet capture” is on.' });
    const sub = await emp('POST', '/api/v1/timesheets/CP-1042/days/2026-08-11/submit', { entries: [{ start: '07:00', finish: '15:00', breaks: [] }], shift: 'E' }, 0);
    expect(refusal(sub).code).toBe('ABSENCE_BLOCKED');
    expect(snapshot('timesheetDays', 'audit')).toEqual(before);
    expect((await save(emp, 'CP-1042', '2026-08-11', { workedAnyway: true })).status).toBe(200);
  });
  /* review I1: a draft stored before the absence was recorded is checked again when it is sent */
  const sick = (call: Call, code: string, from: string, to = from) => call('POST', '/api/v1/leave/sickness', { employeeCode: code, from, to, reason: 'Cold or flu' });
  const asRead = async (call: Call, code: string, ws: string) =>
    TimesheetWeek.parse((await call('GET', `/api/v1/timesheets/${code}/weeks/${ws}`)).body).days.map(d => ({ date: d.date, version: d.version }));
  const tsDay = (code: string, date: string) => store.coll<{ state: string; workedAnyway?: boolean }>('timesheetDays')[`tsd_${code}_${date}`];
  const submitWeek = async (call: Call, code: string, ws: string) => call('POST', `/api/v1/timesheets/${code}/weeks/${ws}/submit`, { days: await asRead(call, code, ws) });
  test('a draft saved before sickness was recorded is held back when the week is submitted unchanged; the rest of the week goes', async () => {
    const emp = await asEmail(AMARA);
    expect((await save(emp, 'CP-1042', '2026-08-10')).status).toBe(200);
    expect((await save(emp, 'CP-1042', '2026-08-11')).status).toBe(200);
    expect((await sick(await as('manager'), 'CP-1042', '2026-08-11')).status).toBe(200);
    const r = await submitWeek(emp, 'CP-1042', '2026-08-10');
    expect(r.status).toBe(200);
    const out = WeekSubmitted.parse(r.body);
    expect(out.submitted.map(d => d.date)).toEqual(['2026-08-10']);
    expect(out.held).toContainEqual({ date: '2026-08-11', reason: absenceHeldReason('2026-08-11', 'S') });
    expect(tsDay('CP-1042', '2026-08-11')?.state).toBe('draft');
  });
  test('when the only day to send falls on approved leave, the week is refused with ABSENCE_BLOCKED and nothing is written', async () => {
    const emp = await asEmail(AMARA);
    expect((await save(emp, 'CP-1042', '2026-08-11')).status).toBe(200);
    const lr = LeaveRequested.parse((await ask(emp, { from: '2026-08-11', to: '2026-08-11' })).body).record;
    LeaveDecided.parse((await approve(await as('manager'), lr.id)).body);
    const before = snapshot('timesheetDays', 'audit');
    const r = await submitWeek(emp, 'CP-1042', '2026-08-10');
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'ABSENCE_BLOCKED', field: 'days.1' });
    expect(refusal(r).message).toMatch(/^Annual leave is recorded for this day\./);
    expect(snapshot('timesheetDays', 'audit')).toEqual(before);
  });
  test('a day saved as called in and worked anyway keeps the mark, and the week submits it as stored', async () => {
    const emp = await asEmail(AMARA);
    expect((await sick(await as('manager'), 'CP-1042', '2026-08-11')).status).toBe(200);
    expect((await save(emp, 'CP-1042', '2026-08-11', { workedAnyway: true })).status).toBe(200);
    expect(tsDay('CP-1042', '2026-08-11')?.workedAnyway).toBe(true);
    const out = WeekSubmitted.parse((await submitWeek(emp, 'CP-1042', '2026-08-10')).body);
    expect(out.submitted.map(d => [d.date, d.state, d.workedAnyway])).toEqual([['2026-08-11', 'pend', true]]);
  });
  test('multi-week catch-up holds back a week whose stored time falls on sickness; the other week still goes', async () => {
    resetTo('qnipay');
    const ts = store.coll<{ rules: { enforceLock: boolean } }>('timesheetConfig').timesheetConfig;
    if (ts) ts.rules.enforceLock = false;
    expect((await sick(await asEmail(PUKAR), 'EMP004', '2026-08-05')).status).toBe(200);
    const held = snapshot('timesheetDays');
    const out = MultiweekSubmitted.parse((await (await asEmail(BIGYAN))('POST', '/api/v1/timesheets/EMP004/multiweek/submit', { weeks: ['2026-07-27', '2026-08-03'] })).body);
    expect(out.weeks.map(w => [w.weekStart, w.outcome, w.submitted.length])).toEqual([['2026-08-03', 'held', 0], ['2026-07-27', 'submitted', 4]]);
    expect(out.weeks[0]?.reason).toBe(absenceHeldReason('2026-08-05', 'S'));
    const weekOf3Aug = (s: Record<string, unknown>) => Object.entries((s.timesheetDays ?? {}) as Record<string, unknown>)
      .filter(([id]) => id.slice(-10) >= '2026-08-03' && id.slice(-10) <= '2026-08-09');
    expect(weekOf3Aug(snapshot('timesheetDays'))).toEqual(weekOf3Aug(held));
  });
  test('with blocksTimesheet off the absence still shows and time is accepted', async () => {
    const cfg = store.coll<{ blocksTimesheet: boolean }>('leaveConfig').leaveConfig;
    if (cfg) cfg.blocksTimesheet = false;
    store.coll<{ from: string; to: string }>('leaveRequests').lr_5 = { ...store.coll<Record<string, unknown>>('leaveRequests').lr_5, from: '2026-08-11', to: '2026-08-11' } as never;
    const emp = await asEmail(AMARA);
    const w = TimesheetWeek.parse((await emp('GET', '/api/v1/timesheets/CP-1042/weeks/2026-08-10')).body);
    expect(w.days[1]?.absence).toBe('leave');
    expect((await save(emp, 'CP-1042', '2026-08-11')).status).toBe(200);
  });
});

describe('sickness episodes, Bradford and return to work (Review Focus 6, D9)', () => {
  /* review I3: a range that bridges two episodes merges them, with both before-states on the one audit row */
  test('a day between two episodes joins them into the earliest: the later one goes, Bradford counts one spell', async () => {
    store.coll('sickEpisodes').sk_099 = { id: 'sk_099', version: 1, updatedAt: '2026-08-13T09:00:00.000Z', employeeCode: 'CP-1088', from: '2026-08-13', to: '2026-08-13',
      reason: 'Other', note: 'Later note', rtw: { requestedAt: '2026-08-13T10:00:00.000Z', by: { employeeCode: 'CP-1001', name: 'Rachel Hussain' } } };
    const call = await as('manager');
    const r = SicknessRecorded.parse((await call('POST', '/api/v1/leave/sickness', { employeeCode: 'CP-1088', from: '2026-08-12', to: '2026-08-12', reason: 'Other' })).body);
    expect(r).toMatchObject({ extended: true, record: { id: 'sk_004', from: '2026-08-11', to: '2026-08-13', reason: 'Mental health', rtw: null } });
    expect(store.coll('sickEpisodes').sk_099).toBeUndefined();
    expect(leaveAudits()).toEqual([expect.objectContaining({ act: 'Sickness recorded', entityId: 'sk_004',
      before: { from: '2026-08-11', to: '2026-08-11', merged: [{ id: 'sk_099', from: '2026-08-13', to: '2026-08-13' }] } })]);
    const b = SicknessBoard.parse((await call('GET', '/api/v1/leave/sickness')).body);
    expect(b.rows.find(x => x.employeeCode === 'CP-1088')).toMatchObject({ spells: 4, days: 9, score: 144 });
  });
  test('the board scores spells squared times days over 52 weeks and raises the trigger', async () => {
    const b = SicknessBoard.parse((await (await as('manager'))('GET', '/api/v1/leave/sickness')).body);
    expect(b.rows.find(r => r.employeeCode === 'CP-1088')).toMatchObject({ spells: 4, days: 7, score: 112, triggered: true, next: 'Return-to-work meeting due', latest: '11/08/2026 · 1 day' });
    expect(b.rows.find(r => r.employeeCode === 'CP-1266')).toMatchObject({ spells: 1, days: 12, score: 12, triggered: false });
    expect(b.banner).toMatchObject({ employeeCode: 'CP-1088', text: triggerBannerText('Marcus Reilly', 112, 100) });
    expect(b.sickOnLeave).toEqual([{ employeeCode: 'CP-1088', name: 'Marcus Reilly', requestId: 'lr_4', date: '2026-08-11', days: 1 }]);
  });
  test('a day next to an episode extends it, S goes on the rota, and the score moves', async () => {
    const call = await as('manager');
    const r = SicknessRecorded.parse((await call('POST', '/api/v1/leave/sickness', { employeeCode: 'CP-1088', from: '2026-08-12', to: '2026-08-12', reason: 'Mental health' })).body);
    expect(r).toMatchObject({ extended: true, record: { id: 'sk_004', from: '2026-08-11', to: '2026-08-12', version: 2 }, rota: { written: 1, weeks: ['rw_WH_2026-08-10'] } });
    expect(week('WH', '2026-08-10')?.lines['CP-1088']).toEqual(['V', 'V', 'S', 'L', '', 'E', '']);
    expect(week('WH', '2026-08-10')?.state).toBe('amendment');
    expect(titles('CP-1088')).toEqual(expect.arrayContaining(['Sickness recorded', 'Rota amended']));
    expect(leaveAudits()).toEqual([expect.objectContaining({ act: 'Sickness recorded', entityId: 'sk_004', before: { from: '2026-08-11', to: '2026-08-11' } })]);
    const b = SicknessBoard.parse((await call('GET', '/api/v1/leave/sickness')).body);
    expect(b.rows.find(x => x.employeeCode === 'CP-1088')).toMatchObject({ spells: 4, days: 8, score: 128 });
    const n = SicknessRecorded.parse((await call('POST', '/api/v1/leave/sickness', { employeeCode: 'CP-1153', from: '2026-08-12', to: '2026-08-12', reason: 'Other' })).body);
    expect(n).toMatchObject({ extended: false, record: { id: 'sk_007', employeeCode: 'CP-1153' } });
    expect(SicknessBoard.parse((await call('GET', '/api/v1/leave/sickness')).body).rows.find(x => x.employeeCode === 'CP-1153')).toMatchObject({ spells: 2, days: 2, score: 8 });
  });
  test('a day already inside an episode, and a reason not on the list, are refused', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const a = await call('POST', '/api/v1/leave/sickness', { employeeCode: 'CP-1266', from: '2026-06-03', to: '2026-06-05', reason: 'Other' });
    expect(a.status).toBe(409);
    expect(refusal(a).code).toBe('ALREADY_RECORDED');
    const b = await call('POST', '/api/v1/leave/sickness', { employeeCode: 'CP-1266', from: '2026-08-12', to: '', reason: 'Hangover' });
    expect(refusal(b)).toMatchObject({ code: 'invalid', field: 'reason', message: 'Choose the reason given.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('configured sickness reasons are returned by the board and enforced on writes', async () => {
    const admin = await as('admin'), manager = await as('manager');
    const config = LeaveSetup.parse((await admin('GET', '/api/v1/leave/config')).body).config;
    /* no sickness is recorded yet, so every reason can go (review M1) */
    store.db.sickEpisodes = {};
    expect((await admin('PATCH', '/api/v1/leave/config', { sicknessReasons: ['New reason'] }, config.version)).status).toBe(200);
    expect(SicknessBoard.parse((await manager('GET', '/api/v1/leave/sickness')).body).reasons).toEqual(['New reason']);
    const saved = await manager('POST', '/api/v1/leave/sickness', { employeeCode: 'CP-1088', from: '2026-10-05', to: '2026-10-05', reason: 'New reason' });
    expect(SicknessRecorded.parse(saved.body).record.reason).toBe('New reason');
    const refused = await manager('POST', '/api/v1/leave/sickness', { employeeCode: 'CP-1088', from: '2026-10-07', to: '2026-10-07', reason: 'Other' });
    expect(refusal(refused)).toMatchObject({ code: 'invalid', field: 'reason', message: 'Choose the reason given.' });
  });
  test('arranging a return to work is stored on the episode, notified and audited once; a second request is refused', async () => {
    const call = await as('manager');
    const r = RtwArranged.parse((await call('POST', '/api/v1/leave/sickness/sk_004/rtw', undefined, 1)).body);
    expect(r.record.rtw).toMatchObject({ by: { employeeCode: 'CP-1001', name: 'Rachel Hussain' } });
    expect(r.summary).toBe('Return-to-work meeting requested. The colleague and HR have been notified.');
    expect(titles('CP-1088')).toEqual(['Return-to-work meeting requested']);
    expect(notes('CP-1002')).toEqual([expect.objectContaining({ title: 'Return-to-work meeting requested', body: 'Requested by Rachel Hussain · Willow House' })]);
    expect(leaveAudits()).toEqual([expect.objectContaining({ act: 'Return-to-work meeting requested', entityId: 'sk_004' })]);
    const again = await call('POST', '/api/v1/leave/sickness/sk_004/rtw', undefined, 2);
    expect(again.status).toBe(409);
    expect(refusal(again)).toMatchObject({ code: 'ALREADY_REQUESTED', message: RTW_ALREADY });
  });
});

describe('giving days back (D10, Review Focus 3)', () => {
  test('the picked days go back once as one ledger row, the balance moves by exactly that, and the rota shows sickness', async () => {
    const call = await as('manager');
    const ent = async () => EntitlementDetail.parse((await call('GET', '/api/v1/leave/entitlement/CP-1088')).body).balance;
    const before = await ent();
    const r = DaysGivenBack.parse((await call('POST', '/api/v1/leave/give-back', { employeeCode: 'CP-1088', dates: ['2026-08-11'] })).body);
    expect(r.record).toMatchObject({ type: 'Days returned', qty: 1, unit: 'days', counts: true, dates: ['2026-08-11'], qtyText: '+1 days' });
    expect(store.coll<{ leaveType?: string }>('leaveLedger')[r.record.id]?.leaveType).toBe('AL');
    expect(r.summary).toBe('1 day returned to Marcus Reilly’s annual leave balance');
    const after = await ent();
    expect(after.leftD).toBe(Number((before.leftD + 1).toFixed(1)));
    expect(after.takenD).toBe(Number((before.takenD - 1).toFixed(2)));
    expect(week('WH', '2026-08-10')?.lines['CP-1088']?.slice(0, 2)).toEqual(['V', 'S']);
    expect(titles('CP-1088')).toEqual(expect.arrayContaining(['Entitlement changed']));
    expect(leaveAudits().map(a => a.act)).toEqual(['Days returned']);
    const twice = await call('POST', '/api/v1/leave/give-back', { employeeCode: 'CP-1088', dates: ['2026-08-11'] });
    expect(twice.status).toBe(422);
    expect(refusal(twice).code).toBe('NOT_SICK_ON_LEAVE');
    expect((await ent()).leftD).toBe(after.leftD);
  });
  test('a day that is not sickness during approved leave is refused', async () => {
    const r = await (await as('manager'))('POST', '/api/v1/leave/give-back', { employeeCode: 'CP-1088', dates: ['2026-08-10'] });
    expect(refusal(r)).toMatchObject({ code: 'NOT_SICK_ON_LEAVE', field: 'dates' });
  });
});

describe('team reads', () => {
  test('the queue holds the location\'s waiting requests with SLA, stage and balance, and filters', async () => {
    const call = await as('manager');
    const q = TeamRequests.parse((await call('GET', '/api/v1/leave/team/requests')).body);
    expect(q.requests.map(r => r.id)).toEqual(['lr_1', 'lr_2', 'lr_3']);
    expect(q.requests[0]).toMatchObject({ name: 'Priya Shah', sla: { escalated: true, text: 'Escalated · Service Manager' }, stage: { n: 3, text: 'Stage 3 of 4 · Service Manager' } });
    expect(q.breached).toBe('1 request has breached the 5-day approval SLA');
    const f = async (qs: string) => TeamRequests.parse((await call('GET', `/api/v1/leave/team/requests?${qs}`)).body).requests.map(r => r.id);
    expect(await f('short=true')).toEqual(['lr_1']);
    expect(await f('type=TOIL')).toEqual(['lr_2']);
    expect(await f('q=priya')).toEqual(['lr_1']);
  });
  test('leaver reconciliation states days and the direction, never money; it is refused with LV_LEAVER off', async () => {
    resetTo('qnipay');
    const call = await asEmail(PUKAR);
    const l = Leavers.parse((await call('GET', '/api/v1/leave/leavers')).body);
    expect(l.rows.map(r => r.employeeCode)).toEqual(['EMP008']);
    expect(l.rows[0]?.action).toMatch(/^(Recover|Pay) [\d.]+ days \([\d.]+ h\)( in lieu)? through the final payroll$|^No adjustment required$/);
    expect(l.settled).toBe('Workforce identifies the amount and the direction. The monetary settlement is made in payroll.');
    setFlag('LV_LEAVER', false);
    expect(refusal(await call('GET', '/api/v1/leave/leavers')).code).toBe('feature-off');
  });
  test('an employee reads their own entitlement; with the Leave module off everything is refused', async () => {
    const call = await as('employee');
    const e = EntitlementDetail.parse((await call('GET', '/api/v1/leave/entitlement/CP-1042')).body);
    expect(e.entitlement.lines.map(l => l.label)).toContain('Pro-rata factor');
    setModule('L', false);
    const r = await call('GET', '/api/v1/leave/me');
    expect(r.status).toBe(403);
    expect(refusal(r).code).toBe('module-off');
  });
});

describe('leave setup (D11)', () => {
  test('an unchanged policy array is a no-op with a null audit id', async () => {
    const admin = await as('admin'), config = LeaveSetup.parse((await admin('GET', '/api/v1/leave/config')).body).config;
    const result = await admin('PATCH', '/api/v1/leave/config', { policies: config.policies }, config.version);
    expect(result.body).toMatchObject({ record: { version: config.version }, auditId: null });
    expect(leaveAudits()).toEqual([]);
  });
  test('a save is versioned, merges the per-type policy and writes one audit row with before and after', async () => {
    const admin = await as('admin');
    const s = LeaveSetup.parse((await admin('GET', '/api/v1/leave/config')).body);
    expect(s.flags).toMatchObject({ LV_ROTA: true, LV_ENT: true });
    const r = await admin('PATCH', '/api/v1/leave/config', { blocksTimesheet: false, typeLeave: { casual: { policy: 'STD', unit: 'days' } } }, s.config.version);
    expect(r.status).toBe(200);
    const saved = store.coll<{ version: number; blocksTimesheet: boolean; typeLeave: Record<string, unknown> }>('leaveConfig').leaveConfig;
    expect(saved).toMatchObject({ version: 2, blocksTimesheet: false });
    expect(Object.keys(saved?.typeLeave ?? {})).toEqual(['shift', 'casual', 'salaried']);
    expect(leaveAudits()).toEqual([expect.objectContaining({ act: 'Leave setup saved', before: { blocksTimesheet: true, typeLeave: { casual: { policy: 'ACC', unit: 'hours' } } },
      after: { blocksTimesheet: false, typeLeave: { casual: { policy: 'STD', unit: 'days' } } } })]);
    expect((await admin('PATCH', '/api/v1/leave/config', { slaDays: 3 }, 1)).status).toBe(412);
  });
  test('an out-of-range value is refused naming the field; a manager cannot save', async () => {
    const admin = await as('admin'), manager = await as('manager'), before = snapshot(...WRITES);
    const r = await admin('PATCH', '/api/v1/leave/config', { slaDays: 0 }, 1);
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ code: 'invalid', field: 'slaDays', message: 'The approval SLA is a whole number of days from 1 to 60.' });
    expect(refusal(await manager('PATCH', '/api/v1/leave/config', { slaDays: 3 }, 1)).code).toBe('capability');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a policy in use and a leave type with request history cannot be removed', async () => {
    const admin = await as('admin');
    const config = LeaveSetup.parse((await admin('GET', '/api/v1/leave/config')).body).config;
    const policyRefusal = await admin('PATCH', '/api/v1/leave/config', { policies: config.policies.filter(p => p.code !== 'STD') }, config.version);
    expect(policyRefusal.status).toBe(409);
    expect(refusal(policyRefusal)).toMatchObject({ code: 'in-use', usedBy: [expect.objectContaining({ kind: 'leave types', examples: expect.arrayContaining([expect.stringContaining('AL')]) }),
      expect.objectContaining({ kind: 'employee types', examples: expect.arrayContaining(['Support Worker (shift)']) })] });
    const typeRefusal = await admin('PATCH', '/api/v1/leave/config', { types: config.types.filter(t => t.code !== 'AL') }, config.version);
    expect(typeRefusal.status).toBe(409);
    expect(refusal(typeRefusal)).toMatchObject({ code: 'in-use', usedBy: [expect.objectContaining({ kind: 'leave requests', examples: expect.arrayContaining([expect.stringContaining('(')]) })] });
    /* M6: a policy used only by an employee type's leave policy names it */
    const acc = await admin('PATCH', '/api/v1/leave/config', { policies: config.policies.filter(p => p.code !== 'ACC') }, config.version);
    expect(acc.status).toBe(409);
    expect(refusal(acc)).toMatchObject({ code: 'in-use', field: 'policies.1',
      usedBy: [{ kind: 'employee types', count: 1, examples: [expect.stringContaining('(casual)')] }] });
  });
  test('a type is known by its code: removing an unused type and adding a new one in one save is allowed (M6)', async () => {
    const admin = await as('admin'), n = leaveAudits().length;
    const config = LeaveSetup.parse((await admin('GET', '/api/v1/leave/config')).body).config;
    const jury = config.types.findIndex(t => t.code === 'JURY');
    const added = { code: 'STUDY', name: 'Study leave', icon: '•', short: 'Study', policy: 'FIX', paid: true, evidence: false, unit: 'days' as const, active: true };
    const types = [...config.types.filter(t => t.code !== 'JURY'), added];
    const r = await admin('PATCH', '/api/v1/leave/config', { types }, config.version);
    expect(r.status).toBe(200);
    expect(jury).toBeGreaterThan(-1);
    expect(store.coll<{ types: { code: string }[] }>('leaveConfig').leaveConfig?.types.map(t => t.code)).toEqual([...config.types.map(t => t.code).filter(c => c !== 'JURY'), 'STUDY']);
    expect(leaveAudits().slice(n).map(a => a.act)).toEqual(['Leave setup saved']);
    /* a code that is not a code is refused, naming the field */
    const bad = await admin('PATCH', '/api/v1/leave/config', { types: [...types, { ...added, code: 'not ok' }] }, config.version + 1);
    expect(refusal(bad)).toMatchObject({ code: 'invalid', field: `types.${types.length}.code` });
  });
  test('a sickness reason that recorded sickness uses cannot be removed, and the refusal names who (review M1)', async () => {
    const admin = await as('admin'), before = snapshot(...WRITES);
    const config = LeaveSetup.parse((await admin('GET', '/api/v1/leave/config')).body).config;
    const r = await admin('PATCH', '/api/v1/leave/config', { sicknessReasons: config.sicknessReasons.filter(x => x !== 'Cold or flu') }, config.version);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'in-use', field: 'sicknessReasons.0', message: 'Cold or flu is still the reason on recorded sickness.',
      usedBy: [{ kind: 'sickness records', count: 2, examples: expect.arrayContaining([expect.stringContaining('(')]) }] });
    expect(snapshot(...WRITES)).toEqual(before);
    /* a reason nobody has been off with goes again */
    expect((await admin('PATCH', '/api/v1/leave/config', { sicknessReasons: [...config.sicknessReasons, 'Injury at work'] }, config.version)).status).toBe(200);
    expect((await admin('PATCH', '/api/v1/leave/config', { sicknessReasons: config.sicknessReasons }, config.version + 1)).status).toBe(200);
  });
  test('a leave type used by a ledger row is also protected from removal', async () => {
    const admin = await as('admin');
    const requests = store.coll<{ id: string; type: string }>('leaveRequests');
    store.db.leaveRequests = Object.fromEntries(Object.entries(requests).filter(([, record]) => record.type !== 'AL'));
    store.coll<Record<string, unknown>>('leaveLedger').led_type = {
      id: 'led_type', version: 1, updatedAt: '2026-08-13T14:30:00.000Z', employeeCode: 'CP-1042',
      date: '2026-08-13', type: 'Days returned', leaveType: 'AL', qty: 1, unit: 'days', why: 'Test', counts: true, by: null,
    };
    const config = LeaveSetup.parse((await admin('GET', '/api/v1/leave/config')).body).config;
    const result = await admin('PATCH', '/api/v1/leave/config', { types: config.types.filter(t => t.code !== 'AL') }, config.version);
    expect(refusal(result)).toMatchObject({ code: 'in-use', usedBy: [expect.objectContaining({ kind: 'leave ledger', examples: expect.arrayContaining([expect.stringContaining('Amara Okafor')]) })] });
  });
  test('the policy approval setting auto-approves requests when approval is not required with one audit row', async () => {
    const admin = await as('admin'), employee = await as('employee');
    const config = LeaveSetup.parse((await admin('GET', '/api/v1/leave/config')).body).config;
    const policies = config.policies.map(p => p.code === 'STD' ? { ...p, approval: false } : p);
    await admin('PATCH', '/api/v1/leave/config', { policies }, config.version);
    const before = leaveAudits().filter(a => a.act === 'Leave approved automatically').length;
    const result = LeaveRequested.parse((await ask(employee, { from: '2026-11-09', to: '2026-11-09' })).body);
    expect(result.record).toMatchObject({ state: 'approved', decidedBy: { name: 'Leave policy' }, history: [{ to: 'approved', reason: 'Approval is not required by this policy.' }] });
    expect(result.summary).toBe('Annual leave approved automatically · 1 day · 7.50 hours');
    expect(leaveAudits().filter(a => a.act === 'Leave approved automatically')).toHaveLength(before + 1);
  });
  test('a policy\'s own SLA times its requests; a policy with none uses the tenant default', async () => {
    const admin = await as('admin'), manager = await as('manager');
    const left = async () => Object.fromEntries(TeamRequests.parse((await manager('GET', '/api/v1/leave/team/requests')).body).requests.map(r => [r.id, r.sla.daysLeft]));
    /* 13/08: lr_2 (TOIL) raised 11/08 and lr_3 (annual leave, STD) raised 12/08; the seeded policies have no SLA, so the tenant's 5 days time both */
    expect(await left()).toMatchObject({ lr_2: 3, lr_3: 4 });
    const config = LeaveSetup.parse((await admin('GET', '/api/v1/leave/config')).body).config;
    const policies = config.policies.map(p => p.code === 'STD' ? { ...p, sla: 7 } : p);
    expect((await admin('PATCH', '/api/v1/leave/config', { policies, slaDays: 9 }, config.version)).status).toBe(200);
    expect(await left()).toMatchObject({ lr_2: 7, lr_3: 6 });
  });
  test('with bank holidays not paid on top, a bank holiday the published rota has someone working comes out of their entitlement, and the trace says so', async () => {
    const admin = await as('admin'), employee = await as('employee');
    const before = await myLeave(employee);
    const line = week('WH', '2026-08-10')?.lines['CP-1042'] ?? [];
    const worked = line.findIndex(c => c !== '' && c !== 'V' && c !== 'S');
    expect(worked).toBeGreaterThan(-1);
    const tenant = store.coll<{ bankHolidays: { date: string; name: string }[] }>('tenant').tenant;
    tenant?.bankHolidays.push({ date: `2026-08-${String(10 + worked).padStart(2, '0')}`, name: 'Test holiday' });
    const config = LeaveSetup.parse((await admin('GET', '/api/v1/leave/config')).body).config;
    expect((await admin('PATCH', '/api/v1/leave/config', { bhPaid: false }, config.version)).status).toBe(200);
    const after = await myLeave(employee);
    expect(after.entitlement.days).toBe(before.entitlement.days - 1);
    expect(after.entitlement.lines).toContainEqual({ label: 'Bank holidays', value: '1 working bank holiday day(s) deducted' });
    expect(before.entitlement.lines).toContainEqual({ label: 'Bank holidays', value: 'On top of entitlement' });
  });
  test('seeded sickness still waits for a manager, and approval off never approves a type that needs evidence (review I3)', async () => {
    const admin = await as('admin'), employee = await as('employee');
    const sick = LeaveRequested.parse((await ask(employee, { type: 'SICK', from: '2026-11-09', to: '2026-11-09' })).body);
    expect(sick.record.state).toBe('pending');
    const config = LeaveSetup.parse((await admin('GET', '/api/v1/leave/config')).body).config;
    const policies = config.policies.map(p => p.code === 'SICK' ? { ...p, approval: false } : p);
    expect((await admin('PATCH', '/api/v1/leave/config', { policies }, config.version)).status).toBe(200);
    const again = LeaveRequested.parse((await ask(employee, { type: 'SICK', from: '2026-11-16', to: '2026-11-16' })).body);
    expect(again.record).toMatchObject({ state: 'pending', decidedBy: null });
    expect(leaveAudits().filter(a => a.act === 'Leave approved automatically')).toEqual([]);
  });
});

describe('a fault on each write leaves nothing behind (Review Focus 7)', () => {
  const writes: [string, Persona, string, string, unknown, number | undefined][] = [
    ['request', 'employee', 'POST', '/api/v1/leave/requests', { type: 'AL', from: '2026-09-14', to: '2026-09-15', part: 'full' }, undefined],
    ['cancel', 'employee', 'POST', '/api/v1/leave/requests/lr_3/cancel', undefined, 1],
    ['approve', 'manager', 'POST', '/api/v1/leave/requests/lr_1/approve', undefined, 1],
    ['decline', 'manager', 'POST', '/api/v1/leave/requests/lr_2/decline', { reason: 'Short-staffed' }, 1],
    ['record sickness', 'manager', 'POST', '/api/v1/leave/sickness', { employeeCode: 'CP-1088', from: '2026-08-12', to: '2026-08-12', reason: 'Other' }, undefined],
    ['return to work', 'manager', 'POST', '/api/v1/leave/sickness/sk_004/rtw', undefined, 1],
    ['give days back', 'manager', 'POST', '/api/v1/leave/give-back', { employeeCode: 'CP-1088', dates: ['2026-08-11'] }, undefined],
    ['leave setup', 'admin', 'PATCH', '/api/v1/leave/config', { slaDays: 3 }, 1],
  ];
  for (const [what, who, method, path, body, v] of writes) {
    test(what, async () => {
      const call = await as(who), before = snapshot(...WRITES);
      await fault(method, path);
      const r = await call(method, path, body, v);
      expect(r.status).toBe(500);
      expect(refusal(r).code).toBe('fault');
      expect(snapshot(...WRITES)).toEqual(before);
    });
  }
  test('a throw after the request, the rota weeks, the cover and the notices are written rolls every one back', async () => {
    const r0 = LeaveRequested.parse((await ask(await asEmail(ROSA), { from: '2026-08-15', to: '2026-08-18' })).body).record;
    const call = await as('manager'), before = snapshot(...WRITES);
    store.db.audit = Object.freeze({ ...store.db.audit });
    const r = await approve(call, r0.id);
    expect(r.status).toBe(500);
    expect(snapshot(...WRITES)).toEqual(before);
    expect(req(r0.id)?.state).toBe('pending');
  });
});
