import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs } from '@/test/api-helpers';
import { OrganisationPage } from './OrganisationPage';

/* The social seed runs on the Social Care & Charity template: every module on,
   three employee types, nothing saved here yet. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });
const tenant = () => store.coll<{ name: string; template: string; modules: Record<string, boolean>; company: { country: string } }>('tenant').tenant;
const saved = () => store.coll<{ template: { name: string; scope: string } }>('templates');
const open = async () => {
  renderPage(<OrganisationPage />);
  await screen.findByTestId(tid.aorg.template('mne'));
  await screen.findByTestId(tid.aorg.noSaved);
};
const saveAs = async (name: string) => {
  await userEvent.click(screen.getByTestId(tid.aorg.saveOpen));
  await userEvent.type(await screen.findByTestId(tid.aorg.saveName), name);
  await userEvent.click(screen.getByTestId(tid.aorg.save));
};

test('the page shows the spine, every template with the live one marked, the company, compliance and pay periods, with full test id coverage', async () => {
  await open();
  expect(screen.getByTestId(tid.aorg.spine)).toHaveTextContent('Organisation & template→Modules→Features→Fields→Employee types→People');
  expect(screen.getByTestId(tid.aorg.template('social'))).toHaveAttribute('aria-pressed', 'true');
  expect(screen.getByTestId(tid.aorg.template('mne'))).toHaveTextContent('M&E / Building Services');
  expect(screen.getByTestId(tid.aorg.template('mne'))).toHaveTextContent('Site Engineer · Contracts Manager · Office / Admin');
  await waitFor(() => expect(screen.getByTestId(tid.aorg.live)).toHaveTextContent(
    'Social Care & Charity is applied to Brightpath Support Services, activating 3 employee types and 5 modules.'));
  expect(screen.getByTestId(tid.aorg.name)).toHaveValue('Brightpath Support Services');
  expect(screen.getByTestId(tid.aorg.country)).toHaveValue('United Kingdom');
  expect(screen.getByTestId(tid.aorg.nmw)).toHaveAttribute('aria-checked', 'true');
  expect(screen.getByTestId(tid.aorg.payFrequency)).toHaveValue('Fortnightly');
  await waitFor(() => expect(screen.getByTestId(tid.aorg.cutoff)).toHaveTextContent('Monday 12:00'));
  expect(screen.queryByText(/currency|accent colour/i)).toBeNull();
  expectTestIdCoverage(document.body);
});

test('a company setting saves when it is chosen, with one audit row', async () => {
  await open();
  fireEvent.change(screen.getByTestId(tid.aorg.country), { target: { value: 'Ireland' } });
  expect(await screen.findByText('Country: Ireland.')).toBeInTheDocument();
  expect(tenant()?.company.country).toBe('Ireland');
  expect(audits().filter(a => a.entity === 'tenant').map(a => a.act)).toEqual(['Organisation settings changed']);
});

test('save a template: a name is needed, then it is listed as saved here with what it keeps', async () => {
  await open();
  await userEvent.click(screen.getByTestId(tid.aorg.saveOpen));
  const box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.aorg.scope('config'))).toBeChecked();
  expect(within(box).queryByText(/Everything, including people/)).toBeNull();
  await userEvent.click(within(box).getByTestId(tid.aorg.save));
  expect(within(box).getByTestId(tid.aorg.saveWarn)).toHaveTextContent('A template needs a name.');
  expect(Object.keys(saved())).toEqual([]);
  await userEvent.type(within(box).getByTestId(tid.aorg.saveName), 'Care, two-stage approval');
  await userEvent.click(within(box).getByTestId(tid.aorg.scope('structure')));
  expectTestIdCoverage(document.body);
  await userEvent.click(within(box).getByTestId(tid.aorg.save));
  expect(await screen.findByText('Care, two-stage approval saved. Configuration and structure.')).toBeInTheDocument();
  const row = await screen.findByTestId(tid.aorg.savedRow('tpl_care_two_stage_approval'));
  expect(row).toHaveTextContent('Configuration and structure');
  expect(row).toHaveTextContent('Saved from Brightpath Support Services');
  expect(saved().tpl_care_two_stage_approval?.template.scope).toBe('structure');
  expect(await screen.findByTestId(tid.aorg.template('tpl_care_two_stage_approval'))).toBeInTheDocument();
});

test('a name a shipped template has is refused in the dialog', async () => {
  await open();
  await saveAs('M&E / Building Services');
  const box = await screen.findByTestId(tid.modal.root);
  expect(await within(box).findByText('That name matches a template that ships with the app. Choose another.')).toBeInTheDocument();
  expect(within(box).getByTestId(tid.aorg.saveName)).toHaveAttribute('aria-invalid', 'true');
  expect(Object.keys(saved())).toEqual([]);
});

test('apply shows what would change, add and stay first, and applies only when confirmed', async () => {
  await open();
  await userEvent.click(screen.getByTestId(tid.aorg.template('mne')));
  const box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.modal.title)).toHaveTextContent('Apply M&E / Building Services?');
  expect(await within(box).findByTestId(tid.aorg.plan('changes'))).toHaveTextContent('Activity reads as Cost code.');
  expect(within(box).getByTestId(tid.aorg.plan('added'))).toHaveTextContent('Employee type Site Engineer (driver).');
  expect(within(box).getByTestId(tid.aorg.plan('leftAlone'))).toHaveTextContent('Brightpath Support Services keeps its name');
  expectTestIdCoverage(document.body);
  await userEvent.click(within(box).getByTestId(tid.aorg.applyCancel));
  expect(tenant()?.template).toBe('social');

  await userEvent.click(screen.getByTestId(tid.aorg.template('mne')));
  const again = await screen.findByTestId(tid.modal.root);
  await within(again).findByTestId(tid.aorg.plan('changes'));
  await userEvent.click(within(again).getByTestId(tid.aorg.apply));
  expect(await screen.findByText(/^M&E \/ Building Services applied\./)).toBeInTheDocument();
  expect([tenant()?.template, tenant()?.modules.R, tenant()?.name]).toEqual(['mne', false, 'Brightpath Support Services']);
  await waitFor(() => expect(screen.getByTestId(tid.aorg.template('mne'))).toHaveAttribute('aria-pressed', 'true'));
});

test('remove asks first; the template in use is refused with the server\'s words, and a shipped one has no Remove', async () => {
  await open();
  await saveAs('In use');
  await screen.findByTestId(tid.aorg.savedRow('tpl_in_use'));
  const t = tenant();
  if (t) t.template = 'tpl_in_use';
  expect(screen.queryByTestId(tid.aorg.remove('mne'))).toBeNull();
  await userEvent.click(screen.getByTestId(tid.aorg.remove('tpl_in_use')));
  const box = await screen.findByTestId(tid.modal.root);
  expect(within(box).getByTestId(tid.modal.title)).toHaveTextContent('Remove In use?');
  await userEvent.click(within(box).getByTestId(tid.modal.confirm));
  expect(await screen.findByText('This tenant is running on that template.')).toBeInTheDocument();
  expect(saved().tpl_in_use).toBeDefined();

  /* a refusal puts the store back as it was, so the tenant is read afresh */
  const now = tenant();
  if (now) now.template = 'social';
  await userEvent.click(screen.getByTestId(tid.aorg.remove('tpl_in_use')));
  await userEvent.click(within(await screen.findByTestId(tid.modal.root)).getByTestId(tid.modal.confirm));
  expect(await screen.findByText('In use removed.')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByTestId(tid.aorg.savedRow('tpl_in_use'))).toBeNull());
  expect(saved().tpl_in_use).toBeUndefined();
});

test('import a file: it is listed, with what was left out; a file that is not JSON could not be read', async () => {
  await open();
  const body = { kind: 'qnipay.template', v: 1, key: 'tpl_x', template: {
    name: 'From a file', description: 'Brought in', scope: 'config', modules: { R: false }, flags: {}, extras: {}, labels: { project: 'Contract' },
    employeeTypes: [], company: { currency: 'GBP £' } } };
  await userEvent.upload(screen.getByTestId(tid.aorg.importFile), new File([JSON.stringify(body)], 'from-a-file.json', { type: 'application/json' }), { applyAccept: false });
  expect(await screen.findByText('From a file imported. Choose it to apply it.')).toBeInTheDocument();
  expect(screen.getByText('Left out, because a template does not hold them: company.')).toBeInTheDocument();
  expect(await screen.findByTestId(tid.aorg.savedRow('tpl_from_a_file'))).toHaveTextContent('Imported by');
  expect(JSON.stringify(saved())).not.toMatch(/currency|£/);

  await userEvent.upload(screen.getByTestId(tid.aorg.importFile), new File(['{nope'], 'broken.json', { type: 'application/json' }), { applyAccept: false });
  expect(await screen.findByText('That file could not be read.')).toBeInTheDocument();
});

/* Suite SAVING A TENANT AS A TEMPLATE: "... with who saved it and when". The
   clock is frozen at 14:30 UTC on 13/08/2026, 15:30 in London, where every
   time is shown. */
test('a saved template says who saved it and when, in London time', async () => {
  await open();
  await saveAs('Care, two-stage approval');
  const row = await screen.findByTestId(tid.aorg.savedRow('tpl_care_two_stage_approval'));
  const admin = Object.values(store.coll<{ userType: string; personCode: string }>('accounts')).find(a => a.userType === 'admin');
  const name = Object.values(store.coll<{ code: string; name: string }>('people')).find(p => p.code === admin?.personCode)?.name;
  expect(name).toBeTruthy();
  expect(within(row).getAllByRole('cell')[2]).toHaveTextContent(`13/08/2026 15:30${name ?? ''}`);
});
