import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { nextEmployeeCode } from '@/domain/codes';
import { todayIso } from '@/lib/format';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, fault, personOf, resetTo, signInAs, snapshot } from '@/test/api-helpers';
import { AdminPeoplePage } from './AdminPeoplePage';
import { TeamPeoplePage } from './TeamPeoplePage';

withFakeServer();
beforeEach(() => resetTo('social'));
const f = (name: string) => screen.getByTestId(tid.personForm.field(name));
/* a change event, not keystrokes: the form re-renders per key, and typing a whole address in jsdom is slow */
const type = (name: string, value: string) => { fireEvent.change(f(name), { target: { value } }); };
const pick = async (name: string, value: string) => {
  await userEvent.click(f(name));
  await userEvent.click(await screen.findByTestId(`${tid.personForm.field(name)}-option-${value}`));
};
const save = () => userEvent.click(screen.getByTestId(tid.personForm.save));
const nextCode = () => nextEmployeeCode(Object.values(store.coll<{ code: string }>('people')).map(p => p.code));
const openAdd = async () => {
  renderPage(<AdminPeoplePage />);
  await userEvent.click(await screen.findByTestId(tid.people.add));
  await screen.findByTestId(tid.personForm.root);
};
const openEdit = async (Page: () => React.JSX.Element, code = 'CP-1042') => {
  renderPage(<Page />);
  await userEvent.click(await screen.findByTestId(tid.people.edit(code)));
  await screen.findByTestId(tid.personForm.root);
};

describe('adding someone, as an admin', () => {
  beforeEach(async () => { await signInAs('admin'); });
  test('CR The form opens with an identity section, groups employment, contract and access, and has full test id coverage', async () => {
    await openAdd();
    const form = screen.getByTestId(tid.personForm.root);
    expect(within(form).getAllByRole('heading').map(h => h.textContent)).toEqual(['Identity', 'Employment', 'Contract', 'Access']);
    expectTestIdCoverage(document.body);
  });
  test('CR It proposes the next free employee ID, in the tenant’s own scheme', async () => {
    await openAdd();
    expect(f('code')).toHaveValue(nextCode());
  });
  test('a new person starts today unless the date is changed, as the prototype’s form did', async () => {
    await openAdd();
    expect(f('start')).toHaveValue(todayIso());
  });
  test('CR It uses the design system field pattern', async () => {
    await openAdd();
    expect(screen.getByTestId(tid.personForm.root).querySelectorAll('label').length).toBeGreaterThan(6);
    expect(screen.getByTestId(tid.personForm.field('name-field'))).toHaveTextContent('required');
  });
  test('CR A name is required, and nothing is written', async () => {
    await openAdd();
    const before = snapshot('people', 'audit');
    await save();
    expect(await screen.findByTestId(tid.personForm.warn)).toHaveTextContent('A full name is required.');
    expect(snapshot('people', 'audit')).toEqual(before);
  });
  test('CR A duplicate employee ID is refused, because payroll maps on it', async () => {
    await openAdd();
    await type('name', 'Test Person'); await type('email', 'test.person@brightpath.org');
    await type('code', 'CP-1042');
    await save();
    expect(await screen.findByTestId(tid.personForm.warn)).toHaveTextContent('CP-1042 is already in use');
  });
  test('CR Contracted hours are bounded, and cannot exceed the maximum', async () => {
    await openAdd();
    await type('name', 'Test Person'); await type('email', 'test.person@brightpath.org');
    await type('contractedHours', '90'); await save();
    expect(await screen.findByTestId(tid.personForm.warn)).toHaveTextContent('between 0 and 80');
    await type('contractedHours', '50'); await type('maxHours', '40'); await save();
    expect(await screen.findByTestId(tid.personForm.warn)).toHaveTextContent('cannot exceed the maximum');
  });
  test('CR A valid record is created, and says what it can do straight away', async () => {
    await openAdd();
    await type('name', 'Test Person'); await type('email', 'test.person@brightpath.org');
    await pick('location', 'WH'); await pick('state', 'active');
    await save();
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Test Person created');
    expect(screen.getByTestId(tid.toast.next)).toHaveTextContent('They count as working from today.');
    const created = Object.values(store.coll<{ name: string; location: string; state: string }>('people')).find(p => p.name === 'Test Person');
    expect(created).toMatchObject({ location: 'WH', state: 'active' });
    expect(audits().at(-1)?.act).toBe('Employee created');
  });
});

describe('editing someone', () => {
  test('CR The employee ID cannot be changed once it exists', async () => {
    await signInAs('admin');
    await openEdit(AdminPeoplePage);
    expect(f('code')).toBeDisabled();
  });
  test('CR An edit reports how many fields changed', async () => {
    await signInAs('admin');
    const v = personOf('CP-1042').version;
    await openEdit(AdminPeoplePage);
    await type('contractedHours', '30');
    await save();
    expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Amara Okafor updated · 1 field(s) changed');
    expect(personOf('CP-1042')).toMatchObject({ contractedHours: 30, version: v + 1 });
  });
  test('a failed save shows the refusal and leaves the record as it was', async () => {
    await signInAs('admin');
    const before = snapshot('people');
    await openEdit(AdminPeoplePage);
    await type('contractedHours', '20');
    await fault('PATCH', `/api/v1/people/${personOf('CP-1042').id}`);
    await save();
    expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
    expect(screen.getByTestId(tid.personForm.root)).toBeInTheDocument();
    expect(snapshot('people')).toEqual(before);
  });
  test('a manager is offered Add someone and Edit, but not the user type, because that needs Permissions', async () => {
    await signInAs('manager');
    renderPage(<TeamPeoplePage />);
    await screen.findByTestId(tid.people.table);
    expect(screen.getByTestId(tid.people.add)).toHaveTextContent('Add someone');
    await userEvent.click(screen.getByTestId(tid.people.edit('CP-1042')));
    await screen.findByTestId(tid.personForm.root);
    expect(screen.queryByTestId(tid.personForm.field('userType'))).toBeNull();
    expect(screen.getByTestId(tid.personForm.root)).toHaveTextContent('Qnipay setup · Permissions');
  });
  test('someone whose work email already signs in another account is told the address must change, not to add one', async () => {
    resetTo('qnipay');
    await signInAs('admin');
    const shared = String(personOf('EMP015').email);
    expect(shared).toBe(String(personOf('EMP014').email));
    /* EMP015 is archived, so the list shows them only under every state */
    renderPage(<AdminPeoplePage />);
    await userEvent.click(await screen.findByTestId(tid.people.stateFilter));
    await userEvent.click(await screen.findByTestId(`${tid.people.stateFilter}-option-all`));
    await userEvent.click(await screen.findByTestId(tid.people.edit('EMP015')));
    await screen.findByTestId(tid.personForm.root);
    const form = screen.getByTestId(tid.personForm.root);
    expect(form).toHaveTextContent(`${shared} already signs in to another account`);
    expect(form).not.toHaveTextContent('Give them a work email');
  });
});
test('T A tooltip inside a modal exists (the reported case)', async () => {
  await signInAs('admin');
  await openAdd();
  const tip = screen.getByTestId(tid.field.tip(tid.personForm.field('code')));
  expect(screen.getByRole('dialog')).toContainElement(tip);
  expect(tip).toHaveAccessibleDescription(/cannot change once the record exists/);
});
