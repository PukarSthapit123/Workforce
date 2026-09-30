import type { Page } from '@playwright/test';
import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { answered, auditOf, everyone, personByCode, pick, rows } from './support/read';

/* Plan 1b, the admin's journey: keep the one people record, move someone
   through the lifecycle, keep the dimensions, the contracts and the employee
   types. Every outcome is read back through the API (spec §10.2). */
test.beforeEach(async ({ api }) => { await api.reset(); await api.setClock(FROZEN); });

const openPerson = async (page: Page, code: string) => {
  await page.getByTestId(tid.people.open(code)).click();
  await page.getByTestId(tid.person.record).waitFor();
};

test('CR A valid record is created; the new person appears in the list; creation is audited with type, location and hours; the new record can be edited; the edit is audited as a before → after diff', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/apeople');
  await page.getByTestId(tid.people.add).click();
  const code = page.getByTestId(tid.personForm.field('code'));
  await expect(code).not.toHaveValue('');
  const id = await code.inputValue();
  await page.getByTestId(tid.personForm.field('name')).fill('Test Person');
  await page.getByTestId(tid.personForm.field('email')).fill('test.person@brightpath.org');
  await pick(page, tid.personForm.field('location'), 'WH');
  await page.getByTestId(tid.personForm.field('contractedHours')).fill('30');
  await page.getByTestId(tid.personForm.field('maxHours')).fill('45');
  await pick(page, tid.personForm.field('state'), 'active');
  const created = answered(page, 'POST', /\/api\/v1\/people$/);
  await page.getByTestId(tid.personForm.save).click();
  expect((await created).status()).toBe(200);
  await expect(page.getByTestId(tid.toast.info)).toContainText('Test Person created');
  await expect(page.getByTestId(tid.people.row(id))).toBeVisible();
  expect(await personByCode(api, id)).toMatchObject({ name: 'Test Person', state: 'active', location: 'WH', contractedHours: 30 });
  expect((await auditOf(api, 'person'))[0]).toMatchObject({ act: 'Employee created', entityId: id,
    after: expect.objectContaining({ location: 'WH', contractedHours: 30, employeeType: expect.any(String) }) });
  /* PS Accounts follow the roster: the new person can sign in */
  expect((await rows<{ email: string }>(api, '/api/v1/session/accounts')).map(a => a.email)).toContain('test.person@brightpath.org');

  await page.getByTestId(tid.people.edit(id)).click();
  await expect(page.getByTestId(tid.personForm.field('code'))).toBeDisabled();
  await page.getByTestId(tid.personForm.field('contractedHours')).fill('32');
  await page.getByTestId(tid.personForm.save).click();
  await expect(page.getByTestId(tid.toast.info).filter({ hasText: '1 field(s) changed' })).toBeVisible();
  expect(await personByCode(api, id)).toMatchObject({ contractedHours: 32, version: 2 });
  expect((await auditOf(api, 'person'))[0]).toMatchObject({ act: 'Employee record edited', entityId: id,
    before: { contractedHours: '30' }, after: { contractedHours: '32' } });
});

test('CR A lifecycle dialog offers only the legal next states; the transition is audited with its reason; a leaver drops out of the default list, but is reachable through the state filter', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/apeople');
  await openPerson(page, 'CP-1042');
  await page.getByTestId(tid.person.changeState).click();
  for (const s of ['suspended', 'onleave', 'leaver']) await expect(page.getByTestId(tid.lifecycle.option(s))).toBeVisible();
  for (const s of ['candidate', 'preboard', 'archived', 'active']) await expect(page.getByTestId(tid.lifecycle.option(s))).toHaveCount(0);
  await page.getByTestId(tid.lifecycle.option('leaver')).check();
  await page.getByTestId(tid.lifecycle.reason).fill('Resigned, last day 30 September');
  const moved = answered(page, 'POST', /\/transitions$/);
  await page.getByTestId(tid.lifecycle.save).click();
  expect((await moved).status()).toBe(200);
  expect(await personByCode(api, 'CP-1042')).toMatchObject({ state: 'leaver', end: '2026-08-13' });
  expect((await auditOf(api, 'person'))[0]).toMatchObject({ act: 'Employee leaver', entityId: 'CP-1042', reason: 'Resigned, last day 30 September' });
  await expect(page.getByTestId(tid.people.row('CP-1042'))).toHaveCount(0);
  await pick(page, tid.people.stateFilter, 'all');
  await expect(page.getByTestId(tid.people.row('CP-1042'))).toBeVisible();
});

test('DM A valid entry is created, it lands on that dimension’s page, and creation is audited; the edit is audited as a diff; an entry in use cannot be removed, and says what uses it; an unused entry can be removed, and it is gone from the list', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/aloc');
  await page.getByTestId(tid.dims.card('locations')).click();
  await page.getByTestId(tid.dims.add).click();
  await page.getByTestId(tid.dims.field('code')).fill('TQ');
  await page.getByTestId(tid.dims.field('name')).fill('Test Quay');
  await page.getByTestId(tid.dims.save).click();
  await expect(page.getByTestId(tid.dims.row('TQ'))).toBeVisible();
  await expect(page).toHaveURL(/\/setup\/aloc\?d=locations$/);
  expect((await rows<{ code: string }>(api, '/api/v1/locations')).map(l => l.code)).toContain('TQ');
  expect((await auditOf(api, 'location'))[0]).toMatchObject({ act: 'Location created', entityId: 'TQ' });

  await page.getByTestId(tid.dims.edit('TQ')).click();
  await page.getByTestId(tid.dims.field('name')).fill('Test Quay North');
  await page.getByTestId(tid.dims.save).click();
  await expect(page.getByTestId(tid.toast.info).filter({ hasText: 'Test Quay North updated' })).toBeVisible();
  expect((await auditOf(api, 'location'))[0]).toMatchObject({ act: 'Location edited', before: { name: 'Test Quay' }, after: { name: 'Test Quay North' } });

  const before = await rows(api, '/api/v1/locations');
  await page.getByTestId(tid.dims.edit('WH')).click();
  await page.getByTestId(tid.dims.remove).click();
  await expect(page.getByTestId(tid.dims.warn)).toContainText(/WH is used by \d+ people/);
  expect(await rows(api, '/api/v1/locations')).toEqual(before);
  await page.getByTestId(tid.dims.cancel).click();

  await page.getByTestId(tid.dims.edit('TQ')).click();
  await page.getByTestId(tid.dims.remove).click();
  await expect(page.getByTestId(tid.dims.row('TQ'))).toHaveCount(0);
  expect((await rows<{ code: string }>(api, '/api/v1/locations')).map(l => l.code)).not.toContain('TQ');
});

test('DM Job profiles no longer live on the Employee types page; ET A type is created, it appears in the type list, and it can be removed; a type people hold is refused, naming them; a contract is edited through the person record', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/atypes');
  await page.getByTestId(tid.types.jobsLink).click();
  await expect(page).toHaveURL(/\/setup\/aloc\?d=job-profiles$/);
  await page.getByTestId(tid.dims.table).waitFor();

  await page.goto('/setup/atypes');
  await page.getByTestId(tid.types.add).click();
  await page.getByTestId(tid.types.newField('name')).fill('Waking Night Support');
  await page.getByTestId(tid.types.newSave).click();
  await expect(page.getByTestId(tid.types.chip('waking_night_support'))).toHaveAttribute('aria-pressed', 'true');
  expect((await rows<{ code: string }>(api, '/api/v1/employee-types')).map(t => t.code)).toContain('waking_night_support');
  expect((await auditOf(api, 'employeeType'))[0]).toMatchObject({ act: 'Employee type created', entityId: 'waking_night_support' });
  await page.getByTestId(tid.types.remove).click();
  await expect(page.getByTestId(tid.types.chip('waking_night_support'))).toHaveCount(0);
  expect((await rows<{ code: string }>(api, '/api/v1/employee-types')).map(t => t.code)).not.toContain('waking_night_support');

  const held = await rows(api, '/api/v1/employee-types');
  await page.getByTestId(tid.types.chip('shift')).click();
  await page.getByTestId(tid.types.remove).click();
  await expect(page.getByTestId(tid.types.warn)).toContainText(/is used by \d+ people/);
  expect(await rows(api, '/api/v1/employee-types')).toEqual(held);

  await page.goto('/setup/acon');
  await page.getByTestId(tid.contracts.edit('CP-1088')).click();
  await page.getByTestId(tid.contracts.hours).fill('25');
  await page.getByTestId(tid.contracts.save).click();
  await expect(page.getByTestId(tid.contracts.row('CP-1088'))).toContainText('25 h');
  expect(await personByCode(api, 'CP-1088')).toMatchObject({ contractedHours: 25 });
});

test('CR The capability appears in the matrix', async ({ page, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/aperm');
  await expect(page.getByTestId(tid.access.table)).toContainText('Add and edit people');
});

test.describe('the professional-services tenant', () => {
  test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });
  test('EI Employee IDs are the tenant’s own, not Business Central keys; a Business Central resource number is a separate field; a new ID follows the scheme already in use; TD the roster is the real resource list, inactive resources are archived, and the projects and cost centres are the real ones', async ({ page, api, signInAs }) => {
    await signInAs('admin');
    const people = await everyone(api);
    expect(people.every(p => /^EMP\d{3}$/.test(p.code))).toBe(true);
    for (const name of ['Pukar Sthapit', 'Bijay Shrestha', 'Eddie Harford']) expect(people.map(p => p.name.replace(/\s+/g, ' ')).join(', '), name).toContain(name);
    await page.goto('/setup/apeople');
    await expect(page.getByTestId(tid.people.row('EMP001'))).toBeVisible();
    await expect(page.getByTestId(tid.people.row('EMP008'))).toHaveCount(0);
    await pick(page, tid.people.stateFilter, 'archived');
    await expect(page.getByTestId(tid.people.row('EMP008'))).toBeVisible();
    expect((await personByCode(api, 'EMP008')).state).toBe('archived');

    await pick(page, tid.people.stateFilter, 'here');
    const emp = await personByCode(api, 'EMP001');
    expect(emp.resource).not.toBe(emp.code);
    await page.getByTestId(tid.people.edit('EMP001')).click();
    await expect(page.getByTestId(tid.personForm.field('resource'))).toHaveValue(emp.resource);
    await expect(page.getByTestId(tid.personForm.field('code'))).toHaveValue('EMP001');
    await page.getByTestId(tid.personForm.cancel).click();
    await page.getByTestId(tid.people.add).click();
    await expect(page.getByTestId(tid.personForm.field('code'))).toHaveValue('EMP021');
    await page.getByTestId(tid.personForm.cancel).click();

    /* PS Two resources sharing one email resolve to one account, the stronger role */
    const accounts = await rows<{ email: string; userType: string }>(api, '/api/v1/session/accounts');
    expect(accounts.filter(a => a.email === 'manish.nepal@dogmagroup.co.uk')).toEqual([expect.objectContaining({ userType: 'admin' })]);

    await page.goto('/setup/aloc?d=projects');
    await expect(page.getByTestId(tid.dims.row('J00020'))).toContainText('Qnipay D365 Implementation');
    await page.goto('/setup/aloc?d=cost-centres');
    await expect(page.getByTestId(tid.dims.row('CC-100'))).toContainText('Delivery');
  });
});
