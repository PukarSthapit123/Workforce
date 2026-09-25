import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const css = readFileSync(resolve(__dirname, 'index.css'), 'utf8');
const darkBlockMatch = css.match(/\[data-theme="dark"\]\s*\{[^}]*\}/);
const darkBlock = darkBlockMatch ? darkBlockMatch[0] : '';

test('a [data-theme="dark"] block exists in the theme file', () => {
  expect(darkBlockMatch).not.toBeNull();
});

test('dark theme re-points --primary to the brand accent, not a fixed value (prototype line 406: dark CTAs swap to the lime accent, never lost)', () => {
  expect(darkBlock).toMatch(/--primary:\s*var\(--qp-color-brand-accent\)/);
  expect(darkBlock).toMatch(/--primary-foreground:\s*var\(--qp-color-text-on-accent\)/);
  expect(darkBlock).toMatch(/--ring:\s*var\(--qp-color-brand-accent\)/);
});

test('the dark theme block is declared after :root, so it wins the tie in specificity on <html data-theme="dark">', () => {
  const rootIndex = css.indexOf(':root {');
  const darkIndex = css.indexOf('[data-theme="dark"] {');
  expect(rootIndex).toBeGreaterThanOrEqual(0);
  expect(darkIndex).toBeGreaterThan(rootIndex);
});

test('the @theme block aliases --max-width-{xs..3xl} to the container scale, so max-w-* is not hijacked by the named --spacing-* scale', () => {
  /* Tailwind resolves a named max-w-<key> utility against --max-width-<key>,
     then --spacing-<key>, then --container-<key>. This file also defines
     --spacing-xs/sm/md/lg/xl/2xl/3xl (for p-md, gap-lg, etc.), which share
     their names with Tailwind's built-in container scale; without an explicit
     --max-width-<key> alias, max-w-md (and Modal/Dialog's sm:max-w-lg) would
     silently resolve to the small spacing value instead of a container width.
     See src/index.css's @theme inline block for the fix and full explanation. */
  for (const key of ['xs', 'sm', 'md', 'lg', 'xl', '2xl', '3xl']) {
    const re = new RegExp(`--max-width-${key}:\\s*var\\(--container-${key}\\)`);
    expect(css).toMatch(re);
  }
});
