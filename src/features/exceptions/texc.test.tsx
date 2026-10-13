import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { SEVERITY_TIP } from '@/domain/exceptions';
import { ExceptionsPage } from './ExceptionsPage';

/* social at the frozen clock (Thursday 13/08/2026): Rachel Hussain manages
   Willow House, whose week derives clearance, coverage, an escalated leave
   request, the failed batch posting, missed timesheet days and hours flags.
   Nobody has acted on any of them yet. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('manager'); });

const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const rows = () => within(screen.getByTestId(tid.texc.list)).queryAllByTestId(/^texc-row-/);
const idOf = (row: HTMLElement) => (row.getAttribute('data-testid') ?? '').replace('texc-row-', '');
const open = async () => {
  renderPage(<ExceptionsPage />, '/team/texc');
  await screen.findByTestId(tid.texc.list);
  await waitFor(() => expect(rows().length).toBeGreaterThan(0));
};
const rowWith = (text: string) => {
  const r = rows().find(x => x.textContent?.includes(text));
  if (!r) throw new Error(`no exception row with ${text}`);
  return r;
};

describe('Exceptions', () => {
  test('state filters with Needs action the default, a severity and state pill on each row, the severity explained, search, with full test id coverage', async () => {
    await open();
    expect(screen.getByTestId(tid.texc.location)).toHaveTextContent('Willow House');
    for (const f of ['open', 'prog', 'resolved', 'ignored', 'all']) expect(screen.getByTestId(tid.texc.filter(f))).toBeInTheDocument();
    expect(screen.getByTestId(tid.texc.filter('open'))).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId(tid.texc.filter('open'))).toHaveTextContent(/^Needs action · \d+$/);
    expect(screen.getByTestId(tid.texc.filter('prog'))).toHaveTextContent('In progress · 0');
    /* Severity, with an i that says how it is ordered */
    expect(screen.getByTestId(tid.texc.severityTip).parentElement).toHaveTextContent('Severity');
    expect(screen.getByText(SEVERITY_TIP)).toBeInTheDocument();
    const all = rows();
    for (const r of all) expect(within(r).getByTestId(tid.texc.state(idOf(r)))).toHaveTextContent('●Open');
    /* highest severity first: the first row is a red one */
    const firstRow = all[0];
    if (!firstRow) throw new Error('no rows');
    expect(within(firstRow).getByTestId(tid.texc.kind(idOf(firstRow)))).toHaveAttribute('data-tone', 'err');
    /* Open goes to the screen the fact is put right on, where the reader can reach it; Business Central is the admin's */
    const ts = rowWith('scheduled days with no hours recorded');
    expect(within(ts).getByTestId(tid.texc.open(idOf(ts)))).toHaveAttribute('href', '/team/tteam');
    expect(within(rowWith('Posting failed')).queryByTestId(/^texc-open-/)).toBeNull();
    expect(screen.getByTestId(tid.texc.count)).toHaveTextContent(`${all.length} of ${all.length}`);
    expectTestIdCoverage(document.body);

    await userEvent.type(screen.getByTestId(tid.texc.search), 'qualification');
    expect(rows().map(r => r.textContent)).toEqual([expect.stringContaining('First aid expires in 24 days')]);
    await userEvent.type(screen.getByTestId(tid.texc.search), 'zzz');
    expect(screen.getByTestId(tid.texc.empty)).toHaveTextContent('Nothing matches that filter');
  });

  test('take, then resolve: a note is required, the resolution is recorded and filterable, Reopen is offered, and each move is audited', async () => {
    await open();
    const id = idOf(rowWith('Under contracted'));
    await userEvent.click(screen.getByTestId(tid.texc.move(id, 'take')));
    await waitFor(() => expect(toasts()).toContain('Taken · you are now the owner'));
    await waitFor(() => expect(screen.getByTestId(tid.texc.state(id))).toHaveTextContent('◐In progress'));
    expect(screen.getByTestId(tid.texc.meta(id))).toHaveTextContent(/^Owner: Rachel Hussain · First recorded .+ · 1 change$/);
    expect(screen.getByTestId(tid.texc.filter('prog'))).toHaveTextContent('In progress · 1');

    await userEvent.click(screen.getByTestId(tid.texc.move(id, 'resolve')));
    const dialog = await screen.findByTestId(tid.modal.root);
    expect(dialog).toHaveTextContent('Resolve this exception');
    expect(within(dialog).getByText('What was done')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(tid.texc.confirm));
    await waitFor(() => expect(dialog).toHaveTextContent('A resolution note is required.'));
    expect(audits().filter(a => a.entity === 'exception').map(a => a.act)).toEqual(['Exception in progress']);
    await userEvent.type(screen.getByTestId(tid.texc.note), 'Hours corrected with the colleague and resubmitted');
    await userEvent.click(screen.getByTestId(tid.texc.confirm));
    await waitFor(() => expect(toasts()).toContain('Resolved · recorded against the exception'));
    await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
    /* resolved leaves Needs action, and the Resolved filter shows it with its resolution and Reopen */
    expect(screen.queryByTestId(tid.texc.row(id))).toBeNull();
    await userEvent.click(screen.getByTestId(tid.texc.filter('resolved')));
    expect(screen.getByTestId(tid.texc.state(id))).toHaveTextContent('✓Resolved');
    expect(screen.getByTestId(tid.texc.meta(id))).toHaveTextContent('Resolution: Hours corrected with the colleague and resubmitted · 2 changes');
    expect(screen.getByTestId(tid.texc.move(id, 'reopen'))).toHaveTextContent('Reopen');
    expect(audits().filter(a => a.entity === 'exception').map(a => a.act)).toEqual(['Exception in progress', 'Exception resolved']);
  });

  test('the ignore dialog: the real modal structure with the close control in its header, P\'s warning, and a reason', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.texc.filter('all')));
    const id = idOf(rowWith('Fri 14/08 is 3 of 4'));
    await userEvent.click(screen.getByTestId(tid.texc.move(id, 'ignore')));
    const dialog = await screen.findByTestId(tid.modal.root);
    for (const slot of ['dialog-header', 'dialog-body', 'dialog-footer']) expect(dialog.querySelector(`[data-slot="${slot}"]`)).not.toBeNull();
    expect(screen.getByTestId(tid.modal.close).closest('[data-slot="dialog-header"]')).not.toBeNull();
    expect(screen.getByTestId(tid.texc.banner)).toHaveTextContent('Ignoring does not fix the underlying fact');
    expect(dialog).toHaveTextContent('Why this is being ignored');
    await userEvent.click(screen.getByTestId(tid.modal.close));
    await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());

    await userEvent.click(screen.getByTestId(tid.texc.move(id, 'ignore')));
    await userEvent.type(await screen.findByTestId(tid.texc.note), 'Agency cover booked for Friday');
    await userEvent.click(screen.getByTestId(tid.texc.confirm));
    await waitFor(() => expect(toasts()).toContain('Ignored · recorded against the exception'));
    await waitFor(() => expect(screen.getByTestId(tid.texc.state(id))).toHaveTextContent('—Ignored'));
    expect(screen.getByTestId(tid.texc.meta(id))).toHaveTextContent('Resolution: Agency cover booked for Friday');
  });
});
