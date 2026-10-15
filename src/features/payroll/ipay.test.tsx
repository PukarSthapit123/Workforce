import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { store } from '@/mocks/store';
import { exceptionsEverywhere } from '@/mocks/exceptions';
import { PAYROLL_CSV_HEADER } from '@/domain/payroll';
import { PayrollReadinessPage } from './PayrollReadinessPage';

/* social at the frozen clock (Thursday 13/08/2026 15:30): Dee Fitzgerald,
   the administrator, holds integration and pay_appr (so Approvals is on her
   nav) but no team_hours (so Exceptions is not). The fortnightly period is
   03/08 to 16/08; it is NOT READY. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });

const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const open = async () => {
  renderPage(<PayrollReadinessPage />, '/setup/ipay');
  return screen.findByTestId(tid.ipay.banner);
};
/* every blocker the seed has put right, as in the handler tests; drafts and posted records remain as warnings */
function clearBlockers() {
  for (const d of Object.values(store.coll<{ state: string }>('timesheetDays'))) if (d.state !== 'draft') d.state = 'ok';
  for (const a of Object.values(store.coll<{ state: string }>('integrationAttempts'))) if (a.state === 'failed') a.state = 'posted';
  for (const p of Object.values(store.coll<{ code: string; resource: string }>('employees'))) p.resource = `R-${p.code}`;
  const handling = store.coll('exceptionHandling');
  for (const x of exceptionsEverywhere()) handling[x.id] = { id: x.id, version: 1, updatedAt: store.now(), key: x.key, kind: x.kind, subject: x.subject,
    firstRecorded: store.now(), state: 'resolved', owner: null, resolution: 'Cleared for the test', history: [] };
  const t = store.coll<{ modules: Record<string, boolean> }>('tenant').tenant;
  if (t) t.modules.R = false;
}

describe('Payroll readiness', () => {
  test('NOT READY: the banner, P\'s figures, the period beside the previous period\'s lock and the cut-off, the blockers with Open where reachable, export held back', async () => {
    const banner = await open();
    expect(banner).toHaveTextContent('NOT READY · 03/08/2026 – 16/08/2026');
    expect(banner).toHaveTextContent(/\d+ items must be cleared before this period can be handed over\./);
    expect(screen.getByTestId(tid.ipay.figure('awaiting'))).toHaveTextContent('4');
    expect(screen.getByTestId(tid.ipay.figure('failed'))).toHaveTextContent('1');
    expect(screen.getByTestId(tid.ipay.figure('missing')).parentElement).toHaveTextContent('Missing timesheets');
    expect(screen.getByTestId(tid.ipay.current)).toHaveTextContent('03/08/2026 – 16/08/2026');
    expect(screen.getByTestId(tid.ipay.currentState)).toHaveTextContent('Open');
    expect(screen.getByTestId(tid.ipay.closes)).toHaveTextContent('closes 17/08/2026 12:00');
    expect(screen.getByTestId(tid.ipay.frequency)).toHaveTextContent('Fortnightly');
    expect(screen.getByTestId(tid.ipay.frequencyLink)).toHaveAttribute('href', '/setup/aorg');
    expect(screen.getByTestId(tid.ipay.previous)).toHaveTextContent('20/07/2026 – 02/08/2026');
    expect(screen.getByTestId(tid.ipay.previousState)).toHaveTextContent('Closed at Monday 12:00');
    expect(screen.getByTestId(tid.ipay.cutoff)).toHaveTextContent('Monday 12:00');
    expect(screen.getByTestId(tid.ipay.enforced)).toHaveTextContent('enforced');

    const blockers = screen.getByTestId(tid.ipay.blockers);
    expect(blockers).toHaveTextContent('Blocking the handover');
    expect(screen.getByTestId(tid.ipay.item('awaiting'))).toHaveTextContent('Pending approvals3 timesheet days awaiting a manager decision, resubmissions included');
    expect(screen.getByTestId(tid.ipay.item('resource'))).toHaveTextContent('6 colleagues with hours in this period have no Business Central resource number');
    /* Open once the reader's nav is read */
    expect(await screen.findByTestId(tid.ipay.open('awaiting'))).toHaveAttribute('href', '/team/tteam');
    expect(screen.getByTestId(tid.ipay.open('resource'))).toHaveAttribute('href', '/setup/aemployees');
    /* the posting failure opens Business Central, now built */
    expect(screen.getByTestId(tid.ipay.open('failed'))).toHaveAttribute('href', '/setup/ibc');
    /* Exceptions is the manager's, not on this administrator's nav, so it has no Open */
    expect(within(screen.getByTestId(tid.ipay.item('critical'))).queryByRole('link')).toBeNull();
    expect(screen.getByTestId(tid.ipay.warnings)).toHaveTextContent('Worth reviewing first');

    expect(screen.getByTestId(tid.ipay.export)).toBeDisabled();
    expect(screen.getByTestId(tid.ipay.export)).toHaveAttribute('title', 'Clear the blockers first');
    expect(screen.getByTestId(tid.ipay.reconcile)).toBeDisabled();
    expect(screen.getByTestId(tid.ipay.reconcile)).toHaveAttribute('title', 'Export first');
    expect(screen.queryByTestId(tid.ipay.reopen)).toBeNull();
    expect(screen.getByTestId(tid.guide.open('ipay'))).toBeInTheDocument();
    expectTestIdCoverage(document.body);
  });

  test('export saves the real file and moves to EXPORTED; reconcile; reopen asks for a reason; each audited', async () => {
    clearBlockers();
    const banner = await open();
    expect(banner).toHaveTextContent('READY WITH WARNINGS');
    const blobs: Blob[] = [], names: string[] = [];
    const was = URL.createObjectURL, wasRevoke = URL.revokeObjectURL;
    URL.createObjectURL = (b: Blob | MediaSource) => { if (b instanceof Blob) blobs.push(b); return 'blob:payroll'; };
    URL.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    try {
      await userEvent.click(screen.getByTestId(tid.ipay.export));
      await waitFor(() => expect(toasts()).toMatch(/Exported · \d+ approved records? · qnipay-payroll-03-08-2026\.csv/));
      expect(names).toEqual(['qnipay-payroll-03-08-2026.csv']);
      const lines = ((await blobs[0]?.text()) ?? '').split('\r\n');
      expect(lines[0]).toBe(PAYROLL_CSV_HEADER.join(','));
      const count = Number(/Exported · (\d+)/.exec(toasts())?.[1]);
      expect(lines).toHaveLength(count + 1);
    } finally {
      click.mockRestore();
      URL.createObjectURL = was; URL.revokeObjectURL = wasRevoke;
    }
    await waitFor(() => expect(screen.getByTestId(tid.ipay.banner)).toHaveTextContent('EXPORTED'));
    expect(screen.getByTestId(tid.ipay.banner)).toHaveTextContent(/Exported 13\/08\/2026 15:30 by Dee Fitzgerald\. Awaiting reconciliation/);
    expect(screen.getByTestId(tid.ipay.export)).toBeDisabled();
    expect(screen.getByTestId(tid.ipay.history)).toHaveTextContent(/Exported 13\/08\/2026 15:30 by Dee Fitzgerald · \d+ rows?/);

    await userEvent.click(screen.getByTestId(tid.ipay.reconcile));
    await waitFor(() => expect(screen.getByTestId(tid.ipay.banner)).toHaveTextContent('RECONCILED'));
    expect(toasts()).toContain('Reconciled · recorded against the period and the audit log');
    expect(screen.getByTestId(tid.ipay.reconcile)).toBeDisabled();

    await userEvent.click(screen.getByTestId(tid.ipay.reopen));
    const dialog = await screen.findByTestId(tid.modal.root);
    expect(dialog).toHaveTextContent('Reopen the period');
    await userEvent.click(screen.getByTestId(tid.ipay.confirm));
    await waitFor(() => expect(dialog).toHaveTextContent('A reason for reopening is required.'));
    await userEvent.type(screen.getByTestId(tid.ipay.reason), 'A late correction');
    await userEvent.click(screen.getByTestId(tid.ipay.confirm));
    await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
    await waitFor(() => expect(screen.getByTestId(tid.ipay.banner)).toHaveTextContent('READY WITH WARNINGS'));
    expect(screen.getByTestId(tid.ipay.history)).toHaveTextContent('Reopened 13/08/2026 15:30 by Dee Fitzgerald · A late correction');
    expect(audits().filter(a => a.entity === 'payrollRun').map(a => a.act)).toEqual(['Payroll exported', 'Payroll reconciled', 'Payroll period reopened']);
  });

  test('a browser that blocks the file is told so and how to export again', async () => {
    clearBlockers();
    await open();
    const was = URL.createObjectURL;
    URL.createObjectURL = () => { throw new Error('blocked'); };
    try {
      await userEvent.click(screen.getByTestId(tid.ipay.export));
      await waitFor(() => expect(toasts(tid.toast.error)).toContain('Download blocked by the browser. No file was produced.'));
      expect(toasts(tid.toast.error)).toContain('Reopen it, allow downloads, then export again.');
      expect(toasts()).not.toContain('Exported');
    } finally { URL.createObjectURL = was; }
  });
});
