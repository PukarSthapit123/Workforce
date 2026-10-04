import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { ApprovalsPage } from './ApprovalsPage';

/* Approvals (aappr) on the social seed: every chain at the prototype's
   defaults, Rachel Hussain's queue delegated to Dee Fitzgerald 24-31 August. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });
const chains = () => store.coll<{ version: number; steps: { role: string; when: string; sla: string }[] }>('approvalChains');
const open = async () => { renderPage(<ApprovalsPage />, '/setup/aappr'); await screen.findByTestId(tid.aappr.chainTable); await screen.findByTestId(tid.aappr.delegTable); };

test('the chain per module with the posting step locked, the sign-off settings as pointers and the delegations, with full test id coverage', async () => {
  await open();
  for (const m of ['Timesheet', 'Profile', 'Leave', 'Rota']) expect(screen.getByTestId(tid.aappr.group(m))).toHaveTextContent(m);
  expect(screen.getByTestId(tid.aappr.row('Timesheet', 2))).toHaveTextContent('Business Central');
  expect(screen.getByTestId(tid.aappr.row('Timesheet', 2))).toHaveTextContent('Posts on final approval');
  expect(within(screen.getByTestId(tid.aappr.row('Timesheet', 2))).getByTestId(tid.aappr.fixedTip)).toBeInTheDocument();
  expect(screen.getByTestId(tid.aappr.row('Leave', 1))).toHaveTextContent('Service Manager');
  expect(screen.getByTestId(tid.aappr.row('Leave', 1))).toHaveTextContent('Only when the SLA is breached');
  expect(screen.getByTestId(tid.aappr.method)).toHaveTextContent('Email link (one-click)');
  expect(screen.getByTestId(tid.aappr.methodLink)).toHaveAttribute('href', '/setup/amods?m=TS');
  expect(screen.getByTestId(tid.aappr.cutoff)).toHaveTextContent('Monday 12:00');
  expect(screen.getByTestId(tid.aappr.current)).toHaveTextContent('Open · 10/08/2026 – 16/08/2026');
  expect(screen.getByTestId(tid.aappr.previous)).toHaveTextContent('Closed · 03/08/2026 – 09/08/2026');
  expect(screen.getByTestId(tid.aappr.delegRow('dlg_1'))).toHaveTextContent('Rachel Hussain');
  expect(screen.getByTestId(tid.aappr.delegRow('dlg_1'))).toHaveTextContent('Dee Fitzgerald');
  expect(screen.getByTestId(tid.aappr.delegRow('dlg_1'))).toHaveTextContent('24/08/2026');
  expect(screen.getByTestId(tid.aappr.delegRow('dlg_1'))).toHaveTextContent('Timesheet, Leave');
  expectTestIdCoverage(document.body);
});

test('a chain is edited whole in its dialog and saved once, with one audit row; the posting step stays locked', async () => {
  await open();
  await userEvent.click(screen.getByTestId(tid.aappr.edit('Timesheet')));
  const box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.aappr.layer(2))).toHaveTextContent('Business Central');
  expect(within(box).queryByTestId(tid.aappr.remove(2))).toBeNull();
  fireEvent.change(within(box).getByTestId(tid.aappr.when(1)), { target: { value: 'Every timesheet' } });
  fireEvent.change(within(box).getByTestId(tid.aappr.scope(0)), { target: { value: 'All departments' } });
  await userEvent.click(within(box).getByTestId(tid.aappr.add));
  expect(within(box).getByTestId(tid.aappr.layer(3))).toHaveTextContent('Business Central');
  await userEvent.click(within(box).getByTestId(tid.aappr.remove(2)));
  expectTestIdCoverage(document.body);
  expect(chains().chain_timesheet).toBeUndefined();
  await userEvent.click(within(box).getByTestId(tid.aappr.chainSave));
  expect(await screen.findByText('Timesheet approval chain saved: Line manager, then Payroll, then Business Central.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
  expect(chains().chain_timesheet?.version).toBe(1);
  expect(chains().chain_timesheet?.steps.map(s => s.when)).toEqual(['Every timesheet', 'Every timesheet', 'Posts on final approval']);
  await waitFor(() => expect(screen.getByTestId(tid.aappr.row('Timesheet', 1))).toHaveTextContent('Every timesheet'));
  expect(audits().filter(a => a.act === 'Approval chain changed')).toHaveLength(1);
});

test('an SLA out of bounds is refused on its field and nothing is saved', async () => {
  await open();
  await userEvent.click(screen.getByTestId(tid.aappr.edit('Leave')));
  const box = await screen.findByTestId(tid.modal.root);
  const n = within(box).getByTestId(tid.aappr.slaN(0));
  await userEvent.clear(n);
  await userEvent.type(n, '45');
  await userEvent.click(within(box).getByTestId(tid.aappr.chainSave));
  expect(await within(box).findByText('An SLA is between 1 and 30 days.')).toBeInTheDocument();
  expect(within(box).getByTestId(tid.aappr.slaN(0))).toHaveAttribute('aria-invalid', 'true');
  expect(chains().chain_leave).toBeUndefined();
});

test('a delegation is set up in its dialog; a loop is refused on the field and nothing is added', async () => {
  await open();
  await userEvent.click(screen.getByTestId(tid.aappr.delegAdd));
  let box = await screen.findByTestId(tid.modal.root);
  fireEvent.change(within(box).getByTestId(tid.aappr.who), { target: { value: 'CP-1002' } });
  fireEvent.change(within(box).getByTestId(tid.aappr.to), { target: { value: 'CP-1001' } });
  fireEvent.change(within(box).getByTestId(tid.aappr.from), { target: { value: '2026-08-30' } });
  fireEvent.change(within(box).getByTestId(tid.aappr.until), { target: { value: '2026-09-02' } });
  expectTestIdCoverage(document.body);
  await userEvent.click(within(box).getByTestId(tid.aappr.delegSave));
  const loop = 'Rachel Hussain already delegates Timesheet to Dee Fitzgerald over those dates. The approvals would go round in a circle.';
  await waitFor(() => expect(within(box).getByTestId(tid.field.root(tid.aappr.to))).toHaveTextContent(loop));
  expect(within(box).getByTestId(tid.aappr.to)).toHaveAttribute('aria-invalid', 'true');
  expect(Object.keys(store.coll('delegations'))).toEqual(['dlg_1']);
  /* later dates are fine */
  fireEvent.change(within(box).getByTestId(tid.aappr.from), { target: { value: '2026-09-01' } });
  fireEvent.change(within(box).getByTestId(tid.aappr.until), { target: { value: '2026-09-07' } });
  await userEvent.click(within(box).getByTestId(tid.aappr.delegSave));
  expect(await screen.findByText('Delegation added: Dee Fitzgerald to Rachel Hussain, 01/09/2026 to 07/09/2026, Timesheet, Leave. Every decision records who acted.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
  expect(await screen.findByTestId(tid.aappr.delegRow('dlg_2'))).toHaveTextContent('01/09/2026');
  expect(audits().filter(a => a.act === 'Delegation added')).toHaveLength(1);
  /* and removed again */
  await userEvent.click(screen.getByTestId(tid.aappr.delegRemove('dlg_2')));
  await waitFor(() => expect(screen.queryByTestId(tid.aappr.delegRow('dlg_2'))).toBeNull());
  box = screen.getByTestId(tid.aappr.delegTable);
  expect(within(box).getByTestId(tid.aappr.delegRow('dlg_1'))).toBeInTheDocument();
});
