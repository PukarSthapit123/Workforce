import { server } from './node';
import { store } from './store';
import { GlyphKey, HomeMonth, MyDocuments } from '@/contract/home';
import { Refusal } from '@/contract/common';
import { GLYPH_ORDER } from '@/domain/home';
import { caller, resetTo, tokenFor, type Reply } from '@/test/api-helpers';

/* The social seed at the frozen clock (Thu 13 Aug 2026, 15:30 in London):
   Amara Okafor (CP-1042, the first employee) works at Willow House, whose
   weeks of 3 and 10 August are published. She has draft days 27 July to 7
   August, a pending day on 12 August, approved leave on 17 and 18 August and
   a pending request for 3 and 4 September. 31 August is a bank holiday. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

const refusal = (r: Reply) => Refusal.parse(r.body);
const month = (r: Reply) => HomeMonth.parse(r.body);
const dayOf = (m: HomeMonth, date: string) => m.days.find(d => d.date === date);
const asEmployee = async () => caller(await tokenFor('employee'));
async function asEmail(email: string) {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const body = (await r.json()) as { token?: string };
  if (!body.token) throw new Error(`sign-in as ${email} failed`);
  return caller(body.token);
}
const tenantVersion = () => (store.coll<{ version: number }>('tenant').tenant?.version ?? 0);

test('the contract\'s glyphs are the domain\'s, in the key order', () => expect(GlyphKey.options).toEqual([...GLYPH_ORDER]));

test('social: August shows the published rota\'s shifts, approved leave, sickness, the bank holiday and the recorded days, with the key and the figures around it', async () => {
  store.coll('sickEpisodes').sk_home = { version: 1, updatedAt: '2026-08-13T14:30:00.000Z', id: 'sk_home', personCode: 'CP-1042', from: '2026-08-01', to: '2026-08-01', reason: 'Cold or flu', note: '', rtw: null };
  const r = await (await asEmployee())('GET', '/api/v1/home');
  expect(r.status).toBe(200);
  const m = month(r);
  expect(m).toMatchObject({ month: '2026-08', label: 'August 2026', thisMonth: '2026-08', today: '2026-08-13', bounds: { min: '2026-07', max: '2027-08' }, leadingBlanks: 5 });
  expect(m.greeting).toBe('Good afternoon, Amara');
  expect(m.who).toBe('Support Worker · Willow House');
  expect(m.days).toHaveLength(31);
  expect(dayOf(m, '2026-08-03')).toMatchObject({ shift: { code: 'E', name: 'Early', tone: 'E' }, ts: { state: 'draft' }, glyph: 'draft', source: 'rota' });
  expect(dayOf(m, '2026-08-05')?.shift).toMatchObject({ code: 'N', tone: 'N', time: '22:00–07:00' });
  expect(dayOf(m, '2026-08-10')).toMatchObject({ shift: { code: 'E' }, ts: null, glyph: 'none' });
  expect(dayOf(m, '2026-08-12')).toMatchObject({ shift: null, ts: { state: 'pend' }, glyph: 'pend' });
  expect(dayOf(m, '2026-08-13')).toMatchObject({ today: true, future: false, shift: { code: 'N' }, glyph: null });
  expect(dayOf(m, '2026-08-17')).toMatchObject({ shift: null, glyph: null, source: 'leave',
    absence: { mark: 'V', type: 'AL', name: 'Annual leave', short: 'Leave', icon: '☀', from: '2026-08-17', to: '2026-08-18', state: 'approved' } });
  expect(dayOf(m, '2026-08-01')?.absence).toMatchObject({ mark: 'S', type: 'SICK', name: 'Sickness', icon: '✚' });
  expect(dayOf(m, '2026-08-31')).toMatchObject({ bankHoliday: 'Summer bank holiday', future: true, shift: null });
  /* week 17 August is not on a published rota: nothing is painted from it */
  expect(m.days.filter(d => d.date >= '2026-08-19').every(d => d.shift === null)).toBe(true);
  expect(m.totals.shifts).toBe(8);
  expect(m.totals.leaveDays).toBe(2);
  expect(m.summary).toMatch(/^8 shifts · \d+\.\dh recorded · 2 days leave$/);
  expect(m.key.tones).toEqual([{ tone: 'E', label: 'Early', count: 4 }, { tone: 'N', label: 'Night', count: 4 }]);
  expect(m.key.leave).toEqual([{ name: 'Sickness', icon: '✚', count: 1 }, { name: 'Annual leave', icon: '☀', count: 2 }]);
  expect(m.key.states.map(s => s.key)).toEqual(['pend', 'draft', 'none']);
  expect(m.nextShift).toEqual({ date: '2026-08-13', name: 'Night', time: '22:00–07:00' });
  expect(m.missing).toEqual(['2026-08-10', '2026-08-11']);
  expect(m.todayDay.date).toBe('2026-08-13');
  expect(m.can).toEqual({ recordHours: true, bookLeave: true });
});

test('qnipay (Rota off): it boots on the tenant\'s own data, with no shifts, but leave and the recorded days still show', async () => {
  resetTo('qnipay');
  const r = await (await asEmail('bigyan.poudel@dogmagroup.co.uk'))('GET', '/api/v1/home');
  expect(r.status).toBe(200);
  const m = month(r);
  expect(m.person.code).toBe('EMP004');
  expect(m.greeting).toMatch(/^Good afternoon, Bigyan$/);
  expect(m.days.every(d => d.shift === null)).toBe(true);
  expect(m.totals.shifts).toBe(0);
  expect(dayOf(m, '2026-08-17')?.absence).toMatchObject({ mark: 'V', name: 'Annual leave' });
  expect(dayOf(m, '2026-08-12')).toMatchObject({ ts: { state: 'pend' }, glyph: 'pend' });
  expect(m.key.tones).toEqual([]);
  expect(m.summary).not.toMatch(/shift/);
});

test('turning Rota off reports the shifts cleared and empties the calendar of shifts while leave stays; turning it on restores the same calendar', async () => {
  const me = await asEmployee(), admin = caller(await tokenFor('admin'));
  const before = month(await me('GET', '/api/v1/home'));
  expect(before.totals.shifts).toBe(8);
  const off = await admin('PATCH', '/api/v1/tenant/modules/R', { on: false }, tenantVersion());
  expect(off.status).toBe(200);
  const offEffect = (off.body as { effect: { message: string; shiftsSetAside: number } }).effect;
  expect(offEffect.shiftsSetAside).toBeGreaterThan(0);
  expect(offEffect.message).toContain(`${offEffect.shiftsSetAside} scheduled shifts cleared from the calendar and kept to restore`);
  const during = month(await me('GET', '/api/v1/home'));
  expect(during.totals.shifts).toBe(0);
  expect(during.days.every(d => d.shift === null)).toBe(true);
  expect(during.totals.leaveDays).toBe(2);
  expect(dayOf(during, '2026-08-17')?.absence?.name).toBe('Annual leave');
  const on = await admin('PATCH', '/api/v1/tenant/modules/R', { on: true }, tenantVersion());
  expect(on.status).toBe(200);
  const onEffect = (on.body as { effect: { message: string; shiftsRestored: number } }).effect;
  expect(onEffect.shiftsRestored).toBe(offEffect.shiftsSetAside);
  expect(onEffect.message).toContain(`${onEffect.shiftsRestored} scheduled shifts restored to the calendar`);
  const after = month(await me('GET', '/api/v1/home'));
  expect(after.totals).toEqual(before.totals);
  expect(after.days.map(d => d.shift?.code ?? '')).toEqual(before.days.map(d => d.shift?.code ?? ''));
});

test('a rota week that is a draft paints nothing on the calendar', async () => {
  const w = store.coll<{ state: string }>('rotaWeeks')['rw_WH_2026-08-10'];
  if (w) w.state = 'draft';
  const m = month(await (await asEmployee())('GET', '/api/v1/home?month=2026-08'));
  expect(m.days.filter(d => d.date >= '2026-08-10' && d.date <= '2026-08-16').every(d => d.shift === null)).toBe(true);
  expect(dayOf(m, '2026-08-03')?.shift?.code).toBe('E');
});

test('the month must be inside the window: the month before this one to the rota horizon, else 422 on month', async () => {
  const me = await asEmployee();
  expect((await me('GET', '/api/v1/home?month=2026-07')).status).toBe(200);
  expect(month(await me('GET', '/api/v1/home?month=2027-08')).days).toHaveLength(31);
  for (const bad of ['2026-06', '2027-09']) {
    const r = await me('GET', `/api/v1/home?month=${bad}`);
    expect(r.status).toBe(422);
    expect(refusal(r)).toMatchObject({ code: 'invalid', field: 'month', message: 'The calendar runs from July 2026 to August 2027.', next: 'Choose a month in that range.' });
  }
  expect(refusal(await me('GET', '/api/v1/home?month=2026-13'))).toMatchObject({ field: 'month' });
  expect((await caller(await tokenFor('admin'))('GET', '/api/v1/home')).status).toBe(403);
});

test('documents: my seven and the payroll ones; one of mine opens, someone else\'s is not found; Documents off refuses both', async () => {
  const me = await asEmployee();
  const list = MyDocuments.parse((await me('GET', '/api/v1/documents/mine')).body);
  expect(list.items).toHaveLength(7);
  expect(list.items.every(d => d.personCode === 'CP-1042')).toBe(true);
  expect(list.payroll.map(d => d.name)).toEqual(['Payslips', 'P60 · 2025/26', 'P45']);
  expect((await me('GET', '/api/v1/documents/doc_CP-1042_3')).body).toMatchObject({ name: 'DBS certificate', date: '2024-03-31' });
  const mgr = caller(await tokenFor('manager'));
  expect(MyDocuments.parse((await mgr('GET', '/api/v1/documents/mine')).body).items).toEqual([]);
  const theirs = await mgr('GET', '/api/v1/documents/doc_CP-1042_3');
  expect(theirs.status).toBe(404);
  expect(refusal(theirs).code).toBe('not-found');
  (store.coll<{ flags: Record<string, unknown> }>('tenant').tenant ?? { flags: {} }).flags.DOCS = false;
  for (const path of ['/api/v1/documents/mine', '/api/v1/documents/doc_CP-1042_3']) {
    const r = await me('GET', path);
    expect(r.status).toBe(403);
    expect(refusal(r)).toMatchObject({ code: 'feature-off', message: 'Documents is switched off for this tenant.' });
  }
});
