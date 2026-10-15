import { screen, within } from '@testing-library/react';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { resetTo, signInAs } from '@/test/api-helpers';
import { setToken } from '@/api/session-token';
import { MyHoursPage } from './MyHoursPage';

/* social at the frozen clock (Thursday 13/08/2026). Amara Okafor (CP-1042,
   the employee) is on Early, Early, rest, Night, Night in the published week
   of 10 August: 33h against 37.5h contracted, with 7.5h awaiting approval on
   Wednesday. Ellie Warren (CP-1310) is bank, on one Early on Saturday. */
withFakeServer();
beforeEach(() => resetTo('social'));

const open = async () => {
  renderPage(<MyHoursPage />, '/work/hours');
  return screen.findByTestId(tid.hours.days);
};
interface Acc { email: string; employeeCode: string; userType: string }
async function signInAsEmployee(code: string) {
  const a = Object.values(store.coll<Acc>('accounts')).find(x => x.employeeCode === code);
  if (!a) throw new Error(`no account for ${code}`);
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: a.email, password: 'Qnipay@123' }) });
  const { token } = (await r.json()) as { token: string };
  setToken(token);
}

describe('My hours', () => {
  test('the four tiles, the flags on the week and the week day by day, with full test id coverage', async () => {
    await signInAs('employee');
    await open();
    expect(screen.getByTestId(tid.hours.contracted)).toHaveTextContent('37.5h');
    expect(screen.getByTestId(tid.hours.contracted).parentElement).toHaveTextContent('per week · from your contract');
    expect(screen.getByTestId(tid.hours.rotad)).toHaveTextContent('33h');
    expect(screen.getByTestId(tid.hours.rotad).parentElement).toHaveTextContent('-4.5h against contract');
    expect(screen.getByTestId(tid.hours.worked)).toHaveTextContent('7.5h');
    expect(screen.getByTestId(tid.hours.worked).parentElement).toHaveTextContent('-25.5h against the rota');
    /* one flag to check (under contracted); nights are a note, not counted */
    expect(screen.getByTestId(tid.hours.checks)).toHaveTextContent('1');
    /* only a warning to check: the figure is in the warn ink, not the good one */
    expect(screen.getByTestId(tid.hours.checks)).toHaveClass('text-warn');
    expect(within(screen.getByTestId(tid.hours.flags)).getAllByText(/Under contracted|2 nights/)).toHaveLength(2);
    expect(screen.getByTestId(tid.hours.flag(0))).toHaveAttribute('data-tone', 'info');
    expect(screen.getByTestId(tid.hours.flag(1))).toHaveAttribute('data-tone', 'neu');

    const mon = screen.getByTestId(tid.hours.day('2026-08-10'));
    expect(mon).toHaveTextContent('Mon 10');
    expect(mon).toHaveTextContent('Early · 07:00–15:00');
    expect(screen.getByTestId(tid.hours.status('2026-08-10'))).toHaveTextContent('Nothing recorded');
    expect(screen.getByTestId(tid.hours.variance('2026-08-10'))).toHaveTextContent('-7.5h');
    expect(screen.getByTestId(tid.hours.status('2026-08-12'))).toHaveTextContent('Awaiting approval');
    expect(screen.getByTestId(tid.hours.variance('2026-08-12'))).toHaveTextContent('+7.5h');
    expect(screen.getByTestId(tid.hours.status('2026-08-14'))).toHaveTextContent('Still to come');
    expect(screen.getByTestId(tid.hours.status('2026-08-15'))).toHaveTextContent('Rest day');
    expect(screen.getByTestId(tid.hours.total)).toHaveTextContent('Week33h7.5h-25.5h');
    /* on a phone each day is a card: every cell carries its label */
    expect(within(mon).getByText('Early · 07:00–15:00').closest('td')).toHaveAttribute('data-l', 'Rota line');
    expectTestIdCoverage(document.body);
  });

  test('a bank worker sees Bank in place of a contracted figure, and the rota measured against nothing', async () => {
    await signInAsEmployee('CP-1310');
    await open();
    expect(screen.getByTestId(tid.hours.contracted)).toHaveTextContent('Bank');
    expect(screen.getByTestId(tid.hours.contracted).parentElement).toHaveTextContent('no contracted baseline');
    expect(screen.getByTestId(tid.hours.rotad)).toHaveTextContent('7.5h');
    expect(screen.getByTestId(tid.hours.rotad).parentElement).toHaveTextContent('scheduled this week');
    expect(screen.getByTestId(tid.hours.checks)).toHaveTextContent('0');
    expect(screen.getByTestId(tid.hours.checks)).toHaveClass('text-ok');
    expect(screen.queryByTestId(tid.hours.flags)).toBeNull();
  });
});
