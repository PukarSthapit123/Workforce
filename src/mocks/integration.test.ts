import { server } from './node';
import { store } from './store';
import { Refusal, mutation } from '@/contract/common';
import { Dispatched, PostingLog } from '@/contract/integration';
import { IntegrationAttempt } from '@/contract/timesheets';
import { audits, caller, resetTo, tokenFor, type Persona } from '@/test/api-helpers';

/* social at the frozen clock (Thursday 13/08/2026 15:30): two postings
   posted by the simulated dispatcher in the current pay period (03/08 to
   16/08), and P's failed batch posting INT-a1f3, whose unresolved cause
   fails it on every dispatch. Only the administrator holds integration. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

const as = async (p: Persona) => caller(await tokenFor(p));
async function log() {
  const r = await (await as('admin'))('GET', '/api/v1/integration/attempts');
  expect(r.status).toBe(200);
  return PostingLog.parse(r.body);
}
const retry = async (id: string, v: number) => (await as('admin'))('POST', `/api/v1/integration/attempts/${id}/retry`, undefined, v);
const dispatch = async () => Dispatched.parse((await (await as('admin'))('POST', '/api/v1/integration/dispatch')).body);
const attemptAudits = () => audits().filter(a => a.entity === 'integrationAttempt');

describe('GET /api/v1/integration/attempts', () => {
  test('the log, newest first, with P\'s integration id, the attempt, the state and a summary that is hours, not money', async () => {
    const l = await log();
    expect(l.attempts.map(a => [a.integrationId, a.state, a.attempt])).toEqual([
      ['INT-ts5', 'posted', 1], ['INT-ts4', 'posted', 1], ['INT-a1f3', 'failed', 1]]);
    expect(l.attempts[2]).toMatchObject({ ref: 'Batch WK32 · generic API', summary: '14h', reason: 'Line 2: unknown cost centre CC-991', simulated: true });
    expect(l.attempts[1]).toMatchObject({ ref: 'Rosa Mendes · 10/08/2026', summary: 'STD 7.5h', event: 'Post to buffer' });
    for (const a of l.attempts) expect(a.summary).not.toMatch(/[£$€]/);
  });

  test('the tiles: posted this period, queued, failed, and the codes with an element out of all codes; the mapping is each code\'s element', async () => {
    const l = await log();
    expect(l.tiles).toEqual({ posted: 2, queued: 0, failed: 1, mapped: l.mapping.length, codes: l.mapping.length });
    expect(l.mapping.find(m => m.code === 'STD')).toMatchObject({ basis: 'multiplier', element: 'PE-STD', allowance: false });
    expect(l.mapping.filter(m => m.allowance).every(m => m.basis === 'flat' && m.element.startsWith('PE-'))).toBe(true);
    /* a code with no element is not mapped */
    const std = Object.values(store.coll<{ code: string; element: string }>('payCodes')).find(c => c.code === 'STD');
    if (std) std.element = '';
    expect((await log()).tiles).toMatchObject({ mapped: l.mapping.length - 1, codes: l.mapping.length });
  });

  test('reading the log resolves nothing: a queued record stays queued', async () => {
    const r = await retry('int_a1f3', 1);
    expect(r.status).toBe(200);
    expect((await log()).attempts.find(a => a.id === 'int_a1f3')).toMatchObject({ state: 'queued', attempt: 2 });
    expect((await log()).tiles).toMatchObject({ queued: 1, failed: 0 });
  });

  test('integration only: a manager and an employee are refused, with the standard refusal', async () => {
    for (const p of ['manager', 'employee'] as const) {
      const r = await (await as(p))('GET', '/api/v1/integration/attempts');
      expect(r.status, p).toBe(403);
      expect(Refusal.parse(r.body).next).toBeTruthy();
      expect((await (await as(p))('POST', '/api/v1/integration/dispatch')).status, p).toBe(403);
    }
  });
});

describe('retry from the log, then the dispatcher', () => {
  test('a failed row re-queues and counts; a queued or posted row gets 409 and writes nothing', async () => {
    const { record, auditId } = mutation(IntegrationAttempt).parse((await retry('int_a1f3', 1)).body);
    expect(record).toMatchObject({ state: 'queued', attempt: 2 });
    expect(audits().find(a => a.id === auditId)).toMatchObject({ act: 'Integration retry' });
    const before = attemptAudits().length;
    const again = await retry('int_a1f3', 2);
    expect(again.status).toBe(409);
    expect(Refusal.parse(again.body)).toMatchObject({ code: 'RETRY_NOT_ALLOWED', message: 'This posting is already queued.' });
    const posted = await retry('int_ts4', 1);
    expect(posted.status).toBe(409);
    expect(Refusal.parse(posted.body).message).toBe('This posting has already been posted.');
    expect(attemptAudits()).toHaveLength(before);
  });

  test('the dispatcher resolves the queued record (the unresolved cause fails it again), with one audit row; with nothing queued it writes none', async () => {
    await retry('int_a1f3', 1);
    const d = await dispatch();
    expect(d.resolved.map(a => [a.integrationId, a.state, a.attempt, a.reason])).toEqual([['INT-a1f3', 'failed', 2, 'Line 2: unknown cost centre CC-991']]);
    expect(audits().find(a => a.id === d.auditId)).toMatchObject({ act: 'Postings dispatched', entity: 'integrationAttempt', entityId: 'int_a1f3',
      after: { detail: '1 resolved by the dispatcher: 0 posted (unconfirmed), 1 failed' } });
    expect((await log()).tiles).toMatchObject({ queued: 0, failed: 1 });
    const count = attemptAudits().length;
    expect(await dispatch()).toEqual({ resolved: [], auditId: null });
    expect(attemptAudits()).toHaveLength(count);
  });

  test('a record with no cause posts (simulated) when dispatched', async () => {
    const a = store.coll<{ state: string; cause?: string; reason?: string }>('integrationAttempts').int_a1f3;
    if (a) { delete a.cause; delete a.reason; a.state = 'queued'; }
    const d = await dispatch();
    expect(d.resolved).toEqual([expect.objectContaining({ integrationId: 'INT-a1f3', state: 'posted', simulated: true })]);
    expect(d.resolved[0]?.reason).toBeUndefined();
  });
});
