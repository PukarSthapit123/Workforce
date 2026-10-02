import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import type { TimesheetConfig } from '@/contract/timesheets';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs, snapshot } from '@/test/api-helpers';
import { TimesheetSetupPage } from './TimesheetSetupPage';

/* The qnipay seed: two employee types, Consultant (hourly, weekly grid, the
   first in the picker) and Project Manager (salaried, paid per day). The
   review threshold is 10 and the daily maximum 16. */
withFakeServer();
beforeEach(async () => { resetTo('qnipay'); await signInAs('admin'); });
const config = () => {
  const c = store.coll<TimesheetConfig>('timesheetConfig').timesheetConfig;
  if (!c) throw new Error('no timesheet config');
  return c;
};
const setupAudits = () => audits().filter(a => a.entity === 'timesheetConfig');
const open = async () => {
  renderPage(<TimesheetSetupPage />);
  return screen.findByTestId(tid.mts.card('fields'));
};
const choose = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });

test('the page shows every card, with full test id coverage, and a day-rate type has no overtime inputs', async () => {
  await open();
  for (const k of ['fields', 'rules', 'allowances', 'boundary']) expect(screen.getByTestId(tid.mts.card(k))).toBeInTheDocument();
  expect(screen.getByText('Modules · Timesheet · Timesheet setup')).toBeInTheDocument();
  expect(screen.getByTestId(tid.mts.ot('threshold'))).toHaveValue(40);
  expect(screen.getByTestId(tid.mts.save)).toBeDisabled();
  expectTestIdCoverage(document.body);
  await userEvent.click(screen.getByTestId(tid.mts.type('salaried')));
  expect(screen.getByTestId(tid.mts.otDay)).toHaveTextContent('Project Manager is paid per worked day');
  expect(screen.getByTestId(tid.mts.fieldType('salaried'))).toHaveAttribute('aria-pressed', 'true');
  expectTestIdCoverage(document.body);
});

test('changes apply only on Save: one request, one audit row, and the draft starts again from what was saved', async () => {
  await open();
  const before = config();
  choose(tid.mts.rule('maxDaily'), '14');
  await userEvent.click(screen.getByTestId(tid.mts.fieldMand('notes')));
  expect(config()).toEqual(before);
  expect(screen.getByTestId(tid.mts.dirty)).toBeInTheDocument();
  await userEvent.click(screen.getByTestId(tid.mts.save));
  expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Timesheet setup saved. It applies to the next save or submission.');
  expect(config()).toMatchObject({ version: before.version + 1, rules: { maxDaily: 14 } });
  expect(config().types.hourly?.fields.notes).toEqual({ vis: true, mand: true });
  expect(setupAudits()).toHaveLength(1);
  await waitFor(() => expect(screen.queryByTestId(tid.mts.dirty)).toBeNull());
});

test('a refusal names its field: the threshold above the maximum is refused inline and nothing is stored', async () => {
  await open();
  const before = snapshot('timesheetConfig', 'audit');
  choose(tid.mts.rule('maxDaily'), '12');
  choose(tid.mts.rule('warnDaily'), '14');
  await userEvent.click(screen.getByTestId(tid.mts.save));
  const msg = 'The review threshold must be more than 0 and no higher than the daily maximum.';
  expect(await screen.findByTestId(tid.mts.warn)).toHaveTextContent(msg);
  expect(screen.getByTestId(tid.mts.rule('warnDaily'))).toHaveAttribute('aria-invalid', 'true');
  expect(snapshot('timesheetConfig', 'audit')).toEqual(before);
});

test('a pay rule value with a currency is refused on that rule, on its own type (D11)', async () => {
  await open();
  fireEvent.change(screen.getByTestId(tid.mts.payValue(0)), { target: { value: '£5' } });
  await userEvent.click(screen.getByTestId(tid.mts.type('salaried')));
  await userEvent.click(screen.getByTestId(tid.mts.save));
  expect(await screen.findByTestId(tid.mts.warn)).toHaveTextContent('never an amount');
  expect(await screen.findByTestId(tid.mts.payValue(0))).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByTestId(tid.mts.type('hourly'))).toHaveAttribute('aria-pressed', 'true');
  expect(config().types.hourly?.rules[0]?.value).toBe('1×');
});

test('after someone else saves, a 412 starts the draft again from their version and the next save goes through', async () => {
  await open();
  const c = config();
  store.coll<TimesheetConfig>('timesheetConfig').timesheetConfig = { ...c, version: c.version + 1, rules: { ...c.rules, maxDaily: 18 } };
  store.save();
  await userEvent.click(screen.getByTestId(tid.mts.rule('enforceRest')));
  await userEvent.click(screen.getByTestId(tid.mts.save));
  expect(await screen.findByTestId(tid.toast.error)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByTestId(tid.mts.rule('maxDaily'))).toHaveValue('18'));
  expect(screen.getByTestId(tid.mts.rule('enforceRest'))).toHaveAttribute('aria-checked', 'false');
  await userEvent.click(screen.getByTestId(tid.mts.rule('enforceRest')));
  await userEvent.click(screen.getByTestId(tid.mts.save));
  expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Timesheet setup saved');
  expect(config()).toMatchObject({ version: c.version + 2, rules: { maxDaily: 18, enforceRest: true } });
});

test('Cancel discards the draft and stores nothing', async () => {
  await open();
  const before = snapshot('timesheetConfig', 'audit');
  choose(tid.mts.rule('varianceWarn'), '4');
  await userEvent.click(screen.getByTestId(tid.mts.fieldVis('notes')));
  await userEvent.click(screen.getByTestId(tid.mts.cancel));
  expect(screen.getByTestId(tid.mts.rule('varianceWarn'))).toHaveValue('2');
  expect(screen.getByTestId(tid.mts.fieldVis('notes'))).toHaveAttribute('aria-checked', 'true');
  expect(screen.queryByTestId(tid.mts.dirty)).toBeNull();
  expect(screen.getByTestId(tid.mts.save)).toBeDisabled();
  expect(snapshot('timesheetConfig', 'audit')).toEqual(before);
});

test('an allowance with a code that exists is refused; a new one joins the type on Save, with no amount', async () => {
  await open();
  await userEvent.click(screen.getByTestId(tid.mts.allowAdd));
  await userEvent.type(await screen.findByTestId(tid.mts.allowName), 'Late finish');
  await userEvent.click(screen.getByTestId(tid.mts.allowConfirm));
  expect(await screen.findByText('An allowance with that code already exists.')).toBeInTheDocument();
  await userEvent.clear(screen.getByTestId(tid.mts.allowName));
  await userEvent.type(screen.getByTestId(tid.mts.allowName), 'Waking watch');
  await userEvent.click(screen.getByTestId(tid.mts.allowConfirm));
  expect(await screen.findByTestId(tid.mts.allowRow('WAKING_WATCH'))).toBeInTheDocument();
  expect(screen.getByTestId(tid.mts.allowOn('WAKING_WATCH'))).toHaveAttribute('aria-checked', 'true');
  await userEvent.click(screen.getByTestId(tid.mts.save));
  await screen.findByText('Timesheet setup saved. It applies to the next save or submission.');
  expect(config().allowances.WAKING_WATCH).toEqual({ code: 'WAKING_WATCH', label: 'Waking watch', payCode: 'WAKING_WATCH', tier: 'core' });
  expect(config().types.hourly?.allowances).toContain('WAKING_WATCH');
});
