import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { tid } from '@/testids';
import { store } from '@/mocks/store';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { PayCodesPage } from './PayCodesPage';

/* social at the frozen clock, as the administrator (mod_cfg and master_data).
   STD is claimed by the hourly types and recorded on timesheet days; OT20
   nothing uses. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });

const toasts = () => screen.queryAllByTestId(tid.toast.info).map(t => t.textContent ?? '').join(' | ');
const open = async () => {
  renderPage(<PayCodesPage />, '/setup/mpay');
  await screen.findByTestId(tid.mpay.table);
};
const warn = async () => (await screen.findByTestId(tid.mpay.warn)).textContent ?? '';
const fill = async (user: ReturnType<typeof userEvent.setup>, id: string, text: string) => {
  const el = screen.getByTestId(id);
  await user.clear(el);
  if (text) await user.type(el, text);
};

describe('Pay codes', () => {
  test('the base codes, then the allowance codes marked read only, with their basis, value, element and claimants, and no money', async () => {
    await open();
    expect(screen.getByTestId(tid.mpay.row('OT-SAT'))).toHaveTextContent('Overtime: Saturday');
    expect(screen.getByTestId(tid.mpay.workType('OT-SAT'))).toHaveTextContent('Yes');
    expect(screen.getByTestId(tid.mpay.value('OT15'))).toHaveTextContent('1.5 ×');
    expect(screen.getByTestId(tid.mpay.claimed('STD'))).toHaveTextContent('Support Worker, Relief / Bank Worker');
    expect(screen.getByTestId(tid.mpay.claimed('OT20'))).toHaveTextContent('No type yet');
    expect(screen.getByTestId(tid.mpay.row('UNSOC'))).toHaveTextContent('The amount is set in Business Central.');
    expect(screen.getByTestId(tid.mpay.edit('STD'))).toBeInTheDocument();
    expect(screen.getByTestId(tid.mpay.readOnly('SLEEP_IN'))).toHaveTextContent('Allowance, read only here');
    expect(within(screen.getByTestId(tid.mpay.row('SLEEP_IN'))).queryByRole('button', { name: 'Edit' })).toBeNull();
    expect(screen.getByTestId(tid.mpay.footer)).toHaveTextContent('No monetary value is set anywhere in this platform.');
    expect(screen.getByTestId(tid.page('mpay')).textContent).not.toMatch(/[£$€]/);
    expectTestIdCoverage(document.body);
  });

  test('create: each refusal is shown in the dialog, then a valid code is created, toasted with where it is available, and listed', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByTestId(tid.mpay.add));
    expect(screen.getByTestId(tid.mpay.money)).toHaveTextContent('Business Central owns what the code is worth. Nothing here sets a monetary value.');
    expectTestIdCoverage(document.body);
    await user.click(screen.getByTestId(tid.mpay.save));
    expect(await warn()).toBe('A code is required.');
    await fill(user, tid.mpay.code, 'x');
    await user.click(screen.getByTestId(tid.mpay.save));
    await waitFor(async () => expect(await warn()).toMatch(/2 to 12 characters/));
    await fill(user, tid.mpay.code, 'STD');
    await fill(user, tid.mpay.label, 'Overtime bank holiday');
    await fill(user, tid.mpay.element, 'PE-NEW');
    await user.click(screen.getByTestId(tid.mpay.save));
    await waitFor(async () => expect(await warn()).toBe('STD already exists. Codes must be unique because Business Central matches on them.'));
    await fill(user, tid.mpay.code, 'OT-BH');
    await fill(user, tid.mpay.element, 'PE-STD');
    await user.click(screen.getByTestId(tid.mpay.save));
    await waitFor(async () => expect(await warn()).toBe('PE-STD is already mapped to STD. One element, one code.'));
    await fill(user, tid.mpay.element, 'PE-OTBH');
    await user.click(screen.getByTestId(tid.mpay.save));
    await waitFor(async () => expect(await warn()).toBe('A value is required for a multiplier on base rate.'));
    expect(audits().filter(a => a.entity === 'payCode')).toEqual([]);

    await fill(user, tid.mpay.valueInput, '2');
    await user.click(screen.getByTestId(tid.mpay.wt));
    await user.click(screen.getByTestId(tid.mpay.save));
    await waitFor(() => expect(toasts()).toContain('OT-BH created · Overtime bank holiday · available now as a rate type on timesheets'));
    expect(await screen.findByTestId(tid.mpay.row('OT-BH'))).toHaveTextContent('Overtime bank holiday');
    expect(screen.getByTestId(tid.mpay.workType('OT-BH'))).toHaveTextContent('Yes');
    expect(audits().find(a => a.act === 'Pay code created')?.after).toMatchObject({ basis: 'multiplier', element: 'PE-OTBH' });
  }, 30_000);

  test('a flat code has no value: the field is off and says the amount is set in Business Central', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByTestId(tid.mpay.add));
    await user.selectOptions(screen.getByTestId(tid.mpay.basis), 'flat');
    expect(screen.getByTestId(tid.mpay.valueInput)).toBeDisabled();
    expect(screen.getByTestId(tid.field.root(tid.mpay.valueInput))).toHaveTextContent('The amount is set in Business Central.');
  });

  test('edit: the code is locked and says why, and the toast counts the fields changed', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByTestId(tid.mpay.edit('OT20')));
    expect(screen.getByTestId(tid.mpay.code)).toBeDisabled();
    expect(screen.getByTestId(tid.field.root(tid.mpay.code))).toHaveTextContent('Codes cannot change. Postings already reference them.');
    expect(screen.getByTestId(tid.modal.root)).toHaveTextContent('Not in use');
    await fill(user, tid.mpay.valueInput, '2.5');
    await user.click(screen.getByTestId(tid.mpay.wt));
    await user.click(screen.getByTestId(tid.mpay.save));
    await waitFor(() => expect(toasts()).toContain('OT20 updated · 2 field(s) changed'));
    await waitFor(() => expect(screen.getByTestId(tid.mpay.value('OT20'))).toHaveTextContent('2.5 ×'));
  });

  test('remove: a code in use is refused naming what uses it; an unused code is removed and gone', async () => {
    const user = userEvent.setup();
    await open();
    await user.click(screen.getByTestId(tid.mpay.edit('STD')));
    expect(screen.getByTestId(tid.mpay.inUse)).toHaveTextContent(/In use by 2 employee types and \d+ timesheet days/);
    await user.click(screen.getByTestId(tid.mpay.remove));
    expect(await warn()).toMatch(/^STD is used by 2 employee types and \d+ timesheet days\. Remove those references first\./);
    expect(store.coll('payCodes').pc_STD).toBeDefined();
    await user.click(screen.getByTestId(tid.mpay.cancel));

    await user.click(screen.getByTestId(tid.mpay.edit('OT20')));
    await user.click(screen.getByTestId(tid.mpay.remove));
    await waitFor(() => expect(toasts()).toContain('Overtime 2× removed'));
    await waitFor(() => expect(screen.queryByTestId(tid.mpay.row('OT20'))).toBeNull());
  });
});
