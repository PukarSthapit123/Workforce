import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { accountOf, caller, personOf, resetTo, signInAs, tokenFor } from '@/test/api-helpers';
import { TeamPeoplePage } from '@/features/people/TeamPeoplePage';
import { AdminPeoplePage } from '@/features/people/AdminPeoplePage';

withFakeServer();
beforeEach(() => resetTo('social'));
const pendingId = (code: string, field: string) => {
  const c = Object.values(store.coll<{ id: string; personCode: string; field: string; status: string }>('profileChanges'))
    .find(x => x.personCode === code && x.field === field && x.status === 'pending');
  if (!c) throw new Error(`no pending ${field} for ${code}`);
  return c.id;
};

test('a manager sees the changes awaiting them on My team · People, with full test id coverage', async () => {
  await signInAs('manager');
  renderPage(<TeamPeoplePage />);
  expect(await screen.findByTestId(tid.queue.row(pendingId('CP-1088', 'phone')))).toHaveTextContent('Mobile number');
  expect(screen.getByTestId(tid.queue.row(pendingId('CP-1201', 'address')))).toHaveTextContent('Home address');
  await screen.findByTestId(tid.people.table);
  expectTestIdCoverage(document.body);
});
test('approving writes the value to the one record', async () => {
  await signInAs('manager');
  const id = pendingId('CP-1088', 'phone');
  const to = String((store.coll<{ to: string }>('profileChanges')[id] ?? { to: '' }).to);
  renderPage(<TeamPeoplePage />);
  await userEvent.click(await screen.findByTestId(tid.queue.approve(id)));
  expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Approved · Mobile number updated on the workforce record');
  expect(personOf('CP-1088').phone).toBe(to);
});
test('declining needs a reason, and leaves the record as it was, with full test id coverage', async () => {
  await signInAs('manager');
  const id = pendingId('CP-1201', 'address'), was = personOf('CP-1201').address;
  renderPage(<TeamPeoplePage />);
  await userEvent.click(await screen.findByTestId(tid.queue.decline(id)));
  expectTestIdCoverage(document.body);
  await userEvent.click(await screen.findByTestId(tid.queue.confirmDecline));
  expect(await screen.findByTestId(tid.queue.warn)).toHaveTextContent('Give a reason');
  await userEvent.type(screen.getByTestId(tid.queue.reason), 'Not recognised');
  await userEvent.click(screen.getByTestId(tid.queue.confirmDecline));
  expect(await screen.findByText('Declined · Home address left unchanged')).toBeInTheDocument();
  expect(personOf('CP-1201').address).toBe(was);
});
test('a bank change says payroll verifies it, and after the manager approves it waits for payroll on Qnipay setup · People', async () => {
  const emp = accountOf('employee').personCode;
  await caller(await tokenFor('employee'))('POST', '/api/v1/profile-changes', { changes: [{ field: 'bankAccount', to: '12345678' }], note: '' });
  const id = pendingId(emp, 'bankAccount');
  await signInAs('manager');
  const team = renderPage(<TeamPeoplePage />);
  expect(await screen.findByTestId(tid.queue.payroll(id))).toHaveTextContent('Payroll verifies');
  await userEvent.click(screen.getByTestId(tid.queue.approve(id)));
  expect(await screen.findByText(/passed to payroll/)).toBeInTheDocument();
  expect(store.coll<{ bankAccount: string }>('people')[personOf(emp).id]?.bankAccount).not.toBe('12345678');
  team.unmount();
  await signInAs('admin');
  renderPage(<AdminPeoplePage />);
  await userEvent.click(await screen.findByTestId(tid.queue.approve(id)));
  expect(await screen.findByText(/Bank account number updated on the workforce record/)).toBeInTheDocument();
  expect(store.coll<{ bankAccount: string }>('people')[personOf(emp).id]?.bankAccount).toBe('12345678');
});
