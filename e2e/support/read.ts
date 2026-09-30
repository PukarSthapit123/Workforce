/* Reading outcomes back through the API, so a journey asserts what the server
   holds, not what the screen claims. */
import { expect, type Page } from '@playwright/test';

export interface Reply { status: number; body: unknown }
export interface Api { get(path: string): Promise<Reply> }
export interface PersonRow {
  id: string; version: number; code: string; name: string; state: string; end: string; location: string; email: string;
  contractedHours: number; maxHours: number; phone: string; address: string; bankAccount: string; employeeType: string; resource: string;
}
export interface AuditRow { act: string; entityId: string; reason?: string; before?: unknown; after?: unknown }

export async function everyone(api: Api): Promise<PersonRow[]> {
  const r = await api.get('/api/v1/people?state=all');
  expect(r.status, 'people list').toBe(200);
  return r.body as PersonRow[];
}
export async function personByCode(api: Api, code: string): Promise<PersonRow> {
  const p = (await everyone(api)).find(x => x.code === code);
  if (!p) throw new Error(`no person ${code} visible to this session`);
  return p;
}
export async function auditOf(api: Api, entity: string): Promise<AuditRow[]> {
  const r = await api.get(`/api/v1/audit?entity=${entity}`);
  expect(r.status, 'audit log').toBe(200);
  return (r.body as { items: AuditRow[] }).items;
}
export async function rows<T>(api: Api, path: string): Promise<T[]> {
  const r = await api.get(path);
  expect(r.status, path).toBe(200);
  return r.body as T[];
}
/* opens a SelectBox and chooses an option by its value */
export async function pick(page: Page, testId: string, value: string) {
  await page.getByTestId(testId).click();
  await page.getByTestId(`${testId}-option-${value}`).click();
}
export const answered = (page: Page, method: string, tail: RegExp) =>
  page.waitForResponse(r => r.request().method() === method && tail.test(new URL(r.url()).pathname));
