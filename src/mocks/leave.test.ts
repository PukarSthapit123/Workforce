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
interface Week { id: string; version: number; state: string; lines: Record<string, string[]>; changes: { afterPublish: boolean; to: string; personCode: string; why: string; by: { personCode: string } }[] }
const week = (loc: string, ws: string) => store.coll<Week>('rotaWeeks')[`rw_${loc}_${ws}`];
interface Note { personId: string; title: string; body: string; area: string }
const notes = (personId?: string) => Object.values(store.coll<Note>('notifications')).filter(n => !personId || n.personId === personId);
const titles = (personId: string) => notes(personId).map(n => n.title);
/* the module's own rows: signing in writes one too */
const leaveAudits = () => audits().filter(a => a.act !== 'Signed in');
interface Req { id: string; version: number; state: string; personCode: string; reason: string; history: { from: string; to: string }[]; decidedBy: { personCode: string } | null }
const req = (id: string) => store.coll<Req>('leaveRequests')[id];
const setFlag = (k: string, on: boolean) => { const t = store.coll<{ flags: Record<string, boolean> }>('tenant').tenant; if (t) t.flags[k] = on; };
const setModule = (k: string, on: boolean) => { const t = store.coll<{ modules: Record<string, boolean> }>('tenant').tenant; if (t) t.modules[k] = on; };
/* A waiting request planted straight into the store, for scope checks. */
function plant(id: string, personCode: string, from = '2026-09-07', to = '2026-09-08') {
  const lr1 = store.coll<Record<string, unknown>>('leaveRequests').lr_1;
  store.coll('leaveRequests')[id] = { ...lr1, id, personCode, from, to, qty: 2, history: [] };
}
const AMARA = 'amara.okafor@brightpath.org', ROSA = 'rosa.mendes@brightpath.org', BIGYAN = 'bigyan.poudel@dogmagroup.co.uk', PUKAR = 'pukar.sthapit@dogmagroup.co.uk';
const ask = (call: Call, body: Record<string, unknown>) => call('POST', '/api/v1/leave/requests', { type: 'AL', part: 'full', ...body });
const approve = (call: Call, id: string, v = 1) => call('POST', `/api/v1/leave/requests/${id}/approve`, undefined, v);
const decline = (call: Call, id: string, reason: string, v = 1) => call('POST', `/api/v1/leave/requests/${id}/decline`, { reason }, v);
const cancel = (call: Call, id: string, v = 1) => call('POST', `/api/v1/leave/requests/${id}/cancel`, undefined, v);
const myLeave = async (call: Call) => MyLeave.parse((await call('GET', '/api/v1/leave/me')).body);

describe('requesting leave (Review Focus 2)', () => {
  test('an employee asks for leave: a waiting record, the balance holds it back, the manager and the employee are told, one audit row', async () => {
    const call = await as('employee'), before = await myLeave(call);
    const r = LeaveRequested.parse((await ask(call, { from: '2026-09-14', to: '2026-09-15', note: 'Wedding' })).body);
    expect(r.record).toMatchObject({ id: 'lr_6', personCode: 'CP-1042', state: 'pending', qty: 2, unit: 'days', note: 'Wedding', stateLabel: 'Waiting', range: '14/09/2026 – 15/09/2026' });
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
    store.coll('sickEpisodes').sk_099 = { id: 'sk_099', version: 1, updatedAt: '2026-08-13T14:30:00.000Z', personCode: 'EMP-2044', from: '2026-08-03', to: '2026-08-04', reason: 'Other', note: '', rtw: null };
    const call = await as('manager'), before = snapshot(...WRITES);
    for (const r of [await approve(call, 'lr_9'), await decline(call, 'lr_9', 'No'), await call('GET', '/api/v1/leave/entitlement/EMP-2044'),
      await call('POST', '/api/v1/leave/sickness', { personCode: 'EMP-2044', from: '2026-08-12', to: '2026-08-12', reason: 'Other' }),
      await call('POST', '/api/v1/leave/sickness/sk_099/rtw', undefined, 1),
      await call('POST', '/api/v1/leave/give-back', { personCode: 'EMP-2044', dates: ['2026-08-03'] })]) {
      expect(r.status).toBe(403);
      expect(refusal(r).code).toBe('scope');
    }
    const q = TeamRequests.parse((await call('GET', '/api/v1/leave/team/requests')).body);
    expect(q.requests.map(x => x.id)).not.toContain('lr_9');
    const b = TeamBalances.parse((await call('GET', '/api/v1/leave/team/balances')).body);
    expect(b.rows.map(x => x.personCode)).not.toContain('EMP-2044');
    const s = SicknessBoard.parse((await call('GET', '/api/v1/leave/sickness')).body);
    expect(s.rows.map(x => x.personCode)).not.toContain('EMP-2044');
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
    expect((await myLeave(call)).requests.every(r => r.personCode === 'CP-1042')).toBe(true);
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
      expect.objectContaining({ personCode: 'CP-1402', to: 'V', afterPublish: true, why: 'Leave approved', by: expect.objectContaining({ personCode: 'CP-1001' }) }),
      expect.objectContaining({ personCode: 'CP-1402', to: 'V', afterPublish: true })]);
    expect(week('WH', '2026-08-17')).toMatchObject({ state: 'draft', version: 1, lines: { 'CP-1402': ['V', 'V', '', '', '', '', ''] } });
    const cover = store.coll<{ date: string; reason: string; open: boolean }>('coverRequests')[d.rota.covers[0] ?? ''];
    expect(cover).toMatchObject({ date: '2026-08-16', reason: 'Annual leave cover', open: true });
    expect(titles('CP-1402')).toEqual(expect.arrayContaining(['Leave approved', 'Rota amended']));
    expect(titles('CP-1001')).toContain('Coverage issue · Willow House');
    const rows = leaveAudits().slice(before);
    expect(rows).toEqual([expect.objectContaining({ act: 'Leave approved', after: expect.objectContaining({ rotaWeeks: ['rw_WH_2026-08-10', 'rw_WH_2026-08-17'], coversOpened: d.rota.covers }) })]);
    /* the rota still refuses a manual edit of the leave cell */
    const edit = await (await as('manager'))('PUT', '/api/v1/rota/weeks/WH/2026-08-10/cells', { personCode: 'CP-1402', day: 5, code: '' }, live?.version);
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
  const sick = (call: Call, code: string, from: string, to = from) => call('POST', '/api/v1/leave/sickness', { personCode: code, from, to, reason: 'Cold or flu' });
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
  test('the board scores spells squared times days over 52 weeks and raises the trigger', async () => {
    const b = SicknessBoard.parse((await (await as('manager'))('GET', '/api/v1/leave/sickness')).body);
    expect(b.rows.find(r => r.personCode === 'CP-1088')).toMatchObject({ spells: 4, days: 7, score: 112, triggered: true, next: 'Return-to-work meeting due', latest: '11/08/2026 · 1 day' });
    expect(b.rows.find(r => r.personCode === 'CP-1266')).toMatchObject({ spells: 1, days: 12, score: 12, triggered: false });
    expect(b.banner).toMatchObject({ personCode: 'CP-1088', text: triggerBannerText('Marcus Reilly', 112, 100) });
    expect(b.sickOnLeave).toEqual([{ personCode: 'CP-1088', name: 'Marcus Reilly', requestId: 'lr_4', date: '2026-08-11', days: 1 }]);
  });
  test('a day next to an episode extends it, S goes on the rota, and the score moves', async () => {
    const call = await as('manager');
    const r = SicknessRecorded.parse((await call('POST', '/api/v1/leave/sickness', { personCode: 'CP-1088', from: '2026-08-12', to: '2026-08-12', reason: 'Mental health' })).body);
    expect(r).toMatchObject({ extended: true, record: { id: 'sk_004', from: '2026-08-11', to: '2026-08-12', version: 2 }, rota: { written: 1, weeks: ['rw_WH_2026-08-10'] } });
    expect(week('WH', '2026-08-10')?.lines['CP-1088']).toEqual(['V', 'V', 'S', 'L', '', 'E', '']);
    expect(week('WH', '2026-08-10')?.state).toBe('amendment');
    expect(titles('CP-1088')).toEqual(expect.arrayContaining(['Sickness recorded', 'Rota amended']));
    expect(leaveAudits()).toEqual([expect.objectContaining({ act: 'Sickness recorded', entityId: 'sk_004', before: { from: '2026-08-11', to: '2026-08-11' } })]);
    const b = SicknessBoard.parse((await call('GET', '/api/v1/leave/sickness')).body);
    expect(b.rows.find(x => x.personCode === 'CP-1088')).toMatchObject({ spells: 4, days: 8, score: 128 });
    const n = SicknessRecorded.parse((await call('POST', '/api/v1/leave/sickness', { personCode: 'CP-1153', from: '2026-08-12', to: '2026-08-12', reason: 'Other' })).body);
    expect(n).toMatchObject({ extended: false, record: { id: 'sk_007', personCode: 'CP-1153' } });
    expect(SicknessBoard.parse((await call('GET', '/api/v1/leave/sickness')).body).rows.find(x => x.personCode === 'CP-1153')).toMatchObject({ spells: 2, days: 2, score: 8 });
  });
  test('a day already inside an episode, and a reason not on the list, are refused', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const a = await call('POST', '/api/v1/leave/sickness', { personCode: 'CP-1266', from: '2026-06-03', to: '2026-06-05', reason: 'Other' });
    expect(a.status).toBe(409);
    expect(refusal(a).code).toBe('ALREADY_RECORDED');
    const b = await call('POST', '/api/v1/leave/sickness', { personCode: 'CP-1266', from: '2026-08-12', to: '', reason: 'Hangover' });
    expect(refusal(b)).toMatchObject({ code: 'invalid', field: 'reason', message: 'Choose the reason given.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('arranging a return to work is stored on the episode, notified and audited once; a second request is refused', async () => {
    const call = await as('manager');
    const r = RtwArranged.parse((await call('POST', '/api/v1/leave/sickness/sk_004/rtw', undefined, 1)).body);
    expect(r.record.rtw).toMatchObject({ by: { personCode: 'CP-1001', name: 'Rachel Hussain' } });
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
    const r = DaysGivenBack.parse((await call('POST', '/api/v1/leave/give-back', { personCode: 'CP-1088', dates: ['2026-08-11'] })).body);
    expect(r.record).toMatchObject({ type: 'Days returned', qty: 1, unit: 'days', counts: true, dates: ['2026-08-11'], qtyText: '+1 days' });
    expect(r.summary).toBe('1 day returned to Marcus Reilly’s annual leave balance');
    const after = await ent();
    expect(after.leftD).toBe(Number((before.leftD + 1).toFixed(1)));
    expect(after.takenD).toBe(Number((before.takenD - 1).toFixed(2)));
    expect(week('WH', '2026-08-10')?.lines['CP-1088']?.slice(0, 2)).toEqual(['V', 'S']);
    expect(titles('CP-1088')).toEqual(expect.arrayContaining(['Entitlement changed']));
    expect(leaveAudits().map(a => a.act)).toEqual(['Days returned']);
    const twice = await call('POST', '/api/v1/leave/give-back', { personCode: 'CP-1088', dates: ['2026-08-11'] });
    expect(twice.status).toBe(422);
    expect(refusal(twice).code).toBe('NOT_SICK_ON_LEAVE');
    expect((await ent()).leftD).toBe(after.leftD);
  });
  test('a day that is not sickness during approved leave is refused', async () => {
    const r = await (await as('manager'))('POST', '/api/v1/leave/give-back', { personCode: 'CP-1088', dates: ['2026-08-10'] });
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
    expect(l.rows.map(r => r.personCode)).toEqual(['EMP008']);
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
});

describe('a fault on each write leaves nothing behind (Review Focus 7)', () => {
  const writes: [string, Persona, string, string, unknown, number | undefined][] = [
    ['request', 'employee', 'POST', '/api/v1/leave/requests', { type: 'AL', from: '2026-09-14', to: '2026-09-15', part: 'full' }, undefined],
    ['cancel', 'employee', 'POST', '/api/v1/leave/requests/lr_3/cancel', undefined, 1],
    ['approve', 'manager', 'POST', '/api/v1/leave/requests/lr_1/approve', undefined, 1],
    ['decline', 'manager', 'POST', '/api/v1/leave/requests/lr_2/decline', { reason: 'Short-staffed' }, 1],
    ['record sickness', 'manager', 'POST', '/api/v1/leave/sickness', { personCode: 'CP-1088', from: '2026-08-12', to: '2026-08-12', reason: 'Other' }, undefined],
    ['return to work', 'manager', 'POST', '/api/v1/leave/sickness/sk_004/rtw', undefined, 1],
    ['give days back', 'manager', 'POST', '/api/v1/leave/give-back', { personCode: 'CP-1088', dates: ['2026-08-11'] }, undefined],
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
