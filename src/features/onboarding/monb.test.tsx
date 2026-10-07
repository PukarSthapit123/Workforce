import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import type { OnboardingCaseRecord, OnboardingConfigRecord, OnbPolicyRecord } from '@/contract/onboarding';
import { POLICY_NAME_NEEDED, POLICY_NAME_TAKEN, REQUIRED_CHANGE_WARNING, STEP_UNAVAILABLE, stepSwitchText } from '@/domain/onboarding';
import { buildNav } from '@/domain/nav';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { accountOf, audits, resetTo, signInAs } from '@/test/api-helpers';
import { OnboardingSetupPage } from './OnboardingSetupPage';

/* The social seed at the frozen clock: Onboarding and every ONB_* feature on,
   the seven steps on, five documents (right to work, proof of address and
   photograph required; only the right to work blocks the start) and four
   policies (code of conduct v4.1, privacy notice v2.0, employee handbook v7.3,
   IT and data security v3.2), none uploaded. Priya (CP-1501) and Tom
   (CP-1502) are the starters, with empty cases. */
withFakeServer();
beforeEach(() => resetTo('social'));
const config = () => {
  const c = store.coll<OnboardingConfigRecord>('onboardingConfig').onboardingConfig;
  if (!c) throw new Error('no onboarding config');
  return c;
};
const policy = (id: string) => store.coll<OnbPolicyRecord>('onboardingPolicies')[id];
const tenant = () => store.coll<{ flags: Record<string, boolean> }>('tenant').tenant;
const acts = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const open = async () => {
  await signInAs('admin');
  renderPage(<OnboardingSetupPage />, '/setup/monb');
  return screen.findByTestId(tid.monb.card('steps'));
};
const dialog = () => screen.getByTestId(tid.modal.root);
const rows = () => screen.getByTestId(tid.monb.policies).querySelectorAll('tbody tr').length;

describe('Onboarding setup: steps and documents apply on Save', () => {
  test('the three fixed steps are always asked; switching one off is unsaved until Save, Cancel puts it back, and Save says people keep what they gave', async () => {
    await open();
    expect(screen.getByText('Modules · Onboarding · Onboarding setup')).toBeInTheDocument();
    expect(screen.getAllByText('Always asked')).toHaveLength(3);
    expect(screen.getByTestId(tid.monb.save)).toBeDisabled();
    expectTestIdCoverage(document.body);

    await userEvent.click(screen.getByTestId(tid.monb.stepSwitch('emergency')));
    expect(screen.getByTestId(tid.monb.dirty)).toHaveTextContent('Unsaved changes');
    await userEvent.click(screen.getByTestId(tid.monb.cancel));
    expect(screen.queryByTestId(tid.monb.dirty)).toBeNull();
    expect(screen.getByTestId(tid.monb.stepSwitch('emergency'))).toHaveAttribute('aria-checked', 'true');
    expect(config().version).toBe(1);

    await userEvent.click(screen.getByTestId(tid.monb.stepSwitch('emergency')));
    await userEvent.click(screen.getByTestId(tid.monb.save));
    await expectToast(stepSwitchText('Emergency contacts', false));
    expect(toasts()).toContain('People part-way through keep what they have already given.');
    expect(config()).toMatchObject({ version: 2 });
    expect(config().steps.find(s => s.id === 'emergency')?.on).toBe(false);
    expect(acts()).toEqual(['Onboarding setup saved']);
    await waitFor(() => expect(screen.queryByTestId(tid.monb.dirty)).toBeNull());
  });

  test('a fixed step has no switch, and a step whose features are off cannot be switched and says why', async () => {
    const t = tenant();
    if (t) t.flags.ONB_POL = false;
    await open();
    for (const id of ['personal', 'contact', 'review']) {
      expect(screen.queryByTestId(tid.monb.stepSwitch(id))).toBeNull();
      expect(screen.getByTestId(tid.monb.stepOn(id))).toHaveTextContent('On');
    }
    expect(screen.getByTestId(tid.monb.stepSwitch('policies'))).toBeDisabled();
    expect(screen.getByTestId(tid.monb.stepNeeds('policies'))).toHaveTextContent(`${STEP_UNAVAILABLE} It needs Policy acknowledgement.`);
    expect(screen.queryByTestId(tid.monb.stepNeeds('emergency'))).toBeNull();
  });

  test('document settings save together: one request, one audit row', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.monb.docBlocks('addr')));
    fireEvent.change(screen.getByTestId(tid.monb.docVerify('photo')), { target: { value: 'none' } });
    await userEvent.click(screen.getByTestId(tid.monb.docExpiry('cert')));
    await userEvent.click(screen.getByTestId(tid.monb.save));
    await expectToast('Document settings saved.');
    const docs = Object.fromEntries(config().documents.map(d => [d.id, d]));
    expect([docs.addr?.blocks, docs.photo?.verify, docs.cert?.expiry]).toEqual([true, 'none', false]);
    expect(acts()).toEqual(['Onboarding setup saved']);
  });

  test('the page cautions that changing what is required affects people part-way through; who verifies waits for Save, Cancel puts it back, and Save audits the before and after', async () => {
    await open();
    const caution = screen.getByTestId(tid.head.caution('monb'));
    expect(caution).toHaveAttribute('role', 'note');
    expect(caution).toHaveTextContent(REQUIRED_CHANGE_WARNING);

    const was = config().documents.find(d => d.id === 'photo');
    if (!was) throw new Error('no photograph document');
    expect(was.verify).not.toBe('none');
    const verify = () => screen.getByTestId(tid.monb.docVerify('photo'));
    fireEvent.change(verify(), { target: { value: 'none' } });
    expect(screen.getByTestId(tid.monb.dirty)).toHaveTextContent('Unsaved changes');
    await userEvent.click(screen.getByTestId(tid.monb.cancel));
    expect(verify()).toHaveValue(was.verify);
    expect(config().version).toBe(1);
    expect(acts()).toEqual([]);

    fireEvent.change(verify(), { target: { value: 'none' } });
    await userEvent.click(screen.getByTestId(tid.monb.save));
    await expectToast('Document settings saved.');
    const saved = audits().filter(a => a.act === 'Onboarding setup saved');
    expect(saved).toHaveLength(1);
    expect(saved[0]?.before).toEqual({ documents: { photo: was } });
    expect(saved[0]?.after).toMatchObject({ documents: { photo: { ...was, verify: 'none' } } });
  });
});

describe('Onboarding setup: policies, one row at a time', () => {
  test('Add a policy refuses a missing or duplicate name in the form, then adds it at v1.0', async () => {
    await open();
    expect(rows()).toBe(4);
    await userEvent.click(screen.getByTestId(tid.monb.polAdd));
    await userEvent.click(screen.getByTestId(tid.monb.polSave));
    expect(screen.getByTestId(tid.monb.polWarn)).toHaveTextContent(POLICY_NAME_NEEDED);
    await userEvent.type(screen.getByTestId(tid.monb.polName), 'code of CONDUCT');
    await userEvent.click(screen.getByTestId(tid.monb.polSave));
    expect(screen.getByTestId(tid.monb.polWarn)).toHaveTextContent(POLICY_NAME_TAKEN);
    expect(acts()).toEqual([]);
    await userEvent.clear(screen.getByTestId(tid.monb.polName));
    await userEvent.type(screen.getByTestId(tid.monb.polName), 'Fire safety');
    await userEvent.type(screen.getByTestId(tid.monb.polSum), 'Exits, alarms and drills.');
    await userEvent.click(screen.getByTestId(tid.monb.polSave));
    await expectToast('Fire safety saved. Upload the document to make it readable.');
    expect(await screen.findByTestId(tid.monb.pol('pol_fire_safety'))).toHaveTextContent('Exits, alarms and drills.');
    expect(screen.getByTestId(tid.monb.polVer('pol_fire_safety'))).toHaveTextContent('v1.0');
    expect(screen.getByTestId(tid.monb.polFile('pol_fire_safety'))).toHaveTextContent('Nothing uploaded yet.');
    expect(rows()).toBe(5);
    expect(acts()).toEqual(['Policy added']);
  });

  test('Edit changes the name, version or summary of one policy', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.monb.polEdit('pol_privacy')));
    expect(within(dialog()).getByTestId(tid.modal.title)).toHaveTextContent('Privacy notice');
    await userEvent.clear(screen.getByTestId(tid.monb.polSum));
    await userEvent.type(screen.getByTestId(tid.monb.polSum), 'The personal data held about you.');
    await userEvent.click(screen.getByTestId(tid.monb.polSave));
    await expectToast('Privacy notice saved.');
    await waitFor(() => expect(screen.getByTestId(tid.monb.pol('pol_privacy'))).toHaveTextContent('The personal data held about you.'));
    expect(policy('pol_privacy')).toMatchObject({ ver: 'v2.0', sum: 'The personal data held about you.', version: 2 });
    expect(acts()).toEqual(['Policy edited']);
  });

  test('uploading a new document raises the version and says how many people will be asked again', async () => {
    const cases = store.coll<OnboardingCaseRecord>('onboardingCases');
    for (const id of ['onb_CP-1501', 'onb_CP-1502']) {
      const c = cases[id];
      if (c) cases[id] = { ...c, acks: { pol_conduct: 'v4.1' }, read: { pol_conduct: true } };
    }
    await open();
    expect(screen.getByTestId(tid.monb.polAcks('pol_conduct'))).toHaveTextContent('2');
    expect(screen.getByTestId(tid.monb.polUpload('pol_conduct'))).toHaveTextContent('Upload');
    await userEvent.click(screen.getByTestId(tid.monb.polUpload('pol_conduct')));
    const file = new File([new Uint8Array([1, 2, 3])], 'code-of-conduct-v5.pdf', { type: 'application/pdf' });
    fireEvent.change(screen.getByTestId(tid.monb.filePick), { target: { files: [file] } });
    await expectToast('Code of conduct is now v4.2. 2 people will be asked again.');
    await waitFor(() => expect(screen.getByTestId(tid.monb.polVer('pol_conduct'))).toHaveTextContent('v4.2'));
    expect(screen.getByTestId(tid.monb.polAcks('pol_conduct'))).toHaveTextContent('0');
    expect(screen.getByTestId(tid.monb.polFile('pol_conduct'))).toHaveTextContent('code-of-conduct-v5.pdf');
    expect(screen.getByTestId(tid.monb.polUpload('pol_conduct'))).toHaveTextContent('Replace');
    expect([cases['onb_CP-1501']?.acks, cases['onb_CP-1502']?.acks]).toEqual([{}, {}]);
    expect(acts()).toEqual(['Policy document uploaded']);
  });

  test('Remove asks first, and only the confirm removes it', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.monb.polRemove('pol_itsec')));
    expect(within(dialog()).getByTestId(tid.modal.title)).toHaveTextContent('Remove IT and data security?');
    expect(dialog()).toHaveTextContent('New starters will no longer be asked to read it.');
    await userEvent.click(screen.getByTestId(tid.modal.cancel));
    expect(policy('pol_itsec')).toBeDefined();
    await userEvent.click(screen.getByTestId(tid.monb.polRemove('pol_itsec')));
    await userEvent.click(screen.getByTestId(tid.modal.confirm));
    await expectToast('IT and data security removed.');
    await waitFor(() => expect(screen.queryByTestId(tid.monb.pol('pol_itsec'))).toBeNull());
    expect(policy('pol_itsec')).toBeUndefined();
    expect(acts()).toEqual(['Policy removed']);
  });
});

describe('Onboarding setup: who reaches it', () => {
  test('it needs Configure onboarding: not on the nav without it, and the server refuses the read', async () => {
    const modules = { CORE: true, ON: true }, flags = {};
    const views = (caps: string[]) => buildNav({ caps: new Set(caps), modules, flags, onboarding: false }).flatMap(g => g.tabs).map(t => t.view);
    expect(views(['onb_cfg'])).toContain('monb');
    expect(views(['mod_cfg'])).not.toContain('monb');
    expect(buildNav({ caps: new Set(['onb_cfg']), modules: { CORE: true, ON: false }, flags, onboarding: false }).flatMap(g => g.tabs).map(t => t.view)).not.toContain('monb');

    const a = Object.values(store.coll<{ email: string; revocations: string[] }>('accounts')).find(x => x.email === accountOf('admin').email);
    if (!a) throw new Error('no admin account');
    a.revocations = ['onb_cfg'];
    await signInAs('admin');
    renderPage(<OnboardingSetupPage />, '/setup/monb');
    expect(await screen.findByTestId(tid.monb.error)).toBeInTheDocument();
    expect(screen.queryByTestId(tid.monb.card('steps'))).toBeNull();
  });
});
