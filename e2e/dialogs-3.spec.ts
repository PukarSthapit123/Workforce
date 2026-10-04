import { test, expect, FROZEN } from './support/fixtures';
import { tid } from '../src/testids';
import { signInEmail } from './support/timesheet';
import { RACHEL } from './support/rota';

/* Module 3, what only a real browser can measure: the working pattern windows
   open at the wide dialog size (min(900px, 100vw - 32px)), not the normal
   620px, and the add-people window sets its two columns side by side. */
test.beforeEach(async ({ api }) => { await api.seed('social'); await api.setClock(FROZEN); });

test('the pattern editor opens wide, and the add-people dialog is wide enough for its two columns side by side', async ({ page }) => {
  await signInEmail(page, RACHEL);
  await page.goto('/team/tpat');
  await page.getByTestId(tid.tpat.open('WP-02')).click();
  await page.getByTestId(tid.tpat.editor).waitFor();
  const editor = await page.getByTestId(tid.modal.root).boundingBox();
  expect(editor?.width ?? 0).toBeGreaterThanOrEqual(880);

  await page.getByTestId(tid.tpat.editorAdd).click();
  await expect(page.getByTestId(tid.modal.title)).toContainText('Add people to');
  const dialog = await page.getByTestId(tid.modal.root).boundingBox();
  expect(dialog?.width ?? 0).toBeGreaterThanOrEqual(880);
  /* who to add on the left, where they start on the right, level with each other */
  const who = await page.getByTestId(/^tpat-pick-CP-/).first().boundingBox();
  const where = await page.getByTestId(tid.tpat.pickMode).boundingBox();
  if (!who || !where) throw new Error('the add-people columns did not render');
  expect(where.x).toBeGreaterThan(who.x + 300);
  expect(Math.abs(where.y - who.y)).toBeLessThan(80);
});
