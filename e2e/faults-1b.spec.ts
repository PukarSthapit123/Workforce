import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { everyone, personByCode, pick, rows } from './support/read';

/* Plan 1b Review Focus 6: a 500 on a write shows the error toast and leaves
   both the screen and the store as they were. One journey across the 1b
   writes: create, edit and move a person, a dimension, an employee type, a
   proposal and a decision. A fault is registered after signing in, because
   signing in reloads the page and faults live in the page (fixtures.ts). */
test.beforeEach(async ({ api }) => { await api.reset(); await api.setClock(FROZEN); });

test('a fault on any 1b write shows the refusal and changes nothing', async ({ page, api, signInAs }) => {
  const refused = async () => { await expect(page.getByTestId(tid.toast.error).last()).toContainText('Nothing has been changed'); };
  await signInAs('employee');
  await page.goto('/work/profile');
  await page.getByTestId(tid.profile.propose).click();
  await page.getByTestId(tid.profile.field('phone')).fill('07700 900111');
  await api.fault('POST', '/api/v1/profile-changes', 500);
  await page.getByTestId(tid.profile.send).click();
  await refused();
  await expect(page.getByTestId(tid.profile.send)).toBeVisible();
  expect(((await api.get('/api/v1/profile')).body as { pending: unknown[] }).pending).toEqual([]);

  await signInAs('admin');
  await page.goto('/setup/apeople');
  await page.getByTestId(tid.people.table).waitFor();
  const people = await everyone(api), amara = await personByCode(api, 'CP-1042');

  await page.getByTestId(tid.people.add).click();
  await page.getByTestId(tid.personForm.field('name')).fill('Test Person');
  await page.getByTestId(tid.personForm.field('email')).fill('test.person@brightpath.org');
  await pick(page, tid.personForm.field('location'), 'WH');
  await api.fault('POST', '/api/v1/people', 500);
  await page.getByTestId(tid.personForm.save).click();
  await refused();
  await expect(page.getByTestId(tid.personForm.root)).toBeVisible();
  await page.getByTestId(tid.personForm.cancel).click();

  await page.getByTestId(tid.people.edit('CP-1042')).click();
  await page.getByTestId(tid.personForm.field('contractedHours')).fill('20');
  await api.fault('PATCH', `/api/v1/people/${amara.id}`, 500);
  await page.getByTestId(tid.personForm.save).click();
  await refused();
  await page.getByTestId(tid.personForm.cancel).click();

  await page.getByTestId(tid.people.open('CP-1042')).click();
  await page.getByTestId(tid.person.changeState).click();
  await page.getByTestId(tid.lifecycle.option('suspended')).check();
  await page.getByTestId(tid.lifecycle.reason).fill('Investigation');
  await api.fault('POST', `/api/v1/people/${amara.id}/transitions`, 500);
  await page.getByTestId(tid.lifecycle.save).click();
  await refused();
  await page.getByTestId(tid.lifecycle.cancel).click();
  await expect(page.getByTestId(tid.people.state('CP-1042'))).toContainText('Active');
  expect(await everyone(api)).toEqual(people);

  await page.goto('/setup/aloc?d=locations');
  await page.getByTestId(tid.dims.table).waitFor();
  const locations = await rows(api, '/api/v1/locations');
  await page.getByTestId(tid.dims.add).click();
  await page.getByTestId(tid.dims.field('code')).fill('TQ');
  await page.getByTestId(tid.dims.field('name')).fill('Test Quay');
  await api.fault('POST', '/api/v1/locations', 500);
  await page.getByTestId(tid.dims.save).click();
  await refused();
  expect(await rows(api, '/api/v1/locations')).toEqual(locations);

  await page.goto('/setup/atypes');
  await page.getByTestId(tid.types.detail).waitFor();
  const types = await rows<{ id: string; code: string }>(api, '/api/v1/employee-types');
  await page.getByTestId(tid.types.chip('shift')).click();
  await page.getByTestId(tid.types.cap('vehicle')).click();
  const shift = types.find(t => t.code === 'shift');
  if (!shift) throw new Error('no shift type');
  await api.fault('PATCH', `/api/v1/employee-types/${shift.id}`, 500);
  await page.getByTestId(tid.types.save).click();
  await refused();
  expect(await rows(api, '/api/v1/employee-types')).toEqual(types);

  await signInAs('manager');
  await page.goto('/team/tpeople');
  await page.getByTestId(tid.queue.root('manager')).waitFor();
  const queue = await rows<{ id: string; personCode: string }>(api, '/api/v1/profile-changes');
  const change = queue.find(c => c.personCode === 'CP-1088');
  if (!change) throw new Error('no seeded change for CP-1088');
  const phoneWas = (await personByCode(api, 'CP-1088')).phone;
  await api.fault('POST', `/api/v1/profile-changes/${change.id}/decision`, 500);
  await page.getByTestId(tid.queue.approve(change.id)).click();
  await refused();
  await expect(page.getByTestId(tid.queue.row(change.id))).toBeVisible();
  expect(await rows(api, '/api/v1/profile-changes')).toEqual(queue);
  expect((await personByCode(api, 'CP-1088')).phone).toBe(phoneWas);
});
