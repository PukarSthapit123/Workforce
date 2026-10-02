import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import {
  ApprovalQueue, BulkApproved, DayDecided, DaySaved, IntegrationAttempt, MultiweekSubmitted, TimesheetConfig, TimesheetSetup,
  TimesheetWeek, WeekSubmitted,
} from '@/contract/timesheets';
import { mutation } from '@/contract/common';
import { queueChecksum } from '@/domain/timesheet';
import { FROZEN, audits, caller, fault, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

type Call = ReturnType<typeof caller>;
const as = async (p: Persona) => caller(await tokenFor(p));
async function asEmail(email: string): Promise<Call> {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const { token } = (await r.json()) as { token: string };
  return caller(token);
}
const WRITES = ['timesheetDays', 'integrationAttempts', 'timesheetConfig', 'audit'];
interface Day { id: string; version: number; state: string; captureSource: string; enteredBy: string; personCode: string; integrationAttemptId: string; history: unknown[]; returnReason: string }
interface Attempt { id: string; version: number; state: string; attempt: number; cause?: string; reason?: string }
const day = (code: string, date: string) => store.coll<Day>('timesheetDays')[`tsd_${code}_${date}`];
const attempt = (id: string) => store.coll<Attempt>('integrationAttempts')[id];
const attemptCount = () => Object.keys(store.coll('integrationAttempts')).length;
const entry = (start: string, finish: string, breaks: [string, string][] = []) => ({ start, finish, breaks: breaks.map(([s, e]) => ({ start: s, end: e })) });
const shiftDay = (start = '07:00', finish = '15:00', breaks: [string, string][] = [['11:00', '11:30']]) => ({ entries: [entry(start, finish, breaks)], shift: 'E' });
const put = (call: Call, code: string, date: string, body: unknown, v = 0) => call('PUT', `/api/v1/timesheets/${code}/days/${date}`, body, v);
const submit = (call: Call, code: string, date: string, body: unknown, v = 0) => call('POST', `/api/v1/timesheets/${code}/days/${date}/submit`, body, v);
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
/* A pending day planted straight into the store, for scope and self checks. */
function plant(code: string, date: string, state = 'pend') {
  const id = `tsd_${code}_${date}`;
  store.coll('timesheetDays')[id] = { id, version: 1, updatedAt: FROZEN, personCode: code, date, state, entries: [entry('07:00', '15:00', [['11:00', '11:30']])],
    workType: 'STD', allowances: [], shift: 'E', nonWorkingReason: '', captureSource: 'self', enteredBy: code, submittedAt: FROZEN, returnReason: '',
    warnings: [], history: [], integrationAttemptId: '' };
  return id;
}
const LOCK_0805 = 'Pay period 03/08/2026 – 09/08/2026 closed at Monday 12:00 (10/08/2026 12:00).';

describe('GET /api/v1/timesheets/:personId/weeks/:weekStart', () => {
  test('an employee reads their own week in one call: days, states, versions, capture setup and earlier weeks', async () => {
    const w = TimesheetWeek.parse((await (await as('employee'))('GET', '/api/v1/timesheets/CP-1042/weeks/2026-08-10')).body);
    expect(w.days.map(d => d.date)).toEqual(['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16']);
    expect(w.days[2]).toMatchObject({ state: 'pend', version: 1, minutes: 450, locked: false });
    expect(w.days[3]).toMatchObject({ state: 'none', version: 0, record: null, future: false });
    expect(w.days[4]?.future).toBe(true);
    expect(w.weekMinutes).toBe(450);
    expect(w.capture.type?.fields.shift_code).toMatchObject({ mand: true });
    expect(w.earlierWeeks.map(x => [x.weekStart, x.status, x.locked])).toEqual([['2026-08-03', 'ready', true], ['2026-07-27', 'ready', true]]);
    expect(w.earlierWeeks[0]?.minutes).toBe(37 * 60 + 30);
  });
  test('an employee cannot read somebody else\'s week', async () => {
    const r = await (await as('employee'))('GET', '/api/v1/timesheets/CP-1153/weeks/2026-08-10');
    expect(r.status).toBe(403);
    expect(refusal(r).code).toBe('capability');
  });
  test('a week that does not start on a Monday is refused naming the field', async () => {
    const r = await (await as('employee'))('GET', '/api/v1/timesheets/CP-1042/weeks/2026-08-11');
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ field: 'weekStart', message: 'A week starts on a Monday.' });
  });
  test('the proxy grid seeds from the target person, never from the manager (D6)', async () => {
    const w = TimesheetWeek.parse((await (await as('manager'))('GET', '/api/v1/timesheets/CP-1153/weeks/2026-08-10')).body);
    expect(w.person).toMatchObject({ code: 'CP-1153', employeeType: 'shift' });
    expect(w.days[1]?.record?.personCode).toBe('CP-1153');
    expect(w.capture.type?.fields.shift_code).toBeDefined();
    expect(w.capture.capabilities).toContain('shift');
  });
  test('a manager cannot read a week at another location', async () => {
    const r = await (await as('manager'))('GET', '/api/v1/timesheets/CP-1288/weeks/2026-08-10');
    expect(r.status).toBe(403);
    expect(refusal(r).code).toBe('scope');
  });
});

describe('PUT /api/v1/timesheets/:personId/days/:date (Review Focus 2)', () => {
  test('a day saves as a draft with one audit row', async () => {
    const call = await as('employee');
    const r = await put(call, 'CP-1042', '2026-08-13', shiftDay());
    expect(r.status).toBe(200);
    const { record, warnings, auditId } = DaySaved.parse(r.body);
    expect(record).toMatchObject({ state: 'draft', version: 1, minutes: 450, captureSource: 'self', enteredBy: 'CP-1042', workType: 'STD' });
    expect(warnings).toEqual([]);
    expect(audits().filter(a => a.id === auditId).map(a => a.act)).toEqual(['Timesheet draft saved']);
  });
  test('a warning never blocks: a 12-hour day saves and says so', async () => {
    const r = await put(await as('employee'), 'CP-1042', '2026-08-13', shiftDay('07:00', '19:00', []));
    expect(r.status).toBe(200);
    expect(DaySaved.parse(r.body).warnings).toEqual(['That is 12h 00m in one day. It is above the 10-hour review threshold.']);
  });
  const refusals: [string, string, unknown, number, Partial<Refusal>][] = [
    ['a future date', '2026-08-14', shiftDay(), 422, { code: 'TS_INVALID', field: 'date', message: 'You cannot record time for Fri 14 Aug. It is in the future.' }],
    ['overlapping breaks', '2026-08-13', shiftDay('07:00', '15:00', [['10:00', '11:00'], ['10:30', '11:30']]), 422,
      { code: 'TS_INVALID', field: 'entries.0.breaks.1', message: 'Breaks 1 and 2 overlap.' }],
    ['breaks longer than the shift', '2026-08-13', shiftDay('07:00', '08:00', [['07:00', '08:00']]), 422,
      { code: 'TS_INVALID', field: 'entries.0.breaks', message: 'Breaks (1h 00m) are longer than the shift (1h 00m).' }],
    ['the daily maximum', '2026-08-13', shiftDay('06:00', '23:30', []), 422,
      { code: 'TS_INVALID', field: 'entries.0.finish', message: 'Net time is 17h 30m, above the 16-hour daily maximum.' }],
    ['a missing mandatory field', '2026-08-13', { entries: [entry('07:00', '15:00')] }, 422,
      { code: 'TS_INVALID', field: 'entries.0.shift_code', message: 'Submission blocked. Fill in: Rota line.' }],
  ];
  for (const [what, date, body, status, expected] of refusals) {
    test(`${what} is refused and nothing is written`, async () => {
      const call = await as('employee'), before = snapshot(...WRITES);
      const r = await put(call, 'CP-1042', date, body);
      expect(r.status).toBe(status);
      expect(refusal(r)).toMatchObject({ ...expected, next: expect.any(String) });
      expect(snapshot(...WRITES)).toEqual(before);
    });
  }
  test('a closed period is refused with PERIOD_LOCKED, the lock note and who to ask', async () => {
    const call = await as('employee'), before = snapshot(...WRITES);
    const r = await put(call, 'CP-1042', '2026-08-05', shiftDay(), 1);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'PERIOD_LOCKED', message: LOCK_0805, next: 'Ask Rachel Hussain to raise an amendment.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a stale version is refused with 412', async () => {
    const call = await as('employee');
    await put(call, 'CP-1042', '2026-08-13', shiftDay());
    const r = await put(call, 'CP-1042', '2026-08-13', shiftDay('08:00', '16:00'), 0);
    expect(r.status).toBe(412);
    expect(day('CP-1042', '2026-08-13')?.version).toBe(1);
  });
  test('a day already submitted cannot be saved over', async () => {
    const r = await put(await as('employee'), 'CP-1042', '2026-08-12', shiftDay(), 1);
    expect(r.status).toBe(409);
    expect(refusal(r).code).toBe('ALREADY_SUBMITTED');
  });
  test('a non-working day saves with its reason and no times', async () => {
    const r = await put(await as('employee'), 'CP-1042', '2026-08-13', { entries: [], nonWorkingReason: 'Rest day' });
    expect(DaySaved.parse(r.body).record).toMatchObject({ nonWorkingReason: 'Rest day', minutes: 0, state: 'draft' });
  });
});

describe('POST /api/v1/timesheets/:personId/days/:date/submit', () => {
  test('a new day is saved and submitted in one request, with history and one audit row', async () => {
    const r = await submit(await as('employee'), 'CP-1042', '2026-08-13', shiftDay());
    const { record, auditId } = DaySaved.parse(r.body);
    expect(record).toMatchObject({ state: 'pend', version: 1, submittedAt: FROZEN });
    expect(record.history).toEqual([expect.objectContaining({ from: 'draft', to: 'pend', by: { personCode: 'CP-1042', name: 'Amara Okafor' } })]);
    expect(audits().filter(a => a.id === auditId).map(a => a.act)).toEqual(['Timesheet awaiting approval']);
  });
  test('a retried submit is refused with ALREADY_SUBMITTED and never makes a second record (D8)', async () => {
    const call = await as('employee');
    await submit(call, 'CP-1042', '2026-08-13', shiftDay());
    const before = snapshot(...WRITES);
    const r = await submit(call, 'CP-1042', '2026-08-13', shiftDay(), 0);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'ALREADY_SUBMITTED', message: 'You already have an entry for 13/08/2026. It is awaiting approval.' });
    expect(snapshot(...WRITES)).toEqual(before);
    expect(Object.keys(store.coll('timesheetDays')).filter(k => k.startsWith('tsd_CP-1042_2026-08-13'))).toHaveLength(1);
  });
  test('a sent-back day is corrected and resubmitted', async () => {
    const r = await submit(await asEmail('priya.shah@brightpath.org'), 'CP-1201', '2026-08-10', { entries: [entry('14:30', '22:00', [['18:00', '18:30']])], shift: 'L' }, 1);
    const { record } = DaySaved.parse(r.body);
    expect(record).toMatchObject({ state: 'resub', version: 2, captureSource: 'self' });
    expect(record.history.at(-1)).toMatchObject({ from: 'back', to: 'resub', reason: 'Corrected and resubmitted' });
  });
  test('capture rules hold on submit: a future day and a closed period are refused', async () => {
    const call = await as('employee'), before = snapshot(...WRITES);
    expect(refusal(await submit(call, 'CP-1042', '2026-08-15', shiftDay()))).toMatchObject({ code: 'TS_INVALID', field: 'date' });
    expect(refusal(await submit(call, 'CP-1042', '2026-08-03', shiftDay(), 1))).toMatchObject({ code: 'PERIOD_LOCKED' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

describe('proxy entry (Review Focus 5)', () => {
  test('a manager\'s day entry is attributed to the manager, flagged as proxy and audited as theirs', async () => {
    const call = await as('manager');
    const { record, auditId } = DaySaved.parse((await submit(call, 'CP-1153', '2026-08-13', shiftDay())).body);
    expect(record).toMatchObject({ personCode: 'CP-1153', captureSource: 'proxy', enteredBy: 'CP-1001', enteredByName: 'Rachel Hussain', state: 'pend' });
    const a = audits().find(x => x.id === auditId);
    expect(a).toMatchObject({ act: 'Proxy timesheet submitted', who: { personCode: 'CP-1001' } });
    expect(JSON.stringify(a?.after)).toContain('entered on their behalf');
    const q = ApprovalQueue.parse((await call('GET', '/api/v1/approvals/timesheets')).body);
    expect(q.rows.find(r => r.id === record.id)?.flags.map(f => f.code)).toContain('proxy');
  });
  test('a manager\'s week entry creates real records for the target, attributed to the manager', async () => {
    const r = await (await as('manager'))('POST', '/api/v1/timesheets/CP-1153/weeks/2026-08-10/submit',
      { days: [{ date: '2026-08-12', version: 0, ...shiftDay() }, { date: '2026-08-13', version: 0, ...shiftDay() }] });
    const out = WeekSubmitted.parse(r.body);
    expect(out.submitted.map(d => [d.date, d.captureSource, d.enteredBy])).toEqual([['2026-08-12', 'proxy', 'CP-1001'], ['2026-08-13', 'proxy', 'CP-1001']]);
    expect(day('CP-1153', '2026-08-12')?.state).toBe('pend');
    expect(audits().find(a => a.id === out.auditId)?.act).toBe('Proxy timesheet week submitted');
  });
  test('capture rules hold for proxy entry too', async () => {
    const r = await submit(await as('manager'), 'CP-1153', '2026-08-14', shiftDay());
    expect(refusal(r)).toMatchObject({ code: 'TS_INVALID', field: 'date' });
  });
  test('proxy entry outside the manager\'s location is refused, and an employee cannot enter for anyone', async () => {
    const out = await submit(await as('manager'), 'CP-1288', '2026-08-13', shiftDay());
    expect(out.status).toBe(403);
    expect(refusal(out).code).toBe('scope');
    const emp = await submit(await as('employee'), 'CP-1153', '2026-08-13', shiftDay());
    expect(emp.status).toBe(403);
  });
});

describe('POST /api/v1/timesheets/:personId/weeks/:weekStart/submit (Review Focus 3)', () => {
  const url = '/api/v1/timesheets/CP-1042/weeks/2026-08-10/submit';
  test('one request submits the week: the ready days become real records, the rest come back held with reasons', async () => {
    const call = await as('employee');
    const r = await call('POST', url, { days: ['2026-08-10', '2026-08-11', '2026-08-13', '2026-08-14'].map(date => ({ date, version: 0, ...shiftDay() })) });
    expect(r.status).toBe(200);
    const out = WeekSubmitted.parse(r.body);
    expect(out.submitted.map(d => [d.date, d.state])).toEqual([['2026-08-10', 'pend'], ['2026-08-11', 'pend'], ['2026-08-13', 'pend']]);
    for (const d of out.submitted) expect(day('CP-1042', d.date)).toMatchObject({ state: 'pend', version: 1 });
    expect(out.held).toEqual([
      { date: '2026-08-12', reason: 'Wed 12 Aug is already awaiting approval, so it was left alone.' },
      { date: '2026-08-14', reason: 'Fri 14 Aug is in the future, so it is held back until it happens.' },
    ]);
    expect(day('CP-1042', '2026-08-14')).toBeUndefined();
    expect(out.weekMinutes).toBe(3 * 450);
    expect(audits().filter(a => a.act === 'Timesheet week submitted')).toHaveLength(1);
  });
  test('one invalid day refuses the whole week and nothing is written', async () => {
    const call = await as('employee'), before = snapshot(...WRITES);
    const r = await call('POST', url, { days: [{ date: '2026-08-10', version: 0, ...shiftDay() },
      { date: '2026-08-11', version: 0, ...shiftDay('07:00', '15:00', [['10:00', '11:00'], ['10:30', '11:30']]) }] });
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ code: 'TS_INVALID', field: 'days.1.entries.0.breaks.1', message: 'Submission blocked. Tue 11 Aug: Breaks 1 and 2 overlap.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a week in a closed period is refused with PERIOD_LOCKED', async () => {
    const call = await as('employee'), before = snapshot(...WRITES);
    const r = await call('POST', '/api/v1/timesheets/CP-1042/weeks/2026-08-03/submit', { days: [] });
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'PERIOD_LOCKED', next: 'Ask Rachel Hussain to raise an amendment.' });
    expect(refusal(r).message).toMatch(/^Submission blocked\. Mon 3 Aug: Pay period 03\/08\/2026/);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a week where everything is already with the approver is refused with ALREADY_SUBMITTED', async () => {
    const r = await (await as('employee'))('POST', url, { days: [] });
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'ALREADY_SUBMITTED', message: 'Already submitted. Every day on this week is with Rachel Hussain or decided.' });
  });
  test('a day read at an older version is refused with 412', async () => {
    const r = await (await as('employee'))('POST', url, { days: [{ date: '2026-08-12', version: 0, ...shiftDay() }] });
    expect(r.status).toBe(412);
    expect(refusal(r)).toMatchObject({ code: 'stale', field: 'days.0' });
  });
});

describe('POST /api/v1/timesheets/:personId/multiweek/submit', () => {
  test('weeks in a closed period are held back with the lock note, and nothing changes', async () => {
    const call = await as('employee'), before = snapshot(...WRITES);
    const out = MultiweekSubmitted.parse((await call('POST', '/api/v1/timesheets/CP-1042/multiweek/submit', { weeks: ['2026-08-03', '2026-07-27'] })).body);
    expect(out.weeks.map(w => [w.weekStart, w.outcome])).toEqual([['2026-08-03', 'held'], ['2026-07-27', 'held']]);
    expect(out.weeks[0]?.reason).toBe(`${LOCK_0805} Ask Rachel Hussain to raise an amendment.`);
    expect(out.auditId).toBeNull();
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('with the lock off, each week routes separately and the days become pending records', async () => {
    resetTo('qnipay');
    const admin = await as('admin');
    const cfg = TimesheetSetup.parse((await admin('GET', '/api/v1/timesheet-config')).body).config;
    expect((await admin('PATCH', '/api/v1/timesheet-config', { rules: { enforceLock: false } }, cfg.version)).status).toBe(200);
    const out = MultiweekSubmitted.parse((await (await asEmail('bigyan.poudel@dogmagroup.co.uk'))('POST', '/api/v1/timesheets/EMP004/multiweek/submit',
      { weeks: ['2026-07-27', '2026-08-03'] })).body);
    expect(out.weeks.map(w => [w.weekStart, w.outcome, w.submitted.length])).toEqual([['2026-08-03', 'submitted', 5], ['2026-07-27', 'submitted', 4]]);
    expect(day('EMP004', '2026-07-27')?.state).toBe('pend');
    expect(audits().find(a => a.id === out.auditId)?.act).toBe('Timesheet weeks submitted');
  });
  test('this week is not caught up here', async () => {
    const r = await (await as('employee'))('POST', '/api/v1/timesheets/CP-1042/multiweek/submit', { weeks: ['2026-08-10'] });
    expect(r.status).toBe(422);
    expect(refusal(r).field).toBe('weeks.0');
  });
});

describe('POST /api/v1/timesheet-days/:id/transition (Review Focus 1 and 4)', () => {
  const id = 'tsd_CP-1042_2026-08-12';
  const decide = (call: Call, dayId: string, to: 'ok' | 'back', reason = '', v = 1) => call('POST', `/api/v1/timesheet-days/${dayId}/transition`, { to, reason }, v);
  test('approval queues a posting and never claims it was posted', async () => {
    const r = await decide(await as('manager'), id, 'ok');
    const { record, attempt: a, auditId } = DayDecided.parse(r.body);
    expect(record).toMatchObject({ state: 'ok', version: 2, posting: 'queued' });
    expect(a).toMatchObject({ state: 'queued', attempt: 1, simulated: true, dayId: id, ref: 'Amara Okafor · 12/08/2026' });
    const row = audits().find(x => x.id === auditId);
    expect(row?.act).toBe('Timesheet approved');
    expect(JSON.stringify(row)).toContain('queued for Business Central');
    expect(JSON.stringify(row)).not.toMatch(/posted/i);
  });
  test('a return records the reason on the day and in its history', async () => {
    const { record } = DayDecided.parse((await decide(await as('manager'), id, 'back', 'Break missing')).body);
    expect(record).toMatchObject({ state: 'back', returnReason: 'Break missing' });
    expect(record.history.at(-1)).toMatchObject({ from: 'pend', to: 'back', reason: 'Break missing', by: { personCode: 'CP-1001' } });
  });
  test('a return without a reason is refused naming the field', async () => {
    const r = await decide(await as('manager'), id, 'back', '  ');
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ field: 'reason', message: 'A reason is required.' });
  });
  test('403 out of scope: a day at another location', async () => {
    const other = plant('CP-1288', '2026-08-12');
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await decide(call, other, 'ok');
    expect(r.status).toBe(403);
    expect(refusal(r).code).toBe('scope');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('403 SELF_APPROVAL: a manager cannot approve or return their own day', async () => {
    const own = plant('CP-1001', '2026-08-12');
    const call = await as('manager'), before = snapshot(...WRITES);
    for (const to of ['ok', 'back'] as const) {
      const r = await decide(call, own, to, 'x');
      expect(r.status).toBe(403);
      expect(refusal(r)).toMatchObject({ code: 'SELF_APPROVAL', next: 'Ask another approver at your location.' });
    }
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('409 transition not allowed, in the prototype\'s words', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await decide(call, 'tsd_CP-1201_2026-08-10', 'back', 'Again');
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'TRANSITION_NOT_ALLOWED', message: 'Not allowed. A sent back timesheet cannot move to sent back.' });
    const ok = await decide(call, 'tsd_CP-1402_2026-08-10', 'ok');
    expect(refusal(ok).message).toBe('Not allowed. An approved timesheet cannot move to approved.');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('412 stale version', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await decide(call, id, 'ok', '', 0);
    expect(r.status).toBe(412);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('an employee without team_ts is refused', async () => {
    expect((await decide(await as('employee'), id, 'ok')).status).toBe(403);
  });
});

describe('GET /api/v1/approvals/timesheets and the dispatcher (Review Focus 4)', () => {
  const queue = async (call: Call, qs = '') => ApprovalQueue.parse((await call('GET', `/api/v1/approvals/timesheets${qs}`)).body);
  test('the queue holds the pending days at the approver\'s location, with counts and the bulk set', async () => {
    const q = await queue(await as('manager'));
    expect(q.rows.map(r => r.personCode)).toEqual(['CP-1042', 'CP-1153', 'CP-1266']);
    expect(q.counts).toEqual({ pend: 3, resub: 0, ok: 2, back: 1, all: 6 });
    expect(q.bulk).toMatchObject({ ids: ['tsd_CP-1042_2026-08-12', 'tsd_CP-1153_2026-08-11', 'tsd_CP-1266_2026-08-10'], people: 3, outside: 0 });
    expect(q.oldestPending).toBe('2026-08-11');
    const all = await queue(await as('manager'), '?status=all');
    expect(all.rows.filter(r => r.state === 'ok').map(r => r.posting)).toEqual(['posted', 'posted']);
  });
  test('days at other locations stay out of the queue and are counted as outside', async () => {
    plant('CP-1288', '2026-08-12');
    const q = await queue(await as('manager'));
    expect(q.rows.map(r => r.personCode)).not.toContain('CP-1288');
    expect(q.bulk.outside).toBe(1);
  });
  test('q searches by name or date, and a bad cursor is refused', async () => {
    const call = await as('manager');
    expect((await queue(call, '?status=all&q=baptiste')).rows.map(r => r.personCode)).toEqual(['CP-1153']);
    expect((await queue(call, '?status=all&q=12/08/2026')).rows.map(r => r.personCode)).toEqual(['CP-1042', 'CP-1088']);
    const r = await call('GET', '/api/v1/approvals/timesheets?cursor=abc');
    expect(r.status).toBe(422);
    expect(refusal(r).field).toBe('cursor');
  });
  test('an employee cannot read the queue', async () => {
    expect((await (await as('employee'))('GET', '/api/v1/approvals/timesheets')).status).toBe(403);
  });
  test('only the dispatcher resolves: queued after approval, posted after the next read of the queue', async () => {
    const call = await as('manager');
    const { attempt: a } = DayDecided.parse((await call('POST', '/api/v1/timesheet-days/tsd_CP-1042_2026-08-12/transition', { to: 'ok', reason: '' }, 1)).body);
    if (!a) throw new Error('no attempt');
    expect(attempt(a.id)?.state).toBe('queued');
    const q = await queue(call, '?status=ok');
    expect(attempt(a.id)?.state).toBe('posted');
    expect(q.rows.find(r => r.id === 'tsd_CP-1042_2026-08-12')?.posting).toBe('posted');
  });
  test('an attempt with an unresolved cause fails on dispatch, and a fault-injected attempt fails once', async () => {
    const call = await as('manager');
    const { attempt: a } = DayDecided.parse((await call('POST', '/api/v1/timesheet-days/tsd_CP-1042_2026-08-12/transition', { to: 'ok', reason: '' }, 1)).body);
    if (!a) throw new Error('no attempt');
    await fault('DISPATCH', `/api/v1/integration/attempts/${a.id}`);
    await queue(call);
    expect(attempt(a.id)).toMatchObject({ state: 'failed', reason: 'Business Central did not answer (simulated fault).' });
    const admin = await as('admin');
    const retried = mutation(IntegrationAttempt).parse((await admin('POST', `/api/v1/integration/attempts/${a.id}/retry`, undefined, 2)).body);
    expect(retried.record).toMatchObject({ state: 'queued', attempt: 2 });
    await queue(call);
    expect(attempt(a.id)).toMatchObject({ state: 'posted', attempt: 2 });
  });
});

describe('POST /api/v1/integration/attempts/:id/retry (Review Focus 4)', () => {
  const retry = (call: Call, id: string, v = 1) => call('POST', `/api/v1/integration/attempts/${id}/retry`, undefined, v);
  test('a retry re-queues and counts; the unresolved cause fails it again on the next dispatch', async () => {
    const admin = await as('admin');
    const { record, auditId } = mutation(IntegrationAttempt).parse((await retry(admin, 'int_a1f3')).body);
    expect(record).toMatchObject({ state: 'queued', attempt: 2 });
    expect(audits().find(a => a.id === auditId)).toMatchObject({ act: 'Integration retry' });
    expect(JSON.stringify(audits().find(a => a.id === auditId)?.after)).toContain('Batch WK32 · generic API · attempt 2');
    await (await as('manager'))('GET', '/api/v1/approvals/timesheets');
    expect(attempt('int_a1f3')).toMatchObject({ state: 'failed', attempt: 2, reason: 'Line 2: unknown cost centre CC-991' });
  });
  test('only a failed posting is retried', async () => {
    const admin = await as('admin'), before = snapshot(...WRITES);
    const r = await retry(admin, 'int_ts4');
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'RETRY_NOT_ALLOWED', message: 'This posting has already been posted.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a stale version is refused with 412', async () => {
    expect((await retry(await as('admin'), 'int_a1f3', 3)).status).toBe(412);
  });
});

describe('POST /api/v1/approvals/timesheets/bulk (Review Focus 1)', () => {
  const bulk = (call: Call, ids: string[], checksum: string) => call('POST', '/api/v1/approvals/timesheets/bulk', { ids, checksum });
  const shown = async (call: Call) => ApprovalQueue.parse((await call('GET', '/api/v1/approvals/timesheets')).body).bulk;
  test('approves what the approver was shown, queues a posting each, and writes one audit row', async () => {
    const call = await as('manager'), set = await shown(call), was = attemptCount(), rows = audits().length;
    const out = BulkApproved.parse((await bulk(call, set.ids, set.checksum)).body);
    expect(out.approved.map(d => [d.id, d.state, d.posting])).toEqual(set.ids.map(id => [id, 'ok', 'queued']));
    expect(out).toMatchObject({ held: [], people: 3 });
    expect(attemptCount()).toBe(was + 3);
    expect(audits()).toHaveLength(rows + 1);
    const row = audits().find(a => a.id === out.auditId);
    expect(row?.act).toBe('Bulk approval');
    expect(JSON.stringify(row?.after)).toContain('queued for Business Central');
  });
  test('409 QUEUE_CHANGED when any row moved since it was shown, and nothing is approved', async () => {
    const call = await as('manager'), set = await shown(call);
    await call('POST', '/api/v1/timesheet-days/tsd_CP-1153_2026-08-11/transition', { to: 'back', reason: 'Check the break' }, 1);
    const before = snapshot(...WRITES);
    const r = await bulk(call, set.ids, set.checksum);
    expect(r.status).toBe(409);
    expect(refusal(r).code).toBe('QUEUE_CHANGED');
    expect(snapshot(...WRITES)).toEqual(before);
    expect(day('CP-1042', '2026-08-12')?.state).toBe('pend');
  });
  test('an unknown id is a changed queue too', async () => {
    const call = await as('manager'), set = await shown(call);
    expect(refusal(await bulk(call, [...set.ids, 'tsd_nobody'], set.checksum)).code).toBe('QUEUE_CHANGED');
  });
  test('rows the approver may not decide come back held with the reason, not silently skipped', async () => {
    const own = plant('CP-1001', '2026-08-12'), out = plant('CP-1288', '2026-08-12'), ok = 'tsd_CP-1042_2026-08-12';
    const ids = [own, out, ok], recs = ids.map(id => store.coll<Day>('timesheetDays')[id]).filter((d): d is Day => d !== undefined);
    const res = BulkApproved.parse((await bulk(await as('manager'), ids, queueChecksum(recs))).body);
    expect(res.approved.map(d => d.id)).toEqual([ok]);
    expect(res.held.map(h => [h.id, h.code])).toEqual([[own, 'SELF_APPROVAL'], [out, 'scope']]);
    expect(day('CP-1001', '2026-08-12')?.state).toBe('pend');
  });
  test('an employee cannot bulk approve', async () => {
    expect((await bulk(await as('employee'), ['tsd_CP-1042_2026-08-12'], 'x')).status).toBe(403);
  });
});

describe('GET and PATCH /api/v1/timesheet-config', () => {
  const read = async (call: Call) => TimesheetSetup.parse((await call('GET', '/api/v1/timesheet-config')).body);
  test('an administrator reads the setup, which carries no money', async () => {
    const s = await read(await as('admin'));
    expect(Object.keys(s.config.types).sort()).toEqual(['casual', 'salaried', 'shift']);
    expect(s.fields.length).toBeGreaterThan(40);
    expect(JSON.stringify(s)).not.toMatch(/[£$€]/);
  });
  test('a manager without mod_cfg is refused', async () => {
    expect((await (await as('manager'))('GET', '/api/v1/timesheet-config')).status).toBe(403);
  });
  test('a save applies at once, writes one audit row with before and after, and the next save is checked against it', async () => {
    const admin = await as('admin'), { config } = await read(admin);
    const r = await admin('PATCH', '/api/v1/timesheet-config', { rules: { maxDaily: 8, warnDaily: 7 } }, config.version);
    const { record, auditId } = mutation(TimesheetConfig).parse(r.body);
    expect(record).toMatchObject({ version: config.version + 1, rules: { maxDaily: 8, warnDaily: 7, minNet: 0.25 } });
    expect(audits().find(a => a.id === auditId)).toMatchObject({ act: 'Timesheet setup saved', before: { rules: { maxDaily: 16, warnDaily: 10 } }, after: { rules: { maxDaily: 8, warnDaily: 7 } } });
    const day9 = await put(await as('employee'), 'CP-1042', '2026-08-13', shiftDay('07:00', '16:30', [['12:00', '12:30']]));
    expect(refusal(day9)).toMatchObject({ code: 'TS_INVALID', message: 'Net time is 9h 00m, above the 8-hour daily maximum.' });
  });
  test('an unchanged save writes no audit row', async () => {
    const admin = await as('admin'), { config } = await read(admin), rows = audits().length;
    const r = await admin('PATCH', '/api/v1/timesheet-config', { weekLayout: config.weekLayout }, config.version);
    expect(mutation(TimesheetConfig).parse(r.body).auditId).toBeNull();
    expect(audits()).toHaveLength(rows);
  });
  test('a rule the capture checks could not run on is refused naming the field', async () => {
    const admin = await as('admin'), { config } = await read(admin), before = snapshot(...WRITES);
    const r = await admin('PATCH', '/api/v1/timesheet-config', { rules: { warnDaily: 20 } }, config.version);
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ field: 'rules.warnDaily' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('an allowance sent with an amount is refused, never stored', async () => {
    const admin = await as('admin'), { config } = await read(admin);
    const r = await admin('PATCH', '/api/v1/timesheet-config', { allowances: { ...config.allowances, X: { code: 'X', label: 'X', payCode: 'X', tier: 'core', amount: '£5' } } }, config.version);
    expect(r.status).toBe(422);
  });
  test('a stale version is refused with 412', async () => {
    const admin = await as('admin'), { config } = await read(admin);
    expect((await admin('PATCH', '/api/v1/timesheet-config', { weekLayout: 'grid' }, config.version + 1)).status).toBe(412);
  });
});

describe('a fault on each write leaves no record and no audit row (Review Focus 6)', () => {
  const writes: [string, Persona, string, string, unknown, number | undefined][] = [
    ['save a day', 'employee', 'PUT', '/api/v1/timesheets/CP-1042/days/2026-08-13', shiftDay(), 0],
    ['submit a day', 'employee', 'POST', '/api/v1/timesheets/CP-1042/days/2026-08-13/submit', shiftDay(), 0],
    ['submit a week', 'employee', 'POST', '/api/v1/timesheets/CP-1042/weeks/2026-08-10/submit', { days: [{ date: '2026-08-13', version: 0, ...shiftDay() }] }, undefined],
    ['submit earlier weeks', 'employee', 'POST', '/api/v1/timesheets/CP-1042/multiweek/submit', { weeks: ['2026-08-03'] }, undefined],
    ['approve a day', 'manager', 'POST', '/api/v1/timesheet-days/tsd_CP-1042_2026-08-12/transition', { to: 'ok', reason: '' }, 1],
    ['bulk approve', 'manager', 'POST', '/api/v1/approvals/timesheets/bulk', { ids: ['tsd_CP-1042_2026-08-12'], checksum: 'x' }, undefined],
    ['save the setup', 'admin', 'PATCH', '/api/v1/timesheet-config', { weekLayout: 'grid' }, 1],
    ['retry a posting', 'admin', 'POST', '/api/v1/integration/attempts/int_a1f3/retry', undefined, 1],
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
});
