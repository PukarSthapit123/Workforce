import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { FROZEN, resetTo, signInAs } from '@/test/api-helpers';
import { RotaPage } from './RotaPage';

/* Module 8 group 4B: a Rota chain with a sign-off layer after the rota
   manager's. On social, Rachel Hussain (the manager persona) has sent week 34
   at Willow House to publish; it waits on a Service Manager, Dee Fitzgerald
   (the administrator persona), given "Plan and publish rota" here. */
withFakeServer();
const RACHEL = { personCode: 'CP-1001', name: 'Rachel Hussain' };
beforeEach(() => {
  resetTo('social');
  const admin = store.coll<{ capabilities: string[] }>('userTypes').admin;
  if (!admin) throw new Error('no admin type');
  admin.capabilities = [...admin.capabilities, 'team_rota'];
  const step = (scope: string) => ({ module: 'Rota', role: 'Service Manager', scope, when: 'Every rota week', sla: '1 day', fixed: false });
  store.coll('approvalChains').chain_rota = { id: 'chain_rota', version: 1, updatedAt: FROZEN, module: 'Rota', steps: [step('Own location'), step('All departments')] };
  const rc = store.coll<Record<string, unknown>>('rotaConfig').rotaConfig ?? {};
  store.coll('rotaConfig').rotaConfig = { ...rc, publishBlockOnGap: false };
  store.coll('rotaWeeks')['rw_WH_2026-08-17'] = { id: 'rw_WH_2026-08-17', version: 1, updatedAt: FROZEN, location: 'WH', weekStart: '2026-08-17', lines: {},
    state: 'review', publishVersion: 0, publishedAt: '', publishedBy: null, changes: [],
    signoff: { requestedBy: RACHEL, at: FROZEN, signed: [{ layer: 'Service Manager', by: RACHEL, at: FROZEN }] }, sentBack: null };
  store.save();
});
const toasts = () => screen.queryAllByTestId(tid.toast.info).map(t => t.textContent ?? '').join(' | ');

test('the sign-off holder finds the week waiting on them, signs it off and it is published', async () => {
  await signInAs('admin');
  renderPage(<RotaPage />, '/team/trota');
  const awaiting = await screen.findByTestId(tid.trota.awaiting);
  expect(awaiting).toHaveTextContent('1 week waiting on your sign-off');
  expect(awaiting).toHaveTextContent('Sent to publish by Rachel Hussain.');
  await userEvent.click(within(awaiting).getByTestId(tid.trota.awaitingWeek('rw_WH_2026-08-17')));
  const banner = await screen.findByTestId(tid.trota.signoff);
  expect(banner).toHaveTextContent('Waiting on sign-off by the Service Manager');
  expect(banner).toHaveTextContent('Sent to publish by Rachel Hussain on');
  expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('In review');
  expect(screen.getByTestId(tid.trota.publish)).toBeDisabled();
  expectTestIdCoverage(document.body);
  await userEvent.click(within(banner).getByTestId(tid.trota.signOff));
  await waitFor(() => expect(toasts()).toMatch(/Rota published · v1 · \d+ colleagues notified · signed off/));
  await waitFor(() => expect(screen.queryByTestId(tid.trota.signoff)).toBeNull());
  expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Published · v1');
});

test('the sign-off holder sends it back with a reason, which the rota manager then sees', async () => {
  await signInAs('admin');
  renderPage(<RotaPage />, '/team/trota');
  await userEvent.click(within(await screen.findByTestId(tid.trota.awaiting)).getByTestId(tid.trota.awaitingWeek('rw_WH_2026-08-17')));
  await userEvent.click(within(await screen.findByTestId(tid.trota.signoff)).getByTestId(tid.trota.sendBack));
  await userEvent.click(await screen.findByTestId(tid.trota.sendBackConfirm));
  await waitFor(() => expect(screen.getByTestId(tid.field.root(tid.trota.sendBackReason))).toHaveTextContent('Give a reason for sending it back.'));
  await userEvent.type(screen.getByTestId(tid.trota.sendBackReason), 'Nights are thin on Thursday');
  await userEvent.click(screen.getByTestId(tid.trota.sendBackConfirm));
  await waitFor(() => expect(toasts()).toMatch('Week 34 sent back to Rachel Hussain.'));
  expect(await screen.findByTestId(tid.trota.returned)).toHaveTextContent('“Nights are thin on Thursday”');
  expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Draft');
});

test('the rota manager who sent it sees what it waits on, and cannot publish it again', async () => {
  await signInAs('manager');
  renderPage(<RotaPage />, '/team/trota');
  await screen.findByTestId(tid.trota.grid);
  expect(screen.queryByTestId(tid.trota.awaiting)).toBeNull();
  await userEvent.click(screen.getByTestId(tid.trota.weekNext));
  const banner = await screen.findByTestId(tid.trota.signoff);
  expect(banner).toHaveTextContent('You sent this week to be published, so someone else signs it off.');
  expect(within(banner).queryByTestId(tid.trota.signOff)).toBeNull();
  expect(screen.getByTestId(tid.trota.publish)).toBeDisabled();
  expect(screen.getByTestId(tid.trota.publish)).toHaveAttribute('title', 'Waiting on sign-off by the Service Manager');
  expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Waiting on sign-off by the Service Manager · not visible yet');
});
