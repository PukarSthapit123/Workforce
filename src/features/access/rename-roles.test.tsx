import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { PermissionsPage } from './PermissionsPage';

/* Rename roles (D11): three fields, each changed name saved on its own user
   type; the capabilities stay as they are. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });
const names = () => Object.fromEntries(Object.values(store.coll<{ id: string; name: string }>('userTypes')).map(t => [t.id, t.name]));
const caps = () => Object.fromEntries(Object.values(store.coll<{ id: string; capabilities: string[] }>('userTypes')).map(t => [t.id, [...t.capabilities]]));
const openDialog = async () => {
  renderPage(<PermissionsPage />);
  await userEvent.click(await screen.findByTestId(tid.roleNames.open));
  return screen.findByTestId(tid.modal.root);
};
const type = async (id: string, value: string) => {
  const input = screen.getByTestId(tid.roleNames.field(id));
  await userEvent.clear(input);
  if (value) await userEvent.type(input, value);
};

test('renaming saves each changed name on its user type, one audit row each, and the matrix follows; capabilities do not change', async () => {
  const before = caps();
  const box = await openDialog();
  expect(box).toHaveTextContent('This only changes what they are called');
  expect(within(box).getAllByRole('textbox')).toHaveLength(3);
  expectTestIdCoverage(document.body);
  await type('employee', 'Support Worker');
  await type('manager', 'Service Manager');
  await userEvent.click(screen.getByTestId(tid.roleNames.save));
  expect(await screen.findByText('Roles renamed: Support Worker, Service Manager, Admin.')).toBeInTheDocument();
  expect(names()).toEqual({ employee: 'Support Worker', manager: 'Service Manager', admin: 'Admin' });
  expect(caps()).toEqual(before);
  expect(audits().filter(a => a.entity === 'userType')).toHaveLength(2);
  await waitFor(() => expect(screen.getByTestId(tid.access.userTypeName('employee'))).toHaveTextContent('Support Worker'));
  expect(screen.queryByTestId(tid.modal.root)).toBeNull();
});

test('two roles cannot share a name: refused on the field before anything is sent, and a clash on the server lands on its field too', async () => {
  await openDialog();
  await type('manager', 'employee');
  await userEvent.click(screen.getByTestId(tid.roleNames.save));
  expect(await screen.findByText('Two roles cannot share a name.')).toBeInTheDocument();
  expect(names().manager).toBe('Manager');

  /* someone else takes the name in the meantime: the server says so on that field */
  const manager = store.coll<{ name: string }>('userTypes').manager;
  if (manager) manager.name = 'Support Worker';
  await type('manager', 'Manager');
  await type('employee', 'Support Worker');
  await userEvent.click(screen.getByTestId(tid.roleNames.save));
  const field = screen.getByTestId(tid.field.root(tid.roleNames.field('employee')));
  await waitFor(() => expect(field).toHaveTextContent(/cannot share a name|already/i));
  expect(names().employee).toBe('Employee');
  expect(audits().filter(a => a.entity === 'userType')).toHaveLength(0);
});
