import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { everyone } from './support/read';
import { signInEmail } from './support/timesheet';
import { AMARA, DEE, auditRows, homeOf, info, openModule, tenantOf } from './support/config';

/* 1c, the administrator's journeys on social: a module switched off and on
   again with what it set aside restored (D5), a template saved, previewed
   and applied (D1, D2), the roles renamed (D11), and an approval chain and a
   delegation (D8). Each write is read back through the server, and each
   writes exactly one audit row. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
const painted = (page: import('@playwright/test').Page, tones: string[]) =>
  page.locator(tones.map(t => `[data-testid^="home-day-"][data-paint="${t}"]`).join(', '));

test('turning Rota off asks first, sets the scheduled shifts aside with their count and empties the calendar of shifts while leave stays; turning it on restores the same shifts', async ({ page, api }) => {
  test.setTimeout(90_000);
  /* Amara's August: her published shifts, and approved leave on 17 and 18 August */
  await signInEmail(page, AMARA);
  const before = await homeOf(api);
  expect(before.totals.shifts).toBe(8);
  await page.goto('/work/home');
  await page.getByTestId(tid.home.grid).waitFor();
  await expect(painted(page, ['E', 'L', 'N'])).toHaveCount(8);
  await expect(page.getByTestId(tid.home.day('2026-08-17'))).toHaveAttribute('data-paint', 'V');

  await signInEmail(page, DEE);
  await openModule(page, 'R');
  await page.getByTestId(tid.amods.mod('R')).click();
  const box = page.getByTestId(tid.modal.root);
  await expect(box.getByTestId(tid.modal.title)).toHaveText('Turn off Rota?');
  await expect(box).toContainText('This applies to everyone immediately.');
  /* keeping it as it is changes nothing */
  await box.getByTestId(tid.modal.cancel).click();
  await expect(box).toHaveCount(0);
  expect((await tenantOf(api)).modules.R).toBe(true);

  await page.getByTestId(tid.amods.mod('R')).click();
  await page.getByTestId(tid.modal.confirm).click();
  const off = info(page, /Rota turned off\. It is live for everyone now\. \d+ scheduled shifts cleared from the calendar and kept to restore\./);
  await expect(off).toBeVisible();
  const setAside = Number(/(\d+) scheduled shifts/.exec(await off.innerText())?.[1] ?? 0);
  expect(setAside).toBeGreaterThan(0);
  const t = await tenantOf(api);
  expect([t.modules.R, t.rotaSetAside]).toEqual([false, setAside]);
  await expect(page.getByTestId(tid.amods.offBanner)).toBeVisible();
  expect((await auditRows(page, 'tenant')).map(a => [a.act, a.entityId])).toEqual([['Module turned off', 'R']]);

  /* while it is off: no Shifts page, no shifts on the calendar, the leave still there */
  await signInEmail(page, AMARA);
  await expect(page.getByTestId(tid.nav.tab('shifts'))).toHaveCount(0);
  const during = await homeOf(api);
  expect([during.totals.shifts, during.totals.leaveDays]).toEqual([0, before.totals.leaveDays]);
  await page.goto('/work/home');
  await page.getByTestId(tid.home.grid).waitFor();
  await expect(page.getByTestId(tid.home.day('2026-08-17'))).toHaveAttribute('data-paint', 'V');
  await expect(painted(page, ['E', 'L', 'N'])).toHaveCount(0);

  /* on again, with no question asked: the same number comes back */
  await signInEmail(page, DEE);
  await openModule(page, 'R');
  await page.getByTestId(tid.amods.mod('R')).click();
  await expect(info(page, `Rota turned on. It is live for everyone now. ${setAside} scheduled shifts restored to the calendar.`)).toBeVisible();
  await expect(page.getByTestId(tid.modal.root)).toHaveCount(0);
  expect(await tenantOf(api)).toMatchObject({ modules: { R: true }, rotaSetAside: 0 });
  expect((await auditRows(page, 'tenant')).map(a => a.act)).toEqual(['Module turned off', 'Module turned on']);

  await signInEmail(page, AMARA);
  const after = await homeOf(api);
  expect(after.totals).toEqual(before.totals);
  expect(after.days.map(d => d.shift?.code ?? '')).toEqual(before.days.map(d => d.shift?.code ?? ''));
  await page.goto('/work/home');
  await page.getByTestId(tid.home.grid).waitFor();
  await expect(painted(page, ['E', 'L', 'N'])).toHaveCount(8);
});

test('a template is saved from this tenant, another is previewed and applied, and the saved one applied back: one audit row each, people untouched, the name kept', async ({ page, api }) => {
  test.setTimeout(90_000);
  await signInEmail(page, DEE);
  const people = await everyone(api);
  await page.goto('/setup/aorg');
  await page.getByTestId(tid.aorg.template('mne')).waitFor();
  await expect(page.getByTestId(tid.aorg.template('social'))).toHaveAttribute('aria-pressed', 'true');

  /* save: configuration only */
  await page.getByTestId(tid.aorg.saveOpen).click();
  await page.getByTestId(tid.aorg.saveName).fill('Brightpath as it runs');
  await expect(page.getByTestId(tid.aorg.scope('config'))).toBeChecked();
  await page.getByTestId(tid.aorg.save).click();
  await expect(info(page, 'Brightpath as it runs saved.')).toBeVisible();
  await expect(page.getByTestId(tid.aorg.savedRow('tpl_brightpath_as_it_runs'))).toContainText('Saved from Brightpath Support Services');
  expect((await auditRows(page, 'template')).map(a => [a.act, a.entityId])).toEqual([['Template saved', 'tpl_brightpath_as_it_runs']]);

  /* apply M&E: the preview first, and nothing changes until it is confirmed */
  await page.getByTestId(tid.aorg.template('mne')).click();
  const box = page.getByTestId(tid.modal.root);
  await expect(box.getByTestId(tid.modal.title)).toHaveText('Apply M&E / Building Services?');
  await expect(box.getByTestId(tid.aorg.plan('changes'))).toContainText('Activity reads as Cost code.');
  await expect(box.getByTestId(tid.aorg.plan('added'))).toContainText('Employee type Site Engineer (driver).');
  await expect(box.getByTestId(tid.aorg.plan('leftAlone'))).toContainText('Brightpath Support Services keeps its name');
  expect((await tenantOf(api)).template).toBe('social');
  await box.getByTestId(tid.aorg.apply).click();
  await expect(info(page, /^M&E \/ Building Services applied\./)).toBeVisible();
  await expect(page.getByTestId(tid.aorg.template('mne'))).toHaveAttribute('aria-pressed', 'true');
  expect(await tenantOf(api)).toMatchObject({ template: 'mne', name: 'Brightpath Support Services', modules: { R: false } });
  expect(await everyone(api)).toEqual(people);

  /* and the saved one back: Rota on again, people still untouched */
  await page.getByTestId(tid.aorg.template('tpl_brightpath_as_it_runs')).click();
  await box.getByTestId(tid.aorg.plan('changes')).waitFor();
  await box.getByTestId(tid.aorg.apply).click();
  await expect(info(page, /^Brightpath as it runs applied\./)).toBeVisible();
  expect(await tenantOf(api)).toMatchObject({ template: 'tpl_brightpath_as_it_runs', name: 'Brightpath Support Services', modules: { R: true } });
  expect(await everyone(api)).toEqual(people);
  expect((await auditRows(page, 'template')).map(a => [a.act, a.entityId])).toEqual([
    ['Template saved', 'tpl_brightpath_as_it_runs'], ['Template applied', 'mne'], ['Template applied', 'tpl_brightpath_as_it_runs']]);
  /* an apply is one row, not one per thing it set */
  expect(await auditRows(page, 'tenant', 'userType', 'employeeType', 'approvalChain')).toEqual([]);
});

test('renamed roles show in the view-as switcher, the role pill (also while viewing as someone), the permission matrix and the audit log; what each may do is unchanged', async ({ page, api }) => {
  test.setTimeout(90_000);
  await signInEmail(page, DEE);
  const capsOf = async () => Object.fromEntries(((await api.get('/api/v1/user-types')).body as { id: string; capabilities: string[] }[]).map(t => [t.id, t.capabilities]));
  const caps = await capsOf();
  await page.goto('/setup/aperm');
  await page.getByTestId(tid.access.table).waitFor();
  await page.getByTestId(tid.roleNames.open).click();
  await page.getByTestId(tid.roleNames.field('employee')).fill('Support Worker');
  await page.getByTestId(tid.roleNames.field('admin')).fill('Setup lead');
  await page.getByTestId(tid.roleNames.save).click();
  await expect(info(page, 'Roles renamed: Support Worker, Manager, Setup lead.')).toBeVisible();
  await expect(page.getByTestId(tid.modal.root)).toHaveCount(0);

  /* the matrix and the pill */
  await expect(page.getByTestId(tid.access.userTypeName('employee'))).toContainText('Support Worker');
  await expect(page.getByTestId(tid.access.userTypeName('admin'))).toContainText('Setup lead');
  await expect(page.getByTestId(tid.shell.rolePill)).toHaveText('Setup lead');
  expect(await capsOf()).toEqual(caps);

  /* the switcher names Amara's role by its new name, and so does the pill while looking as her */
  await page.getByTestId(tid.shell.account).click();
  await expect(page.getByTestId(tid.shell.menuRole)).toContainText('Setup lead');
  await expect(page.getByTestId(tid.shell.viewAs('CP-1042'))).toContainText('Support Worker');
  await page.getByTestId(tid.shell.viewAs('CP-1042')).click();
  await expect(page.getByTestId(tid.shell.viewAsEnd)).toBeVisible();
  await expect(page.getByTestId(tid.shell.rolePill)).toHaveText('Support Worker');
  await page.getByTestId(tid.shell.viewAsEnd).click();
  await expect(page.getByTestId(tid.shell.rolePill)).toHaveText('Setup lead');

  /* the audit log: one row per user type renamed */
  await page.goto('/setup/iaudit');
  await page.getByTestId(tid.audit.table).waitFor();
  const renamed = page.getByTestId(tid.audit.table).locator('tr').filter({ hasText: 'Roles renamed' });
  await expect(renamed).toHaveCount(2);
  await expect(renamed.filter({ hasText: 'Support Worker' })).toHaveCount(1);
  expect((await auditRows(page, 'userType')).map(a => [a.entityId, a.after])).toEqual([['employee', { name: 'Support Worker' }], ['admin', { name: 'Setup lead' }]]);

  /* and Amara herself sees it */
  await signInEmail(page, AMARA);
  await expect(page.getByTestId(tid.shell.rolePill)).toHaveText('Support Worker');
});

test('an approval chain is edited whole and saved once; a delegation is added, and one back the other way is refused as a loop with nothing added', async ({ page, api }) => {
  await signInEmail(page, DEE);
  await page.goto('/setup/aappr');
  await page.getByTestId(tid.aappr.chainTable).waitFor();
  await page.getByTestId(tid.aappr.delegTable).waitFor();

  await page.getByTestId(tid.aappr.edit('Timesheet')).click();
  const box = page.getByTestId(tid.modal.root);
  await expect(box.getByTestId(tid.aappr.layer(2))).toContainText('Business Central');
  await expect(box.getByTestId(tid.aappr.remove(2))).toHaveCount(0);
  await box.getByTestId(tid.aappr.when(1)).selectOption('Every timesheet');
  await box.getByTestId(tid.aappr.chainSave).click();
  await expect(info(page, 'Timesheet approval chain saved: Line manager, then Payroll, then Business Central.')).toBeVisible();
  await expect(box).toHaveCount(0);
  await expect(page.getByTestId(tid.aappr.row('Timesheet', 1))).toContainText('Every timesheet');
  const chains = (await api.get('/api/v1/approvals/chains')).body as { chains: { module: string; version: number; steps: { when: string }[] }[] };
  expect(chains.chains.find(c => c.module === 'Timesheet')?.steps.map(s => s.when)[1]).toBe('Every timesheet');
  expect((await auditRows(page, 'approvalChain')).map(a => a.act)).toEqual(['Approval chain changed']);

  /* Rachel's queue already goes to Dee from 24 to 31 August: Dee's back to Rachel over the same days would go round in a circle */
  await page.getByTestId(tid.aappr.delegAdd).click();
  await box.getByTestId(tid.aappr.who).selectOption('CP-1002');
  await box.getByTestId(tid.aappr.to).selectOption('CP-1001');
  await box.getByTestId(tid.aappr.from).fill('2026-08-30');
  await box.getByTestId(tid.aappr.until).fill('2026-09-02');
  await box.getByTestId(tid.aappr.delegSave).click();
  await expect(box.getByTestId(tid.field.root(tid.aappr.to))).toContainText('Rachel Hussain already delegates Timesheet to Dee Fitzgerald over those dates. The approvals would go round in a circle.');
  await expect(box.getByTestId(tid.aappr.to)).toHaveAttribute('aria-invalid', 'true');
  const ids = async () => ((await api.get('/api/v1/approvals/delegations')).body as { items: { id: string }[] }).items.map(d => d.id);
  expect(await ids()).toEqual(['dlg_1']);
  expect(await auditRows(page, 'delegation')).toEqual([]);

  await box.getByTestId(tid.aappr.from).fill('2026-09-01');
  await box.getByTestId(tid.aappr.until).fill('2026-09-07');
  await box.getByTestId(tid.aappr.delegSave).click();
  await expect(info(page, 'Delegation added: Dee Fitzgerald to Rachel Hussain, 01/09/2026 to 07/09/2026, Timesheet, Leave. Every decision records who acted.')).toBeVisible();
  await expect(page.getByTestId(tid.aappr.delegRow('dlg_2'))).toContainText('01/09/2026');
  expect(await ids()).toEqual(['dlg_1', 'dlg_2']);
  expect((await auditRows(page, 'delegation')).map(a => a.act)).toEqual(['Delegation added']);
});
