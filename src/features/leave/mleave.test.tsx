import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import type { LeaveConfigRecord } from '@/contract/leave';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs, snapshot } from '@/test/api-helpers';
import { LeaveSetupPage } from './LeaveSetupPage';

/* The social seed: Leave, Rota and every LV_* flag on, eight leave types,
   seven policies, four escalation stages, an SLA of 5 days, leave blocking
   the timesheet, and per-type policies for shift, casual and salaried. */
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
/* the Add dialog: the code and name are given once */
const addWithCode = async (button: string, code: string, name: string) => {
  fireEvent.click(screen.getByTestId(button));
  const modal = await screen.findByTestId(tid.modal.root);
  type(tid.mleave.addCode, code);
  type(tid.mleave.addName, name);
  fireEvent.click(within(modal).getByTestId(tid.mleave.addSave));
  await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
};
const open = () => {
  renderPage(<LeaveSetupPage />, '/setup/mleave');
  return screen.findByTestId(tid.mleave.card('types'));
};
/* a policy's own page, the ?policy=CODE drill-in */
const openPolicy = (code: string) => {
  renderPage(<LeaveSetupPage />, `/setup/mleave?policy=${code}`);
  return screen.findByTestId(tid.page('mleave'));
};
/* the PATCHes the page sends, with their If-Match and body */
const patches = () => {
  const spy = vi.spyOn(globalThis, 'fetch');
  return () => spy.mock.calls.filter(([, init]) => init?.method === 'PATCH').map(([, init]) => ({
    ifMatch: (init?.headers as Record<string, string> | undefined)?.['If-Match'], body: JSON.parse(String(init?.body)) as Record<string, unknown>,
  }));
};
afterEach(() => vi.restoreAllMocks());
const row = (i: number) => screen.getByTestId(tid.mleave.policy(i));

describe('Leave setup', () => {
  test('every card renders, the LV_* switches are shown as they stand, and full test id coverage', async () => {
    await open();
    for (const k of ['types', 'policies', 'entitlement', 'workflow', 'rota', 'leavers', 'typeLeave', 'sicknessReasons']) expect(screen.getByTestId(tid.mleave.card(k))).toBeInTheDocument();
    expect(screen.getByText('Modules · Leave · Leave setup')).toBeInTheDocument();
    for (const f of ['LV_ENT', 'LV_PRORATA', 'LV_LEAVER', 'LV_SLA', 'LV_ROTA']) {
      expect(screen.getByTestId(tid.mleave.flag(f))).toBeDisabled();
      expect(screen.getByTestId(tid.mleave.flag(f))).toHaveAttribute('aria-checked', 'true');
    }
    expect(screen.getByTestId(tid.mleave.card('rota'))).toHaveTextContent('Switched on or off under Modules & features.');
    expect(screen.getAllByTestId(/^mleave-type-\d+$/)).toHaveLength(8);
    expect(screen.getByTestId(tid.mleave.typeCount(0))).toHaveTextContent('4');
    expect(screen.getByTestId(tid.mleave.typeName(5))).toHaveValue('Unpaid leave');
    /* D3: the financial year and full-time hours are the tenant's, shown in its format, changed on Calendar */
    expect(screen.getByTestId(tid.mleave.finYear)).toHaveTextContent('01/04/2026 – 31/03/2027');
    expect(screen.getByTestId(tid.mleave.fullTimeHours)).toHaveTextContent('37.5 hours a week');
    expect(screen.getByTestId(tid.mleave.fullTimeLink)).toHaveAttribute('href', '/setup/acal');
    /* what is not built, and what went, say so plainly */
    expect(screen.getByTestId(tid.mleave.buySell)).toHaveTextContent('Buy and sell leaveNot built yet. It belongs with Payroll and Business Central.');
    expect(screen.getByTestId(tid.mleave.recordUnit)).toHaveTextContent('Leave is recorded in each policy’s unit.');
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
    expect(config()).toEqual(before);
    expect(screen.getByTestId(tid.mleave.dirty)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(tid.mleave.save));
    await expectToast('Leave setup saved. It applies across the tenant straight away.');
    expect(config()).toMatchObject({ version: before.version + 1, blocksTimesheet: false, slaDays: 3 });
    expect(config().types[3]?.name).toBe('Compassionate and bereavement leave');
    expect(setupAudits()).toHaveLength(1);
    expect(setupAudits()[0]).toMatchObject({ act: 'Leave setup saved',
      before: { blocksTimesheet: true, slaDays: 5 }, after: { blocksTimesheet: false, slaDays: 3 } });
    await waitFor(() => expect(screen.queryByTestId(tid.mleave.dirty)).toBeNull());
  });
  test('leave-type paid and evidence settings edit, and save with the rest', async () => {
    await open();
    fireEvent.click(screen.getByTestId(tid.mleave.typePaid(0)));
    fireEvent.click(screen.getByTestId(tid.mleave.typeEvidence(0)));
    await userEvent.click(screen.getByTestId(tid.mleave.save));
    await expectToast('Leave setup saved');
    expect(config().types[0]).toMatchObject({ paid: false, evidence: true });
    expect(setupAudits()).toHaveLength(1);
  });
  test('a leave type is added with its code, and removed again while unused', async () => {
    await open();
    await addWithCode(tid.mleave.typeAdd, 'STUDY', 'Study leave');
    fireEvent.click(screen.getByTestId(tid.mleave.save));
    await expectToast('Leave setup saved');
    expect(config().types[8]).toMatchObject({ code: 'STUDY', name: 'Study leave', active: false });
    await waitFor(() => expect(screen.queryByTestId(tid.mleave.dirty)).toBeNull());
    fireEvent.click(screen.getByTestId(tid.mleave.typeRemove(8)));
    fireEvent.click(screen.getByTestId(tid.mleave.save));
    await waitFor(() => expect(config().types).toHaveLength(8));
  });

  describe('leave policies', () => {
    test('the card sums each policy up: method, entitlement, carry cap, approval, SLA and what uses it', async () => {
      await open();
      const std = row(0);
      expect(std).toHaveTextContent('Standard annual leave');
      expect(within(std).getByText('STD')).toHaveClass('font-mono');
      expect(std).toHaveTextContent('A set allowance each year');
      expect(screen.getByTestId(tid.mleave.policyEnt(0))).toHaveTextContent('24 days, pro-rata, +1 day per 3 years up to 5');
      expect(std).toHaveTextContent('5 days');
      expect(std).toHaveTextContent('Needed');
      expect(std).toHaveTextContent('Tenant default (5 days)');
      /* Annual leave, and the shift and salaried employee types */
      expect(screen.getByTestId(tid.mleave.policyUsedBy(0))).toHaveTextContent('3');
      expect(screen.getByTestId(tid.mleave.policyEnt(1))).toHaveTextContent('Accrues from hours worked');
      expect(screen.getByTestId(tid.mleave.policyUsedBy(1))).toHaveTextContent('1');
      expect(screen.getByTestId(tid.mleave.policyEnt(4))).toHaveTextContent('5 days, pro-rata');
      expect(screen.getByTestId(tid.mleave.policyEnt(5))).toHaveTextContent('No balance');
      expect(row(5)).toHaveTextContent('—');
      /* no inputs in the summary */
      expect(within(std).queryByRole('textbox')).toBeNull();
      expect(screen.getByTestId(tid.mleave.card('policies'))).toHaveTextContent('A blank SLA uses the tenant default under Escalation.');
    });

    test('Add saves the new policy with its defaults at once, as one versioned write, and opens its page', async () => {
      await open();
      const sent = patches(), before = config();
      await addWithCode(tid.mleave.policyAdd, 'study', 'Study allowance');
      expect(await screen.findByTestId(tid.mleave.policyCode)).toHaveTextContent('STUDY');
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Study allowance');
      await expectToast('Study allowance added');
      expect(config().policies[7]).toEqual({ code: 'STUDY', name: 'Study allowance', method: 'fixed', unit: 'days', base: 0, prorata: true, carry: 0,
        approval: true, sla: null, serviceRules: [], bankHolidayHandling: 'not-applicable' });
      expect(sent()).toEqual([{ ifMatch: String(before.version), body: { policies: [...before.policies, config().policies[7]] } }]);
      expect(setupAudits()).toHaveLength(1);
      /* unused, so it can be removed again: Remove asks first */
      await userEvent.click(screen.getByTestId(tid.mleave.policyBack));
      await userEvent.click(await screen.findByTestId(tid.mleave.policyRemove(7)));
      expect(await screen.findByTestId(tid.modal.root)).toHaveTextContent('Remove Study allowance?');
      await userEvent.click(screen.getByTestId(tid.modal.confirm));
      await expectToast('Study allowance removed');
      expect(config().policies).toHaveLength(7);
      expect(setupAudits()).toHaveLength(2);
    });

    test('Remove of a policy in use is refused, naming what uses it, and nothing is stored', async () => {
      await open();
      const before = snapshot('leaveConfig', 'audit');
      await userEvent.click(screen.getByTestId(tid.mleave.policyRemove(0)));
      await userEvent.click(await screen.findByTestId(tid.modal.confirm));
      const warn = await screen.findByTestId(tid.mleave.policyWarn);
      expect(warn).toHaveTextContent('Standard annual leave is still used by leave types or employee types. Move them to another policy before removing this one.');
      expect(warn).toHaveTextContent('Leave types (1): Annual leave (AL)');
      expect(warn).toHaveTextContent('Employee types (2): Support Worker (shift), Service Manager (salaried)');
      expect(snapshot('leaveConfig', 'audit')).toEqual(before);
      expect(row(0)).toBeInTheDocument();
    });

    test('while the page has unsaved changes, the policy actions wait', async () => {
      await open();
      await userEvent.click(screen.getByTestId(tid.mleave.toggle('blocksTimesheet')));
      expect(screen.getByTestId(tid.mleave.policyLocked)).toHaveTextContent('Save or cancel the changes on this page');
      for (const id of [tid.mleave.policyEdit(0), tid.mleave.policyRemove(0), tid.mleave.policyAdd]) expect(screen.getByTestId(id)).toBeDisabled();
    });

    test('the policy page: every card, the read-only code, and full test id coverage', async () => {
      await openPolicy('STD');
      expect(await screen.findByTestId(tid.mleave.policyCode)).toHaveTextContent('STD');
      expect(screen.getByText('Modules · Leave · Leave setup · Standard annual leave')).toBeInTheDocument();
      for (const k of ['policy-details', 'policy-entitlement', 'policy-approval', 'policy-bank-holidays']) expect(screen.getByTestId(tid.mleave.card(k))).toBeInTheDocument();
      expect(screen.getByTestId(tid.mleave.card('policy-details'))).toHaveTextContent('The code cannot be changed after the policy is created.');
      expect(screen.getByTestId(tid.mleave.card('policy-approval'))).toHaveTextContent('use the tenant default, 5 days');
      expect(screen.getByTestId(tid.mleave.policyName(0))).toHaveValue('Standard annual leave');
      expect(screen.getByTestId(tid.mleave.policyMethod(0))).toHaveDisplayValue('A set allowance each year');
      expect(screen.getByTestId(tid.mleave.serviceRule(0, 0, 'afterYears'))).toHaveValue(3);
      expect(screen.getByTestId(tid.mleave.policyBack)).toHaveAttribute('href', '/setup/mleave');
      expect(screen.queryByTestId(tid.mleave.card('types'))).toBeNull();
      expect(screen.getByTestId(tid.mleave.policySave)).toBeDisabled();
      expectTestIdCoverage(document.body);
    });

    test('Edit opens the page; Save sends one PATCH of the policies with If-Match, stays, and the summary shows the new values', async () => {
      await open();
      await userEvent.click(screen.getByTestId(tid.mleave.policyEdit(0)));
      await screen.findByTestId(tid.mleave.policyCode);
      const sent = patches(), before = config();
      type(tid.mleave.policyName(0), 'Annual leave policy');
      type(tid.mleave.policyNum(0, 'base'), '26');
      type(tid.mleave.serviceRule(0, 0, 'add'), '2');
      type(tid.mleave.policyNum(0, 'sla'), '3');
      type(tid.mleave.policyBh(0), 'included');
      fireEvent.click(screen.getByTestId(tid.mleave.policyApproval(0)));
      expect(config()).toEqual(before);
      expect(screen.getByTestId(tid.mleave.policyDirty)).toBeInTheDocument();
      await userEvent.click(screen.getByTestId(tid.mleave.policySave));
      await expectToast('Annual leave policy saved. It applies across the tenant straight away.');
      const saved = { ...before.policies[0], name: 'Annual leave policy', base: 26, sla: 3, approval: false, bankHolidayHandling: 'included',
        serviceRules: [{ afterYears: 3, add: 2, cap: 5 }] };
      expect(config().policies[0]).toEqual(saved);
      expect(config().policies.slice(1)).toEqual(before.policies.slice(1));
      expect(sent()).toEqual([{ ifMatch: String(before.version), body: { policies: [saved, ...before.policies.slice(1)] } }]);
      expect(setupAudits()).toHaveLength(1);
      expect(setupAudits()[0]).toMatchObject({ act: 'Leave setup saved', before: { policies: before.policies }, after: { policies: config().policies } });
      /* it stays on the page, with nothing left to save */
      await waitFor(() => expect(screen.queryByTestId(tid.mleave.policyDirty)).toBeNull());
      expect(screen.getByTestId(tid.mleave.policyName(0))).toHaveValue('Annual leave policy');
      await userEvent.click(screen.getByTestId(tid.mleave.policyBack));
      await screen.findByTestId(tid.mleave.card('types'));
      expect(row(0)).toHaveTextContent('Annual leave policy');
      expect(screen.getByTestId(tid.mleave.policyEnt(0))).toHaveTextContent('26 days, pro-rata, +2 days per 3 years up to 5');
      expect(row(0)).toHaveTextContent('Automatic');
      expect(row(0)).toHaveTextContent('3 days');
      expectTestIdCoverage(document.body);
    });

    test('a refusal on the page names its field, and nothing is stored', async () => {
      await openPolicy('FIX');
      await screen.findByTestId(tid.mleave.policyCode);
      const before = snapshot('leaveConfig', 'audit');
      type(tid.mleave.policyName(4), ' ');
      await userEvent.click(screen.getByTestId(tid.mleave.policySave));
      expect(await screen.findByTestId(tid.mleave.policyWarn)).toHaveTextContent('Every policy needs a name.');
      expect(screen.getByTestId(tid.mleave.policyName(4))).toHaveAttribute('aria-invalid', 'true');
      expect(snapshot('leaveConfig', 'audit')).toEqual(before);
    });

    test('a method that keeps no balance hides the entitlement fields and says why; accrual keeps only the carry cap', async () => {
      await openPolicy('STD');
      await screen.findByTestId(tid.mleave.policyCode);
      expect(screen.getByTestId(tid.mleave.policyNum(0, 'base'))).toBeInTheDocument();
      type(tid.mleave.policyMethod(0), 'none');
      expect(screen.getByTestId(tid.mleave.policyNoBalance)).toHaveTextContent('This method keeps no balance, so there is no allowance, pro-rata, service rule or carry-over to set.');
      for (const id of [tid.mleave.policyNum(0, 'base'), tid.mleave.policyUnit(0), tid.mleave.policyProrata(0), tid.mleave.policyNum(0, 'carry'), tid.mleave.serviceRuleAdd(0)])
        expect(screen.queryByTestId(id)).toBeNull();
      type(tid.mleave.policyMethod(0), 'accrual');
      expect(screen.getByTestId(tid.mleave.card('policy-entitlement'))).toHaveTextContent('no base allowance, pro-rata or service rule');
      expect(screen.queryByTestId(tid.mleave.policyNum(0, 'base'))).toBeNull();
      expect(screen.getByTestId(tid.mleave.policyNum(0, 'carry'))).toBeInTheDocument();
    });

    test('leaving the page with unsaved changes asks first', async () => {
      await openPolicy('STD');
      await screen.findByTestId(tid.mleave.policyCode);
      type(tid.mleave.policyName(0), 'Changed');
      await userEvent.click(screen.getByTestId(tid.mleave.policyBack));
      expect(await screen.findByTestId(tid.modal.root)).toHaveTextContent('Discard your changes?');
      await userEvent.click(screen.getByTestId(tid.modal.confirm));
      await screen.findByTestId(tid.mleave.card('types'));
      expect(row(0)).toHaveTextContent('Standard annual leave');
    });

    test('an unknown code shows a plain empty state with the way back', async () => {
      await openPolicy('GONE');
      expect(await screen.findByTestId(tid.mleave.policyMissing)).toHaveTextContent('There is no leave policy with the code GONE.');
      expect(screen.getByTestId(tid.mleave.policyBack)).toHaveAttribute('href', '/setup/mleave');
      expectTestIdCoverage(document.body);
    });
  });
  test('a code is given once when adding: an existing or malformed code cannot be added, and it is read-only after', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.mleave.typeAdd));
    const modal = await screen.findByTestId(tid.modal.root);
    type(tid.mleave.addName, 'Another annual leave');
    type(tid.mleave.addCode, 'al');
    expect(modal).toHaveTextContent('AL already exists.');
    expect(within(modal).getByTestId(tid.mleave.addSave)).toBeDisabled();
    type(tid.mleave.addCode, '1X');
    expect(modal).toHaveTextContent('A code starts with a capital letter');
    await userEvent.click(within(modal).getByTestId(tid.mleave.addCancel));
    await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
    expect(screen.getAllByTestId(/^mleave-type-\d+$/)).toHaveLength(8);
    /* a saved code is text, not an input */
    expect(within(screen.getByTestId(tid.mleave.type(0))).getByText('AL').tagName).toBe('TD');
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
    await userEvent.click(screen.getByTestId(tid.mleave.toggle('blocksTimesheet')));
    await userEvent.click(screen.getByTestId(tid.mleave.save));
    expect(await screen.findByTestId(tid.toast.error)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId(tid.mleave.num('slaDays'))).toHaveValue(9));
    expect(screen.getByTestId(tid.mleave.toggle('blocksTimesheet'))).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByTestId(tid.mleave.toggle('blocksTimesheet')));
    await userEvent.click(screen.getByTestId(tid.mleave.save));
    await expectToast('Leave setup saved');
    expect(config()).toMatchObject({ version: c.version + 2, slaDays: 9, blocksTimesheet: false });
  });

  test('Cancel discards added types, removed stages and edits, and nothing is stored', async () => {
    await open();
    const before = snapshot('leaveConfig', 'audit');
    await userEvent.click(screen.getByTestId(tid.mleave.stageRemove(3)));
    await expectToast('Stage removed');
    await userEvent.click(screen.getByTestId(tid.mleave.stageAdd));
    await addWithCode(tid.mleave.typeAdd, 'STUDY', 'Study leave');
    await expectToast('Leave type added. Pick its policy.');
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
    expect(screen.getByTestId(tid.mleave.tlNote)).toHaveTextContent('Policy: Accrues from hours worked · pro-rata off · 0 days carry-over.');
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
