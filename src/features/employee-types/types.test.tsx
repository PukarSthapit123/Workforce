import { fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { fault, resetTo, signInAs, snapshot } from '@/test/api-helpers';
import { EmployeeTypesPage } from './EmployeeTypesPage';
import { slugOf } from './NewTypeModal';

withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });
const types = () => Object.values(store.coll<{ id: string; code: string; name: string; capabilities: string[] }>('employeeTypes'));
const openNew = async () => {
  renderPage(<EmployeeTypesPage />);
  await userEvent.click(await screen.findByTestId(tid.types.add));
  await screen.findByTestId(tid.types.newSave);
};
const createWaking = async () => {
  await openNew();
  fireEvent.change(screen.getByTestId(tid.types.newField('name')), { target: { value: 'Waking Night Support' } });
  await userEvent.click(screen.getByTestId(tid.types.newSave));
  await screen.findByTestId(tid.types.chip('waking_night_support'));
};

test('AD Employee types is no longer the densest page in the admin, and it says where the fields went, with full test id coverage', async () => {
  renderPage(<EmployeeTypesPage />);
  const detail = await screen.findByTestId(tid.types.detail);
  expect(detail.querySelectorAll('[role="switch"]').length).toBeLessThanOrEqual(6);
  expect(detail).toHaveTextContent('set with the Timesheet module');
  expectTestIdCoverage(document.body);
});
test('ET A New employee type control exists, and the new-type form has full test id coverage', async () => {
  await openNew();
  expectTestIdCoverage(document.body);
});
test('ET It can start blank, from a live type, or from an archetype', async () => {
  await openNew();
  const base = screen.getByTestId(tid.types.newField('base'));
  expect(base.querySelectorAll('optgroup')).toHaveLength(2);
  expect(base.querySelector('option[value="blank"]')).not.toBeNull();
});
test('ET It asks for entry mode and pay basis', async () => {
  await openNew();
  expect(screen.getByTestId(tid.types.newField('mode'))).toBeInTheDocument();
  expect(screen.getByTestId(tid.types.newField('uom'))).toBeInTheDocument();
});
test('ET A name is required', async () => {
  await openNew();
  const before = snapshot('employeeTypes');
  await userEvent.click(screen.getByTestId(tid.types.newSave));
  expect(await screen.findByTestId(tid.types.newWarn)).toHaveTextContent('A name is required.');
  expect(snapshot('employeeTypes')).toEqual(before);
});
test('ET A type is created, it appears in the type list, and it can be removed', async () => {
  await createWaking();
  expect(screen.getByTestId(tid.toast.info)).toHaveTextContent('Waking Night Support created');
  expect(types().map(t => t.code)).toContain('waking_night_support');
  await userEvent.click(screen.getByTestId(tid.types.remove));
  expect(await screen.findByText(/Waking Night Support removed/)).toBeInTheDocument();
  expect(types().map(t => t.code)).not.toContain('waking_night_support');
});
test('ET Removing a type people hold is refused, and names them', async () => {
  renderPage(<EmployeeTypesPage />);
  await userEvent.click(await screen.findByTestId(tid.types.chip('shift')));
  const before = snapshot('employeeTypes', 'people');
  await userEvent.click(await screen.findByTestId(tid.types.remove));
  expect(await screen.findByTestId(tid.types.warn)).toHaveTextContent(/is used by \d+ (person|people)/);
  expect(snapshot('employeeTypes', 'people')).toEqual(before);
});
test('a capability switched on is saved and reported', async () => {
  renderPage(<EmployeeTypesPage />);
  await userEvent.click(await screen.findByTestId(tid.types.chip('shift')));
  await userEvent.click(await screen.findByTestId(tid.types.cap('vehicle')));
  await userEvent.click(screen.getByTestId(tid.types.save));
  expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('1 field(s) changed');
  expect(types().find(t => t.code === 'shift')?.capabilities).toContain('vehicle');
});
test('DM Job profiles no longer live on the Employee types page', async () => {
  renderPage(<EmployeeTypesPage />);
  expect(await screen.findByTestId(tid.types.jobs)).toHaveTextContent('held once under Dimensions');
  expect(screen.getByTestId(tid.types.jobsLink)).toHaveAttribute('href', '/setup/aloc?d=job-profiles');
});
test('a failed save shows the refusal and leaves the type as it was', async () => {
  const before = snapshot('employeeTypes');
  renderPage(<EmployeeTypesPage />);
  await userEvent.click(await screen.findByTestId(tid.types.cap('vehicle')));
  const first = types().sort((a, b) => a.name.localeCompare(b.name))[0];
  if (!first) throw new Error('no types');
  await fault('PATCH', `/api/v1/employee-types/${first.id}`);
  await userEvent.click(screen.getByTestId(tid.types.save));
  expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
  expect(snapshot('employeeTypes')).toEqual(before);
});
test('a type code is suggested from its name', () => {
  expect(slugOf('Waking Night Support')).toBe('waking_night_support');
  expect(slugOf('  24/7 Cover ')).toBe('cover_24_7');
});
