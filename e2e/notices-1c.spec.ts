import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { AMARA, RACHEL, auditRows, inboxOf, info } from './support/config';

/* 1c, the notice board (D10) on social: Rachel Hussain posts to Willow House
   from My team → Notices; Amara Okafor, who works there, is told in her inbox,
   reads it and acknowledges the version she read; Rachel changes its words,
   which makes v2 and asks everyone again, and a stale acknowledgement of v1
   is refused; then she withdraws it with a reason, and it stays on her list
   as withdrawn while colleagues no longer see it. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });
const TITLE = 'Hand hygiene audit next week';

test('a notice is posted and acknowledged, its words changed so it is acknowledged again, and then withdrawn with a reason, staying on record', async ({ page, api }) => {
  test.setTimeout(120_000);
  await signInEmail(page, RACHEL);
  await page.goto('/team/tnotices');
  await page.getByTestId(tid.tnotices.table).waitFor();
  await page.getByTestId(tid.tnotices.add).click();
  const box = page.getByTestId(tid.modal.root);
  await box.getByTestId(tid.tnotices.title).fill(TITLE);
  await box.getByTestId(tid.tnotices.body).fill('Every sink will be checked on Tuesday.');
  await expect(box.getByTestId(tid.tnotices.mustAck)).toBeChecked();
  await box.getByTestId(tid.tnotices.postNow).click();
  await expect(info(page, `Posted. ${TITLE}. 11 people in Willow House.`)).toBeVisible();
  await expect(page.getByTestId(tid.tnotices.acks('NTC-0005'))).toHaveText(/0 of 11/);

  /* Amara is told in her inbox, and the item opens Notices */
  await signInEmail(page, AMARA);
  const told = (await inboxOf(api)).items.find(n => n.area === 'Notices' && !n.read);
  expect(told?.link?.path).toBe('/work/notices');
  await page.getByTestId(tid.shell.bell).click();
  await page.getByTestId(tid.inbox.item(told?.id ?? '')).click();
  await expect(page).toHaveURL(/\/work\/notices$/);
  await page.getByTestId(tid.notices.table).waitFor();
  await expect.poll(async () => (await inboxOf(api)).items.find(n => n.id === told?.id)?.read).toBe(true);

  /* she reads it and acknowledges v1, once */
  await expect(page.getByTestId(tid.notices.you('NTC-0005'))).toContainText('Acknowledge');
  await page.getByTestId(tid.notices.read('NTC-0005')).click();
  await expect(box.getByTestId(tid.notices.readMeta)).toContainText('Willow House · v1 · Rachel Hussain · 13/08/2026');
  await box.getByTestId(tid.notices.readAck).click();
  await expect(info(page, `Acknowledged. ${TITLE} v1. Whoever posted it can see this.`)).toBeVisible();
  await expect(page.getByTestId(tid.notices.you('NTC-0005'))).toContainText('Acknowledged 13/08');
  const again = await api.send('POST', '/api/v1/notices/NTC-0005/acknowledge', { textVersion: 1 });
  expect([again.status, (again.body as { code: string }).code, (again.body as { message: string }).message])
    .toEqual([409, 'ALREADY_ACKNOWLEDGED', 'Already acknowledged. You acknowledged v1.']);

  /* Rachel sees it, then changes the words: v2, and everyone is asked again */
  await signInEmail(page, RACHEL);
  await page.goto('/team/tnotices');
  await expect(page.getByTestId(tid.tnotices.acks('NTC-0005'))).toHaveText(/1 of 11/);
  await page.getByTestId(tid.tnotices.open('NTC-0005')).click();
  await expect(box.getByTestId(tid.tnotices.trackStatus('CP-1042'))).toContainText('v1');
  await box.getByTestId(tid.tnotices.trackEdit).click();
  await expect(box.getByTestId(tid.tnotices.resetWarn)).toContainText('1 person has acknowledged v1');
  await box.getByTestId(tid.tnotices.body).fill('Every sink and every dispenser will be checked on Tuesday.');
  await box.getByTestId(tid.tnotices.save).click();
  await expect(info(page, 'Saved as v2. 11 people now need to acknowledge it.')).toBeVisible();
  await expect(page.getByTestId(tid.tnotices.acks('NTC-0005'))).toHaveText(/0 of 11/);

  /* Amara is asked again; the v1 she read is no longer enough */
  await signInEmail(page, AMARA);
  await page.goto('/work/notices');
  await expect(page.getByTestId(tid.notices.you('NTC-0005'))).toContainText('Updated, acknowledge again');
  const stale = await api.send('POST', '/api/v1/notices/NTC-0005/acknowledge', { textVersion: 1 });
  expect([stale.status, (stale.body as { code: string }).code]).toEqual([409, 'CHANGED']);
  await page.getByTestId(tid.notices.read('NTC-0005')).click();
  await expect(box.getByTestId(tid.notices.readChanged)).toContainText('This notice changed after you acknowledged it');
  await box.getByTestId(tid.notices.readAck).click();
  await expect(info(page, `Acknowledged. ${TITLE} v2. Whoever posted it can see this.`)).toBeVisible();

  /* withdrawing needs a reason; then it stays on Rachel's list, withdrawn */
  await signInEmail(page, RACHEL);
  await page.goto('/team/tnotices');
  await page.getByTestId(tid.tnotices.open('NTC-0005')).click();
  await box.getByTestId(tid.tnotices.trackWithdraw).click();
  await box.getByTestId(tid.tnotices.withdrawOk).click();
  await expect(box).toContainText('Give a reason. Colleagues who acknowledged keep their record.');
  await box.getByTestId(tid.tnotices.reason).fill('Audit moved to next month');
  await box.getByTestId(tid.tnotices.withdrawOk).click();
  await expect(info(page, `Withdrawn. ${TITLE}. Colleagues no longer see it. The record stays on My team → Notices.`)).toBeVisible();
  await expect(page.getByTestId(tid.tnotices.state('NTC-0005'))).toContainText('Withdrawn');
  await page.getByTestId(tid.tnotices.open('NTC-0005')).click();
  await expect(box.getByTestId(tid.tnotices.trackWithdrawn)).toContainText('Audit moved to next month');
  await expect(box.getByTestId(tid.tnotices.trackStatus('CP-1042'))).toContainText('v2');

  await signInEmail(page, AMARA);
  await page.goto('/work/notices');
  await page.getByTestId(tid.notices.table).waitFor();
  await expect(page.getByTestId(tid.notices.row('NTC-0005'))).toHaveCount(0);
  expect((await auditRows(page, 'notice')).map(a => a.act)).toEqual(
    ['Notice posted', 'Notice acknowledged', 'Notice edited', 'Notice acknowledged', 'Notice withdrawn']);
});
