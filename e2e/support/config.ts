/* 1c journeys (configuration and communication). They run on social
   (Brightpath, every module on, the Social Care & Charity template) unless a
   test says otherwise, with the people of support/rota.ts: Dee Fitzgerald is
   the admin; Rachel Hussain (CP-1001) manages Willow House, whose fire drill
   notice NTC-0002 (urgent, must acknowledge, v1) two of its eleven people have
   acknowledged; Amara Okafor (CP-1042) works there and owes it; Grace Whitmore
   (CP-1288) works at Beacon Court. Rachel's inbox holds five unread items,
   among them "Leave approval overdue" (ntf_seed_0006), which opens Team leave.
   Rachel's queue is delegated to Dee from 24 to 31 August (dlg_1). */
import { expect, type Page } from '@playwright/test';
import { tid } from '../../src/testids';
import { stored } from './rota';
import type { Reply } from './read';

export { AMARA, DEE, GRACE, RACHEL } from './rota';

type Get = { get(path: string): Promise<Reply> };
export interface TenantRead { version: number; name: string; template: string; modules: Record<string, boolean>; flags: Record<string, boolean>; rotaHorizon: number; rotaSetAside: number }
export async function tenantOf(api: Get): Promise<TenantRead> {
  const r = await api.get('/api/v1/tenant');
  expect(r.status, 'tenant').toBe(200);
  return r.body as TenantRead;
}
export interface InboxRead { items: { id: string; title: string; read: boolean; area: string; link: { path: string; label: string } | null }[]; unread: number }
export async function inboxOf(api: Get): Promise<InboxRead> {
  const r = await api.get('/api/v1/notifications/me');
  expect(r.status, 'my notifications').toBe(200);
  return r.body as InboxRead;
}

export interface AuditStored { act: string; entity: string; entityId: string; before?: unknown; after?: unknown; reason?: string }
/* the audit rows the fake server holds, for the entities given (all when none) */
export const auditRows = async (page: Page, ...entities: string[]) =>
  (await stored<AuditStored>(page, 'audit')).filter(a => !entities.length || entities.includes(a.entity));

/* Everything the fake server holds but the sessions, which a sign-in writes:
   a write that was refused must leave all of it exactly as it was. */
export const wholeStore = (page: Page): Promise<Record<string, unknown>> =>
  page.evaluate(() => {
    const raw = localStorage.getItem('qnipay.app.store');
    const db = raw ? (JSON.parse(raw) as { data: Record<string, unknown> }).data : {};
    delete db.sessions;
    return db;
  });

/* an info toast, found by its words (never by its position) */
export const info = (page: Page, text: string | RegExp) => page.getByTestId(tid.toast.info).filter({ hasText: text });
export const refusedToast = (page: Page, text: string | RegExp) => page.getByTestId(tid.toast.error).filter({ hasText: text });

/* A module's drill-in, ready to switch. */
export async function openModule(page: Page, code: string) {
  await page.goto(`/setup/amods?m=${code}`);
  await page.getByTestId(tid.amods.moduleCard).waitFor();
}

/* My home's month as the server paints it for the signed-in person. */
export interface HomeRead { totals: { shifts: number; leaveDays: number; minutes: number }; days: { date: string; shift: { code: string } | null; absence: { mark: string; name: string } | null }[] }
export async function homeOf(api: Get): Promise<HomeRead> {
  const r = await api.get('/api/v1/home');
  expect(r.status, 'my home').toBe(200);
  return r.body as HomeRead;
}
