import { fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { DIMENSION_KINDS } from '@/contract/dimensions';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { fault, resetTo, signInAs, snapshot } from '@/test/api-helpers';
import { DimensionsPage } from './DimensionsPage';

withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });
const f = (key: string) => screen.getByTestId(tid.dims.field(key));
const set = (key: string, value: string) => fireEvent.change(f(key), { target: { value } });
const openKind = async (kind: string) => {
  renderPage(<DimensionsPage />, `/setup/aloc?d=${kind}`);
  await screen.findByTestId(tid.dims.table);
};
const openAdd = async (kind = 'locations') => { await openKind(kind); await userEvent.click(screen.getByTestId(tid.dims.add)); await screen.findByTestId(tid.dims.save); };
const openEdit = async (code: string, kind = 'locations') => { await openKind(kind); await userEvent.click(screen.getByTestId(tid.dims.edit(code))); await screen.findByTestId(tid.dims.save); };
const locations = () => Object.values(store.coll<{ code: string; name: string }>('locations'));
const dialog = () => screen.getByRole('dialog');

test('DM Dimensions is an index of cards, not one long stacked page; every dimension card renders as a card, with full test id coverage', async () => {
  const { container } = renderPage(<DimensionsPage />, '/setup/aloc');
  await screen.findByTestId(tid.dims.card('locations'));
  expect(container.querySelectorAll('button[data-testid^="dims-card-"]')).toHaveLength(5);
  expect(screen.getByTestId(tid.dims.card('locations')).className).toMatch(/rounded-card/);
  expect(screen.queryByTestId(tid.dims.table)).toBeNull();
  expectTestIdCoverage(document.body);
});
test('DM All five dimensions are here, including job profiles and projects, and each card says how many entries it holds', async () => {
  renderPage(<DimensionsPage />, '/setup/aloc');
  for (const k of DIMENSION_KINDS) expect(await screen.findByTestId(tid.dims.card(k))).toHaveTextContent(/\d+ entr(y|ies)/);
});
test('DF Dimensions are grouped by the question they answer, in a readable order, and card descriptions are behind hover', async () => {
  renderPage(<DimensionsPage />, '/setup/aloc');
  await screen.findByTestId(tid.dims.card('locations'));
  expect(screen.getAllByRole('heading', { level: 2 }).map(h => h.firstChild?.textContent)).toEqual(['Where work happens', 'What people do', 'What work is charged to']);
  expect(screen.getByTestId(tid.dims.cardDescription('locations'))).toHaveClass('sr-only');
});
test('DM Opening a dimension gives it its own page, with a way back, and full test id coverage', async () => {
  renderPage(<DimensionsPage />, '/setup/aloc');
  await userEvent.click(await screen.findByTestId(tid.dims.card('locations')));
  expect(await screen.findByTestId(tid.dims.table)).toBeInTheDocument();
  expectTestIdCoverage(document.body);
  await userEvent.click(screen.getByTestId(tid.dims.back));
  expect(await screen.findByTestId(tid.dims.card('projects'))).toBeInTheDocument();
});
test('DM It shows how many things use each entry, and says removal is blocked while in use; rows offer Edit', async () => {
  await openKind('locations');
  expect(within(screen.getByTestId(tid.dims.table)).getByRole('columnheader', { name: 'In use' })).toBeInTheDocument();
  expect(screen.getByTestId(tid.page('aloc'))).toHaveTextContent('cannot be removed');
  expect(screen.getByTestId(tid.dims.edit('WH'))).toHaveTextContent('Edit');
});
test('DM The form is built from the spec, using the system field pattern, with full test id coverage', async () => {
  await openAdd();
  expect(dialog().querySelectorAll('label').length).toBeGreaterThanOrEqual(6);
  expectTestIdCoverage(document.body);
});
test('DM A required field is enforced, and a duplicate code is refused, because rota lines reference it', async () => {
  await openAdd();
  const before = snapshot('locations', 'audit');
  await userEvent.click(screen.getByTestId(tid.dims.save));
  expect(await screen.findByTestId(tid.dims.warn)).toHaveTextContent('Code is required.');
  set('code', 'WH'); set('name', 'Duplicate');
  await userEvent.click(screen.getByTestId(tid.dims.save));
  expect(await screen.findByTestId(tid.dims.warn)).toHaveTextContent('WH already exists');
  expect(snapshot('locations', 'audit')).toEqual(before);
});
test('DM A valid entry is created, says where it becomes available, and the new entry can be edited', async () => {
  await openAdd();
  set('code', 'TQ'); set('name', 'Test Quay');
  await userEvent.click(screen.getByTestId(tid.dims.save));
  expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Test Quay created · available everywhere this location is offered');
  expect(await screen.findByTestId(tid.dims.row('TQ'))).toBeInTheDocument();
  expect(locations().map(l => l.code)).toContain('TQ');
  await userEvent.click(screen.getByTestId(tid.dims.edit('TQ')));
  expect(await screen.findByTestId(tid.dims.save)).toHaveTextContent('Save changes');
});
test('DM The code is locked once it exists, and says why', async () => {
  await openEdit('WH');
  expect(f('code')).toBeDisabled();
  expect(dialog()).toHaveTextContent('Codes cannot change');
});
test('DM An edit reports how many fields changed', async () => {
  await openEdit('BC');
  set('name', 'Beacon Court South');
  await userEvent.click(screen.getByTestId(tid.dims.save));
  expect(await screen.findByTestId(tid.toast.info)).toHaveTextContent('Beacon Court South updated · 1 field(s) changed');
  expect(locations().find(l => l.code === 'BC')?.name).toBe('Beacon Court South');
});
test('DM An entry in use cannot be removed, and says what uses it', async () => {
  await openEdit('WH');
  const before = snapshot('locations');
  await userEvent.click(screen.getByTestId(tid.dims.remove));
  expect(await screen.findByTestId(tid.dims.warn)).toHaveTextContent(/WH is used by \d+ people/);
  expect(snapshot('locations')).toEqual(before);
});
test('DM An unused entry can be removed, and it is gone from the list', async () => {
  await openAdd();
  set('code', 'TQ'); set('name', 'Test Quay');
  await userEvent.click(screen.getByTestId(tid.dims.save));
  await userEvent.click(await screen.findByTestId(tid.dims.edit('TQ')));
  await userEvent.click(await screen.findByTestId(tid.dims.remove));
  expect(await screen.findByText(/Test Quay removed/)).toBeInTheDocument();
  expect(screen.queryByTestId(tid.dims.row('TQ'))).toBeNull();
  expect(locations().map(l => l.code)).not.toContain('TQ');
});
test('DM One form serves every dimension', async () => {
  for (const kind of DIMENSION_KINDS) {
    const view = renderPage(<DimensionsPage />, `/setup/aloc?d=${kind}`);
    await userEvent.click(await screen.findByTestId(tid.dims.add));
    expect(await screen.findByTestId(tid.dims.field('code')), kind).toBeInTheDocument();
    expect(screen.getByTestId(tid.dims.field('name')), kind).toBeInTheDocument();
    view.unmount();
  }
});
test('DM Boolean fields render as toggles, not text', async () => {
  await openAdd('job-profiles');
  expect(f('night')).toHaveAttribute('role', 'switch');
});
test('a failed save shows the refusal and leaves the store unchanged', async () => {
  const before = snapshot('locations');
  await openAdd();
  set('code', 'TQ'); set('name', 'Test Quay');
  await fault('POST', '/api/v1/locations');
  await userEvent.click(screen.getByTestId(tid.dims.save));
  expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
  expect(snapshot('locations')).toEqual(before);
});
