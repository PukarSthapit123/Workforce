import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { tid } from '@/testids';
import type { OnbTemplateRecord } from '@/contract/onboarding';
import { TEMPLATE_NAME_RESERVED, TEMPLATE_NAME_TAKEN, templateCreatedText, templateDeletedText, templateSavedText } from '@/domain/onboarding-templates';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, fault, resetTo, signInAs } from '@/test/api-helpers';
import { OnboardingSetupPage } from './OnboardingSetupPage';

/* The qnipay seed: Senior consultants holds the SCONS job profile; the other
   three job profiles use the Default template. */
withFakeServer();
beforeEach(() => resetTo('qnipay'));
const SENIOR = 'onbt-senior-consultants';
const templates = () => store.coll<OnbTemplateRecord>('onboardingTemplates');
const acts = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);
const toasts = () => screen.queryAllByTestId(tid.toast.info).map(t => t.textContent ?? '').join(' | ');
const open = async (path = '/setup/monb') => {
  await signInAs('admin');
  renderPage(<OnboardingSetupPage />, path);
  return screen.findByTestId(tid.monb.template);
};
const pick = async (key: string) => {
  await userEvent.click(screen.getByTestId(tid.monb.template));
  await userEvent.click(await screen.findByTestId(`${tid.monb.template}-option-${key}`));
};
const onSwitch = (id: string) => screen.getByTestId(tid.monb.stepSwitch(id));

describe('Onboarding setup: the template bar', () => {
  test('the bar lists Default first, then each template with its job profile count', async () => {
    await open();
    expect(screen.getByTestId(tid.monb.template)).toHaveTextContent('Default (3 job profiles)');
    await userEvent.click(screen.getByTestId(tid.monb.template));
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Default (3 job profiles)', 'Senior consultants (1 job profile)']);
    await userEvent.click(screen.getByTestId(`${tid.monb.template}-option-${SENIOR}`));
    expect(await screen.findByTestId(tid.monb.card('applies'))).toBeInTheDocument();
  });

  test('a template named in the address opens it, and a stale one opens Default', async () => {
    await open(`/setup/monb?template=${SENIOR}`);
    expect(screen.getByTestId(tid.monb.template)).toHaveTextContent('Senior consultants (1 job profile)');
    cleanup();
    await open('/setup/monb?template=onbt-gone');
    expect(screen.getByTestId(tid.monb.template)).toHaveTextContent('Default (3 job profiles)');
    expect(await screen.findByTestId(tid.monb.card('steps'))).toBeInTheDocument();
    expect(screen.queryByTestId(tid.monb.error)).toBeNull();
  });

  test('New template checks the name in the form, creates from the chosen start, and selects it', async () => {
    await open();
    await userEvent.click(screen.getByTestId(tid.monb.templateNew));
    await userEvent.type(screen.getByTestId(tid.monb.newName), 'default');
    await userEvent.click(screen.getByTestId(tid.monb.newCreate));
    expect(screen.getByTestId(tid.monb.newWarn)).toHaveTextContent(TEMPLATE_NAME_RESERVED);
    await userEvent.clear(screen.getByTestId(tid.monb.newName));
    await userEvent.type(screen.getByTestId(tid.monb.newName), ' senior CONSULTANTS ');
    await userEvent.click(screen.getByTestId(tid.monb.newCreate));
    expect(screen.getByTestId(tid.monb.newWarn)).toHaveTextContent(TEMPLATE_NAME_TAKEN);
    expect(Object.keys(templates())).toEqual([SENIOR]);

    await userEvent.clear(screen.getByTestId(tid.monb.newName));
    await userEvent.type(screen.getByTestId(tid.monb.newName), 'Consultants');
    await userEvent.click(screen.getByTestId(tid.monb.newFrom));
    await userEvent.click(await screen.findByTestId(`${tid.monb.newFrom}-option-${SENIOR}`));
    await userEvent.click(screen.getByTestId(tid.monb.newCreate));
    await waitFor(() => expect(toasts()).toContain(templateCreatedText('Consultants')));
    await waitFor(() => expect(screen.getByTestId(tid.monb.template)).toHaveTextContent('Consultants (0 job profiles)'));
    expect(await screen.findByTestId(tid.monb.card('applies'))).toBeInTheDocument();
    expect(await screen.findByTestId(tid.monb.stepSwitch('additional'))).toHaveAttribute('aria-checked', 'false');
  });

  test('switching templates with unsaved changes asks first: Keep editing stays, Discard changes switches', async () => {
    await open(`/setup/monb?template=${SENIOR}`);
    await userEvent.click(await screen.findByTestId(tid.monb.stepSwitch('emergency')));
    const before = JSON.stringify(templates()[SENIOR]);
    await pick('default');
    const dialog = screen.getByTestId(tid.modal.root);
    expect(within(dialog).getByText('Discard your changes?')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Save or discard your changes to Senior consultants before opening another template.');
    await userEvent.click(screen.getByTestId(tid.modal.cancel));
    expect(screen.getByTestId(tid.monb.template)).toHaveTextContent('Senior consultants');
    expect(screen.getByTestId(tid.monb.dirty)).toBeInTheDocument();
    await pick('default');
    await userEvent.click(screen.getByTestId(tid.modal.confirm));
    await waitFor(() => expect(screen.getByTestId(tid.monb.template)).toHaveTextContent('Default (3 job profiles)'));
    expect(screen.queryByTestId(tid.monb.card('applies'))).toBeNull();
    expect(JSON.stringify(templates()[SENIOR])).toBe(before);
  });

  test('a named template\'s steps save as one draft with If-Match; Cancel puts them back', async () => {
    await open(`/setup/monb?template=${SENIOR}`);
    const sw = await screen.findByTestId(tid.monb.stepSwitch('emergency'));
    expect(sw).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(sw);
    expect(screen.getByTestId(tid.monb.dirty)).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(tid.monb.cancel));
    expect(onSwitch('emergency')).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByTestId(tid.monb.dirty)).toBeNull();
    await userEvent.click(onSwitch('emergency'));
    await userEvent.click(screen.getByTestId(tid.monb.save));
    await waitFor(() => expect(toasts()).toContain(templateSavedText('Senior consultants')));
    const row = templates()[SENIOR];
    expect(row?.version).toBe(2);
    expect(row?.steps.find(s => s.id === 'emergency')?.on).toBe(false);
    expect(acts().at(-1)).toBe('Onboarding template saved');
    expectTestIdCoverage(document.body);
  });
});

describe('Onboarding setup: Applies to', () => {
  const chips = () => within(screen.getByTestId(tid.monb.card('applies')));
  const addMenu = async () => {
    await userEvent.click(await screen.findByTestId(tid.monb.profileAdd));
  };
  const newTemplate = async (name: string) => {
    await userEvent.click(screen.getByTestId(tid.monb.templateNew));
    await userEvent.type(screen.getByTestId(tid.monb.newName), name);
    await userEvent.click(screen.getByTestId(tid.monb.newCreate));
    await screen.findByTestId(tid.monb.card('applies'));
  };

  test('the job profiles show as chips, and removing one is part of the draft', async () => {
    await open(`/setup/monb?template=${SENIOR}`);
    expect(await screen.findByTestId(tid.monb.profile('SCONS'))).toHaveTextContent('Senior Consultant');
    await userEvent.click(screen.getByTestId(tid.monb.profileRemove('SCONS')));
    expect(screen.getByTestId(tid.monb.profilesEmpty)).toHaveTextContent('No job profiles yet. Nobody uses this template until you add one and save.');
    expect(screen.getByTestId(tid.monb.dirty)).toBeInTheDocument();
    expect(templates()[SENIOR]?.jobProfiles).toEqual(['SCONS']);
    await userEvent.click(screen.getByTestId(tid.monb.save));
    await waitFor(() => expect(templates()[SENIOR]?.jobProfiles).toEqual([]));
    expectTestIdCoverage(document.body);
  });

  test('Add job profile lists the free profiles, shows one held elsewhere as unavailable naming its template, and adds a free one', async () => {
    await open();
    await newTemplate('Consultants');
    await addMenu();
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([
      'Administrator (ADM)', 'Consultant (CONS)', 'Project Manager (PM)', 'Senior Consultant (SCONS), in Senior consultants']);
    expect(screen.getByTestId(`${tid.monb.profileAdd}-option-SCONS`)).toHaveAttribute('aria-disabled', 'true');
    await userEvent.click(screen.getByTestId(`${tid.monb.profileAdd}-option-SCONS`));
    expect(screen.queryByTestId(tid.monb.profile('SCONS'))).toBeNull();
    await userEvent.click(screen.getByTestId(`${tid.monb.profileAdd}-option-CONS`));
    expect(chips().getByTestId(tid.monb.profile('CONS'))).toHaveTextContent('Consultant');
    await addMenu();
    expect(screen.queryByTestId(`${tid.monb.profileAdd}-option-CONS`)).toBeNull();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByTestId(tid.monb.save));
    await waitFor(() => expect(templates()['onbt-consultants']?.jobProfiles).toEqual(['CONS']));
  });

  test('a job profile the server refuses as held elsewhere shows its field error under the chips', async () => {
    await open();
    await newTemplate('Consultants');
    await addMenu();
    await userEvent.click(screen.getByTestId(`${tid.monb.profileAdd}-option-CONS`));
    const senior = templates()[SENIOR];
    if (!senior) throw new Error('seed has no Senior consultants');
    senior.jobProfiles = ['SCONS', 'CONS'];
    await userEvent.click(screen.getByTestId(tid.monb.save));
    expect(await screen.findByTestId(tid.monb.profileError)).toHaveTextContent(
      'Consultant (CONS) is already in Senior consultants. Take it out of Senior consultants first.');
  });

  test('Rename changes the name in the draft and checks the name rules in the dialog', async () => {
    await open(`/setup/monb?template=${SENIOR}`);
    await userEvent.click(await screen.findByTestId(tid.monb.templateRename));
    await userEvent.clear(screen.getByTestId(tid.monb.renameName));
    await userEvent.type(screen.getByTestId(tid.monb.renameName), 'default');
    await userEvent.click(screen.getByTestId(tid.monb.renameSave));
    expect(screen.getByTestId(tid.monb.renameWarn)).toHaveTextContent(TEMPLATE_NAME_RESERVED);
    await userEvent.clear(screen.getByTestId(tid.monb.renameName));
    await userEvent.type(screen.getByTestId(tid.monb.renameName), 'Seniors');
    await userEvent.click(screen.getByTestId(tid.monb.renameSave));
    expect(screen.queryByTestId(tid.monb.renameName)).toBeNull();
    expect(screen.getByTestId(tid.monb.dirty)).toBeInTheDocument();
    expect(templates()[SENIOR]?.name).toBe('Senior consultants');
    await userEvent.click(screen.getByTestId(tid.monb.save));
    await waitFor(() => expect(templates()[SENIOR]?.name).toBe('Seniors'));
    await waitFor(() => expect(screen.getByTestId(tid.monb.template)).toHaveTextContent('Seniors (1 job profile)'));
  });

  test('Delete asks first, says the profiles fall back to Default, then opens Default', async () => {
    await open(`/setup/monb?template=${SENIOR}`);
    await userEvent.click(await screen.findByTestId(tid.monb.templateDelete));
    const dialog = screen.getByTestId(tid.modal.root);
    expect(within(dialog).getByText('Delete Senior consultants?')).toBeInTheDocument();
    expect(dialog).toHaveTextContent('Its job profiles use the Default template from now on. Starters who have not submitted follow the Default template too.');
    await userEvent.click(screen.getByTestId(tid.modal.confirm));
    await waitFor(() => expect(toasts()).toContain(templateDeletedText('Senior consultants')));
    await waitFor(() => expect(screen.getByTestId(tid.monb.template)).toHaveTextContent('Default (4 job profiles)'));
    expect(Object.keys(templates())).toEqual([]);
    expect(screen.queryByTestId(tid.monb.card('applies'))).toBeNull();
  });

  test('with several hundred job profiles the search still finds one', async () => {
    const profiles = store.coll<{ id: string; code: string; name: string }>('jobProfiles');
    for (let n = 1; n <= 300; n++) { const code = `JP${String(n).padStart(3, '0')}`; profiles[`job-${code}`] = { id: `job-${code}`, code, name: `Profile ${code}` }; }
    await open(`/setup/monb?template=${SENIOR}`);
    await addMenu();
    await userEvent.type(screen.getByTestId(`${tid.monb.profileAdd}-search`), 'JP250');
    expect(screen.getByTestId(`${tid.monb.profileAdd}-option-JP250`)).toBeInTheDocument();
  });

  test('a template another admin deleted shows the error line, not a blank page', async () => {
    await signInAs('admin');
    await fault('GET', `/api/v1/onboarding/templates/${SENIOR}`, 404);
    renderPage(<OnboardingSetupPage />, `/setup/monb?template=${SENIOR}`);
    expect(await screen.findByTestId(tid.monb.error)).toHaveAttribute('role', 'alert');
    expect(screen.queryByTestId(tid.monb.templateLoading)).toBeNull();
  });
});

describe('Onboarding setup: documents and policies per template', () => {
  const checked = (testId: string) => screen.getByTestId(testId).getAttribute('aria-checked');
  test('on a named template the documents show its switches, with the shared settings read-only and no add, rename or remove', async () => {
    await open(`/setup/monb?template=${SENIOR}`);
    expect(await screen.findByTestId(tid.monb.docVerifyText('rtw'))).toHaveTextContent('HR');
    expect(screen.getByTestId(tid.monb.docExpiryText('rtw'))).toHaveTextContent('Yes');
    expect(screen.getByTestId(tid.monb.docShared)).toHaveTextContent('Verified by and Expiry tracked are set on the Default template and shared by every template.');
    expect(screen.queryByTestId(tid.monb.docAdd)).toBeNull();
    expect(screen.queryByTestId(tid.monb.docVerify('rtw'))).toBeNull();
    expect(screen.queryByTestId(tid.monb.docRename('rtw'))).toBeNull();
    expect(screen.queryByTestId(tid.monb.docRemove('rtw'))).toBeNull();
    expectTestIdCoverage(document.body);
  });

  test('switching a document off on a named template saves on the template, not on the default', async () => {
    await open(`/setup/monb?template=${SENIOR}`);
    await userEvent.click(await screen.findByTestId(tid.monb.docOn('addr')));
    await userEvent.click(screen.getByTestId(tid.monb.save));
    await waitFor(() => expect(templates()[SENIOR]?.documents.find(d => d.id === 'addr')?.on).toBe(false));
    const config = store.coll<{ documents: { id: string; on: boolean }[] }>('onboardingConfig').onboardingConfig;
    expect(config?.documents.find(d => d.id === 'addr')?.on).toBe(true);
  });

  test('each policy has an Asked switch for the selected template; on Default it saves with the config', async () => {
    await open();
    const itsec = await screen.findByTestId(tid.monb.polAsked('pol_itsec'));
    expect(itsec).toHaveAttribute('aria-checked', 'true');
    await userEvent.click(itsec);
    await userEvent.click(screen.getByTestId(tid.monb.save));
    await waitFor(() => expect(toasts()).toContain('Policy choices saved.'));
    const config = store.coll<{ policies: string[] }>('onboardingConfig').onboardingConfig;
    expect(config?.policies).not.toContain('pol_itsec');
    cleanup();
    await open(`/setup/monb?template=${SENIOR}`);
    const handbook = await screen.findByTestId(tid.monb.polAsked('pol_handbook'));
    expect(handbook).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(handbook);
    await userEvent.click(screen.getByTestId(tid.monb.save));
    await waitFor(() => expect(templates()[SENIOR]?.policies).toContain('pol_handbook'));
    expect(checked(tid.monb.polAsked('pol_handbook'))).toBe('true');
  });

  test('adding or removing a policy waits while the page has unsaved changes; upload and edit do not', async () => {
    await open();
    expect(await screen.findByTestId(tid.monb.polAdd)).toBeEnabled();
    expect(screen.queryByTestId(tid.monb.polLocked)).toBeNull();
    await userEvent.click(screen.getByTestId(tid.monb.stepSwitch('emergency')));
    expect(screen.getByTestId(tid.monb.polAdd)).toBeDisabled();
    expect(screen.getByTestId(tid.monb.polRemove('pol_itsec'))).toBeDisabled();
    expect(screen.getByTestId(tid.monb.polLocked)).toHaveTextContent('Save or cancel the changes on this page before adding or removing a policy.');
    expect(screen.getByTestId(tid.monb.polUpload('pol_itsec'))).toBeEnabled();
    expect(screen.getByTestId(tid.monb.polEdit('pol_itsec'))).toBeEnabled();
    expectTestIdCoverage(document.body);
  });
});
