/* Module 8's approval-chain states, set up straight on the server, for the
   accessibility and visual checks that need a screen part-way through a
   chain. On social: Dee Fitzgerald, the administrator, is given the
   capabilities a second layer needs and becomes it on all three chains;
   Rachel Hussain, the line manager at Willow House, then decides the first
   layer of a timesheet day, a leave request and a rota week, which leaves
   each waiting on Dee. */
import { expect, type Page } from '@playwright/test';
import { signInEmail, sendVersioned, dayState } from './timesheet';
import { DEE, RACHEL, W34, rotaWeek, weekPath } from './rota';
import type { Reply } from './read';

type Api = { get(path: string): Promise<Reply> };
interface Layer { role: string; scope: string; when: string; sla: string; fixed: boolean }
interface Chain { module: string; version: number; steps: Layer[] }

export const AMARA_DAY = 'tsd_CP-1042_2026-08-12';
/* Priya's seeded waiting request at Willow House */
export const PRIYA_REQUEST = 'lr_1';

/* Signed in as an administrator: give the administrator template a capability. */
export async function grantAdmin(page: Page, api: Api, cap: string) {
  const types = (await api.get('/api/v1/user-types')).body as { id: string; version: number }[];
  const admin = types.find(t => t.id === 'admin');
  if (!admin) throw new Error('no admin user type');
  expect((await sendVersioned(page, 'PUT', `/api/v1/user-types/admin/capabilities/${cap}`, admin.version, { granted: true })).status).toBe(200);
}

/* Signed in as an administrator: a module's chain becomes these layers, before its fixed posting step. */
export async function setChain(page: Page, api: Api, module: string, layers: Omit<Layer, 'fixed'>[]) {
  const chain = ((await api.get('/api/v1/approvals/chains')).body as { chains: Chain[] }).chains.find(c => c.module === module);
  if (!chain) throw new Error(`no ${module} chain`);
  const steps = [...layers.map(l => ({ ...l, fixed: false })), ...chain.steps.filter(s => s.fixed)];
  expect((await sendVersioned(page, 'PUT', `/api/v1/approvals/chains/${module}`, chain.version, { steps })).status, `${module} chain`).toBe(200);
}

export async function waitingOnDee(page: Page, api: Api) {
  await signInEmail(page, DEE);
  await grantAdmin(page, api, 'team_rota');
  await grantAdmin(page, api, 'team_leave');
  /* week 34 is empty, so its gaps would block publishing */
  const rc = (await api.get('/api/v1/rota/config')).body as { config: { version: number } };
  expect((await sendVersioned(page, 'PATCH', '/api/v1/rota/config', rc.config.version, { publishBlockOnGap: false })).status).toBe(200);
  await setChain(page, api, 'Timesheet', [
    { role: 'Line manager', scope: 'Own department', when: 'Every timesheet', sla: '24 hours' },
    { role: 'Payroll', scope: 'All departments', when: 'Every timesheet', sla: '48 hours' }]);
  await setChain(page, api, 'Leave', [
    { role: 'Line manager', scope: 'Own department', when: 'Every leave request', sla: '5 days' },
    { role: 'Service Manager', scope: 'All departments', when: 'Every leave request', sla: '2 days' }]);
  await setChain(page, api, 'Rota', [
    { role: 'Service Manager', scope: 'Own location', when: 'Every rota week', sla: '4 hours' },
    { role: 'Service Manager', scope: 'All departments', when: 'Every rota week', sla: '4 hours' }]);

  await signInEmail(page, RACHEL);
  const day = await dayState(api, 'CP-1042', '2026-08-12');
  expect((await sendVersioned(page, 'POST', `/api/v1/timesheet-days/${AMARA_DAY}/transition`, day.version, { to: 'ok', reason: '' })).status).toBe(200);
  const lr = ((await api.get('/api/v1/leave/team/requests')).body as { requests: { id: string; version: number }[] }).requests.find(r => r.id === PRIYA_REQUEST);
  if (!lr) throw new Error(`${PRIYA_REQUEST} is not in Rachel's queue`);
  expect((await sendVersioned(page, 'POST', `/api/v1/leave/requests/${lr.id}/approve`, lr.version)).status).toBe(200);
  const week = await rotaWeek(api, W34);
  expect((await sendVersioned(page, 'POST', `${weekPath(W34)}/transition`, week.version, { to: 'published' })).status).toBe(200);
}
