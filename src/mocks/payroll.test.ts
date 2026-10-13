import { server } from './node';
import { store } from './store';
import { exceptionsEverywhere } from './exceptions';
import { Refusal } from '@/contract/common';
import { PayrollExported, PayrollReadiness, RunMoved } from '@/contract/payroll';
import { audits, caller, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

/* social at the frozen clock (Thursday 13/08/2026, 15:30 in London): paid
   fortnightly from Friday 21/08 with weeks ending Sunday, so the current pay
   period is 03/08 to 16/08 and the previous one, 20/07 to 02/08, closed at
   the Monday 12:00 cut-off on 03/08. The period has days awaiting a decision,
   one sent back, a failed batch posting, critical exceptions and colleagues
   with no Business Central resource number, so it is NOT READY. Only the
   administrator holds integration. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

const as = async (p: Persona) => caller(await tokenFor(p));
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const runAudits = () => audits().filter(a => a.entity === 'payrollRun');
async function readiness() {
  const r = await (await as('admin'))('GET', '/api/v1/payroll/readiness');
  expect(r.status).toBe(200);
  return PayrollReadiness.parse(r.body);
}
const post = async (id: string, act: string, ifMatch: number, body?: unknown, p: Persona = 'admin') =>
  (await as(p))('POST', `/api/v1/payroll/runs/${id}/${act}`, body, ifMatch);

type Day = { personCode: string; date: string; state: string };
const days = () => store.coll<Day>('timesheetDays');
const inPeriod = (d: Day) => d.date >= '2026-08-03' && d.date <= '2026-08-16';
/* Clears every blocker the seed has: each submitted day approved, the failed posting posted, each
   open exception resolved, everyone given a resource number. Drafts and posted records remain, as warnings. */
function clearBlockers() {
  for (const d of Object.values(days())) if (d.state !== 'draft') d.state = 'ok';
  for (const a of Object.values(store.coll<{ state: string }>('integrationAttempts'))) if (a.state === 'failed') a.state = 'posted';
  for (const p of Object.values(store.coll<{ code: string; resource: string }>('people'))) p.resource = `R-${p.code}`;
  const handling = store.coll('exceptionHandling');
  for (const x of exceptionsEverywhere()) handling[x.id] = { id: x.id, version: 1, updatedAt: store.now(), key: x.key, kind: x.kind, subject: x.subject,
    firstRecorded: store.now(), state: 'resolved', owner: null, resolution: 'Cleared for the test', history: [] };
  /* nothing missing: the published rota's past days are taken as recorded by switching Rota off */
  const t = store.coll<{ modules: Record<string, boolean> }>('tenant').tenant;
  if (t) t.modules.R = false;
}

describe('readiness (integration)', () => {
  test('the period from Organisation\'s settings, the previous period\'s lock and the cut-off next to it, and P\'s blockers with where each is put right', async () => {
    const r = await readiness();
    expect(r.period).toEqual({ start: '2026-08-03', end: '2026-08-16', frequency: 'Fortnightly', anchored: true, closesAt: { date: '2026-08-17', time: '12:00' } });
    expect(r.previous).toEqual({ start: '2026-07-20', end: '2026-08-02', locked: true, closesAt: { date: '2026-08-03', time: '12:00' } });
    expect([r.cutoff, r.enforced]).toEqual(['Monday 12:00', true]);
    expect(r.state).toBe('notready');
    expect(r.blockers.map(b => [b.key, b.count, b.go])).toEqual(expect.arrayContaining([
      ['awaiting', 3, 'tteam'], ['back', 1, 'tteam'], ['failed', 1, 'ibc'], ['resource', 6, 'apeople']]));
    expect(r.blockers.map(b => b.key)).toContain('missing');
    expect(r.figures.awaiting).toBe(4);
    expect(r.run).toMatchObject({ id: 'run_2026-08-03', version: 0, state: 'open', exported: null, history: [] });
    expect(JSON.stringify(r)).not.toMatch(/[£$€]|amount|currency/i);
  });

  test('a day approved by the manager and waiting on payroll blocks; the period follows the pay frequency; the lock follows the cut-off (CHUNK-B B2)', async () => {
    const d = Object.values(days()).find(x => inPeriod(x) && x.state === 'pend');
    if (!d) throw new Error('no pending day in the period');
    d.state = 'mgrok';
    expect((await readiness()).blockers.find(b => b.key === 'mgrok')).toMatchObject({ count: 1, label: 'Waiting on payroll', go: 'tteam' });

    const company = store.coll<{ company: Record<string, string> }>('tenant').tenant?.company;
    if (!company) throw new Error('no company');
    company.payFrequency = 'Weekly';
    expect((await readiness()).period).toMatchObject({ start: '2026-08-10', end: '2026-08-16' });
    company.payFrequency = 'Monthly';
    expect((await readiness()).period).toMatchObject({ start: '2026-08-01', end: '2026-08-31', frequency: 'Monthly' });
    company.payFrequency = 'Fortnightly'; company.firstPayDate = '';
    expect((await readiness()).blockers[0]).toMatchObject({ key: 'settings', go: 'aorg' });

    const cfg = store.coll<{ rules: { enforceLock: boolean }; cutoff: string }>('timesheetConfig').timesheetConfig;
    if (!cfg) throw new Error('no timesheet config');
    cfg.cutoff = 'Tuesday 09:00';
    expect((await readiness()).previous.closesAt).toEqual({ date: '2026-08-04', time: '09:00' });
    cfg.rules.enforceLock = false;
    expect((await readiness())).toMatchObject({ enforced: false, previous: { locked: false } });
  });

  test('a session without integration is refused, to read and to write', async () => {
    const r = await (await as('manager'))('GET', '/api/v1/payroll/readiness');
    expect([r.status, refusal(r).code]).toEqual([403, 'capability']);
    const w = await post('run_2026-08-03', 'export', 0, undefined, 'manager');
    expect([w.status, refusal(w).code]).toEqual([403, 'capability']);
    expect(runAudits()).toEqual([]);
  });
});

describe('export, reconcile and reopen (If-Match on the run)', () => {
  test('export is refused while NOT READY, with P\'s message, and writes nothing', async () => {
    const admin = await as('admin'), before = snapshot('payrollRuns', 'audit');
    const r = await admin('POST', '/api/v1/payroll/runs/run_2026-08-03/export', undefined, 0);
    expect([r.status, refusal(r).code, refusal(r).message]).toEqual([409, 'NOT_READY', 'Clear the blockers before exporting.']);
    expect(snapshot('payrollRuns', 'audit')).toEqual(before);
  });

  test('export: a real file of the period\'s approved days, its true row count, hours and pay codes and no money, one audit row; then EXPORTED', async () => {
    clearBlockers();
    expect((await readiness()).state).toBe('warnings');
    const approved = Object.values(days()).filter(d => inPeriod(d) && d.state === 'ok');
    expect(approved.length).toBeGreaterThan(0);

    const r = await post('run_2026-08-03', 'export', 0);
    expect(r.status).toBe(200);
    const x = PayrollExported.parse(r.body);
    expect(x.fileName).toBe('qnipay-payroll-03-08-2026.csv');
    expect(x.rows[0]).toEqual(['Employee ID', 'Name', 'Resource no.', 'Date', 'Shift', 'Pay code', 'Pay elements', 'Allowances', 'Hours', 'State', 'Integration']);
    expect([x.count, x.rows.length - 1]).toEqual([approved.length, approved.length]);
    expect(x.rows.slice(1).map(row => row[0]).sort()).toEqual(approved.map(d => d.personCode).sort());
    expect(x.rows.slice(1).every(row => row[9] === 'Approved' && typeof row[8] === 'number')).toBe(true);
    expect(JSON.stringify(x.rows)).not.toMatch(/[£$€]|amount|rate|cost|currency/i);
    expect(x.message).toBe(`Exported · ${approved.length} approved record${approved.length === 1 ? '' : 's'} · qnipay-payroll-03-08-2026.csv`);
    expect(x.run).toMatchObject({ id: 'run_2026-08-03', version: 1, state: 'exported',
      exported: { rows: approved.length, fileName: x.fileName, by: { name: expect.any(String) } } });
    expect(runAudits()).toEqual([expect.objectContaining({ id: x.auditId, act: 'Payroll exported', entityId: 'run_2026-08-03', before: { state: 'open' },
      after: { state: 'exported', period: '2026-08-03 to 2026-08-16', rows: approved.length, fileName: x.fileName } })]);
    expect(store.coll('payrollRuns')['run_2026-08-03']).toMatchObject({ state: 'exported', version: 1 });

    const after = await readiness();
    expect([after.state, after.run.version]).toEqual(['exported', 1]);
  });

  test('reconcile from EXPORTED only; reopen needs a reason; illegal moves are refused with 409; each move one audit row', async () => {
    clearBlockers();
    expect((await post('run_2026-08-03', 'reconcile', 0)).status).toBe(409);
    const reopenOpen = await post('run_2026-08-03', 'reopen', 0, { reason: 'Why not' });
    expect([reopenOpen.status, refusal(reopenOpen).code]).toEqual([409, 'ILLEGAL_TRANSITION']);
    expect((await post('run_2026-08-03', 'export', 0)).status).toBe(200);

    const again = await post('run_2026-08-03', 'export', 1);
    expect([again.status, refusal(again).code, refusal(again).message]).toEqual([409, 'ILLEGAL_TRANSITION', 'This period is already exported.']);

    const rec = await post('run_2026-08-03', 'reconcile', 1);
    expect(rec.status).toBe(200);
    expect(RunMoved.parse(rec.body)).toMatchObject({ run: { version: 2, state: 'reconciled', reconciled: { by: { name: expect.any(String) } } },
      message: 'Reconciled · recorded against the period and the audit log' });
    expect((await readiness()).state).toBe('reconciled');
    expect((await post('run_2026-08-03', 'reconcile', 2)).status).toBe(409);

    const noReason = await post('run_2026-08-03', 'reopen', 2, { reason: ' ' });
    expect([noReason.status, refusal(noReason).field, refusal(noReason).message]).toEqual([422, 'reason', 'A reason for reopening is required.']);
    const reopened = await post('run_2026-08-03', 'reopen', 2, { reason: 'A late correction from Willow House' });
    expect(reopened.status).toBe(200);
    const run = RunMoved.parse(reopened.body).run;
    expect(run).toMatchObject({ version: 3, state: 'open', exported: null, reconciled: null });
    expect(run.history.map(h => [h.from, h.to, h.rows, h.reason])).toEqual([
      ['open', 'exported', expect.any(Number), ''], ['exported', 'reconciled', null, ''], ['reconciled', 'open', null, 'A late correction from Willow House']]);
    expect(runAudits().map(a => a.act)).toEqual(['Payroll exported', 'Payroll reconciled', 'Payroll period reopened']);
    expect(runAudits().at(-1)?.after).toMatchObject({ state: 'open', reason: 'A late correction from Willow House' });
    expect((await readiness()).state).toBe('warnings');
  });

  test('a stale or missing If-Match is refused (412, 428), and a run id that names no period is not found', async () => {
    clearBlockers();
    const stale = await post('run_2026-08-03', 'export', 3);
    expect([stale.status, refusal(stale).code]).toEqual([412, 'stale']);
    const none = await (await as('admin'))('POST', '/api/v1/payroll/runs/run_2026-08-03/export');
    expect(none.status).toBe(428);
    for (const id of ['run_2026-08-10', 'run_2026-08-17', 'nonsense']) {
      const r = await post(id, 'export', 0);
      expect([id, r.status]).toEqual([id, 404]);
    }
    expect(runAudits()).toEqual([]);
  });
});
