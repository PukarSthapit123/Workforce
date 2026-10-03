import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import type { TimesheetConfig, TimesheetDay } from '@/contract/timesheets';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { resetTo } from '@/test/api-helpers';
import { TeamPeoplePage } from '@/features/people/TeamPeoplePage';
import { TimesheetPage } from './TimesheetPage';
import { TeamTimesheetsPage } from './TeamTimesheetsPage';

/* The rota on the timesheet (module 3, group 5b), on the social seed at the
   frozen clock (Thursday 13/08/2026). Willow House's week of 10 August is
   published. Amara Okafor (CP-1042) works Early Mon and Tue, rests Wed, works
   Night Thu and Fri and rests the weekend; she already has Wednesday awaiting
   approval. Marcus Reilly (CP-1088) is on leave Mon and Tue. Daniel Osei
   (CP-1266) works nights, Rosa Mendes (CP-1402) a Late on Tuesday. Rachel
   Hussain (CP-1001) manages Willow House. */
withFakeServer();
beforeEach(() => resetTo('social'));
const signIn = async (who: string) => {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: `${who}@brightpath.org`, password: 'Qnipay@123' }) });
  const body = (await r.json()) as { token?: string };
  if (!body.token) throw new Error(`sign-in as ${who} failed`);
  setToken(body.token);
};
interface Week { state: string; lines: Record<string, string[]> }
const whWeek = () => {
  const w = store.coll<Week>('rotaWeeks')['rw_WH_2026-08-10'];
  if (!w) throw new Error('no Willow House week');
  return w;
};
const setCell = (code: string, day: number, to: string) => {
  const line = whWeek().lines[code];
  if (!line) throw new Error(`no line for ${code}`);
  line[day] = to;
};
const config = () => {
  const c = store.coll<TimesheetConfig>('timesheetConfig').timesheetConfig;
  if (!c) throw new Error('no timesheet config');
  return c;
};
const dayOf = (code: string, date: string) => store.coll<TimesheetDay>('timesheetDays')[`tsd_${code}_${date}`];
const set = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const toast = () => screen.findByTestId(tid.toast.info);
const openDay = async () => {
  renderPage(<TimesheetPage />);
  await userEvent.click(await screen.findByTestId(tid.ts.view('day')));
  return screen.findByTestId(tid.dayForm.field('start'));
};
/* steps the day view to a day of the week on screen ("Sat 15 Aug"), one day at a time */
const dayNum = (label: string) => Number(/\d+/.exec(label)?.[0] ?? 0);
const goTo = async (label: string) => {
  for (let i = 0; i < 7; i++) {
    const now = (screen.getByTestId(tid.ts.dayLabel).textContent ?? '').replace(/\s+/g, ' ');
    if (now.includes(label)) break;
    await userEvent.click(screen.getByTestId(dayNum(label) < dayNum(now) ? tid.ts.dayPrev : tid.ts.dayNext));
    await waitFor(() => expect((screen.getByTestId(tid.ts.dayLabel).textContent ?? '').replace(/\s+/g, ' ')).not.toBe(now));
    await screen.findByTestId(tid.dayForm.field('start'));
  }
  expect(screen.getByTestId(tid.ts.dayLabel)).toHaveTextContent(label);
};
const openWeek = async () => {
  renderPage(<TimesheetPage />);
  await userEvent.click(await screen.findByTestId(tid.ts.view('week')));
  return screen.findByTestId(tid.week.grid);
};

describe('My timesheet, the day against the rota', () => {
  beforeEach(() => signIn('amara.okafor'));
  test('the day shows its rota shift, starts from it, and Against the rota gives the variance as the times change', async () => {
    const start = await openDay();
    const banner = screen.getByTestId(tid.ts.banner('rota'));
    expect(banner).toHaveTextContent('Scheduled on the rota · Night 22:00–07:00 · 9 hours');
    expect(banner).toHaveTextContent('This timesheet entry is linked to that rota shift, so scheduled and actual hours reconcile.');
    expect(within(banner).getByTestId(tid.tsRota.seeShift)).toHaveAttribute('href', '/work/shifts');
    expect(start).toHaveValue('22:00');
    expect(screen.getByTestId(tid.dayForm.field('finish'))).toHaveValue('07:00');
    expect(screen.getByTestId(tid.dayForm.field('shift_code'))).toHaveTextContent('Night · 22:00–07:00');
    expect(screen.getByTestId(tid.dayForm.stat('rota'))).toHaveTextContent('9h scheduled · +0h variance');
    expect(screen.getByTestId(tid.ts.dayState)).toHaveTextContent('Nothing logged');
    expectTestIdCoverage(document.body);
    set(tid.dayForm.field('finish'), '07:30');
    expect(screen.getByTestId(tid.dayForm.stat('rota'))).toHaveTextContent('9h scheduled · +0.5h variance');
    await userEvent.click(screen.getByTestId(tid.dayForm.save));
    expect(await toast()).toHaveTextContent('Draft saved');
    expect(dayOf('CP-1042', '2026-08-13')).toMatchObject({ state: 'draft', shift: 'N', entries: [{ start: '22:00', finish: '07:30' }] });
    await waitFor(() => expect(screen.getByTestId(tid.ts.banner('rota'))).toHaveTextContent('Recorded so far: 9.5h (+0.5h against the rota).'));
  });

  test('a rest day with nothing recorded reads Rest day, not Nothing logged, and has no rota banner', async () => {
    await openDay();
    await goTo('Sat 15 Aug');
    expect(screen.getByTestId(tid.ts.dayState)).toHaveTextContent('Rest day');
    expect(screen.queryByTestId(tid.ts.banner('rota'))).toBeNull();
    expect(screen.queryByTestId(tid.dayForm.stat('rota'))).toBeNull();
    await goTo('Fri 14 Aug');
    expect(screen.getByTestId(tid.ts.dayState)).toHaveTextContent('Not yet open');
  });

  test('Copy yesterday copies yesterday’s rota line', async () => {
    await openDay();
    await goTo('Tue 11 Aug');
    set(tid.dayForm.field('start'), '09:00');
    set(tid.dayForm.field('finish'), '12:00');
    await userEvent.click(screen.getByTestId(tid.ts.copyDay));
    expect(await toast()).toHaveTextContent('Filled from yesterday’s rota · 07:00');
    expect(screen.getByTestId(tid.dayForm.field('start'))).toHaveValue('07:00');
    expect(screen.getByTestId(tid.dayForm.field('finish'))).toHaveValue('15:00');
  });
});

describe('My timesheet, leave and sickness on the rota', () => {
  test('a day on leave or off sick on the published rota shows the absence, not a rota line', async () => {
    setCell('CP-1088', 3, 'S');
    await signIn('marcus.reilly');
    await openDay();
    expect(screen.getByTestId(tid.ts.dayState)).toHaveTextContent('Sickness');
    expect(screen.getByTestId(tid.ts.banner('absence'))).toHaveTextContent('Sickness is recorded for this day');
    expect(screen.queryByTestId(tid.ts.banner('rota'))).toBeNull();
    await goTo('Mon 10 Aug');
    expect(screen.getByTestId(tid.ts.dayState)).toHaveTextContent('Annual leave');
    expect(screen.getByTestId(tid.ts.banner('absence'))).toHaveTextContent('Annual leave is recorded for this day');
  });
});

describe('My timesheet, Fill from rota', () => {
  beforeEach(() => signIn('amara.okafor'));
  test('the classic grid fills each rota’d day, says how many, shows the rota’d hours and submits with the rota line', async () => {
    await openWeek();
    expect(screen.getByTestId(tid.ts.contracted)).toHaveTextContent('Rota’d 33h of 37.5h contracted');
    expect(screen.getByTestId(tid.week.cell(0, 0, 'start'))).toHaveValue('');
    expect(screen.queryByTestId(tid.tsRota.seeded)).toBeNull();
    expect(screen.getByTestId(tid.week.grid).textContent).not.toMatch(/your rota|’s rota/i);
    await userEvent.click(screen.getByTestId(tid.ts.fillRota));
    expect(await toast()).toHaveTextContent('Filled from your rota · 4 days · check and adjust before submitting');
    expect(screen.getByTestId(tid.week.cell(0, 0, 'start'))).toHaveValue('07:00');
    expect(screen.getByTestId(tid.week.cell(0, 0, 'finish'))).toHaveValue('15:00');
    expect(screen.getByTestId(tid.week.cell(0, 3, 'start'))).toHaveValue('22:00');
    expect(screen.getByTestId(tid.week.cell(0, 2, 'start'))).toHaveValue('07:00');
    expect(screen.getByTestId(tid.week.cell(0, 5, 'start'))).toHaveValue('');
    await userEvent.click(screen.getByTestId(tid.ts.submitWeek));
    expect(await screen.findByText(/Week 33 submitted · 3 days/)).toBeInTheDocument();
    expect([dayOf('CP-1042', '2026-08-10')?.shift, dayOf('CP-1042', '2026-08-13')?.shift]).toEqual(['E', 'N']);
  });

  test('the grid layout fills the first allocation from the rota', async () => {
    config().weekLayout = 'grid';
    await openWeek();
    await userEvent.click(screen.getByTestId(tid.ts.fillRota));
    expect(await toast()).toHaveTextContent('Filled from your rota · 4 days');
    expect(screen.getByTestId(tid.week.cell(0, 1, 'start'))).toHaveValue('07:00');
    expect(screen.getByTestId(tid.week.cell(0, 4, 'finish'))).toHaveValue('07:00');
  });

  test('the list layout gives each rota’d day a line with the shift’s times', async () => {
    config().weekLayout = 'days';
    await openWeek();
    expect(screen.queryByTestId(tid.week.lineCell(0, 0, 'start'))).toBeNull();
    await userEvent.click(screen.getByTestId(tid.ts.fillRota));
    expect(await toast()).toHaveTextContent('Filled from your rota · 4 days');
    expect(screen.getByTestId(tid.week.lineCell(0, 0, 'start'))).toHaveValue('07:00');
    expect(screen.getByTestId(tid.week.lineCell(3, 0, 'start'))).toHaveValue('22:00');
    expect(screen.queryByTestId(tid.week.lineCell(5, 0, 'start'))).toBeNull();
  });

  test('a week still in draft on the rota has nothing to fill and no rota’d hours', async () => {
    whWeek().state = 'draft';
    await openWeek();
    expect(screen.getByTestId(tid.ts.contracted)).toHaveTextContent('Rota’d 0h of 37.5h contracted');
    await userEvent.click(screen.getByTestId(tid.ts.fillRota));
    expect(await toast()).toHaveTextContent('Nothing to fill. You have no shifts rota’d this week.');
    expect(screen.getByTestId(tid.week.cell(0, 0, 'start'))).toHaveValue('');
  });
});

describe('Proxy entry seeds from the team member’s rota', () => {
  beforeEach(() => signIn('rachel.hussain'));
  const openProxy = async (code: string) => {
    renderPage(<TeamPeoplePage />);
    await userEvent.click(await screen.findByTestId(tid.people.open(code)));
    await userEvent.click(await screen.findByTestId(tid.proxy.open));
    return screen.findByTestId(tid.dayForm.field('start'));
  };
  const proxyWeek = async () => {
    await userEvent.click(await screen.findByTestId(tid.proxy.view('week')));
    return screen.findByTestId(tid.week.grid);
  };
  test('the day form seeds the rota line and the times from the target, whichever shift they are on', async () => {
    const start = await openProxy('CP-1042');
    expect(start).toHaveValue('22:00');
    expect(screen.getByTestId(tid.dayForm.field('finish'))).toHaveValue('07:00');
    const line = screen.getByTestId(tid.dayForm.field('shift_code'));
    expect(line).toHaveTextContent(/^Night · 22:00–07:00/);
    expect(line.textContent).toContain('22:00');
    expectTestIdCoverage(document.body);
  });

  test('the grid seeds night times for a night worker and late times for a late worker, and says whose rota it came from', async () => {
    await openProxy('CP-1266');
    const night = await proxyWeek();
    expect(screen.getByTestId(tid.week.cell(0, 2, 'start'))).toHaveValue('22:00');
    expect(screen.getByTestId(tid.week.cell(0, 0, 'finish'))).toHaveValue('07:30');
    expect(screen.getByTestId(tid.tsRota.seeded)).toHaveTextContent('Seeded from Daniel’s rota, not yours.');
    expect(night.textContent).not.toMatch(/your rota/i);
    await userEvent.click(screen.getByTestId(tid.modal.close));
    await waitFor(() => expect(screen.queryByTestId(tid.proxy.banner)).toBeNull());

    await userEvent.click(await screen.findByTestId(tid.people.open('CP-1402')));
    await userEvent.click(await screen.findByTestId(tid.proxy.open));
    await proxyWeek();
    expect(screen.getByTestId(tid.week.cell(0, 1, 'start'))).toHaveValue('14:30');
    expect(screen.getByTestId(tid.week.cell(0, 1, 'finish'))).toHaveValue('22:00');
    expect(screen.getByTestId(tid.tsRota.seeded)).toHaveTextContent('Seeded from Rosa’s rota, not yours.');
  });
});

describe('Team timesheets, the matrix against the rota', () => {
  test('a shift not yet worked shows its rota hours, leave shows AL and sickness S, and submitted days keep their state', async () => {
    setCell('CP-1310', 5, 'S');
    await signIn('rachel.hussain');
    renderPage(<TeamTimesheetsPage />);
    await userEvent.click(await screen.findByTestId(tid.tteam.view('week')));
    await screen.findByTestId(tid.tteam.matrix);
    await waitFor(() => expect(screen.getByTestId(tid.tteam.pip('CP-1042', 3))).toHaveTextContent('9'));
    expect(screen.getByTestId(tid.tteam.pip('CP-1042', 3))).toHaveAttribute('data-state', 'sched');
    expect(screen.getByTestId(tid.tteam.pip('CP-1042', 0))).toHaveTextContent('7.5');
    expect(screen.getByTestId(tid.tteam.pip('CP-1042', 2))).toHaveAttribute('data-state', 'pend');
    expect(screen.getByTestId(tid.tteam.pip('CP-1042', 5))).toHaveTextContent('–');
    expect(screen.getByTestId(tid.tteam.pip('CP-1088', 0))).toHaveTextContent('AL');
    expect(screen.getByTestId(tid.tteam.pip('CP-1088', 0))).toHaveAttribute('data-state', 'off');
    expect(screen.getByTestId(tid.tteam.pip('CP-1310', 5))).toHaveTextContent('S');
    expect(screen.getByTestId(tid.tteam.pip('CP-1402', 0))).toHaveAttribute('data-state', 'ok');
    expect(screen.getByText('Scheduled, not yet worked')).toBeInTheDocument();
    expectTestIdCoverage(document.body);
  });
});

describe('Rota off (qnipay): the timesheet shows none of the rota', () => {
  beforeEach(async () => {
    resetTo('qnipay');
    const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'bigyan.poudel@dogmagroup.co.uk', password: 'Qnipay@123' }) });
    const body = (await r.json()) as { token?: string };
    if (!body.token) throw new Error('sign-in failed');
    setToken(body.token);
  });
  test('no rota banner, no Against the rota, no rest day and no Fill from rota', async () => {
    await openDay();
    expect(screen.queryByTestId(tid.ts.banner('rota'))).toBeNull();
    expect(screen.queryByTestId(tid.dayForm.stat('rota'))).toBeNull();
    expect(screen.getByTestId(tid.dayForm.field('start'))).toHaveValue('');
    await goTo('Sat 15 Aug');
    expect(screen.getByTestId(tid.ts.dayState)).toHaveTextContent('Not yet open');
    await userEvent.click(screen.getByTestId(tid.ts.view('week')));
    await screen.findByTestId(tid.week.grid);
    expect(screen.queryByTestId(tid.ts.fillRota)).toBeNull();
    expect(screen.getByTestId(tid.ts.contracted)).not.toHaveTextContent('Rota’d');
  });
});
