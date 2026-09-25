import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const proto = readFileSync(resolve(__dirname, '../../Qnipay workforce cc/mockup/qnipay-workforce-v15.html'), 'utf8');
const lifted = readFileSync(resolve(__dirname, '../src/ui/tokens.css'), 'utf8');
const defs = (s: string) => new Set([...s.matchAll(/(--qp-[a-z0-9-]+)\s*:/g)].map(m => m[1]));

test('every --qp token the prototype defines is lifted', () => {
  const missing = [...defs(proto)].filter(t => !defs(lifted).has(t));
  expect(missing).toEqual([]);
});

test('the dark theme block is lifted', () => {
  expect(lifted).toMatch(/\[data-theme="dark"\]\s*\{[\s\S]*--qp-color-surface-page/);
});

test('every var(--qp-*) used in src resolves', async () => {
  const { globSync } = await import('node:fs');
  const files = globSync('src/**/*.{ts,tsx,css}', { cwd: resolve(__dirname, '..') });
  const used = new Set<string>();
  for (const f of files) for (const m of readFileSync(resolve(__dirname, '..', f), 'utf8').matchAll(/var\((--qp-[a-z0-9-]+)\)/g)) {
    const token = m[1];
    if (token) used.add(token);
  }
  expect([...used].filter(u => !defs(lifted).has(u))).toEqual([]);
});
