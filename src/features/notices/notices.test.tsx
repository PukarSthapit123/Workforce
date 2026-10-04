import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, caller, resetTo, signInAs, tokenFor } from '@/test/api-helpers';
import type { StoredNotice } from '@/mocks/notices';
import { NoticesPage } from './NoticesPage';
import { NoticesHomeCard } from './NoticesHomeCard';

/* My work → Notices for Amara Okafor (Willow House) on the social seed: the
   urgent Willow House fire drill she owes, the pinned lone working policy
   she acknowledged at v2, and the summer social, expired. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('employee'); });
const ntc = (id: string) => store.coll<StoredNotice>('notices')[id];
const open = async () => { renderPage(<NoticesPage />, '/work/notices'); await screen.findByTestId(tid.notices.table); };

test('current notices, urgent first, with where I stand, the expired ones a press away, and full test id coverage', async () => {
  await open();
  const rows = within(screen.getByTestId(tid.notices.table)).getAllByRole('row').slice(1);
  expect(rows.map(r => r.getAttribute('data-testid'))).toEqual([tid.notices.row('NTC-0002'), tid.notices.row('NTC-0001')]);
  expect(screen.getByTestId(tid.notices.seg('current'))).toHaveTextContent('Current · 2');
  expect(screen.getByTestId(tid.notices.seg('expired'))).toHaveTextContent('Expired · 1');
  expect(screen.getByTestId(tid.notices.row('NTC-0002'))).toHaveTextContent('Urgent');
  expect(screen.getByTestId(tid.notices.row('NTC-0002'))).toHaveTextContent('Willow House');
  expect(screen.getByTestId(tid.notices.you('NTC-0002'))).toHaveTextContent('Acknowledge');
  expect(screen.getByTestId(tid.notices.row('NTC-0001'))).toHaveTextContent('Pinned');
  expect(screen.getByTestId(tid.notices.you('NTC-0001'))).toHaveTextContent('Acknowledged 10/08');
  expect(screen.queryByTestId(tid.notices.ack('NTC-0001'))).toBeNull();
  expectTestIdCoverage(document.body);
  await userEvent.click(screen.getByTestId(tid.notices.seg('expired')));
  expect(screen.getByTestId(tid.notices.row('NTC-0003'))).toHaveTextContent('Summer social');
  expect(screen.getByTestId(tid.notices.you('NTC-0003'))).toHaveTextContent('For information');
  expect(screen.getByTestId(tid.notices.row('NTC-0003'))).toHaveTextContent('until 10/08/2026');
});

test('reading a notice and acknowledging it records the version I read, once, and the row says so', async () => {
  await open();
  await userEvent.click(screen.getByTestId(tid.notices.read('NTC-0002')));
  const box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.notices.readBody)).toHaveTextContent('Leave by the nearest exit');
  expect(within(box).getByTestId(tid.notices.readMeta)).toHaveTextContent('Willow House · v1 · Rachel Hussain · 12/08/2026');
  expectTestIdCoverage(document.body);
  await userEvent.click(within(box).getByTestId(tid.notices.readAck));
  expect(await screen.findByText('Acknowledged. Fire drill on Thursday at 10:00 v1. Whoever posted it can see this.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
  await waitFor(() => expect(screen.getByTestId(tid.notices.you('NTC-0002'))).toHaveTextContent('Acknowledged 13/08'));
  expect(ntc('NTC-0002')?.acks.filter(a => a.personCode === 'CP-1042').map(a => a.textVersion)).toEqual([1]);
  expect(audits().filter(a => a.act === 'Notice acknowledged')).toHaveLength(1);
});

test('after the text changes, I am asked again and the read dialog says why', async () => {
  const admin = caller(await tokenFor('admin')), n = ntc('NTC-0001');
  expect((await admin('PATCH', '/api/v1/notices/NTC-0001', { title: n?.title, body: `${n?.body ?? ''} Day staff check in at noon.`, from: n?.from, until: '',
    mustAck: true, pinned: true, urgent: false }, 1)).status).toBe(200);
  await signInAs('employee');
  await open();
  expect(screen.getByTestId(tid.notices.you('NTC-0001'))).toHaveTextContent('Updated, acknowledge again');
  await userEvent.click(screen.getByTestId(tid.notices.read('NTC-0001')));
  const box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.notices.readChanged)).toHaveTextContent('This notice changed after you acknowledged it');
  await userEvent.click(within(box).getByTestId(tid.notices.readAck));
  expect(await screen.findByText('Acknowledged. Updated lone working policy v3. Whoever posted it can see this.')).toBeInTheDocument();
});

test('the My home card: up to three live notices, how many to acknowledge, and Acknowledge inline', async () => {
  renderPage(<NoticesHomeCard />, '/work/home');
  const card = await screen.findByTestId(tid.noticeHome.card);
  expect(within(card).getByTestId(tid.noticeHome.owed)).toHaveTextContent('1 to acknowledge');
  expect(within(card).getByTestId(tid.noticeHome.row('NTC-0002'))).toHaveTextContent('Willow House · 12/08/2026');
  expect(within(card).getByTestId(tid.noticeHome.state('NTC-0001'))).toHaveTextContent('Acknowledged');
  expect(within(card).queryByText(/Summer social/)).toBeNull();
  expect(within(card).getByTestId(tid.noticeHome.all)).toHaveAttribute('href', '/work/notices');
  expect(within(card).queryByTestId(tid.noticeHome.more)).toBeNull();
  expectTestIdCoverage(document.body);
  await userEvent.click(within(card).getByTestId(tid.noticeHome.ack('NTC-0002')));
  expect(await screen.findByText('Acknowledged. Fire drill on Thursday at 10:00 v1. Whoever posted it can see this.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByTestId(tid.noticeHome.owed)).toBeNull());
});

test('the home card stays away while the notice board is off', async () => {
  (store.coll<{ flags: Record<string, unknown> }>('tenant').tenant ?? { flags: {} }).flags.NOTICES = false;
  renderPage(<><p data-testid="probe-ready">ready</p><NoticesHomeCard /></>, '/work/home');
  await screen.findByTestId('probe-ready');
  await new Promise(r => setTimeout(r, 50));
  expect(screen.queryByTestId(tid.noticeHome.card)).toBeNull();
});
