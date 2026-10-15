import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { RotaSetup, RotaWeekView, SupportLevelList } from '@/contract/rota';
import { audits, caller, tokenFor, resetTo, type Persona } from '@/test/api-helpers';

/* Module 8 group 5: Rota setup's support levels, with their employees per
   shift, and the flexible-worker milestones and who is told. One audit row
   per save; a level's new number is set on every location at that level. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

const as = async (p: Persona) => caller(await tokenFor(p));
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
interface Loc { code: string; level: string; minPerShift: number; version: number }
const loc = (code: string) => Object.values(store.coll<Loc>('locations')).find(l => l.code === code);
const LEVELS = [{ code: 'High', label: 'High support', min: 4 }, { code: 'Medium', label: 'Medium support', min: 3 },
  { code: 'Low', label: 'Low support', min: 2 }, { code: 'Floating', label: 'Floating support', min: 1 }];
const withMin = (code: string, min: number) => LEVELS.map(l => (l.code === code ? { ...l, min } : l));
const setupAuditActs = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);

test('the seeded levels are the prototype\'s, and anyone signed in reads them for the location form', async () => {
  expect(RotaSetup.parse((await (await as('admin'))('GET', '/api/v1/rota/config')).body).config.supportLevels).toEqual(LEVELS);
  const r = await (await as('employee'))('GET', '/api/v1/rota/support-levels');
  expect(r.status).toBe(200);
  expect(SupportLevelList.parse(r.body).items).toEqual(LEVELS);
});

test('a level\'s new employees per shift is set on every location at that level, with one audit row naming them, and the rota needs it', async () => {
  const call = await as('admin');
  const wh = loc('WH');
  expect(wh).toMatchObject({ level: 'High', minPerShift: 4 });
  const r = await call('PATCH', '/api/v1/rota/config', { supportLevels: withMin('High', 5) }, 1);
  expect(r.status).toBe(200);
  expect(loc('WH')).toMatchObject({ minPerShift: 5, version: (wh?.version ?? 0) + 1 });
  const highs = Object.values(store.coll<Loc>('locations')).filter(l => l.level === 'High').map(l => l.code);
  expect(setupAuditActs()).toEqual(['Rota setup saved']);
  const row = audits().find(a => a.act === 'Rota setup saved');
  expect(row?.before).toEqual({ supportLevels: LEVELS });
  expect(row?.after).toEqual({ supportLevels: withMin('High', 5), locations: Object.fromEntries(highs.map(c => [c, 5])) });
  /* Team rota measures Willow House against the new number */
  const w = RotaWeekView.parse((await (await as('manager'))('GET', '/api/v1/rota/weeks/WH/2026-08-10')).body);
  expect(w.min).toBe(5);
});

test('levels keep their names and order, and each number is a whole number of employees', async () => {
  const call = await as('admin');
  const renamed = await call('PATCH', '/api/v1/rota/config', { supportLevels: LEVELS.map(l => (l.code === 'Low' ? { ...l, label: 'Light support' } : l)) }, 1);
  expect(renamed.status).toBe(422);
  expect(refusal(renamed)).toMatchObject({ field: 'supportLevels', message: 'Support levels keep their names and order. Only the employees per shift can be changed.' });
  const zero = await call('PATCH', '/api/v1/rota/config', { supportLevels: withMin('Medium', 0) }, 1);
  expect(refusal(zero)).toMatchObject({ field: 'supportLevels.Medium', message: 'Medium support needs a whole number of employees per shift from 1 to 50.' });
  expect(loc('WH')?.minPerShift).toBe(4);
  expect(setupAuditActs()).toEqual([]);
});

test('the milestones and who is told save with one audit row; the list must run earliest first, and the recipient come from the list', async () => {
  const call = await as('admin');
  const r = await call('PATCH', '/api/v1/rota/config', { flexMilestones: [6, 10], flexNotifyTo: 'Service Manager' }, 1);
  expect(r.status).toBe(200);
  expect(audits().find(a => a.act === 'Rota setup saved')).toMatchObject({
    before: { flexMilestones: [9, 12], flexNotifyTo: 'HR administrators' }, after: { flexMilestones: [6, 10], flexNotifyTo: 'Service Manager' } });
  expect(refusal(await call('PATCH', '/api/v1/rota/config', { flexMilestones: [12, 9] }, 2)))
    .toMatchObject({ field: 'flexMilestones', message: 'List the milestones from the earliest to the latest, each once.' });
  expect(refusal(await call('PATCH', '/api/v1/rota/config', { flexMilestones: [] }, 2))).toMatchObject({ field: 'flexMilestones' });
  expect(refusal(await call('PATCH', '/api/v1/rota/config', { flexNotifyTo: 'Everyone' }, 2)))
    .toMatchObject({ field: 'flexNotifyTo', message: 'Choose who is notified from the list.' });
});

test('only Configure modules changes them: the manager and the employee are refused and nothing moves', async () => {
  for (const p of ['manager', 'employee'] as const) {
    const r = await (await as(p))('PATCH', '/api/v1/rota/config', { supportLevels: withMin('High', 6), flexMilestones: [4] }, 1);
    expect(r.status).toBe(403);
    expect(refusal(r).code).toBe('capability');
  }
  expect(loc('WH')?.minPerShift).toBe(4);
  expect(setupAuditActs()).toEqual([]);
});
