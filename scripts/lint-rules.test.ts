// @vitest-environment node
import { ESLint } from 'eslint';
import { resolve } from 'node:path';

/* I7: the rule that keeps product code off the fake server must actually
   fire. Each snippet is linted as if it lived at the given path. */
const eslint = new ESLint({ cwd: resolve(__dirname, '..') });
async function restricted(code: string, filePath: string): Promise<boolean> {
  const [r] = await eslint.lintText(code, { filePath: resolve(__dirname, '..', filePath) });
  return (r?.messages ?? []).some(m => m.ruleId === 'no-restricted-imports');
}

test.each([
  ["import meta from '@/mocks/seed/meta.json';", 'src/features/access/Example.tsx'],
  ["import { store } from '@/mocks/store';", 'src/shell/Example.tsx'],
  ["import { store } from '../../mocks/store';", 'src/features/access/Example.tsx'],
  ["import { handlers } from './mocks/handlers';", 'src/Example.tsx'],
])('%s is refused in %s', async (code, filePath) => {
  expect(await restricted(code, filePath)).toBe(true);
}, 30_000);

test.each([
  ["import { store } from './store';", 'src/mocks/example.ts'],
  ["import { store } from '@/mocks/store';", 'src/features/access/example.test.tsx'],
  ["import { api } from '@/api/client';", 'src/features/access/Example.tsx'],
])('%s is allowed in %s', async (code, filePath) => {
  expect(await restricted(code, filePath)).toBe(false);
}, 30_000);

/* AGAINST THE DESIGN SYSTEM: "Colour literals outside the token blocks are rare".
   The hex rule refuses one in a component; tokens.css is where colours live. */
test('a hex colour literal in a component is refused', async () => {
  const hex = ['#', 'ff0000'].join(''); // assembled, so this file does not trip the rule it tests
  const [r] = await eslint.lintText(`export const c = '${hex}';`, { filePath: resolve(__dirname, '..', 'src/features/access/Example.tsx') });
  expect((r?.messages ?? []).some(m => m.ruleId === 'no-restricted-syntax' && /colour token/.test(m.message))).toBe(true);
}, 30_000);
