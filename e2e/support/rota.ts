/* Module 3 journeys run on the social seed (Brightpath), where Rota is on with
   FULFIL, PATTERNS, MINSTAFF and SAFEWORKER (src/mocks/seed/seed-3.test.ts):
   Rachel Hussain (CP-1001) manages Willow House (WH); its week 33
   (rw_WH_2026-08-10) is published at v1 with Friday one short of the minimum
   of 4; week 34 is not stored, so it reads as an empty draft. Amara Okafor
   (CP-1042) works Early Mon and Tue and Night Thu and Fri; Rosa Mendes
   (CP-1402) is free on Friday; Daniel Osei (CP-1266) works nights; Marcus
   Reilly (CP-1088) is on leave Mon and Tue; Sana Iqbal (CP-1455) is a bank
   worker there with no shift that week. Grace Whitmore (CP-1288) works at
   Beacon Court (BC). Dee Fitzgerald is the admin. cov_1 (Tue night) and cov_2
   (Fri late, urgent) are open; fil_1 (Ellie Warren, Sat early) waits to be
   confirmed. ITACCESS is on. */
import { expect, type Page } from '@playwright/test';
import { tid } from '../../src/testids';
import type { Reply } from './read';

export const RACHEL = 'rachel.hussain@brightpath.org';
export const AMARA = 'amara.okafor@brightpath.org';
export const SANA = 'sana.iqbal@brightpath.org';
export const GRACE = 'grace.whitmore@brightpath.org';
export const DEE = 'dee.fitzgerald@brightpath.org';
export const W33 = '2026-08-10', W34 = '2026-08-17', W35 = '2026-08-24';
export const weekPath = (ws: string, loc = 'WH') => `/api/v1/rota/weeks/${loc}/${ws}`;

export interface RotaRowRead { personCode: string; name: string; line: string[] }
export interface RotaWeekRead {
  id: string; version: number; state: string; publishVersion: number; gapDays: number[]; onShift: number[];
  rows: RotaRowRead[]; changes: { personCode: string; from: string; to: string; afterPublish: boolean; version: number }[];
}
export async function rotaWeek(api: { get(path: string): Promise<Reply> }, ws = W33, loc = 'WH'): Promise<RotaWeekRead> {
  const r = await api.get(weekPath(ws, loc));
  expect(r.status, `rota week ${loc} ${ws}`).toBe(200);
  return r.body as RotaWeekRead;
}
export const lineOf = (w: RotaWeekRead, code: string) => w.rows.find(r => r.personCode === code)?.line ?? [];
/* the working cells on a week: a shift code, not rest, leave or sickness */
export const shiftsOn = (w: RotaWeekRead) => w.rows.flatMap(r => r.line).filter(c => c && c !== 'V' && c !== 'S').length;

/* Notifications have no read endpoint in this module (the inbox is 1c's), so a
   journey reads them where the fake server keeps them: its persisted store. */
export interface NoteRow { id: string; personId: string; area: string; title: string; body: string }
export const stored = <T>(page: Page, coll: string): Promise<T[]> =>
  page.evaluate(c => {
    const raw = localStorage.getItem('qnipay.app.store');
    const db = raw ? (JSON.parse(raw) as { data: Record<string, Record<string, unknown>> }).data : {};
    return Object.values(db[c] ?? {});
  }, coll) as Promise<T[]>;

/* Team rota on a given week: opens on the week the server says is today, then steps forward. */
export async function openRota(page: Page, steps = 0) {
  await page.goto('/team/trota');
  await page.getByTestId(tid.trota.grid).waitFor();
  for (let i = 0; i < steps; i++) {
    const was = await page.getByTestId(tid.trota.weekLabel).textContent();
    await page.getByTestId(tid.trota.weekNext).click();
    await expect(page.getByTestId(tid.trota.weekLabel)).not.toHaveText(was ?? '');
  }
  await page.getByTestId(tid.trota.state).waitFor();
}
