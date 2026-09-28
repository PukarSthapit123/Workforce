import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import hooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  { ignores: ['dist', 'public/mockServiceWorker.js', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    rules: {
      /* raw colours and px belong in tokens.css, never in a component */
      'no-restricted-syntax': ['error',
        { selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]", message: 'Use a --qp colour token, not a hex literal.' }],
    },
  },
  {
    /* Spec §5: features call api/ only. The fake server and its seed are
       reachable from its own folder, from tests, and from main.tsx's one
       dynamic import (which this rule does not see), never from product code,
       so the mock-free build cannot pull the seed back in by accident. */
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/mocks/**', 'src/**/*.test.{ts,tsx}', 'src/test/**', 'src/main.tsx'],
    rules: {
      'no-restricted-imports': ['error', { patterns: [{
        regex: '^(@/mocks|(\.{1,2}/)+(.*/)?mocks)(/|$)',
        message: 'Product code reaches the server through src/api only. Import the fake server or its seed from src/mocks/**, tests or main.tsx.',
      }] }],
    },
  },
  {
    /* react-hooks only makes sense for the React source tree. e2e/ fixtures
       take a Playwright `use` callback, which is not a React hook, and the
       plugin's name-based heuristic otherwise misreads it as one. */
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: { ...hooks.configs.recommended.rules },
  },
);
