import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { setToken } from '@/api/session-token';
import { TimesheetPage } from '@/features/timesheet/TimesheetPage';
import { ModulesPage } from './ModulesPage';

/* The social seed runs every module; LATE_FINISH, VEHICLE and GPS are off.
   The qnipay seed has Rota off. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });
const tenant = () => {
  const t = store.coll<{ version: number; modules: Record<string, boolean>; flags: Record<string, boolean> }>('tenant').tenant;
  if (!t) throw new Error('no tenant');
  return t;
};
const tenantAudits = () => audits().filter(a => a.entity === 'tenant');
const open = async (m?: string) => {
  renderPage(<ModulesPage />, m ? `/setup/amods?m=${m}` : '/setup/amods');
  return screen.findByTestId(m ? tid.amods.moduleCard : tid.amods.card('CORE'));
};
const weekLayout = () => store.coll<{ weekLayout: string }>('timesheetConfig').timesheetConfig?.weekLayout;

test('the index is a card per module with its state and counts, a caution, a search, and full test id coverage', async () => {
  await open();
  for (const c of ['CORE', 'TS', 'R', 'L', 'ON']) expect(screen.getByTestId(tid.amods.card(c))).toHaveAttribute('href', `/setup/amods?m=${c}`);
  expect(screen.getByTestId(tid.amods.cardState('CORE'))).toHaveTextContent('Always on');
  expect(screen.getByTestId(tid.amods.cardCounts('TS'))).toHaveTextContent('2 of 2 capture methods · 8 of 13 features · Timesheet setup');
  expect(screen.getByTestId(tid.amods.cardCounts('R'))).toHaveTextContent('8 of 8 features · Rota setup');
  expect(screen.getByTestId(tid.head.caution('amods'))).toHaveTextContent('There is no draft stage in this build.');
  expect(screen.queryByTestId(tid.amods.flag('AUTO_OT'))).toBeNull();
  expectTestIdCoverage(document.body);
  await userEvent.type(screen.getByTestId(tid.amods.search), 'overtime');
  expect(screen.getAllByRole('link').map(a => a.getAttribute('data-testid'))).toEqual([tid.amods.card('TS')]);
  await userEvent.clear(screen.getByTestId(tid.amods.search));
  await userEvent.type(screen.getByTestId(tid.amods.search), 'zzzznothing');
  expect(screen.getByTestId(tid.amods.empty)).toHaveTextContent('Nothing matches that search');
});

test('an off module is marked on its card, with its features counted but not as on', async () => {
  resetTo('qnipay'); await signInAs('admin');
  await open();
  expect(screen.getByTestId(tid.amods.cardState('R'))).toHaveTextContent('Off');
  expect(screen.getByTestId(tid.amods.cardCounts('R'))).toHaveTextContent('8 features · Rota setup');
});

test('a feature switch writes once, with one audit row, and the toast is the server’s message', async () => {
  await open('TS');
  expect(screen.getByTestId(tid.amods.flag('LATE_FINISH'))).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(screen.getByTestId(tid.amods.flag('LATE_FINISH')));
  expect(await screen.findByText('Late finish detection on. It is live for everyone now.')).toBeInTheDocument();
  expect(tenant().flags.LATE_FINISH).toBe(true);
  expect(tenantAudits().map(a => a.act)).toEqual(['Feature changed']);
  await waitFor(() => expect(screen.getByTestId(tid.amods.flag('LATE_FINISH'))).toHaveAttribute('aria-checked', 'true'));
  expectTestIdCoverage(document.body);
});

test('turning a module off asks first with its impact, and the toast says what was kept', async () => {
  await open('L');
  await userEvent.click(screen.getByTestId(tid.amods.mod('L')));
  const box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.modal.title)).toHaveTextContent('Turn off Leave & absence?');
  expect(box).toHaveTextContent('Rota stops treating leave as unavailability. This applies to everyone immediately.');
  expect(tenant().modules.L).toBe(true);
  await userEvent.click(within(box).getByTestId(tid.modal.confirm));
  expect(await screen.findByText('Leave & absence turned off. It is live for everyone now.')).toBeInTheDocument();
  expect(screen.getByTestId(tid.toast.next)).toHaveTextContent(/^Kept as they were: \d+ leave requests/);
  expect(tenant().modules.L).toBe(false);
  expect(tenantAudits().map(a => a.act)).toEqual(['Module turned off']);
  expect(await screen.findByTestId(tid.amods.offBanner)).toHaveTextContent('Leave & absence is off');
  expect(screen.getByTestId(tid.amods.offPill)).toHaveTextContent('Module off');
  expect(screen.getByTestId(tid.amods.flag('LV_ENT'))).toBeDisabled();
});

test('Rota off sets its scheduled shifts aside, and Rota on puts them back, each saying how many', async () => {
  await open('R');
  await userEvent.click(screen.getByTestId(tid.amods.mod('R')));
  await userEvent.click(within(await screen.findByTestId(tid.modal.root)).getByTestId(tid.modal.confirm));
  const off = await screen.findByText(/^Rota turned off\. It is live for everyone now\. (\d+) scheduled shifts cleared from the calendar and kept to restore\.$/);
  const cleared = /(\d+) scheduled/.exec(off.textContent ?? '')?.[1];
  expect(Number(cleared)).toBeGreaterThan(0);
  await waitFor(() => expect(screen.getByTestId(tid.amods.mod('R'))).toHaveAttribute('aria-checked', 'false'));
  await userEvent.click(screen.getByTestId(tid.amods.mod('R')));
  expect(await screen.findByText(`Rota turned on. It is live for everyone now. ${cleared} scheduled shifts restored to the calendar.`)).toBeInTheDocument();
  expect(tenantAudits().map(a => a.act)).toEqual(['Module turned off', 'Module turned on']);
});

test('Workforce core has no off control', async () => {
  await open('CORE');
  expect(screen.getByTestId(tid.amods.mod('CORE'))).toBeDisabled();
  expect(screen.getByTestId(tid.amods.mod('CORE'))).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByTestId(tid.amods.enableNote)).toHaveTextContent('Workforce core cannot be switched off. Everything else depends on it.');
  expect(screen.getByTestId(tid.amods.flag('NOTICES'))).toBeEnabled();
});

test('a switch against a tenant that changed underneath is refused, nothing is written, and the next try works', async () => {
  await open('TS');
  tenant().version += 1;
  await userEvent.click(screen.getByTestId(tid.amods.flag('VEHICLE')));
  expect(await screen.findByTestId(tid.toast.error)).toBeInTheDocument();
  expect(tenant().flags.VEHICLE).toBe(false);
  expect(tenantAudits()).toEqual([]);
  await waitFor(() => expect(screen.getByTestId(tid.amods.flag('VEHICLE'))).toBeEnabled());
  await userEvent.click(screen.getByTestId(tid.amods.flag('VEHICLE')));
  expect(await screen.findByText('Vehicle & movement fields on. It is live for everyone now.')).toBeInTheDocument();
  expect(tenantAudits()).toHaveLength(1);
});

test('the weekly grid’s layout and the break limit are set on their feature rows', async () => {
  await open('TS');
  const layout = screen.getByTestId(tid.amods.weekLayout);
  expect([...layout.querySelectorAll('option')].map(o => o.textContent)).toEqual([
    'Classic · allocation in the first column', 'Grid · allocation as a section header', 'List · one row per day']);
  fireEvent.change(layout, { target: { value: 'days' } });
  expect(await screen.findByText('Weekly view: list. One row per day, allocation chosen before the times. It is live for everyone now.')).toBeInTheDocument();
  expect(weekLayout()).toBe('days');
  await waitFor(() => expect(screen.getByTestId(tid.amods.weekLayout)).toHaveValue('days'));
  expect(screen.getByTestId(tid.amods.stepValue('breaksMax'))).toHaveTextContent('5');
  expect(screen.getByTestId(tid.amods.stepUp('breaksMax'))).toBeDisabled();
  await userEvent.click(screen.getByTestId(tid.amods.stepDown('breaksMax')));
  expect(await screen.findByText('Breaks per entry: 4. It is live for everyone now.')).toBeInTheDocument();
  expect(tenantAudits().map(a => a.act)).toEqual(['Feature changed', 'Feature changed']);
});

/* Suite ICONS, CRUMBS AND REDUNDANT COUNTS and HEADER PILLS REMOVED: each
   module card has its own icon from the shared set and says its count in
   words; the index carries no crumb claiming Modules sits under Qnipay setup. */
test('each module card carries its own icon and says its count in words, under no Qnipay setup crumb', async () => {
  await open();
  const icons = ['CORE', 'TS', 'R', 'L', 'ON'].map(c => screen.getByTestId(tid.amods.card(c)).querySelector('svg')?.innerHTML ?? '');
  expect(icons.every(Boolean)).toBe(true);
  expect(new Set(icons).size).toBe(5);
  expect(screen.getByTestId(tid.amods.cardCounts('L'))).toHaveTextContent(/\d+ of \d+ features/);
  expect(screen.getByTestId(tid.page('amods'))).not.toHaveTextContent(/Qnipay setup · Modules/);
});

test('a module’s features page names the module in its crumb, and its head has no N of M on pill', async () => {
  await open('R');
  expect(screen.getByText('Modules · Rota · Rota features')).toBeInTheDocument();
  const head = screen.getByRole('heading', { level: 1, name: /Rota features/ }).parentElement?.parentElement;
  expect(head).not.toHaveTextContent(/\d+ of \d+ on/);
  expect(screen.getAllByTestId(/^amods-flag-/).length).toBeGreaterThan(0);
});

/* Suite MODULES: "Each card says what the module is about" and "Clearing
   restores every module". */
test('each card says what its module is about, and clearing the search brings every module back', async () => {
  await open();
  expect(screen.getByTestId(tid.amods.card('R'))).toHaveTextContent('Shift catalogue, working patterns, coverage and the shift fulfilment workflow.');
  const cards = () => screen.getAllByRole('link').map(a => a.getAttribute('data-testid'));
  const all = ['CORE', 'TS', 'R', 'L', 'ON'].map(c => tid.amods.card(c));
  expect(cards()).toEqual(all);
  await userEvent.type(screen.getByTestId(tid.amods.search), 'zzzznothing');
  expect(screen.queryAllByRole('link')).toEqual([]);
  await userEvent.clear(screen.getByTestId(tid.amods.search));
  expect(cards()).toEqual(all);
});

/* Suite MODULE PAGES ARE THE SAME SHAPE and TIMESHEET AS ONE MODULE: every
   drill-in is two cards; the first holds exactly one row, the enable row,
   the same on every module; the capture methods and capabilities are
   switches in the Features card, grouped in a sensible order with the
   module-level features last; Rota has neither groups nor nesting; no page
   carries a bespoke "Module state" row. */
test('every module page is the same shape: one enable row, then the features, grouped only where the module has capabilities', async () => {
  const shape = async (code: string) => {
    cleanup();
    const card = await open(code);
    const page = screen.getByTestId(tid.page('mfeat'));
    const features = screen.getByTestId(tid.amods.features);
    return {
      cards: page.querySelectorAll('section').length,
      rows: [...card.querySelectorAll('[data-slot="setting-row"] b')].map(b => b.textContent),
      switchesInFirst: within(card).getAllByRole('switch').map(s => s.getAttribute('data-testid')),
      subSwitches: within(features).queryAllByTestId(/^amods-mod-/).map(s => s.getAttribute('data-testid')),
      groups: [...features.querySelectorAll('[data-slot="subhead"]')].map(g => g.textContent),
      nested: features.querySelectorAll('[data-nested]').length,
      moduleState: /Module state/.test(page.textContent ?? ''),
    };
  };
  const core = await shape('CORE'), ts = await shape('TS'), r = await shape('R'), l = await shape('L');
  for (const [s, code] of [[core, 'CORE'], [ts, 'TS'], [r, 'R'], [l, 'L']] as const) {
    expect(s.cards, code).toBe(2);
    expect(s.rows, code).toEqual([code === 'CORE' ? 'Always on' : 'Module enabled']);
    expect(s.switchesInFirst, code).toEqual([tid.amods.mod(code)]);
    expect(s.moduleState, code).toBe(false);
  }
  expect(ts.subSwitches).toEqual(['A', 'B', 'C'].map(c => tid.amods.mod(c)));
  expect(ts.groups).toEqual(['Capture methods', 'Capabilities', 'Across all capture methods']);
  expect(ts.nested).toBeGreaterThan(0);
  expect([r.groups, r.nested, r.subSwitches]).toEqual([[], 0, []]);
});

/* Suite FEATURE OWNERSHIP and TIMESHEET AS ONE MODULE, on the page itself:
   Workforce core keeps the self-service and pay-visibility features and none
   of capture's; Timesheet holds the three capture methods as switches, the
   eight features that moved to it and its own capability features, thirteen
   in all, grouped by the capability they belong to. */
test('Workforce core shows only its own features, and Timesheet shows its capture methods and all thirteen of its features', async () => {
  const shown = () => screen.getAllByTestId(/^amods-flag-/).map(b => b.getAttribute('data-testid'));
  const flagsOn = () => { const ids = shown(); return (codes: string[]) => codes.filter(c => ids.includes(tid.amods.flag(c))); };
  await open('CORE');
  const core = flagsOn();
  expect(core(['DOCS', 'SELF_EDIT', 'SHOW_PAY'])).toEqual(['DOCS', 'SELF_EDIT', 'SHOW_PAY']);
  expect(core(['AUTO_OT', 'LATE_FINISH', 'UNSOCIAL', 'VEHICLE', 'PROJECT', 'SHIFT', 'BREAKS', 'EMAIL_APPROVAL'])).toEqual([]);
  cleanup();
  await open('TS');
  expect(shown()).toHaveLength(13);
  const own = ['AUTO_OT', 'LATE_FINISH', 'UNSOCIAL', 'VEHICLE', 'PROJECT', 'SHIFT', 'BREAKS', 'EMAIL_APPROVAL', 'DAILY', 'WEEKLY', 'GPS'];
  expect(flagsOn()(own)).toEqual(own);
  const features = screen.getByTestId(tid.amods.features);
  for (const c of ['A', 'B', 'C']) expect(within(features).getByTestId(tid.amods.mod(c))).toHaveAttribute('role', 'switch');
  expect(features.querySelectorAll('[data-slot="subhead"]').length).toBeGreaterThanOrEqual(2);
});

/* Suite TIMESHEET AS ONE MODULE: "Turning a capture method off asks first". */
test('turning a capture method off asks first, and keeping it changes nothing', async () => {
  await open('TS');
  await userEvent.click(screen.getByTestId(tid.amods.mod('B')));
  const box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.modal.title)).toHaveTextContent('Turn off Clock in / out?');
  expect(box).toHaveTextContent('This applies to everyone immediately.');
  await userEvent.click(within(box).getByTestId(tid.modal.cancel));
  expect(tenant().modules.B).toBe(true);
  expect(tenantAudits()).toEqual([]);
});

/* Suite SETUP CONTROLS DO ONE THING: a click inside a feature row's select
   neither toggles the switch beside it nor changes the select's value. */
test('a click inside a feature row’s select leaves its switch and its value alone', async () => {
  await open('TS');
  const before = weekLayout();
  await userEvent.click(screen.getByTestId(tid.amods.weekLayout));
  await userEvent.click(screen.getByTestId(tid.amods.weekGrid));
  expect(screen.getByTestId(tid.amods.flag('WEEKLY'))).toHaveAttribute('aria-checked', 'true');
  expect(tenant().flags.WEEKLY).toBe(true);
  expect(screen.getByTestId(tid.amods.weekLayout)).toHaveValue(before);
  expect(weekLayout()).toBe(before);
  expect(tenantAudits()).toEqual([]);
});

/* Suite HEADER PILLS REMOVED: "And is reachable by keyboard with a label". */
test('the modules index caution is reached by keyboard and is labelled', async () => {
  await open();
  const caution = screen.getByTestId(tid.head.caution('amods'));
  expect(caution).toHaveAttribute('tabindex', '0');
  expect(caution).toHaveAccessibleName('Caution');
  await userEvent.tab(); await userEvent.tab();
  expect(caution).toHaveFocus();
});

/* Suites WEEKLY VIEW (WK) and WEEKLY LAYOUT IS CONFIGURABLE (CL): "Switching
   back restores classic, the default" and "Switching back restores the
   grid", switched on the weekly grid's row (D6) and read on My timesheet. On
   the qnipay seed Bigyan Poudel (a Consultant) is a grid type. */
test('switching the weekly layout back restores classic, and from the list back restores the grid, on My timesheet too', async () => {
  resetTo('qnipay'); await signInAs('admin');
  const choose = async (v: string, toast: RegExp) => {
    fireEvent.change(screen.getByTestId(tid.amods.weekLayout), { target: { value: v } });
    expect(await screen.findByText(toast)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId(tid.amods.weekLayout)).toHaveValue(v));
  };
  const week = async () => {
    cleanup();
    const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'bigyan.poudel@dogmagroup.co.uk', password: 'Qnipay@123' }) });
    setToken(((await r.json()) as { token: string }).token);
    renderPage(<TimesheetPage />);
    return screen.findByTestId(tid.week.grid);
  };
  await open('TS');
  await choose('grid', /^Weekly view: grid\./);
  await choose('classic', /^Weekly view: classic\./);
  expect(weekLayout()).toBe('classic');
  const grid = await week();
  expect(within(grid).getAllByRole('columnheader').some(h => h.textContent?.startsWith('Allocation'))).toBe(true);
  expect(screen.queryByTestId(tid.week.allocRow(0))).toBeNull();

  cleanup(); await signInAs('admin'); await open('TS');
  await choose('days', /^Weekly view: list\./);
  await choose('grid', /^Weekly view: grid\./);
  expect(weekLayout()).toBe('grid');
  await week();
  expect(screen.getByTestId(tid.week.allocRow(0))).toHaveTextContent('Allocation 1');
  expect(screen.queryByTestId(tid.week.day(6))).toBeNull();
});
