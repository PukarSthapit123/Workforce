import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { fault, personOf, resetTo, signInAs, snapshot } from '@/test/api-helpers';
import { store } from '@/mocks/store';
import { ContractsPage } from './ContractsPage';

withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });
const openEdit = async (code: string) => {
  renderPage(<ContractsPage />);
  await userEvent.click(await screen.findByTestId(tid.contracts.edit(code)));
  await screen.findByTestId(tid.contracts.save);
};
const set = (id: string, value: string) => fireEvent.change(screen.getByTestId(id), { target: { value } });

test('contracts list every person with their hours, with full test id coverage', async () => {
  renderPage(<ContractsPage />);
  expect(await screen.findByTestId(tid.contracts.row('CP-1042'))).toHaveTextContent('37.5');
  expect(screen.getByTestId(tid.contracts.row('CP-1288'))).toBeInTheDocument();
  expectTestIdCoverage(document.body);
});
test('an hours change is saved through the person record and audited, with full test id coverage on the form', async () => {
  const v = personOf('CP-1042').version;
  await openEdit('CP-1042');
  expectTestIdCoverage(document.body);
  set(tid.contracts.hours, '30');
  await userEvent.click(screen.getByTestId(tid.contracts.save));
  expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Amara Okafor updated · 1 field(s) changed');
  expect(personOf('CP-1042')).toMatchObject({ contractedHours: 30, version: v + 1 });
});
test('contracted hours cannot exceed the maximum, said inline', async () => {
  await openEdit('CP-1042');
  set(tid.contracts.max, '20');
  await userEvent.click(screen.getByTestId(tid.contracts.save));
  expect(await screen.findByTestId(tid.contracts.warn)).toHaveTextContent('cannot exceed the maximum');
});
test('a failed save shows the refusal and leaves the record as it was', async () => {
  const before = snapshot('people');
  await openEdit('CP-1042');
  set(tid.contracts.hours, '10');
  await fault('PATCH', `/api/v1/people/${personOf('CP-1042').id}`);
  await userEvent.click(screen.getByTestId(tid.contracts.save));
  expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
  expect(snapshot('people')).toEqual(before);
});
test('CR A crumb still appears where it names a real route', async () => {
  renderPage(<ContractsPage />);
  await screen.findByTestId(tid.contracts.table);
  expect(screen.getByText('Qnipay setup · Contracts')).toBeInTheDocument();
});
/* After a 412 the screen re-reads the people, and the open form starts again
   from the record as it now stands, so the next save carries the fresh
   version instead of being refused again. */
test('after someone else saves the same person, a 412 refreshes the form and the next save goes through', async () => {
  await openEdit('CP-1042');
  const p = personOf('CP-1042');
  store.coll('people')[p.id] = { ...p, version: p.version + 1, maxHours: 44 };
  store.save();
  set(tid.contracts.hours, '30');
  await userEvent.click(screen.getByTestId(tid.contracts.save));
  expect(await screen.findByTestId(tid.toast.error)).toBeInTheDocument();
  expect(await screen.findByDisplayValue('44')).toBe(screen.getByTestId(tid.contracts.max));
  set(tid.contracts.hours, '30');
  await userEvent.click(screen.getByTestId(tid.contracts.save));
  expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Amara Okafor updated · 1 field(s) changed');
  expect(personOf('CP-1042')).toMatchObject({ contractedHours: 30, maxHours: 44, version: p.version + 2 });
});
