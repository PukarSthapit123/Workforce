import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { caller, resetTo, signInAs, tokenFor } from '@/test/api-helpers';
import { HomePage } from './HomePage';

/* My home for Amara Okafor (CP-1042, Willow House) on the social seed at the
   frozen clock, Thursday 13 August 2026 15:30: the weeks of 3 and 10 August
   are published (four earlies and four nights), drafts on 3 to 7 August, a
   day awaiting approval on the 12th, approved leave on the 17th and 18th, and
   the summer bank holiday on the 31st. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('employee'); });
const open = async () => { renderPage(<HomePage />, '/work/home'); return screen.findByTestId(tid.home.grid); };
const cell = (date: string) => screen.getByTestId(tid.home.day(date));
const tenantVersion = () => (store.coll<{ version: number }>('tenant').tenant?.version ?? 0);
const month = () => screen.getByTestId(tid.home.month).textContent;

test('social: the greeting, the who-line, the month painted from the rota, leave and the timesheet, the figures, and full test id coverage', async () => {
  await open();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good afternoon, Amara');
  expect(screen.getByText('My work · Home · Support Worker · Willow House')).toBeInTheDocument();
  expect(month()).toBe('August 2026');
  expect(within(screen.getByTestId(tid.home.grid)).getAllByRole('button')).toHaveLength(31);
  expect(cell('2026-08-03')).toHaveAttribute('data-paint', 'E');
  expect(cell('2026-08-03')).toHaveAttribute('data-glyph', 'draft');
  expect(cell('2026-08-05')).toHaveAttribute('data-paint', 'N');
  expect(cell('2026-08-10')).toHaveAttribute('aria-label', expect.stringMatching(/^10 Aug: Early .*, Nothing recorded$/));
  expect(cell('2026-08-12')).toHaveAttribute('data-glyph', 'pend');
  expect(cell('2026-08-13').className).toMatch(/border-2/);
  expect(cell('2026-08-17')).toHaveAttribute('data-paint', 'V');
  expect(cell('2026-08-17')).toHaveTextContent('17☀Leave');
  expect(cell('2026-08-20').className).toMatch(/opacity-/);
  expect(cell('2026-08-31')).toHaveTextContent('Bank holiday');
  expect(cell('2026-08-31')).toHaveAttribute('aria-label', '31 Aug: Rest day, Summer bank holiday');
  expect(screen.getByTestId(tid.home.summary).textContent).toMatch(/^8 shifts · \d+\.\dh recorded · 2 days leave$/);
  /* the notices card reads the tenant too, so once it shows the tenant's modules are in */
  await screen.findByTestId(tid.noticeHome.card);
  expect(screen.getByTestId(tid.home.next)).toHaveTextContent('Thu 13 Aug');
  expect(screen.getByTestId(tid.home.missing)).toHaveTextContent('2 days with no hours recorded: Mon, Tue');
  await waitFor(() => expect(screen.getByTestId(tid.home.balance).textContent).toMatch(/^\d+(\.\d+)?d$/));
  expectTestIdCoverage(document.body);
});

test('qnipay: the home boots with no rota, so no shifts and no next shift, but leave and the recorded days still show, with full test id coverage', async () => {
  resetTo('qnipay');
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bigyan.poudel@dogmagroup.co.uk', password: 'Qnipay@123' }) });
  setToken(((await r.json()) as { token: string }).token);
  await open();
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Good afternoon, Bigyan');
  expect(document.querySelectorAll('[data-paint="E"], [data-paint="L"], [data-paint="N"]')).toHaveLength(0);
  expect(cell('2026-08-17')).toHaveAttribute('data-paint', 'V');
  expect(cell('2026-08-12')).toHaveAttribute('data-glyph', 'pend');
  expect(screen.queryByTestId(tid.home.next)).toBeNull();
  expect(screen.getByTestId(tid.home.summary)).not.toHaveTextContent(/shift/);
  expectTestIdCoverage(document.body);
});

test('the key counts what the month holds, omits what it does not, uses the calendar’s own state colours, and says so when the month is empty', async () => {
  await open();
  const key = screen.getByTestId(tid.home.key);
  expect(within(key).getByTestId(tid.home.keyItem('tone', 'E'))).toHaveTextContent('Early 4');
  expect(within(key).getByTestId(tid.home.keyItem('tone', 'N'))).toHaveTextContent('Night 4');
  expect(within(key).queryByTestId(tid.home.keyItem('tone', 'L'))).toBeNull();
  expect(within(key).getByTestId(tid.home.keyItem('leave', 0))).toHaveTextContent('Annual leave 2');
  expect(within(key).getByTestId(tid.home.keyItem('state', 'pend'))).toHaveTextContent('◷ Submitted 1');
  expect(within(key).getByTestId(tid.home.keyItem('state', 'none'))).toHaveTextContent('⚠ Nothing recorded');
  expect(key).not.toHaveTextContent(/Sent back|Approved|Time off in lieu/);
  /* the key's glyph and the day's glyph are painted by the same class */
  const keyInk = within(key).getByTestId(tid.home.keyItem('state', 'pend')).querySelector('b')?.className ?? '';
  const dayInk = cell('2026-08-12').lastElementChild?.className ?? '';
  expect(keyInk).toMatch(/text-info/);
  expect(dayInk).toMatch(/text-info/);
  /* one class attribute per cell */
  for (const c of within(screen.getByTestId(tid.home.grid)).getAllByRole('button')) expect(c.outerHTML.split('>')[0]?.match(/ class="/g)).toHaveLength(1);
  for (let i = 0; i < 12; i++) {
    const was = month();
    await userEvent.click(screen.getByTestId(tid.home.nextMonth));
    await waitFor(() => expect(month()).not.toBe(was));
  }
  await waitFor(() => expect(screen.getByTestId(tid.home.keyEmpty)).toHaveTextContent('Nothing recorded this month yet'));
});

test('the month moves within its bounds: the month before this one to the rota horizon, and This month comes back', async () => {
  await open();
  expect(screen.getByTestId(tid.home.thisMonth)).toBeDisabled();
  await userEvent.click(screen.getByTestId(tid.home.prev));
  await waitFor(() => expect(month()).toBe('July 2026'));
  expect(screen.getByTestId(tid.home.prev)).toBeDisabled();
  await userEvent.click(screen.getByTestId(tid.home.thisMonth));
  await waitFor(() => expect(month()).toBe('August 2026'));
  for (let i = 0; i < 12; i++) {
    const was = month();
    await userEvent.click(screen.getByTestId(tid.home.nextMonth));
    await waitFor(() => expect(month()).not.toBe(was));
  }
  expect(month()).toBe('August 2027');
  expect(screen.getByTestId(tid.home.nextMonth)).toBeDisabled();
  expect(screen.getByTestId(tid.home.prev)).toBeEnabled();
});

test('the day dialog says what is on the day and links to the page that owns it', async () => {
  await open();
  await userEvent.click(cell('2026-08-10'));
  let box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.modal.title)).toHaveTextContent('Mon 10 Aug 2026');
  expect(within(box).getByTestId(tid.home.dayShift)).toHaveTextContent(/·\s\d+(\.\d+)?h$/);
  expect(within(box).getByText('Early')).toBeInTheDocument();
  expect(within(box).getByTestId(tid.home.dayLocation)).toHaveTextContent('Willow House');
  expect(within(box).getByTestId(tid.home.daySource)).toHaveTextContent('From the published rota');
  expect(within(box).getByTestId(tid.home.dayHours)).toHaveTextContent('Nothing yet');
  expect(within(box).getByTestId(tid.home.dayShifts)).toHaveAttribute('href', '/work/shifts');
  expect(within(box).getByTestId(tid.home.recordHours)).toHaveAttribute('href', '/work/ts?date=2026-08-10');
  expect(within(box).getByTestId(tid.home.recordHours)).toHaveTextContent('Record hours');
  expect(within(box).getByTestId(tid.home.bookLeave)).toBeInTheDocument();
  expectTestIdCoverage(document.body);
  await userEvent.click(within(box).getByTestId(tid.home.dayClose));
  await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());

  await userEvent.click(cell('2026-08-17'));
  box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.home.dayState)).toHaveTextContent('Leave');
  expect(within(box).getByTestId(tid.home.daySource)).toHaveTextContent('From your approved leave');
  expect(within(box).getByTestId(tid.home.dayLeave)).toHaveTextContent('Approved');
  expect(within(box).getByTestId(tid.home.dayLeaveDates)).toHaveTextContent('17/08/2026 – 18/08/2026');
  expect(within(box).getByTestId(tid.home.dayLeaveLink)).toHaveAttribute('href', '/work/leave');
  expect(within(box).queryByTestId(tid.home.bookLeave)).toBeNull();
  /* a day still to come has nothing to record yet */
  expect(within(box).queryByTestId(tid.home.recordHours)).toBeNull();
  await userEvent.click(within(box).getByTestId(tid.home.dayClose));
  await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());

  await userEvent.click(cell('2026-08-31'));
  box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.home.dayShift)).toHaveTextContent('—');
  expect(within(box).getByText('Rest day')).toBeInTheDocument();
  expect(within(box).getByTestId(tid.home.dayBank)).toHaveTextContent('Summer bank holiday');
});

test('Book time off opens My leave’s request with the day filled in, and sending it books that day', async () => {
  await open();
  await userEvent.click(cell('2026-08-24'));
  const day = await screen.findByTestId(tid.modal.root);
  await userEvent.click(within(day).getByTestId(tid.home.bookLeave));
  await waitFor(() => expect(screen.getByTestId(tid.modal.title)).toHaveTextContent('Request leave'));
  expect(screen.getByTestId(tid.leave.from)).toHaveValue('2026-08-24');
  expect(screen.getByTestId(tid.leave.to)).toHaveValue('2026-08-24');
  fireEvent.change(screen.getByTestId(tid.leave.note), { target: { value: 'From the month' } });
  await userEvent.click(screen.getByTestId(tid.leave.send));
  await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
  const made = Object.values(store.coll<{ personCode: string; from: string; to: string; state: string }>('leaveRequests'))
    .filter(r => r.personCode === 'CP-1042' && r.from === '2026-08-24');
  expect(made).toEqual([expect.objectContaining({ to: '2026-08-24', state: 'pending' })]);
});

test('with Rota off the month carries no shifts, but leave stays, because it comes from Leave', async () => {
  const admin = caller(await tokenFor('admin'));
  expect((await admin('PATCH', '/api/v1/tenant/modules/R', { on: false }, tenantVersion())).status).toBe(200);
  await open();
  expect(document.querySelectorAll('[data-paint="E"], [data-paint="L"], [data-paint="N"]')).toHaveLength(0);
  expect(screen.getByTestId(tid.home.summary)).toHaveTextContent('2 days leave');
  expect(screen.getByTestId(tid.home.summary)).not.toHaveTextContent(/shift/);
  expect(cell('2026-08-17')).toHaveAttribute('data-paint', 'V');
  expect(screen.queryByTestId(tid.home.keyItem('tone', 'E'))).toBeNull();
  await screen.findByTestId(tid.noticeHome.card);
  expect(screen.queryByTestId(tid.home.next)).toBeNull();
});
