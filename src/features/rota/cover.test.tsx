import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, caller, resetTo, signInAs } from '@/test/api-helpers';
import { CoverPage } from './CoverPage';

/* The social seed at the frozen clock (Thursday 13/08/2026), Willow House:
   cov_1 (Tue 11 night, sickness, stage 2) and cov_2 (Fri 14 late, urgent) are
   open; fil_1 (Ellie Warren, Sat 15 early) waits to be confirmed. ITACCESS is
   on, so confirming raises an IT access request. */
withFakeServer();
let token = '';
beforeEach(async () => { resetTo('social'); token = await signInAs('manager'); });

interface Cover { id: string; reason: string; open: boolean; stage: number }
interface Filled { id: string; coverId: string; confirmed: boolean; itRequest: string; personCode: string }
const covers = () => store.coll<Cover>('coverRequests');
const filled = () => Object.values(store.coll<Filled>('filledShifts'));
const acts = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const open = async () => {
  renderPage(<CoverPage />, '/team/tcover');
  return screen.findByTestId(tid.tcover.stages);
};

describe('Cover requests', () => {
  test('renders the stages, the open requests with their suggestions and the filled shift, filters them, with full test id coverage', async () => {
    await open();
    expect(screen.getAllByTestId(/^tcover-stage-\d$/)).toHaveLength(4);
    expect(screen.getByTestId(tid.tcover.stage(1))).toHaveTextContent('Employees at location15 min');
    expect(await screen.findByTestId(tid.tcover.request('cov_1'))).toHaveTextContent('Night · Tue 11 Aug');
    expect(screen.getByTestId(tid.tcover.request('cov_1'))).toHaveTextContent('stage 2 of 4');
    expect(screen.getByTestId(tid.tcover.urgent('cov_2'))).toHaveTextContent('Urgent');
    expect(screen.getByTestId(tid.tcover.log('cov_1'))).toHaveTextContent('Stage 2');
    expect(screen.getByTestId(tid.tcover.count)).toHaveTextContent('2 open · 1 to confirm');
    expect(screen.getByTestId(tid.tcover.filled('fil_1'))).toHaveTextContent('Sat 15 Aug 2026 · Early · filled');
    expect(screen.getByTestId(tid.tcover.confirm('fil_1'))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryAllByTestId(/^tcover-(sug|nobody)-cov-1/).length).toBeGreaterThan(0));
    expectTestIdCoverage(document.body);

    await userEvent.click(screen.getByTestId(tid.tcover.filter('urgent')));
    await waitFor(() => expect(screen.queryByTestId(tid.tcover.request('cov_1'))).toBeNull());
    expect(screen.getByTestId(tid.tcover.request('cov_2'))).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(tid.tcover.filter('filled')));
    expect(await screen.findByTestId(tid.tcover.empty)).toHaveTextContent('Nothing needs filling');
    expect(screen.getByTestId(tid.tcover.filled('fil_1'))).toBeInTheDocument();
  });

  test('a request needs a reason before it can be closed; with one it is assigned through the rota and then confirmed with an IT request', async () => {
    /* a short Friday early, opened without a reason, as advertising from the rota does */
    const r = await caller(token)('POST', '/api/v1/rota/cover', { location: 'WH', date: '2026-08-14', shift: 'E', reason: '', urgent: false });
    expect(r.status).toBe(200);
    const id = (r.body as { record: { id: string } }).record.id;
    await open();
    const card = await screen.findByTestId(tid.tcover.request(id));
    expect(within(card).getByTestId(tid.tcover.noReason(id))).toHaveTextContent('Choose a reason to see suggestions.');

    await userEvent.click(within(card).getByTestId(tid.tcover.fill(id)));
    await expectToast('Add a reason before closing the request.', tid.toast.error);
    expect(covers()[id]?.open).toBe(true);

    await userEvent.click(within(card).getByTestId(tid.tcover.reason(id)));
    await userEvent.click(await screen.findByTestId(`${tid.tcover.reason(id)}-option-Sickness`));
    await expectToast('Reason saved. Eligible colleagues at Willow House are asked first.');
    expect(covers()[id]).toMatchObject({ reason: 'Sickness', stage: 2 });

    const assign = (await screen.findAllByTestId(new RegExp(`^${tid.tcover.assign(id, '')}`)))[0];
    if (!assign) throw new Error('no suggestion to assign');
    await userEvent.click(assign);
    await expectToast(/assigned and added to the rota\. Confirm it once worked\./);
    expect(covers()[id]?.open).toBe(false);
    const f = filled().find(x => x.coverId === id);
    if (!f) throw new Error('no filled shift');
    expect(store.coll<{ lines: Record<string, string[]> }>('rotaWeeks')['rw_WH_2026-08-10']?.lines[f.personCode]?.[4]).toBe('E');

    await userEvent.click(await screen.findByTestId(tid.tcover.confirm(f.id)));
    await expectToast(/^Confirmed\. IT access request ITR-\d+ raised\./);
    expect(filled().find(x => x.id === f.id)).toMatchObject({ confirmed: true });
    expect(await screen.findByTestId(tid.tcover.confirmed(f.id))).toHaveTextContent('Confirmed');
    expect(screen.getByTestId(tid.tcover.it(f.id))).toHaveTextContent(/IT access request ITR-\d+/);
    expect(acts()).toEqual(['Cover request opened', 'Cover reason set', 'Cover request filled', 'Filled shift confirmed']);
  });
});
