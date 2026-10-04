import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { PatternsPage } from './PatternsPage';

/* The social seed at the frozen clock (Thursday 13/08/2026). The manager runs
   Willow House (WH): WP-01 (nights, WH and Beacon Court) and WP-02 (early and
   late, WH) cover it; WP-03 and WP-04 do not. Week 33 is published, so a run
   from today skips it. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('manager'); });

interface Pattern { code: string; name: string; gen: string; active: boolean; days: string[]; people: { personCode: string; offset: number }[] }
const pattern = (code: string) => store.coll<Pattern>('patterns')[`pat_${code}`];
const acts = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const open = async () => {
  renderPage(<PatternsPage />, '/team/tpat');
  return screen.findByTestId(tid.tpat.list);
};
const openEditor = async (code: string) => {
  await userEvent.click(screen.getByTestId(tid.tpat.open(code)));
  return screen.findByTestId(tid.tpat.editor);
};

describe('Working patterns', () => {
  test('lists only the patterns covering the manager\'s location, and the editor shows the cycle, the run and the people, with full test id coverage', async () => {
    await open();
    expect(screen.getByTestId(tid.tpat.row('WP-01'))).toHaveTextContent('also runs at Beacon Court');
    expect(screen.getByTestId(tid.tpat.state('WP-02'))).toHaveTextContent('Active');
    expect(screen.queryByTestId(tid.tpat.row('WP-03'))).toBeNull();
    expect(screen.queryByTestId(tid.tpat.row('WP-04'))).toBeNull();
    expectTestIdCoverage(document.body);

    await openEditor('WP-02');
    expect(screen.getByTestId(tid.modal.title)).toHaveTextContent('Early / Late, 5 over 7 · WP-02');
    expect(screen.getByTestId(tid.tpat.day(0))).toHaveTextContent('Day 107–15');
    expect(screen.getByTestId(tid.tpat.day(5))).toHaveTextContent('Day 6off');
    expect(screen.getByTestId(tid.tpat.summary)).toHaveTextContent('Repeats every 7 days · 5 working days · 37.5h per cycle');
    expect(screen.getByTestId(tid.tpat.range)).toHaveTextContent('This run covers 13/08/2026 – 12/08/2027');
    expect(screen.getByTestId(tid.tpat.person('CP-1042'))).toBeInTheDocument();
    expect(screen.getByTestId(tid.tpat.save)).toBeDisabled();
    expectTestIdCoverage(document.body);
  });

  test('a saved run length generates the rota and reports what was written, skipping the published week', async () => {
    await open();
    await openEditor('WP-02');
    await userEvent.selectOptions(screen.getByTestId(tid.tpat.gen), '4w');
    expect(screen.getByTestId(tid.tpat.range)).toHaveTextContent('This run covers 13/08/2026 – 09/09/2026');
    expect(screen.getByTestId(tid.tpat.run)).toBeDisabled();
    await userEvent.click(screen.getByTestId(tid.tpat.save));
    await expectToast('Early / Late, 5 over 7 saved');
    expect(pattern('WP-02')?.gen).toBe('4w');

    await waitFor(() => expect(screen.getByTestId(tid.tpat.run)).toBeEnabled());
    const weeks = () => store.coll<{ lines: Record<string, string[]> }>('rotaWeeks');
    const before = structuredClone(weeks());
    await userEvent.click(screen.getByTestId(tid.tpat.run));
    await expectToast(/\d+ shift\(s\) written · 13\/08\/2026 – 09\/09\/2026 · \d+ week\(s\) · \d+ people/);
    expect(toasts()).toContain('1 published week(s) skipped. Amend those individually');
    expect(acts()).toEqual(['Working pattern changed', 'Working pattern generated']);
    expect(weeks()['rw_WH_2026-08-17']?.lines['CP-1042']).toBeDefined();
    /* the toast and the audit row both count the cells that really landed, not the cycle's projection */
    const said = Number(/(\d+) shift\(s\) written/.exec(toasts())?.[1]);
    let landed = 0;
    for (const [id, w] of Object.entries(weeks())) {
      for (const [code, line] of Object.entries(w.lines)) line.forEach((c, i) => { if (c && !before[id]?.lines[code]?.[i]) landed++; });
    }
    expect(landed).toBeGreaterThan(0);
    expect(said).toBe(landed);
    expect(audits().find(a => a.act === 'Working pattern generated')?.after).toMatchObject({ written: landed, live: 1 });
  });

  test('a new pattern starts as a draft; turning it on with an empty cycle is refused; people are staggered across its shift days', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.tpat.newPattern));
    const dialog = await screen.findByTestId(tid.modal.root);
    expect(within(dialog).getByTestId(tid.tpat.newStart)).toHaveValue('2026-08-17');
    expectTestIdCoverage(document.body);
    await userEvent.type(within(dialog).getByTestId(tid.tpat.newName), 'Twilights');
    await userEvent.click(within(dialog).getByTestId(tid.tpat.newCreate));
    await expectToast('Twilights created as a draft');
    expect(await screen.findByTestId(tid.tpat.editor)).toBeInTheDocument();
    const code = screen.getByTestId(tid.modal.title).textContent?.split(' · ')[1] ?? '';
    expect(pattern(code)).toMatchObject({ name: 'Twilights', active: false, days: ['', '', '', '', '', '', '', ''] });

    await userEvent.click(screen.getByTestId(tid.tpat.active));
    await userEvent.click(screen.getByTestId(tid.tpat.save));
    await expectToast('Set at least one shift in the cycle first.', tid.toast.error);
    expect(pattern(code)?.active).toBe(false);
    await userEvent.click(screen.getByTestId(tid.tpat.cancel));

    await userEvent.click(screen.getByTestId(tid.tpat.day(0)));
    await userEvent.click(screen.getByTestId(tid.tpat.day(1)));
    await userEvent.click(screen.getByTestId(tid.tpat.save));
    await expectToast('Twilights saved');
    expect(pattern(code)?.days.slice(0, 3)).toEqual(['E', 'E', '']);

    await waitFor(() => expect(screen.getByTestId(tid.tpat.editorAdd)).toBeEnabled());
    await userEvent.click(screen.getByTestId(tid.tpat.editorAdd));
    expect(await screen.findByTestId(tid.tpat.pickAdd)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(tid.tpat.pickAdd));
    expect(screen.getByTestId(tid.tpat.pickWarn)).toHaveTextContent('Tick at least one person.');
    /* toasts from the saves above are still stacked, so check the dialog alone */
    expectTestIdCoverage(screen.getByTestId(tid.modal.root));
    const picks = screen.getAllByTestId(/^tpat-pick-CP-/);
    for (const p of picks.slice(0, 2)) await userEvent.click(p);
    await userEvent.click(screen.getByTestId(tid.tpat.pickAdd));
    await expectToast(`2 added to Twilights · staggered across 2 day(s)`);
    expect(pattern(code)?.people.map(x => x.offset)).toEqual([1, 2]);
    expect(acts()).toEqual(['Working pattern added', 'Working pattern changed', 'People added to a working pattern']);
    /* one row for the add, naming each person and the day they start on */
    const added = pattern(code)?.people.map(x => `${x.personCode} from day ${x.offset}`);
    expect(added).toHaveLength(2);
    expect(audits().find(a => a.act === 'People added to a working pattern')?.after).toEqual({ people: 2, added });
    expect(await screen.findByTestId(tid.tpat.editor)).toBeInTheDocument();
  });

  test('a manager\'s new pattern offers only their own location, already chosen; the hint says how to choose more than one, and the cycle start is a date', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.tpat.newPattern));
    const dialog = await screen.findByTestId(tid.modal.root);
    const locs = within(dialog).getByTestId<HTMLSelectElement>(tid.tpat.newLocs);
    expect(within(locs).getAllByRole('option').map(o => o.textContent)).toEqual(['Willow House']);
    expect([...locs.selectedOptions].map(o => o.value)).toEqual(['WH']);
    expect(within(dialog).getByText('Choose one or more. Hold Ctrl, or Cmd on a Mac.')).toBeInTheDocument();
    expect(within(dialog).getByTestId(tid.tpat.newStart)).toHaveAttribute('type', 'date');
  });

  test('a manager is offered no Remove for another location\'s people on a shared pattern, and can still take their own off', async () => {
    const wp1 = pattern('WP-01');
    if (!wp1) throw new Error('no WP-01');
    wp1.people = [...wp1.people, { personCode: 'CP-1288', offset: 2 }];
    await open();
    await openEditor('WP-01');
    expect(screen.getByTestId(tid.tpat.person('CP-1288'))).toBeInTheDocument();
    expect(screen.queryByTestId(tid.tpat.removePerson('CP-1288'))).toBeNull();
    await userEvent.click(screen.getByTestId(tid.tpat.removePerson('CP-1266')));
    expect(screen.queryByTestId(tid.tpat.person('CP-1266'))).toBeNull();
    await userEvent.click(screen.getByTestId(tid.tpat.save));
    await expectToast(/ saved/);
    expect(pattern('WP-01')?.people.map(x => x.personCode)).toEqual(['CP-1153', 'CP-1288']);
  });
});
