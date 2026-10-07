import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { pick } from './support/read';
import { signInEmail } from './support/timesheet';
import { POLICIES, TOM, myCase, onbAudit, onbNotes, pdf, png, uploadDoc } from './support/onboarding';

/* Module 5, the new starter's journey on qnipay (brief group 6, D3, D8):
   Tom Achterberg, preboarding, signs in and lands on his portal, the only
   page he has. He completes every step, uploads his three documents (the
   photograph as an image, which keeps a small preview; the others as PDFs),
   acknowledges every policy, signs and submits, and sees the thank-you page
   with his reference. Every outcome is read back from the server. */
test.beforeEach(async ({ api }) => { await api.seed('qnipay'); await api.setClock(FROZEN); });
const info = (page: import('@playwright/test').Page, text: string | RegExp) => page.getByTestId(tid.toast.info).filter({ hasText: text });

test('a new starter lands on the portal alone, completes every step, uploads, acknowledges, signs and submits, and sees the reference', async ({ page, api }) => {
  test.setTimeout(120_000);
  await signInEmail(page, TOM);
  /* D8: the portal and nothing else */
  await expect(page).toHaveURL(/\/work\/onb$/);
  await expect(page.locator('nav[aria-label="Pages"] a[data-testid^="nav-tab-"]')).toHaveCount(1);
  await expect(page.getByTestId(tid.nav.tab('onb'))).toBeVisible();
  for (const g of ['team', 'setup']) await expect(page.getByTestId(tid.nav.group(g))).toHaveCount(0);
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Welcome, Tom');
  await expect(page.getByTestId(tid.onb.progress)).toHaveText('0 of 7 done');
  const next = page.getByTestId(tid.onb.next);
  const body = (id: string) => page.getByTestId(tid.onb.body(id));

  /* personal: refused at its field until it is filled */
  await next.click();
  await expect(page.getByTestId(tid.field.root(tid.onb.field('dob')))).toContainText('A date of birth is required.');
  await page.getByTestId(tid.onb.field('dob')).fill('1990-03-02');
  await page.getByTestId(tid.onb.field('nat')).fill('Dutch');
  await page.getByTestId(tid.onb.field('ni')).fill('qq123456c');
  await next.click();
  await expect(info(page, 'Personal details saved.')).toBeVisible();
  await body('contact').waitFor();

  await page.getByTestId(tid.onb.field('mob')).fill('07700 900321');
  await page.getByTestId(tid.onb.field('a1')).fill('12 Canal Street');
  await page.getByTestId(tid.onb.field('city')).fill('Manchester');
  await page.getByTestId(tid.onb.field('post')).fill('M1 3HE');
  await next.click();
  await body('emergency').waitFor();

  await page.getByTestId(tid.onb.contactField(0, 'nm')).fill('Sanne Achterberg');
  await pick(page, tid.onb.contactField(0, 'rel'), 'partner');
  await page.getByTestId(tid.onb.contactField(0, 'ph')).fill('07700 900654');
  await next.click();
  await body('additional').waitFor();

  await pick(page, tid.onb.field('conv'), 'no');
  await pick(page, tid.onb.field('wtd'), 'no-i-do-not-opt-out');
  await next.click();
  await body('documents').waitFor();
  await expect(page.getByTestId(tid.onb.progress)).toHaveText('4 of 7 done');

  /* documents: what the build keeps is said plainly (D3) */
  await expect(page.getByTestId(tid.onb.filesNote)).toContainText('They are not sent to a document store.');
  await pick(page, tid.onb.field('rtwType'), 'passport');
  await uploadDoc(page, 'rtw', pdf('passport.pdf'));
  await expect(info(page, 'Right to work: passport.pdf is waiting to be checked.')).toBeVisible();
  await uploadDoc(page, 'addr', pdf('council-tax.pdf'));
  await expect(info(page, 'Proof of address: council-tax.pdf is waiting to be checked.')).toBeVisible();
  await uploadDoc(page, 'photo', png('tom.png'));
  await expect(info(page, 'Photograph: tom.png is waiting to be checked.')).toBeVisible();
  for (const d of ['rtw', 'addr', 'photo']) await expect(page.getByTestId(tid.onb.docState(d))).toContainText('Submitted');
  await expect(page.getByTestId(tid.onb.docFile('photo')).locator('img')).toHaveCount(1);
  /* the image's downscaled preview opens in the View dialog; a PDF is named, not previewed */
  await page.getByTestId(tid.onb.docView('photo')).click();
  await expect(page.getByTestId(tid.onb.viewImage)).toBeVisible();
  await expect(page.getByTestId(tid.onb.viewImage)).toHaveAttribute('src', /^data:image\/jpeg;base64,/);
  await expect(page.getByTestId(tid.onb.viewNoPreview)).toHaveCount(0);
  await page.getByTestId(tid.onb.viewClose).click();
  await expect(page.getByTestId(tid.onb.viewImage)).toHaveCount(0);
  await next.click();
  await body('policies').waitFor();

  /* policies: each ticked at the version shown */
  for (const [n, p] of POLICIES.entries()) {
    await page.getByTestId(tid.onb.polAck(p)).click();
    await expect(page.getByTestId(tid.onb.polCount)).toHaveText(`${n + 1} of 4`);
  }
  await next.click();
  await body('review').waitFor();

  /* review: everything complete; sign and confirm, then submit */
  await expect(page.getByTestId(tid.onb.complete)).toBeVisible();
  await expect(page.getByTestId(tid.onb.review('doc-rtw'))).toContainText('Submitted');
  await page.getByTestId(tid.onb.sign).fill('Tom Achterberg');
  await page.getByTestId(tid.onb.consent).click();
  await page.getByTestId(tid.onb.submit).click();
  await expect(info(page, 'Submitted with reference ONB-1001. HR has been told.')).toBeVisible();
  await expect(page.getByTestId(tid.onb.submitted)).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Thank you, Tom');
  await expect(page.getByTestId(tid.onb.ref)).toHaveText(/ONB-1001/);
  await expect(page.getByTestId(tid.onb.sentBack)).toHaveCount(0);

  /* what the server holds */
  const mine = await myCase(api);
  expect(mine.case).toMatchObject({
    ref: 'ONB-1001', signature: 'Tom Achterberg', consent: true, submittedAt: FROZEN,
    steps: { personal: 'done', contact: 'done', emergency: 'done', additional: 'done', documents: 'done', policies: 'done' },
    docs: { rtw: 'done', addr: 'done', photo: 'done' }, acks: { pol_conduct: 'v4.1', pol_privacy: 'v2.0', pol_handbook: 'v7.3', pol_itsec: 'v3.2' },
  });
  expect(mine.case.files.photo?.preview).toMatch(/^data:image\/jpeg;base64,/);
  expect(mine.case.files.rtw?.preview).toBeUndefined();
  expect(mine.progress.text).toBe('7 of 7 done');
  /* one audit row per write; the manager (and the document checkers) are told */
  const acts = (await onbAudit(page)).map(a => a.act);
  expect(acts.filter(a => a === 'Onboarding document uploaded')).toHaveLength(3);
  expect(acts.filter(a => a === 'Policy acknowledged')).toHaveLength(4);
  expect(acts.filter(a => a === 'Onboarding submitted')).toHaveLength(1);
  expect((await onbNotes(page)).filter(n => n.personId === 'EMP001').map(n => n.body).join(' ')).toContain('Tom Achterberg');
});
