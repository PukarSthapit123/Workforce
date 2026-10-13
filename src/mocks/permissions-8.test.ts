import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { TemplateApplied } from '@/contract/templates';
import { caller, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

/* Module 8 group 6: the permission sweep. Each write module 8 added or
   changed, and that no other test already refuses for a caller without its
   capability, is refused here with 403 capability, and nothing is written.
   The rest of the sweep (onboarding documents, sign-off, the three approval
   decisions, Leave, Rota and Onboarding setup, templates, chains and the
   notification matrix) is refused in its own module's tests. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

const as = async (p: Persona) => caller(await tokenFor(p));
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const WRITES = ['tenant', 'timesheetConfig', 'timesheetDays', 'integrationAttempts', 'leaveConfig', 'leaveRequests', 'leaveLedger',
  'rotaWeeks', 'coverRequests', 'notifications', 'audit'];
const refused = (r: { status: number; body: unknown }) => [r.status, refusal(r).code];
/* Takes a capability off a user type, as an administrator would on Permissions. */
function revoke(type: Persona, cap: string) {
  const t = store.coll<{ capabilities: string[] }>('userTypes')[type];
  if (!t) throw new Error(`no ${type} user type`);
  t.capabilities = t.capabilities.filter(c => c !== cap);
}

test('a manager without Workforce master data is refused each new Date and time and Calendar setting', async () => {
  const mgr = await as('manager'), before = snapshot(...WRITES);
  const v = store.coll<{ version: number }>('tenant').tenant?.version ?? 1;
  for (const body of [
    { timezone: 'Asia/Kathmandu' }, { dateFormat: 'yyyy-mm-dd' }, { clock: '12h' }, { weekStart: 'Sunday' }, { fullTimeWeeklyHours: 40 },
    { financialYear: { start: '2026-04-01', end: '2027-03-31' } }, { bankHolidays: [] },
  ]) expect([Object.keys(body)[0], ...refused(await mgr('PATCH', '/api/v1/tenant/settings', body, v))]).toEqual([Object.keys(body)[0], 403, 'capability']);
  expect(snapshot(...WRITES)).toEqual(before);
});

test('only Configure modules saves Timesheet setup: the cut-off, lock, return reason and rules are refused to the manager and the employee', async () => {
  const calls = { manager: await as('manager'), employee: await as('employee') }, before = snapshot(...WRITES);
  for (const p of ['manager', 'employee'] as const) {
    const call = calls[p];
    for (const body of [{ cutoff: 'Sunday 23:59' }, { returnReasonRequired: false }, { rules: { enforceLock: false, minNet: 30 } }])
      expect([p, ...refused(await call('PATCH', '/api/v1/timesheet-config', body, 1))]).toEqual([p, 403, 'capability']);
  }
  expect(snapshot(...WRITES)).toEqual(before);
});

test('an employee, who decides no layer of the Timesheet chain, is refused a bulk approval', async () => {
  const emp = await as('employee'), before = snapshot(...WRITES);
  const r = await emp('POST', '/api/v1/approvals/timesheets/bulk', { ids: ['tsd_CP-1042_2026-08-12'], checksum: 'x' });
  expect(refused(r)).toEqual([403, 'capability']);
  expect(snapshot(...WRITES)).toEqual(before);
});

test('a manager without Configure modules is refused a new policy, a new leave type and the sickness reasons on Leave setup', async () => {
  const mgr = await as('manager'), before = snapshot(...WRITES);
  for (const body of [{ policies: [] }, { types: [] }, { sicknessReasons: ['Other'] }])
    expect(refused(await mgr('PATCH', '/api/v1/leave/config', body, 1))).toEqual([403, 'capability']);
  expect(snapshot(...WRITES)).toEqual(before);
});

test('an employee without Team rota is refused a copy, a repeat and an accepted plan, which now count weeks from the week start', async () => {
  const emp = await as('employee'), before = snapshot(...WRITES), wk = '/api/v1/rota/weeks/WH/2026-08-17';
  for (const [method, path, body] of [['POST', `${wk}/copy`, undefined], ['POST', `${wk}/repeat`, { weeks: 2 }],
    ['POST', `${wk}/plan/accept`, { items: [] }]] as const)
    expect([path, ...refused(await emp(method, path, body, 0))]).toEqual([path, 403, 'capability']);
  expect(snapshot(...WRITES)).toEqual(before);
});

test('without My timesheet an employee cannot save or submit a day, a week or earlier weeks, and no notification is raised', async () => {
  revoke('employee', 'own_ts');
  const emp = await as('employee'), before = snapshot(...WRITES);
  const day = { entries: [{ start: '07:00', finish: '15:00', breaks: [{ start: '11:00', end: '11:30' }] }], shift: 'E' };
  for (const [method, path, body, v] of [
    ['PUT', '/api/v1/timesheets/CP-1042/days/2026-08-13', day, 0],
    ['POST', '/api/v1/timesheets/CP-1042/days/2026-08-13/submit', day, 0],
    ['POST', '/api/v1/timesheets/CP-1042/weeks/2026-08-10/submit', { days: [{ date: '2026-08-13', version: 0, ...day }] }, undefined],
    ['POST', '/api/v1/timesheets/CP-1042/multiweek/submit', { weeks: ['2026-08-03'] }, undefined],
  ] as const) expect([path, ...refused(await emp(method, path, body, v))]).toEqual([path, 403, 'capability']);
  expect(snapshot(...WRITES)).toEqual(before);
});

test('without My leave an employee cannot ask for leave or cancel her own request, and nobody is told', async () => {
  revoke('employee', 'own_leave');
  const emp = await as('employee'), before = snapshot(...WRITES);
  expect(refused(await emp('POST', '/api/v1/leave/requests', { type: 'AL', part: 'full', from: '2026-09-14', to: '2026-09-14' }))).toEqual([403, 'capability']);
  expect(refused(await emp('POST', '/api/v1/leave/requests/lr_3/cancel', undefined, 1))).toEqual([403, 'capability']);
  expect(snapshot(...WRITES)).toEqual(before);
});

test('without Workforce master data, a template apply leaves the time zone and the other date and time settings alone (review I4)', async () => {
  const admin = await as('admin');
  const saved = await admin('POST', '/api/v1/templates', { name: 'Kept settings', description: '', scope: 'config' });
  expect(saved.status).toBe(200);
  const tenant = store.coll<{ version: number; timezone: string }>('tenant').tenant;
  if (!tenant) throw new Error('no tenant');
  tenant.timezone = 'Asia/Kathmandu';
  revoke('admin', 'master_data');
  const after = await as('admin'), before = snapshot('tenant');
  expect(refused(await after('PATCH', '/api/v1/tenant/settings', { timezone: 'Europe/London' }, tenant.version))).toEqual([403, 'capability']);
  expect(snapshot('tenant')).toEqual(before);
  const r = await after('POST', '/api/v1/templates/tpl_kept_settings/apply', undefined, tenant.version);
  expect(r.status).toBe(200);
  const applied = TemplateApplied.parse(r.body);
  expect(applied.plan.leftAlone).toContainEqual({ area: 'organisation', text: 'Date, time and calendar stay as they are. Changing them needs Workforce master data.' });
  expect(applied.plan.changes.filter(l => l.area === 'organisation')).toEqual([]);
  expect(store.coll<{ timezone: string }>('tenant').tenant?.timezone).toBe('Asia/Kathmandu');
});
