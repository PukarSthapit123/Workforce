import { test as base, expect, type Page } from '@playwright/test';
import { tid } from '../../src/testids';

/* MSW lives in the page's service worker, so control calls run inside the page. */
const call = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(async ([m, p, b]) => {
    const token = sessionStorage.getItem('qnipay.session');
    const r = await fetch(p as string, { method: m as string, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  }, [method, path, body] as const);

export const FROZEN = '2026-08-13T14:30:00.000Z';
type Persona = 'employee' | 'manager' | 'admin';
export const test = base.extend<{
  api: { reset(): Promise<void>; seed(t: 'social' | 'qnipay'): Promise<void>; setClock(iso: string | null): Promise<void>;
    fault(method: string, path: string, status: number, times?: number): Promise<void>; get(path: string): Promise<{ status: number; body: unknown }>;
    send(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> };
  signInAs(p: Persona): Promise<void>;
}>({
  api: async ({ page }, use) => {
    await page.goto('/');
    /* Either landed on sign-in, or a session already persisted and the shell
       is up. Not the role pill for that second case: spec §10.3 hides it
       below the md breakpoint, so it is not a viewport-independent signal. */
    await page.getByTestId(tid.signIn.form).or(page.getByTestId(tid.shell.account)).waitFor();
    const api = {
      reset: async () => { await call(page, 'POST', '/api/_dev/reset'); await call(page, 'POST', '/api/_dev/clock', { now: FROZEN }); },
      seed: async (t: string) => { await call(page, 'POST', `/api/_dev/seed/${t}`); },
      setClock: async (iso: string | null) => { await call(page, 'POST', '/api/_dev/clock', { now: iso }); },
      /* Faults live in a module-level array in mocks/faults.ts: real state for
         the running page, but not persisted anywhere. signInAs (below) does a
         full page reload to land back on the sign-in screen, which throws that
         array away along with everything else in the JS context. So a fault
         meant to fire after signing in must be registered with api.fault(...)
         AFTER calling signInAs(...), never before it. The frozen clock does
         not have this problem: it is persisted with the store (see store.ts),
         which is what lets signInAs reload the page at all without losing it. */
      fault: async (method: string, path: string, status: number, times = 1) => { await call(page, 'POST', '/api/_dev/faults', { method, path, status, times }); },
      get: (path: string) => call(page, 'GET', path),
      send: (method: string, path: string, body?: unknown) => call(page, method, path, body),
    };
    await api.reset();
    await use(api);
  },
  signInAs: async ({ page, api }, use) => {
    await use(async (p: Persona) => {
      const accounts = (await api.get('/api/v1/session/accounts')).body as { email: string; userType: Persona }[];
      const acc = accounts.find(a => a.userType === p);
      if (!acc) throw new Error(`no demo account for persona "${p}"`);
      await page.evaluate(() => sessionStorage.removeItem('qnipay.session'));
      await page.goto('/');
      await page.getByTestId(tid.signIn.email).fill(acc.email);
      await page.getByTestId(tid.signIn.password).fill('Qnipay@123');
      await page.getByTestId(tid.signIn.submit).click();
      /* Not the role pill: spec §10.3 hides it (and the brand name) below the
         md breakpoint to keep the phone header on one line, so it is not a
         viewport-independent signal that sign-in landed on the shell. The
         account menu trigger always renders. */
      await expect(page.getByTestId(tid.shell.account)).toBeVisible();
    });
  },
});
export { expect };
