import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { ClockMoved, MyClock } from '@/contract/clock';
import { ApprovalQueue, TimesheetWeek } from '@/contract/timesheets';
import { BREAK_LIMIT, BREAKS_OFF, CLOCK_OFF, NOT_CLOCKED_IN, NOT_ON_BREAK, ALREADY_IN } from '@/domain/clock';
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
const MARCUS = 'marcus.reilly@brightpath.org';
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const WRITES = ['clockRecords', 'timesheetDays', 'notifications', 'audit'];
/* London is on BST in August: 07:02 on the clock every rule reads is 06:02Z. */
const london = (hms: string, date = '2026-08-13') => {
  const [h = 0, m = 0, s = 0] = hms.split(':').map(Number), [y = 0, mo = 0, d = 0] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 1, m, s)).toISOString();
};
const at = (hms: string, date?: string) => store.setClock(london(hms, date));
const mine = async (call: Call) => MyClock.parse((await call('GET', '/api/v1/clock/me')).body);
const move = async (call: Call, path: 'in' | 'break/start' | 'break/end' | 'out', v?: number) =>
  call('POST', `/api/v1/clock/${path}`, undefined, v ?? (await mine(call)).version);
const moved = (r: { status: number; body: unknown }) => { expect(r.status).toBe(200); return ClockMoved.parse(r.body); };
const clockAudits = () => audits().filter(a => a.entity === 'clockRecord').map(a => a.act);
interface Day { state: string; captureSource: string; entries: { start: string; finish: string; breaks: { start: string; end: string }[] }[]; shift: string }
const day = (code: string, date: string) => store.coll<Day>('timesheetDays')[`tsd_${code}_${date}`];
interface Note { id: string; personId: string; title: string; body: string; event?: string }
const notes = () => Object.values(store.coll<Note>('notifications')).filter(n => !n.id.startsWith('ntf_seed_'));
const tenantRec = () => { const t = store.coll<{ modules: Record<string, boolean>; flags: Record<string, boolean>; extras: { breaksMax: number } }>('tenant').tenant; if (!t) throw new Error('no tenant'); return t; };
/* A clock left running on an earlier day, planted straight into the store. */
function plantOpen(code: string, date: string, inAt = '07:02') {
  const id = `clk_${code}_${date}`;
  store.coll('clockRecords')[id] = { id, version: 1, updatedAt: london(inAt, date), personCode: code, date, events: [{ kind: 'in', at: london(inAt, date) }], late: false, closedLate: null };
}

describe('a day on the clock (D1, D2, D3)', () => {
  test('clock in, a break, clock out: server times, the state from the events, the draft day through the day save, one audit row per event', async () => {
    const call = await as('employee');
    at('07:02:00');
    const before = await mine(call);
    expect(before).toMatchObject({ current: null, version: 0, open: null, status: 'Ready to start. Tap Clock in when you begin your shift.',
      gates: { live: true, mode: 'clock', blocked: null, show: true, breaks: true, breaksMax: 5 }, rota: { code: 'N', from: '22:00' }, targetHours: 9 });
    const a = moved(await move(call, 'in'));
    expect(a.toast).toBe('Clocked in. Start time 07:02.');
    expect(a.record).toMatchObject({ state: 'running', version: 1, late: false, events: [{ kind: 'in', at: london('07:02') }] });
    at('10:00:00'); expect(moved(await move(call, 'break/start')).toast).toBe('On break. Timer paused.');
    at('10:30:00'); expect(moved(await move(call, 'break/end')).toast).toBe('Break ended and added to your breaks.');
    at('15:00:12');
    expect((await mine(call)).current).toMatchObject({ state: 'running', elapsedSeconds: 7 * 3600 + 28 * 60 + 12 });
    const out = moved(await move(call, 'out'));
    expect(out.toast).toBe('Clocked out and saved as a draft. 7:28:12. Not submitted yet.');
    expect(out.record.state).toBe('clockedOut');
    expect(out.day).toMatchObject({ state: 'draft', captureSource: 'clock', shift: 'N', entries: [{ start: '07:02', finish: '15:00', breaks: [{ start: '10:00', end: '10:30' }] }] });
    expect(clockAudits()).toEqual(['Clocked in', 'Break started', 'Break ended', 'Clocked out']);
    expect((await mine(call)).status).toBe('Clocked out and saved as a draft. Save or submit the day below.');
    /* Clock in again: a new span; the finish moves to the last clock out */
    at('16:00:00'); moved(await move(call, 'in'));
    at('17:00:00'); const again = moved(await move(call, 'out'));
    /* the gap between the spans is unpaid: a break pair, so the net hours leave it out as the timer does (ruling) */
    expect(again.day?.entries[0]).toMatchObject({ start: '07:02', finish: '17:00', breaks: [{ start: '10:00', end: '10:30' }, { start: '15:00', end: '16:00' }] });
    expect(again.record.elapsedSeconds).toBe(7 * 3600 + 28 * 60 + 12 + 3600);
    expect(day('CP-1042', '2026-08-13')?.captureSource).toBe('clock');
  });
  test('clock out on a break ends the break first', async () => {
    const call = await as('employee');
    at('07:00:00'); await move(call, 'in');
    at('11:00:00'); await move(call, 'break/start');
    at('15:00:00');
    const out = moved(await move(call, 'out'));
    expect(out.record.events.map(e => e.kind)).toEqual(['in', 'breakStart', 'breakEnd', 'out']);
    expect(out.day?.entries[0]?.breaks).toEqual([{ start: '11:00', end: '15:00' }]);
  });
  test('a night shift running past midnight is still the current clock, and writes the day it started (D6)', async () => {
    const call = await as('employee');
    at('21:58:00'); await move(call, 'in');
    at('07:00:00', '2026-08-14');
    const now = await mine(call);
    expect(now.open).toBeNull();
    expect(now.current).toMatchObject({ date: '2026-08-13', state: 'running' });
    const out = moved(await move(call, 'out'));
    expect(out.day).toMatchObject({ date: '2026-08-13', entries: [{ start: '21:58', finish: '07:00' }] });
  });
});

describe('own only and the gates (Review Focus 1, D4)', () => {
  test('nobody reaches another person\'s clock: every path is the caller\'s own, and a close for a day only someone else has is 404', async () => {
    plantOpen('CP-1088', '2026-08-11');
    const amara = await as('employee'), before = snapshot(...WRITES);
    expect((await mine(amara)).open).toBeNull();
    const r = await amara('POST', '/api/v1/clock/2026-08-11/close', { finish: '15:00' }, 1);
    expect(r.status).toBe(404);
    expect(refusal(r)).toMatchObject({ code: 'not-found', message: 'You have no clock on Tue 11 Aug.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('without own_ts, the clock is refused', async () => {
    const admin = await as('admin');
    expect(refusal(await admin('GET', '/api/v1/clock/me')).code).toBe('capability');
    expect((await admin('POST', '/api/v1/clock/in', undefined, 0)).status).toBe(403);
  });
  test('Clock in / out off: the gate says so and every move is refused', async () => {
    const call = await as('employee');
    tenantRec().modules.B = false;
    expect((await mine(call)).gates).toMatchObject({ live: false, show: false });
    const r = await move(call, 'in', 0);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject(CLOCK_OFF);
    expect(store.coll('clockRecords')).toEqual({});
  });
  test('a type that does not enter by clock is refused', async () => {
    const manager = await as('manager');
    expect((await mine(manager)).gates).toMatchObject({ mode: 'grid', show: false });
    const r = await move(manager, 'in', 0);
    expect(refusal(r)).toMatchObject({ code: 'NOT_CLOCK_TYPE', message: 'Service Manager records time on the day form, not the clock.' });
  });
  test('a submitted day is blocked with module 2\'s refusal', async () => {
    const call = await as('employee');
    at('08:00:00', '2026-08-12');
    const g = (await mine(call)).gates;
    expect(g).toMatchObject({ show: false, blocked: { code: 'ALREADY_SUBMITTED' } });
    const r = await move(call, 'in', 0);
    expect(r.status).toBe(409);
    expect(refusal(r).code).toBe('ALREADY_SUBMITTED');
    expect(store.coll('clockRecords')).toEqual({});
  });
  test('an absence day is blocked with module 4\'s refusal unless the day is marked worked anyway', async () => {
    const marcus = await asEmail(MARCUS);
    at('08:00:00', '2026-08-11');
    const r = await move(marcus, 'in', 0);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'ABSENCE_BLOCKED', message: expect.stringContaining('Annual leave is recorded for this day.') });
    const id = 'tsd_CP-1088_2026-08-11';
    store.coll('timesheetDays')[id] = { ...store.coll<Record<string, unknown>>('timesheetDays')['tsd_CP-1042_2026-08-03'], id, personCode: 'CP-1088', date: '2026-08-11', entries: [], nonWorkingReason: 'Called in', workedAnyway: true };
    expect((await mine(marcus)).gates.blocked).toBeNull();
    moved(await move(marcus, 'in', 0));
  });
});

describe('moves, versions and the break cap (Review Focus 2, D2)', () => {
  test('an illegal move is 409 with a plain sentence and writes nothing', async () => {
    const call = await as('employee');
    for (const [path, problem] of [['out', NOT_CLOCKED_IN], ['break/start', NOT_CLOCKED_IN], ['break/end', NOT_ON_BREAK]] as const) {
      const r = await move(call, path, 0);
      expect(r.status).toBe(409);
      expect(refusal(r)).toMatchObject(problem);
    }
    await move(call, 'in');
    const before = snapshot(...WRITES);
    expect(refusal(await move(call, 'in'))).toMatchObject(ALREADY_IN);
    expect(refusal(await move(call, 'break/end'))).toMatchObject(NOT_ON_BREAK);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('If-Match on every event: missing is 428, stale is 412', async () => {
    const call = await as('employee');
    expect((await call('POST', '/api/v1/clock/in')).status).toBe(428);
    await move(call, 'in', 0);
    const r = await move(call, 'break/start', 0);
    expect(r.status).toBe(412);
    expect(refusal(r).code).toBe('stale');
    expect((await mine(call)).current?.events).toHaveLength(1);
  });
  test('a break is refused while Break tracking is off, and beyond the breaks a day allows', async () => {
    const call = await as('employee');
    at('07:00:00'); await move(call, 'in');
    tenantRec().flags.BREAKS = false;
    expect((await mine(call)).gates.breaks).toBe(false);
    expect(refusal(await move(call, 'break/start'))).toMatchObject(BREAKS_OFF);
    tenantRec().flags.BREAKS = true;
    tenantRec().extras.breaksMax = 1;
    at('10:00:00'); await move(call, 'break/start');
    at('10:15:00'); await move(call, 'break/end');
    at('12:00:00');
    const r = await move(call, 'break/start');
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'BREAK_LIMIT', message: BREAK_LIMIT.message });
  });
  test('with no break pair left, Clock in again is refused with the break-limit sentence and nothing is written (ruling)', async () => {
    const call = await as('employee');
    tenantRec().extras.breaksMax = 1;
    at('07:00:00'); await move(call, 'in');
    at('10:00:00'); await move(call, 'break/start');
    at('10:15:00'); await move(call, 'break/end');
    at('12:00:00'); moved(await move(call, 'out'));
    at('13:00:00');
    const before = snapshot(...WRITES), r = await move(call, 'in');
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'BREAK_LIMIT', message: BREAK_LIMIT.message, next: BREAK_LIMIT.next });
    expect(snapshot(...WRITES)).toEqual(before);
  });
});

describe('clock out goes through the day save (Review Focus 3, D3)', () => {
  test('a finish past the daily maximum is refused with module 2\'s sentence, and nothing is written', async () => {
    const call = await as('employee');
    at('06:00:00'); await move(call, 'in');
    at('22:30:00');
    const before = snapshot(...WRITES);
    const r = await move(call, 'out');
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ code: 'TS_INVALID', field: 'entries.0.finish', message: 'Net time is 16h 30m, above the 16-hour daily maximum.' });
    expect(snapshot(...WRITES)).toEqual(before);
    expect((await mine(call)).current?.state).toBe('running');
  });
  test('the day keeps what the person changed on the form, the clock fills the first empty break pair (the gap before Clock in again first), and a submitted day refuses the clock', async () => {
    const call = await as('employee');
    at('07:00:00'); await move(call, 'in');
    at('10:00:00'); await move(call, 'break/start');
    at('10:20:00'); await move(call, 'break/end');
    at('15:00:00');
    const first = moved(await move(call, 'out'));
    /* the person corrects the day on the form: a typed break, an empty pair, a note and the shift */
    const edited = await call('PUT', '/api/v1/timesheets/CP-1042/days/2026-08-13', { shift: 'E', entries: [{ start: '07:00', finish: '15:00',
      breaks: [{ start: '09:00', end: '09:10' }, { start: '', end: '' }, { start: '10:00', end: '10:20' }], fields: { notes: 'Ward 3' } }] }, first.day?.version);
    expect(edited.status).toBe(200);
    at('16:00:00'); await move(call, 'in');
    at('16:30:00'); await move(call, 'break/start');
    at('16:45:00'); await move(call, 'break/end');
    at('18:00:00');
    const out = moved(await move(call, 'out'));
    expect(out.day).toMatchObject({ shift: 'E', captureSource: 'clock', entries: [{ start: '07:00', finish: '18:00', fields: { notes: 'Ward 3' },
      breaks: [{ start: '09:00', end: '09:10' }, { start: '15:00', end: '16:00' }, { start: '10:00', end: '10:20' }, { start: '16:30', end: '16:45' }] }] });
    const submitted = await call('POST', '/api/v1/timesheets/CP-1042/days/2026-08-13/submit', { entries: out.day?.entries ?? [], shift: 'E' }, out.day?.version);
    expect(submitted.status).toBe(200);
    at('19:00:00');
    expect(refusal(await move(call, 'in')).code).toBe('ALREADY_SUBMITTED');
  });
});

describe('clock out writes only what the clock owns since its last write (review I4)', () => {
  /* clock in 07:10, a clocked break 10:00-10:15, out 12:00; the person edits the day; clock in again 13:00, out 17:00 */
  async function editedThenAgain(edit: { start: string; breaks: { start: string; end: string }[] }) {
    const call = await as('employee');
    at('07:10:00'); await move(call, 'in');
    at('10:00:00'); await move(call, 'break/start');
    at('10:15:00'); await move(call, 'break/end');
    at('12:00:00');
    const first = moved(await move(call, 'out'));
    const saved = await call('PUT', '/api/v1/timesheets/CP-1042/days/2026-08-13', { shift: 'N', entries: [{ start: edit.start, finish: '12:00', breaks: edit.breaks }] }, first.day?.version);
    expect(saved.status).toBe(200);
    at('13:00:00'); moved(await move(call, 'in'));
    at('17:00:00');
    return move(call, 'out');
  }
  test('a corrected start is not reverted (S5)', async () => {
    const out = moved(await editedThenAgain({ start: '07:00', breaks: [{ start: '10:00', end: '10:15' }] }));
    expect(out.day?.entries[0]).toMatchObject({ start: '07:00', finish: '17:00', breaks: [{ start: '10:00', end: '10:15' }, { start: '12:00', end: '13:00' }] });
  });
  test('a deleted clocked break is not added back (S6)', async () => {
    const out = moved(await editedThenAgain({ start: '07:10', breaks: [] }));
    expect(out.day?.entries[0]).toMatchObject({ start: '07:10', finish: '17:00', breaks: [{ start: '12:00', end: '13:00' }] });
  });
  test('a widened clocked break stays as widened, and clock out is not refused for an overlap (S2)', async () => {
    const out = moved(await editedThenAgain({ start: '07:10', breaks: [{ start: '10:00', end: '10:20' }] }));
    expect(out.day?.entries[0]?.breaks).toEqual([{ start: '10:00', end: '10:20' }, { start: '12:00', end: '13:00' }]);
    expect(out.record.state).toBe('clockedOut');
  });
});

describe('late and forgotten (Review Focus 4, D5, D6)', () => {
  test('a first clock in after the rota line start is late: the record is flagged and ts_late reaches the person and their line manager', async () => {
    const marcus = await asEmail(MARCUS);
    at('14:31:00');
    const a = moved(await move(marcus, 'in', 0));
    expect(a.record.late).toBe(true);
    expect(notes().map(n => [n.personId, n.event, n.title, n.body])).toEqual([
      ['CP-1088', 'ts_late', 'Late clock-in', 'You clocked in at 14:31 on Thu 13 Aug. Your shift started at 14:30.'],
      ['CP-1001', 'ts_late', 'Late clock-in', 'Marcus Reilly clocked in at 14:31 on Thu 13 Aug. The shift started at 14:30.'],
    ]);
    /* clocking in again is not checked again */
    at('16:00:00'); const out = moved(await move(marcus, 'out'));
    at('16:30:00'); await move(marcus, 'in');
    expect(notes()).toHaveLength(2);
    /* the day and the team queue carry the mark for the Late pill */
    const week = TimesheetWeek.parse((await marcus('GET', '/api/v1/timesheets/CP-1088/weeks/2026-08-10')).body);
    expect(week.days[3]?.clock).toEqual({ late: true, closedLate: false });
    expect(week.days[2]?.clock).toBeUndefined();
    await marcus('POST', '/api/v1/timesheets/CP-1088/days/2026-08-13/submit', { entries: out.day?.entries ?? [], shift: 'L' }, out.day?.version);
    const queue = ApprovalQueue.parse((await (await as('manager'))('GET', '/api/v1/approvals/timesheets?status=pend')).body);
    expect(queue.rows.find(r => r.id === 'tsd_CP-1088_2026-08-13')?.clock).toEqual({ late: true, closedLate: false });
  });
  test('on time, or with no rota line, nothing is late', async () => {
    const marcus = await asEmail(MARCUS);
    at('14:30:59');
    expect(moved(await move(marcus, 'in', 0)).record.late).toBe(false);
    tenantRec().modules.R = false;
    const amara = await as('employee');
    at('23:00:00');
    expect(moved(await move(amara, 'in', 0)).record.late).toBe(false);
    expect(notes()).toEqual([]);
  });
  test('a clock left open on an earlier day blocks a new one until it is closed with a finish, which writes that day', async () => {
    plantOpen('CP-1042', '2026-08-11');
    const call = await as('employee');
    const g = await mine(call);
    expect(g.open).toMatchObject({ date: '2026-08-11', state: 'running', label: 'Tue 11 Aug' });
    const r = await move(call, 'in', 0);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'CLOCK_OPEN', message: 'Close the clock from Tue 11 Aug first.' });
    const bad = await call('POST', '/api/v1/clock/2026-08-11/close', { finish: '25:00' }, 1);
    expect(bad.status).toBe(422);
    expect(refusal(bad)).toMatchObject({ code: 'TS_INVALID', field: 'finish', message: 'Finish time must be a 24-hour time such as 15:00.' });
    const c = moved(await call('POST', '/api/v1/clock/2026-08-11/close', { finish: '15:00' }, 1));
    expect(c.toast).toBe('The clock from Tue 11 Aug is closed and the day saved as a draft. Not submitted yet.');
    expect(c.record).toMatchObject({ state: 'clockedOut', closedLate: { finish: '15:00' } });
    expect(day('CP-1042', '2026-08-11')).toMatchObject({ state: 'draft', captureSource: 'clock', shift: 'E', entries: [{ start: '07:02', finish: '15:00' }] });
    expect(clockAudits()).toEqual(['Forgotten clock closed']);
    const week = TimesheetWeek.parse((await call('GET', '/api/v1/timesheets/CP-1042/weeks/2026-08-10')).body);
    expect(week.days[1]?.clock).toEqual({ late: false, closedLate: true });
    expect((await mine(call)).open).toBeNull();
    moved(await move(call, 'in', 0));
  });
  test('closing a day in a closed pay period is refused with the lock note, and the clock stays open', async () => {
    plantOpen('CP-1042', '2026-08-07');
    at('13:00:00', '2026-08-17');
    const call = await as('employee'), before = snapshot(...WRITES);
    const r = await call('POST', '/api/v1/clock/2026-08-07/close', { finish: '15:00' }, 1);
    expect(r.status).toBe(409);
    expect(refusal(r).code).toBe('PERIOD_LOCKED');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a clock still within the day is not forgotten, so it cannot be closed', async () => {
    const call = await as('employee');
    at('07:00:00'); await move(call, 'in');
    const r = await call('POST', '/api/v1/clock/2026-08-13/close', { finish: '15:00' }, 1);
    expect(refusal(r)).toMatchObject({ code: 'CLOCK_MOVE', message: 'This clock is still running.' });
  });
});

describe('a fault on each write leaves nothing behind (Review Focus 5)', () => {
  const ready: Record<string, (call: Call) => Promise<number>> = {
    in: async () => { at('14:31:00'); return 0; },
    'break/start': async call => { at('14:31:00'); await move(call, 'in', 0); at('15:00:00'); return 1; },
    'break/end': async call => { at('14:31:00'); await move(call, 'in', 0); at('15:00:00'); await move(call, 'break/start', 1); at('15:20:00'); return 2; },
    out: async call => { at('14:31:00'); await move(call, 'in', 0); at('20:00:00'); return 1; },
  };
  for (const [path, prepare] of Object.entries(ready)) {
    test(`${path}: an injected fault, then a throw after every write`, async () => {
      const marcus = await asEmail(MARCUS), v = await prepare(marcus);
      const before = snapshot(...WRITES);
      await fault('POST', `/api/v1/clock/${path}`);
      const r = await marcus('POST', `/api/v1/clock/${path}`, undefined, v);
      expect(r.status).toBe(500);
      expect(refusal(r).code).toBe('fault');
      expect(snapshot(...WRITES)).toEqual(before);
      store.db.audit = Object.freeze({ ...store.db.audit });
      const t = await marcus('POST', `/api/v1/clock/${path}`, undefined, v);
      expect(t.status).toBe(500);
      store.db.audit = { ...store.db.audit };
      expect(snapshot(...WRITES)).toEqual(before);
    });
  }
  test('close: an injected fault, then a throw after the day is written', async () => {
    plantOpen('CP-1042', '2026-08-11');
    const call = await as('employee'), before = snapshot(...WRITES);
    await fault('POST', '/api/v1/clock/2026-08-11/close');
    expect((await call('POST', '/api/v1/clock/2026-08-11/close', { finish: '15:00' }, 1)).status).toBe(500);
    store.db.audit = Object.freeze({ ...store.db.audit });
    expect((await call('POST', '/api/v1/clock/2026-08-11/close', { finish: '15:00' }, 1)).status).toBe(500);
    store.db.audit = { ...store.db.audit };
    expect(snapshot(...WRITES)).toEqual(before);
  });
});
