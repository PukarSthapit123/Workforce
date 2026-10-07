import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import type { OnboardingCaseRecord } from '@/contract/onboarding';
import { REASON_NEEDED, START_REASON, noEmailText } from '@/domain/onboarding';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, personOf, resetTo } from '@/test/api-helpers';
import { TeamOnboardingPage } from './TeamOnboardingPage';

/* The qnipay seed at the frozen clock (13/08/2026): Pukar Sthapit (EMP001),
   the manager persona at Manchester, holds Track onboarding, Verify
   onboarding documents and Add and edit people. Priya Raman (EMP002) is a
   candidate starting 28/09/2026 and Tom Achterberg (EMP003) is preboarding
   from 14/09/2026, both at Manchester with empty cases. The right to work
   stops a start until it is verified; proof of address and the photograph
   are required but do not. */
withFakeServer();
const PUKAR = 'pukar.sthapit@dogmagroup.co.uk';
const signIn = async (email = PUKAR) => {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const body = (await r.json()) as { token?: string };
  if (!body.token) throw new Error(`sign-in as ${email} failed`);
  setToken(body.token);
};
const cases = () => store.coll<OnboardingCaseRecord>('onboardingCases');
const caseOf = (code: string) => {
  const c = cases()[`onb_${code}`];
  if (!c) throw new Error(`no case for ${code}`);
  return c;
};
const acts = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const AT = '2026-08-13T10:00:00.000Z';
const pdf = (name: string) => ({ name, size: 2048, type: 'application/pdf', at: AT, kind: 'pdf' as const });
/* Tom sent his proof of address and photograph; both wait on a check. */
const sent = () => Object.assign(caseOf('EMP003'), { docs: { addr: 'done', photo: 'done' }, files: { addr: pdf('bill.pdf'), photo: pdf('face.pdf') } });
/* Every step but review done and every required document verified: nothing blocks Tom's start. */
const complete = () => Object.assign(caseOf('EMP003'), {
  steps: { personal: 'done', contact: 'done', emergency: 'done', additional: 'done', documents: 'done', policies: 'done' },
  docs: { rtw: 'verified', addr: 'verified', photo: 'verified' },
});
const revoke = (...caps: string[]) => {
  const a = Object.values(store.coll<{ personCode: string; revocations: string[] }>('accounts')).find(x => x.personCode === 'EMP001');
  if (!a) throw new Error('no account for EMP001');
  a.revocations = caps;
};
const open = async () => {
  renderPage(<TeamOnboardingPage />, '/team/tonb');
  return screen.findByTestId(tid.tonb.list);
};

beforeEach(() => resetTo('qnipay'));

describe('Team onboarding', () => {
  test('the starters at the manager\'s location with progress, state and what blocks them, Invite only for the candidate, with full test id coverage', async () => {
    await signIn();
    await open();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Onboarding');
    expect(screen.getByTestId(tid.tonb.toVerify)).toHaveTextContent('0 to verify');
    expect(screen.queryByTestId(tid.tonb.queue)).toBeNull();
    expect(screen.getByTestId(tid.tonb.progress('EMP002'))).toHaveTextContent('0/7');
    expect(screen.getByTestId(tid.tonb.state('EMP002'))).toHaveTextContent('Candidate');
    expect(screen.getByTestId(tid.tonb.state('EMP003'))).toHaveTextContent('Preboarding');
    expect(screen.getByTestId(tid.tonb.blocking('EMP003'))).toHaveTextContent(/^Personal details not completed · Contact information not completed \+\d+$/);
    expect(screen.getByTestId(tid.tonb.invite('EMP002'))).toBeInTheDocument();
    expect(screen.queryByTestId(tid.tonb.invite('EMP003'))).toBeNull();
    expect(screen.getByTestId(tid.tonb.row('EMP002'))).toHaveTextContent('28/09/2026');
    expectTestIdCoverage(document.body);
  });

  test('a document is checked in front of the checker: rejecting without a reason is refused at the field, with one it is rejected; another is verified', async () => {
    sent();
    await signIn();
    await open();
    expect(screen.getByTestId(tid.tonb.toVerify)).toHaveTextContent('2 to verify');
    const queue = screen.getByTestId(tid.tonb.queue);
    expect(within(queue).getByTestId(tid.tonb.queueRow('EMP003', 'photo'))).toHaveTextContent('Tom Achterberg');
    await userEvent.click(screen.getByTestId(tid.tonb.check('EMP003', 'photo')));
    const modal = await screen.findByTestId(tid.modal.root);
    expect(modal).toHaveTextContent('File');
    expect(modal).toHaveTextContent('Uploaded');
    expect(modal).toHaveTextContent('Stops them starting');
    expect(screen.getByTestId(tid.tonb.checkNoPreview)).toHaveTextContent('face.pdf');
    expectTestIdCoverage(document.body);

    await userEvent.click(screen.getByTestId(tid.tonb.reject));
    await waitFor(() => expect(screen.getByTestId(tid.field.root(tid.tonb.reason))).toHaveTextContent(REASON_NEEDED));
    expect(caseOf('EMP003').docs.photo).toBe('done');
    expect(acts()).toEqual([]);

    fireEvent.change(screen.getByTestId(tid.tonb.reason), { target: { value: 'The photograph is too dark to read' } });
    await userEvent.click(screen.getByTestId(tid.tonb.reject));
    await expectToast('Photograph rejected. Tom Achterberg has been told.');
    await waitFor(() => expect(screen.queryByTestId(tid.modal.root)).toBeNull());
    expect(caseOf('EMP003')).toMatchObject({ docs: { photo: 'rejected' }, rejections: { photo: 'The photograph is too dark to read' } });
    await waitFor(() => expect(screen.getByTestId(tid.tonb.toVerify)).toHaveTextContent('1 to verify'));

    await userEvent.click(screen.getByTestId(tid.tonb.check('EMP003', 'addr')));
    await userEvent.click(await screen.findByTestId(tid.tonb.verify));
    await expectToast(/verified\./);
    expect(caseOf('EMP003').docs.addr).toBe('verified');
    await waitFor(() => expect(screen.queryByTestId(tid.tonb.queue)).toBeNull());
    expect(acts()).toEqual(['Onboarding document rejected', 'Onboarding document verified']);
  });

  test('Invite moves the candidate to preboarding and says no email is sent', async () => {
    await signIn();
    await open();
    await userEvent.click(screen.getByTestId(tid.tonb.invite('EMP002')));
    await expectToast('Priya Raman is invited. They sign in with priya.raman@dogmagroup.co.uk. No email is sent in this build.');
    await waitFor(() => expect(screen.getByTestId(tid.tonb.state('EMP002'))).toHaveTextContent('Preboarding'));
    expect(screen.queryByTestId(tid.tonb.invite('EMP002'))).toBeNull();
    expect(acts()).toEqual(['Onboarding invited']);
  });

  test('Invite without a work email is refused with the reason, and nothing is written', async () => {
    const p = personOf('EMP002');
    store.coll('people')[p.id] = { ...p, email: '' };
    await signIn();
    await open();
    await userEvent.click(screen.getByTestId(tid.tonb.invite('EMP002')));
    await expectToast(noEmailText('Priya Raman'), tid.toast.error);
    expect(personOf('EMP002').state).toBe('candidate');
    expect(acts()).toEqual([]);
  });

  test('Start them with anything outstanding opens the not-ready dialog with the list, and Chase them reminds the starter', async () => {
    await signIn();
    await open();
    await userEvent.click(screen.getByTestId(tid.tonb.start('EMP003')));
    const modal = await screen.findByTestId(tid.modal.root);
    expect(modal).toHaveTextContent('Tom Achterberg is not ready to start');
    expect(screen.getByTestId(tid.tonb.blocker(0))).toHaveTextContent('Personal details not completed');
    expect(acts()).toEqual([]);
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.tonb.chase));
    await expectToast(/^Tom Achterberg reminded\. \d+ outstanding\.$/);
    expect(acts()).toEqual(['Onboarding chased']);
    expect(personOf('EMP003').state).toBe('preboard');
  });

  test('the server stays the authority: a start it refuses as not ready opens the dialog, and closing it reads the list again', async () => {
    complete();
    await signIn();
    await open();
    await waitFor(() => expect(screen.getByTestId(tid.tonb.blocking('EMP003'))).toHaveTextContent('Nothing'));
    /* the right to work is sent back after the page was read */
    caseOf('EMP003').docs.rtw = 'rejected';
    await userEvent.click(screen.getByTestId(tid.tonb.start('EMP003')));
    await expectToast('Tom Achterberg cannot start yet. 1 outstanding. Right to work not verified.', tid.toast.error);
    expect(await screen.findByTestId(tid.tonb.notReady)).toHaveTextContent('Right to work not verified');
    expect(personOf('EMP003').state).toBe('preboard');
    await userEvent.click(screen.getByTestId(tid.tonb.notReadyClose));
    await waitFor(() => expect(screen.getByTestId(tid.tonb.blocking('EMP003'))).toHaveTextContent('Right to work not verified'));
    expect(acts()).toEqual([]);
  });
});

describe('Team onboarding: starting, adding and who sees which action', () => {
  test('with nothing outstanding Start them makes the starter active, and they leave the list', async () => {
    complete();
    await signIn();
    await open();
    await userEvent.click(screen.getByTestId(tid.tonb.start('EMP003')));
    await expectToast('Tom Achterberg is active. They can now be scheduled and paid.');
    await waitFor(() => expect(screen.queryByTestId(tid.tonb.row('EMP003'))).toBeNull());
    expect(personOf('EMP003').state).toBe('active');
    expect(audits().find(a => a.act === 'Employee active')?.reason).toBe(START_REASON);
  });

  test('Add a new starter opens the person form already set to candidate, and the new starter appears on the tracker', async () => {
    await signIn();
    await open();
    await userEvent.click(screen.getByTestId(tid.tonb.add));
    await screen.findByTestId(tid.personForm.root);
    expect(screen.getByTestId(tid.personForm.field('state'))).toHaveTextContent('Candidate');
    fireEvent.change(screen.getByTestId(tid.personForm.field('name')), { target: { value: 'Sarah Lindqvist' } });
    fireEvent.change(screen.getByTestId(tid.personForm.field('email')), { target: { value: 'sarah.lindqvist@dogmagroup.co.uk' } });
    await userEvent.click(screen.getByTestId(tid.personForm.save));
    await waitFor(() => expect(screen.queryByTestId(tid.personForm.root)).toBeNull());
    const row = await screen.findByText('Sarah Lindqvist');
    expect(row.closest('tr')).toHaveTextContent('0/7');
  });

  test('an empty tracker says nobody is onboarding here and offers Add a new starter as the way in', async () => {
    for (const code of ['EMP002', 'EMP003']) personOf(code).state = 'active';
    await signIn();
    await open();
    const empty = await screen.findByTestId(tid.tonb.empty);
    expect(screen.queryByTestId(tid.tonb.table)).toBeNull();
    expect(empty).toHaveTextContent('Nobody is onboarding at Manchester.');
    const add = within(empty).getByTestId(tid.tonb.addEmpty);
    expect(add).toHaveTextContent('Add a new starter');
    await userEvent.click(add);
    await screen.findByTestId(tid.personForm.root);
    expect(screen.getByTestId(tid.personForm.field('state'))).toHaveTextContent('Candidate');
  });

  test('each action shows only to the holder of its capability', async () => {
    sent();
    revoke('onb_track', 'emp_crud');
    await signIn();
    await open();
    expect(screen.getByTestId(tid.tonb.check('EMP003', 'photo'))).toBeInTheDocument();
    expect(screen.queryByTestId(tid.tonb.invite('EMP002'))).toBeNull();
    expect(screen.queryByTestId(tid.tonb.start('EMP003'))).toBeNull();
    expect(screen.queryByTestId(tid.tonb.add)).toBeNull();
  });

  test('without Verify onboarding documents the queue is shown but nothing can be checked from it', async () => {
    sent();
    revoke('onb_verify');
    await signIn();
    await open();
    expect(screen.getByTestId(tid.tonb.queueRow('EMP003', 'photo'))).toBeInTheDocument();
    expect(screen.queryByTestId(tid.tonb.check('EMP003', 'photo'))).toBeNull();
    expect(screen.getByTestId(tid.tonb.start('EMP003'))).toBeInTheDocument();
  });
});
