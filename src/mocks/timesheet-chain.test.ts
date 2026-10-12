import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { ApprovalQueue, BulkApproved, DayDecided, DaySaved } from '@/contract/timesheets';
import { POSTING_STEP } from '@/domain/approvals';
import { queueChecksum } from '@/domain/timesheet';
import { FROZEN, audits, caller, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

/* Module 8 group 4: a timesheet day walks the Timesheet approval chain. The
   line manager's approval moves it to mgrok while a payroll layer applies;
   only the last layer's approval moves it to ok and queues the posting. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

type Call = ReturnType<typeof caller>;
const as = async (p: Persona) => caller(await tokenFor(p));
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const WRITES = ['timesheetDays', 'integrationAttempts', 'notifications', 'audit'];
interface Day { id: string; version: number; state: string }
const day = (id: string) => store.coll<Day>('timesheetDays')[id];
const attempts = () => Object.keys(store.coll('integrationAttempts')).length;
interface Note { personId: string; event?: string; title: string; body: string }
const told = (event: string) => Object.values(store.coll<Note>('notifications')).filter(n => n.event === event);
const decide = (call: Call, id: string, to: 'ok' | 'back', v: number, reason = '') => call('POST', `/api/v1/timesheet-days/${id}/transition`, { to, reason }, v);
const queue = async (call: Call, qs = '') => ApprovalQueue.parse((await call('GET', `/api/v1/approvals/timesheets${qs}`)).body);
const AMARA = 'tsd_CP-1042_2026-08-12';
/* Rachel Hussain (CP-1001) is the line manager at Whitehaven; Dee Fitzgerald (CP-1002) is the admin, who holds pay_appr. */
const layer = (role: string, when: string, scope = 'All departments', sla = '24 hours') => ({ role, scope, when, sla, fixed: false });
const posting = { role: POSTING_STEP.role, scope: POSTING_STEP.scope, when: POSTING_STEP.when, sla: POSTING_STEP.sla, fixed: true };
async function payrollEveryDay(scope = 'All departments') {
  const r = await (await as('admin'))('PUT', '/api/v1/approvals/chains/Timesheet',
    { steps: [layer('Line manager', 'Every timesheet', 'Own department'), layer('Payroll', 'Every timesheet', scope, '48 hours'), posting] }, 0);
  expect(r.status).toBe(200);
}
function plant(code: string, date: string, o: Record<string, unknown> = {}) {
  const id = `tsd_${code}_${date}`;
  store.coll('timesheetDays')[id] = { id, version: 1, updatedAt: FROZEN, personCode: code, date, state: 'pend',
    entries: [{ start: '07:00', finish: '15:00', breaks: [{ start: '11:00', end: '11:30' }] }], workType: 'STD', allowances: [], shift: 'E',
    nonWorkingReason: '', captureSource: 'self', enteredBy: code, submittedAt: FROZEN, returnReason: '', warnings: [], history: [], integrationAttemptId: '', ...o };
  return id;
}
const managerSigned = [{ from: 'pend', to: 'mgrok', by: { personCode: 'CP-1001', name: 'Rachel Hussain' }, at: FROZEN, reason: '', layer: 'Line manager' }];

describe('two layers: the line manager, then payroll', () => {
  test('a day reaches ok, and its posting is queued, only after payroll approves', async () => {
    await payrollEveryDay();
    const mgr = await as('manager'), admin = await as('admin'), before = attempts();
    const first = DayDecided.parse((await decide(mgr, AMARA, 'ok', 1)).body);
    expect(first).toMatchObject({ record: { state: 'mgrok', posting: 'none' }, attempt: null });
    expect(first.record.history.at(-1)).toMatchObject({ from: 'pend', to: 'mgrok', layer: 'Line manager', by: { personCode: 'CP-1001' } });
    expect(attempts()).toBe(before);
    expect(audits().find(a => a.id === first.auditId)).toMatchObject({ act: 'Timesheet passed to payroll', after: { state: 'mgrok' } });
    const second = DayDecided.parse((await decide(admin, AMARA, 'ok', 2)).body);
    expect(second).toMatchObject({ record: { state: 'ok', posting: 'queued' }, attempt: { state: 'queued', dayId: AMARA } });
    expect(second.record.history.at(-1)).toMatchObject({ from: 'mgrok', to: 'ok', layer: 'Payroll', by: { personCode: 'CP-1002' } });
    expect(attempts()).toBe(before + 1);
    expect(audits().find(a => a.id === second.auditId)?.act).toBe('Timesheet approved');
  });
  test('mgrok shows in the payroll queue, and leaves the manager\'s', async () => {
    await payrollEveryDay();
    const mgr = await as('manager'), admin = await as('admin');
    expect((await queue(admin)).rows).toEqual([]);
    await decide(mgr, AMARA, 'ok', 1);
    const pay = await queue(admin);
    expect(pay.rows.map(r => [r.id, r.state, r.decide])).toEqual([[AMARA, 'mgrok', true]]);
    expect(pay).toMatchObject({ counts: { pend: 1, mgrok: 1 }, bulk: { ids: [AMARA] }, sla: '48 hours' });
    const own = await queue(mgr);
    expect(own.rows.map(r => r.id)).not.toContain(AMARA);
    expect((await queue(mgr, '?status=mgrok')).rows.map(r => [r.id, r.decide])).toEqual([[AMARA, false]]);
    expect(own.sla).toBe('24 hours');
  });
  test('a return works at the payroll layer, needs its reason, and the resubmission starts the chain again', async () => {
    await payrollEveryDay();
    await decide(await as('manager'), AMARA, 'ok', 1);
    const admin = await as('admin');
    expect(refusal(await decide(admin, AMARA, 'back', 2, ' '))).toMatchObject({ field: 'reason' });
    const back = DayDecided.parse((await decide(admin, AMARA, 'back', 2, 'Overtime code is wrong')).body);
    expect(back.record).toMatchObject({ state: 'back', returnReason: 'Overtime code is wrong' });
    const again = await (await as('employee'))('POST', '/api/v1/timesheets/CP-1042/days/2026-08-12/submit',
      { entries: [{ start: '07:00', finish: '15:00', breaks: [{ start: '11:00', end: '11:30' }] }], shift: 'E' }, 3);
    expect(DaySaved.parse(again.body).record.state).toBe('resub');
    expect(refusal(await decide(admin, AMARA, 'ok', 4))).toMatchObject({ code: 'WRONG_LAYER' });
    expect(DayDecided.parse((await decide(await as('manager'), AMARA, 'ok', 4)).body).record.state).toBe('mgrok');
  });
});

describe('the seeded chain keeps today\'s behaviour (D6)', () => {
  test('payroll applies only above a premium threshold: a standard day is approved straight away, an overtime day waits on payroll', async () => {
    const mgr = await as('manager');
    expect(DayDecided.parse((await decide(mgr, AMARA, 'ok', 1)).body).record.state).toBe('ok');
    const ot = plant('CP-1153', '2026-08-13', { workType: 'OT15' });
    expect(DayDecided.parse((await decide(mgr, ot, 'ok', 1)).body).record.state).toBe('mgrok');
    expect(DayDecided.parse((await decide(await as('admin'), ot, 'ok', 2)).body).record.state).toBe('ok');
  });
});

describe('bulk approval works per layer', () => {
  test('a payroll holder\'s bulk approval moves only the days at the payroll layer; the rest come back held', async () => {
    await payrollEveryDay();
    const mgr = await as('manager'), admin = await as('admin');
    const shown = (await queue(mgr)).bulk;
    const first = BulkApproved.parse((await mgr('POST', '/api/v1/approvals/timesheets/bulk', { ids: shown.ids, checksum: shown.checksum })).body);
    expect(first.approved.map(d => d.state)).toEqual(['mgrok', 'mgrok', 'mgrok']);
    expect(audits().find(a => a.id === first.auditId)).toMatchObject({ act: 'Bulk approval', after: { state: 'approved by manager' } });
    const fresh = plant('CP-1266', '2026-08-13');
    const ids = [...first.approved.map(d => d.id), fresh], recs = ids.map(day).filter((d): d is Day => d !== undefined);
    const before = attempts();
    const out = BulkApproved.parse((await admin('POST', '/api/v1/approvals/timesheets/bulk', { ids, checksum: queueChecksum(recs) })).body);
    expect(out.approved.map(d => [d.id, d.state])).toEqual(first.approved.map(d => [d.id, 'ok']));
    expect(out.held).toEqual([{ id: fresh, code: 'WRONG_LAYER', reason: 'This timesheet is waiting on the line manager, not on a layer you sign off.' }]);
    expect(attempts()).toBe(before + 3);
    expect(day(fresh)?.state).toBe('pend');
  });
});

describe('delegation applies at the payroll layer', () => {
  test('while it is in force, the delegate decides the payroll layer for the holder; before it, they are refused', async () => {
    await payrollEveryDay();
    const mgr = await as('manager');
    await decide(mgr, AMARA, 'ok', 1);
    expect(refusal(await decide(mgr, AMARA, 'ok', 2))).toMatchObject({ code: 'WRONG_LAYER', message: 'This timesheet is waiting on payroll, not on a layer you sign off.', next: 'Payroll decides it now.' });
    store.coll('delegations').dlg_9 = { id: 'dlg_9', version: 1, updatedAt: FROZEN, who: 'CP-1002', to: 'CP-1001', from: '2026-08-13', until: '2026-08-20', modules: ['Timesheet'] };
    expect((await queue(mgr)).rows.map(r => [r.id, r.decide])).toContainEqual([AMARA, true]);
    const r = DayDecided.parse((await decide(mgr, AMARA, 'ok', 2)).body);
    expect(r.record).toMatchObject({ state: 'ok', posting: 'queued' });
    expect(r.record.history.at(-1)).toMatchObject({ layer: 'Payroll', by: { personCode: 'CP-1001' } });
  });
});

describe('permissions on every layer', () => {
  test('self-approval is refused at both layers', async () => {
    await payrollEveryDay();
    const own = plant('CP-1001', '2026-08-12'), payrollOwn = plant('CP-1002', '2026-08-12', { state: 'mgrok', history: managerSigned });
    const mgr = await as('manager'), admin = await as('admin'), before = snapshot(...WRITES);
    for (const to of ['ok', 'back'] as const) {
      expect(refusal(await decide(mgr, own, to, 1, 'x'))).toMatchObject({ code: 'SELF_APPROVAL' });
      expect(refusal(await decide(admin, payrollOwn, to, 1, 'x'))).toMatchObject({ code: 'SELF_APPROVAL', message: 'You cannot approve or return your own timesheet.' });
    }
    const held = BulkApproved.parse((await admin('POST', '/api/v1/approvals/timesheets/bulk',
      { ids: [payrollOwn], checksum: queueChecksum([day(payrollOwn)].filter((d): d is Day => d !== undefined)) })).body);
    expect(held.held.map(h => h.code)).toEqual(['SELF_APPROVAL']);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('the wrong layer, no capability and out of scope are each refused, and nothing is written', async () => {
    await payrollEveryDay('Own location');
    const mgr = await as('manager'), admin = await as('admin'), emp = await as('employee');
    const waiting = plant('CP-1153', '2026-08-13', { state: 'mgrok', history: managerSigned }), away = plant('CP-1288', '2026-08-12');
    const before = snapshot(...WRITES);
    const wrong = await decide(admin, AMARA, 'ok', 1);
    expect([wrong.status, refusal(wrong).code, refusal(wrong).next]).toEqual([403, 'WRONG_LAYER', 'The line manager decides it now.']);
    expect(refusal(await decide(mgr, waiting, 'ok', 1)).code).toBe('WRONG_LAYER');
    const none = await decide(emp, AMARA, 'ok', 1);
    expect([none.status, refusal(none).code]).toEqual([403, 'capability']);
    expect((await emp('GET', '/api/v1/approvals/timesheets')).status).toBe(403);
    /* payroll's layer is set to its own location, and Dee works at the support office, not Whitehaven */
    const out = await decide(admin, waiting, 'ok', 1);
    expect([out.status, refusal(out).code]).toEqual([403, 'scope']);
    expect(refusal(await decide(mgr, away, 'ok', 1)).code).toBe('scope');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a role nothing decides cannot go into the Timesheet chain', async () => {
    const r = await (await as('admin'))('PUT', '/api/v1/approvals/chains/Timesheet',
      { steps: [layer('Line manager', 'Every timesheet'), layer('HR administrator', 'Only for proxy entries'), posting] }, 0);
    expect([r.status, refusal(r).field, refusal(r).message]).toEqual([422, 'steps.1.role', 'The Timesheet chain can only have a line manager and payroll.']);
  });
});

describe('notifications: ts_submitted, ts_approved and ts_returned', () => {
  test('a submission tells the line manager, the manager\'s approval tells payroll, the last approval tells the person', async () => {
    await payrollEveryDay();
    const sent = await (await as('employee'))('POST', '/api/v1/timesheets/CP-1042/days/2026-08-13/submit',
      { entries: [{ start: '07:00', finish: '15:00', breaks: [{ start: '11:00', end: '11:30' }] }], shift: 'E' }, 0);
    const id = DaySaved.parse(sent.body).record.id;
    expect(told('ts_submitted').map(n => [n.personId, n.title, n.body])).toEqual([
      ['CP-1001', 'Timesheet submitted', 'Amara Okafor (CP-1042). 13/08/2026. 7h 30m. Awaiting approval.']]);
    await decide(await as('manager'), id, 'ok', 1);
    expect(told('ts_submitted').slice(1).map(n => [n.personId, n.title, n.body])).toEqual([
      ['CP-1002', 'Timesheet awaiting approval', 'Amara Okafor (CP-1042). 13/08/2026. 7h 30m. Approved by Rachel Hussain, now waiting on payroll.']]);
    expect(told('ts_approved')).toEqual([]);
    await decide(await as('admin'), id, 'ok', 2);
    expect(told('ts_approved').map(n => [n.personId, n.body])).toEqual([
      ['CP-1042', '13/08/2026. 7h 30m. Approved by Dee Fitzgerald and queued for Business Central.']]);
  });
  test('a return tells the person why', async () => {
    await decide(await as('manager'), AMARA, 'back', 1, 'Break missing');
    expect(told('ts_returned').map(n => [n.personId, n.title, n.body])).toEqual([
      ['CP-1042', 'Timesheet returned', '12/08/2026. Sent back by Rachel Hussain: "Break missing". Correct it and submit it again.']]);
  });
});

describe('the week start counts mgrok as open work (D4)', () => {
  test('a day waiting on payroll keeps the week start from changing', async () => {
    for (const d of Object.values(store.coll<{ state: string }>('timesheetDays'))) if (d.state !== 'ok') d.state = 'ok';
    for (const w of Object.values(store.coll<{ state: string }>('rotaWeeks'))) w.state = 'published';
    plant('CP-1153', '2026-08-13', { state: 'mgrok', history: managerSigned });
    const admin = await as('admin');
    const t = store.coll<{ version: number }>('tenant').tenant;
    const r = await admin('PATCH', '/api/v1/tenant/settings', { weekStart: 'Sunday' }, t?.version ?? 1);
    expect([r.status, refusal(r).code, refusal(r).message]).toEqual([409, 'week-start-in-use',
      'The week start cannot change while 1 timesheet day is and 0 rota weeks are open.']);
  });
});
