import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { accountOf, caller, fault, personOf, resetTo, signInAs, snapshot, tokenFor } from '@/test/api-helpers';
import { queryClient } from '@/api/query';
import { tenantKeys } from '@/api/tenant';
import { ProfilePage } from './ProfilePage';

withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('employee'); });
const me = () => personOf(accountOf('employee').personCode);
const openPropose = async () => {
  renderPage(<ProfilePage />);
  await userEvent.click(await screen.findByTestId(tid.profile.propose));
  await screen.findByTestId(tid.profile.send);
};
const set = (key: string, value: string) => fireEvent.change(screen.getByTestId(tid.profile.field(key)), { target: { value } });

test('my profile shows my own record and details, with full test id coverage', async () => {
  renderPage(<ProfilePage />);
  expect(await screen.findByTestId(tid.profile.value('phone'))).toHaveTextContent(String(me().phone));
  expect(screen.getByTestId(tid.profile.fact('code'))).toHaveTextContent(String(me().code));
  expectTestIdCoverage(document.body);
});
test('proposing a change sends it for approval and leaves the record as it was, with full test id coverage', async () => {
  const was = String(me().phone);
  await openPropose();
  expectTestIdCoverage(document.body);
  set('phone', '07700 900461');
  await userEvent.click(screen.getByTestId(tid.profile.send));
  expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Sent for approval · Mobile number');
  expect(me().phone).toBe(was);
  expect(await screen.findByTestId(tid.profile.pending('phone'))).toHaveTextContent('07700 900461 awaiting approval');
});
test('a field already awaiting approval cannot be proposed again, and bank details say payroll checks them', async () => {
  await caller(await tokenFor('employee'))('POST', '/api/v1/profile-changes', { changes: [{ field: 'phone', to: '07700 900461' }], note: '' });
  await openPropose();
  expect(screen.getByTestId(tid.profile.field('phone'))).toBeDisabled();
  expect(screen.getByTestId(tid.profile.payroll('bankAccount'))).toHaveTextContent('Payroll checks this');
  expect(screen.queryByTestId(tid.profile.payroll('phone'))).toBeNull();
});
test('an unchanged form is refused inline and raises nothing', async () => {
  const before = snapshot('profileChanges');
  await openPropose();
  await userEvent.click(screen.getByTestId(tid.profile.send));
  expect(await screen.findByTestId(tid.profile.warn)).toHaveTextContent('Nothing has changed.');
  expect(snapshot('profileChanges')).toEqual(before);
});
test('a failed send shows the refusal and raises nothing', async () => {
  const before = snapshot('profileChanges');
  await openPropose();
  set('address', '1 New Street');
  await fault('POST', '/api/v1/profile-changes');
  await userEvent.click(screen.getByTestId(tid.profile.send));
  expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
  expect(snapshot('profileChanges')).toEqual(before);
});
test('with self-service switched off, the page says so and offers no change', async () => {
  const t = store.coll<{ flags: Record<string, unknown> }>('tenant').tenant;
  if (!t) throw new Error('no tenant');
  t.flags = { ...t.flags, SELF_EDIT: false };
  renderPage(<ProfilePage />);
  expect(await screen.findByTestId(tid.profile.off)).toHaveTextContent('switched off');
  expect(screen.queryByTestId(tid.profile.propose)).toBeNull();
});

/* Suite GUIDES: "The documents link survived the banner removal" (essProfile,
   v15:5647): Open documents goes to My documents while the Document centre is
   on, and is not offered while it is off. */
test('Open documents goes to My documents while the Document centre is on, and is gone while it is off', async () => {
  const view = renderPage(<ProfilePage />);
  expect(await screen.findByTestId(tid.profile.docs)).toHaveAttribute('href', '/work/docs');
  view.unmount();
  const t = store.coll<{ flags: Record<string, unknown> }>('tenant').tenant;
  if (!t) throw new Error('no tenant');
  t.flags = { ...t.flags, DOCS: false };
  renderPage(<ProfilePage />);
  await screen.findByTestId(tid.profile.value('phone'));
  await waitFor(() => expect(queryClient.getQueryState(tenantKeys.all)?.status).toBe('success'));
  expect(screen.queryByTestId(tid.profile.docs)).toBeNull();
});
