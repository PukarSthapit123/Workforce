import { screen, waitFor, within } from '@testing-library/react';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { caller, resetTo, signInAs, tokenFor } from '@/test/api-helpers';
import { TeamHomePage } from './TeamHomePage';
import { DocumentsPage } from './DocumentsPage';

/* The social seed at the frozen clock: Rachel Hussain manages Willow House;
   Amara Okafor (CP-1042) is the first employee and holds the seven documents. */
withFakeServer();
beforeEach(() => resetTo('social'));
const shown = (n: number) => (n === 0 ? 'Nothing waiting' : `${n} waiting`);

test('Team Home: one card per My Team page, each with the count its own page reads, Open where a page has none, and full test id coverage', async () => {
  const token = await signInAs('manager'), mgr = caller(token);
  const body = async <T,>(path: string) => (await mgr('GET', path)).body as T;
  const queue = await body<{ counts: { pend: number; resub: number } }>('/api/v1/approvals/timesheets?status=pend');
  const leave = await body<{ counts: { pending: number } }>('/api/v1/leave/team/requests');
  const sick = await body<{ counts: { triggered: number } }>('/api/v1/leave/sickness');
  const cover = await body<{ counts: { all: number } }>('/api/v1/rota/cover?status=all');
  const notices = await body<{ counts: { current: number } }>('/api/v1/notices');
  renderPage(<TeamHomePage />, '/team/thome');
  const grid = await screen.findByTestId(tid.thome.grid);
  expect(screen.getByText('My Team · Team Home · Willow House')).toBeInTheDocument();
  expect(within(grid).queryByTestId(tid.thome.card('thome'))).toBeNull();
  expect(within(grid).getByTestId(tid.thome.card('tteam'))).toHaveAttribute('href', '/team/tteam');
  await waitFor(() => expect(screen.getByTestId(tid.thome.count('tteam'))).toHaveTextContent(shown(queue.counts.pend + queue.counts.resub)));
  await waitFor(() => expect(screen.getByTestId(tid.thome.count('tleave'))).toHaveTextContent(shown(leave.counts.pending)));
  await waitFor(() => expect(screen.getByTestId(tid.thome.count('tsick'))).toHaveTextContent(shown(sick.counts.triggered)));
  await waitFor(() => expect(screen.getByTestId(tid.thome.count('tcover'))).toHaveTextContent(shown(cover.counts.all)));
  await waitFor(() => expect(screen.getByTestId(tid.thome.count('tnotices'))).toHaveTextContent(notices.counts.current ? `${notices.counts.current} live` : 'Nothing live'));
  expect(screen.getByTestId(tid.thome.count('tpeople'))).toHaveTextContent('Open');
  expect(screen.getByTestId(tid.thome.count('texc'))).toHaveTextContent('Not built yet');
  /* something is waiting somewhere in the seed, and a waiting count is in the warning ink */
  const waitingCounts = ['tteam', 'tleave', 'tsick', 'tcover'].map(v => screen.getByTestId(tid.thome.count(v))).filter(e => /\d+ waiting/.test(e.textContent ?? ''));
  expect(waitingCounts.length).toBeGreaterThan(0);
  for (const e of waitingCounts) expect(e.className).toMatch(/text-warn/);
  expectTestIdCoverage(document.body);
});

test('Team Home loses a page’s card with its module: Leave off takes Requests and Sickness', async () => {
  const admin = caller(await tokenFor('admin'));
  const v = store.coll<{ version: number }>('tenant').tenant?.version ?? 0;
  expect((await admin('PATCH', '/api/v1/tenant/modules/L', { on: false }, v)).status).toBe(200);
  await signInAs('manager');
  renderPage(<TeamHomePage />, '/team/thome');
  const grid = await screen.findByTestId(tid.thome.grid);
  expect(within(grid).getByTestId(tid.thome.card('tteam'))).toBeInTheDocument();
  expect(within(grid).queryByTestId(tid.thome.card('tleave'))).toBeNull();
  expect(within(grid).queryByTestId(tid.thome.card('tsick'))).toBeNull();
});

test('Documents: my seven, no Open action, the payroll ones and salary history not yet connected, and full test id coverage', async () => {
  await signInAs('employee');
  renderPage(<DocumentsPage />, '/work/docs');
  const card = await screen.findByTestId(tid.docs.card);
  expect(screen.getByText('My work · Documents · Amara Okafor')).toBeInTheDocument();
  expect(within(card).getAllByTestId(/^docs-row-/)).toHaveLength(7);
  expect(within(card).getByTestId(tid.docs.row('doc_CP-1042_3'))).toHaveTextContent('DBS certificate');
  expect(within(card).getByTestId(tid.docs.row('doc_CP-1042_3'))).toHaveTextContent('Compliance · 31/03/2024 · HRIS');
  expect(screen.getByTestId(tid.docs.openNote)).toHaveTextContent('Opening documents is not built yet.');
  expect(screen.queryByRole('button', { name: /^Open/ })).toBeNull();
  expect(screen.queryByRole('link', { name: /^Open/ })).toBeNull();
  const pay = screen.getByTestId(tid.docs.payroll);
  expect(within(pay).getAllByTestId(/^docs-payroll-row-/).map(r => r.textContent)).toEqual([
    expect.stringMatching(/^Payslips.*Not yet connected$/), expect.stringMatching(/^P60 · 2025\/26.*Not yet connected$/), expect.stringMatching(/^P45.*Not yet connected$/)]);
  expect(within(pay).getByTestId(tid.docs.salary)).toHaveTextContent(/^Salary & pay history.*Not yet connected$/);
  expectTestIdCoverage(document.body);
});

test('Documents switched off: the page says so rather than listing anything', async () => {
  (store.coll<{ flags: Record<string, unknown> }>('tenant').tenant ?? { flags: {} }).flags.DOCS = false;
  await signInAs('employee');
  renderPage(<DocumentsPage />, '/work/docs');
  expect(await screen.findByTestId(tid.docs.error)).toHaveTextContent('Documents is switched off for this tenant.');
  expect(screen.queryByTestId(tid.docs.card)).toBeNull();
});
