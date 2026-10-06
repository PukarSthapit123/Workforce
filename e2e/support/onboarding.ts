/* Module 5 journeys. They run on qnipay at the frozen clock, where the
   Onboarding module and every ONB_* feature are on: Tom Achterberg (EMP003)
   is preboarding from 14/09/2026 and Priya Raman (EMP002) is a candidate from
   28/09/2026, both at Manchester with empty cases; Pukar Sthapit (EMP001)
   manages Manchester and holds Track onboarding and Verify onboarding
   documents; Eddie Harford is the admin. Seven steps are asked; the right to
   work, proof of address and photograph are required, and only the right to
   work stops a start until it is verified. Four policies: Code of conduct
   v4.1, Privacy notice v2.0, Employee handbook v7.3, IT and data security
   v3.2. On social the same two starters are CP-1502 and CP-1501 at Willow
   House, which Rachel Hussain manages. */
import { expect, type Page } from '@playwright/test';
import { tid } from '../../src/testids';
import { sendVersioned } from './timesheet';
import { stored } from './rota';
import type { Reply } from './read';

export { EDDIE, PUKAR, BIGYAN } from './timesheet';
export const TOM = 'tom.achterberg@dogmagroup.co.uk';
export const PRIYA = 'priya.raman@dogmagroup.co.uk';
export const TOM_SOCIAL = 'tom.achterberg@brightpath.org';
export const PRIYA_SOCIAL = 'priya.raman@brightpath.org';
export const POLICIES = ['pol_conduct', 'pol_privacy', 'pol_handbook', 'pol_itsec'] as const;
export const DOCS = ['rtw', 'addr', 'photo'] as const;

/* A small generated PNG (a 4 x 4 green square) and a PDF header: enough for
   the browser to read and, for the image, draw a preview. No fixtures. */
export const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAIAAAAmkwkpAAAAEElEQVR4nGMQdZOAIwbiOAC65AcxdEhh3AAAAABJRU5ErkJggg==', 'base64');
export const PDF = Buffer.from('%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF\n');
export const png = (name: string) => ({ name, mimeType: 'image/png', buffer: PNG });
export const pdf = (name: string) => ({ name, mimeType: 'application/pdf', buffer: PDF });

type Get = { get(path: string): Promise<Reply> };
export interface CaseRead {
  id: string; version: number; steps: Record<string, string>; docs: Record<string, string>; files: Record<string, { name: string; preview?: string }>;
  rejections: Record<string, string>; acks: Record<string, string>; signature: string; consent: boolean; submittedAt: string; ref: string;
}
export interface DetailRead {
  person: { code: string; state: string }; case: CaseRead; progress: { text: string };
  policies: { id: string; ver: string; acknowledged: boolean }[]; toSubmit: { why: string }[]; toStart: { why: string }[];
}
export async function myCase(api: Get): Promise<DetailRead> {
  const r = await api.get('/api/v1/onboarding/me');
  expect(r.status, 'my onboarding').toBe(200);
  return r.body as DetailRead;
}
export interface TeamRead {
  rows: { person: { code: string; state: string }; caseRef: { id: string; version: number }; blockers: { why: string }[] }[];
  queue: { person: { code: string }; document: { id: string } }[]; toVerify: number;
}
export async function teamOf(api: Get): Promise<TeamRead> {
  const r = await api.get('/api/v1/onboarding/team');
  expect(r.status, 'team onboarding').toBe(200);
  return r.body as TeamRead;
}

/* Every step, the three required documents (as PDFs) and every policy,
   straight to the server as the signed-in starter, as the portal sends them;
   then, unless asked not to, the submission. */
export async function completeMine(page: Page, api: Get, opts: { submit?: boolean; sign?: string } = {}) {
  const v = async () => (await myCase(api)).case.version;
  const ok = async (r: Promise<Reply>, what: string) => { const x = await r; expect(x.status, `${what}: ${JSON.stringify(x.body)}`).toBe(200); };
  const step = async (id: string, body: Record<string, unknown>) =>
    ok(sendVersioned(page, 'PUT', `/api/v1/onboarding/me/steps/${id}`, await v(), { mode: 'check', ...body }), `step ${id}`);
  await step('personal', { personal: { dob: '1990-03-02', nat: 'Dutch', ni: 'QQ123456C' } });
  await step('contact', { contact: { mob: '07700 900321', a1: '12 Canal Street', city: 'Manchester', post: 'M1 3HE' } });
  await step('emergency', { emergency: [{ nm: 'Sanne Achterberg', rel: 'Partner', ph: '07700 900654' }] });
  await step('additional', { additional: { conv: 'No', wtd: 'No, I do not opt out', quals: [] } });
  for (const d of DOCS)
    await ok(sendVersioned(page, 'POST', `/api/v1/onboarding/me/documents/${d}`, await v(), { name: `${d}.pdf`, size: PDF.length, type: 'application/pdf' }), `upload ${d}`);
  await step('documents', { documents: { rtwType: 'Passport' } });
  for (const p of POLICIES) await ok(sendVersioned(page, 'POST', `/api/v1/onboarding/me/policies/${p}/ack`, await v(), { on: true }), `ack ${p}`);
  await step('policies', {});
  if (opts.submit === false) return;
  await ok(sendVersioned(page, 'POST', '/api/v1/onboarding/me/submit', await v(), { consent: true, signature: opts.sign ?? 'Tom Achterberg' }), 'submit');
}

/* What the fake server holds for onboarding, so a journey can show what was
   (or was not) written without signing in as somebody who may read it. */
export interface AuditStored { act: string; entity: string; entityId: string; before?: unknown; after?: unknown; reason?: string }
export const onbAudit = async (page: Page) =>
  (await stored<AuditStored>(page, 'audit')).filter(a => ['onboardingCase', 'onboardingConfig', 'onboardingPolicy', 'person'].includes(a.entity));
export interface NoteStored { id: string; personId: string; event?: string; area: string; title: string; body: string }
export const onbNotes = async (page: Page) => (await stored<NoteStored>(page, 'notifications')).filter(n => n.area === 'Onboarding');
export const ONB_STORE = ['onboardingCases', 'onboardingConfig', 'onboardingPolicies', 'notifications', 'people', 'personHistory', 'audit'] as const;
export const onbStore = async (page: Page) =>
  Object.fromEntries(await Promise.all(ONB_STORE.map(async c => [c, await stored<unknown>(page, c)] as const)));

/* The portal, open on its rail. */
export async function openPortal(page: Page) {
  await page.goto('/work/onb');
  await page.getByTestId(tid.onb.rail).waitFor();
}
/* Picks a document's file: Upload (or Replace) aims the hidden picker at it, then the file is set. */
export async function uploadDoc(page: Page, doc: string, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.getByTestId(tid.onb.docUpload(doc)).click();
  await page.getByTestId(tid.onb.filePick).setInputFiles(file);
}
/* The tracker, read once its list is on screen. */
export async function openTracker(page: Page) {
  await page.goto('/team/tonb');
  await page.getByTestId(tid.tonb.list).waitFor();
}
