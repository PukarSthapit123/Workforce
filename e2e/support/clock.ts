/* Module 2b journeys run on social (Brightpath), where Clock in / out (B) is
   on with Break tracking, and Support Worker and Relief / Bank Worker enter by
   clock: Amara Okafor (CP-1042) is a Support Worker at Willow House with a
   Night (22:00) on Thursday 13 August, nothing recorded that day, Wednesday
   with her approver and Tuesday 11 open; Marcus Reilly (CP-1088) works the
   Late (14:30) on Thursday, so a clock in at the frozen 15:30 is late; Rachel
   Hussain (CP-1001) is their line manager and approver, a Service Manager,
   who records time on the day form; Dee Fitzgerald is the admin. Every time
   the clock stamps is the server's: a journey moves it with api.setClock. */
import { expect, type Page } from '@playwright/test';
import { tid } from '../../src/testids';
import { sendVersioned } from './timesheet';
import { auditRows } from './config';
import { stored } from './rota';
import type { Reply } from './read';

export { AMARA, DEE, RACHEL } from './rota';
export const MARCUS = 'marcus.reilly@brightpath.org';
export const THU = '2026-08-13';

/* London is on BST in August: 07:02 on the clock every rule reads is 06:02Z. */
export function london(hms: string, date = THU): string {
  const [h = 0, m = 0, s = 0] = hms.split(':').map(Number), [y = 0, mo = 0, d = 0] = date.split('-').map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h - 1, m, s)).toISOString();
}

export interface ClockRead {
  version: number; status: string;
  current: { date: string; state: string; version: number; late: boolean; events: { kind: string; at: string }[] } | null;
  open: { date: string; state: string; version: number } | null;
  gates: { live: boolean; mode: string; show: boolean };
}
export async function myClock(api: { get(path: string): Promise<Reply> }): Promise<ClockRead> {
  const r = await api.get('/api/v1/clock/me');
  expect(r.status, 'my clock').toBe(200);
  return r.body as ClockRead;
}
/* A clock move straight to the server as the signed-in person, with the version the card would send. */
export async function clockMove(page: Page, api: { get(path: string): Promise<Reply> }, path: 'in' | 'break/start' | 'break/end' | 'out'): Promise<Reply> {
  return sendVersioned(page, 'POST', `/api/v1/clock/${path}`, (await myClock(api)).version);
}
/* A clock left running on an earlier day, made the way a person would make
   it: a clock in on that day at that time, then the server clock moved on to
   `back` (the frozen Thursday by default). Signed in as the person. */
export async function forgetClock(page: Page, api: { get(path: string): Promise<Reply>; setClock(iso: string | null): Promise<void> },
  date: string, hms: string, back: string) {
  await api.setClock(london(hms, date));
  const r = await clockMove(page, api, 'in');
  expect(r.status, `clock in on ${date}`).toBe(200);
  await api.setClock(back);
}

/* My timesheet's day view for a clock-mode type: it opens on the day, with the card when the gates allow it. */
export async function openMyDay(page: Page) {
  await page.goto('/work/ts');
  await page.getByTestId(tid.ts.dayLabel).waitFor();
  await page.getByTestId(tid.dayForm.save).waitFor();
}

export const clockAudit = async (page: Page) => (await auditRows(page, 'clockRecord')).map(a => a.act);
export interface NoteStored { id: string; personId: string; event?: string; title: string; body: string }
export const lateNotes = async (page: Page) =>
  (await stored<NoteStored>(page, 'notifications')).filter(n => n.event === 'ts_late').map(n => [n.personId, n.title, n.body]);
