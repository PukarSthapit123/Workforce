import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs, snapshot } from '@/test/api-helpers';
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

  test('an amended week is protected as a published one: Copy and Clear are off and say why (I3)', async () => {
    const w = week();
    w.state = 'amendment';
    await open();
    expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Amended · v1');
    expect(screen.getByTestId(tid.trota.copy)).toBeDisabled();
    expect(screen.getByTestId(tid.trota.copy)).toHaveAttribute('title', 'This week is amended. Copying over it would replace shifts colleagues can see.');
    expect(screen.getByTestId(tid.trota.clear)).toBeDisabled();
    expect(screen.getByTestId(tid.trota.clear)).toHaveAttribute('title', 'This week is amended. Clear it by amending the shifts you want removed.');
    expect(screen.getByTestId(tid.trota.publish)).toHaveTextContent('Republish');
  });

  test('on a live week with no gaps, Publish, Copy and Clear are off and each says why', async () => {
    const rosa = week().lines['CP-1402'];
    if (!rosa) throw new Error('no line for Rosa');
    rosa[4] = 'E';
    await open();
    expect(screen.getByTestId(tid.trota.covered)).toBeInTheDocument();
    expect(screen.getByTestId(tid.trota.publish)).toBeDisabled();
    expect(screen.getByTestId(tid.trota.publish)).toHaveAttribute('title', 'Already published at v1');
    expect(screen.getByTestId(tid.trota.copy)).toBeDisabled();
    expect(screen.getByTestId(tid.trota.copy)).toHaveAttribute('title', 'This week is published. Copying over it would replace shifts colleagues can see.');
    expect(screen.getByTestId(tid.trota.clear)).toBeDisabled();
    expect(screen.getByTestId(tid.trota.clear)).toHaveAttribute('title', 'This week is published. Clear it by amending the shifts you want removed.');
  });

  test('publishing a week lists it under Recent publications, and going back restores week 33\'s own state and version', async () => {
    const w = week();
    w.state = 'republished';
    w.publishVersion = 3;
    const cfg = store.coll<{ publishBlockOnGap: boolean }>('rotaConfig').rotaConfig;
    if (!cfg) throw new Error('no rota config');
    cfg.publishBlockOnGap = false;
    await open();
    expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Republished · v3');
    expect(screen.queryByTestId(tid.trota.pub(0))).toBeNull();

    await userEvent.click(screen.getByTestId(tid.trota.weekNext));
    await waitFor(() => expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Draft'));
    await waitFor(() => expect(screen.getByTestId(tid.trota.publish)).toBeEnabled());
    await userEvent.click(screen.getByTestId(tid.trota.publish));
    await expectToast(/^Rota published · v1/);
    await waitFor(() => expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Published · v1'));
    const pub = await screen.findByTestId(tid.trota.pub(0));
    expect(pub).toHaveTextContent('Willow House');
    expect(pub).toHaveTextContent('17/08/2026 – 23/08/2026');
    expect(pub).toHaveTextContent('v1');
    expect(screen.getByTestId(tid.trota.history)).toHaveTextContent('Recent publications');

    await userEvent.click(screen.getByTestId(tid.trota.weekPrev));
    await waitFor(() => expect(screen.getByTestId(tid.trota.isoWeek)).toHaveTextContent('Week 33'));
    await waitFor(() => expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Republished · v3'));
    expect(week()).toMatchObject({ state: 'republished', publishVersion: 3 });
    await userEvent.click(screen.getByTestId(tid.trota.weekNext));
    await waitFor(() => expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Published · v1'));
  });

  test('the horizon lists the months ahead, and publishing through it says it is simulated and writes nothing', async () => {
    await open();
    const before = snapshot('rotaWeeks', 'audit', 'notifications');
    await userEvent.click(screen.getByTestId(tid.trota.horizon));
    expect(await screen.findByTestId(tid.modal.title)).toHaveTextContent(/^Rota horizon · \d+ months$/);
    expect(screen.getByTestId(tid.trota.horizonRow('2026-08'))).toHaveTextContent('August 2026');
    await userEvent.click(screen.getByTestId(tid.trota.horizonPublish));
    await expectToast('Simulated · horizon publishing is represented, not performed.');
    await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
    expect(snapshot('rotaWeeks', 'audit', 'notifications')).toEqual(before);
  });

  test('a picked-up shift marks every cell it can land on, and the cell under the pointer is highlighted; chips are draggable and labelled', async () => {
    await open();
    const chip = screen.getByTestId(tid.trota.pchip('E'));
    expect(chip).toHaveAttribute('draggable', 'true');
    expect(chip).toHaveAccessibleName('Early, 07:00 to 15:00. Drag onto a rota cell, or press Enter to pick it up');
    expect(chip).toHaveTextContent('E Early07:00–15:00');
    expect(screen.getByTestId(tid.trota.palette)).toHaveAccessibleName('Shift types. Drag onto the rota, or press Enter to pick one up.');
    const target = screen.getByTestId(tid.trota.cell('CP-1402', 4)), other = screen.getByTestId(tid.trota.cell('CP-1042', 0));
    expect(target).not.toHaveClass('outline-dashed');

    fireEvent.dragStart(chip, { dataTransfer: { setData: () => {}, getData: () => 'E', effectAllowed: '' } });
    await waitFor(() => expect(target).toHaveClass('outline-dashed'));
    expect(other).toHaveClass('outline-dashed');
    expect(target).not.toHaveClass('outline-brand');
    fireEvent.dragOver(target, { dataTransfer: { dropEffect: '' } });
    await waitFor(() => expect(target).toHaveClass('outline-brand'));
    expect(other).not.toHaveClass('outline-brand');
    fireEvent.dragLeave(target);
    await waitFor(() => expect(target).not.toHaveClass('outline-brand'));
    fireEvent.dragEnd(chip);
    await waitFor(() => expect(target).not.toHaveClass('outline-dashed'));
    expect(rotaActs()).toEqual([]);
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

  test('a second drop while the first is still saving is refused out loud, not dropped (M3)', async () => {
    await open();
    const drag = (code: string) => fireEvent.dragStart(screen.getByTestId(tid.trota.pchip(code)), { dataTransfer: { setData: () => {}, getData: () => code, effectAllowed: '' } });
    drag('E');
    fireEvent.drop(screen.getByTestId(tid.trota.cell('CP-1402', 4)), { dataTransfer: { getData: () => 'E' } });
    drag('L');
    fireEvent.drop(screen.getByTestId(tid.trota.cell('CP-1042', 2)), { dataTransfer: { getData: () => 'L' } });
    await expectToast('Still saving the last change.', tid.toast.error);
    await expectToast('Early → Rosa Mendes · Fri 14');
    expect(week().lines['CP-1402']?.[4]).toBe('E');
    expect(week().changes.map(c => c.why)).toEqual(['Assigned by drag']);
    expect(rotaActs()).toEqual(['Published rota amended']);
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

  test('clearing a draft week with leave and sickness on it warns it cannot be undone, says the absence is kept, and keeps it', async () => {
    const id = 'rw_WH_2026-08-17';
    store.coll('rotaWeeks')[id] = { id, version: 1, updatedAt: '2026-08-13T14:30:00.000Z', location: 'WH', weekStart: '2026-08-17', state: 'draft',
      publishVersion: 0, publishedAt: '', publishedBy: null, changes: [],
      lines: { 'CP-1042': ['E', 'E', '', '', '', '', ''], 'CP-1088': ['V', 'S', 'L', '', '', '', ''] } };
    await open();
    await userEvent.click(screen.getByTestId(tid.trota.weekNext));
    await waitFor(() => expect(screen.getByTestId(tid.trota.state)).toHaveTextContent('Draft'));
    await waitFor(() => expect(screen.getByTestId(tid.trota.clear)).toBeEnabled());
    await userEvent.click(screen.getByTestId(tid.trota.clear));
    const dialog = await screen.findByTestId(tid.modal.root);
    expect(screen.getByTestId(tid.trota.fact('clear-shifts'))).toHaveTextContent('3');
    expect(screen.getByTestId(tid.trota.fact('clear-people'))).toHaveTextContent('2');
    expect(within(dialog).getByText('2 leave or sickness day(s) will be kept')).toBeInTheDocument();
    expect(within(dialog).getByText('Approved absence is not a shift and is not removed by clearing.')).toBeInTheDocument();
    expect(within(dialog).getByText('This cannot be undone from here')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(tid.trota.clearConfirm));
    await expectToast(/^3 shift\(s\) cleared · week 34/);
    expect(week('2026-08-17').lines).toMatchObject({ 'CP-1042': ['', '', '', '', '', '', ''], 'CP-1088': ['V', 'S', '', '', '', '', ''] });
  });

  test('repeat forward shows the server\'s summary', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.trota.repeat));
    expect(await screen.findByTestId(tid.modal.title)).toHaveTextContent('Repeat week 33 forward');
    expect(within(screen.getByTestId(tid.modal.root)).getByText('Published weeks are skipped')).toBeInTheDocument();
    expect(within(screen.getByTestId(tid.modal.root)).getByText('Cells that already hold a shift, leave or sickness are left alone, exactly as pattern generation behaves.')).toBeInTheDocument();
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
  test('a leave cell says it comes from the leave record and points a manager to Team leave (module 4 D7)', async () => {
    await open();
    const before = snapshot('rotaWeeks', 'audit');
    await userEvent.click(screen.getByTestId(tid.trota.chip('CP-1088', 0)));
    await expectToast('Annual leaveLeave and sickness come from the leave record. Change them there. Go to Team leave.');
    expect(screen.queryByTestId(tid.modal.root)).toBeNull();
    expect(snapshot('rotaWeeks', 'audit')).toEqual(before);
  });
});

/* Suite REVIEW RUN, density (rows moved to rota, D15): "Rota no longer stacks
   three banners", "The day view shows cover as a status line, not a banner"
   and "... the Fill action is offered once, not twice". Friday 14/08 is the
   short day of week 33: the page carries the gap banner (and the over-maximum
   one at most), and the day view says the shortfall in its head, with one Fill. */
test('the rota stacks at most two banners, and the day view says cover in a status pill with one Fill, not a banner', async () => {
  await open();
  const page = screen.getByTestId(tid.page('trota'));
  const banners = [...page.querySelectorAll('[role="note"]')].filter(n => !n.closest('[data-testid^="head-caution"]'));
  expect(banners.length).toBeGreaterThan(0);
  expect(banners.length).toBeLessThanOrEqual(2);
  const dayview = screen.getByTestId(tid.trota.dayview);
  await userEvent.click(within(dayview).getByTestId(tid.trota.day(4)));
  expect(within(dayview).getByTestId(tid.trota.dayPill)).toHaveTextContent('3 of 4');
  expect(dayview.querySelectorAll('[role="note"]')).toHaveLength(0);
  expect(within(dayview).getAllByRole('button', { name: /^Fill/ })).toHaveLength(1);
  expect(screen.getAllByTestId(tid.trota.dayFill)).toHaveLength(1);
});
