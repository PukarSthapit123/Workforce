/* Module 2 journeys run on the qnipay seed, where the timesheet data lives
   with named people (src/mocks/seed/seed-2.test.ts): Bigyan Poudel (EMP004)
   is a Consultant, a grid type, with a day awaiting approval on 12/08/2026
   and two earlier weeks of drafts in closed periods; Pukar Sthapit (EMP001)
   is the manager at Manchester who approves him; Eddie Harford is the first
   admin. signInAs picks the first account of a persona, so these sign in by
   email instead. */
import { expect, type Page } from '@playwright/test';
import { tid } from '../../src/testids';
import type { Reply } from './read';

export const BIGYAN = 'bigyan.poudel@dogmagroup.co.uk';
export const PUKAR = 'pukar.sthapit@dogmagroup.co.uk';
export const EDDIE = 'eddie.harford@dogmagroup.co.uk';
export const WEEK = '2026-08-10';
export const TODAY = '2026-08-13';

export async function signInEmail(page: Page, email: string) {
  await page.evaluate(() => sessionStorage.removeItem('qnipay.session'));
  await page.goto('/');
  await page.getByTestId(tid.signIn.email).fill(email);
  await page.getByTestId(tid.signIn.password).fill('Qnipay@123');
  await page.getByTestId(tid.signIn.submit).click();
  await expect(page.getByTestId(tid.shell.account)).toBeVisible();
}

/* A versioned write straight to the server, as the signed-in session, to show
   the server refuses what the screen would not have sent. */
export const sendVersioned = (page: Page, method: string, path: string, version: number, body?: unknown): Promise<Reply> =>
  page.evaluate(async ([m, p, v, b]) => {
    const token = sessionStorage.getItem('qnipay.session');
    const r = await fetch(p as string, { method: m as string, body: b === undefined ? undefined : JSON.stringify(b),
      headers: { 'Content-Type': 'application/json', 'If-Match': String(v), ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  }, [method, path, version, body] as const);

export interface WeekDayRow { date: string; state: string; version: number; minutes: number; record: { captureSource: string; enteredBy: string; returnReason: string } | null }
export interface WeekRead { days: WeekDayRow[] }
export async function weekOf(api: { get(path: string): Promise<Reply> }, code: string, weekStart = WEEK): Promise<WeekRead> {
  const r = await api.get(`/api/v1/timesheets/${code}/weeks/${weekStart}`);
  expect(r.status, `week ${code} ${weekStart}`).toBe(200);
  return r.body as WeekRead;
}
export async function dayState(api: { get(path: string): Promise<Reply> }, code: string, date: string, weekStart = WEEK) {
  const d = (await weekOf(api, code, weekStart)).days.find(x => x.date === date);
  if (!d) throw new Error(`no ${date} in week ${weekStart}`);
  return d;
}
