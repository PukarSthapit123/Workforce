import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { MyHours, TeamHours, TeamHoursExported } from '@/contract/hours';
import { HOURS_CSV_HEADER } from '@/domain/hours';
import { audits, caller, resetTo, tokenFor, type Persona } from '@/test/api-helpers';

/* social at the frozen clock (Thursday 13/08/2026), the published week of
   10 August at Willow House (WH). Amara Okafor (CP-1042, the employee) is
   on Early, Early, rest, Night, Night: 33h against 37.5h contracted, and has
   7.5h on Wednesday, awaiting approval. Ellie Warren (CP-1310) is bank, on
   one Early. Rachel Hussain (CP-1001) manages WH; the administrator holds
   neither own_hours nor team_hours. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

const as = async (p: Persona) => caller(await tokenFor(p));
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const exports = () => audits().filter(a => a.act === 'Export');
const setModule = (k: string, on: boolean) => { const t = store.coll<{ modules: Record<string, boolean> }>('tenant').tenant; if (t) t.modules[k] = on; };

describe('My hours (own_hours)', () => {
  test('the reader\'s own week: contracted, rota\'d and worked, the flags, and each day against the rota', async () => {
    const r = await (await as('employee'))('GET', '/api/v1/hours/me');
    expect(r.status).toBe(200);
    const h = MyHours.parse(r.body);
    expect([h.person.code, h.weekStart, h.rota]).toEqual(['CP-1042', '2026-08-10', true]);
    expect([h.position.con, h.position.rot, h.position.wk, h.position.rotaVar, h.position.schedVar]).toEqual([37.5, 33, 7.5, -4.5, -25.5]);
    expect(h.position.flags.map(f => f.k)).toEqual(['Under contracted', '2 nights']);
    expect(h.days.map(d => [d.code, d.scheduled, d.worked, d.variance, d.status.kind])).toEqual([
      ['E', 7.5, 0, -7.5, 'missing'], ['E', 7.5, 0, -7.5, 'missing'], ['', 0, 7.5, 7.5, 'recorded'], ['N', 9, 0, -9, 'missing'],
      ['N', 9, 0, -9, 'upcoming'], ['', 0, 0, null, 'rest'], ['', 0, 0, null, 'rest']]);
    expect(h.days[2]?.status).toEqual({ kind: 'recorded', state: 'pend' });
    expect(h.days[0]?.line).toBe('Early · 07:00–15:00');
  });
  test('it is only ever the reader\'s own: the manager reads theirs, and a session without own_hours is refused', async () => {
    const mine = MyHours.parse((await (await as('manager'))('GET', '/api/v1/hours/me')).body);
    expect(mine.person.code).toBe('CP-1001');
    const r = await (await as('admin'))('GET', '/api/v1/hours/me');
    expect(r.status).toBe(403);
    expect(refusal(r)).toMatchObject({ code: 'capability', next: expect.any(String) });
  });
  test('with the Rota module off there is no rota\'d figure and no flag that reads one', async () => {
    setModule('R', false);
    const h = MyHours.parse((await (await as('employee'))('GET', '/api/v1/hours/me')).body);
    expect([h.rota, h.position.rot, h.position.wk, h.position.flags]).toEqual([false, 0, 7.5, []]);
    expect(h.days.every(d => d.code === '' && d.variance === null)).toBe(true);
  });
});

describe('Team hours (team_hours, in location scope)', () => {
  test('the manager\'s own location by default: a row per colleague on the week\'s roster, a bank worker among them', async () => {
    const r = await (await as('manager'))('GET', '/api/v1/hours/team');
    expect(r.status).toBe(200);
    const t = TeamHours.parse(r.body);
    expect([t.location, t.locations, t.weekStart]).toEqual([{ code: 'WH', name: 'Willow House' }, [{ code: 'WH', name: 'Willow House' }], '2026-08-10']);
    expect(t.rows.map(x => x.personCode)).toEqual(['CP-1042', 'CP-1088', 'CP-1153', 'CP-1201', 'CP-1266', 'CP-1402', 'CP-1310', 'CP-1001', 'CP-1501', 'CP-1502']);
    const ellie = t.rows.find(x => x.personCode === 'CP-1310');
    expect(ellie).toMatchObject({ category: 'Bank', contractedHours: 0, position: { con: 0, rot: 7.5, wk: 0, flags: [] } });
    expect(t.rows.find(x => x.personCode === 'CP-1042')?.position.flags.map(f => f.k)).toEqual(['Under contracted', '2 nights']);
  });
  test('a location outside the manager\'s scope is refused with scope, and an unknown one is not found', async () => {
    const call = await as('manager');
    const out = await call('GET', '/api/v1/hours/team?location=FS');
    expect(out.status).toBe(403);
    expect(refusal(out)).toEqual({ code: 'scope', message: 'You can see hours at Willow House only.', next: 'Ask an administrator if you need hours at another location.' });
    const gone = await call('GET', '/api/v1/hours/team?location=NOPE');
    expect([gone.status, refusal(gone).code]).toEqual([404, 'not-found']);
  });
  test('a session without team_hours is refused', async () => {
    const r = await (await as('employee'))('GET', '/api/v1/hours/team');
    expect([r.status, refusal(r).code]).toEqual([403, 'capability']);
  });
});

describe('the Team hours export', () => {
  test('the file\'s rows, hours only, with the true count, and one audit row', async () => {
    const r = await (await as('manager'))('POST', '/api/v1/hours/team/export', { location: 'WH' });
    expect(r.status).toBe(200);
    const x = TeamHoursExported.parse(r.body);
    expect([x.fileName, x.count, x.rows.length]).toEqual(['qnipay-hours-position-WH-10-08-2026.csv', 10, 11]);
    expect(x.rows[0]).toEqual([...HOURS_CSV_HEADER]);
    expect(x.rows[1]).toEqual(['CP-1042', 'Amara Okafor', 'Willow House', 'Support Worker', 37.5, 33, 7.5, -4.5, -30, 'Under contracted; 2 nights']);
    expect(x.rows.find(row => row[0] === 'CP-1310')?.slice(4, 9)).toEqual(['Bank', 7.5, 0, '', '']);
    expect(exports()).toEqual([expect.objectContaining({ id: x.auditId, entity: 'hours', entityId: x.fileName,
      who: expect.objectContaining({ personCode: 'CP-1001' }), after: { location: 'WH', weekStart: '2026-08-10', rows: 10 } })]);
  });
  test('refused without team_hours or outside scope, and a refusal writes no audit row', async () => {
    const emp = await (await as('employee'))('POST', '/api/v1/hours/team/export', { location: 'WH' });
    expect([emp.status, refusal(emp).code]).toEqual([403, 'capability']);
    const out = await (await as('manager'))('POST', '/api/v1/hours/team/export', { location: 'FS' });
    expect([out.status, refusal(out).code]).toEqual([403, 'scope']);
    expect(exports()).toEqual([]);
  });
});
