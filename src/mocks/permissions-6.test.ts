import { server } from './node';
import { Refusal } from '@/contract/common';
import { ExceptionList } from '@/contract/exceptions';
import { caller, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

/* Module 6 group 6: the permission sweep. Each write module 6 added, and
   that no other test already refuses for a persona without its capability,
   is refused here with 403 capability, and nothing is written. Refused
   elsewhere: the Team hours export (hours.test.ts), taking an exception
   (exceptions.test.ts), creating and removing a pay code (pay-codes.test.ts),
   exporting a payroll period (payroll.test.ts) and the dispatcher
   (integration.test.ts). Every gated endpoint is also checked against the
   one capability its contract names in src/contract/capability.test.ts. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

const as = async (p: Persona) => caller(await tokenFor(p));
const refused = (r: { status: number; body: unknown }) => [r.status, Refusal.parse(r.body).code];
const WRITES = ['exceptionHandling', 'payCodes', 'payrollRuns', 'integrationAttempts', 'timesheetDays', 'audit'];

test('without Team hours, the employee and the administrator cannot move an exception the manager has taken: release, resolve, ignore or reopen', async () => {
  const mgr = await as('manager');
  const x = ExceptionList.parse((await mgr('GET', '/api/v1/exceptions')).body).items[0];
  if (!x) throw new Error('no exception at Willow House');
  expect((await mgr('POST', `/api/v1/exceptions/${x.id}/take`, undefined, 0)).status).toBe(200);
  const calls = { employee: await as('employee'), admin: await as('admin') }, before = snapshot(...WRITES);
  for (const p of ['employee', 'admin'] as const) {
    const call = calls[p];
    for (const [move, body] of [['release', undefined], ['resolve', { note: 'Done' }], ['ignore', { reason: 'Accepted' }], ['reopen', undefined]] as const)
      expect([p, move, ...refused(await call('POST', `/api/v1/exceptions/${x.id}/${move}`, body, 1))]).toEqual([p, move, 403, 'capability']);
  }
  expect(snapshot(...WRITES)).toEqual(before);
});

test('without Workforce master data, the manager and the employee cannot edit a pay code', async () => {
  const calls = { manager: await as('manager'), employee: await as('employee') }, before = snapshot(...WRITES);
  for (const p of ['manager', 'employee'] as const)
    expect([p, ...refused(await calls[p]('PATCH', '/api/v1/pay-codes/pc_OT20', { value: '3' }, 1))]).toEqual([p, 403, 'capability']);
  expect(snapshot(...WRITES)).toEqual(before);
});

test('without Integration, the manager and the employee cannot reconcile or reopen a payroll period, or retry a failed posting', async () => {
  const calls = { manager: await as('manager'), employee: await as('employee') }, before = snapshot(...WRITES);
  for (const p of ['manager', 'employee'] as const) {
    const call = calls[p];
    for (const [path, body] of [
      ['/api/v1/payroll/runs/run_2026-08-03/reconcile', undefined],
      ['/api/v1/payroll/runs/run_2026-08-03/reopen', { reason: 'A late correction' }],
      ['/api/v1/integration/attempts/int_a1f3/retry', undefined],
    ] as const) expect([p, path, ...refused(await call('POST', path, body, path.includes('retry') ? 1 : 0))]).toEqual([p, path, 403, 'capability']);
  }
  expect(snapshot(...WRITES)).toEqual(before);
});
