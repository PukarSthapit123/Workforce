import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/* PROTOTYPE_PATH overrides the sibling-checkout default, as in lift-tokens.mjs (a git worktree sits deeper). */
const proto = readFileSync(process.env.PROTOTYPE_PATH || resolve(__dirname, '../../Qnipay workforce cc/mockup/qnipay-workforce-v15.html'), 'utf8');
const lifted = readFileSync(resolve(__dirname, '../src/ui/tokens.css'), 'utf8');
const defs = (s: string) => new Set([...s.matchAll(/(--qp-[a-z0-9-]+)\s*:/g)].map(m => m[1]));

test('every --qp token the prototype defines is lifted', () => {
  const missing = [...defs(proto)].filter(t => !defs(lifted).has(t));
  expect(missing).toEqual([]);
});

test('the dark theme block is lifted', () => {
  expect(lifted).toMatch(/\[data-theme="dark"\]\s*\{[\s\S]*--qp-color-surface-page/);
});

/* AGAINST THE DESIGN SYSTEM: "Semantic colour resolves to the palette, not to
   literals". Tier 1 (--qp-primary-500 and friends, defined earlier in this
   same file) is allowed a literal hex value: it IS the palette. Every
   --qp-color-* token is tier 2, "what the product actually reads" (see
   tokens.css's own comment), and must resolve through var() (or color-mix()
   of two var()-backed tiers, used for the dark theme's tinted surfaces),
   never restate a colour by itself. */
test('every --qp-color-* semantic token resolves via var() or color-mix(), never a literal', () => {
  const semantic = [...lifted.matchAll(/(--qp-color-[a-z0-9-]+):\s*([^;]+);/g)];
  expect(semantic.length).toBeGreaterThan(0);
  const literalOnes = semantic.filter(([, , value]) => !/^var\(--qp-/.test((value ?? '').trim()) && !/^color-mix\(/.test((value ?? '').trim()));
  expect(literalOnes.map(([, name]) => name)).toEqual([]);
});

/* AGAINST THE DESIGN SYSTEM: "White goes through the on-brand token": text
   placed on a brand-coloured surface (buttons, the inverse header) reads
   --qp-color-text-on-brand rather than a bare white literal, so a future
   rebrand only ever touches the token, never every place white was typed by
   hand. */
test('white goes through the on-brand token, not a literal', () => {
  expect(lifted).toMatch(/--qp-color-text-on-brand:\s*var\(--qp-white\)/);
});

test('every var(--qp-*) used in src resolves', async () => {
  const { globSync } = await import('node:fs');
  const files = globSync('src/**/*.{ts,tsx,css}', { cwd: resolve(__dirname, '..') });
  const used = new Set<string>();
  // a --qp-* var can resolve against the lifted prototype tokens, or against
  // one defined by hand in src (e.g. src/index.css naming a value the
  // prototype's flat token set has no name for, such as dark-mode
  // text-on-accent ink) — either is a real definition, not a typo.
  const defined = new Set(defs(lifted));
  for (const f of files) {
    const content = readFileSync(resolve(__dirname, '..', f), 'utf8');
    for (const t of defs(content)) defined.add(t);
    for (const m of content.matchAll(/var\((--qp-[a-z0-9-]+)\)/g)) {
      const token = m[1];
      if (token) used.add(token);
    }
  }
  expect([...used].filter(u => !defined.has(u))).toEqual([]);
});
