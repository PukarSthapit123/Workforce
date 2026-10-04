import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { ModulesPage } from './ModulesPage';

/* The social seed runs every module; LATE_FINISH, VEHICLE and GPS are off.
   The qnipay seed has Rota off. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });
const tenant = () => {
  const t = store.coll<{ version: number; modules: Record<string, boolean>; flags: Record<string, boolean> }>('tenant').tenant;
  if (!t) throw new Error('no tenant');
  return t;
};
const tenantAudits = () => audits().filter(a => a.entity === 'tenant');
const open = async (m?: string) => {
  renderPage(<ModulesPage />, m ? `/setup/amods?m=${m}` : '/setup/amods');
  return screen.findByTestId(m ? tid.amods.moduleCard : tid.amods.card('CORE'));
};
const weekLayout = () => store.coll<{ weekLayout: string }>('timesheetConfig').timesheetConfig?.weekLayout;

test('the index is a card per module with its state and counts, a caution, a search, and full test id coverage', async () => {
  await open();
  for (const c of ['CORE', 'TS', 'R', 'L', 'ON']) expect(screen.getByTestId(tid.amods.card(c))).toHaveAttribute('href', `/setup/amods?m=${c}`);
  expect(screen.getByTestId(tid.amods.cardState('CORE'))).toHaveTextContent('Always on');
  expect(screen.getByTestId(tid.amods.cardCounts('TS'))).toHaveTextContent('2 of 2 capture methods · 8 of 13 features · Timesheet setup');
  expect(screen.getByTestId(tid.amods.cardCounts('R'))).toHaveTextContent('8 of 8 features · Rota setup');
  expect(screen.getByTestId(tid.head.caution('amods'))).toHaveTextContent('There is no draft stage in this build.');
  expect(screen.queryByTestId(tid.amods.flag('AUTO_OT'))).toBeNull();
  expectTestIdCoverage(document.body);
  await userEvent.type(screen.getByTestId(tid.amods.search), 'overtime');
  expect(screen.getAllByRole('link').map(a => a.getAttribute('data-testid'))).toEqual([tid.amods.card('TS')]);
  await userEvent.clear(screen.getByTestId(tid.amods.search));
  await userEvent.type(screen.getByTestId(tid.amods.search), 'zzzznothing');
  expect(screen.getByTestId(tid.amods.empty)).toHaveTextContent('Nothing matches that search');
});

test('an off module is marked on its card, with its features counted but not as on', async () => {
  resetTo('qnipay'); await signInAs('admin');
  await open();
  expect(screen.getByTestId(tid.amods.cardState('R'))).toHaveTextContent('Off');
  expect(screen.getByTestId(tid.amods.cardCounts('R'))).toHaveTextContent('8 features · Rota setup');
});

test('a feature switch writes once, with one audit row, and the toast is the server’s message', async () => {
  await open('TS');
  expect(screen.getByTestId(tid.amods.flag('LATE_FINISH'))).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(screen.getByTestId(tid.amods.flag('LATE_FINISH')));
  expect(await screen.findByText('Late finish detection on. It is live for everyone now.')).toBeInTheDocument();
  expect(tenant().flags.LATE_FINISH).toBe(true);
  expect(tenantAudits().map(a => a.act)).toEqual(['Feature changed']);
  await waitFor(() => expect(screen.getByTestId(tid.amods.flag('LATE_FINISH'))).toHaveAttribute('aria-checked', 'true'));
  expectTestIdCoverage(document.body);
});

test('turning a module off asks first with its impact, and the toast says what was kept', async () => {
  await open('L');
  await userEvent.click(screen.getByTestId(tid.amods.mod('L')));
  const box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.modal.title)).toHaveTextContent('Turn off Leave & absence?');
  expect(box).toHaveTextContent('Rota stops treating leave as unavailability. This applies to everyone immediately.');
  expect(tenant().modules.L).toBe(true);
  await userEvent.click(within(box).getByTestId(tid.modal.confirm));
  expect(await screen.findByText('Leave & absence turned off. It is live for everyone now.')).toBeInTheDocument();
  expect(screen.getByTestId(tid.toast.next)).toHaveTextContent(/^Kept as they were: \d+ leave requests/);
  expect(tenant().modules.L).toBe(false);
  expect(tenantAudits().map(a => a.act)).toEqual(['Module turned off']);
  expect(await screen.findByTestId(tid.amods.offBanner)).toHaveTextContent('Leave & absence is off');
  expect(screen.getByTestId(tid.amods.offPill)).toHaveTextContent('Module off');
  expect(screen.getByTestId(tid.amods.flag('LV_ENT'))).toBeDisabled();
});

test('Rota off sets its scheduled shifts aside, and Rota on puts them back, each saying how many', async () => {
  await open('R');
  await userEvent.click(screen.getByTestId(tid.amods.mod('R')));
  await userEvent.click(within(await screen.findByTestId(tid.modal.root)).getByTestId(tid.modal.confirm));
  const off = await screen.findByText(/^Rota turned off\. It is live for everyone now\. (\d+) scheduled shifts cleared from the calendar and kept to restore\.$/);
  const cleared = /(\d+) scheduled/.exec(off.textContent ?? '')?.[1];
  expect(Number(cleared)).toBeGreaterThan(0);
  await waitFor(() => expect(screen.getByTestId(tid.amods.mod('R'))).toHaveAttribute('aria-checked', 'false'));
  await userEvent.click(screen.getByTestId(tid.amods.mod('R')));
  expect(await screen.findByText(`Rota turned on. It is live for everyone now. ${cleared} scheduled shifts restored to the calendar.`)).toBeInTheDocument();
  expect(tenantAudits().map(a => a.act)).toEqual(['Module turned off', 'Module turned on']);
});

test('Workforce core has no off control', async () => {
  await open('CORE');
  expect(screen.getByTestId(tid.amods.mod('CORE'))).toBeDisabled();
  expect(screen.getByTestId(tid.amods.mod('CORE'))).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByTestId(tid.amods.enableNote)).toHaveTextContent('Workforce core cannot be switched off. Everything else depends on it.');
  expect(screen.getByTestId(tid.amods.flag('NOTICES'))).toBeEnabled();
});

test('a switch against a tenant that changed underneath is refused, nothing is written, and the next try works', async () => {
  await open('TS');
  tenant().version += 1;
  await userEvent.click(screen.getByTestId(tid.amods.flag('VEHICLE')));
  expect(await screen.findByTestId(tid.toast.error)).toBeInTheDocument();
  expect(tenant().flags.VEHICLE).toBe(false);
  expect(tenantAudits()).toEqual([]);
  await waitFor(() => expect(screen.getByTestId(tid.amods.flag('VEHICLE'))).toBeEnabled());
  await userEvent.click(screen.getByTestId(tid.amods.flag('VEHICLE')));
  expect(await screen.findByText('Vehicle & movement fields on. It is live for everyone now.')).toBeInTheDocument();
  expect(tenantAudits()).toHaveLength(1);
});

test('the weekly grid’s layout and the break limit are set on their feature rows', async () => {
  await open('TS');
  const layout = screen.getByTestId(tid.amods.weekLayout);
  expect([...layout.querySelectorAll('option')].map(o => o.textContent)).toEqual([
    'Classic · allocation in the first column', 'Grid · allocation as a section header', 'List · one row per day']);
  fireEvent.change(layout, { target: { value: 'days' } });
  expect(await screen.findByText('Weekly view: list. One row per day, allocation chosen before the times. It is live for everyone now.')).toBeInTheDocument();
  expect(weekLayout()).toBe('days');
  await waitFor(() => expect(screen.getByTestId(tid.amods.weekLayout)).toHaveValue('days'));
  expect(screen.getByTestId(tid.amods.stepValue('breaksMax'))).toHaveTextContent('5');
  expect(screen.getByTestId(tid.amods.stepUp('breaksMax'))).toBeDisabled();
  await userEvent.click(screen.getByTestId(tid.amods.stepDown('breaksMax')));
  expect(await screen.findByText('Breaks per entry: 4. It is live for everyone now.')).toBeInTheDocument();
  expect(tenantAudits().map(a => a.act)).toEqual(['Feature changed', 'Feature changed']);
});
