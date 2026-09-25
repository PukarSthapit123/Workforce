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
