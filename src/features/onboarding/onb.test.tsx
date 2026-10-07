import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { store } from '@/mocks/store';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import type { OnboardingCaseRecord } from '@/contract/onboarding';
import { CONSENT_NEEDED, SIGNATURE_NEEDED, STEP_MESSAGES, acknowledgeFirstText, tooLargeText } from '@/domain/onboarding';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { renderPage, withFakeServer } from '@/test/render-page';
import { audits, resetTo } from '@/test/api-helpers';
import { OnboardingPage } from './OnboardingPage';

/* The qnipay seed at the frozen clock (13/08/2026): Priya Raman (EMP002) is a
   candidate starting on 28/09/2026 with an empty case, every Onboarding
   feature on, three required documents (right to work, proof of address,
   photograph) and four policies (Code of conduct v4.1, Privacy notice v2.0,
   Employee handbook v7.3, IT and data security v3.2). */
withFakeServer();
beforeEach(() => resetTo('qnipay'));
const PRIYA = 'priya.raman@dogmagroup.co.uk';
const signIn = async (email = PRIYA) => {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const body = (await r.json()) as { token?: string };
  if (!body.token) throw new Error(`sign-in as ${email} failed`);
  setToken(body.token);
};
const caseNow = () => {
  const c = store.coll<OnboardingCaseRecord>('onboardingCases').onb_EMP002;
  if (!c) throw new Error('no case for EMP002');
  return c;
};
const acts = () => audits().filter(a => a.act !== 'Signed in').map(a => a.act);
const toasts = (id: string = tid.toast.info) => screen.queryAllByTestId(id).map(t => t.textContent ?? '').join(' | ');
const expectToast = (text: string | RegExp, id: string = tid.toast.info) => waitFor(() => expect(toasts(id)).toMatch(text));
const fieldOf = (testId: string) => screen.getByTestId(tid.field.root(testId));
const open = async () => {
  renderPage(<OnboardingPage />, '/work/onb');
  return screen.findByTestId(tid.onb.rail);
};
const goTo = async (step: string) => {
  await userEvent.click(screen.getByTestId(tid.onb.step(step)));
  return screen.findByTestId(tid.onb.body(step));
};
const AT = '2026-08-13T10:00:00.000Z';
const pdf = (name: string) => ({ name, size: 2048, type: 'application/pdf', at: AT, kind: 'pdf' as const });
/* Everything but the review done, every required document waiting on a check, every policy acknowledged. */
function readyToSubmit() {
  const c = caseNow();
  Object.assign(c, {
    steps: { personal: 'done', contact: 'done', emergency: 'done', additional: 'done', documents: 'done', policies: 'done' },
    docs: { rtw: 'done', addr: 'done', photo: 'done' }, files: { rtw: pdf('passport.pdf'), addr: pdf('bill.pdf'), photo: pdf('photo.pdf') },
    acks: { pol_conduct: 'v4.1', pol_privacy: 'v2.0', pol_handbook: 'v7.3', pol_itsec: 'v3.2' },
    data: { ...c.data, personal: { dob: '1994-05-14', gender: '', nat: 'British', ni: 'QQ123456C' },
      contact: { mob: '07700 900123', alt: '', a1: '4 Mill Lane', a2: '', city: 'Manchester', post: 'M50 2YR' },
      emergency: [{ nm: 'Anita Raman', rel: 'Parent', ph: '07700 900456' }], additional: { conv: 'No', convDetail: '', wtd: 'No, I do not opt out', quals: [] },
      documents: { rtwType: 'Passport' } },
  });
}

describe('My onboarding', () => {
  test('the portal greets them, shows the steps with their fields, refuses an incomplete step at its field and moves on once it is done', async () => {
    await signIn();
    await open();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Welcome, Priya');
    expect(screen.getByTestId(tid.onb.progress)).toHaveTextContent('0 of 7 done');
    expect(within(screen.getByTestId(tid.onb.rail)).getAllByRole('button')).toHaveLength(7);
    expect(screen.getByTestId(tid.onb.step('personal'))).toHaveAttribute('aria-current', 'step');
    expect(screen.getByTestId(tid.onb.field('dob'))).toHaveAttribute('type', 'date');
    expect(screen.getByTestId(tid.onb.field('email'))).toHaveAttribute('type', 'email');
    expect(screen.getByTestId(tid.onb.field('email'))).toBeDisabled();
    expect(screen.getByTestId(tid.onb.field('ni'))).toHaveAttribute('maxlength', '13');
    expect(screen.getByTestId(tid.onb.saved)).toHaveTextContent('All changes saved');
    expect(screen.queryByTestId(tid.onb.back)).toBeNull();
    expectTestIdCoverage(document.body);

    await userEvent.click(screen.getByTestId(tid.onb.next));
    await waitFor(() => expect(fieldOf(tid.onb.field('dob'))).toHaveTextContent(STEP_MESSAGES.dob));
    expect(screen.getByTestId(tid.onb.body('personal'))).toBeInTheDocument();
    expect(acts()).toEqual([]);

    await userEvent.type(screen.getByTestId(tid.onb.field('dob')), '1994-05-14');
    expect(screen.getByTestId(tid.onb.saved)).toHaveTextContent('Changes not saved yet');
    await userEvent.type(screen.getByTestId(tid.onb.field('nat')), 'British');
    await userEvent.type(screen.getByTestId(tid.onb.field('ni')), 'qq123456c');
    await userEvent.click(screen.getByTestId(tid.onb.next));
    await expectToast('Personal details saved.');
    await screen.findByTestId(tid.onb.body('contact'));
    expect(screen.getByTestId(tid.onb.step('personal'))).toHaveTextContent('✓');
    expect(screen.getByTestId(tid.onb.progress)).toHaveTextContent('1 of 7 done');
    expect(caseNow().data.personal).toMatchObject({ dob: '1994-05-14', nat: 'British', ni: 'QQ123456C' });
    expect(acts()).toEqual(['Onboarding step completed']);

    /* Back with nothing changed saves nothing */
    await userEvent.click(screen.getByTestId(tid.onb.back));
    await screen.findByTestId(tid.onb.body('personal'));
    expect(screen.getByTestId(tid.onb.field('ni'))).toHaveValue('QQ123456C');
    expect(acts()).toHaveLength(1);

    /* emergency contacts: a second can be added and removed; only the first is required */
    await goTo('emergency');
    await userEvent.click(screen.getByTestId(tid.onb.contactAdd));
    expect(screen.getByTestId(tid.onb.contact(1))).toBeInTheDocument();
    await userEvent.click(screen.getByTestId(tid.onb.contactRemove(1)));
    expect(screen.queryByTestId(tid.onb.contact(1))).toBeNull();

    /* additional: the statutory notes are the prototype's words */
    await goTo('additional');
    expect(document.body).toHaveTextContent('A declaration does not by itself prevent you starting.');
    expect(document.body).toHaveTextContent('An opt-out is voluntary and you may withdraw it later by giving notice.');
    expect(screen.getByTestId(tid.onb.noQuals)).toHaveTextContent('None added.');
  });

  test('an upload over 8 MB is refused before it is read; a PDF is sent and waits to be checked', async () => {
    await signIn();
    await open();
    await goTo('documents');
    expect(screen.getByTestId(tid.onb.filesNote)).toHaveTextContent("Files are kept with this demo's saved data. They are not sent to a document store.");
    const read = vi.spyOn(FileReader.prototype, 'readAsDataURL');
    const big = new File(['x'], 'scan.png', { type: 'image/png' });
    Object.defineProperty(big, 'size', { value: 9 * 1024 * 1024 });
    await userEvent.click(screen.getByTestId(tid.onb.docUpload('rtw')));
    await userEvent.upload(screen.getByTestId(tid.onb.filePick), big);
    const tooBig = tooLargeText('scan.png', 9 * 1024 * 1024);
    expect(await screen.findByTestId(tid.onb.docError('rtw'))).toHaveTextContent(tooBig);
    await expectToast(tooBig, tid.toast.error);
    expect(read).not.toHaveBeenCalled();
    read.mockRestore();
    expect(caseNow().files).toEqual({});
    expect(acts()).toEqual([]);

    await userEvent.click(screen.getByTestId(tid.onb.docUpload('rtw')));
    await userEvent.upload(screen.getByTestId(tid.onb.filePick), new File(['%PDF'], 'passport.pdf', { type: 'application/pdf' }));
    await expectToast('Right to work: passport.pdf is waiting to be checked.');
    await waitFor(() => expect(screen.getByTestId(tid.onb.docState('rtw'))).toHaveTextContent('Submitted'));
    expect(screen.getByTestId(tid.onb.docFile('rtw'))).toHaveTextContent('passport.pdf');
    expect(screen.queryByTestId(tid.onb.docError('rtw'))).toBeNull();
    expect(screen.getByTestId(tid.onb.docUpload('rtw'))).toHaveTextContent('Replace');
    await userEvent.click(screen.getByTestId(tid.onb.docView('rtw')));
    expect(await screen.findByTestId(tid.onb.viewNoPreview)).toHaveTextContent('A PDF was uploaded');
    expectTestIdCoverage(document.body);
    expect(acts()).toEqual(['Onboarding document uploaded']);
  });

  test('the required marker is a marker beside the label, not part of it: the accessible name is the label alone and the field says it is required', async () => {
    await signIn();
    await open();
    for (const [key, label] of [['dob', 'Date of birth'], ['nat', 'Nationality'], ['ni', 'National insurance number']] as const) {
      const control = screen.getByTestId(tid.onb.field(key));
      expect(control).toHaveAccessibleName(label);
      expect(control).toHaveAttribute('aria-required', 'true');
      const marker = within(fieldOf(tid.onb.field(key))).getByText('required');
      expect(marker).toHaveAttribute('aria-hidden', 'true');
      expect(marker.closest('label')).toBeNull();
    }
    /* an optional field carries no marker */
    expect(within(fieldOf(tid.onb.field('gender'))).queryByText('required')).toBeNull();
    expect(screen.getByTestId(tid.onb.field('gender'))).not.toHaveAttribute('aria-required');
  });

  test('the acknowledgement is stated once, not three times: the step asks to tick, and only the read dialog says "I have read and understood"', async () => {
    await signIn();
    await open();
    const step = await goTo('policies');
    const count = (re: RegExp) => (document.body.textContent?.match(re) ?? []).length;
    expect(count(/I have read and understood/g)).toBe(0);
    expect(within(step).getAllByText(/tick to confirm/)).toHaveLength(1);
    await userEvent.click(screen.getByTestId(tid.onb.polRead('pol_conduct')));
    await screen.findByTestId(tid.onb.readBody);
    expect(count(/I have read and understood/g)).toBe(1);
    expect(count(/tick to confirm/g)).toBe(1);
  });

  test('a policy is read and acknowledged at the version shown; one left unticked is refused at the policy', async () => {
    await signIn();
    await open();
    await goTo('policies');
    expect(screen.getByTestId(tid.onb.polVer('pol_conduct'))).toHaveTextContent('v4.1');
    await userEvent.click(screen.getByTestId(tid.onb.polAck('pol_conduct')));
    await expectToast('Code of conduct v4.1 acknowledged.');
    await waitFor(() => expect(screen.getByTestId(tid.onb.polCount)).toHaveTextContent('1 of 4'));
    expect(caseNow().acks).toEqual({ pol_conduct: 'v4.1' });

    await userEvent.click(screen.getByTestId(tid.onb.polRead('pol_privacy')));
    expect(await screen.findByTestId(tid.onb.readBody)).toHaveTextContent('Your bank details are used for payment only.');
    // P's onb-read header: the name as the title, the version as the scope badge beside it.
    expect(screen.getByTestId(tid.modal.title)).toHaveTextContent(/^Privacy notice$/);
    expect(screen.getByTestId(tid.modal.title).parentElement).toHaveTextContent('Privacy noticev2.0');
    await waitFor(() => expect(caseNow().read.pol_privacy).toBe(true));
    await waitFor(() => expect(screen.getByTestId(tid.onb.readAck)).not.toHaveAttribute('aria-disabled'));
    expectTestIdCoverage(document.body);
    await userEvent.click(screen.getByTestId(tid.onb.readAck));
    await expectToast('Privacy notice v2.0 acknowledged.');
    await waitFor(() => expect(screen.queryByTestId(tid.onb.readBody)).toBeNull());

    await userEvent.click(screen.getByTestId(tid.onb.next));
    await waitFor(() => expect(screen.getByTestId(tid.onb.polError('pol_handbook'))).toHaveTextContent(acknowledgeFirstText('Employee handbook')));
    expect(acts()).toEqual(['Policy acknowledged', 'Policy opened', 'Policy acknowledged']);
  });

  test('submitting needs the confirmation and a typed signature, then shows the reference', async () => {
    readyToSubmit();
    await signIn();
    await open();
    await goTo('review');
    expect(screen.getByTestId(tid.onb.complete)).toBeInTheDocument();
    expect(screen.getByTestId(tid.onb.review('contact-0'))).toHaveTextContent('Anita Raman · 07700 900456');
    expect(screen.getByTestId(tid.onb.submit)).toHaveTextContent('Submit to HR');
    expectTestIdCoverage(document.body);

    await userEvent.click(screen.getByTestId(tid.onb.submit));
    await waitFor(() => expect(screen.getByTestId(tid.onb.consentError)).toHaveTextContent(CONSENT_NEEDED));
    await userEvent.click(screen.getByTestId(tid.onb.consent));
    expect(screen.queryByTestId(tid.onb.consentError)).toBeNull();
    await userEvent.click(screen.getByTestId(tid.onb.submit));
    await waitFor(() => expect(fieldOf(tid.onb.sign)).toHaveTextContent(SIGNATURE_NEEDED));
    expect(caseNow().submittedAt).toBe('');
    expect(acts()).toEqual([]);

    await userEvent.type(screen.getByTestId(tid.onb.sign), 'Priya Raman');
    await userEvent.click(screen.getByTestId(tid.onb.submit));
    await expectToast('Submitted with reference ONB-1001. HR has been told.');
    expect(await screen.findByTestId(tid.onb.submitted)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Thank you, Priya');
    expect(screen.getByTestId(tid.onb.ref)).toHaveTextContent('ONB-1001');
    expect(caseNow()).toMatchObject({ signature: 'Priya Raman', consent: true, ref: 'ONB-1001' });
    expect(acts()).toEqual(['Onboarding submitted']);
  });

  test('the submitted page shows the reference, a document sent back with its reason, and a policy asked again', async () => {
    readyToSubmit();
    Object.assign(caseNow(), {
      submittedAt: AT, ref: 'ONB-1004', steps: { ...caseNow().steps, review: 'done', documents: 'prog' },
      docs: { rtw: 'verified', addr: 'rejected', photo: 'done' }, rejections: { addr: 'The bill is older than three months.' },
      acks: { pol_conduct: 'v4.1', pol_privacy: 'v2.0', pol_itsec: 'v3.2' },
    });
    await signIn();
    renderPage(<OnboardingPage />, '/work/onb');
    expect(await screen.findByTestId(tid.onb.submitted)).toBeInTheDocument();
    expect(screen.getByTestId(tid.onb.ref)).toHaveTextContent('ONB-1004');
    expect(screen.getByTestId(tid.onb.submittedAt)).toHaveTextContent('13/08/2026 11:00');
    expect(screen.getByTestId(tid.onb.whatNext)).toHaveTextContent('If one is rejected you will be told why, and its step opens again here');
    expect(screen.getByTestId(tid.onb.whatNext)).toHaveTextContent('ask your manager');
    expect(within(screen.getByTestId(tid.onb.sentBack)).getByTestId(tid.onb.docReason('addr'))).toHaveTextContent('Reason: The bill is older than three months.');
    const again = screen.getByTestId(tid.onb.askedAgain);
    expect(within(again).getByTestId(tid.onb.pol('pol_handbook'))).toHaveTextContent('v7.3');
    expect(within(again).queryByTestId(tid.onb.pol('pol_conduct'))).toBeNull();
    expectTestIdCoverage(document.body);

    await userEvent.click(within(again).getByTestId(tid.onb.polRead('pol_handbook')));
    expect(await screen.findByTestId(tid.onb.readBody)).toBeInTheDocument();
    expect(screen.getByTestId(tid.modal.title)).toHaveTextContent(/^Employee handbook$/);
    expect(screen.getByTestId(tid.modal.title).parentElement).toHaveTextContent('Employee handbookv7.3');
    await userEvent.click(screen.getByTestId(tid.onb.readClose));
    await waitFor(() => expect(screen.queryByTestId(tid.onb.readBody)).toBeNull());

    await userEvent.click(screen.getByTestId(tid.onb.polAck('pol_handbook')));
    await expectToast('Employee handbook v7.3 acknowledged.');
    await waitFor(() => expect(screen.queryByTestId(tid.onb.askedAgain)).toBeNull());
  });
});
