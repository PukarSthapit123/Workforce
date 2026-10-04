/* Module 4 journeys. The employee and manager leave journeys run on qnipay,
   where Leave is on and Rota is off (brief D14): Bigyan Poudel (EMP004) has a
   waiting request for 3-4 September (lr_3), approved leave on 17-18 August
   (lr_5) and 12.5 of 24 days left; Bijay Shrestha (EMP005) waits on 24-28
   August (lr_1); Pukar Sthapit (EMP001) decides both at Manchester; Eddie
   Harford is the admin. The rota links run on social (Rota, FULFIL and
   LV_ROTA on), at Willow House, as in support/rota.ts: Amara Okafor (CP-1042)
   works nights on Thursday and Friday of week 33, and Thursday has exactly
   the minimum of 4 on shift, so taking a worker off it opens cover; Priya
   Shah (CP-1201) waits on 24-28 August (lr_1, escalated); Marcus Reilly
   (CP-1088) is over the Bradford trigger and was off sick on Tuesday 11
   August, a day of his approved leave (lr_4); Jo Baptiste (CP-1153) works a
   late on Thursday; Grace Whitmore (CP-1288) works at Beacon Court. */
import type { Page } from '@playwright/test';
import { tid } from '../../src/testids';
import { sendVersioned } from './timesheet';
import { stored } from './rota';
import type { Reply } from './read';

export const BIJAY = 'bijay.shrestha@qniverse.co.uk';

export interface LeaveReq { id: string; personCode: string; type: string; from: string; to: string; state: string; version: number; reason: string; qty: number }
export interface MyLeaveRead { balance: { takenD: number; pending: number; leftD: number }; requests: LeaveReq[] }
export interface AuditStored { act: string; entity: string; entityId: string; before?: unknown; after?: unknown; reason?: string }

export const myLeave = async (api: { get(path: string): Promise<Reply> }): Promise<MyLeaveRead> => {
  const r = await api.get('/api/v1/leave/me');
  if (r.status !== 200) throw new Error(`my leave answered ${r.status}`);
  return r.body as MyLeaveRead;
};
/* A request sent straight to the server as the signed-in colleague, as the screen would send it. */
export async function askFor(api: { send(m: string, p: string, b?: unknown): Promise<Reply> }, from: string, to = from, type = 'AL'): Promise<LeaveReq> {
  const r = await api.send('POST', '/api/v1/leave/requests', { type, from, to, part: 'full' });
  if (r.status !== 200) throw new Error(`request leave answered ${r.status}: ${JSON.stringify(r.body)}`);
  return (r.body as { record: LeaveReq }).record;
}
/* A decision straight to the server, with the request's version as If-Match. */
export const decide = (page: Page, req: { id: string; version: number }, how: 'approve' | 'decline', reason?: string): Promise<Reply> =>
  sendVersioned(page, 'POST', `/api/v1/leave/requests/${req.id}/${how}`, req.version, how === 'decline' ? { reason: reason ?? '' } : undefined);

/* The leave records and their audit rows where the fake server keeps them,
   so a journey can show nothing was written without signing in as an admin. */
export const leaveAudit = async (page: Page) =>
  (await stored<AuditStored>(page, 'audit')).filter(a => ['leaveRequest', 'sickEpisode', 'leaveLedger', 'leaveConfig'].includes(a.entity));
export const LEAVE_STORE = ['leaveRequests', 'leaveLedger', 'sickEpisodes', 'leaveConfig', 'notifications', 'rotaWeeks', 'coverRequests'] as const;
export const leaveStore = async (page: Page) =>
  Object.fromEntries(await Promise.all(LEAVE_STORE.map(async c => [c, await stored<unknown>(page, c)] as const)));

/* Opens My leave's request dialog and fills the dates. */
export async function openRequest(page: Page, from: string, to: string) {
  await page.getByTestId(tid.leave.requestOpen).click();
  await page.getByTestId(tid.leave.send).waitFor();
  await page.getByTestId(tid.leave.from).fill(from);
  await page.getByTestId(tid.leave.to).fill(to);
}
