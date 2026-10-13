/* Module 6 journeys on social at the frozen clock (Thursday 13/08/2026): the
   pay period is 03/08 to 16/08 (fortnightly, weeks ending Sunday), and it is
   NOT READY: days await a decision, one is sent back, the batch posting
   int_a1f3 failed on an unknown cost centre, critical exceptions are open
   and colleagues have no Business Central resource number. */
import { expect, type Page } from '@playwright/test';
import { sendVersioned } from './timesheet';
import { grantAdmin } from './approvals';
import type { Reply } from './read';

type Api = { get(path: string): Promise<Reply> };
export const RUN = 'run_2026-08-03';
export const FAILED_POSTING = 'int_a1f3';
export interface ExceptionRead { id: string; key: string; kind: string; subject: string; severity: number; state: string; version: number; location: string | null }
export interface ExceptionsRead { location: { code: string }; locations: { code: string; name: string }[]; items: ExceptionRead[] }
export const exceptionsAt = async (api: Api, location = ''): Promise<ExceptionsRead> => {
  const r = await api.get(`/api/v1/exceptions${location ? `?location=${location}` : ''}`);
  expect(r.status, 'exceptions').toBe(200);
  return r.body as ExceptionsRead;
};
export interface ReadinessRead { state: string; blockers: { key: string }[]; warnings: { key: string }[]; run: { version: number; state: string } }
export const readinessOf = async (api: Api): Promise<ReadinessRead> => {
  const r = await api.get('/api/v1/payroll/readiness');
  expect(r.status, 'readiness').toBe(200);
  return r.body as ReadinessRead;
};

/* Signed in as the administrator: everything that blocks the period is put
   right, as payroll would before a handover, so the period is ready with
   warnings. Approving each day, posting the failed batch, giving everyone a
   resource number and switching Rota off (so no past rota'd day counts as
   missing) are written straight into the fake server's store, as unit tests'
   clearBlockers does, since the journeys that do each one are other modules'.
   The critical exceptions that remain are ignored through the real endpoint,
   with a reason, which needs Team hours. */
export async function clearPayrollBlockers(page: Page, api: Api) {
  await page.evaluate(() => {
    const raw = localStorage.getItem('qnipay.app.store');
    if (!raw) throw new Error('no persisted store');
    const s = JSON.parse(raw) as { data: Record<string, Record<string, Record<string, unknown>>> };
    const each = (c: string) => Object.values(s.data[c] ?? {});
    for (const d of each('timesheetDays')) if (d.state !== 'draft') d.state = 'ok';
    for (const a of each('integrationAttempts')) if (a.state === 'failed') a.state = 'posted';
    for (const p of each('people')) p.resource = `R-${String(p.code)}`;
    const t = s.data.tenant?.tenant as { modules: Record<string, boolean> } | undefined;
    if (t) t.modules.R = false;
    localStorage.setItem('qnipay.app.store', JSON.stringify(s));
    /* a new revision makes the fake server load what was written before it answers again */
    localStorage.setItem('qnipay.app.store.rev', `e2e-${Date.now()}`);
  });
  await grantAdmin(page, api, 'team_hours');
  const { locations } = await exceptionsAt(api);
  for (const l of locations) {
    for (const x of (await exceptionsAt(api, l.code)).items.filter(i => i.severity >= 4 && i.state === 'open')) {
      const r = await sendVersioned(page, 'POST', `/api/v1/exceptions/${x.id}/ignore`, x.version, { reason: 'Accepted for this period by payroll' });
      expect([x.kind, r.status]).toEqual([x.kind, 200]);
    }
  }
  expect((await readinessOf(api)).blockers.map(b => b.key)).toEqual([]);
}
