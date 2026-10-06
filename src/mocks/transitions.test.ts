import { server } from './node';
import { store } from './store';
import { Refusal } from '@/contract/common';
import { transitionPerson } from '@/contract/people';
import { PERSON_STATES, canMove, transitionProblem } from '@/domain/lifecycle';
import { accountOf, audits, caller, fault, personOf, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));
const as = async (p: Persona) => caller(await tokenFor(p));
const WRITES = ['people', 'personHistory', 'audit'];
type Call = ReturnType<typeof caller>;
/* Signing in writes an audit row, so a test that snapshots the store signs in first and passes its caller. */
const moveWith = (call: Call, code: string, to: string, reason = 'Recorded in the test') => {
  const p = personOf(code);
  return call('POST', `/api/v1/people/${p.id}/transitions`, { to, reason }, p.version);
};
const move = async (code: string, to: string, reason = 'Recorded in the test', who: Persona = 'admin') =>
  moveWith(await as(who), code, to, reason);

test('CR An active record can become a leaver, with its reason kept on the record and in the audit', async () => {
  const r = await move('CP-1042', 'leaver', 'Resigned, last day 30 September');
  expect(r.status).toBe(200);
  const { record, auditId } = transitionPerson.response.parse(r.body);
  expect(record).toMatchObject({ state: 'leaver', end: '2026-08-13' });
  const history = Object.values(store.coll<{ personCode: string; field: string; reason?: string; source: string }>('personHistory'))
    .filter(h => h.personCode === 'CP-1042');
  expect(history.map(h => [h.field, h.source, h.reason])).toEqual([
    ['state', 'transition', 'Resigned, last day 30 September'], ['end', 'transition', 'Resigned, last day 30 September']]);
  expect(audits().find(a => a.id === auditId)).toMatchObject({ act: 'Employee leaver', entityId: 'CP-1042',
    before: { state: 'active' }, after: { state: 'leaver' }, reason: 'Resigned, last day 30 September' });
});

/* With Onboarding off the guard table alone decides; the onboarding gate on becoming active is module 5's (src/mocks/onboarding.test.ts). */
test('every from → to pair is allowed or refused exactly as the guard table says', async () => {
  for (const from of PERSON_STATES) for (const to of PERSON_STATES) {
    resetTo('social');
    const t = store.coll<{ modules: Record<string, boolean> }>('tenant').tenant;
    if (t) t.modules.ON = false;
    const fresh = caller(await tokenFor('admin'));
    const p = personOf('CP-1042');
    store.coll<{ state: string }>('people')[p.id] = { ...p, state: from };
    const before = snapshot(...WRITES);
    const r = await fresh('POST', `/api/v1/people/${p.id}/transitions`, { to, reason: 'Guard table' }, p.version);
    if (canMove(from, to)) {
      expect(r.status, `${from} → ${to}`).toBe(200);
      expect(personOf('CP-1042').state).toBe(to);
    } else {
      expect(r.status, `${from} → ${to}`).toBe(409);
      expect(Refusal.parse(r.body), `${from} → ${to}`).toMatchObject({ code: 'transition', ...transitionProblem(from, to) });
      expect(snapshot(...WRITES), `${from} → ${to}`).toEqual(before);
    }
  }
});

test('a state must be chosen', async () => {
  const r = await move('CP-1042', '');
  expect(r.status).toBe(422);
  expect(Refusal.parse(r.body)).toMatchObject({ field: 'to', message: 'Choose a state to move to.' });
});
test('an unknown state is refused', async () => {
  const r = await move('CP-1042', 'terminated');
  expect(r.status).toBe(422);
  expect(Refusal.parse(r.body).field).toBe('to');
});
test('a reason is required, and nothing changes without one', async () => {
  const call = await as('admin'), before = snapshot(...WRITES);
  const r = await moveWith(call, 'CP-1042', 'leaver', '   ');
  expect(r.status).toBe(422);
  expect(Refusal.parse(r.body)).toMatchObject({ field: 'reason', message: 'A reason is required. It is kept on the record.' });
  expect(snapshot(...WRITES)).toEqual(before);
});
test('a leaver who already has an end date keeps it', async () => {
  const p = personOf('CP-1042');
  store.coll<{ end: string }>('people')[p.id] = { ...p, end: '2026-09-30' };
  await move('CP-1042', 'leaver');
  expect(personOf('CP-1042').end).toBe('2026-09-30');
});
test('a stale version is refused with 412', async () => {
  const call = await as('admin'), p = personOf('CP-1042'), before = snapshot(...WRITES);
  const r = await call('POST', `/api/v1/people/${p.id}/transitions`, { to: 'leaver', reason: 'x' }, p.version + 1);
  expect(r.status).toBe(412);
  expect(snapshot(...WRITES)).toEqual(before);
});
test('a manager cannot move someone at another location', async () => {
  const mine = String(personOf(accountOf('manager').personCode).location);
  const other = Object.values(store.coll<{ code: string; location: string; state: string }>('people')).find(p => p.location !== mine && p.state === 'active');
  if (!other) throw new Error('the seed has nobody active outside the manager\'s location');
  const r = await move(other.code, 'suspended', 'x', 'manager');
  expect(r.status).toBe(403);
  expect(Refusal.parse(r.body).code).toBe('scope');
});
test('an employee is refused, naming the capability', async () => {
  const r = await move('CP-1042', 'leaver', 'x', 'employee');
  expect(r.status).toBe(403);
  expect(Refusal.parse(r.body).message).toContain('Add and edit people');
});
test('a fault leaves the store unchanged', async () => {
  const call = await as('admin'), p = personOf('CP-1042'), before = snapshot(...WRITES);
  await fault('POST', `/api/v1/people/${p.id}/transitions`);
  expect((await moveWith(call, 'CP-1042', 'leaver')).status).toBe(500);
  expect(snapshot(...WRITES)).toEqual(before);
});
