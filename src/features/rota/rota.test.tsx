import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { RotaPage } from './RotaPage';

/* The social seed at the frozen clock (Thursday 13/08/2026). The manager runs
   Willow House (WH): week 33 (rw_WH_2026-08-10) is published at v1 with a gap
   on Friday (3 of 4 on shift); week 34 is not stored, so it reads as an empty
   draft at version 0. Rosa Mendes (CP-1402) is free on Friday; Amara Okafor
   (CP-1042) ends a night at 07:00 on Saturday, so an early that day breaks the rest rule. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('manager'); });

interface Week { version: number; state: string; publishVersion: number; lines: Record<string, string[]>; changes: { why: string; afterPublish: boolean }[] }
const week = (ws = '2026-08-10') => {
  const w = store.coll<Week>('rotaWeeks')[`rw_WH_${ws}`];
  if (!w) throw new Error(`no week ${ws}`);
  return w;
};
const rotaActs = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);
/* sonner stacks toasts, so read them all */
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const open = async () => {
  renderPage(<RotaPage />, '/team/trota');
  return screen.findByTestId(tid.trota.grid);
};
const pick = async (testId: string, value: string) => {
  await userEvent.click(screen.getByTestId(testId));
  await userEvent.click(await screen.findByTestId(`${testId}-option-${value}`));
};

describe('Team rota', () => {
  test('renders the published week: the week bar, the gap banner, the grid with its cover row and key, the day view and the history, with full test id coverage', async () => {
    await open();
    expect(screen.getByTestId(tid.trota.weekLabel)).toHaveTextContent('10/08/2026 – 16/08/2026');
    expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Published · v1');
    expect(screen.getByTestId(tid.trota.isoWeek)).toHaveTextContent('Week 33');
    expect(screen.getByTestId(tid.trota.copy)).toBeDisabled();
    expect(screen.getByTestId(tid.trota.clear)).toBeDisabled();
    expect(screen.getByTestId(tid.trota.publish)).toBeDisabled();
    expect(screen.getByTestId(tid.trota.publish)).toHaveAttribute('title', 'Coverage gaps block publishing');
    expect(screen.getByTestId(tid.trota.gaps)).toHaveTextContent('1 shift uncovered · Fri 14 Aug');
    expect(screen.getByTestId(tid.trota.gaps)).toHaveTextContent('Cover falls below the minimum of 4 set by the');
    expect(screen.getByTestId(tid.trota.gaps)).toHaveTextContent('This rota cannot be published.');
    expect(screen.getByTestId(tid.trota.hours('CP-1042'))).toHaveTextContent('33h · 45h max');
    expect(within(screen.getByTestId(tid.trota.cell('CP-1042', 0))).getByTestId(tid.trota.chip('CP-1042', 0))).toHaveAccessibleName(/Amara Okafor, Mon 10 August, Early, 07:00–15:00/);
    expect(screen.getByTestId(tid.trota.cov(4))).toHaveAccessibleName('Fri 14: 3 of 4 on shift, short');
    expect(screen.getByTestId(tid.trota.fill(4))).toBeInTheDocument();
    expect(screen.getByTestId(tid.trota.key)).toHaveTextContent(/E Early \d+/);
    expect(screen.getByTestId(tid.trota.key)).toHaveTextContent(/AL Leave 2/);
    expect(screen.getByTestId(tid.trota.key)).toHaveTextContent(/Unassigned \d+/);
    expect(screen.getByTestId(tid.trota.pchip('E'))).toHaveTextContent('E Early07:00–15:00');
    expect(screen.getByTestId(tid.trota.dayPill)).toHaveTextContent('4 on shift');
    expect(screen.getByTestId(tid.trota.history)).toHaveTextContent('Version history · week 33');
    expect(screen.getByTestId(tid.trota.changesEmpty)).toHaveTextContent('No changes recorded against this week yet');
    expectTestIdCoverage(document.body);

    await userEvent.type(screen.getByTestId(tid.trota.search), 'Amara');
    expect(screen.getByTestId(tid.trota.count)).toHaveTextContent(/^1 of \d+ colleagues$/);
    expect(screen.queryByTestId(tid.trota.cell('CP-1088', 0))).toBeNull();
  });

  test('a shift assigned by the picker on a live week becomes an amendment, and republishing makes it live', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.trota.add('CP-1402', 4)));
    expect(await screen.findByTestId(tid.modal.title)).toHaveTextContent('Add a shift');
    expect(await screen.findByTestId(tid.trota.sugTip)).toBeInTheDocument();
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.trota.assignThis));
    await expectToast('Early → Rosa Mendes · Fri 14 · 07:00–15:00');
    await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
    expect(week()).toMatchObject({ state: 'amendment' });
    expect(week().lines['CP-1402']?.[4]).toBe('E');
    expect(rotaActs()).toEqual(['Published rota amended']);
    expect(await screen.findByTestId(tid.trota.amended)).toHaveTextContent('1 unpublished change');
    expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Amended · v1');
    expect(screen.getByTestId(tid.trota.change(0))).toHaveTextContent('Rosa Mendes');
    expect(screen.getByTestId(tid.trota.change(0))).toHaveTextContent('published v1');
    expect(screen.getByTestId(tid.trota.covered)).toHaveTextContent('Every shift is covered');

    const publish = screen.getByTestId(tid.trota.publish);
    expect(publish).toHaveTextContent('Republish');
    expect(publish).toBeEnabled();
    await userEvent.click(publish);
    await expectToast('Rota republished · v2 · 10 colleagues notified · 1 amendment(s) included');
    expect(week()).toMatchObject({ state: 'republished', publishVersion: 2 });
    await waitFor(() => expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Republished · v2'));
  });

  test('the keyboard alone picks a shift up from the palette and puts it down on a cell (D11)', async () => {
    await open();
    screen.getByTestId(tid.trota.pchip('E')).focus();
    await userEvent.keyboard('{Enter}');
    await expectToast('Early picked up · choose a rota cell and press Enter');
    expect(screen.getByTestId(tid.trota.pchip('E'))).toHaveAttribute('aria-pressed', 'true');
    screen.getByTestId(tid.trota.add('CP-1402', 4)).focus();
    await userEvent.keyboard('{Enter}');
    await expectToast('Early → Rosa Mendes · Fri 14 · 07:00–15:00');
    expect(week().lines['CP-1402']?.[4]).toBe('E');
    expect(week().changes[0]).toMatchObject({ why: 'Assigned by keyboard', afterPublish: true });
    expect(screen.queryByTestId(tid.modal.root)).toBeNull();

    /* Escape puts a picked-up shift back */
    screen.getByTestId(tid.trota.pchip('L')).focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByTestId(tid.trota.pchip('L'))).toHaveAttribute('aria-pressed', 'true'));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByTestId(tid.trota.pchip('L'))).toHaveAttribute('aria-pressed', 'false');
  });

  test('a dragged shift lands through the same path, and a refused one says why and writes nothing', async () => {
    await open();
    const before = structuredClone(week());
    const chip = screen.getByTestId(tid.trota.pchip('E'));
    fireEvent.dragStart(chip, { dataTransfer: { setData: () => {}, getData: () => 'E', effectAllowed: '' } });
    const cell = screen.getByTestId(tid.trota.cell('CP-1042', 5));
    fireEvent.dragOver(cell, { dataTransfer: { dropEffect: '' } });
    fireEvent.drop(cell, { dataTransfer: { getData: () => 'E' } });
    await expectToast('Amara Okafor. Only 0 hours rest before or after.', tid.toast.error);
    expect(week()).toEqual(before);
    expect(rotaActs()).toEqual([]);

    fireEvent.dragStart(screen.getByTestId(tid.trota.pchip('E')), { dataTransfer: { setData: () => {}, getData: () => 'E', effectAllowed: '' } });
    fireEvent.drop(screen.getByTestId(tid.trota.cell('CP-1402', 4)), { dataTransfer: { getData: () => 'E' } });
    await expectToast('Early → Rosa Mendes · Fri 14');
    expect(week().changes[0]).toMatchObject({ why: 'Assigned by drag' });
  });

  test('publish is blocked while an empty draft week has gaps; it can be sent for review', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.trota.weekNext));
    await waitFor(() => expect(screen.getByTestId(tid.trota.weekLabel)).toHaveTextContent('17/08/2026 – 23/08/2026'));
    await waitFor(() => expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Draft'));
    expect(screen.getByTestId(tid.trota.publish)).toBeDisabled();
    expect(screen.getByTestId(tid.trota.publish)).toHaveAttribute('title', 'Coverage gaps block publishing');
    expect(screen.getByTestId(tid.trota.gaps)).toHaveTextContent('7 shifts uncovered');
    expect(screen.getByTestId(tid.trota.key)).toHaveTextContent(/Unassigned \d+/);
    expect(screen.getByTestId(tid.trota.key)).not.toHaveTextContent('Early');
    expect(screen.getByTestId(tid.trota.historyNote)).toHaveTextContent('Not yet published. Colleagues cannot see these shifts.');
    await userEvent.click(screen.getByTestId(tid.trota.review));
    await expectToast('Week 34 sent for review');
    expect(week('2026-08-17').state).toBe('review');
    await waitFor(() => expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('In review'));
  });

  test('copy last week into an empty draft, then clear it after a confirmation that lists the shifts and colleagues', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.trota.weekNext));
    await waitFor(() => expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Draft'));
    await userEvent.click(screen.getByTestId(tid.trota.copy));
    await expectToast(/^\d+ shift\(s\) copied from 10\/08\/2026 · review before publishing/);
    const copied = Object.values(week('2026-08-17').lines).flat().filter(c => c && c !== 'V' && c !== 'S').length;
    expect(copied).toBeGreaterThan(0);

    await waitFor(() => expect(screen.getByTestId(tid.trota.clear)).toBeEnabled());
    await userEvent.click(screen.getByTestId(tid.trota.clear));
    expect(await screen.findByTestId(tid.modal.title)).toHaveTextContent('Clear week 34?');
    expect(screen.getByTestId(tid.trota.fact('clear-shifts'))).toHaveTextContent(String(copied));
    expect(screen.getByTestId(tid.trota.fact('clear-people'))).not.toHaveTextContent('0');
    expect(screen.getByTestId(tid.trota.clearConfirm)).toHaveTextContent(`Clear ${copied} shifts`);
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.trota.clearConfirm));
    await expectToast(`${copied} shift(s) cleared · week 34 · drag from the palette or generate from a pattern to rebuild it`);
    expect(Object.values(week('2026-08-17').lines).flat().filter(c => c && c !== 'V' && c !== 'S')).toEqual([]);
    expect(rotaActs()).toEqual(['Rota week copied', 'Rota week cleared']);
  });

  test('repeat forward shows the server\'s summary', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.trota.repeat));
    expect(await screen.findByTestId(tid.modal.title)).toHaveTextContent('Repeat week 33 forward');
    await pick(tid.trota.repeatWeeks, '2');
    await userEvent.click(screen.getByTestId(tid.trota.repeatConfirm));
    await expectToast(/^\d+ shift\(s\) written across 2 week\(s\)/);
    expect(week('2026-08-17').lines['CP-1042']).toEqual(['E', 'E', '', 'N', 'N', '', '']);
    expect(rotaActs()).toEqual(['Rota week repeated']);
  });

  test('suggested cover fills the gap through the server once accepted', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.trota.suggest));
    await expectToast('Suggested 1 assignments for you to review');
    expect(await screen.findByTestId(tid.trota.plan)).toHaveTextContent('1 shift could be filled now');
    expect(screen.queryByTestId(tid.trota.palette)).toBeNull();
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.trota.planAcceptAll));
    await expectToast('1 shift(s) assigned from the plan. Everyone assigned has been notified.');
    await waitFor(() => expect(screen.queryByTestId(tid.trota.plan)).toBeNull());
    expect(week().state).toBe('amendment');
    expect(await screen.findByTestId(tid.trota.covered)).toBeInTheDocument();
  });

  test('a write refused 412 reads the week again, and the next attempt sends the fresh version', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.trota.add('CP-1402', 4)));
    await screen.findByTestId(tid.trota.assignThis);
    week().version = 4;
    await userEvent.click(screen.getByTestId(tid.trota.assignThis));
    await waitFor(() => expect(screen.queryAllByTestId(tid.toast.error).length).toBeGreaterThan(0));
    expect(week().lines['CP-1402']?.[4]).toBe('');
    expect(screen.getByTestId(tid.modal.root)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(tid.trota.assignThis));
    await expectToast('Early → Rosa Mendes · Fri 14 · 07:00–15:00');
    expect(week()).toMatchObject({ version: 5, state: 'amendment' });
  });
});
