import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store, STORE_BACKUP_KEY } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { CalendarPage } from './CalendarPage';

/* The social seed: financial year 2026/27, three bank holidays, Rota and
   Leave on, a 12-month rota horizon. */
withFakeServer();
beforeEach(async () => { resetTo('social'); localStorage.removeItem(STORE_BACKUP_KEY); await signInAs('admin'); });
const horizon = () => store.coll<{ horizon: number }>('rotaConfig').rotaConfig?.horizon;
const tenantName = () => store.coll<{ name: string }>('tenant').tenant?.name;
const open = async () => {
  renderPage(<CalendarPage />);
  await screen.findByTestId(tid.acal.finYear);
  await screen.findByTestId(tid.acal.build);
};

test('the calendar shows the year, the week start, the bank holidays with each module’s treatment, and the saved data, with full test id coverage', async () => {
  await open();
  expect(screen.getByTestId(tid.acal.finYear)).toHaveTextContent('01/04/2026 – 31/03/2027 (2026/27)');
  expect(screen.getByTestId(tid.acal.weekStart)).toHaveTextContent('Monday');
  expect(screen.getByTestId(tid.acal.horizon)).toHaveValue('12');
  expect(screen.getByTestId(tid.acal.holiday('2026-12-25'))).toHaveTextContent('25/12/2026');
  expect(screen.getByTestId(tid.acal.holiday('2026-12-25'))).toHaveTextContent('Christmas Day');
  await waitFor(() => expect(screen.getByTestId(tid.acal.treatment('2026-12-25'))).toHaveTextContent(
    'Leave: On top of entitlement · Rota: enhanced rate flagged · Timesheet: date-derived premium'));
  expect(screen.getByTestId(tid.acal.saving)).toHaveTextContent('Saving');
  expect(screen.queryByTestId(tid.acal.restore)).toBeNull();
  expectTestIdCoverage(document.body);
});

test('the rota horizon saves when chosen, with one audit row', async () => {
  await open();
  fireEvent.change(screen.getByTestId(tid.acal.horizon), { target: { value: '6' } });
  expect(await screen.findByText('Rota horizon: 6 months.')).toBeInTheDocument();
  expect(horizon()).toBe(6);
  expect(audits().filter(a => a.entity === 'tenant')).toHaveLength(1);
  await waitFor(() => expect(screen.getByTestId(tid.acal.horizon)).toHaveValue('6'));
});

test('export downloads everything held as one JSON file named after the organisation', async () => {
  await open();
  const blobs: Blob[] = [], names: string[] = [];
  const was = URL.createObjectURL, wasRevoke = URL.revokeObjectURL;
  URL.createObjectURL = (b: Blob | MediaSource) => { if (b instanceof Blob) blobs.push(b); return 'blob:state'; };
  URL.revokeObjectURL = () => {};
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
  try {
    await userEvent.click(screen.getByTestId(tid.acal.export));
    expect(await screen.findByText('Keep the file to restore this demonstration elsewhere.')).toBeInTheDocument();
    expect(names).toEqual(['qnipay-state-brightpath-support-services.json']);
    const file = JSON.parse((await blobs[0]?.text()) ?? '{}') as { kind?: string; data?: Record<string, unknown> };
    expect(file.kind).toBe('qnipay.state');
    expect(file.data?.tenant).toBeDefined();
    expect(file.data?.sessions).toBeUndefined();
  } finally {
    click.mockRestore();
    URL.createObjectURL = was; URL.revokeObjectURL = wasRevoke;
  }
});

test('reset asks first, then returns to the seed and offers to bring the earlier session back', async () => {
  const t = store.coll<{ name: string }>('tenant').tenant;
  if (t) t.name = 'Changed in this session';
  await open();
  await userEvent.click(screen.getByTestId(tid.acal.reset));
  const box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.modal.title)).toHaveTextContent('Reset everything?');
  await userEvent.click(within(box).getByTestId(tid.modal.cancel));
  expect(tenantName()).toBe('Changed in this session');

  await userEvent.click(screen.getByTestId(tid.acal.reset));
  await userEvent.click(within(await screen.findByTestId(tid.modal.root)).getByTestId(tid.modal.confirm));
  expect(await screen.findByText('The app is back to the data it ships with. The earlier session was set aside.')).toBeInTheDocument();
  expect(tenantName()).toBe('Brightpath Support Services');

  await userEvent.click(await screen.findByTestId(tid.acal.restore));
  await userEvent.click(within(await screen.findByTestId(tid.modal.root)).getByTestId(tid.modal.confirm));
  expect(await screen.findByText('Earlier session brought back')).toBeInTheDocument();
  expect(tenantName()).toBe('Changed in this session');
  await waitFor(() => expect(screen.queryByTestId(tid.acal.restore)).toBeNull());
});
