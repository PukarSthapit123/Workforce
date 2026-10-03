import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { ShiftsPage } from './ShiftsPage';

/* The social seed: Early, Late and Night, all used on the rota and in patterns. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('manager'); });

interface Shift { code: string; name: string; from: string; to: string; breakMinutes: number; hours: number; cross: boolean; version: number }
const shift = (code: string) => store.coll<Shift>('shiftTypes')[`sht_${code}`];
const acts = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const open = async () => {
  renderPage(<ShiftsPage />, '/team/tshifts');
  return screen.findByTestId(tid.tshifts.catalogue);
};

describe('Shift catalogue', () => {
  test('renders the palette and every shift type with its derived hours, midnight crossing and use, with full test id coverage', async () => {
    await open();
    expect(screen.getByTestId(tid.trota.pchip('N'))).toHaveTextContent('N Night22:00–07:00');
    expect(screen.getByTestId(tid.tshifts.paid('E'))).toHaveTextContent('7.5');
    expect(screen.getByTestId(tid.tshifts.cross('N'))).toHaveTextContent('+1d');
    expect(screen.queryByTestId(tid.tshifts.cross('E'))).toBeNull();
    expect(screen.getByTestId(tid.tshifts.usage('E'))).toHaveTextContent(/\d+ rota days?\d+ pattern days?/);
    expect(screen.getByTestId(tid.tshifts.remove('E'))).toBeInTheDocument();
    expectTestIdCoverage(document.body);

    await userEvent.click(screen.getByTestId(tid.trota.newShift));
    expect(await screen.findByTestId(tid.modal.title)).toHaveTextContent('New shift type');
    expectTestIdCoverage(document.body);
  });

  test('a row edit is a draft until Save: the paid hours follow the break, and Save writes one audited change', async () => {
    await open();
    const brk = screen.getByTestId(tid.tshifts.brk('E'));
    await userEvent.clear(brk);
    await userEvent.type(brk, '60');
    expect(screen.getByTestId(tid.tshifts.paid('E'))).toHaveTextContent('7');
    expect(shift('E')).toMatchObject({ breakMinutes: 30, hours: 7.5 });
    expect(screen.queryByTestId(tid.tshifts.remove('E'))).toBeNull();
    await userEvent.click(screen.getByTestId(tid.tshifts.save('E')));
    await expectToast('Early · 07:00–15:00 · 7h paid');
    expect(shift('E')).toMatchObject({ breakMinutes: 60, hours: 7, version: 2 });
    expect(acts()).toEqual(['Shift type changed']);
    expect(await screen.findByTestId(tid.tshifts.remove('E'))).toBeInTheDocument();
  });

  test('a new shift type works out its hours and midnight crossing, and is added once', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.tshifts.add));
    const dialog = await screen.findByTestId(tid.modal.root);
    await userEvent.click(within(dialog).getByTestId(tid.tshifts.newCreate));
    expect(within(dialog).getByTestId(tid.field.root(tid.tshifts.newCode))).toHaveTextContent('A unique code of 1–4 characters is required.');
    await userEvent.type(screen.getByTestId(tid.tshifts.newCode), 'tn');
    await userEvent.type(screen.getByTestId(tid.tshifts.newName), 'Twilight');
    await userEvent.click(screen.getByTestId(tid.tshifts.newCreate));
    await expectToast('Twilight added · 16:00–00:30 · 8.5h paid · crosses midnight');
    expect(shift('TN')).toMatchObject({ name: 'Twilight', hours: 8.5, cross: true });
    expect(acts()).toEqual(['Shift type added']);
    expect(await screen.findByTestId(tid.tshifts.row('TN'))).toBeInTheDocument();
  });

  test('a shift type still in use is not removed, and the refusal names its use', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.tshifts.remove('E')));
    await expectToast(/^Early is still in use on \d+ rota day\(s\) and \d+ pattern day\(s\)\. Clear those first\./, tid.toast.error);
    expect(toasts(tid.toast.error)).toContain('Change those rota and pattern days to another shift, then remove it.');
    expect(shift('E')).toBeDefined();
    expect(acts()).toEqual([]);
  });
});
