import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import type { StoredNotice } from '@/mocks/notices';
import { TeamNoticesPage } from './TeamNoticesPage';

/* My team → Notices for Rachel Hussain, who manages Willow House: its
   urgent fire drill (acknowledged by two of eleven) and its draft are hers;
   the organisation notices are shown read-only. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('manager'); });
const ntc = (id: string) => store.coll<StoredNotice>('notices')[id];
const open = async () => { renderPage(<TeamNoticesPage />, '/team/tnotices'); await screen.findByTestId(tid.tnotices.table); };
const track = async (id: string) => {
  await userEvent.click(screen.getByTestId(tid.tnotices.open(id)));
  const box = await screen.findByTestId(tid.modal.root);
  await within(box).findByTestId(tid.tnotices.trackBody);
  return box;
};

test('the notices she manages, draft first, organisation ones read-only, with counts per state, and full test id coverage', async () => {
  await open();
  const rows = within(screen.getByTestId(tid.tnotices.table)).getAllByRole('row').slice(1);
  expect(rows.map(r => r.getAttribute('data-testid'))).toEqual(['NTC-0004', 'NTC-0002', 'NTC-0001', 'NTC-0003'].map(tid.tnotices.row));
  expect(screen.getByTestId(tid.tnotices.state('NTC-0004'))).toHaveTextContent('Draft');
  expect(screen.getByTestId(tid.tnotices.acks('NTC-0002'))).toHaveTextContent('2 of 11');
  expect(screen.getByTestId(tid.tnotices.readOnly('NTC-0001'))).toHaveTextContent('Read only');
  expect(screen.getByTestId(tid.tnotices.row('NTC-0001'))).toHaveTextContent('No end date');
  expect(screen.getByTestId(tid.tnotices.filter('all'))).toHaveTextContent('All · 4');
  expect(screen.getByTestId(tid.tnotices.filter('current'))).toHaveTextContent('Live · 2');
  expectTestIdCoverage(document.body);
  await userEvent.click(screen.getByTestId(tid.tnotices.filter('draft')));
  await waitFor(() => expect(screen.queryByTestId(tid.tnotices.row('NTC-0002'))).toBeNull());
  expect(screen.getByTestId(tid.tnotices.row('NTC-0004'))).toBeInTheDocument();
  await userEvent.click(screen.getByTestId(tid.tnotices.filter('withdrawn')));
  expect(await screen.findByTestId(tid.tnotices.empty)).toHaveTextContent('No withdrawn notices.');
});

test('posting a notice to her location tells her how many it reaches', async () => {
  await open();
  await userEvent.click(screen.getByTestId(tid.tnotices.add));
  const box = await screen.findByTestId(tid.modal.root);
  expect([...within(box).getByTestId<HTMLSelectElement>(tid.tnotices.scope).options].map(o => o.text)).toEqual(['Willow House', 'Care Services · Willow House']);
  expect(within(box).getByTestId(tid.tnotices.from)).toHaveValue('2026-08-13');
  expectTestIdCoverage(document.body);
  await userEvent.click(within(box).getByTestId(tid.tnotices.postNow));
  expect(await within(box).findByText('Give the notice a title. Nothing has been saved.')).toBeInTheDocument();
  await userEvent.type(within(box).getByTestId(tid.tnotices.title), 'Hand hygiene audit next week');
  await userEvent.type(within(box).getByTestId(tid.tnotices.body), 'Every sink will be checked on Tuesday.');
  await userEvent.click(within(box).getByTestId(tid.tnotices.postNow));
  expect(await screen.findByText('Posted. Hand hygiene audit next week. 11 people in Willow House.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
  expect(await screen.findByTestId(tid.tnotices.row('NTC-0005'))).toHaveTextContent('0 of 11');
  expect(ntc('NTC-0005')).toMatchObject({ state: 'live', textVersion: 1, scope: { kind: 'loc', code: 'WH', loc: 'WH' } });
});

test('editing the words of a live notice makes v2 and asks those who acknowledged again', async () => {
  await open();
  let box = await track('NTC-0002');
  expect(within(box).getByTestId(tid.tnotices.trackAcks)).toHaveTextContent('Acknowledgements · 2 of 11');
  expect(within(box).getByTestId(tid.tnotices.trackStatus('CP-1088'))).toHaveTextContent('v1 ·');
  expectTestIdCoverage(document.body);
  await userEvent.click(within(box).getByTestId(tid.tnotices.trackEdit));
  box = await screen.findByTestId(tid.modal.root);
  await within(box).findByTestId(tid.tnotices.title);
  expect(within(box).getByTestId(tid.tnotices.resetWarn)).toHaveTextContent('2 people have acknowledged v1');
  expect(within(box).getByTestId(tid.tnotices.scope)).toBeDisabled();
  expectTestIdCoverage(document.body);
  fireEvent.change(within(box).getByTestId(tid.tnotices.body), { target: { value: 'Meet at the back car park instead.' } });
  await userEvent.click(within(box).getByTestId(tid.tnotices.save));
  expect(await screen.findByText('Saved as v2. 11 people now need to acknowledge it.')).toBeInTheDocument();
  expect(ntc('NTC-0002')).toMatchObject({ textVersion: 2, history: [{ textVersion: 1 }] });
  await waitFor(() => expect(screen.getByTestId(tid.tnotices.acks('NTC-0002'))).toHaveTextContent('0 of 11'));
  box = await track('NTC-0002');
  expect(within(box).getByTestId(tid.tnotices.trackStatus('CP-1088'))).toHaveTextContent('Outstanding · had v1');
  expect(within(box).getByTestId(tid.tnotices.historyRow(1))).toHaveTextContent('v1 · Fire drill on Thursday at 10:00');
  expect(within(box).getByTestId(tid.tnotices.trail)).toHaveTextContent('Notice edited · v1 → v2');
});

test('withdrawing needs a reason, then the notice stays on her list as withdrawn', async () => {
  await open();
  let box = await track('NTC-0002');
  await userEvent.click(within(box).getByTestId(tid.tnotices.trackWithdraw));
  box = await screen.findByTestId(tid.modal.root);
  await userEvent.click(await within(box).findByTestId(tid.tnotices.withdrawOk));
  expect(await within(box).findByText('Give a reason. Colleagues who acknowledged keep their record.')).toBeInTheDocument();
  expect(ntc('NTC-0002')?.state).toBe('live');
  expectTestIdCoverage(document.body);
  await userEvent.type(within(box).getByTestId(tid.tnotices.reason), 'Drill moved to next month');
  await userEvent.click(within(box).getByTestId(tid.tnotices.withdrawOk));
  expect(await screen.findByText('Withdrawn. Fire drill on Thursday at 10:00. Colleagues no longer see it. The record stays on My team → Notices.')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId(tid.tnotices.state('NTC-0002'))).toHaveTextContent('Withdrawn'));
  expect(ntc('NTC-0002')).toMatchObject({ state: 'withdrawn', withdrawReason: 'Drill moved to next month' });
  box = await track('NTC-0002');
  expect(within(box).getByTestId(tid.tnotices.trackWithdrawn)).toHaveTextContent('Drill moved to next month');
});

test('a live notice cannot be deleted and says to withdraw it; a draft can', async () => {
  await open();
  let box = await track('NTC-0002');
  await userEvent.click(within(box).getByTestId(tid.tnotices.trackDelete));
  expect(await screen.findByText('Fire drill on Thursday at 10:00 cannot be deleted. It has been live and holds 2 acknowledgements.')).toBeInTheDocument();
  expect(screen.getByText('Withdraw it instead.')).toBeInTheDocument();
  expect(ntc('NTC-0002')).toBeDefined();
  await userEvent.click(within(box).getByTestId(tid.tnotices.trackClose));
  await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
  box = await track('NTC-0004');
  await userEvent.click(within(box).getByTestId(tid.tnotices.trackDelete));
  expect(await screen.findByText('Draft deleted. Nobody had seen it.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByTestId(tid.tnotices.row('NTC-0004'))).toBeNull());
  expect(ntc('NTC-0004')).toBeUndefined();
  expect(audits().filter(a => a.act === 'Notice deleted')).toHaveLength(1);
});

test('pinning from the tracker keeps the version and moves the notice up', async () => {
  await open();
  const box = await track('NTC-0002');
  await userEvent.click(within(box).getByTestId(tid.tnotices.trackPin));
  expect(await screen.findByText('Pinned. It now sits at the top for everyone it reaches.')).toBeInTheDocument();
  expect(ntc('NTC-0002')).toMatchObject({ pinned: true, textVersion: 1 });
  await waitFor(() => expect(within(box).getByTestId(tid.tnotices.trackPin)).toHaveTextContent('Unpin'));
});
