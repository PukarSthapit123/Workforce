import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, fault, personOf, resetTo, signInAs, snapshot } from '@/test/api-helpers';
import { AdminPeoplePage } from './AdminPeoplePage';

withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });
const openDialog = async (code = 'CP-1042') => {
  renderPage(<AdminPeoplePage />);
  await userEvent.click(await screen.findByTestId(tid.people.open(code)));
  await userEvent.click(await screen.findByTestId(tid.person.changeState));
  await screen.findByTestId(tid.lifecycle.save);
};
const choose = async (state: string, reason?: string) => {
  await userEvent.click(screen.getByTestId(tid.lifecycle.option(state)));
  if (reason) await userEvent.type(screen.getByTestId(tid.lifecycle.reason), reason);
  await userEvent.click(screen.getByTestId(tid.lifecycle.save));
};

test('CR A lifecycle dialog offers only the legal next states, with full test id coverage', async () => {
  await openDialog();
  const offered = [...document.querySelectorAll('input[name="lifecycle-to"]')].map(i => (i as HTMLInputElement).value);
  expect(offered).toEqual(['suspended', 'onleave', 'leaver']);
  expectTestIdCoverage(document.body);
});
test('CR It warns that some moves release future shifts, and says Rota has not released any', async () => {
  await openDialog();
  expect(screen.getByTestId(tid.lifecycle.caution)).toHaveTextContent(/release future shifts/i);
  expect(screen.getByTestId(tid.lifecycle.caution)).toHaveTextContent('Rota is not built in this build');
});
test('CR A state must be chosen', async () => {
  await openDialog();
  await userEvent.click(screen.getByTestId(tid.lifecycle.save));
  expect(await screen.findByTestId(tid.lifecycle.warn)).toHaveTextContent('Choose a state to move to.');
});
test('CR A reason is required and kept on the record', async () => {
  await openDialog();
  await choose('leaver');
  expect(await screen.findByTestId(tid.lifecycle.warn)).toHaveTextContent('A reason is required');
  expect(personOf('CP-1042').state).toBe('active');
});
test('CR An active record can become a leaver: the transition is applied, with its reason in the audit', async () => {
  await openDialog();
  await choose('leaver', 'Resigned, last day 30 September');
  expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Amara Okafor → Leaver');
  expect(personOf('CP-1042')).toMatchObject({ state: 'leaver', end: '2026-08-13' });
  expect(audits().at(-1)).toMatchObject({ act: 'Employee leaver', reason: 'Resigned, last day 30 September' });
});
test('a failed move shows the refusal and changes nothing', async () => {
  const before = snapshot('people');
  await openDialog();
  await fault('POST', `/api/v1/people/${personOf('CP-1042').id}/transitions`);
  await choose('leaver', 'x');
  expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
  expect(snapshot('people')).toEqual(before);
});
