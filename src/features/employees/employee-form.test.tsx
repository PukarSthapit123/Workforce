import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { nextEmployeeCode } from '@/domain/codes';
import { todayIso } from '@/lib/format';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, fault, employeeOf, resetTo, signInAs, snapshot } from '@/test/api-helpers';
import { AdminEmployeesPage } from './AdminEmployeesPage';
import { TeamEmployeesPage } from './TeamEmployeesPage';

withFakeServer();
beforeEach(() => resetTo('social'));
const f = (name: string) => screen.getByTestId(tid.employeeForm.field(name));
/* a change event, not keystrokes: the form re-renders per key, and typing a whole address in jsdom is slow */
const type = (name: string, value: string) => { fireEvent.change(f(name), { target: { value } }); };
const pick = async (name: string, value: string) => {
  await userEvent.click(f(name));
  await userEvent.click(await screen.findByTestId(`${tid.employeeForm.field(name)}-option-${value}`));
};
const save = () => userEvent.click(screen.getByTestId(tid.employeeForm.save));
const nextCode = () => nextEmployeeCode(Object.values(store.coll<{ code: string }>('employees')).map(p => p.code));
const openAdd = async () => {
  renderPage(<AdminEmployeesPage />);
  await userEvent.click(await screen.findByTestId(tid.employees.add));
  await screen.findByTestId(tid.employeeForm.root);
};
const openEdit = async (Page: () => React.JSX.Element, code = 'CP-1042') => {
  renderPage(<Page />);
  await userEvent.click(await screen.findByTestId(tid.employees.edit(code)));
  await screen.findByTestId(tid.employeeForm.root);
};

describe('adding someone, as an admin', () => {
  beforeEach(async () => { await signInAs('admin'); });
  test('CR The form opens with an identity section, groups employment, contract and access, and has full test id coverage', async () => {
    await openAdd();
    const form = screen.getByTestId(tid.employeeForm.root);
    expect(within(form).getAllByRole('heading').map(h => h.textContent)).toEqual(['Identity', 'Employment', 'Contract', 'Access']);
    expectTestIdCoverage(document.body);
  });
  test('CR It proposes the next free employee ID, in the tenant’s own scheme', async () => {
    await openAdd();
    expect(f('code')).toHaveValue(nextCode());
  });
  test('a new employee starts today unless the date is changed, as the prototype’s form did', async () => {
    await openAdd();
    expect(f('start')).toHaveValue(todayIso());
  });
  test('CR It uses the design system field pattern', async () => {
    await openAdd();
    expect(screen.getByTestId(tid.employeeForm.root).querySelectorAll('label').length).toBeGreaterThan(6);
    expect(screen.getByTestId(tid.employeeForm.field('name-field'))).toHaveTextContent('required');
  });
  test('CR A name is required, and nothing is written', async () => {
    await openAdd();
    const before = snapshot('employees', 'audit');
    await save();
    expect(await screen.findByTestId(tid.employeeForm.warn)).toHaveTextContent('A full name is required.');
    expect(snapshot('employees', 'audit')).toEqual(before);
  });
  test('CR A duplicate employee ID is refused, because payroll maps on it', async () => {
    await openAdd();
    await type('name', 'Test Employee'); await type('email', 'test.employee@brightpath.org');
    await type('code', 'CP-1042');
    await save();
    expect(await screen.findByTestId(tid.employeeForm.warn)).toHaveTextContent('CP-1042 is already in use');
  });
  test('CR Contracted hours are bounded, and cannot exceed the maximum', async () => {
    await openAdd();
    await type('name', 'Test Employee'); await type('email', 'test.employee@brightpath.org');
    await type('contractedHours', '90'); await save();
    expect(await screen.findByTestId(tid.employeeForm.warn)).toHaveTextContent('between 0 and 80');
    await type('contractedHours', '50'); await type('maxHours', '40'); await save();
    expect(await screen.findByTestId(tid.employeeForm.warn)).toHaveTextContent('cannot exceed the maximum');
  });
  test('CR A valid record is created, and says what it can do straight away', async () => {
    await openAdd();
    await type('name', 'Test Employee'); await type('email', 'test.employee@brightpath.org');
    await pick('location', 'WH'); await pick('state', 'active');
    await save();
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Test Employee created');
    expect(screen.getByTestId(tid.toast.next)).toHaveTextContent('They count as working from today.');
    const created = Object.values(store.coll<{ name: string; location: string; state: string }>('employees')).find(p => p.name === 'Test Employee');
    expect(created).toMatchObject({ location: 'WH', state: 'active' });
    expect(audits().at(-1)?.act).toBe('Employee created');
  });
});

describe('editing someone', () => {
  test('CR The employee ID cannot be changed once it exists', async () => {
    await signInAs('admin');
    await openEdit(AdminEmployeesPage);
    expect(f('code')).toBeDisabled();
  });
  test('CR An edit reports how many fields changed', async () => {
    await signInAs('admin');
    const v = employeeOf('CP-1042').version;
    await openEdit(AdminEmployeesPage);
    await type('contractedHours', '30');
    await save();
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Amara Okafor updated · 1 field(s) changed');
    expect(employeeOf('CP-1042')).toMatchObject({ contractedHours: 30, version: v + 1 });
  });
  test('the line manager is picked from the employees, and their name is what is saved', async () => {
    await signInAs('admin');
    await openEdit(AdminEmployeesPage);
    const other = Object.values(store.coll<{ id: string; name: string; code: string }>('employees')).find(e => e.code !== 'CP-1042');
    if (!other) throw new Error('no other employee');
    await userEvent.click(f('manager'));
    expect(screen.queryByTestId(`${tid.employeeForm.field('manager')}-option-Amara Okafor`)).toBeNull();
    await userEvent.click(await screen.findByTestId(`${tid.employeeForm.field('manager')}-option-${other.name}`));
    await save();
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('updated');
    expect(employeeOf('CP-1042').manager).toBe(other.name);
  });
  test('a line manager who is not in the list is kept on save', async () => {
    await signInAs('admin');
    const id = employeeOf('CP-1042').id;
    const row = store.coll<{ manager: string }>('employees')[id];
    if (!row) throw new Error('no employee');
    row.manager = 'Former Colleague';
    await openEdit(AdminEmployeesPage);
    expect(f('manager')).toHaveTextContent('Former Colleague');
    await type('contractedHours', '31');
    await save();
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('updated');
    expect(employeeOf('CP-1042')).toMatchObject({ manager: 'Former Colleague', contractedHours: 31 });
  });
  test('a failed save shows the refusal and leaves the record as it was', async () => {
    await signInAs('admin');
    const before = snapshot('employees');
    await openEdit(AdminEmployeesPage);
    await type('contractedHours', '20');
    await fault('PATCH', `/api/v1/employees/${employeeOf('CP-1042').id}`);
    await save();
    expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
    expect(screen.getByTestId(tid.employeeForm.root)).toBeInTheDocument();
    expect(snapshot('employees')).toEqual(before);
  });
  test('a manager is offered Add someone and Edit, but not the user type, because that needs Permissions', async () => {
    await signInAs('manager');
    renderPage(<TeamEmployeesPage />);
    await screen.findByTestId(tid.employees.table);
    expect(screen.getByTestId(tid.employees.add)).toHaveTextContent('Add someone');
    await userEvent.click(screen.getByTestId(tid.employees.edit('CP-1042')));
    await screen.findByTestId(tid.employeeForm.root);
    expect(screen.queryByTestId(tid.employeeForm.field('userType'))).toBeNull();
    expect(screen.getByTestId(tid.employeeForm.root)).toHaveTextContent('Qnipay setup · Permissions');
  });
  test('someone whose work email already signs in another account is told the address must change, not to add one', async () => {
    resetTo('qnipay');
    await signInAs('admin');
    const shared = String(employeeOf('EMP015').email);
    expect(shared).toBe(String(employeeOf('EMP014').email));
    /* EMP015 is archived, so the list shows them only under every state */
    renderPage(<AdminEmployeesPage />);
    await userEvent.click(await screen.findByTestId(tid.employees.stateFilter));
    await userEvent.click(await screen.findByTestId(`${tid.employees.stateFilter}-option-all`));
    await userEvent.click(await screen.findByTestId(tid.employees.edit('EMP015')));
    await screen.findByTestId(tid.employeeForm.root);
    const form = screen.getByTestId(tid.employeeForm.root);
    expect(form).toHaveTextContent(`${shared} already signs in to another account`);
    expect(form).not.toHaveTextContent('Give them a work email');
  });
});
test('T A tooltip inside a modal exists (the reported case)', async () => {
  await signInAs('admin');
  await openAdd();
  const tip = screen.getByTestId(tid.field.tip(tid.employeeForm.field('code')));
  expect(screen.getByRole('dialog')).toContainElement(tip);
  expect(tip).toHaveAccessibleDescription(/cannot change once the record exists/);
});
