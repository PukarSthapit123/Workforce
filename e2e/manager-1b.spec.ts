import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { everyone, personByCode, pick, rows } from './support/read';

/* Plan 1b, the manager's journey: their own location only, adding someone
   there, and deciding the profile changes awaiting them, with a bank change
   going on to payroll before it takes effect (Review Focus 2, 5). */
test.beforeEach(async ({ api }) => { await api.reset(); await api.setClock(FROZEN); });
interface Change { id: string; personCode: string; field: string; status: string; stage: string }

test('a manager sees only their own location, adds someone there, and is not offered the user type', async ({ page, api, signInAs }) => {
  await signInAs('manager');
  await page.goto('/team/tpeople');
  await expect(page.getByTestId(tid.people.row('CP-1042'))).toBeVisible();
  await expect(page.getByTestId(tid.people.row('EMP-2044'))).toHaveCount(0);
  expect((await everyone(api)).every(p => p.location === 'WH')).toBe(true);

  await page.getByTestId(tid.people.add).click();
  await expect(page.getByTestId(tid.personForm.field('code'))).not.toHaveValue('');
  await expect(page.getByTestId(tid.personForm.field('userType'))).toHaveCount(0);
  const id = await page.getByTestId(tid.personForm.field('code')).inputValue();
  await page.getByTestId(tid.personForm.field('name')).fill('New Starter');
  await page.getByTestId(tid.personForm.field('email')).fill('new.starter@brightpath.org');
  await pick(page, tid.personForm.field('state'), 'candidate');
  await page.getByTestId(tid.personForm.save).click();
  await expect(page.getByTestId(tid.people.row(id))).toBeVisible();
  expect(await personByCode(api, id)).toMatchObject({ name: 'New Starter', location: 'WH', state: 'candidate' });
  const accounts = await rows<{ email: string; userType: string }>(api, '/api/v1/session/accounts');
  expect(accounts.find(a => a.email === 'new.starter@brightpath.org')).toMatchObject({ userType: 'employee' });
});

test('a manager approves one change and declines another with a reason; a bank change they approve waits for payroll, and takes effect once payroll approves', async ({ page, api, signInAs }) => {
  await signInAs('employee');
  await page.goto('/work/profile');
  await page.getByTestId(tid.profile.state).waitFor(); // the worker is answering after the navigation
  const me = (await api.get('/api/v1/profile')).body as { person: { code: string; bankAccount: string } };
  expect((await api.send('POST', '/api/v1/profile-changes', { changes: [{ field: 'bankAccount', to: '12345678' }], note: 'New bank' })).status).toBe(200);

  await signInAs('manager');
  await page.goto('/team/tpeople');
  await page.getByTestId(tid.queue.root('manager')).waitFor();
  const queue = await rows<Change>(api, '/api/v1/profile-changes');
  const phone = queue.find(c => c.personCode === 'CP-1088' && c.field === 'phone');
  const address = queue.find(c => c.personCode === 'CP-1201' && c.field === 'address');
  const bank = queue.find(c => c.personCode === me.person.code && c.field === 'bankAccount');
  if (!phone || !address || !bank) throw new Error('the queue is missing a seeded or proposed change');

  await page.getByTestId(tid.queue.approve(phone.id)).click();
  await expect(page.getByTestId(tid.queue.row(phone.id))).toHaveCount(0);
  expect((await personByCode(api, 'CP-1088')).phone).toBe('07700 900461');

  const addressWas = (await personByCode(api, 'CP-1201')).address;
  await page.getByTestId(tid.queue.decline(address.id)).click();
  await page.getByTestId(tid.queue.reason).fill('Address not recognised');
  await page.getByTestId(tid.queue.confirmDecline).click();
  await expect(page.getByTestId(tid.queue.row(address.id))).toHaveCount(0);
  expect((await personByCode(api, 'CP-1201')).address).toBe(addressWas);

  await expect(page.getByTestId(tid.queue.payroll(bank.id))).toContainText('Payroll verifies');
  await page.getByTestId(tid.queue.approve(bank.id)).click();
  await expect(page.getByTestId(tid.queue.row(bank.id))).toHaveCount(0);
  expect((await personByCode(api, me.person.code)).bankAccount).toBe(me.person.bankAccount);

  await signInAs('admin');
  await page.goto('/setup/apeople');
  await page.getByTestId(tid.queue.approve(bank.id)).click();
  await expect(page.getByTestId(tid.queue.root('payroll'))).toHaveCount(0);
  expect((await personByCode(api, me.person.code)).bankAccount).toBe('****5678');
});
