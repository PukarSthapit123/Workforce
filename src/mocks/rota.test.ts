import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import {
  CellSaved, CellSuggestions, CoverBoard, CoverFilled, CoverSaved, FilledConfirmed, MyShifts, PatternGenerated, PatternList, PlanAccepted,
  RotaHome, RotaSetup, RotaWeekView, ShiftCatalogue, WeekCleared, WeekCopied, WeekMoved, WeekPlan, WeekRepeated,
} from '@/contract/rota';
import { DaySaved } from '@/contract/timesheets';
import { FROZEN, accountOf, audits, caller, fault, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

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
const WRITES = ['rotaWeeks', 'coverRequests', 'filledShifts', 'itRequests', 'notifications', 'shiftTypes', 'patterns', 'rotaConfig', 'audit'];
const WH = '/api/v1/rota/weeks/WH/2026-08-10', NEXT = '/api/v1/rota/weeks/WH/2026-08-17';
interface Week { id: string; version: number; state: string; publishVersion: number; lines: Record<string, string[]>; changes: { afterPublish: boolean; version: number; to: string; personCode: string }[] }
const week = (loc: string, ws: string) => store.coll<Week>('rotaWeeks')[`rw_${loc}_${ws}`];
const line = (loc: string, ws: string, code: string) => week(loc, ws)?.lines[code];
interface Note { personId: string; title: string; body: string; area: string; read: boolean }
const notes = (personId?: string) => Object.values(store.coll<Note>('notifications')).filter(n => !personId || n.personId === personId);
/* the rota's own rows: signing in writes one too */
const rotaAudits = () => audits().filter(a => a.act !== 'Signed in');
const auditActs = () => rotaAudits().map(a => a.act);
/* A week planted straight into the store. */
function plant(loc: string, ws: string, lines: Record<string, string[]>, state = 'draft') {
  const id = `rw_${loc}_${ws}`;
  store.coll('rotaWeeks')[id] = { id, version: 1, updatedAt: FROZEN, location: loc, weekStart: ws, lines, state, publishVersion: state === 'draft' ? 0 : 1,
    publishedAt: '', publishedBy: null, changes: [] };
}
const cfg = () => store.coll<Record<string, unknown>>('rotaConfig').rotaConfig ?? {};
const setCfg = (patch: Record<string, unknown>) => { store.coll('rotaConfig').rotaConfig = { ...cfg(), ...patch }; };
const setFlag = (k: string, on: boolean) => {
  const t = store.coll<{ flags: Record<string, boolean> }>('tenant').tenant;
  if (t) t.flags[k] = on;
};
const cell = (call: Call, url: string, body: unknown, v = 1) => call('PUT', `${url}/cells`, body, v);
const ASSIGN_LIVE = { personCode: 'CP-1402', day: 4, code: 'E' };

describe('reading the week', () => {
  test('a manager reads their location\'s week: lines, coverage, gaps, hours and state in one call', async () => {
    const w = RotaWeekView.parse((await (await as('manager'))('GET', WH)).body);
    expect(w).toMatchObject({ id: 'rw_WH_2026-08-10', version: 1, state: 'published', publishVersion: 1, min: 4, gapDays: [4], isoWeek: 33 });
    expect(w.onShift).toEqual([6, 4, 5, 4, 3, 5, 4]);
    expect(w.locations).toEqual([{ code: 'WH', name: 'Willow House' }]);
    const amara = w.rows.find(r => r.personCode === 'CP-1042');
    expect(amara?.line).toEqual(['E', 'E', '', 'N', 'N', '', '']);
    expect(amara?.hours).toMatchObject({ con: 37.5, rot: 33, cap: 45 });
    expect(w.rows.map(r => r.personCode)).not.toContain('CP-1455');
    expect(w.coverage[0]).toMatchObject({ E: 4, L: 1, N: 1 });
  });
  test('a week not stored yet reads as an empty draft at version 0', async () => {
    const w = RotaWeekView.parse((await (await as('manager'))('GET', NEXT)).body);
    expect(w).toMatchObject({ version: 0, state: 'draft', publishVersion: 0, changes: [], gapDays: [0, 1, 2, 3, 4, 5, 6] });
  });
});

describe('scope (Review Focus 1)', () => {
  test('a manager cannot read or write another location\'s week', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await call('GET', '/api/v1/rota/weeks/BC/2026-08-10');
    expect(r.status).toBe(403);
    expect(refusal(r)).toMatchObject({ code: 'scope', message: 'You can manage the rota at Willow House only.' });
    const w = await cell(call, '/api/v1/rota/weeks/BC/2026-08-10', { personCode: 'CP-1288', day: 0, code: 'E' }, 0);
    expect(w.status).toBe(403);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('an employee cannot write the rota', async () => {
    const call = await as('employee'), before = snapshot(...WRITES);
    const r = await cell(call, WH, ASSIGN_LIVE);
    expect(r.status).toBe(403);
    expect(refusal(r).code).toBe('capability');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('Team rota opens on the manager\'s own location and the server\'s week; an employee is refused', async () => {
    const h = RotaHome.parse((await (await as('manager'))('GET', '/api/v1/rota/home')).body);
    expect(h).toEqual({ locations: [{ code: 'WH', name: 'Willow House' }], location: 'WH', today: '2026-08-13', weekStart: '2026-08-10' });
    const e = await (await as('employee'))('GET', '/api/v1/rota/home');
    expect(e.status).toBe(403);
    expect(refusal(e).code).toBe('capability');
  });
  test('an admin with team_rota may pick every active location', async () => {
    const a = Object.values(store.coll<{ personCode: string; grants: string[] }>('accounts')).find(x => x.personCode === accountOf('admin').personCode);
    if (a) a.grants = ['team_rota'];
    const w = RotaWeekView.parse((await (await as('admin'))('GET', '/api/v1/rota/weeks/BC/2026-08-10')).body);
    expect(w.locations.map(l => l.code)).toEqual(['WH', 'BC', 'RL', 'FS', 'LGW', 'SLO', 'MAN']);
  });
  test('a manager cannot open cover or confirm a filled shift at another location, and an employee cannot read cover', async () => {
    const call = await as('manager'), emp = await as('employee'), before = snapshot(...WRITES);
    const o = await call('POST', '/api/v1/rota/cover', { location: 'BC', date: '2026-08-16', shift: 'E', reason: '', urgent: false });
    expect(o.status).toBe(403);
    expect(refusal(o)).toMatchObject({ code: 'scope', message: 'You can manage the rota at Willow House only.' });
    store.coll('filledShifts').fil_9 = { ...store.coll<Record<string, unknown>>('filledShifts').fil_1, id: 'fil_9', location: 'BC' };
    expect((await call('POST', '/api/v1/rota/filled/fil_9/confirm', undefined, 1)).status).toBe(403);
    Reflect.deleteProperty(store.coll('filledShifts'), 'fil_9');
    const e = await emp('GET', '/api/v1/rota/cover');
    expect(e.status).toBe(403);
    expect(refusal(e).code).toBe('capability');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a manager cannot see or change another location\'s patterns or cover', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const list = PatternList.parse((await call('GET', '/api/v1/rota/patterns')).body);
    expect(list.items.map(p => p.code)).toEqual(['WP-01', 'WP-02']);
    const p = await call('PATCH', '/api/v1/rota/patterns/WP-03', { name: 'Mine now' }, 1);
    expect(p.status).toBe(403);
    expect(refusal(p).code).toBe('scope');
    expect((await call('POST', '/api/v1/rota/patterns/WP-03/generate', {}, 1)).status).toBe(403);
    store.coll('coverRequests').cov_9 = { ...store.coll<Record<string, unknown>>('coverRequests').cov_1, id: 'cov_9', location: 'BC' };
    const c = await call('POST', '/api/v1/rota/cover/cov_9/ask-all', undefined, 1);
    expect(c.status).toBe(403);
    expect(CoverBoard.parse((await call('GET', '/api/v1/rota/cover')).body).requests.map(x => x.id)).toEqual(['cov_1', 'cov_2']);
    Reflect.deleteProperty(store.coll('coverRequests'), 'cov_9');
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a manager cannot put another location\'s people or locations on a pattern, by create, update or copy (I1)', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const pats = store.coll<{ people: { personCode: string; offset: number }[]; locations: string[] }>('patterns');
    const wp2 = pats['pat_WP-02']?.people ?? [];
    const outsider = await call('PATCH', '/api/v1/rota/patterns/WP-02', { people: [...wp2, { personCode: 'EMP-2044', offset: 1 }] }, 1);
    expect(outsider.status).toBe(403);
    expect(refusal(outsider)).toMatchObject({ code: 'scope', field: 'people.5.personCode',
      message: 'Adaeze Okafor does not work at Willow House. You can put your own team on a pattern only.' });
    const body = { name: 'Spread', cycle: 7, locations: ['WH', 'LGW'], jobProfiles: [], costCentre: 'WH-CAM-01', starts: '2026-08-17', horizon: 1, gen: '4w' };
    const create = await call('POST', '/api/v1/rota/patterns', body);
    expect(create.status).toBe(403);
    expect(refusal(create)).toMatchObject({ code: 'scope', field: 'locations', message: 'A manager can only build patterns for the location they manage.' });
    const relocate = await call('PATCH', '/api/v1/rota/patterns/WP-01', { locations: ['WH', 'LGW'] }, 1);
    expect(relocate.status).toBe(403);
    expect(refusal(relocate)).toMatchObject({ code: 'scope', field: 'locations' });
    const copy = await call('POST', '/api/v1/rota/patterns', { ...body, locations: ['WH'], base: 'WP-03' });
    expect(copy.status).toBe(403);
    expect(refusal(copy)).toMatchObject({ code: 'scope', field: 'base' });
    expect(snapshot(...WRITES)).toEqual(before);
    /* someone from another location already on a shared pattern stays there */
    const wp1 = store.coll<{ people: { personCode: string; offset: number }[] }>('patterns')['pat_WP-01'];
    if (wp1) wp1.people = [...wp1.people, { personCode: 'CP-1288', offset: 2 }];
    const drop = await call('PATCH', '/api/v1/rota/patterns/WP-01', { people: wp1?.people.filter(x => x.personCode !== 'CP-1288') }, 1);
    expect(drop.status).toBe(403);
    expect(refusal(drop)).toMatchObject({ code: 'scope', message: expect.stringContaining('does not work at Willow House') });
    /* an administrator is not limited to one location */
    const admin = await as('admin');
    expect((await admin('PATCH', '/api/v1/rota/patterns/WP-02', { people: [...wp2, { personCode: 'EMP-2044', offset: 1 }] }, 1)).status).toBe(200);
    expect((await admin('POST', '/api/v1/rota/patterns', { ...body, base: 'WP-03' })).status).toBe(200);
  });
  test('"Admins only" withholds patterns and shift types from managers on the server, not from admins', async () => {
    setCfg({ rotaBuiltBy: 'Admins only' });
    const m = await as('manager');
    const pats = await m('GET', '/api/v1/rota/patterns');
    expect(pats.status).toBe(403);
    expect(refusal(pats)).toMatchObject({ code: 'rota-policy', message: 'Rota setup says only administrators build working patterns.' });
    const sh = await m('POST', '/api/v1/rota/shift-types', { code: 'TW', name: 'Twilight', from: '17:00', to: '23:00', breakMinutes: 0, night: false });
    expect(refusal(sh)).toMatchObject({ code: 'rota-policy', message: 'Rota setup says only administrators build shift types.' });
    expect((await m('GET', WH)).status).toBe(200);
    expect((await (await as('admin'))('GET', '/api/v1/rota/patterns')).status).toBe(200);
  });
  test('claiming is own-only: an open shift at another location is refused', async () => {
    store.coll('coverRequests').cov_9 = { ...store.coll<Record<string, unknown>>('coverRequests').cov_2, id: 'cov_9', location: 'BC' };
    const call = await as('employee'), before = snapshot(...WRITES);
    const r = await call('POST', '/api/v1/rota/cover/cov_9/claim', undefined, 1);
    expect(r.status).toBe(403);
    expect(refusal(r)).toMatchObject({ code: 'scope', message: 'This open shift is not at your location.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('without claim, a claim is refused with the prototype\'s text', async () => {
    const a = Object.values(store.coll<{ personCode: string; revocations: string[] }>('accounts')).find(x => x.personCode === 'CP-1042');
    if (a) a.revocations = ['claim'];
    const r = await (await as('employee'))('POST', '/api/v1/rota/cover/cov_2/claim', undefined, 1);
    expect(r.status).toBe(403);
    expect(refusal(r)).toMatchObject({ code: 'capability', message: 'Claiming open shifts is not permitted for this persona.' });
  });
  test('with Rota off (qnipay) every rota endpoint refuses', async () => {
    resetTo('qnipay');
    const r = await (await as('manager'))('GET', '/api/v1/rota/shift-types');
    expect(r.status).toBe(403);
    expect(refusal(r)).toMatchObject({ code: 'module-off', message: 'Rota is switched off for this organisation.' });
  });
});

describe('week integrity (Review Focus 2)', () => {
  const writes: [string, string, string, unknown][] = [
    ['a cell write', 'PUT', `${WH}/cells`, ASSIGN_LIVE],
    ['a transition', 'POST', `${WH}/transition`, { to: 'published' }],
    ['a copy', 'POST', `${WH}/copy`, undefined],
    ['a repeat', 'POST', `${WH}/repeat`, { weeks: 2 }],
    ['a clear', 'POST', `${WH}/clear`, undefined],
    ['an accepted plan', 'POST', `${WH}/plan/accept`, { items: [ASSIGN_LIVE] }],
  ];
  for (const [what, method, path, body] of writes) {
    test(`${what} on a stale week version is refused with 412 and changes nothing`, async () => {
      const call = await as('manager'), before = snapshot(...WRITES);
      const r = await call(method, path, body, 0);
      expect(r.status).toBe(412);
      expect(refusal(r).code).toBe('stale');
      expect(snapshot(...WRITES)).toEqual(before);
    });
  }
  test('a write without If-Match is refused with 428', async () => {
    const r = await (await as('manager'))('PUT', `${WH}/cells`, ASSIGN_LIVE);
    expect(r.status).toBe(428);
  });
  test('a change to a live week is an amendment: afterPublish, state amendment, the colleague told, one audit row; republishing counts it', async () => {
    const call = await as('manager');
    const r = await cell(call, WH, ASSIGN_LIVE);
    expect(r.status).toBe(200);
    const saved = CellSaved.parse(r.body);
    expect(saved.week).toMatchObject({ state: 'amendment', version: 2 });
    expect(saved.week.changes[0]).toMatchObject({ personCode: 'CP-1402', to: 'E', afterPublish: true, version: 1, why: 'Assigned' });
    expect(audits().filter(a => a.id === saved.auditId).map(a => a.act)).toEqual(['Published rota amended']);
    expect(rotaAudits()).toHaveLength(1);
    expect(notes('CP-1402').map(n => [n.title, n.body])).toEqual([['Rota amended', 'Week 33 · your shift on Fri has changed. Check your shifts.']]);
    const p = WeekMoved.parse((await call('POST', `${WH}/transition`, { to: 'published' }, 2)).body);
    expect(p.week).toMatchObject({ state: 'republished', publishVersion: 2, version: 3 });
    expect(p.summary).toBe('Rota republished · v2 · 10 colleagues notified · 1 amendment(s) included');
    expect(notes('CP-1042').map(n => n.title)).toEqual(['Rota republished']);
  });
  test('a shift on a draft week tells the person with a stored notification row (D8); a removal tells nobody', async () => {
    plant('WH', '2026-08-17', {});
    const call = await as('manager');
    const r = CellSaved.parse((await cell(call, NEXT, { personCode: 'CP-1042', day: 0, code: 'E' })).body);
    expect(r.week).toMatchObject({ state: 'draft', version: 2 });
    expect(r.week.changes[0]).toMatchObject({ afterPublish: false, to: 'E' });
    expect(notes('CP-1042')).toEqual([expect.objectContaining({ personId: 'CP-1042', area: 'Rota', title: 'Shift assigned', read: false })]);
    expect(notes('CP-1042')[0]?.body).toMatch(/^Early on .+ at Willow House$/);
    expect(auditActs()).toEqual(['Shift assigned']);
    const gone = CellSaved.parse((await cell(call, NEXT, { personCode: 'CP-1042', day: 0, code: '' }, 2)).body);
    expect(gone.week.rows.find(x => x.personCode === 'CP-1042')?.line[0]).toBe('');
    expect(notes('CP-1042')).toHaveLength(1);
    expect(auditActs()).toEqual(['Shift assigned', 'Shift removed']);
  });
  test('the state moves exactly as ROTA_STATES says', async () => {
    plant('WH', '2026-08-17', {});
    const call = await as('manager');
    expect(WeekMoved.parse((await call('POST', `${NEXT}/transition`, { to: 'review' }, 1)).body).week.state).toBe('review');
    expect(WeekMoved.parse((await call('POST', `${NEXT}/transition`, { to: 'draft' }, 2)).body).week.state).toBe('draft');
    const r = await call('POST', `${WH}/transition`, { to: 'review' }, 1);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'TRANSITION_NOT_ALLOWED', message: 'A published rota cannot go back to review.' });
    const again = await call('POST', `${WH}/transition`, { to: 'published' }, 1);
    expect(refusal(again)).toMatchObject({ code: 'COVERAGE_GAPS' });
  });
  test('publishing an already-live week with no change is refused with the prototype\'s text', async () => {
    setCfg({ publishBlockOnGap: false });
    const r = await (await as('manager'))('POST', `${WH}/transition`, { to: 'published' }, 1);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'ALREADY_PUBLISHED', message: 'Week 33 is already published at v1. Change a shift first if you need to republish.' });
  });
  test('publish is blocked by gaps while publishBlockOnGap is on, and goes through when it is off (D3)', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await call('POST', `${NEXT}/transition`, { to: 'published' }, 0);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'COVERAGE_GAPS', message: 'Coverage gaps block publishing.' });
    expect(snapshot(...WRITES)).toEqual(before);
    setCfg({ publishBlockOnGap: false });
    const ok = WeekMoved.parse((await call('POST', `${NEXT}/transition`, { to: 'published' }, 0)).body);
    expect(ok.week).toMatchObject({ state: 'published', publishVersion: 1, version: 1 });
    expect(auditActs()).toEqual(['Rota published']);
  });
});

describe('eligibility on the server (Review Focus 3)', () => {
  const refusals: [string, unknown, number, Partial<Refusal>][] = [
    ['a person who is not cleared', { personCode: 'CP-1490', day: 0, code: 'E' }, 422,
      { code: 'ROTA_INELIGIBLE', field: 'lines.CP-1490.0', message: 'Kwame Boateng. Not cleared to work. DBS expired 30/06/2026.' }],
    ['a night shift for someone not night-trained', { personCode: 'CP-1377', day: 2, code: 'N' }, 422,
      { code: 'ROTA_INELIGIBLE', field: 'lines.CP-1377.2', message: 'Tomas Novak. Not night-trained.' }],
    ['a shift on a leave day', { personCode: 'CP-1088', day: 0, code: 'E' }, 409, { code: 'ON_LEAVE', message: 'Marcus Reilly is already down as on leave that day.' }],
    ['the shift already there', { personCode: 'CP-1042', day: 0, code: 'E' }, 409, { code: 'UNCHANGED', message: 'Amara Okafor is already on Early that day.' }],
    ['a code not in the catalogue', { personCode: 'CP-1042', day: 2, code: 'Q' }, 422, { code: 'UNKNOWN_SHIFT', message: 'There is no shift type with the code Q.' }],
    ['a person at another location', { personCode: 'EMP-2044', day: 2, code: 'E' }, 422, { code: 'invalid', field: 'personCode', message: 'Adaeze Okafor does not work at Willow House.' }],
  ];
  for (const [what, body, status, expected] of refusals) {
    test(`${what} is refused and nothing is written`, async () => {
      const call = await as('manager'), before = snapshot(...WRITES);
      const r = await cell(call, WH, body);
      expect(r.status).toBe(status);
      expect(refusal(r)).toMatchObject({ ...expected, next: expect.any(String) });
      expect(snapshot(...WRITES)).toEqual(before);
    });
  }
  test('consecutive days and rest are hard rules with their text', async () => {
    plant('WH', '2026-08-17', { 'CP-1042': ['E', 'E', 'E', 'E', 'E', '', ''], 'CP-1201': ['N', '', '', '', '', '', ''] });
    const call = await as('manager');
    expect(refusal(await cell(call, NEXT, { personCode: 'CP-1042', day: 5, code: 'E' }))).toMatchObject({ message: 'Amara Okafor. Would make 6 days in a row.' });
    expect(refusal(await cell(call, NEXT, { personCode: 'CP-1201', day: 1, code: 'E' }))).toMatchObject({ message: 'Priya Shah. Only 0 hours rest before or after.' });
  });
  test('advisories never block: an assignment over contracted hours saves and says so', async () => {
    const r = await cell(await as('manager'), WH, { personCode: 'CP-1042', day: 2, code: 'L' });
    expect(r.status).toBe(200);
    expect(CellSaved.parse(r.body).advisories).toEqual([{ k: 'Over contracted', c: 'warn' }]);
    expect(line('WH', '2026-08-10', 'CP-1042')).toEqual(['E', 'E', 'L', 'N', 'N', '', '']);
  });
  test('accept plan runs eligibility on every item: one refused item writes none', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await call('POST', `${WH}/plan/accept`, { items: [ASSIGN_LIVE, { personCode: 'CP-1490', day: 4, code: 'E' }] }, 1);
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ code: 'ROTA_INELIGIBLE', field: 'items.1', message: 'Kwame Boateng. Not cleared to work. DBS expired 30/06/2026.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('accept plan writes the suggestions through the week path, with one audit row', async () => {
    const call = await as('manager');
    const plan = WeekPlan.parse((await call('GET', `${WH}/plan`)).body);
    const pick = plan.items.filter(x => !x.none);
    expect(pick.map(x => x.day)).toEqual([4]);
    expect(plan.summary).toBe('Suggested 1 assignments for you to review');
    const saved = PlanAccepted.parse((await call('POST', `${WH}/plan/accept`, { items: pick.map(x => ({ personCode: x.personCode, day: x.day, code: x.code })) }, 1)).body);
    expect(saved.week.gapDays).toEqual([]);
    expect(saved.week.changes[0]).toMatchObject({ afterPublish: true, why: 'Accepted from the plan' });
    expect(auditActs()).toEqual(['Published rota amended']);
  });
  test('cover assign refuses an ineligible person with the rule\'s text', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await call('POST', '/api/v1/rota/cover/cov_1/assign', { personCode: 'CP-1377' }, 1);
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ code: 'ROTA_INELIGIBLE', message: 'Tomas Novak. Not night-trained.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('cover assign never replaces somebody\'s shift that day', async () => {
    const r = await (await as('manager'))('POST', '/api/v1/rota/cover/cov_1/assign', { personCode: 'CP-1042' }, 1);
    expect(refusal(r)).toMatchObject({ code: 'ROTA_INELIGIBLE', message: 'Amara Okafor. Already working that day.' });
  });
  test('a claim by someone ineligible is refused with the claim text', async () => {
    const call = await asEmail('kwame.boateng@brightpath.org'), before = snapshot(...WRITES);
    const r = await call('POST', '/api/v1/rota/cover/cov_2/claim', undefined, 1);
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ code: 'ROTA_INELIGIBLE', message: 'You cannot take that shift. Not cleared to work. DBS expired 30/06/2026.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('suggestions for one cell rank who passed and name the rule for who did not', async () => {
    const s = CellSuggestions.parse((await (await as('manager'))('GET', `${WH}/suggestions?day=4&code=E`)).body);
    expect(s.ok.length).toBeGreaterThan(0);
    expect(s.no.find(x => x.personCode === 'CP-1490')).toMatchObject({ rule: 'Clearance' });
    expect(s.no.find(x => x.personCode === 'CP-1042')).toMatchObject({ rule: 'Shift conflict' });
  });
});

describe('generate, repeat, copy and clear never overwrite (Review Focus 4)', () => {
  test('copy fills only empty cells, leaves leave and filled cells alone, reports true counts, one audit row', async () => {
    plant('WH', '2026-08-17', { 'CP-1042': ['V', 'L', '', '', '', '', ''] });
    const r = WeekCopied.parse((await (await as('manager'))('POST', `${NEXT}/copy`, undefined, 1)).body);
    expect(r).toMatchObject({ written: 29, occupied: 1, absence: 1 });
    expect(r.summary).toBe('29 shift(s) copied from 10/08/2026 · review before publishing · 1 cell(s) already filled, left alone');
    expect(line('WH', '2026-08-17', 'CP-1042')).toEqual(['V', 'L', '', 'N', 'N', '', '']);
    expect(auditActs()).toEqual(['Rota week copied']);
  });
  test('copy onto a live week is refused', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    const r = await call('POST', `${WH}/copy`, undefined, 1);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'WEEK_LIVE', message: 'Week 33 is published. Copying over a live rota would replace published shifts.' });
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('repeat skips published weeks and filled cells, counts each, and writes one audit row', async () => {
    plant('WH', '2026-08-17', { 'CP-1042': ['L', '', '', '', '', '', ''] }, 'published');
    plant('WH', '2026-08-24', { 'CP-1042': ['L', 'S', '', '', '', '', ''] });
    const live = structuredClone(week('WH', '2026-08-17'));
    const r = WeekRepeated.parse((await (await as('manager'))('POST', `${WH}/repeat`, { weeks: 2 }, 1)).body);
    expect(r).toMatchObject({ written: 29, occupied: 1, absence: 1, live: 1, weeks: 1 });
    expect(week('WH', '2026-08-17')).toEqual(live);
    expect(line('WH', '2026-08-24', 'CP-1042')).toEqual(['L', 'S', '', 'N', 'N', '', '']);
    expect(auditActs()).toEqual(['Rota week repeated']);
  });
  test('repeat refuses a length not on the list', async () => {
    const r = await (await as('manager'))('POST', `${WH}/repeat`, { weeks: 3 }, 1);
    expect(refusal(r)).toMatchObject({ code: 'invalid', field: 'weeks', message: 'Choose how many weeks to repeat for from the list.' });
  });
  test('clear refuses a live week and an empty one, and keeps leave on a draft', async () => {
    const call = await as('manager');
    expect(refusal(await call('POST', `${WH}/clear`, undefined, 1))).toMatchObject({ code: 'WEEK_LIVE', message: 'Week 33 is published. Remove shifts individually so each change is recorded.' });
    expect(refusal(await call('POST', `${NEXT}/clear`, undefined, 0))).toMatchObject({ code: 'NOTHING_TO_CLEAR', message: 'Nothing to clear. This week has no shifts at Willow House.' });
    plant('WH', '2026-08-17', { 'CP-1042': ['V', 'E', 'E', '', '', '', ''], 'CP-1402': ['L', '', '', '', '', '', ''] });
    const r = WeekCleared.parse((await call('POST', `${NEXT}/clear`, undefined, 1)).body);
    expect(r.cleared).toBe(3);
    expect(line('WH', '2026-08-17', 'CP-1042')).toEqual(['V', '', '', '', '', '', '']);
    expect(week('WH', '2026-08-17')?.changes.map(c => c.to)).toEqual(['', '', '']);
    expect(auditActs()).toEqual(['Rota week cleared']);
  });
  test('generate skips the live week, leave and filled cells, reports true counts, one audit row', async () => {
    plant('WH', '2026-08-17', { 'CP-1042': ['L', 'V', '', '', '', '', ''] });
    const live = structuredClone(week('WH', '2026-08-10'));
    const before = structuredClone(week('WH', '2026-08-17')?.lines ?? {});
    const r = PatternGenerated.parse((await (await as('manager'))('POST', '/api/v1/rota/patterns/WP-02/generate', { gen: '1w' }, 1)).body);
    expect(week('WH', '2026-08-10')).toEqual(live);
    const after = week('WH', '2026-08-17')?.lines ?? {};
    let filledNow = 0;
    for (const [code, l] of Object.entries(after)) l.forEach((c, i) => { if (c && !before[code]?.[i]) filledNow++; });
    expect(r).toMatchObject({ live: 1, occupied: 1, absence: 1, written: filledNow, range: '13/08/2026 – 19/08/2026' });
    expect(after['CP-1042']?.slice(0, 2)).toEqual(['L', 'V']);
    expect(r.record).toMatchObject({ gen: '1w', version: 2 });
    expect(auditActs()).toEqual(['Working pattern generated']);
  });
  test('an amended week is live too: clear and copy refuse it, repeat and generate skip it, and a second change is an amendment (I3)', async () => {
    const call = await as('manager');
    expect((await cell(call, WH, ASSIGN_LIVE)).status).toBe(200);
    expect(week('WH', '2026-08-10')?.state).toBe('amendment');
    const amended = structuredClone(week('WH', '2026-08-10'));
    const before = snapshot(...WRITES);
    expect(refusal(await call('POST', `${WH}/clear`, undefined, 2))).toMatchObject({ code: 'WEEK_LIVE', message: 'Week 33 is amended. Remove shifts individually so each change is recorded.' });
    expect(refusal(await call('POST', `${WH}/copy`, undefined, 2))).toMatchObject({ code: 'WEEK_LIVE' });
    expect(snapshot(...WRITES)).toEqual(before);
    const rep = WeekRepeated.parse((await call('POST', '/api/v1/rota/weeks/WH/2026-08-03/repeat', { weeks: 2 }, 1)).body);
    expect(rep).toMatchObject({ live: 1, weeks: 1 });
    const gen = PatternGenerated.parse((await call('POST', '/api/v1/rota/patterns/WP-02/generate', { gen: '1w' }, 1)).body);
    expect(gen.live).toBe(1);
    expect(week('WH', '2026-08-10')).toEqual(amended);
    const second = CellSaved.parse((await cell(call, WH, { personCode: 'CP-1402', day: 4, code: '' }, 2)).body);
    expect(second.week.state).toBe('amendment');
    expect(second.week.changes[0]).toMatchObject({ personCode: 'CP-1402', to: '', afterPublish: true, version: 1 });
    expect(notes('CP-1402').map(n => n.title)).toEqual(['Rota amended', 'Rota amended']);
  });
  test('a run that lands nothing is refused with NO_LANDING', async () => {
    const r = await (await as('admin'))('POST', '/api/v1/rota/patterns/WP-03/generate', { gen: '1w' }, 1);
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ message: 'None of the people on this pattern are on the workforce record.' });
  });
});

describe('cover flow (Review Focus 5)', () => {
  test('one open request per location, day and shift', async () => {
    const r = await (await as('manager'))('POST', '/api/v1/rota/cover', { location: 'WH', date: '2026-08-11', shift: 'N', reason: '', urgent: false });
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'COVER_OPEN', message: 'A cover request is already open for Night on Tue 11 Aug.' });
  });
  test('stages move only by action: open, reason, ask all, escalate, each with its notices', async () => {
    const call = await as('manager');
    const opened = CoverSaved.parse((await call('POST', '/api/v1/rota/cover', { location: 'WH', date: '2026-08-16', shift: 'E', reason: '', urgent: false })).body);
    expect(opened.record).toMatchObject({ stage: 1, asked: 'Not asked yet', next: 'Choose a reason to start', log: [] });
    expect(notes('CP-1001').map(n => n.title)).toEqual(['Coverage issue · Willow House']);
    const id = opened.record.id;
    await call('GET', '/api/v1/rota/cover');
    expect(store.coll<{ stage: number }>('coverRequests')[id]?.stage).toBe(1);
    const reasoned = CoverSaved.parse((await call('POST', `/api/v1/rota/cover/${id}/reason`, { reason: 'Sickness' }, 1)).body).record;
    expect(reasoned).toMatchObject({ stage: 2, reason: 'Sickness', asked: 'Employees at Willow House, then favourite bank workers' });
    expect(reasoned.log).toHaveLength(1);
    const offered = notes().filter(n => n.title === 'Open shift available');
    expect(offered.length).toBe(reasoned.log[0]?.sent);
    const all = CoverSaved.parse((await call('POST', `/api/v1/rota/cover/${id}/ask-all`, undefined, 2)).body).record;
    expect(all).toMatchObject({ stage: 3, asked: 'Everyone cleared to work has been asked' });
    const esc = CoverSaved.parse((await call('POST', `/api/v1/rota/cover/${id}/escalate`, undefined, 3)).body).record;
    expect(esc).toMatchObject({ stage: 4, next: 'With the Service Manager. Next: agency / manual booking.' });
    expect(notes('CP-1001').map(n => n.title)).toContain('Fulfilment escalation');
    expect(auditActs()).toEqual(['Cover request opened', 'Cover reason set', 'Cover asked of every cleared worker', 'Fulfilment escalated']);
  });
  test('assign writes the shift through the week path, closes the request and leaves a filled row', async () => {
    const r = CoverFilled.parse((await (await as('manager'))('POST', '/api/v1/rota/cover/cov_1/assign', { personCode: 'CP-1310' }, 1)).body);
    expect(r.record.open).toBe(false);
    expect(r.filled).toMatchObject({ personCode: 'CP-1310', date: '2026-08-11', shift: 'N', confirmed: false });
    expect(line('WH', '2026-08-10', 'CP-1310')).toEqual(['', 'N', '', '', '', 'E', '']);
    expect(week('WH', '2026-08-10')).toMatchObject({ state: 'amendment' });
    expect(week('WH', '2026-08-10')?.changes[0]).toMatchObject({ personCode: 'CP-1310', afterPublish: true });
    expect(notes('CP-1310').map(n => n.title)).toEqual(['Rota amended']);
    expect(auditActs()).toEqual(['Cover request filled']);
  });
  test('fill needs a reason, then picks the best eligible person', async () => {
    const call = await as('manager');
    const opened = CoverSaved.parse((await call('POST', '/api/v1/rota/cover', { location: 'WH', date: '2026-08-16', shift: 'E', reason: '', urgent: false })).body);
    const r = await call('POST', `/api/v1/rota/cover/${opened.record.id}/fill`, undefined, 1);
    expect(refusal(r)).toMatchObject({ code: 'REASON_REQUIRED', message: 'Add a reason before closing the request.' });
    const best = CoverBoard.parse((await call('GET', '/api/v1/rota/cover')).body).requests.find(x => x.id === 'cov_2')?.suggestions[0];
    const f = CoverFilled.parse((await call('POST', '/api/v1/rota/cover/cov_2/fill', undefined, 1)).body);
    expect(f.filled.personCode).toBe(best?.personCode);
    expect(line('WH', '2026-08-10', f.filled.personCode)?.[4]).toBe('L');
  });
  test('an employee claims an open shift: written to the rota, the manager told', async () => {
    const r = CoverFilled.parse((await (await asEmail('sana.iqbal@brightpath.org'))('POST', '/api/v1/rota/cover/cov_2/claim', undefined, 1)).body);
    expect(r.filled).toMatchObject({ personCode: 'CP-1455', shift: 'L' });
    expect(line('WH', '2026-08-10', 'CP-1455')?.[4]).toBe('L');
    expect(notes('CP-1001').map(n => [n.title, n.body])).toEqual([['Cover request filled', 'Sana Iqbal has claimed Late on Fri 14 Aug']]);
    expect(auditActs()).toEqual(['Open shift claimed']);
  });
  test('confirm raises the IT request with ITACCESS on, and not with it off', async () => {
    const call = await as('manager');
    const r = FilledConfirmed.parse((await call('POST', '/api/v1/rota/filled/fil_1/confirm', undefined, 1)).body);
    expect(r.itRequest).toMatchObject({ ref: 'ITR-1007', personCode: 'CP-1310', worker: 'Bank', status: 'Raised' });
    expect(r.summary).toBe('Confirmed. IT access request ITR-1007 raised.');
    expect(Object.values(store.coll('itRequests'))).toHaveLength(1);
    expect(notes(accountOf('admin').personCode).map(n => n.title)).toEqual(['IT access request raised']);
    expect(refusal(await call('POST', '/api/v1/rota/filled/fil_1/confirm', undefined, 2))).toMatchObject({ code: 'ALREADY_CONFIRMED' });
    resetTo('social');
    setFlag('ITACCESS', false);
    const off = FilledConfirmed.parse((await (await as('manager'))('POST', '/api/v1/rota/filled/fil_1/confirm', undefined, 1)).body);
    expect(off).toMatchObject({ itRequest: null, summary: 'Confirmed as worked.' });
    expect(Object.values(store.coll('itRequests'))).toHaveLength(0);
  });
  test('removing a shift that leaves the day short opens a cover request when FULFIL is on', async () => {
    const r = CellSaved.parse((await cell(await as('manager'), WH, { personCode: 'CP-1153', day: 6, code: '' })).body);
    expect(r.cover).toMatchObject({ date: '2026-08-16', open: true, reason: '' });
    expect(notes('CP-1001').map(n => n.title)).toEqual(['Coverage issue · Willow House']);
    expect(rotaAudits()).toHaveLength(1);
  });
});

describe('a fault on each write leaves nothing behind (Review Focus 6)', () => {
  const writes: [string, Persona, string, string, unknown, number][] = [
    ['cell write', 'manager', 'PUT', `${WH}/cells`, ASSIGN_LIVE, 1],
    ['transition', 'manager', 'POST', `${WH}/transition`, { to: 'published' }, 1],
    ['copy', 'manager', 'POST', `${NEXT}/copy`, undefined, 0],
    ['repeat', 'manager', 'POST', `${WH}/repeat`, { weeks: 2 }, 1],
    ['clear', 'manager', 'POST', `${NEXT}/clear`, undefined, 0],
    ['accept plan', 'manager', 'POST', `${WH}/plan/accept`, { items: [ASSIGN_LIVE] }, 1],
    ['shift type create', 'manager', 'POST', '/api/v1/rota/shift-types', { code: 'TW', name: 'Twilight', from: '17:00', to: '23:00', breakMinutes: 0, night: false }, 0],
    ['shift type update', 'manager', 'PATCH', '/api/v1/rota/shift-types/E', { name: 'Morning' }, 1],
    ['shift type delete', 'manager', 'DELETE', '/api/v1/rota/shift-types/E', undefined, 1],
    ['pattern create', 'manager', 'POST', '/api/v1/rota/patterns', { name: 'New', cycle: 7, locations: ['WH'], jobProfiles: [], costCentre: '', starts: '2026-08-17', horizon: 12, gen: '1w' }, 0],
    ['pattern update', 'manager', 'PATCH', '/api/v1/rota/patterns/WP-02', { name: 'Renamed' }, 1],
    ['pattern delete', 'manager', 'DELETE', '/api/v1/rota/patterns/WP-02', undefined, 1],
    ['pattern people', 'manager', 'POST', '/api/v1/rota/patterns/WP-02/people', { personCodes: ['CP-1310'], start: 1, mode: 'stagger' }, 1],
    ['generate', 'manager', 'POST', '/api/v1/rota/patterns/WP-02/generate', { gen: '1w' }, 1],
    ['open cover', 'manager', 'POST', '/api/v1/rota/cover', { location: 'WH', date: '2026-08-16', shift: 'E', reason: 'Sickness', urgent: true }, 0],
    ['cover reason', 'manager', 'POST', '/api/v1/rota/cover/cov_1/reason', { reason: 'Vacancy' }, 1],
    ['ask all', 'manager', 'POST', '/api/v1/rota/cover/cov_1/ask-all', undefined, 1],
    ['escalate', 'manager', 'POST', '/api/v1/rota/cover/cov_1/escalate', undefined, 1],
    ['cover assign', 'manager', 'POST', '/api/v1/rota/cover/cov_1/assign', { personCode: 'CP-1310' }, 1],
    ['cover fill', 'manager', 'POST', '/api/v1/rota/cover/cov_2/fill', undefined, 1],
    ['claim', 'employee', 'POST', '/api/v1/rota/cover/cov_2/claim', undefined, 1],
    ['confirm', 'manager', 'POST', '/api/v1/rota/filled/fil_1/confirm', undefined, 1],
    ['rota setup', 'admin', 'PATCH', '/api/v1/rota/config', { publishBlockOnGap: false }, 1],
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
  test('a throw after the week, the cover and the notices are written rolls every one back', async () => {
    const call = await as('manager'), before = snapshot(...WRITES);
    store.db.audit = Object.freeze({ ...store.db.audit });
    const r = await cell(call, WH, { personCode: 'CP-1153', day: 6, code: '' });
    expect(r.status).toBe(500);
    expect(snapshot(...WRITES)).toEqual(before);
    expect(notes()).toEqual([]);
  });
});

describe('the timesheet reads the real rota line (Review Focus 7, D13)', () => {
  const save = (call: Call, code: string, date: string, start: string, finish: string) =>
    call('PUT', `/api/v1/timesheets/${code}/days/${date}`, { entries: [{ start, finish, breaks: [] }], shift: 'E' }, 0);
  test('on social a long day warns against the person\'s rota line', async () => {
    const r = DaySaved.parse((await save(await as('employee'), 'CP-1042', '2026-08-13', '07:00', '19:00')).body);
    expect(r.warnings).toContain('That is +3.00 h against the rota line (Night 9 h).');
  });
  test('on social the rest rule warns from the rota line around the day', async () => {
    const t = store.coll<{ rules: Record<string, unknown> }>('timesheetConfig').timesheetConfig;
    if (t) t.rules.enforceRest = true;
    const r = DaySaved.parse((await save(await asEmail('jo.baptiste@brightpath.org'), 'CP-1153', '2026-08-13', '14:30', '22:00')).body);
    expect(r.warnings).toContain('Only 7.5 h rest against an adjacent shift. The rule for Support Worker is 11 h.');
  });
  test('an unpublished week is not a line (D14)', async () => {
    const w = week('WH', '2026-08-10');
    if (w) w.state = 'draft';
    const r = DaySaved.parse((await save(await as('employee'), 'CP-1042', '2026-08-13', '07:00', '19:00')).body);
    expect(r.warnings.some(x => x.includes('against the rota line'))).toBe(false);
  });
  test('on qnipay (Rota off) no rota warning fires, even with a line in the store', async () => {
    resetTo('qnipay');
    const me = accountOf('employee').personCode;
    const p = Object.values(store.coll<{ code: string; location: string }>('people')).find(x => x.code === me);
    store.coll('shiftTypes').sht_N = { id: 'sht_N', version: 1, updatedAt: FROZEN, code: 'N', name: 'Night', from: '22:00', to: '07:00', breakMinutes: 0, hours: 9, cross: true, night: true, start: 22, end: 31, tone: 'N' };
    plant(p?.location ?? '', '2026-08-10', { [me]: ['N', 'N', 'N', 'N', 'N', '', ''] }, 'published');
    const r = await save(await as('employee'), me, '2026-08-13', '07:00', '19:00');
    expect(r.status).toBe(200);
    expect(DaySaved.parse(r.body).warnings.some(x => x.includes('against the rota line'))).toBe(false);
  });
});

describe('shift types, patterns, my shifts and setup', () => {
  test('a shift type is added with derived hours, and every type takes it when asked', async () => {
    const call = await as('manager');
    const r = await call('POST', '/api/v1/rota/shift-types', { code: 'tw', name: 'Twilight', from: '17:00', to: '23:00', breakMinutes: 30, night: false, eligibleAll: true });
    expect(r.status).toBe(200);
    const cat = ShiftCatalogue.parse((await call('GET', '/api/v1/rota/shift-types')).body);
    expect(cat.items.find(s => s.code === 'TW')).toMatchObject({ hours: 5.5, tone: 'L', cross: false });
    expect((cfg().types as Record<string, { shifts: string[] }>).salaried?.shifts).toContain('TW');
    const dup = await call('POST', '/api/v1/rota/shift-types', { code: 'E', name: 'Again', from: '07:00', to: '15:00', breakMinutes: 0, night: false });
    expect(refusal(dup)).toMatchObject({ code: 'invalid', field: 'code', message: 'A unique code of 1–4 characters is required.' });
  });
  test('a shift type in use cannot be removed, with the counts', async () => {
    const r = await (await as('manager'))('DELETE', '/api/v1/rota/shift-types/N', undefined, 1);
    expect(r.status).toBe(409);
    expect(refusal(r)).toMatchObject({ code: 'IN_USE', message: 'Night is still in use on 24 rota day(s) and 4 pattern day(s). Clear those first.' });
    expect(refusal(r).usedBy?.map(u => [u.kind, u.count])).toEqual([['rota days', 24], ['pattern days', 4]]);
  });
  test('people go on a pattern staggered across its shift days; ticking nobody is refused', async () => {
    const call = await as('manager');
    const r = await call('POST', '/api/v1/rota/patterns/WP-02/people', { personCodes: ['CP-1310', 'CP-1455'], start: 1, mode: 'stagger' }, 1);
    expect(r.status).toBe(200);
    expect(store.coll<{ people: { personCode: string; offset: number }[] }>('patterns')['pat_WP-02']?.people.slice(-2)).toEqual([{ personCode: 'CP-1310', offset: 1 }, { personCode: 'CP-1455', offset: 2 }]);
    expect(refusal(await call('POST', '/api/v1/rota/patterns/WP-02/people', { personCodes: [], start: 1, mode: 'stagger' }, 2))).toMatchObject({ message: 'Tick at least one person.' });
  });
  test('the pattern list carries today and the locations a pattern may cover, so an admin without team_rota can build (I2)', async () => {
    expect((await (await as('admin'))('GET', '/api/v1/rota/home')).status).toBe(403);
    const a = PatternList.parse((await (await as('admin'))('GET', '/api/v1/rota/patterns')).body);
    expect(a.today).toBe('2026-08-13');
    expect(a.canCover.map(l => l.code)).toEqual(expect.arrayContaining(['WH', 'BC', 'FS', 'LGW']));
    const m = PatternList.parse((await (await as('manager'))('GET', '/api/v1/rota/patterns')).body);
    expect(m.canCover).toEqual([{ code: 'WH', name: 'Willow House' }]);
  });
  test('a new pattern starts as a draft; one with no name is refused', async () => {
    const call = await as('manager');
    const body = { name: 'Nights', cycle: 4, locations: ['WH'], jobProfiles: ['NS'], costCentre: 'WH-CAM-01', starts: '2026-08-17', horizon: 12, gen: '4w', base: 'WP-01' };
    const r = await call('POST', '/api/v1/rota/patterns', body);
    expect(r.status).toBe(200);
    expect(store.coll<{ active: boolean; days: string[] }>('patterns')['pat_WP-05']).toMatchObject({ active: false, days: ['N', 'N', 'N', 'N'] });
    expect(refusal(await call('POST', '/api/v1/rota/patterns', { ...body, name: ' ' }))).toMatchObject({ field: 'name', message: 'Give the pattern a name.' });
  });
  test('my shifts shows a published week, the next shift and who is on it, and open shifts I can claim', async () => {
    const m = MyShifts.parse((await (await asEmail('ellie.warren@brightpath.org'))('GET', '/api/v1/rota/my-shifts')).body);
    expect(m).toMatchObject({ visible: true, state: 'published', weekStart: '2026-08-10', hours: 7.5, publishedTo: '2026-08-16', canClaim: true });
    expect(m.next).toMatchObject({ date: '2026-08-15', code: 'E' });
    expect(m.next?.with).toEqual(['Marcus Reilly', 'Jo Baptiste']);
    /* cov_1 is in the past; Ellie's Saturday early leaves too little rest after Friday's late (cov_2) */
    expect(m.openShifts).toEqual([]);
    const sana = MyShifts.parse((await (await asEmail('sana.iqbal@brightpath.org'))('GET', '/api/v1/rota/my-shifts')).body);
    expect(sana.openShifts.map(o => [o.id, o.urgent, o.why])).toEqual([['cov_2', true, 'You are a favourite here, so it is offered to you first']]);
  });
  test('my shifts does not show an unpublished week (D14)', async () => {
    const w = week('WH', '2026-08-10');
    if (w) w.state = 'review';
    const m = MyShifts.parse((await (await as('employee'))('GET', '/api/v1/rota/my-shifts')).body);
    expect(m).toMatchObject({ visible: false, state: 'review', days: [], restDays: [], next: null, hours: 0 });
  });
  test('rota setup saves with one audit row and refuses a value the rules cannot run on', async () => {
    const call = await as('admin');
    expect(RotaSetup.parse((await call('GET', '/api/v1/rota/config')).body).config.version).toBe(1);
    const r = await call('PATCH', '/api/v1/rota/config', { publishBlockOnGap: false, types: { casual: { shifts: ['E'], night: false, maxHours: 30, restHours: 11, maxConsec: 4, flexible: true } } }, 1);
    expect(r.status).toBe(200);
    expect(cfg()).toMatchObject({ publishBlockOnGap: false, version: 2 });
    expect(Object.keys(cfg().types as object)).toEqual(['shift', 'casual', 'salaried']);
    expect(auditActs()).toEqual(['Rota setup saved']);
    expect(refusal(await call('PATCH', '/api/v1/rota/config', { minDefault: 0 }, 2))).toMatchObject({ field: 'minDefault', message: 'Default people per shift must be a whole number from 1 to 50.' });
  });
});
