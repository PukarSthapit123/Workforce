import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { answered, personByCode } from './support/read';
import { sendVersioned, signInEmail } from './support/timesheet';
import { DEE, RACHEL } from './support/rota';
import { BIGYAN, EDDIE, TOM, onbAudit, onbStore, teamOf } from './support/onboarding';

/* Module 5 Review Focus 1 and 2 (brief D5, D6, D8). A starter reaches the
   portal and nothing else, by the nav or by URL, and the team and setup
   endpoints refuse them; an employee who is not a starter, or a starter
   without Complete my own onboarding, has no portal; a manager sees and acts
   on starters at their own location only; without Configure onboarding the
   setup page and its endpoints are refused; and the People lifecycle dialog
   refuses to make a starter active while anything blocks the start. Each
   refusal writes nothing. */
type R = { status: number; body: unknown };
const code = (r: R) => (r.body as { code: string }).code;
const said = (r: R) => [r.status, code(r), (r.body as { message: string }).message];
const pageTabs = (page: import('@playwright/test').Page) => page.locator('nav[aria-label="Pages"] a[data-testid^="nav-tab-"]');
async function unreachable(page: import('@playwright/test').Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId(tid.unavailable.root), path).toBeVisible();
}

test.describe('on qnipay', () => {
  test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });

  test('a starter reaches only the portal, by the nav or by URL, and the team and setup endpoints refuse them', async ({ page, api }) => {
    await signInEmail(page, TOM);
    await expect(page).toHaveURL(/\/work\/onb$/);
    await expect(pageTabs(page)).toHaveCount(1);
    for (const g of ['team', 'setup']) await expect(page.getByTestId(tid.nav.group(g))).toHaveCount(0);
    for (const path of ['/work/home', '/work/ts', '/work/leave', '/work/profile', '/team/tonb', '/team/tpeople', '/setup/monb', '/setup/apeople']) await unreachable(page, path);
    await page.getByTestId(tid.unavailable.home).click();
    await expect(page).toHaveURL(/\/work\/onb$/);

    const before = await onbStore(page);
    expect((await api.get('/api/v1/onboarding/team')).status).toBe(403);
    expect((await api.get('/api/v1/onboarding/team/EMP002')).status).toBe(403);
    expect((await api.get('/api/v1/onboarding/config')).status).toBe(403);
    const self = await sendVersioned(page, 'POST', '/api/v1/onboarding/team/EMP003/start', 1);
    expect([self.status, code(self)]).toEqual([403, 'capability']);
    const verify = await sendVersioned(page, 'POST', '/api/v1/onboarding/team/EMP002/documents/rtw/verify', 1);
    expect([verify.status, code(verify)]).toEqual([403, 'capability']);
    expect(await onbStore(page)).toEqual(before);
  });

  test('an employee who is not a starter, or a starter without Complete my own onboarding, has no portal', async ({ page, api }) => {
    await signInEmail(page, BIGYAN);
    await expect(page.getByTestId(tid.nav.tab('onb'))).toHaveCount(0);
    await expect(page.getByTestId(tid.nav.tab('home'))).toBeVisible();
    await unreachable(page, '/work/onb');
    const active = await api.get('/api/v1/onboarding/me');
    expect(said(active)).toEqual([409, 'NOT_ONBOARDING', 'There is no onboarding for you to complete. It is open only while you are a new starter.']);

    /* Tom has own_onb taken away, as an exception */
    await signInEmail(page, EDDIE);
    const users = (await api.get('/api/v1/users')).body as { email: string; version: number }[];
    const revoke = await sendVersioned(page, 'POST', `/api/v1/users/${encodeURIComponent(TOM)}/exceptions`, users.find(u => u.email === TOM)?.version ?? 0,
      { capability: 'own_onb', mode: 'revoke', reason: 'Offer on hold' });
    expect(revoke.status).toBe(200);
    await signInEmail(page, TOM);
    await expect(page.getByTestId(tid.nav.tab('onb'))).toHaveCount(0);
    await page.goto('/work/onb');
    await expect(page.getByTestId(tid.page('onb'))).toHaveCount(0);
    const mine = await api.get('/api/v1/onboarding/me');
    expect([mine.status, code(mine)]).toEqual([403, 'capability']);
    const save = await sendVersioned(page, 'PUT', '/api/v1/onboarding/me/steps/personal', 1, { mode: 'quiet', personal: { nat: 'Dutch' } });
    expect([save.status, code(save)]).toEqual([403, 'capability']);
  });

  test('the People lifecycle dialog refuses to make a starter active while anything blocks the start, and so does the transition endpoint', async ({ page, api }) => {
    await signInEmail(page, EDDIE);
    await page.goto('/setup/apeople');
    await page.getByTestId(tid.people.open('EMP003')).click();
    await page.getByTestId(tid.person.record).waitFor();
    await page.getByTestId(tid.person.changeState).click();
    await page.getByTestId(tid.lifecycle.option('active')).check();
    await page.getByTestId(tid.lifecycle.reason).fill('Ready to go');
    const before = await onbStore(page);
    const moved = answered(page, 'POST', /\/transitions$/);
    await page.getByTestId(tid.lifecycle.save).click();
    expect((await moved).status()).toBe(409);
    await expect(page.getByTestId(tid.lifecycle.warn)).toContainText(/^Tom Achterberg cannot start yet\. 9 outstanding\. Personal details not completed\./);
    await expect(page.getByTestId(tid.modal.root)).toBeVisible();
    expect((await personByCode(api, 'EMP003')).state).toBe('preboard');

    /* straight to the server, with the record's version */
    const tom = await personByCode(api, 'EMP003');
    const direct = await sendVersioned(page, 'POST', `/api/v1/people/${tom.id}/transitions`, tom.version, { to: 'active', reason: 'Ready to go' });
    expect([direct.status, code(direct)]).toEqual([409, 'NOT_READY']);
    expect(await onbStore(page)).toEqual(before);
    expect(await onbAudit(page)).toEqual([]);
  });
});

test.describe('on social', () => {
  test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

  test('a manager sees and acts on starters at their own location only', async ({ page, api }) => {
    /* Dee adds a starter at Beacon Court */
    await signInEmail(page, DEE);
    const made = await api.send('POST', '/api/v1/people', {
      code: 'CP-9001', name: 'Hannah Vogel', email: 'hannah.vogel@brightpath.org', phone: '', jobProfile: 'SW', employeeType: 'shift', category: '', location: 'BC',
      department: '', manager: '', contractedHours: 30, maxHours: 0, night: false, resource: '', cis: false, start: '2026-09-01', state: 'candidate', userType: 'employee',
    });
    expect(made.status).toBe(200);
    expect((await teamOf(api)).rows.map(r => r.person.code)).toContain('CP-9001');

    await signInEmail(page, RACHEL);
    await page.goto('/team/tonb');
    await page.getByTestId(tid.tonb.table).waitFor();
    await expect(page.getByTestId(tid.tonb.row('CP-1502'))).toBeVisible();
    await expect(page.getByTestId(tid.tonb.row('CP-9001'))).toHaveCount(0);
    expect((await teamOf(api)).rows.map(r => r.person.code).sort()).toEqual(['CP-1501', 'CP-1502']);

    const before = await onbStore(page);
    const scope = 'You can look after onboarding for people at Willow House only.';
    expect(said(await api.get('/api/v1/onboarding/team/CP-9001'))).toEqual([403, 'scope', scope]);
    for (const action of ['invite', 'start', 'chase']) {
      const r = await sendVersioned(page, 'POST', `/api/v1/onboarding/team/CP-9001/${action}`, 1);
      expect([action, ...said(r)]).toEqual([action, 403, 'scope', scope]);
    }
    const reject = await sendVersioned(page, 'POST', '/api/v1/onboarding/team/CP-9001/documents/rtw/reject', 1, { reason: 'No' });
    expect(said(reject)).toEqual([403, 'scope', scope]);
    expect(await onbStore(page)).toEqual(before);
  });

  test('without Configure onboarding the setup page and its endpoints are refused', async ({ page, api }) => {
    await signInEmail(page, RACHEL);
    await expect(page.getByTestId(tid.nav.tab('monb'))).toHaveCount(0);
    await unreachable(page, '/setup/monb');
    const before = await onbStore(page);
    expect([(await api.get('/api/v1/onboarding/config')).status]).toEqual([403]);
    const save = await sendVersioned(page, 'PUT', '/api/v1/onboarding/config', 1, { steps: [], documents: [] });
    expect([save.status, code(save)]).toEqual([403, 'capability']);
    const add = await api.send('POST', '/api/v1/onboarding/policies', { label: 'Safeguarding' });
    expect([add.status, code(add)]).toEqual([403, 'capability']);
    const upload = await sendVersioned(page, 'POST', '/api/v1/onboarding/policies/pol_conduct/file', 1, { name: 'x.pdf', size: 10, type: 'application/pdf' });
    expect([upload.status, code(upload)]).toEqual([403, 'capability']);
    const remove = await sendVersioned(page, 'DELETE', '/api/v1/onboarding/policies/pol_conduct', 1);
    expect([remove.status, code(remove)]).toEqual([403, 'capability']);
    expect(await onbStore(page)).toEqual(before);
  });
});
