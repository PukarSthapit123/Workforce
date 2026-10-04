import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import type { RotaConfigRecord } from '@/contract/rota';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo, signInAs, snapshot } from '@/test/api-helpers';
import { RotaSetupPage } from './RotaSetupPage';

/* The social seed: Rota on, four fulfilment stages, coverage gaps block
   publishing, employee types shift, casual and salaried. */
withFakeServer();
beforeEach(async () => { resetTo('social'); await signInAs('admin'); });
const config = () => {
  const c = store.coll<RotaConfigRecord>('rotaConfig').rotaConfig;
  if (!c) throw new Error('no rota config');
  return c;
};
const setupAudits = () => audits().filter(a => a.entity === 'rotaConfig');
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const type = (testId: string, value: string) => fireEvent.change(screen.getByTestId(testId), { target: { value } });
const open = async () => {
  renderPage(<RotaSetupPage />, '/setup/mrota');
  await screen.findByTestId(tid.mrota.card('staffing'));
  await screen.findByTestId(tid.mrota.patterns);
  return screen.findByTestId(tid.tshifts.catalogue);
};

describe('Rota setup', () => {
  test('every card renders with the module switches shown as they stand, and full test id coverage', async () => {
    await open();
    for (const k of ['shifts', 'patterns', 'staffing', 'fulfil', 'safe', 'it', 'types']) expect(screen.getByTestId(tid.mrota.card(k))).toBeInTheDocument();
    expect(screen.getByText('Modules · Rota · Rota setup')).toBeInTheDocument();
    expect(screen.getByTestId(tid.mrota.flag('SAFEWORKER'))).toBeDisabled();
    expect(screen.getByTestId(tid.mrota.flag('SAFEWORKER'))).toHaveAttribute('aria-checked', 'true');
    expect(screen.getAllByTestId(/^mrota-stage-\d+$/)).toHaveLength(4);
    expect(screen.getByTestId(tid.mrota.card('it'))).toHaveTextContent('The rate is resolved in Business Central.');
    expect(screen.getByTestId(tid.mrota.save)).toBeDisabled();
    expectTestIdCoverage(document.body);
  });

  test('changes apply only on Save: one request, one audit row, and per-type limits merge by type code', async () => {
    await open();
    const before = config();
    await userEvent.click(screen.getByTestId(tid.mrota.toggle('publishBlockOnGap')));
    type(tid.mrota.num('minDefault'), '5');
    await userEvent.click(screen.getByTestId(tid.mrota.type('casual')));
    type(tid.mrota.typeNum('maxHours'), '30');
    expect(config()).toEqual(before);
    expect(screen.getByTestId(tid.mrota.dirty)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(tid.mrota.save));
    await expectToast('Rota setup saved. It applies across the tenant straight away.');
    expect(config()).toMatchObject({ version: before.version + 1, publishBlockOnGap: false, minDefault: 5, types: { casual: { maxHours: 30 } } });
    expect(config().types.shift).toEqual(before.types.shift);
    expect(setupAudits()).toHaveLength(1);
    expect(setupAudits()[0]?.act).toBe('Rota setup saved');
    await waitFor(() => expect(screen.queryByTestId(tid.mrota.dirty)).toBeNull());
  });

  test('a refusal names its field, inline, and nothing is stored', async () => {
    await open();
    const before = snapshot('rotaConfig', 'audit');
    type(tid.mrota.num('minDefault'), '0');
    await userEvent.click(screen.getByTestId(tid.mrota.save));
    const msg = 'Default people per shift must be a whole number from 1 to 50.';
    expect(await screen.findByTestId(tid.mrota.warn)).toHaveTextContent(msg);
    expect(screen.getByTestId(tid.mrota.num('minDefault'))).toHaveAttribute('aria-invalid', 'true');
    expect(snapshot('rotaConfig', 'audit')).toEqual(before);
  });

  test('a refusal about one employee type opens that type, with the field marked', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.mrota.type('casual')));
    type(tid.mrota.typeNum('maxConsec'), '20');
    await userEvent.click(screen.getByTestId(tid.mrota.type('shift')));
    await userEvent.click(screen.getByTestId(tid.mrota.save));
    expect(await screen.findByTestId(tid.mrota.warn)).toHaveTextContent('Maximum consecutive days must be a whole number from 1 to 14.');
    await waitFor(() => expect(screen.getByTestId(tid.mrota.type('casual'))).toHaveAttribute('aria-pressed', 'true'));
    expect(screen.getByTestId(tid.mrota.typeNum('maxConsec'))).toHaveAttribute('aria-invalid', 'true');
  });

  test('after someone else saves, a 412 starts the draft again from their version and the next save goes through', async () => {
    await open();
    const c = config();
    store.coll<RotaConfigRecord>('rotaConfig').rotaConfig = { ...c, version: c.version + 1, maxConsec: 5 };
    store.save();
    await userEvent.click(screen.getByTestId(tid.mrota.toggle('agencyManual')));
    await userEvent.click(screen.getByTestId(tid.mrota.save));
    expect(await screen.findByTestId(tid.toast.error)).toBeInTheDocument();
    await waitFor(() => expect(screen.getByTestId(tid.mrota.num('maxConsec'))).toHaveValue(5));
    expect(screen.getByTestId(tid.mrota.toggle('agencyManual'))).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(screen.getByTestId(tid.mrota.toggle('agencyManual')));
    await userEvent.click(screen.getByTestId(tid.mrota.save));
    await expectToast('Rota setup saved');
    expect(config()).toMatchObject({ version: c.version + 2, maxConsec: 5, agencyManual: false });
  });

  test('Cancel discards the draft, and the last fulfilment stage cannot be removed', async () => {
    await open();
    const before = snapshot('rotaConfig', 'audit');
    for (let i = 0; i < 3; i++) await userEvent.click(screen.getByTestId(tid.mrota.stageRemove(0)));
    expect(screen.getAllByTestId(/^mrota-stage-\d+$/)).toHaveLength(1);
    await userEvent.click(screen.getByTestId(tid.mrota.stageRemove(0)));
    await expectToast('Keep at least one stage.', tid.toast.error);
    expect(screen.getAllByTestId(/^mrota-stage-\d+$/)).toHaveLength(1);
    await userEvent.click(screen.getByTestId(tid.mrota.cancel));
    expect(screen.getAllByTestId(/^mrota-stage-\d+$/)).toHaveLength(4);
    expect(screen.queryByTestId(tid.mrota.dirty)).toBeNull();
    expect(snapshot('rotaConfig', 'audit')).toEqual(before);
  });

  test('an administrator without team_rota opens, saves and creates working patterns here (I2)', async () => {
    await open();
    const openBtn = await screen.findByTestId(tid.mrota.patternOpen('WP-03'));
    await waitFor(() => expect(openBtn).toBeEnabled());
    await userEvent.click(openBtn);
    await screen.findByTestId(tid.tpat.editor);
    type(tid.tpat.name, 'Beacon nights');
    await userEvent.click(screen.getByTestId(tid.tpat.save));
    await expectToast(/^Beacon nights saved/);
    expect(store.coll<{ name: string }>('patterns')['pat_WP-03']?.name).toBe('Beacon nights');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByTestId(tid.tpat.editor)).toBeNull());
    await userEvent.click(screen.getByTestId(tid.mrota.newPattern));
    type(tid.tpat.newName, 'Twilights');
    await userEvent.selectOptions(screen.getByTestId(tid.tpat.newLocs), ['BC', 'FS']);
    await userEvent.click(screen.getByTestId(tid.tpat.newCreate));
    await expectToast('Twilights created as a draft');
    expect(Object.values(store.coll<{ name: string; locations: string[] }>('patterns')).find(p => p.name === 'Twilights')?.locations).toEqual(['BC', 'FS']);
  });

  test('the pattern upload is simulated: Import writes nothing, and the failed rows download as a real CSV', async () => {
    await open();
    const before = snapshot('patterns', 'rotaWeeks', 'audit');
    await userEvent.click(screen.getByTestId(tid.patUpload.open));
    const dialog = await screen.findByTestId(tid.modal.root);
    expect(within(dialog).getByTestId(tid.patUpload.invalid)).toHaveTextContent('4');
    expectTestIdCoverage(document.body);

    const blobs: Blob[] = [], names: string[] = [];
    const was = URL.createObjectURL;
    URL.createObjectURL = (b: Blob | MediaSource) => { if (b instanceof Blob) blobs.push(b); return 'blob:errors'; };
    URL.revokeObjectURL = () => {};
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download); });
    try {
      await userEvent.click(within(dialog).getByTestId(tid.patUpload.download));
      await expectToast('Downloaded · 4 errors and 2 warnings as CSV');
      expect(names).toEqual(['qnipay-upload-errors.csv']);
      const csv = await blobs[0]?.text();
      expect(csv?.split('\r\n')[0]).toBe('Row,Field,Reason');
      expect(csv?.split('\r\n')).toHaveLength(7);
    } finally {
      click.mockRestore();
      URL.createObjectURL = was;
    }

    await userEvent.click(within(dialog).getByTestId(tid.patUpload.import));
    await expectToast('Simulated · 244 rows validated and would import. No patterns have been created.');
    expect(toasts()).toContain('Mass upload is simulated, not imported.');
    expect(screen.queryByTestId(tid.modal.root)).toBeNull();
    expect(snapshot('patterns', 'rotaWeeks', 'audit')).toEqual(before);
  });

  test('with Rota off the page says so and offers nothing else', async () => {
    resetTo('qnipay');
    await signInAs('admin');
    renderPage(<RotaSetupPage />, '/setup/mrota');
    expect(await screen.findByTestId(tid.mrota.off)).toHaveTextContent('The Rota module is off for this tenant. Turn it on under Modules & features.');
    expect(screen.queryByTestId(tid.mrota.card('staffing'))).toBeNull();
  });
});
