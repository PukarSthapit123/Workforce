import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import type { LeaveConfigRecord } from '@/contract/leave';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs, snapshot } from '@/test/api-helpers';
import { LeaveSetupPage } from './LeaveSetupPage';

/* The social seed: Leave, Rota and every LV_* flag on, eight leave types,
   seven policies, four workflow stages, an SLA of 5 days, leave blocking the
   timesheet, and per-type policies for shift, casual (accrual, hours) and
   salaried. CP-1288 is leaving on 30/09/2026. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });
const config = () => {
  const c = store.coll<LeaveConfigRecord>('leaveConfig').leaveConfig;
  if (!c) throw new Error('no leave config');
  return c;
};
const setupAudits = () => audits().filter(a => a.entity === 'leaveConfig');
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const open = () => {
  renderPage(<LeaveSetupPage />, '/setup/mleave');
  return screen.findByTestId(tid.mleave.card('types'));
};

describe('Leave setup', () => {
  test('every card renders, the LV_* switches are shown as they stand, and full test id coverage', async () => {
    await open();
    for (const k of ['types', 'policies', 'entitlement', 'workflow', 'rota', 'leavers', 'typeLeave']) expect(screen.getByTestId(tid.mleave.card(k))).toBeInTheDocument();
    expect(screen.getByText('Modules · Leave · Leave setup')).toBeInTheDocument();
    for (const f of ['LV_ENT', 'LV_PRORATA', 'LV_LEAVER', 'LV_SLA', 'LV_ROTA']) {
      expect(screen.getByTestId(tid.mleave.flag(f))).toBeDisabled();
      expect(screen.getByTestId(tid.mleave.flag(f))).toHaveAttribute('aria-checked', 'true');
    }
    expect(screen.getByTestId(tid.mleave.card('rota'))).toHaveTextContent('Switched on or off under Modules & features.');
    expect(screen.getAllByTestId(/^mleave-type-\d+$/)).toHaveLength(8);
    expect(screen.getByTestId(tid.mleave.typeCount(0))).toHaveTextContent('4');
    expect(screen.getByTestId(tid.mleave.type(5))).toHaveTextContent('Unpaid');
    expect(screen.getAllByTestId(/^mleave-policy-\d+$/)).toHaveLength(7);
    expect(screen.getAllByTestId(/^mleave-stage-\d+$/)).toHaveLength(4);
    /* the employee and line manager stages cannot be removed */
    expect(screen.queryByTestId(tid.mleave.stageRemove(1))).toBeNull();
    expect(screen.getByTestId(tid.mleave.stageRemove(2))).toBeInTheDocument();
    expect(screen.getByTestId(tid.mleave.num('toilMax'))).toBeInTheDocument();
    expect(screen.getByTestId(tid.mleave.leaver('CP-1288'))).toHaveTextContent('30/09/2026');
    expect(screen.getByTestId(tid.mleave.card('leavers'))).toHaveTextContent(/payroll/i);
    expect(screen.queryByTestId(tid.mleave.rotaOff)).toBeNull();
    expect(screen.getByTestId(tid.mleave.save)).toBeDisabled();
    expectTestIdCoverage(document.body);
  });

  test('changes apply only on Save: one request, one audit row with the before and after', async () => {
    await open();
    const before = config();
    await userEvent.click(screen.getByTestId(tid.mleave.toggle('blocksTimesheet')));
    type(tid.mleave.num('slaDays'), '3');
    type(tid.mleave.typeName(3), 'Compassionate and bereavement leave');
    type(tid.mleave.policyNum(0, 'carry'), '8');
    expect(config()).toEqual(before);
    expect(screen.getByTestId(tid.mleave.dirty)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(tid.mleave.save));
    await expectToast('Leave setup saved. It applies across the tenant straight away.');
    expect(config()).toMatchObject({ version: before.version + 1, blocksTimesheet: false, slaDays: 3 });
    expect(config().types[3]?.name).toBe('Compassionate and bereavement leave');
    expect(config().policies[0]?.carry).toBe(8);
    expect(setupAudits()).toHaveLength(1);
    expect(setupAudits()[0]).toMatchObject({ act: 'Leave setup saved',
      before: { blocksTimesheet: true, slaDays: 5 }, after: { blocksTimesheet: false, slaDays: 3 } });
    await waitFor(() => expect(screen.queryByTestId(tid.mleave.dirty)).toBeNull());
  });

  test('a refusal names its field, inline, and nothing is stored', async () => {
    await open();
    const before = snapshot('leaveConfig', 'audit');
    type(tid.mleave.num('slaDays'), '0');
    await userEvent.click(screen.getByTestId(tid.mleave.save));
    expect(await screen.findByTestId(tid.mleave.warn)).toHaveTextContent('The approval SLA is a whole number of days from 1 to 60.');
    expect(screen.getByTestId(tid.mleave.num('slaDays'))).toHaveAttribute('aria-invalid', 'true');
    expect(snapshot('leaveConfig', 'audit')).toEqual(before);
  });

  test('a refusal about one leave type marks that row', async () => {
    await open();
    type(tid.mleave.typeName(1), ' ');
    await userEvent.click(screen.getByTestId(tid.mleave.save));
    expect(await screen.findByTestId(tid.mleave.warn)).toHaveTextContent('Leave type TOIL needs a name.');
    expect(screen.getByTestId(tid.mleave.typeName(1))).toHaveAttribute('aria-invalid', 'true');
  });

  test('after someone else saves, a 412 starts the draft again from their version and the next save goes through', async () => {
    await open();
    const c = config();
    store.coll<LeaveConfigRecord>('leaveConfig').leaveConfig = { ...c, version: c.version + 1, slaDays: 9 };
    store.save();
    await userEvent.click(screen.getByTestId(tid.mleave.toggle('buySell')));
    await userEvent.click(screen.getByTestId(tid.mleave.save));
    expect(await screen.findByTestId(tid.toast.error)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId(tid.mleave.num('slaDays'))).toHaveValue(9));
    expect(screen.getByTestId(tid.mleave.toggle('buySell'))).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(screen.getByTestId(tid.mleave.toggle('buySell')));
    await userEvent.click(screen.getByTestId(tid.mleave.save));
    await expectToast('Leave setup saved');
    expect(config()).toMatchObject({ version: c.version + 2, slaDays: 9, buySell: true });
  });

  test('Cancel discards added types, removed stages and edits, and nothing is stored', async () => {
    await open();
    const before = snapshot('leaveConfig', 'audit');
    await userEvent.click(screen.getByTestId(tid.mleave.stageRemove(3)));
    await expectToast('Stage removed');
    await userEvent.click(screen.getByTestId(tid.mleave.stageAdd));
    await userEvent.click(screen.getByTestId(tid.mleave.typeAdd));
    await expectToast('Leave type added. Name it and pick its policy.');
    expect(screen.getAllByTestId(/^mleave-type-\d+$/)).toHaveLength(9);
    expect(screen.getByTestId(tid.mleave.typeActive(8))).toHaveAttribute('aria-checked', 'false');
    type(tid.mleave.stageWho(0), 'Colleague');
    await userEvent.click(screen.getByTestId(tid.mleave.cancel));
    expect(screen.getAllByTestId(/^mleave-stage-\d+$/)).toHaveLength(4);
    expect(screen.getAllByTestId(/^mleave-type-\d+$/)).toHaveLength(8);
    expect(screen.getByTestId(tid.mleave.stageWho(0))).toHaveValue('Employee');
    expect(screen.queryByTestId(tid.mleave.dirty)).toBeNull();
    expect(snapshot('leaveConfig', 'audit')).toEqual(before);
  });

  test('the per-type leave policy merges by employee type code, and a refusal about a type opens it', async () => {
    await open();
    const before = config();
    await userEvent.click(screen.getByTestId(tid.mleave.empType('casual')));
    expect(screen.getByTestId(tid.mleave.tlPolicy)).toHaveValue('ACC');
    expect(screen.getByTestId(tid.mleave.tlNote)).toHaveTextContent('Policy: 12.07% of hours worked');
    type(tid.mleave.tlPolicy, 'STD');
    type(tid.mleave.tlUnit, 'days');
    await userEvent.click(screen.getByTestId(tid.mleave.save));
    await expectToast('Leave setup saved');
    expect(Object.keys(config().typeLeave)).toEqual(['shift', 'casual', 'salaried']);
    expect(config().typeLeave).toMatchObject({ casual: { policy: 'STD', unit: 'days' }, shift: before.typeLeave.shift });
    expect(setupAudits()[0]).toMatchObject({ before: { typeLeave: { casual: { policy: 'ACC', unit: 'hours' } } },
      after: { typeLeave: { casual: { policy: 'STD', unit: 'days' } } } });

    /* a value the list does not hold is refused by the server, which names the type */
    await waitFor(() => expect(screen.queryByTestId(tid.mleave.dirty)).toBeNull());
    await userEvent.click(screen.getByTestId(tid.mleave.empType('salaried')));
    type(tid.mleave.tlPolicy, 'GONE');
    await userEvent.click(screen.getByTestId(tid.mleave.empType('shift')));
    await userEvent.click(screen.getByTestId(tid.mleave.save));
    expect(await screen.findByTestId(tid.mleave.warn)).toHaveTextContent('The leave policy for salaried does not exist.');
    await waitFor(() => expect(screen.getByTestId(tid.mleave.empType('salaried'))).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId(tid.mleave.tlPolicy)).toHaveAttribute('aria-invalid', 'true');
  });

  test('with Leave off the page says so and offers nothing else', async () => {
    const t = store.coll<{ modules: Record<string, boolean> }>('tenant').tenant;
    if (!t) throw new Error('no tenant');
    t.modules.L = false;
    store.save();
    renderPage(<LeaveSetupPage />, '/setup/mleave');
    expect(await screen.findByTestId(tid.mleave.off)).toHaveTextContent('The Leave module is off for this tenant. Turn it on under Modules & features.');
    expect(screen.queryByTestId(tid.mleave.card('types'))).toBeNull();
  });

  test('on qnipay, with Rota off, Leave and Rota says approved leave reaches no rota', async () => {
    resetTo('qnipay');
    await signInAs('admin');
    await open();
    expect(screen.getByTestId(tid.mleave.rotaOff)).toHaveTextContent('The Rota module is off for this tenant');
    expect(screen.getByTestId(tid.mleave.flag('LV_ROTA'))).toHaveAttribute('aria-checked', 'false');
  });
});
