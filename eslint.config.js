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
    /* react-hooks only makes sense for the React source tree. e2e/ fixtures
       take a Playwright `use` callback, which is not a React hook, and the
       plugin's name-based heuristic otherwise misreads it as one. */
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': hooks },
    rules: { ...hooks.configs.recommended.rules },
  },
);
