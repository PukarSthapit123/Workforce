import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { MyShifts, RotaHome, RotaWeekView, WeekMoved } from '@/contract/rota';
import { FROZEN, audits, caller, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

/* Module 8 group 4B: publishing walks the Rota approval chain. The rota
   manager's publish signs the first layer that applies; with a later layer
   to come the week waits in review until that layer signs it off, and only
   then is it published. On social, Rachel Hussain (CP-1001) plans and
   publishes the rota at Willow House; Dee Fitzgerald (CP-1002), the
   administrator, is given "Plan and publish rota" here so there is a second
   Service Manager to sign off. Week 34 (17 August) is not stored yet. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

type Call = ReturnType<typeof caller>;
const as = async (p: Persona) => caller(await tokenFor(p));
async function asEmail(email: string): Promise<Call> {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  return caller(((await r.json()) as { token: string }).token);
}
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const WRITES = ['rotaWeeks', 'notifications', 'audit'];
const NEXT = '/api/v1/rota/weeks/WH/2026-08-17';
interface Week { id: string; version: number; state: string; publishVersion: number; signoff?: unknown }
const week = () => store.coll<Week>('rotaWeeks')['rw_WH_2026-08-17'];
interface Note { id: string; personId: string; event?: string; title: string; body: string }
/* the rows this test raised: the seeded feeds are left out */
const told = (title: string) => Object.values(store.coll<Note>('notifications')).filter(n => !n.id.startsWith('ntf_seed_') && n.title === title).map(n => n.personId).sort();
const cfg = () => store.coll<Record<string, unknown>>('rotaConfig').rotaConfig ?? {};
const setCfg = (patch: Record<string, unknown>) => { store.coll('rotaConfig').rotaConfig = { ...cfg(), ...patch }; };
const publish = (call: Call, v: number) => call('POST', `${NEXT}/transition`, { to: 'published' }, v);
const signOff = (call: Call, v: number, to: 'published' | 'draft' = 'published', reason?: string) =>
  call('POST', `${NEXT}/sign-off`, { to, ...(reason !== undefined ? { reason } : {}) }, v);
const view = async (call: Call) => RotaWeekView.parse((await call('GET', NEXT)).body);
const layer = (when: string, scope: string, sla = '1 day') => ({ role: 'Service Manager', scope, when, sla, fixed: false });
function adminPublishes() {
  const admin = store.coll<{ capabilities: string[] }>('userTypes').admin;
  if (!admin) throw new Error('no admin type');
  admin.capabilities = [...admin.capabilities, 'team_rota'];
}
async function chain(steps: ReturnType<typeof layer>[]) {
  adminPublishes();
  const r = await (await as('admin'))('PUT', '/api/v1/approvals/chains/Rota', { steps }, 0);
  expect(r.status).toBe(200);
}
/* the rota manager's layer, then a Service Manager who signs off every week */
const signOffEveryWeek = () => chain([layer('Every rota week', 'Own location', '4 hours'), layer('Every rota week', 'All departments')]);
/* the gaps an empty week has would block publishing; that rule is not what is tested here */
beforeEach(() => setCfg({ publishBlockOnGap: false }));

describe('only the rota manager\'s layer: publish works as today (D6)', () => {
  test('with no chain stored the week is published at once', async () => {
    const r = WeekMoved.parse((await publish(await as('manager'), 0)).body);
    expect(r.week).toMatchObject({ state: 'published', publishVersion: 1, signoff: null });
    expect(audits().filter(a => a.entity === 'rotaWeek').map(a => a.act)).toEqual(['Rota published']);
  });
  test('the seeded layer applies only for agency booking, and as the only layer the rota manager\'s publish still publishes', async () => {
    setCfg({ fulfilStages: [...((cfg().fulfilStages as unknown[] | undefined) ?? []), { n: 5, audience: 'Agency partners', wait: 60, channel: 'Email', next: 'Manual booking' }] });
    store.coll('coverRequests').cov_9 = { id: 'cov_9', version: 1, updatedAt: FROZEN, location: 'WH', date: '2026-08-19', shift: 'E', reason: 'Sickness', stage: 5,
      open: true, urgent: false, openedAt: FROZEN, asked: '', log: [] };
    const r = WeekMoved.parse((await publish(await as('manager'), 0)).body);
    expect(r.week.state).toBe('published');
  });
});

describe('a later layer: publish waits for sign-off', () => {
  test('the rota manager\'s publish moves the week to review; the sign-off publishes it and tells the roster', async () => {
    await signOffEveryWeek();
    const mgr = await as('manager'), admin = await as('admin');
    const sent = WeekMoved.parse((await publish(mgr, 0)).body);
    expect(sent.summary).toBe('Week 34 sent for sign-off. It is published once the Service Manager signs it off.');
    expect(sent.week).toMatchObject({ state: 'review', publishVersion: 0,
      signoff: { requestedBy: { personCode: 'CP-1001' }, waitingOn: 'the Service Manager', final: true, decide: false,
        why: 'You sent this week to be published, so someone else signs it off.', signed: [{ layer: 'Service Manager', by: { personCode: 'CP-1001' } }] } });
    expect(audits().find(a => a.id === sent.auditId)).toMatchObject({ act: 'Rota sent for sign-off', after: { state: 'review' } });
    expect(told('Rota waiting on your sign-off')).toEqual(['CP-1002']);
    expect(told('Rota published')).toEqual([]);
    /* the sign-off holder sees it on the rota's home and on the week */
    expect(RotaHome.parse((await admin('GET', '/api/v1/rota/home')).body).awaiting).toEqual([
      { id: 'rw_WH_2026-08-17', location: 'WH', locationName: 'Willow House', weekStart: '2026-08-17', isoWeek: 34, requestedBy: 'Rachel Hussain' }]);
    expect(RotaHome.parse((await mgr('GET', '/api/v1/rota/home')).body).awaiting).toBeUndefined();
    expect((await view(admin)).signoff).toMatchObject({ decide: true, final: true, why: '' });
    const done = WeekMoved.parse((await signOff(admin, 1)).body);
    expect(done.week).toMatchObject({ state: 'published', publishVersion: 1, signoff: null, publishedBy: { personCode: 'CP-1002' } });
    expect(done.summary).toMatch(/^Rota published · v1 · \d+ colleagues notified · signed off$/);
    expect(told('Rota published').length).toBeGreaterThan(0);
    expect(told('Rota signed off')).toEqual(['CP-1001']);
    expect(audits().filter(a => a.entity === 'rotaWeek').map(a => a.act)).toEqual(['Rota sent for sign-off', 'Rota published']);
    expect(done.week.publications[0]).toMatchObject({ location: 'WH', weekStart: '2026-08-17', version: 1 });
  });
  test('a week waiting on sign-off cannot be published again; returning it to draft withdraws it', async () => {
    await signOffEveryWeek();
    const mgr = await as('manager');
    await publish(mgr, 0);
    const again = await publish(mgr, 1);
    expect([again.status, refusal(again).code, refusal(again).message]).toEqual([409, 'AWAITING_SIGNOFF', 'Week 34 is waiting on sign-off by the Service Manager.']);
    const back = WeekMoved.parse((await mgr('POST', `${NEXT}/transition`, { to: 'draft' }, 1)).body);
    expect(back.week).toMatchObject({ state: 'draft', signoff: null });
    expect(week()?.signoff).toBeNull();
  });
  test('the sign-off holder sends it back with a reason the rota manager sees', async () => {
    await signOffEveryWeek();
    const mgr = await as('manager'), admin = await as('admin');
    await publish(mgr, 0);
    const none = await signOff(admin, 1, 'draft', '  ');
    expect([none.status, refusal(none).field]).toEqual([422, 'reason']);
    const r = WeekMoved.parse((await signOff(admin, 1, 'draft', 'Two nights are below the minimum')).body);
    expect(r.week).toMatchObject({ state: 'draft', signoff: null, sentBack: { by: { personCode: 'CP-1002' }, reason: 'Two nights are below the minimum' } });
    expect((await view(mgr)).sentBack?.reason).toBe('Two nights are below the minimum');
    expect(told('Rota sent back')).toEqual(['CP-1001']);
    expect(audits().find(a => a.id === r.auditId)).toMatchObject({ act: 'Rota sent back', reason: 'Two nights are below the minimum' });
    /* publishing it again starts the sign-off afresh */
    expect(WeekMoved.parse((await publish(mgr, 2)).body).week).toMatchObject({ state: 'review', sentBack: null });
  });
  test('three layers: each sign-off moves the week one layer on, and only the last publishes it', async () => {
    await chain([layer('Every rota week', 'Own location'), layer('Every rota week', 'All departments'), layer('Every rota week', 'All departments')]);
    const jo = store.coll<{ personCode: string; grants: string[] }>('accounts')['acc_jo.baptiste@brightpath.org'];
    if (!jo) throw new Error('no account for Jo');
    jo.grants = ['team_rota'];
    await publish(await as('manager'), 0);
    const first = WeekMoved.parse((await signOff(await as('admin'), 1)).body);
    expect(first.week).toMatchObject({ state: 'review', signoff: { final: true, decide: false } });
    expect(audits().find(a => a.id === first.auditId)?.act).toBe('Rota signed off');
    const last = WeekMoved.parse((await signOff(await asEmail('jo.baptiste@brightpath.org'), 2)).body);
    expect(last.week.state).toBe('published');
  });
});

describe('delegation applies at the sign-off layer', () => {
  test('while it is in force, the delegate signs off for the holder without the capability', async () => {
    await signOffEveryWeek();
    await publish(await as('manager'), 0);
    store.coll('delegations').dlg_9 = { id: 'dlg_9', version: 1, updatedAt: FROZEN, who: 'CP-1002', to: 'CP-1153', from: '2026-08-13', until: '2026-08-20', modules: ['Rota'] };
    const r = WeekMoved.parse((await signOff(await asEmail('jo.baptiste@brightpath.org'), 1)).body);
    expect(r.week).toMatchObject({ state: 'published', publishedBy: { personCode: 'CP-1153' } });
  });
});

describe('permissions on the sign-off', () => {
  test('the publisher, the wrong layer, no capability and out of scope are each refused, and nothing is written', async () => {
    await chain([layer('Every rota week', 'Own location'), layer('Every rota week', 'Own location'), layer('Every rota week', 'All departments')]);
    const grace = store.coll<{ grants: string[] }>('accounts')['acc_grace.whitmore@brightpath.org'];
    if (!grace) throw new Error('no account for Grace');
    await publish(await as('manager'), 0);
    /* Kwame covers Dee, who signs off only the third layer; Grace plans the rota at Beacon Court only */
    store.coll('delegations').dlg_9 = { id: 'dlg_9', version: 1, updatedAt: FROZEN, who: 'CP-1002', to: 'CP-1490', from: '2026-08-13', until: '2026-08-20', modules: ['Rota'] };
    grace.grants = ['team_rota'];
    const mgr = await as('manager'), emp = await as('employee'), kwame = await asEmail('kwame.boateng@brightpath.org'), bc = await asEmail('grace.whitmore@brightpath.org');
    const before = snapshot(...WRITES);
    const self = await signOff(mgr, 1);
    expect([self.status, refusal(self).code, refusal(self).message]).toEqual([403, 'ALREADY_SIGNED', 'You sent this week to be published, so someone else signs it off.']);
    const wrong = await signOff(kwame, 1);
    expect([wrong.status, refusal(wrong).code, refusal(wrong).message]).toEqual([403, 'WRONG_LAYER', 'This week is waiting on the Service Manager, not on a layer you sign off.']);
    const none = await signOff(emp, 1);
    expect([none.status, refusal(none).code]).toEqual([403, 'capability']);
    const out = await signOff(bc, 1);
    expect([out.status, refusal(out).code, refusal(out).message]).toEqual([403, 'scope', 'This week is at Willow House, outside the locations you sign off rotas for.']);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('a week not waiting on sign-off is refused', async () => {
    const r = await signOff(await as('manager'), 1);
    expect([r.status, refusal(r).code]).toEqual([409, 'NOT_AWAITING_SIGNOFF']);
  });
});

describe('every consumer of week states keeps working', () => {
  test('a week waiting on sign-off is open work for the week start (D4), and colleagues do not see it', async () => {
    await signOffEveryWeek();
    await publish(await as('manager'), 0);
    for (const w of Object.values(store.coll<{ id: string; state: string }>('rotaWeeks'))) if (w.id !== 'rw_WH_2026-08-17') w.state = 'published';
    for (const d of Object.values(store.coll<{ state: string }>('timesheetDays'))) d.state = 'ok';
    const admin = await as('admin'), t = store.coll<{ version: number }>('tenant').tenant;
    const r = await admin('PATCH', '/api/v1/tenant/settings', { weekStart: 'Sunday' }, t?.version ?? 1);
    expect([r.status, refusal(r).code, refusal(r).message]).toEqual([409, 'week-start-in-use', 'The week start cannot change while 0 timesheet days are and 1 rota week is open.']);
    const mine = MyShifts.parse((await (await as('employee'))('GET', '/api/v1/rota/my-shifts?weekStart=2026-08-17')).body);
    expect([mine.state, mine.visible, mine.days]).toEqual(['review', false, []]);
  });
});
