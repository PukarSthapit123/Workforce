import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { RTW_TOAST, daysReturnedToast, sicknessToast, triggerBannerText } from '@/domain/leave';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { SicknessPage } from './SicknessPage';

/* social at the frozen clock (Thursday 13/08/2026), Willow House: Marcus
   Reilly (CP-1088) has 4 spells over 7 days, a Bradford score of 112 against
   a trigger of 100, his latest absence (sk_004) on Tuesday 11 August, which
   falls on his approved annual leave (lr_4). Rachel Hussain is the manager. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('manager'); });

interface Episode { id: string; personCode: string; from: string; to: string; rtw: unknown }
interface Ledger { personCode: string; type: string; dates?: string[] }
const episodes = () => Object.values(store.coll<Episode>('sickEpisodes'));
const acts = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const set = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const choose = async (testId: string, value: string) => {
  await userEvent.click(screen.getByTestId(testId));
  await userEvent.click(await screen.findByTestId(`${testId}-option-${value}`));
};
const open = async () => {
  renderPage(<SicknessPage />, '/team/tsick');
  return screen.findByTestId(tid.tsick.table);
};

describe('Sickness', () => {
  test('the trigger banner, the Bradford table, record an absence and sickness on leave, filtered, with full test id coverage', async () => {
    await open();
    expect(screen.getByTestId(tid.tsick.banner)).toHaveTextContent(triggerBannerText('Marcus Reilly', 112, 100));
    expect(screen.getByTestId(tid.tsick.row('CP-1088'))).toHaveTextContent('11/08/2026 · 1 day');
    expect(screen.getByTestId(tid.tsick.score('CP-1088'))).toHaveTextContent('112');
    expect(screen.getByTestId(tid.tsick.score('CP-1088'))).toHaveAttribute('data-tone', 'err');
    expect(screen.getByTestId(tid.tsick.next('CP-1088'))).toHaveTextContent('Return-to-work meeting due');
    expect(screen.getByTestId(tid.tsick.onLeaveDay('CP-1088', '2026-08-11'))).toHaveTextContent('Marcus Reilly · Tue 11 Aug · 1 day of annual leave');
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.tsick.triggers));
    expect(screen.queryByTestId(tid.tsick.row('CP-1266'))).toBeNull();
    expect(screen.getByTestId(tid.tsick.row('CP-1088'))).toBeInTheDocument();
    await userEvent.type(screen.getByTestId(tid.tsick.search), 'nobody');
    expect(screen.getByTestId(tid.tsick.empty)).toHaveTextContent('Nothing matches that filter');
  });

  test('recording a day next to an absence joins that episode, says so, and moves the score', async () => {
    await open();
    await choose(tid.tsick.who, 'CP-1088');
    set(tid.tsick.from, '2026-08-12');
    set(tid.tsick.to, '2026-08-12');
    await choose(tid.tsick.reason, 'Mental health');
    await userEvent.click(screen.getByTestId(tid.tsick.save));
    await expectToast(sicknessToast(false));
    expect(toasts()).toContain('Joined to the absence that began 11/08/2026, so it counts as one spell.');
    await waitFor(() => expect(screen.getByTestId(tid.tsick.score('CP-1088'))).toHaveTextContent('128'));
    expect(episodes().find(e => e.id === 'sk_004')).toMatchObject({ from: '2026-08-11', to: '2026-08-12' });
    expect(acts()).toEqual(['Sickness recorded']);
  });

  test('Arrange it asks for a return-to-work meeting once, with its toast and one audit row', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.tsick.arrange));
    await expectToast(RTW_TOAST);
    expect(await screen.findByTestId(tid.tsick.arranged)).toHaveTextContent('Return-to-work meeting requested');
    expect(screen.queryByTestId(tid.tsick.arrange)).toBeNull();
    expect(episodes().find(e => e.id === 'sk_004')?.rtw).toMatchObject({ by: { personCode: 'CP-1001' } });
    expect(acts()).toEqual(['Return-to-work meeting requested']);
  });

  test('Give days back returns the picked days of leave as one ledger row', async () => {
    await open();
    const before = Object.keys(store.coll('leaveLedger')).length;
    await userEvent.click(screen.getByTestId(tid.tsick.giveBack));
    const day = await screen.findByTestId(tid.tsick.gbDay('2026-08-11'));
    expect(day).toBeChecked();
    expect(screen.getByTestId(tid.tsick.gbConfirm)).toHaveTextContent('Give 1 day back');
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.tsick.gbConfirm));
    await expectToast(daysReturnedToast(1, 'Marcus Reilly'));
    const ledger = Object.values(store.coll<Ledger>('leaveLedger'));
    expect(ledger).toHaveLength(before + 1);
    expect(ledger.filter(l => l.type === 'Days returned' && l.personCode === 'CP-1088')).toEqual([expect.objectContaining({ dates: ['2026-08-11'] })]);
    await waitFor(() => expect(screen.queryByTestId(tid.tsick.onLeaveDay('CP-1088', '2026-08-11'))).toBeNull());
    expect(within(screen.getByTestId(tid.tsick.onLeave)).getByTestId(tid.tsick.giveBack)).toBeDisabled();
    expect(acts()).toEqual(['Days returned']);
  });
});
