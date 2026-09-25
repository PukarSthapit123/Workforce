import { test, expect } from './support/fixtures';

/* No page renders a Modal yet (Shell and its screens arrive in Task 8+), so
   there is nothing to click open here. Instead this checks the exact compiled
   Tailwind rule Modal/Dialog depends on (`sm:max-w-lg`, the literal class in
   src/ui/shadcn/dialog.tsx) directly: Tailwind compiles utility CSS by
   scanning source text, not rendered DOM, so the rule already exists in the
   page's stylesheet whether or not anything on screen currently uses it.
   Appending a throwaway element with that class and reading its computed
   style is a real browser, real compiled CSS check for the same regression
   as src/theme.test.ts's source-level check: the named --spacing-* scale
   (src/index.css) hijacking Tailwind's max-width scale, which used to make
   every max-w-* (Modal included) collapse to a spacing-sized box. */
test('the compiled sm:max-w-lg utility resolves to a container width, not a spacing value', async ({ page }) => {
  await page.goto('/');
  const maxWidthPx = await page.evaluate(() => {
    const el = document.createElement('div');
    el.className = 'sm:max-w-lg';
    document.body.appendChild(el);
    const px = parseFloat(getComputedStyle(el).maxWidth);
    el.remove();
    return px;
  });
  expect(maxWidthPx).toBeGreaterThan(300);
});
