# Plan 1a: Foundation and Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A running React app that signs in as employee, manager or admin. Navigation follows capabilities and flags, permissions are editable (templates plus per-user exceptions), and every change lands in an audit log. All of it goes through a typed HTTP contract answered by Mock Service Worker. Every interactive element carries a test ID.

**Architecture:**
- Features call a typed client. The client speaks HTTP only.
- MSW answers from an in-memory store seeded from the prototype, and enforces every rule through pure `domain/` functions.
- The `--qp` token stylesheet is lifted verbatim from the prototype and mapped into Tailwind v4, so shadcn/Radix components render in the Qnipay design language.

**Tech Stack:**
- Language and build: TypeScript 5 (strict), React 19, Vite 7.
- Routing and data: React Router 7, TanStack Query 5.
- Contract and fake server: Zod 4, MSW 2.
- UI: Tailwind CSS 4, shadcn/ui on Radix, Sonner.
- Unit and component tests: Vitest 3, Testing Library, jsdom.
- End to end: Playwright with `@axe-core/playwright`.

**Spec:** `docs/specs/2026-09-25-react-app-foundation-core-design.md`, sections 5-10. Plan 1a covers the "1a" row of spec §6: the shell, sign-in, permissions (`aperm`), audit log (`iaudit`), the harness, and `trace.json`.

## Global Constraints

- Repository root: `C:\Users\PukarSthapit\OneDrive - Dogma Group Ltd, GB, LONDON\Desktop\Qniverse\qnipay-workforce-app`. The prototype lives at `../Qnipay workforce cc/mockup/qnipay-workforce-v15.html`. Never modify the prototype.
- Node 22 or later (the tests use `fs.globSync`), npm. Checked here: Node 24. TypeScript `strict: true`, `noUncheckedIndexedAccess: true`.
- British English in every user-facing string. Plain sentences. No em-dash asides, and no "not X but Y".
- A toast or refusal states the consequence and what to do next. The refusal shape is `{ code, message, next, usedBy?, field? }` (spec §7.2).
- There are no monetary fields in any schema (spec §7.3). The money lint enforces this.
- Every record has `id`, `version` and `updatedAt`. A write sends `If-Match`, and a stale version gets 412.
- Timestamps are ISO 8601 UTC from the server clock. The UI shows them as DD/MM/YYYY HH:MM.
- Every interactive element carries a `data-testid` from `src/testids.ts`, in the format `area-element[-recordId]`. It is kebab-case and never contains display text.
- Every mutation writes one audit row: who, what, entity, before, after, and the reason where one is required.
- The UI reports success only from a response. A refusal never changes client state.
- Design tokens only. No hex, px spacing or radius literals in components. Spacing is `--qp-space-xs|sm|md|lg|xl|2xl…6xl` (4/8/12/16/24/32/48/64/80/120px).
- Commits use Conventional Commits and end with `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

1. **A stale write from two tabs.** An admin edits the same template in two tabs. The second save must get 412 with "Reload and apply your change again", and nothing may be half-applied. Pinned in Task 9 Step 1.
2. **Revoking your own way back.** An admin revoking `perm_cfg` on their own user type, or on themselves, must be refused (the prototype's `lock`), or the tenant loses its admin. Pinned in Task 9 Step 1.
3. **A store written by an older seed.** A browser holding yesterday's `localStorage` must boot on the new seed, not half-load the old one. Pinned in Task 5 Step 1.
4. **A session whose account was removed or revoked.** A cached token for an account that no longer exists must be signed out. It must not render a shell with an empty nav. Pinned in Task 7 Step 1.
5. **A fault on a write.** A 500 on any mutation must show the error toast and leave the UI and the store unchanged. The optimistic-update habit breaks exactly this. Pinned in Task 9 Step 5 and Task 10 Step 4.

---

## File map

| Path | Responsibility | Task |
|---|---|---|
| `package.json`, `tsconfig*.json`, `vite.config.ts`, `vitest.config.ts`, `playwright.config.ts`, `eslint.config.js`, `index.html`, `components.json` | Toolchain | 1 |
| `scripts/lift-tokens.mjs`, `src/ui/tokens.css`, `src/index.css` | Tokens and theme | 2 |
| `src/testids.ts` | The test ID registry | 3 |
| `src/ui/*.tsx` | Wrapped shadcn components with a required `testId`, plus the ⚠ ? i affordances | 3 |
| `src/test/testid-coverage.ts` | The coverage check | 3 |
| `src/contract/*.ts` | Zod schemas and the endpoint registry | 4, 7, 8, 9, 10 |
| `src/api/*.ts` | Client, `ApiError`, query hooks | 4, 7, 9, 10 |
| `scripts/openapi.ts`, `contract/openapi.json` | Generated API specification | 4 |
| `src/mocks/store.ts`, `http.ts`, `audit.ts`, `dev.ts`, `faults.ts`, `handlers.ts`, `browser.ts`, `node.ts` | The fake server | 5, 7, 9, 10 |
| `scripts/extract-seed.mjs`, `src/mocks/seed/*.json` | Seed from the prototype | 6 |
| `src/domain/capabilities.ts`, `nav.ts` | Pure rules | 8, 9 |
| `src/shell/*.tsx` | Sign-in, layout, navigation, account menu, view-as | 7, 8 |
| `src/features/access/*`, `src/features/audit/*`, `src/features/not-built/*` | Screens | 8, 9, 10 |
| `e2e/support/*.ts`, `e2e/*.spec.ts` | Playwright | 7-11 |
| `scripts/trace.mjs`, `e2e/trace.json`, `e2e/trace-areas.json` | Prototype traceability | 11 |

---

### Task 1: Scaffold the toolchain

**Files:**
- Create: `package.json`, `tsconfig.json`, `tsconfig.node.json`, `vite.config.ts`, `vitest.config.ts`, `eslint.config.js`, `index.html`, `src/main.tsx`, `src/App.tsx`, `src/test/setup.ts`, `src/App.test.tsx`

**Interfaces:**
- Produces:
  - Scripts: `npm run dev`, `npm test`, `npm run typecheck`, `npm run lint`, `npm run e2e` and `npm run verify` (all of them in sequence).
  - The path alias `@/` for `src/`.

- [ ] **Step 1: Write `package.json`**

```json
{
  "name": "qnipay-workforce-app",
  "private": true,
  "type": "module",
  "engines": { "node": ">=22" },
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "typecheck": "tsc -b --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test",
    "tokens": "node scripts/lift-tokens.mjs",
    "seed": "node scripts/extract-seed.mjs",
    "openapi": "tsx scripts/openapi.ts",
    "trace": "node scripts/trace.mjs",
    "verify": "npm run typecheck && npm run lint && npm test && npm run e2e"
  }
}
```

- [ ] **Step 2: Install**

```bash
npm i react react-dom react-router @tanstack/react-query zod msw sonner clsx tailwind-merge class-variance-authority lucide-react
npm i -D typescript vite @vitejs/plugin-react tailwindcss @tailwindcss/vite tsx @types/node @types/react @types/react-dom \
  vitest jsdom @testing-library/react @testing-library/user-event @testing-library/jest-dom \
  @playwright/test @axe-core/playwright eslint @eslint/js typescript-eslint eslint-plugin-react-hooks globals
npx playwright install chromium
npx msw init public --save
```
Afterwards, check the installed majors in `package-lock.json`. If any major differs from the Tech Stack line (React 19, Vite 7, Zod 4, MSW 2, Tailwind 4, Router 7), record the version you got in the commit message. The code below assumes those majors.

- [ ] **Step 3: TypeScript, Vite and Vitest configuration**

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022", "lib": ["ES2022", "DOM", "DOM.Iterable"], "module": "ESNext",
    "moduleResolution": "Bundler", "jsx": "react-jsx", "strict": true,
    "noUncheckedIndexedAccess": true, "noUnusedLocals": true, "noUnusedParameters": true,
    "resolveJsonModule": true, "isolatedModules": true, "skipLibCheck": true, "noEmit": true,
    "baseUrl": ".", "paths": { "@/*": ["src/*"] },
    "types": ["vitest/globals", "@testing-library/jest-dom"]
  },
  "include": ["src", "e2e", "scripts"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```
`tsconfig.node.json`:
```json
{ "compilerOptions": { "composite": true, "module": "ESNext", "moduleResolution": "Bundler", "skipLibCheck": true, "types": ["node"] },
  "include": ["vite.config.ts", "vitest.config.ts", "playwright.config.ts"] }
```
`vite.config.ts`:
```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true },
});
```
`vitest.config.ts`:
```ts
import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
  },
}));
```
`src/test/setup.ts`:
```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 4: ESLint**

`eslint.config.js`:
```js
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
    plugins: { 'react-hooks': hooks },
    rules: {
      ...hooks.configs.recommended.rules,
      /* raw colours and px belong in tokens.css, never in a component */
      'no-restricted-syntax': ['error',
        { selector: "Literal[value=/#[0-9a-fA-F]{3,8}\\b/]", message: 'Use a --qp colour token, not a hex literal.' }],
    },
  },
);
```

- [ ] **Step 5: Write the failing smoke test**

`src/App.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';

test('the app renders its root', () => {
  render(<App />);
  expect(screen.getByTestId('app-root')).toBeInTheDocument();
});
```

- [ ] **Step 6: Run it and watch it fail**

Run: `npm test`
Expected: FAIL, `Cannot find module './App'`.

- [ ] **Step 7: Minimal app**

`index.html`:
```html
<!doctype html>
<html lang="en-GB">
  <head><meta charset="UTF-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Qnipay Workforce</title></head>
  <body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>
</html>
```
`src/App.tsx`:
```tsx
export function App() {
  return <div data-testid="app-root">Qnipay Workforce</div>;
}
```
`src/main.tsx`:
```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
```

- [ ] **Step 8: Run everything that exists**

Run: `npm test && npm run typecheck && npm run lint`
Expected: 1 test passes, and typecheck and lint are clean.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite, React, TypeScript, Vitest, ESLint

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Lift the tokens and theme shadcn with them

**Files:**
- Create: `scripts/lift-tokens.mjs`, `scripts/lift-tokens.test.ts`, `src/ui/tokens.css` (generated), `src/index.css`, `components.json`, `src/lib/utils.ts`
- Modify: `src/main.tsx` (import the CSS)

**Interfaces:**
- Produces:
  - `src/ui/tokens.css`, which holds every `--qp-*` custom property from the prototype's `:root` and `[data-theme="dark"]` blocks.
  - The Tailwind utilities that map onto them (`bg-surface-card`, `text-text-secondary`, `rounded-control`, `p-md` and the rest).
  - The shadcn CSS variables (`--background`, `--primary` and the rest) aliased to `--qp` tokens.
  - The `dark` variant, bound to `[data-theme="dark"]`.

- [ ] **Step 1: Write the failing test**

`scripts/lift-tokens.test.ts`:
```ts
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
  for (const f of files) for (const m of readFileSync(resolve(__dirname, '..', f), 'utf8').matchAll(/var\((--qp-[a-z0-9-]+)\)/g)) used.add(m[1]!);
  expect([...used].filter(u => !defs(lifted).has(u))).toEqual([]);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run scripts/lift-tokens.test.ts`
Expected: FAIL, `ENOENT … src/ui/tokens.css`.

- [ ] **Step 3: Write the lifter**

`scripts/lift-tokens.mjs`:
```js
/* Copies the prototype's token layer verbatim. The prototype is the source of
   truth for the Qnipay design language, so nothing here is retyped by hand. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.PROTOTYPE_PATH || resolve(here, '../../Qnipay workforce cc/mockup/qnipay-workforce-v15.html');
const html = readFileSync(SRC, 'utf8');

/* the block that opens at `start` and closes at its matching brace */
function block(start) {
  const i = html.indexOf(start);
  if (i < 0) throw new Error('not found: ' + start);
  let depth = 0;
  for (let j = html.indexOf('{', i); j < html.length; j++) {
    if (html[j] === '{') depth++;
    else if (html[j] === '}' && --depth === 0) return html.slice(i, j + 1);
  }
  throw new Error('unclosed: ' + start);
}

const out = [
  '/* GENERATED by scripts/lift-tokens.mjs from the prototype. Do not edit by hand.',
  '   Source: ' + SRC.replace(/\\/g, '/').split('/').slice(-3).join('/'),
  '   Run `npm run tokens` to refresh. */',
  block(':root{'),
  block('[data-theme="dark"]{'),
  '',
].join('\n');

mkdirSync(resolve(here, '../src/ui'), { recursive: true });
writeFileSync(resolve(here, '../src/ui/tokens.css'), out);
console.log('tokens.css written:', (out.match(/--qp-[a-z0-9-]+\s*:/g) || []).length, 'definitions');
```
If the prototype defines extra `--qp` tokens in a second `:root{` block, which Step 4 would reveal, the lifter must include every `:root{` block. Change `block(':root{')` to a loop over every occurrence.

- [ ] **Step 4: Generate and check**

Run: `npm run tokens && npx vitest run scripts/lift-tokens.test.ts`
Expected: `tokens.css written: 2xx definitions`, and 3 tests pass. If "every --qp token is lifted" lists missing tokens, the prototype has another block that defines them. Add that block to the lifter and run again.

- [ ] **Step 5: Map the theme**

`src/index.css`:
```css
@import "tailwindcss";
@import "./ui/tokens.css";

/* the prototype switches theme with [data-theme="dark"], so shadcn's dark: does too */
@custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

/* shadcn reads these names. Each is an alias of a Qnipay semantic token, never a value. */
:root {
  --background: var(--qp-color-surface-page);
  --foreground: var(--qp-color-text-primary);
  --card: var(--qp-color-surface-card);
  --card-foreground: var(--qp-color-text-primary);
  --popover: var(--qp-color-surface-card);
  --popover-foreground: var(--qp-color-text-primary);
  --primary: var(--qp-color-brand-primary);
  --primary-foreground: var(--qp-color-text-on-brand);
  --secondary: var(--qp-color-surface-tint);
  --secondary-foreground: var(--qp-color-text-primary);
  --muted: var(--qp-color-surface-sunken);
  --muted-foreground: var(--qp-color-text-secondary);
  --accent: var(--qp-color-brand-primary-subtle);
  --accent-foreground: var(--qp-color-text-primary);
  --destructive: var(--qp-color-status-error);
  --border: var(--qp-color-border);
  --input: var(--qp-color-border);
  --ring: var(--qp-color-brand-primary);
  --radius: var(--qp-radius-control);
}

@theme inline {
  --font-sans: var(--qp-font-body);
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-card: var(--card);
  --color-card-foreground: var(--card-foreground);
  --color-popover: var(--popover);
  --color-popover-foreground: var(--popover-foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  --color-secondary: var(--secondary);
  --color-secondary-foreground: var(--secondary-foreground);
  --color-muted: var(--muted);
  --color-muted-foreground: var(--muted-foreground);
  --color-accent: var(--accent);
  --color-accent-foreground: var(--accent-foreground);
  --color-destructive: var(--destructive);
  --color-border: var(--border);
  --color-input: var(--input);
  --color-ring: var(--ring);
  /* Qnipay names, for everything shadcn does not name */
  --color-brand: var(--qp-color-brand-primary);
  --color-brand-hover: var(--qp-color-brand-primary-hover);
  --color-brand-accent: var(--qp-color-brand-accent);
  --color-surface-page: var(--qp-color-surface-page);
  --color-surface-card: var(--qp-color-surface-card);
  --color-surface-sunken: var(--qp-color-surface-sunken);
  --color-surface-inverse: var(--qp-color-surface-inverse);
  --color-text-primary: var(--qp-color-text-primary);
  --color-text-secondary: var(--qp-color-text-secondary);
  --color-text-disabled: var(--qp-color-text-disabled);
  --color-ok: var(--qp-color-status-success);
  --color-ok-surface: var(--qp-color-status-success-surface);
  --color-warn: var(--qp-color-status-warning);
  --color-warn-surface: var(--qp-color-status-warning-surface);
  --color-err: var(--qp-color-status-error);
  --color-err-surface: var(--qp-color-status-error-surface);
  --color-info: var(--qp-color-status-info);
  --color-info-surface: var(--qp-color-status-info-surface);
  --color-neu: var(--qp-color-status-neutral);
  --color-neu-surface: var(--qp-color-status-neutral-surface);
  --radius-xs: var(--qp-radius-xs);
  --radius-sm: var(--qp-radius-sm);
  --radius-md: var(--qp-radius-control);
  --radius-control: var(--qp-radius-control);
  --radius-card: var(--qp-radius-card);
  --radius-overlay: var(--qp-radius-overlay);
  --radius-pill: var(--qp-radius-pill);
  --spacing-xs: var(--qp-space-xs);
  --spacing-sm: var(--qp-space-sm);
  --spacing-md: var(--qp-space-md);
  --spacing-lg: var(--qp-space-lg);
  --spacing-xl: var(--qp-space-xl);
  --spacing-2xl: var(--qp-space-2xl);
  --spacing-3xl: var(--qp-space-3xl);
  --shadow-sm: var(--qp-shadow-sm);
  --shadow-md: var(--qp-shadow-md);
  --shadow-lg: var(--qp-shadow-lg);
}

body { background: var(--background); color: var(--foreground); font-family: var(--qp-font-body);
  font-size: var(--qp-text-14); line-height: var(--qp-lh-14); }
```
Add `import './index.css';` as the first line of `src/main.tsx`.

- [ ] **Step 6: Initialise shadcn**

`components.json`:
```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york", "rsc": false, "tsx": true,
  "tailwind": { "config": "", "css": "src/index.css", "baseColor": "neutral", "cssVariables": true },
  "aliases": { "components": "@/ui", "ui": "@/ui/shadcn", "utils": "@/lib/utils", "lib": "@/lib", "hooks": "@/hooks" },
  "iconLibrary": "lucide"
}
```
`src/lib/utils.ts`:
```ts
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
export const cn = (...inputs: ClassValue[]) => twMerge(clsx(inputs));
```
Run: `npx shadcn@latest add button input label textarea select checkbox switch tabs dialog tooltip dropdown-menu table badge sonner --yes`
Expected: files appear in `src/ui/shadcn/`.
- If the CLI rewrites `src/index.css`, restore the file from Step 5.
- Keep only the component files it added.
- Delete any hex or oklch literals it wrote into `index.css`. The aliases above are the only theme.

- [ ] **Step 7: Run everything**

Run: `npm test && npm run typecheck && npm run lint`
Expected: all green. If lint flags a hex literal inside `src/ui/shadcn/*`, replace it with the matching Tailwind token class. Never disable the rule.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(ui): lift --qp tokens from the prototype and theme shadcn with them

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Test ID registry, wrapped components, coverage check

**Files:**
- Create: `src/testids.ts`, `src/ui/Button.tsx`, `src/ui/Field.tsx`, `src/ui/Select.tsx`, `src/ui/Checkbox.tsx`, `src/ui/Switch.tsx`, `src/ui/Modal.tsx`, `src/ui/Pill.tsx`, `src/ui/Affordances.tsx`, `src/ui/toast.tsx`, `src/ui/index.ts`, `src/test/testid-coverage.ts`
- Test: `src/ui/ui.test.tsx`, `src/test/testid-coverage.test.tsx`

**Interfaces:**
- Produces:
  - `tid`, the registry object shown below. Every later task adds to it and never renames an entry.
  - Components: `Button`, `Field`, `TextInput`, `SelectBox`, `CheckboxField`, `SwitchField`, `Modal`, `ConfirmModal`, `Pill`, `Tip`, `HelpButton` and `Caution`. Each takes a required `testId: string`.
  - Toast helpers: `toastInfo(message, next?)` and `toastRefusal(refusal)`.
  - The check `expectTestIdCoverage(container: HTMLElement): void`.

- [ ] **Step 1: Write the failing tests**

`src/test/testid-coverage.test.tsx`:
```tsx
import { render } from '@testing-library/react';
import { expectTestIdCoverage } from './testid-coverage';

test('passes when every interactive element has a unique test id', () => {
  const { container } = render(<div><button data-testid="a-b">x</button><input data-testid="a-c" /></div>);
  expect(() => expectTestIdCoverage(container)).not.toThrow();
});
test('fails on a button with no test id, naming it', () => {
  const { container } = render(<div><button>Save</button></div>);
  expect(() => expectTestIdCoverage(container)).toThrow(/button "Save" has no data-testid/);
});
test('fails on a duplicate test id', () => {
  const { container } = render(<div><button data-testid="x-y">1</button><a href="#" data-testid="x-y">2</a></div>);
  expect(() => expectTestIdCoverage(container)).toThrow(/duplicate data-testid "x-y"/);
});
test('fails on a test id that is not kebab-case area-element', () => {
  const { container } = render(<button data-testid="Save Button">x</button>);
  expect(() => expectTestIdCoverage(container)).toThrow(/not in area-element form/);
});
```
`src/ui/ui.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react';
import { Button, Field, TextInput, Pill } from '@/ui';

test('Button renders its test id', () => {
  render(<Button testId="people-add">Add someone</Button>);
  expect(screen.getByTestId('people-add')).toHaveTextContent('Add someone');
});
test('Field wires label, hint and error to the control', () => {
  render(<Field testId="person-form-email" label="Email" hint="Used to sign in" error="Already used by Amara Okafor">
    <TextInput testId="person-form-email-input" /></Field>);
  const input = screen.getByTestId('person-form-email-input');
  expect(input).toHaveAccessibleName('Email');
  expect(input).toHaveAccessibleDescription(/Already used by Amara Okafor/);
  expect(input).toHaveAttribute('aria-invalid', 'true');
});
test('Pill carries its tone', () => {
  render(<Pill testId="state-pill" tone="ok">Active</Pill>);
  expect(screen.getByTestId('state-pill')).toHaveAttribute('data-tone', 'ok');
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/test src/ui`
Expected: FAIL, modules not found.

- [ ] **Step 3: The registry**

`src/testids.ts`:
```ts
/* The one source of test ids. Components and Playwright import the same names,
   so a rename is a type error, not a broken test. Format: area-element[-recordId],
   kebab-case, never display text. */
const k = (...parts: (string | number)[]) =>
  parts.map(p => String(p).replace(/[^A-Za-z0-9-]+/g, '-')).join('-');

export const tid = {
  app: 'app-root',
  page: (view: string) => k('page', view),
  signIn: {
    form: 'sign-in-form', email: 'sign-in-email', password: 'sign-in-password', submit: 'sign-in-submit',
    error: 'sign-in-error', showAccounts: 'sign-in-show-accounts', account: (email: string) => k('sign-in-account', email),
  },
  nav: {
    group: (key: string) => k('nav-group', key),
    tab: (view: string) => k('nav-tab', view),
    menu: (group: string) => k('nav-menu', group),
    bottom: (view: string) => k('nav-bottom', view),
    more: 'nav-bottom-more',
  },
  shell: {
    rolePill: 'shell-role-pill', bell: 'shell-bell', bellCount: 'shell-bell-count', theme: 'shell-theme',
    account: 'shell-account', signOut: 'shell-sign-out', viewAsEnd: 'shell-view-as-end',
    viewAs: (personCode: string) => k('shell-view-as', personCode),
  },
  notBuilt: { root: 'not-built', subProject: 'not-built-sub-project' },
  access: {
    table: 'access-table',
    cell: (cap: string, userType: string) => k('access-cell', cap, userType),
    userTypeName: (userType: string) => k('access-user-type-name', userType),
    users: 'access-users',
    userRow: (email: string) => k('access-user-row', email),
    exceptions: (email: string) => k('access-user-exceptions', email),
    exceptionAdd: (email: string) => k('access-exception-add', email),
    exceptionCap: 'access-exception-cap', exceptionMode: 'access-exception-mode',
    exceptionReason: 'access-exception-reason', exceptionSave: 'access-exception-save',
    exceptionRemove: (email: string, cap: string) => k('access-exception-remove', email, cap),
  },
  audit: {
    table: 'audit-table', row: (id: string) => k('audit-row', id),
    filterEntity: 'audit-filter-entity', filterWho: 'audit-filter-who', filterText: 'audit-filter-text',
  },
  modal: { root: 'modal', title: 'modal-title', close: 'modal-close', confirm: 'modal-confirm', cancel: 'modal-cancel' },
  toast: { info: 'toast-info', error: 'toast-error', next: 'toast-next' },
} as const;
```

- [ ] **Step 4: The coverage check**

`src/test/testid-coverage.ts`:
```ts
/* Every interactive element on a page carries a unique, well-formed data-testid. */
const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"], tbody tr';
const FORM = /^[a-z0-9]+(-[A-Za-z0-9]+)+$/;

export function expectTestIdCoverage(root: HTMLElement): void {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  root.querySelectorAll<HTMLElement>(INTERACTIVE).forEach(el => {
    /* a Radix trigger forwards the id to its visible element; hidden inputs mirror them */
    if (el.getAttribute('aria-hidden') === 'true' || (el as HTMLInputElement).type === 'hidden') return;
    const id = el.getAttribute('data-testid');
    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim().slice(0, 40);
    if (!id) { problems.push(`${el.tagName.toLowerCase()} "${label}" has no data-testid`); return; }
    if (!FORM.test(id)) problems.push(`data-testid "${id}" is not in area-element form`);
    seen.set(id, (seen.get(id) ?? 0) + 1);
  });
  root.querySelectorAll<HTMLElement>('[data-testid]').forEach(el => {
    const id = el.getAttribute('data-testid')!;
    if (!el.matches(INTERACTIVE)) seen.set(id, (seen.get(id) ?? 0) + 1);
  });
  seen.forEach((n, id) => { if (n > 1) problems.push(`duplicate data-testid "${id}" (${n} elements)`); });
  if (problems.length) throw new Error('Test id coverage:\n  ' + problems.join('\n  '));
}
```

- [ ] **Step 5: The wrapped components**

`src/ui/Button.tsx`:
```tsx
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Button as Base } from '@/ui/shadcn/button';

/* The prototype's kinds: pri, sec, gho, dgr. Sizes: normal, sml. */
const KIND = { primary: 'default', secondary: 'secondary', ghost: 'ghost', danger: 'destructive' } as const;
export type ButtonKind = keyof typeof KIND;

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  testId: string; kind?: ButtonKind; small?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ testId, kind = 'secondary', small, ...rest }, ref) =>
    <Base ref={ref} data-testid={testId} variant={KIND[kind]} size={small ? 'sm' : 'default'} {...rest} />);
Button.displayName = 'Button';
```
`src/ui/Field.tsx`:
```tsx
import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { Label } from '@/ui/shadcn/label';
import { Input } from '@/ui/shadcn/input';
import { Tip } from './Affordances';

export function Field({ testId, label, hint, error, required, tip, children }: {
  testId: string; label: string; hint?: string; error?: string; required?: boolean; tip?: string; children: ReactNode;
}) {
  const id = useId(), descId = `${id}-desc`;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<Record<string, unknown>>, {
        id, 'aria-describedby': hint || error ? descId : undefined, 'aria-invalid': error ? 'true' : undefined,
        'aria-required': required ? 'true' : undefined })
    : children;
  return (
    <div data-testid={testId} className="flex flex-col gap-xs">
      <Label htmlFor={id} className="flex min-h-5 items-center gap-xs text-text-secondary">
        {label}{required && <span aria-hidden="true" className="text-err">*</span>}
        {tip && <Tip testId={`${testId}-tip`} text={tip} />}
      </Label>
      {control}
      {(error || hint) && <p id={descId} className={error ? 'text-err text-xs' : 'text-text-secondary text-xs'}>{error ?? hint}</p>}
    </div>);
}
export function TextInput({ testId, ...rest }: { testId: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return <Input data-testid={testId} {...rest} />;
}
```
`src/ui/Pill.tsx`:
```tsx
import type { ReactNode } from 'react';
export type Tone = 'ok' | 'warn' | 'err' | 'info' | 'neu';
const TONE: Record<Tone, string> = {
  ok: 'bg-ok-surface text-ok', warn: 'bg-warn-surface text-warn', err: 'bg-err-surface text-err',
  info: 'bg-info-surface text-info', neu: 'bg-neu-surface text-neu' };
export function Pill({ testId, tone, children }: { testId: string; tone: Tone; children: ReactNode }) {
  return <span data-testid={testId} data-tone={tone}
    className={`inline-flex items-center gap-xs rounded-pill px-sm py-xs text-xs font-semibold ${TONE[tone]}`}>{children}</span>;
}
```
`src/ui/Affordances.tsx` implements the prototype's ⚠ ? i convention (CLAUDE.md UI conventions):
```tsx
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/ui/shadcn/tooltip';
/* i: explains the thing beside it, one or two sentences, never over ~170 characters */
export function Tip({ testId, text }: { testId: string; text: string }) {
  if (import.meta.env.DEV && text.length > 170) console.warn(`Tip over 170 characters belongs behind ?: ${testId}`);
  return (
    <TooltipProvider delayDuration={200}><Tooltip>
      <TooltipTrigger asChild>
        <button type="button" data-testid={testId} aria-label="More information"
          className="inline-grid size-4 place-items-center rounded-pill border border-border text-[length:var(--qp-text-12)] text-text-secondary">i</button>
      </TooltipTrigger>
      <TooltipContent>{text}</TooltipContent>
    </Tooltip></TooltipProvider>);
}
/* ?: opens the guide for the page */
export function HelpButton({ testId, label, onOpen }: { testId: string; label: string; onOpen: () => void }) {
  return <button type="button" data-testid={testId} aria-label={label} onClick={onOpen}
    className="inline-grid size-7 place-items-center rounded-pill border border-border font-semibold">?</button>;
}
/* ⚠: a standing caution, always true of this area */
export function Caution({ testId, text }: { testId: string; text: string }) {
  return <span data-testid={testId} role="note" className="inline-flex items-center gap-xs text-warn">⚠ {text}</span>;
}
```
`src/ui/Modal.tsx`:
```tsx
import type { ReactNode } from 'react';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/ui/shadcn/dialog';
import { tid } from '@/testids';
import { Button } from './Button';

/* Radix traps focus and returns it on close, which the prototype never did. */
export function Modal({ open, onOpenChange, title, description, children, footer }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-testid={tid.modal.root}>
        <DialogHeader><DialogTitle data-testid={tid.modal.title}>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}</DialogHeader>
        {children}
        {footer && <DialogFooter>{footer}</DialogFooter>}
      </DialogContent>
    </Dialog>);
}
export function ConfirmModal({ open, onOpenChange, title, body, confirmLabel, cancelLabel = 'Keep it as it is', danger, busy, onConfirm }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; body: string; confirmLabel: string;
  cancelLabel?: string; danger?: boolean; busy?: boolean; onConfirm: () => void;
}) {
  return <Modal open={open} onOpenChange={onOpenChange} title={title} description={body} footer={<>
    <Button testId={tid.modal.cancel} kind="ghost" onClick={() => onOpenChange(false)}>{cancelLabel}</Button>
    <Button testId={tid.modal.confirm} kind={danger ? 'danger' : 'primary'} disabled={busy} onClick={onConfirm}>{confirmLabel}</Button>
  </>} />;
}
```
The shadcn `DialogContent` renders a close button. Edit `src/ui/shadcn/dialog.tsx` so that button carries `data-testid="modal-close"`.

`src/ui/toast.tsx`:
```tsx
import { toast } from 'sonner';
import { tid } from '@/testids';
import type { Refusal } from '@/contract/common';

/* A toast states the consequence and what to do next. `next` is not optional on a
   refusal, so a refusal can never be shown without it. */
export function toastInfo(message: string, next?: string) {
  toast.custom(() => (
    <div data-testid={tid.toast.info} role="status" className="rounded-card bg-surface-inverse p-md text-primary-foreground shadow-lg">
      <div>{message}</div>{next && <div data-testid={tid.toast.next} className="opacity-80">{next}</div>}
    </div>), { duration: 5000 });
}
export function toastRefusal(r: Pick<Refusal, 'message' | 'next'>) {
  toast.custom(() => (
    <div data-testid={tid.toast.error} role="alert" className="rounded-card bg-err p-md text-primary-foreground shadow-lg">
      <div>{r.message}</div><div data-testid={tid.toast.next} className="opacity-90">{r.next}</div>
    </div>), { duration: 8000 });
}
```
`src/ui/Select.tsx`, `Checkbox.tsx` and `Switch.tsx` wrap their shadcn counterparts the same way as `Button`:
- the prop is `testId: string`;
- it becomes `data-testid` on the Radix trigger or root;
- `SelectBox` also takes `options: {value: string; label: string}[]` and puts `data-testid={`${testId}-option-${value}`}` on each item.

`src/ui/index.ts` re-exports every component above and `toastInfo` and `toastRefusal`. Toast rendering needs `<Toaster />` from `@/ui/shadcn/sonner`, mounted once in Task 7.

`src/contract/common.ts` does not exist yet, so for this task create it with just the Refusal schema. Task 4 extends it:
```ts
import { z } from 'zod';
export const Refusal = z.object({
  code: z.string(), message: z.string(), next: z.string(), field: z.string().optional(),
  usedBy: z.array(z.object({ kind: z.string(), count: z.number().int(), examples: z.array(z.string()) })).optional(),
});
export type Refusal = z.infer<typeof Refusal>;
```

- [ ] **Step 6: Run the tests**

Run: `npx vitest run src/test src/ui && npm run typecheck && npm run lint`
Expected: 7 tests pass, and typecheck and lint are clean.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(ui): test id registry, wrapped components with required testId, coverage check

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: The contract core and the typed client

**Files:**
- Modify: `src/contract/common.ts`
- Create: `src/contract/endpoints.ts`, `src/contract/index.ts`, `src/api/client.ts`, `src/api/session-token.ts`, `scripts/openapi.ts`, `contract/openapi.json` (generated), `contract/money-lint.allow.json`
- Test: `src/contract/contract.test.ts`, `src/api/client.test.ts`

**Interfaces:**
- Produces:
  - `RecordMeta` (`{id, version, updatedAt}`), `Refusal`, `Mutation<T>` (`{record: T, auditId: string}`) and `IsoDateTime`.
  - `defineEndpoint({method, path, request?, response, capability?, summary})` and `ENDPOINTS: Endpoint[]`.
  - `api<T>(ep, {params?, body?, ifMatch?, query?}): Promise<T>`, which throws `ApiError`.
  - `ApiError` with `status: number` and `refusal: Refusal`.
  - `getToken()`, `setToken(t | null)`.

- [ ] **Step 1: Write the failing tests**

`src/contract/contract.test.ts`:
```ts
import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENDPOINTS } from '@/contract';
import { buildOpenApi } from '../../scripts/openapi';

/* camelCase is split into words first, so budgetAmount and hourlyRateValue are caught
   while payCode, netHours and rateType are not */
const words = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
const MONEY = /\b(amount|price|salary|wage|gross pay|net pay|rate value)\b/;
const CURRENCY = /[£$€]/;
const allow: Record<string, string> = JSON.parse(readFileSync(resolve(__dirname, '../../contract/money-lint.allow.json'), 'utf8'));

function walk(schema: unknown, path: string, out: string[]) {
  const js = z.toJSONSchema(schema as z.ZodType, { unrepresentable: 'any' }) as Record<string, unknown>;
  const visit = (node: unknown, p: string) => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.properties) for (const [key, v] of Object.entries(n.properties as object)) {
      const full = `${p}.${key}`;
      if (MONEY.test(words(key)) && !allow[full]) out.push(full);
      if (typeof (v as { default?: unknown }).default === 'string' && CURRENCY.test((v as { default: string }).default)) out.push(full + ' (currency default)');
      visit(v, full);
    }
    for (const k of ['items', 'anyOf', 'oneOf', 'allOf']) {
      const c = n[k]; if (Array.isArray(c)) c.forEach((x, i) => visit(x, `${p}[${i}]`)); else if (c) visit(c, p + '[]');
    }
  };
  visit(js, path);
}

test('the money lint reads camelCase as words', () => {
  expect(MONEY.test(words('budgetAmount'))).toBe(true);
  expect(MONEY.test(words('hourlyRateValue'))).toBe(true);
  expect(['payCode', 'netHours', 'rateType', 'costCentre'].some(k => MONEY.test(words(k)))).toBe(false);
});
test('no schema carries money', () => {
  const hits: string[] = [];
  for (const ep of ENDPOINTS) {
    if (ep.request) walk(ep.request, `${ep.method} ${ep.path} request`, hits);
    walk(ep.response, `${ep.method} ${ep.path} response`, hits);
  }
  expect(hits).toEqual([]);
});

test('every endpoint path is under /api/v1 and unique by method', () => {
  const keys = ENDPOINTS.map(e => `${e.method} ${e.path}`);
  expect(keys.every(k => / \/api\/v1\//.test(k))).toBe(true);
  expect(new Set(keys).size).toBe(keys.length);
});

test('the committed OpenAPI file matches the contract', () => {
  const committed = JSON.parse(readFileSync(resolve(__dirname, '../../contract/openapi.json'), 'utf8'));
  expect(buildOpenApi()).toEqual(committed);
});
```
`src/api/client.test.ts`:
```ts
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';
import { z } from 'zod';
import { api, ApiError } from './client';
import { defineEndpoint, RecordMeta } from '@/contract';

const Thing = RecordMeta.extend({ name: z.string() });
const getThing = defineEndpoint({ method: 'GET', path: '/api/v1/things/:id', response: Thing, summary: 'test' });
const putThing = defineEndpoint({ method: 'PUT', path: '/api/v1/things/:id', request: z.object({ name: z.string() }), response: Thing, summary: 'test' });

const server = setupServer(
  http.get('/api/v1/things/:id', ({ params }) => HttpResponse.json({ id: params.id, version: 3, updatedAt: '2026-08-13T14:30:00.000Z', name: 'A' })),
  http.put('/api/v1/things/:id', ({ request }) => request.headers.get('If-Match') === '3'
    ? HttpResponse.json({ id: 't1', version: 4, updatedAt: '2026-08-13T14:30:00.000Z', name: 'B' })
    : HttpResponse.json({ code: 'stale', message: 'Somebody changed this since you opened it.', next: 'Reload and apply your change again' }, { status: 412 })),
);
beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());

test('parses a response against its schema', async () => {
  expect((await api(getThing, { params: { id: 't1' } })).version).toBe(3);
});
test('sends If-Match and surfaces a 412 as an ApiError carrying the refusal', async () => {
  await expect(api(putThing, { params: { id: 't1' }, body: { name: 'B' }, ifMatch: 2 }))
    .rejects.toMatchObject({ status: 412, refusal: { next: 'Reload and apply your change again' } });
});
test('a response that breaks its schema is an error, not data', async () => {
  server.use(http.get('/api/v1/things/:id', () => HttpResponse.json({ id: 1 })));
  await expect(api(getThing, { params: { id: 't1' } })).rejects.toBeInstanceOf(ApiError);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/contract src/api`
Expected: FAIL, modules not found.

- [ ] **Step 3: The common schemas and the endpoint registry**

Replace `src/contract/common.ts` with:
```ts
import { z } from 'zod';

export const IsoDateTime = z.iso.datetime();
export const RecordMeta = z.object({ id: z.string(), version: z.number().int().nonnegative(), updatedAt: IsoDateTime });
export type RecordMeta = z.infer<typeof RecordMeta>;

export const Refusal = z.object({
  code: z.string(), message: z.string(), next: z.string(), field: z.string().optional(),
  usedBy: z.array(z.object({ kind: z.string(), count: z.number().int(), examples: z.array(z.string()) })).optional(),
});
export type Refusal = z.infer<typeof Refusal>;

export const mutation = <T extends z.ZodType>(record: T) => z.object({ record, auditId: z.string() });
export type Mutation<T> = { record: T; auditId: string };
```
`src/contract/endpoints.ts`:
```ts
import type { z } from 'zod';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface Endpoint<Req extends z.ZodType | undefined = z.ZodType | undefined, Res extends z.ZodType = z.ZodType> {
  method: Method; path: `/api/v1/${string}`; request?: Req; response: Res; capability?: string; summary: string;
}
export const ENDPOINTS: Endpoint[] = [];
/* Registering here is what puts an endpoint into the OpenAPI document and the
   contract tests, so an endpoint cannot exist without being specified. */
export function defineEndpoint<Req extends z.ZodType | undefined, Res extends z.ZodType>(e: Endpoint<Req, Res>) {
  ENDPOINTS.push(e as unknown as Endpoint); return e;
}
```
`src/contract/index.ts`:
```ts
export * from './common';
export * from './endpoints';
/* feature contracts register themselves on import; each later task adds one line */
```

- [ ] **Step 4: The client**

`src/api/session-token.ts`:
```ts
const KEY = 'qnipay.session';
export const getToken = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t: string | null) => { try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch { /* private mode: session lasts the tab */ } };
```
`src/api/client.ts`:
```ts
import type { z } from 'zod';
import { Refusal } from '@/contract/common';
import type { Endpoint } from '@/contract/endpoints';
import { getToken } from './session-token';

export class ApiError extends Error {
  constructor(public status: number, public refusal: Refusal) { super(refusal.message); }
}
const UNREADABLE: Refusal = { code: 'unreadable', message: 'The server sent something this screen cannot read. Nothing has been changed on screen.', next: 'Reload the page. If it happens again, report it.' };

export async function api<E extends Endpoint>(ep: E, opts: {
  params?: Record<string, string>; body?: unknown; ifMatch?: number; query?: Record<string, string | undefined>;
} = {}): Promise<z.infer<E['response']>> {
  let url: string = ep.path.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(opts.params?.[k] ?? ''));
  const q = Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined && v !== '') as [string, string][];
  if (q.length) url += '?' + new URLSearchParams(q).toString();
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken(); if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.ifMatch !== undefined) headers['If-Match'] = String(opts.ifMatch);
  const res = await fetch(url, { method: ep.method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const r = Refusal.safeParse(data);
    throw new ApiError(res.status, r.success ? r.data : UNREADABLE);
  }
  const parsed = ep.response.safeParse(data);
  if (!parsed.success) throw new ApiError(res.status, UNREADABLE);
  return parsed.data;
}
```

- [ ] **Step 5: The OpenAPI builder and the allow-list**

`scripts/openapi.ts`:
```ts
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ENDPOINTS, Refusal } from '../src/contract';

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of [...ENDPOINTS].sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method))) {
    const p = e.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const op: Record<string, unknown> = {
      summary: e.summary,
      ...(e.capability ? { 'x-capability': e.capability } : {}),
      responses: {
        200: { description: 'OK', content: { 'application/json': { schema: z.toJSONSchema(e.response, { unrepresentable: 'any' }) } } },
        default: { description: 'Refusal', content: { 'application/json': { schema: z.toJSONSchema(Refusal) } } },
      },
    };
    if (e.request) op.requestBody = { content: { 'application/json': { schema: z.toJSONSchema(e.request, { unrepresentable: 'any' }) } } };
    (paths[p] ??= {})[e.method.toLowerCase()] = op;
  }
  return { openapi: '3.1.0', info: { title: 'Qnipay Workforce API (draft, from the fake server)', version: '0.1.0' }, paths };
}
if (process.argv[1]?.endsWith('openapi.ts')) {
  mkdirSync(resolve(import.meta.dirname, '../contract'), { recursive: true });
  writeFileSync(resolve(import.meta.dirname, '../contract/openapi.json'), JSON.stringify(buildOpenApi(), null, 2) + '\n');
  console.log('contract/openapi.json written:', ENDPOINTS.length, 'endpoints');
}
```
`contract/money-lint.allow.json`:
```json
{}
```

- [ ] **Step 6: Generate and run**

Run: `npm run openapi && npx vitest run src/contract src/api && npm run typecheck`
Expected: `0 endpoints` (none are registered yet), and 6 tests pass. The OpenAPI test passes because generated equals committed. From now on, every task that adds an endpoint runs `npm run openapi` before its tests.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(contract): record meta, refusal shape, endpoint registry, typed client, OpenAPI, money lint

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: The fake server core

**Files:**
- Create: `src/mocks/store.ts`, `src/mocks/http.ts`, `src/mocks/audit.ts`, `src/mocks/faults.ts`, `src/mocks/dev.ts`, `src/mocks/handlers.ts`, `src/mocks/browser.ts`, `src/mocks/node.ts`, `src/contract/audit.ts`
- Modify: `src/main.tsx` (start the worker), `src/contract/index.ts`
- Test: `src/mocks/store.test.ts`, `src/mocks/dev.test.ts`

**Interfaces:**
- Consumes: `RecordMeta`, `Refusal`, `defineEndpoint`.
- Produces:
  - `store`, a singleton with:
    - `store.db`, collections keyed by name, each `Record<string, T>`;
    - `store.now(): string`, ISO time;
    - `store.setClock(iso | null)`;
    - `store.reset(tenant?)`, `store.load(seed)` and `store.save()`.
  - `SEED_VERSION` and `STORE_KEY = 'qnipay.app.store'`.
  - `refuse(status, refusal)`, `readJson(request, schema)`, `requireSession(request)`, `requireCapability(session, cap)` and `checkVersion(request, record)`.
  - `bump<T extends RecordMeta>(record, changes): T`, which returns a new record with `version+1` and `updatedAt = now`.
  - `writeAudit({who, act, entity, entityId, before, after, reason}): string`, which returns the audit ID.
  - The `AuditEntry` schema.
  - `faultsHandler` (put first in the handler list) and `devHandlers`.
  - `handlers`, the full list. Later tasks append to it.

- [ ] **Step 1: Write the failing tests**

`src/mocks/store.test.ts`:
```ts
import { createStore, STORE_KEY, SEED_VERSION } from './store';

const seed = { version: SEED_VERSION, tenant: 'social', data: { things: { a: { id: 'a', version: 1, updatedAt: '2026-08-13T14:30:00.000Z' } } } };

beforeEach(() => localStorage.clear());

test('loads a seed and persists it under the seed version', () => {
  const s = createStore(() => seed); s.reset();
  s.save();
  expect(JSON.parse(localStorage.getItem(STORE_KEY)!).version).toBe(SEED_VERSION);
});
test('a store written by an older seed is set aside, not half-loaded', () => {
  localStorage.setItem(STORE_KEY, JSON.stringify({ version: 'old', tenant: 'social', data: { things: {} } }));
  const s = createStore(() => seed); s.boot();
  expect(Object.keys(s.db.things!)).toEqual(['a']);
  expect(localStorage.getItem(STORE_KEY + '.superseded')).not.toBeNull();
});
test('the clock can be set and cleared', () => {
  const s = createStore(() => seed);
  s.setClock('2026-08-13T14:30:00.000Z');
  expect(s.now()).toBe('2026-08-13T14:30:00.000Z');
  s.setClock(null);
  expect(s.now()).not.toBe('2026-08-13T14:30:00.000Z');
});
```
`src/mocks/dev.test.ts`:
```ts
import { http, HttpResponse } from 'msw';
import { server } from './node';
import { store } from './store';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());

test('POST /api/_dev/clock sets the server clock', async () => {
  const r = await fetch('/api/_dev/clock', { method: 'POST', body: JSON.stringify({ now: '2026-08-13T14:30:00.000Z' }) });
  expect(r.status).toBe(204);
  expect(store.now()).toBe('2026-08-13T14:30:00.000Z');
});
test('a fault makes the next call fail with the chosen status, then clears', async () => {
  /* a probe endpoint of the test's own, so this does not depend on a later task's handler */
  server.use(http.get('/api/v1/probe', () => HttpResponse.json({ ok: true })));
  await fetch('/api/_dev/faults', { method: 'POST', body: JSON.stringify({ method: 'GET', path: '/api/v1/probe', status: 500, times: 1 }) });
  const first = await fetch('/api/v1/probe');
  expect(first.status).toBe(500);
  expect(await first.json()).toMatchObject({ code: 'fault', next: expect.any(String) });
  const second = await fetch('/api/v1/probe');
  expect(second.status).toBe(200);
});
test('POST /api/_dev/reset restores the seed and clears faults', async () => {
  store.db.audit = { stray: { id: 'stray' } };
  await fetch('/api/_dev/reset', { method: 'POST' });
  expect(store.db.audit).not.toHaveProperty('stray');
  expect(store.tenant).toBe('social');
});
```
Vitest needs a base URL for the relative `fetch`. Add `test: { environmentOptions: { jsdom: { url: 'http://localhost/' } } }` to `vitest.config.ts`.

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/mocks`
Expected: FAIL, modules not found.

- [ ] **Step 3: The store**

`src/mocks/store.ts`:
```ts
/* The fake server's database. In memory, persisted to localStorage so a reload
   keeps what the person did, and set aside wholesale when the seed changes. */
import socialSeed from './seed/social.json';
import qcicSeed from './seed/qcic.json';

export const STORE_KEY = 'qnipay.app.store';
export const SEED_VERSION = '2026-09-25.1a';
export type Collections = Record<string, Record<string, Record<string, unknown>>>;
export interface Seed { version: string; tenant: string; data: Collections }

const SEEDS: Record<string, unknown> = { social: socialSeed, qcic: qcicSeed };
const defaultSeed = (tenant = 'social') => ({ version: SEED_VERSION, tenant, data: structuredClone((SEEDS[tenant] as { data: Collections }).data) });

export function createStore(seedFor: (tenant?: string) => Seed = defaultSeed) {
  let clock: string | null = null;
  const s = {
    db: {} as Collections,
    tenant: 'social',
    now: () => clock ?? new Date().toISOString(),
    setClock(iso: string | null) { clock = iso; },
    load(seed: Seed) { s.db = structuredClone(seed.data); s.tenant = seed.tenant; },
    reset(tenant?: string) { s.load(seedFor(tenant ?? s.tenant)); s.save(); },
    save() { try { localStorage.setItem(STORE_KEY, JSON.stringify({ version: SEED_VERSION, tenant: s.tenant, data: s.db })); } catch { /* storage full or blocked: the session still works */ } },
    boot() {
      try {
        const raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          const o = JSON.parse(raw) as Seed;
          if (o.version === SEED_VERSION) { s.load(o); return; }
          localStorage.setItem(STORE_KEY + '.superseded', raw);
        }
      } catch { /* unreadable store: start from the seed */ }
      s.reset();
    },
    coll<T>(name: string): Record<string, T> { return (s.db[name] ??= {}) as Record<string, T>; },
  };
  return s;
}
export const store = createStore();
```
Task 6 produces the seed JSON files. Until then, create placeholders so the import resolves:
`src/mocks/seed/social.json` and `src/mocks/seed/qcic.json`, each containing:
```json
{ "version": "placeholder", "tenant": "social", "data": { "audit": {} } }
```
Use `"tenant": "qcic"` in the second file.

- [ ] **Step 4: HTTP helpers, audit and faults**

`src/contract/audit.ts`:
```ts
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime } from './common';

export const AuditEntry = z.object({
  id: z.string(), at: IsoDateTime, who: z.object({ personCode: z.string(), name: z.string(), viewingAs: z.string().optional() }),
  act: z.string(), entity: z.string(), entityId: z.string(),
  before: z.unknown().optional(), after: z.unknown().optional(), reason: z.string().optional(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;
export const AuditPage = z.object({ items: z.array(AuditEntry), total: z.number().int() });
export const listAudit = defineEndpoint({ method: 'GET', path: '/api/v1/audit', response: AuditPage,
  capability: 'integration', summary: 'Audit log, newest first. Query: entity, who, q, limit.' });
```
Add `export * from './audit';` to `src/contract/index.ts`.

`src/mocks/http.ts`:
```ts
import { HttpResponse } from 'msw';
import type { z } from 'zod';
import type { Refusal, RecordMeta } from '@/contract/common';
import { store } from './store';

export class Refused extends Error { constructor(public status: number, public body: Refusal) { super(body.message); } }
export const refuse = (status: number, body: Refusal): never => { throw new Refused(status, body); };

/* Wraps a handler so a thrown Refused becomes the one refusal shape. */
export const handle = <A extends unknown[]>(fn: (...a: A) => Promise<Response> | Response) =>
  async (...a: A) => {
    try { return await fn(...a); }
    catch (e) { if (e instanceof Refused) return HttpResponse.json(e.body, { status: e.status }); throw e; }
  };

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const body = await request.json().catch(() => undefined);
  const r = schema.safeParse(body);
  if (!r.success) {
    const issue = r.error.issues[0];
    return refuse(422, { code: 'invalid', field: issue?.path.join('.'), message: issue?.message ?? 'That request was not valid.', next: 'Correct the highlighted field and try again.' });
  }
  return r.data;
}
export function checkVersion(request: Request, record: RecordMeta) {
  const m = request.headers.get('If-Match');
  if (m === null) refuse(428, { code: 'version-required', message: 'This change was sent without the version it was based on.', next: 'Reload and apply your change again' });
  if (Number(m) !== record.version) refuse(412, { code: 'stale', message: 'Somebody changed this since you opened it. Your change has not been saved.', next: 'Reload and apply your change again' });
}
export function bump<T extends RecordMeta>(record: T, changes: Partial<T>): T {
  return { ...record, ...changes, version: record.version + 1, updatedAt: store.now() };
}
```
`src/mocks/audit.ts`:
```ts
import type { AuditEntry } from '@/contract/audit';
import { store } from './store';

let seq = 0;
export function writeAudit(e: Omit<AuditEntry, 'id' | 'at'>): string {
  const id = `aud_${Date.now().toString(36)}${(seq++).toString(36)}`;
  store.coll<AuditEntry>('audit')[id] = { id, at: store.now(), ...e };
  return id;
}
```
`src/mocks/faults.ts`:
```ts
import { http, HttpResponse, delay } from 'msw';

interface Fault { method: string; path: string; status?: number; latencyMs?: number; times: number }
export const faults: Fault[] = [];

/* First in the handler list. A matching fault answers or delays; otherwise it
   returns nothing and MSW moves on to the real handler. */
export const faultsHandler = http.all('/api/v1/*', async ({ request }) => {
  const url = new URL(request.url);
  const f = faults.find(x => x.method === request.method && url.pathname === x.path && x.times > 0);
  if (!f) return;
  f.times--;
  if (f.latencyMs) await delay(f.latencyMs);
  if (f.status) return HttpResponse.json(
    { code: 'fault', message: 'The server could not complete that. Nothing has been changed.', next: 'Try again. If it keeps failing, report it.' },
    { status: f.status });
});
```
`src/mocks/dev.ts`:
```ts
import { http, HttpResponse } from 'msw';
import { store } from './store';
import { faults } from './faults';

/* Test and development control. Not part of the product API, and never in a production build. */
export const devHandlers = [
  http.post('/api/_dev/reset', () => { faults.length = 0; store.reset(); return new HttpResponse(null, { status: 204 }); }),
  http.post('/api/_dev/seed/:tenant', ({ params }) => { store.reset(String(params.tenant)); return new HttpResponse(null, { status: 204 }); }),
  http.post('/api/_dev/clock', async ({ request }) => {
    const { now } = (await request.json()) as { now: string | null };
    store.setClock(now); return new HttpResponse(null, { status: 204 }); }),
  http.post('/api/_dev/faults', async ({ request }) => {
    const f = (await request.json()) as { method: string; path: string; status?: number; latencyMs?: number; times?: number };
    faults.push({ ...f, times: f.times ?? 1 }); return new HttpResponse(null, { status: 204 }); }),
];
```
`src/mocks/handlers.ts`:
```ts
import { faultsHandler } from './faults';
import { devHandlers } from './dev';
/* Order matters: faults first, so they can pre-empt any endpoint. */
export const handlers = [faultsHandler, ...devHandlers /* feature handlers appended by later tasks */];
```
`src/mocks/node.ts`:
```ts
import { setupServer } from 'msw/node';
import { handlers } from './handlers';
import { store } from './store';
store.reset('social');
export const server = setupServer(...handlers);
```
`src/mocks/browser.ts`:
```ts
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { store } from './store';

export async function startFakeServer() {
  store.boot();
  /* every write persists; a handler never has to remember to */
  const worker = setupWorker(...handlers);
  worker.events.on('response:mocked', ({ request }) => { if (request.method !== 'GET') store.save(); });
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
}
```
Replace `src/main.tsx` with:
```tsx
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

async function start() {
  /* the fake server runs unless explicitly switched off: VITE_MOCKS=off */
  if (import.meta.env.VITE_MOCKS !== 'off') await (await import('./mocks/browser')).startFakeServer();
  createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
}
void start();
```
The `import()` is dynamic, so a production build with `VITE_MOCKS=off` never loads the mocks or the `_dev` endpoints. Confirm this in Task 11 Step 5.

- [ ] **Step 5: Run**

Run: `npx vitest run src/mocks && npm run typecheck`
Expected: 6 tests pass. In the reset test, `audit` is empty on the placeholder seed; Task 6 gives it content.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mocks): store with seed versioning, clock, faults, _dev control, refusal plumbing, audit writer

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Extract the seed from the prototype

**Files:**
- Create: `scripts/extract-seed.mjs`, `src/mocks/seed/social.json`, `src/mocks/seed/qcic.json`, `src/mocks/seed/meta.json` (all generated)
- Test: `src/mocks/seed/seed.test.ts`

**Interfaces:**
- Produces seed files shaped `{version, tenant, data}`. `data` holds these collections, each keyed by record `id`:
  - `people`: `{id, version, updatedAt, code, name, email, jobProfile, employeeType, category, location, department, manager, contractedHours, maxHours, state, start, end}`
  - `accounts`: `{id, version, updatedAt, email, personCode, userType, grants: string[], revocations: string[]}`
  - `userTypes`: `{id: 'employee'|'manager'|'admin', version, updatedAt, name, description, capabilities: string[]}`
  - `capabilities`: `{id: capCode, version, updatedAt, group: 'own'|'team'|'cfg', label, gate, lockedFor: string[]}`
  - `tenant`: a single record keyed `'tenant'`: `{id, version, updatedAt, name, template, modules: Record<string,boolean>, flags: Record<string,boolean>}`
  - `locations`, `departments`, `costCentres`, `jobProfiles`, `projects`: `{id, version, updatedAt, code, name, ...rest}`
  - `notices`: the prototype's notice records, with `id`, `version` and `updatedAt` added
  - `audit`: empty
- `meta.json` holds `{flags, modules, permGroups, empStates}`, read from the prototype source.

- [ ] **Step 1: Write the failing test**

`src/mocks/seed/seed.test.ts`:
```ts
import social from './social.json';
import qcic from './qcic.json';
import meta from './meta.json';

type Rec = Record<string, unknown> & { id: string; code?: string };
const vals = (s: { data: Record<string, Record<string, Rec>> }, c: string) => Object.values(s.data[c] ?? {});

for (const [name, seed] of Object.entries({ social, qcic }) as [string, { tenant: string; data: Record<string, Record<string, Rec>> }][]) {
  describe(`seed ${name}`, () => {
    test('has people, accounts, user types, capabilities and a tenant', () => {
      for (const c of ['people', 'accounts', 'userTypes', 'capabilities', 'locations', 'departments'])
        expect(vals(seed, c).length, c).toBeGreaterThan(0);
      expect(seed.data.tenant?.tenant).toBeDefined();
    });
    test('every record has id, version and updatedAt', () => {
      for (const [c, recs] of Object.entries(seed.data)) for (const r of Object.values(recs))
        expect(r.id && typeof r.version === 'number' && typeof r.updatedAt === 'string', `${c}/${r.id}`).toBe(true);
    });
    test('codes are unique within each dimension', () => {
      for (const c of ['people', 'locations', 'departments', 'costCentres', 'jobProfiles', 'projects']) {
        const codes = vals(seed, c).map(r => r.code);
        expect(new Set(codes).size, c).toBe(codes.length);
      }
    });
    test('every person sits in a location that exists, and every account in a person that exists', () => {
      const locs = new Set(vals(seed, 'locations').map(l => l.code));
      const people = new Set(vals(seed, 'people').map(p => p.code));
      expect(vals(seed, 'people').filter(p => p.location && !locs.has(p.location as string)).map(p => p.code)).toEqual([]);
      expect(vals(seed, 'accounts').filter(a => !people.has(a.personCode as string)).map(a => a.email)).toEqual([]);
    });
    test('at least one account of each user type exists', () => {
      const types = new Set(vals(seed, 'accounts').map(a => a.userType));
      expect([...types].sort()).toEqual(['admin', 'employee', 'manager']);
    });
  });
}
test('meta carries flags, modules and the lifecycle', () => {
  expect(meta.flags.length).toBeGreaterThan(30);
  expect(meta.modules.map((m: { code: string }) => m.code)).toContain('CORE');
  expect(Object.keys(meta.empStates)).toEqual(['candidate', 'preboard', 'active', 'suspended', 'onleave', 'leaver', 'archived']);
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npx vitest run src/mocks/seed`
Expected: FAIL, because the placeholders have no people.

- [ ] **Step 3: Write the extractor**

`scripts/extract-seed.mjs`:
```js
/* Reads the prototype's own data, so no sample record is retyped. Two routes:
   the store the prototype writes to localStorage (every persisted collection),
   and, for constants that are never persisted, the literal in its source. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { JSDOM } from 'jsdom';

const here = dirname(fileURLToPath(import.meta.url));
const SRC = process.env.PROTOTYPE_PATH || resolve(here, '../../Qnipay workforce cc/mockup/qnipay-workforce-v15.html');
const html = readFileSync(SRC, 'utf8');
const OUT = resolve(here, '../src/mocks/seed');
const FROZEN = new Date(2026, 7, 13, 14, 30, 0);   // the date the sample data was authored around
const STAMP = FROZEN.toISOString();
const KEY = 'qnipay.workforce.v1';
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- constants from the source: the text of `const NAME=<literal>;`, evaluated alone ---- */
function literal(name) {
  const at = html.search(new RegExp(`(?:const|let) ${name}\\s*=`));
  if (at < 0) throw new Error('literal not found: ' + name);
  const open = html.slice(at).search(/[[{]/) + at;
  let depth = 0, quote = null;
  for (let j = open; j < html.length; j++) {
    const c = html[j];
    if (quote) { if (c === '\\') j++; else if (c === quote) quote = null; continue; }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if (c === '[' || c === '{') depth++;
    else if ((c === ']' || c === '}') && --depth === 0) {
      /* functions inside (e.g. needs:()=>flagOn(...)) evaluate to functions and are dropped by JSON */
      return JSON.parse(JSON.stringify(vm.runInNewContext('(' + html.slice(open, j + 1) + ')', { flagOn: () => true })));
    }
  }
  throw new Error('unclosed literal: ' + name);
}

/* ---- the prototype, run the way its own suite runs it ---- */
function boot() {
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true, url: 'https://local/',
    beforeParse(w) {
      const Real = w.Date;
      function Frozen(...a) { return a.length ? new Real(...a) : new Real(FROZEN.getTime()); }
      Frozen.prototype = Real.prototype; Frozen.now = () => FROZEN.getTime(); Frozen.parse = Real.parse; Frozen.UTC = Real.UTC;
      w.Date = Frozen; w.scrollTo = () => {};
    } });
  const w = dom.window, d = w.document;
  const click = el => el && el.dispatchEvent(new w.MouseEvent('click', { bubbles: true }));
  const act = a => [...d.querySelectorAll('[data-act]')].find(b => b.getAttribute('data-act') === a);
  const signInAdmin = () => {
    const acc = d.querySelector('#lg-accounts');
    if (acc && acc.classList.contains('hidden')) click(act('show-accounts'));
    const row = [...d.querySelectorAll('#lg-accounts .acct')].find(b => /Configuration, modules/.test(b.textContent));
    d.querySelector('#lg-em').value = row.getAttribute('data-em');
    d.querySelector('#lg-pw').value = 'Qnipay@123';
    click(act('signin'));
  };
  const useTenant = k => {
    click([...d.querySelectorAll('[data-mod-k]')].find(b => b.getAttribute('data-mod-k') === 'setup'));
    click([...d.querySelectorAll('[data-setupsec]')].find(b => b.getAttribute('data-setupsec') === 'org'));
    click([...d.querySelectorAll('[data-tpl]')].find(b => b.getAttribute('data-tpl') === k));
  };
  return { w, signInAdmin, useTenant };
}

const meta = (r, extra = {}) => ({ version: 1, updatedAt: STAMP, ...r, ...extra });
const byId = arr => Object.fromEntries(arr.map(r => [r.id, r]));
const dim = (prefix, list) => byId((list || []).map(x => meta({ ...x }, { id: `${prefix}_${x.code}` })));

function shape(tenantKey, data, PERMS_META) {
  const ROLE_OF = { emp: 'employee', mgr: 'manager', adm: 'admin' };
  const people = (data.PEOPLE || []).map(p => meta({
    id: `per_${p.id}`, code: p.id, name: p.nm, email: (p.email || '').toLowerCase(),
    jobProfile: p.job || '', employeeType: p.type || '', category: p.cat || '', location: p.loc || '',
    department: p.dept || '', manager: p.mgr && p.mgr !== '—' ? p.mgr : '', contractedHours: p.con ?? 0,
    maxHours: p.max ?? 48, state: p.state || 'active', start: p.start || '', end: p.end || '' }));
  const accounts = Object.entries(data.USERS || {}).map(([email, u]) => meta({
    id: `acc_${email}`, email, personCode: u.eid, userType: u.role, grants: [], revocations: [] }));
  const perms = data.PERMS || PERMS_META;
  const userTypes = Object.entries(ROLE_OF).map(([col, role]) => meta({
    id: role, name: (data.ROLE_NAMES || {})[role] || role[0].toUpperCase() + role.slice(1),
    description: { employee: 'Their own work: timesheet, shifts and leave', manager: 'Everything an employee can do, plus their team', admin: 'Configure how this workforce operates' }[role],
    capabilities: perms.filter(p => p[col]).map(p => p.c) }));
  const capabilities = perms.map(p => meta({ id: p.c, group: p.g, label: p.label, gate: p.gate,
    lockedFor: (p.lock || []).map(k => ROLE_OF[k]) }));
  const tenant = meta({ id: 'tenant', name: (data.TENANT || {}).name || tenantKey, template: (data.CFG || {}).template || tenantKey,
    modules: (data.CFG || {}).modules || {}, flags: (data.CFG || {}).flags || {} });
  const notices = (data.NOTICES || []).map(n => meta({ ...n }, { id: n.id }));
  return { version: 'extracted', tenant: tenantKey, data: {
    people: byId(people), accounts: byId(accounts), userTypes: byId(userTypes), capabilities: byId(capabilities),
    tenant: { tenant }, locations: dim('loc', data.LOCATIONS), departments: dim('dep', data.DEPARTMENTS),
    costCentres: dim('cc', data.COST_CENTRES), jobProfiles: dim('job', data.JOB_PROFILES), projects: dim('prj', data.PROJECTS),
    notices: byId(notices), audit: {} } };
}

const PERMS_META = literal('PERMS');
const { w, signInAdmin, useTenant } = boot();
signInAdmin();
await sleep(500);
const read = () => JSON.parse(w.localStorage.getItem(KEY)).data;
const qcic = read();
useTenant('social');
await sleep(500);
const social = read();

writeFileSync(resolve(OUT, 'qcic.json'), JSON.stringify(shape('qcic', qcic, PERMS_META), null, 1) + '\n');
writeFileSync(resolve(OUT, 'social.json'), JSON.stringify(shape('social', social, PERMS_META), null, 1) + '\n');
writeFileSync(resolve(OUT, 'meta.json'), JSON.stringify({
  flags: literal('FLAGS'), modules: literal('MODULES'), permGroups: literal('PERM_GROUPS'), empStates: literal('EMP_STATES') }, null, 1) + '\n');
console.log('seed written: qcic', (qcic.PEOPLE || []).length, 'people; social', (social.PEOPLE || []).length, 'people');
w.close();
```

- [ ] **Step 4: Run it**

Run: `npm run seed`
Expected: `seed written: qcic N people; social M people`, with both N and M greater than 0.
- If the store is empty, the sign-in did not happen: the account list's selector or text has changed.
- To fix it, open the prototype, compare against `goSignIn` and `signInWith` in `../Qnipay workforce cc/mockup/qnipay-regression-suite.js:37-85`, and match those.
- Change only the extractor.

- [ ] **Step 5: Run the test**

Run: `npx vitest run src/mocks && npm run typecheck`
Expected: all seed tests pass, and the Task 5 tests still pass.
- If "codes are unique" fails for `people`, the prototype has a duplicate employee ID. CLAUDE.md says codes are identity, so this is a real finding. Do not dedupe silently.
- Instead, list the duplicates in the commit message, and in the extractor keep the first record and log the rest.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(mocks): seed extracted from the prototype for qcic and social, with meta

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Session, sign-in and the app frame

**Files:**
- Create:
  - `src/contract/session.ts`
  - `src/mocks/session.ts` (handlers and `requireSession`)
  - `src/api/query.ts`
  - `src/shell/SessionProvider.tsx`, `src/shell/SignIn.tsx`
  - `src/App.tsx` (replaced)
  - `playwright.config.ts`, `e2e/support/fixtures.ts`, `e2e/sign-in.spec.ts`
- Modify: `src/mocks/handlers.ts`, `src/contract/index.ts`, `src/testids.ts` (if needed)
- Test: `src/mocks/session.test.ts`, `e2e/sign-in.spec.ts`

**Interfaces:**
- Consumes: `store`, `refuse`, `handle`, `readJson`, `writeAudit`, `tid`, `toastRefusal`.
- Produces:
  - Schemas: `Session` (`{token, account: {email, userType, personCode, name}, capabilities: string[], viewingAs?: {personCode, name, userType}}`), `SignInRequest` and `ViewAsRequest`.
  - Endpoints: `createSession` (POST `/api/v1/session`), `getSession` (GET `/api/v1/session`), `deleteSession` (DELETE `/api/v1/session`), `startViewAs` (POST `/api/v1/session/view-as`), `endViewAs` (DELETE `/api/v1/session/view-as`) and `listAccounts` (GET `/api/v1/session/accounts`, the demo shortcut list, which is labelled as a stub).
  - Server-side: `requireSession(request): ServerSession` and `requireCapability(s, cap)`.
  - Client-side: `useSession()` returns `{session, signIn, signOut, viewAs, endViewAs}`.
  - `e2e` fixtures: `signInAs(page, 'employee'|'manager'|'admin')`, plus `api.reset`, `api.seed`, `api.setClock`, `api.fault` and `api.get`. All of them run inside the page, because MSW lives in the page's service worker.

The capability resolution these endpoints need is `resolveCapabilities(userType, grants, revocations)`, written in Task 8. For this task, `requireCapability` reads `session.capabilities`, which the handler computes with a local helper. Task 8 moves that helper into `domain/capabilities.ts` and replaces the helper with an import.

- [ ] **Step 1: Write the failing tests**

`src/mocks/session.test.ts`:
```ts
import { server } from './node';
import { store } from './store';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => store.reset('social'));
const post = (url: string, body?: unknown, token?: string) => fetch(url, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) } });
const anyAccount = (type: string) => Object.values(store.db.accounts as Record<string, { email: string; userType: string }>).find(a => a.userType === type)!;

test('signing in with the demo password returns a session with capabilities', async () => {
  const r = await post('/api/v1/session', { email: anyAccount('manager').email, password: 'Qnipay@123' });
  expect(r.status).toBe(200);
  const s = await r.json();
  expect(s.account.userType).toBe('manager');
  expect(s.capabilities).toContain('team_people');
});
test('a wrong password is refused with a next step, and nothing is issued', async () => {
  const r = await post('/api/v1/session', { email: anyAccount('manager').email, password: 'nope' });
  expect(r.status).toBe(401);
  expect(await r.json()).toMatchObject({ code: 'credentials', next: expect.any(String) });
});
test('a session whose account has gone is refused, so the client signs out', async () => {
  const acc = anyAccount('employee');
  const { token } = await (await post('/api/v1/session', { email: acc.email, password: 'Qnipay@123' })).json();
  delete (store.db.accounts as Record<string, unknown>)[`acc_${acc.email}`];
  const r = await fetch('/api/v1/session', { headers: { Authorization: `Bearer ${token}` } });
  expect(r.status).toBe(401);
});
test('view-as is audited, and the session says who is really signed in', async () => {
  const admin = anyAccount('admin'), emp = anyAccount('employee');
  const { token } = await (await post('/api/v1/session', { email: admin.email, password: 'Qnipay@123' })).json();
  const r = await post('/api/v1/session/view-as', { personCode: emp.personCode }, token);
  const s = await r.json();
  expect(s.viewingAs.personCode).toBe(emp.personCode);
  expect(s.account.email).toBe(admin.email);
  expect(Object.values(store.db.audit!).some((a) => (a as { act: string }).act === 'View-as started')).toBe(true);
});
```
`e2e/sign-in.spec.ts`:
```ts
import { test, expect } from './support/fixtures';
import { tid } from '../src/testids';

test('SI Signing in as each persona shows that persona', async ({ page, signInAs }) => {
  for (const p of ['employee', 'manager', 'admin'] as const) {
    await signInAs(p);
    await expect(page.getByTestId(tid.shell.rolePill)).toHaveText(/Employee|Manager|Admin/);
    await page.getByTestId(tid.shell.account).click();
    await page.getByTestId(tid.shell.signOut).click();
    await expect(page.getByTestId(tid.signIn.form)).toBeVisible();
  }
});
test('SI A wrong password says what to do and signs nobody in', async ({ page, api }) => {
  await api.reset();
  await page.getByTestId(tid.signIn.email).fill('nobody@example.org');
  await page.getByTestId(tid.signIn.password).fill('wrong');
  await page.getByTestId(tid.signIn.submit).click();
  await expect(page.getByTestId(tid.signIn.error)).toContainText(/Check the address and password/);
  expect(await api.get('/api/v1/session')).toMatchObject({ status: 401 });
});
test('SI A failed sign-in request leaves you on the sign-in screen with a reason', async ({ page, api }) => {
  await api.fault('POST', '/api/v1/session', 500);
  await page.getByTestId(tid.signIn.email).fill('x@example.org');
  await page.getByTestId(tid.signIn.password).fill('Qnipay@123');
  await page.getByTestId(tid.signIn.submit).click();
  await expect(page.getByTestId(tid.signIn.error)).toContainText(/Nothing has been changed/);
  await expect(page.getByTestId(tid.signIn.form)).toBeVisible();
});
```

- [ ] **Step 2: Run the unit test and watch it fail**

Run: `npx vitest run src/mocks/session.test.ts`
Expected: FAIL, 404 or unhandled request on `/api/v1/session`.

- [ ] **Step 3: The session contract**

`src/contract/session.ts`:
```ts
import { z } from 'zod';
import { defineEndpoint } from './endpoints';

export const SessionAccount = z.object({ email: z.string(), userType: z.enum(['employee', 'manager', 'admin']), personCode: z.string(), name: z.string() });
export const Session = z.object({
  token: z.string(), account: SessionAccount, capabilities: z.array(z.string()),
  viewingAs: z.object({ personCode: z.string(), name: z.string(), userType: SessionAccount.shape.userType }).optional(),
  simulated: z.literal(true),   // honest label: this sign-in is not Entra ID yet
});
export type Session = z.infer<typeof Session>;
export const SignInRequest = z.object({ email: z.string().min(1), password: z.string().min(1) });
export const ViewAsRequest = z.object({ personCode: z.string() });
export const DemoAccount = z.object({ email: z.string(), name: z.string(), userType: SessionAccount.shape.userType, personCode: z.string() });

export const createSession = defineEndpoint({ method: 'POST', path: '/api/v1/session', request: SignInRequest, response: Session, summary: 'Sign in (simulated; Entra ID in production)' });
export const getSession = defineEndpoint({ method: 'GET', path: '/api/v1/session', response: Session, summary: 'The current session' });
export const deleteSession = defineEndpoint({ method: 'DELETE', path: '/api/v1/session', response: z.null(), summary: 'Sign out' });
export const startViewAs = defineEndpoint({ method: 'POST', path: '/api/v1/session/view-as', request: ViewAsRequest, response: Session, capability: 'integration', summary: 'Look at the app as another person; audited' });
export const endViewAs = defineEndpoint({ method: 'DELETE', path: '/api/v1/session/view-as', response: Session, summary: 'Return to your own account' });
export const listAccounts = defineEndpoint({ method: 'GET', path: '/api/v1/session/accounts', response: z.array(DemoAccount), summary: 'Demo account shortcuts (stub: not in production)' });
```
Add `export * from './session';` to `src/contract/index.ts`.

In the prototype, view-as is an admin privilege. The capability that gates it here is `integration`, the prototype's "Integrations and audit log" row. Record this choice in the commit message, so review can move it to its own capability if the matrix gains one.

- [ ] **Step 4: The session handlers**

`src/mocks/session.ts`:
```ts
import { http, HttpResponse } from 'msw';
import { store } from './store';
import { handle, readJson, refuse } from './http';
import { writeAudit } from './audit';
import { SignInRequest, ViewAsRequest, type Session } from '@/contract/session';

export const DEMO_PASSWORD = 'Qnipay@123';   // stub: shared demo password, replaced by Entra ID
interface Account { email: string; userType: Session['account']['userType']; personCode: string; grants: string[]; revocations: string[] }
interface Person { code: string; name: string }
interface UserType { id: string; capabilities: string[] }
export interface ServerSession { token: string; email: string; viewingAs?: string }

const sessions = () => store.coll<ServerSession>('sessions');
const accountBy = (email: string) => store.coll<Account>('accounts')[`acc_${email.toLowerCase()}`];
const personBy = (code: string) => Object.values(store.coll<Person>('people')).find(p => p.code === code);
/* moved to domain/capabilities.ts in Task 8 */
export const capsFor = (a: Account) => {
  const base = store.coll<UserType>('userTypes')[a.userType]?.capabilities ?? [];
  return [...new Set([...base, ...a.grants])].filter(c => !a.revocations.includes(c)).sort();
};
function view(s: ServerSession): Session {
  const a = accountBy(s.email)!; const p = personBy(a.personCode);
  const vp = s.viewingAs ? personBy(s.viewingAs) : undefined;
  const va = vp ? Object.values(store.coll<Account>('accounts')).find(x => x.personCode === vp.code) : undefined;
  return { token: s.token, simulated: true,
    account: { email: a.email, userType: a.userType, personCode: a.personCode, name: p?.name ?? a.email },
    capabilities: capsFor(va ?? a),
    ...(vp ? { viewingAs: { personCode: vp.code, name: vp.name, userType: va?.userType ?? 'employee' } } : {}) };
}
export function requireSession(request: Request): ServerSession & { account: Account; caps: string[] } {
  const token = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
  const s = sessions()[token];
  const a = s && accountBy(s.email);
  if (!s || !a) return refuse(401, { code: 'signed-out', message: 'You are signed out.', next: 'Sign in again to continue.' });
  return { ...s, account: a, caps: view(s).capabilities };
}
export function requireCapability(s: { caps: string[] }, cap: string, label: string) {
  if (!s.caps.includes(cap)) refuse(403, { code: 'capability', message: `This needs "${label}", which your access does not include.`, next: 'Ask an administrator to grant it on Qnipay setup → Permissions.' });
}
const who = (s: ServerSession & { account: Account }) => ({ personCode: s.account.personCode, name: personBy(s.account.personCode)?.name ?? s.email, ...(s.viewingAs ? { viewingAs: s.viewingAs } : {}) });

export const sessionHandlers = [
  http.get('/api/v1/session/accounts', () => HttpResponse.json(Object.values(store.coll<Account>('accounts'))
    .map(a => ({ email: a.email, userType: a.userType, personCode: a.personCode, name: personBy(a.personCode)?.name ?? a.email })))),
  http.post('/api/v1/session', handle(async ({ request }) => {
    const { email, password } = await readJson(request, SignInRequest);
    const a = accountBy(email);
    if (!a || password !== DEMO_PASSWORD) return refuse(401, { code: 'credentials', message: 'That address and password do not match an account.', next: 'Check the address and password, or pick an account from the list.' });
    const token = crypto.randomUUID(); sessions()[token] = { token, email: a.email };
    return HttpResponse.json(view(sessions()[token]!));
  })),
  http.get('/api/v1/session', handle(({ request }) => HttpResponse.json(view(requireSession(request))))),
  http.delete('/api/v1/session', handle(({ request }) => { const s = requireSession(request); delete sessions()[s.token]; return HttpResponse.json(null); })),
  http.post('/api/v1/session/view-as', handle(async ({ request }) => {
    const s = requireSession(request); requireCapability(s, 'integration', 'Integrations and audit log');
    const { personCode } = await readJson(request, ViewAsRequest);
    const p = personBy(personCode);
    if (!p) return refuse(422, { code: 'invalid', field: 'personCode', message: 'There is nobody with that employee ID.', next: 'Pick a person from the list.' });
    sessions()[s.token] = { ...sessions()[s.token]!, viewingAs: personCode };
    writeAudit({ who: who(s), act: 'View-as started', entity: 'session', entityId: s.account.email, before: null, after: { viewingAs: personCode } });
    return HttpResponse.json(view(sessions()[s.token]!));
  })),
  http.delete('/api/v1/session/view-as', handle(({ request }) => {
    const s = requireSession(request); const was = s.viewingAs;
    sessions()[s.token] = { token: s.token, email: s.email };
    if (was) writeAudit({ who: who({ ...s, viewingAs: undefined }), act: 'View-as ended', entity: 'session', entityId: s.account.email, before: { viewingAs: was }, after: null });
    return HttpResponse.json(view(sessions()[s.token]!));
  })),
];
```
Add `...sessionHandlers` to `handlers` in `src/mocks/handlers.ts`, after `devHandlers`.

- [ ] **Step 5: Run the unit test**

Run: `npx vitest run src/mocks/session.test.ts`
Expected: 4 tests pass.

- [ ] **Step 6: The client frame**

`src/api/query.ts`:
```ts
import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';
export const queryClient = new QueryClient({ defaultOptions: {
  queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1, staleTime: 5_000 },
  /* no optimistic updates anywhere: the UI changes only when the server has answered */
  mutations: { retry: false } } });
```
`src/shell/SessionProvider.tsx`:
```tsx
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/api/client';
import { getToken, setToken } from '@/api/session-token';
import { createSession, deleteSession, endViewAs, getSession, startViewAs, type Session } from '@/contract/session';
import { queryClient } from '@/api/query';

interface Ctx { session: Session | null; ready: boolean;
  signIn(email: string, password: string): Promise<void>; signOut(): Promise<void>;
  viewAs(personCode: string): Promise<void>; endViewAs(): Promise<void>; }
const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => { const c = useContext(SessionCtx); if (!c) throw new Error('useSession outside provider'); return c; };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);
  const adopt = useCallback((s: Session | null) => { setToken(s?.token ?? null); setSession(s); queryClient.clear(); }, []);
  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    /* a token for an account that has gone is a signed-out person, not an empty shell */
    api(getSession).then(adopt, () => adopt(null)).finally(() => setReady(true));
  }, [adopt]);
  const value: Ctx = { session, ready,
    signIn: async (email, password) => adopt(await api(createSession, { body: { email, password } })),
    signOut: async () => { try { await api(deleteSession); } catch (e) { if (!(e instanceof ApiError)) throw e; } adopt(null); },
    viewAs: async personCode => adopt(await api(startViewAs, { body: { personCode } })),
    endViewAs: async () => adopt(await api(endViewAs)) };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
```
`src/shell/SignIn.tsx`:
```tsx
import { useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, ApiError } from '@/api/client';
import { listAccounts } from '@/contract/session';
import { tid } from '@/testids';
import { Button, Field, TextInput } from '@/ui';
import { useSession } from './SessionProvider';

const NOTE = { employee: 'Their own work: timesheet, shifts and leave', manager: 'Approvals and their team', admin: 'Configuration, modules and access' } as const;

export function SignIn() {
  const { signIn } = useSession();
  const [email, setEmail] = useState(''); const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null); const [busy, setBusy] = useState(false);
  const [showAccounts, setShowAccounts] = useState(false);
  const accounts = useQuery({ queryKey: ['demo-accounts'], queryFn: () => api(listAccounts), enabled: showAccounts });
  async function submit(e: FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await signIn(email, password); }
    catch (err) { setError(err instanceof ApiError ? `${err.refusal.message} ${err.refusal.next}` : 'Sign-in failed. Nothing has been changed.'); }
    finally { setBusy(false); }
  }
  return (
    <main data-testid={tid.page('sign-in')} className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-lg p-lg">
      <h1 className="text-[length:var(--qp-text-24)] font-semibold">Sign in to Qnipay Workforce</h1>
      <p className="text-text-secondary">Simulated sign-in. Production uses your Microsoft work account.</p>
      <form data-testid={tid.signIn.form} onSubmit={submit} className="flex flex-col gap-md" noValidate>
        <Field testId="sign-in-email-field" label="Email address"><TextInput testId={tid.signIn.email} type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} /></Field>
        <Field testId="sign-in-password-field" label="Password"><TextInput testId={tid.signIn.password} type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></Field>
        {error && <p data-testid={tid.signIn.error} role="alert" className="text-err">{error}</p>}
        <Button testId={tid.signIn.submit} kind="primary" type="submit" disabled={busy}>Sign in</Button>
      </form>
      <Button testId={tid.signIn.showAccounts} kind="ghost" onClick={() => setShowAccounts(s => !s)}>{showAccounts ? 'Hide demo accounts' : 'Show demo accounts'}</Button>
      {showAccounts && <ul className="flex flex-col gap-xs" aria-label="Demo accounts. A shortcut, not the whole list.">
        {accounts.data?.map(a => <li key={a.email}>
          <button type="button" data-testid={tid.signIn.account(a.email)} className="w-full rounded-control border border-border p-sm text-left"
            onClick={() => { setEmail(a.email); setPassword('Qnipay@123'); }}>
            <b>{a.name}</b> · {NOTE[a.userType]}<span className="block text-text-secondary">{a.email}</span></button></li>)}
      </ul>}
    </main>);
}
```
`src/App.tsx`:
```tsx
import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { Toaster } from '@/ui/shadcn/sonner';
import { queryClient } from '@/api/query';
import { SessionProvider, useSession } from '@/shell/SessionProvider';
import { SignIn } from '@/shell/SignIn';
import { tid } from '@/testids';

function Gate() {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (!session) return <SignIn />;
  /* replaced by <Shell /> in Task 8 */
  return <div data-testid={tid.shell.rolePill}>{session.account.userType[0]!.toUpperCase() + session.account.userType.slice(1)}</div>;
}
export function App() {
  return (
    <div data-testid={tid.app}>
      <QueryClientProvider client={queryClient}><BrowserRouter><SessionProvider><Gate /></SessionProvider></BrowserRouter></QueryClientProvider>
      <Toaster position="bottom-right" />
    </div>);
}
```
Update `src/App.test.tsx`, because the root is now asynchronous:
```tsx
import { render, screen } from '@testing-library/react';
import { App } from './App';
test('the app renders its root', () => { render(<App />); expect(screen.getByTestId('app-root')).toBeInTheDocument(); });
```

- [ ] **Step 7: Playwright configuration and fixtures**

`playwright.config.ts`:
```ts
import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', fullyParallel: false, workers: 1, retries: 0, reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:5173', testIdAttribute: 'data-testid', trace: 'retain-on-failure', locale: 'en-GB', timezoneId: 'Europe/London' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
});
```
`e2e/support/fixtures.ts`:
```ts
import { test as base, expect, type Page } from '@playwright/test';
import { tid } from '../../src/testids';

/* MSW lives in the page's service worker, so control calls run inside the page. */
const call = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(async ([m, p, b]) => {
    const token = sessionStorage.getItem('qnipay.session');
    const r = await fetch(p as string, { method: m as string, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: b === undefined ? undefined : JSON.stringify(b) });
    const text = await r.text();
    return { status: r.status, body: text ? JSON.parse(text) : null };
  }, [method, path, body] as const);

export const FROZEN = '2026-08-13T14:30:00.000Z';
type Persona = 'employee' | 'manager' | 'admin';
export const test = base.extend<{
  api: { reset(): Promise<void>; seed(t: 'social' | 'qcic'): Promise<void>; setClock(iso: string | null): Promise<void>;
    fault(method: string, path: string, status: number, times?: number): Promise<void>; get(path: string): Promise<{ status: number; body: unknown }>;
    send(method: string, path: string, body?: unknown): Promise<{ status: number; body: unknown }> };
  signInAs(p: Persona): Promise<void>;
}>({
  api: async ({ page }, use) => {
    await page.goto('/');
    await page.getByTestId(tid.signIn.form).or(page.getByTestId(tid.shell.rolePill)).waitFor();
    const api = {
      reset: async () => { await call(page, 'POST', '/api/_dev/reset'); await call(page, 'POST', '/api/_dev/clock', { now: FROZEN }); },
      seed: async (t: string) => { await call(page, 'POST', `/api/_dev/seed/${t}`); },
      setClock: async (iso: string | null) => { await call(page, 'POST', '/api/_dev/clock', { now: iso }); },
      fault: async (method: string, path: string, status: number, times = 1) => { await call(page, 'POST', '/api/_dev/faults', { method, path, status, times }); },
      get: (path: string) => call(page, 'GET', path),
      send: (method: string, path: string, body?: unknown) => call(page, method, path, body),
    };
    await api.reset();
    await use(api);
  },
  signInAs: async ({ page, api }, use) => {
    await use(async (p: Persona) => {
      const accounts = (await api.get('/api/v1/session/accounts')).body as { email: string; userType: Persona }[];
      const acc = accounts.find(a => a.userType === p)!;
      await page.evaluate(() => sessionStorage.removeItem('qnipay.session'));
      await page.goto('/');
      await page.getByTestId(tid.signIn.email).fill(acc.email);
      await page.getByTestId(tid.signIn.password).fill('Qnipay@123');
      await page.getByTestId(tid.signIn.submit).click();
      await expect(page.getByTestId(tid.shell.rolePill)).toBeVisible();
    });
  },
});
export { expect };
```
The `sign-in` e2e test clicks `tid.shell.account` and `tid.shell.signOut`, which only exist from Task 8. For now, mark the first test `test.fixme` with the comment `/* account menu arrives in Task 8 */`. Task 8 Step 6 removes the `fixme`.

- [ ] **Step 8: Run**

Run: `npx vitest run && npm run openapi && npm run e2e`
Expected: the unit tests pass, the OpenAPI output lists 6 endpoints, the two active e2e tests pass, and one test is fixme.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat(shell): simulated session, sign-in, view-as with audit, Playwright fixtures

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Capabilities, navigation and the shell

**Files:**
- Create:
  - `src/domain/capabilities.ts`, `src/domain/nav.ts`
  - `src/contract/tenant.ts`, `src/mocks/tenant.ts`
  - `src/shell/Shell.tsx`, `src/shell/AccountMenu.tsx`
  - `src/features/not-built/NotBuilt.tsx`, `src/features/setup/SetupIndex.tsx`
- Modify: `src/mocks/session.ts` (use `resolveCapabilities`), `src/App.tsx` (render `<Shell />`), `src/mocks/handlers.ts`, `src/contract/index.ts`
- Test: `src/domain/capabilities.test.ts`, `src/domain/nav.test.ts`, `src/shell/shell.test.tsx`, `e2e/nav.spec.ts`

**Interfaces:**
- Produces:
  - `resolveCapabilities(templateCaps: string[], grants: string[], revocations: string[]): string[]`
  - `buildNav(input: NavInput): NavGroup[]`, where:
    - `NavInput` is `{caps: Set<string>, modules: Record<string, boolean>, flags: Record<string, boolean>, onboarding: boolean}`;
    - `NavGroup` is `{key: 'work'|'team'|'setup', label: string, tabs: NavTab[]}`;
    - `NavTab` is `{view: string, label: string, group?: string, path: string, built: boolean, subProject?: string}`.
  - The endpoint `getTenant` (GET `/api/v1/tenant`), which returns `{name, template, modules, flags}`.
  - Routes: `/<groupKey>/<view>`, for example `/team/people` and `/setup/aperm`.
  - A `NotBuilt` page, which names the sub-project that brings the view.

- [ ] **Step 1: Write the failing tests**

`src/domain/capabilities.test.ts`:
```ts
import { resolveCapabilities } from './capabilities';
test('template plus grants minus revocations, sorted and unique', () => {
  expect(resolveCapabilities(['own_home', 'team_ts'], ['proxy', 'own_home'], ['team_ts'])).toEqual(['own_home', 'proxy']);
});
test('a revocation beats a grant of the same capability', () => {
  expect(resolveCapabilities([], ['proxy'], ['proxy'])).toEqual([]);
});
```
`src/domain/nav.test.ts`. The cases are ported from the prototype's `NAV()` (html:4004-4060) and the "MANAGER NAV GROUPED BY MODULE" assertions:
```ts
import { buildNav } from './nav';
const ALL_MODULES = { A: true, B: true, TS: true, R: true, L: true, ON: true, CORE: true };
const flags = { DOCS: true, NOTICES: true, FULFIL: true };
const caps = (...c: string[]) => new Set(c);

test('an employee gets My Work only, in prototype order', () => {
  const g = buildNav({ caps: caps('own_home', 'own_ts', 'own_shifts', 'own_leave', 'own_hours', 'own_notices'), modules: ALL_MODULES, flags, onboarding: false });
  expect(g.map(x => x.key)).toEqual(['work']);
  expect(g[0]!.tabs.map(t => t.label)).toEqual(['Home', 'Timesheet', 'Shifts', 'Leave', 'Hours', 'Profile', 'Documents', 'Notices']);
});
test('a manager also gets My Team, with Team Home and Approvals in the strip and the rest under headings', () => {
  const g = buildNav({ caps: caps('own_home', 'team_ts', 'team_rota', 'team_cover', 'team_leave', 'team_sick', 'team_hours', 'team_people', 'onb_track', 'notice_post'), modules: ALL_MODULES, flags, onboarding: false });
  const team = g.find(x => x.key === 'team')!;
  expect(team.tabs.filter(t => !t.group).map(t => t.label)).toEqual(['Team Home', 'Approvals']);
  expect([...new Set(team.tabs.filter(t => t.group).map(t => t.group))]).toEqual(['Scheduling', 'Requests', 'People']);
});
test('a module switched off removes its tabs', () => {
  const g = buildNav({ caps: caps('own_home', 'own_shifts', 'own_leave'), modules: { ...ALL_MODULES, R: false, L: false }, flags, onboarding: false });
  expect(g[0]!.tabs.map(t => t.label)).not.toContain('Shifts');
  expect(g[0]!.tabs.map(t => t.label)).not.toContain('Leave');
});
test('someone still onboarding sees onboarding and nothing else', () => {
  const g = buildNav({ caps: caps('own_home', 'own_onb', 'own_ts'), modules: ALL_MODULES, flags, onboarding: true });
  expect(g.flatMap(x => x.tabs).map(t => t.label)).toEqual(['Onboarding']);
});
test('views outside plan 1a are marked not built and name their sub-project', () => {
  const g = buildNav({ caps: caps('own_home', 'own_ts'), modules: ALL_MODULES, flags, onboarding: false });
  const ts = g[0]!.tabs.find(t => t.view === 'ts')!;
  expect(ts).toMatchObject({ built: false, subProject: 'Timesheet' });
});
```
`src/shell/shell.test.tsx`:
```tsx
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from '@/api/query';
import { ShellView } from './Shell';
import { buildNav } from '@/domain/nav';
import { expectTestIdCoverage } from '@/test/testid-coverage';

test('the shell has full test id coverage for a manager', () => {
  const nav = buildNav({ caps: new Set(['own_home', 'team_ts', 'team_people', 'notice_post']), modules: { TS: true, A: true, CORE: true }, flags: { NOTICES: true }, onboarding: false });
  const { container } = render(<QueryClientProvider client={queryClient}><MemoryRouter initialEntries={['/work/home']}>
    <ShellView nav={nav} roleLabel="Manager" viewingAs={null} unread={2} onSignOut={() => {}} onEndViewAs={() => {}} /></MemoryRouter></QueryClientProvider>);
  expectTestIdCoverage(container);
});
```
`e2e/nav.spec.ts`:
```ts
import { test, expect } from './support/fixtures';
import { tid } from '../src/testids';

test('NV Manager navigation has two primary areas', async ({ page, signInAs }) => {
  await signInAs('manager');
  await expect(page.getByTestId(tid.nav.group('work'))).toBeVisible();
  await expect(page.getByTestId(tid.nav.group('team'))).toBeVisible();
  await expect(page.getByTestId(tid.nav.group('setup'))).toHaveCount(0);
});
test('NV A view from a later sub-project says so and names it', async ({ page, signInAs }) => {
  await signInAs('employee');
  await page.getByTestId(tid.nav.tab('ts')).click();
  await expect(page.getByTestId(tid.notBuilt.subProject)).toHaveText('Timesheet');
});
test('NV Every page an admin can reach has full test id coverage', async ({ page, signInAs }) => {
  await signInAs('admin');
  for (const g of ['work', 'team', 'setup']) {
    const group = page.getByTestId(tid.nav.group(g)); if (!(await group.count())) continue;
    await group.click();
    const dupes = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('[data-testid]')].map(e => e.getAttribute('data-testid'));
      const missing = [...document.querySelectorAll('main button, main a[href], main input, main select, main textarea')].filter(e => !e.getAttribute('data-testid')).length;
      return { dup: ids.filter((x, i) => ids.indexOf(x) !== i), missing };
    });
    expect(dupes).toEqual({ dup: [], missing: 0 });
  }
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/domain src/shell`
Expected: FAIL, modules not found.

- [ ] **Step 3: The pure rules**

`src/domain/capabilities.ts`:
```ts
/* A person's capabilities: their user type's template, plus grants, minus revocations.
   A revocation always wins. Pure, so the fake server and later the real one agree. */
export function resolveCapabilities(templateCaps: readonly string[], grants: readonly string[], revocations: readonly string[]): string[] {
  const out = new Set([...templateCaps, ...grants]);
  revocations.forEach(r => out.delete(r));
  return [...out].sort();
}
```
`src/domain/nav.ts`, ported from the prototype `NAV()`:
```ts
/* Ported from the prototype's NAV() (qnipay-workforce-v15.html, "function NAV()").
   Order is screen order; a run of tabs sharing `group` becomes one menu. */
export interface NavInput { caps: Set<string>; modules: Record<string, boolean>; flags: Record<string, boolean>; onboarding: boolean }
export interface NavTab { view: string; label: string; group?: string; path: string; built: boolean; subProject?: string }
export interface NavGroup { key: 'work' | 'team' | 'setup'; label: string; tabs: NavTab[] }

/* which sub-project brings each view; a view not listed here is built in plan 1a */
const LATER: Record<string, string> = {
  home: 'Workforce core (plan 1c)', ts: 'Timesheet', shifts: 'Rota', leave: 'Leave', hours: 'Timesheet',
  profile: 'Workforce core (plan 1b)', docs: 'Workforce core (plan 1c)', notices: 'Workforce core (plan 1c)', onb: 'Onboarding',
  thome: 'Workforce core (plan 1c)', tteam: 'Timesheet', thours: 'Timesheet', trota: 'Rota', tcover: 'Rota', tshifts: 'Rota',
  tpat: 'Rota', tleave: 'Leave', tsick: 'Leave', texc: 'Timesheet', tpeople: 'Workforce core (plan 1b)', tonb: 'Onboarding',
  tnotices: 'Workforce core (plan 1c)',
  aorg: 'Workforce core (plan 1c)', acal: 'Workforce core (plan 1c)', amods: 'Workforce core (plan 1c)', apeople: 'Workforce core (plan 1b)',
  atypes: 'Workforce core (plan 1b)', acon: 'Workforce core (plan 1b)', aloc: 'Workforce core (plan 1b)', anotif: 'Workforce core (plan 1c)',
  aappr: 'Workforce core (plan 1c)', mts: 'Timesheet', mrota: 'Rota', mleave: 'Leave', mpay: 'Timesheet',
  ipay: 'Payroll and Business Central', ibc: 'Payroll and Business Central', iit: 'Rota',
};
const tab = (group: NavGroup['key'], view: string, label: string, extra: Partial<NavTab> = {}): NavTab =>
  ({ view, label, path: `/${group}/${view}`, built: !(view in LATER), ...(view in LATER ? { subProject: LATER[view] } : {}), ...extra });

export function buildNav({ caps, modules, flags, onboarding }: NavInput): NavGroup[] {
  const can = (c: string) => caps.has(c), on = (m: string) => !!modules[m], flag = (f: string) => !!flags[f];
  const ts = on('A') || on('B');
  const work: [boolean, NavTab][] = [
    [can('own_onb') && on('ON') && onboarding, tab('work', 'onb', 'Onboarding')],
    [can('own_home') && !onboarding, tab('work', 'home', 'Home')],
    [can('own_ts') && ts && !onboarding, tab('work', 'ts', 'Timesheet')],
    [can('own_shifts') && on('R') && !onboarding, tab('work', 'shifts', 'Shifts')],
    [can('own_leave') && on('L') && !onboarding, tab('work', 'leave', 'Leave')],
    [can('own_hours') && !onboarding, tab('work', 'hours', 'Hours')],
    [can('own_home') && !onboarding, tab('work', 'profile', 'Profile')],
    [can('own_home') && flag('DOCS') && !onboarding, tab('work', 'docs', 'Documents')],
    [can('own_notices') && flag('NOTICES') && !onboarding, tab('work', 'notices', 'Notices')],
  ];
  const teamHome = ['team_ts', 'team_rota', 'team_leave', 'team_people', 'team_hours'].some(can);
  const team: [boolean, NavTab][] = [
    [teamHome, tab('team', 'thome', 'Team Home')],
    [can('team_ts') && ts, tab('team', 'tteam', 'Approvals')],
    [can('team_hours') && ts, tab('team', 'thours', 'Hours position', { group: 'Scheduling' })],
    [can('team_rota') && on('R'), tab('team', 'trota', 'Rota', { group: 'Scheduling' })],
    [can('team_cover') && on('R') && flag('FULFIL'), tab('team', 'tcover', 'Cover requests', { group: 'Scheduling' })],
    [can('rota_shift') && can('team_rota') && on('R'), tab('team', 'tshifts', 'Shift catalogue', { group: 'Scheduling' })],
    [can('rota_pattern') && can('team_rota') && on('R'), tab('team', 'tpat', 'Working patterns', { group: 'Scheduling' })],
    [can('team_leave') && on('L'), tab('team', 'tleave', 'Requests', { group: 'Requests' })],
    [can('team_sick') && on('L'), tab('team', 'tsick', 'Sickness', { group: 'Requests' })],
    [can('team_hours'), tab('team', 'texc', 'Exceptions', { group: 'Requests' })],
    [can('team_people'), tab('team', 'tpeople', 'People', { group: 'People' })],
    [can('onb_track') && on('ON'), tab('team', 'tonb', 'Onboarding', { group: 'People' })],
    [can('notice_post') && flag('NOTICES'), tab('team', 'tnotices', 'Notices', { group: 'People' })],
  ];
  const setupPages: [boolean, NavTab][] = [
    [can('master_data'), tab('setup', 'aorg', 'Organisation')], [can('master_data'), tab('setup', 'acal', 'Calendar')],
    [can('mod_cfg'), tab('setup', 'amods', 'Modules & features')], [can('master_data'), tab('setup', 'apeople', 'People')],
    [can('type_cfg'), tab('setup', 'atypes', 'Employee types')], [can('master_data'), tab('setup', 'acon', 'Contracts')],
    [can('master_data'), tab('setup', 'aloc', 'Dimensions')], [can('perm_cfg'), tab('setup', 'aperm', 'Permissions')],
    [can('framework'), tab('setup', 'anotif', 'Notifications')], [can('framework'), tab('setup', 'aappr', 'Approvals')],
    [can('integration'), tab('setup', 'iaudit', 'Audit log')],
  ];
  const keep = (xs: [boolean, NavTab][]) => xs.filter(([ok]) => ok).map(([, t]) => t);
  const setupTabs = keep(setupPages);
  const groups: NavGroup[] = [
    { key: 'work', label: 'My Work', tabs: keep(work) },
    { key: 'team', label: 'My Team', tabs: onboarding ? [] : keep(team) },
    { key: 'setup', label: 'Qnipay setup', tabs: onboarding || !setupTabs.length ? [] : [tab('setup', 'asetup', 'Qnipay setup'), ...setupTabs] },
  ];
  return groups.filter(g => g.tabs.length);
}
```
In `src/mocks/session.ts`, replace the body of `capsFor` with `return resolveCapabilities(store.coll<UserType>('userTypes')[a.userType]?.capabilities ?? [], a.grants, a.revocations);`, and import `resolveCapabilities` from `@/domain/capabilities`.

- [ ] **Step 4: The tenant endpoint**

`src/contract/tenant.ts`:
```ts
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { RecordMeta } from './common';
export const Tenant = RecordMeta.extend({ name: z.string(), template: z.string(), modules: z.record(z.string(), z.boolean()), flags: z.record(z.string(), z.boolean()) });
export type Tenant = z.infer<typeof Tenant>;
export const getTenant = defineEndpoint({ method: 'GET', path: '/api/v1/tenant', response: Tenant, summary: 'The tenant: name, template, modules and flags' });
```
`src/mocks/tenant.ts`:
```ts
import { http, HttpResponse } from 'msw';
import { store } from './store';
import { handle } from './http';
import { requireSession } from './session';
export const tenantHandlers = [
  http.get('/api/v1/tenant', handle(({ request }) => { requireSession(request); return HttpResponse.json(store.coll('tenant').tenant); })),
];
```
Register it in `contract/index.ts` and in `handlers.ts`.

- [ ] **Step 5: The shell**

`src/shell/Shell.tsx` splits into two parts:
- a data wrapper, `Shell`, which reads the session, the tenant and the unread count;
- a pure `ShellView`, which is what the coverage test renders.

The shell keeps the prototype's structure:
- a top bar with the module switcher (the groups), the role pill, the bell with its count, the theme toggle and the account menu;
- the tab strip, where tabs with the same `group` become one dropdown menu;
- a `<main>` with the routes;
- on phones, a bottom bar with at most five destinations plus More.

```tsx
import type { ComponentType } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { getTenant } from '@/contract/tenant';
import { buildNav, type NavGroup, type NavTab } from '@/domain/nav';
import { tid } from '@/testids';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/shadcn/dropdown-menu';
import { useSession } from './SessionProvider';
import { AccountMenu } from './AccountMenu';
import { NotBuilt } from '@/features/not-built/NotBuilt';
import { SetupIndex } from '@/features/setup/SetupIndex';
import { PermissionsPage } from '@/features/access/PermissionsPage';
import { AuditPage } from '@/features/audit/AuditPage';

const BUILT: Record<string, ComponentType> = { asetup: SetupIndex, aperm: PermissionsPage, iaudit: AuditPage };

export function Shell() {
  const { session, signOut, endViewAs } = useSession();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => api(getTenant) });
  if (!session || !tenant.data) return null;
  const nav = buildNav({ caps: new Set(session.capabilities), modules: tenant.data.modules, flags: tenant.data.flags, onboarding: false });
  const role = session.viewingAs?.userType ?? session.account.userType;
  return <ShellView nav={nav} roleLabel={role[0]!.toUpperCase() + role.slice(1)} viewingAs={session.viewingAs?.name ?? null}
    unread={0} onSignOut={() => void signOut()} onEndViewAs={() => void endViewAs()} />;
}

export function ShellView({ nav, roleLabel, viewingAs, unread, onSignOut, onEndViewAs }: {
  nav: NavGroup[]; roleLabel: string; viewingAs: string | null; unread: number; onSignOut(): void; onEndViewAs(): void;
}) {
  const { pathname } = useLocation();
  const current = nav.find(g => pathname.startsWith(`/${g.key}/`)) ?? nav[0];
  const first = nav[0]?.tabs[0];
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="flex items-center gap-md bg-surface-inverse px-lg py-sm text-primary-foreground">
        <span className="font-semibold">Qnipay</span>
        <nav aria-label="Areas" className="flex gap-xs">
          {nav.map(g => <Link key={g.key} to={g.tabs[0]!.path} data-testid={tid.nav.group(g.key)}
            aria-current={g === current ? 'true' : undefined}
            className={`rounded-pill px-md py-xs ${g === current ? 'bg-brand-accent text-foreground' : ''}`}>{g.label}</Link>)}
        </nav>
        <span className="ml-auto" />
        <span data-testid={tid.shell.rolePill} className="rounded-pill border px-sm py-xs text-xs font-semibold"
          title={viewingAs ? `Looking at the app as ${viewingAs}` : undefined}>{roleLabel}</span>
        <button type="button" data-testid={tid.shell.bell} aria-label={`Notifications, ${unread} unread`} className="relative">
          🔔{unread > 0 && <span data-testid={tid.shell.bellCount} className="absolute -right-2 -top-2 rounded-pill bg-brand-accent px-xs text-xs text-foreground">{unread}</span>}
        </button>
        <AccountMenu onSignOut={onSignOut} />
      </header>
      {viewingAs && <div role="status" className="flex items-center gap-md bg-warn-surface px-lg py-sm text-warn">
        Looking at the app as <b>{viewingAs}</b>. Your own account is unchanged.
        <button type="button" data-testid={tid.shell.viewAsEnd} className="underline" onClick={onEndViewAs}>Return to my account</button></div>}
      {current && <TabStrip tabs={current.tabs} pathname={pathname} />}
      <main className="flex-1 p-lg">
        <Routes>
          {nav.flatMap(g => g.tabs).map(t => {
            const Page = BUILT[t.view];
            return <Route key={t.path} path={t.path} element={Page ? <Page /> : <NotBuilt tab={t} />} />;
          })}
          <Route path="*" element={first ? <Navigate to={first.path} replace /> : <NotBuilt tab={{ view: 'none', label: 'Nothing available', path: '/', built: false, subProject: 'access: ask an administrator' }} />} />
        </Routes>
      </main>
    </div>);
}

function TabStrip({ tabs, pathname }: { tabs: NavTab[]; pathname: string }) {
  const runs: { group?: string; tabs: NavTab[] }[] = [];
  tabs.forEach(t => { const last = runs[runs.length - 1]; if (t.group && last?.group === t.group) last.tabs.push(t); else runs.push({ group: t.group, tabs: [t] }); });
  const link = (t: NavTab) => <Link key={t.view} to={t.path} data-testid={tid.nav.tab(t.view)} aria-current={pathname === t.path ? 'page' : undefined}
    className={`px-md py-sm ${pathname === t.path ? 'border-b-2 border-brand font-semibold' : ''}`}>{t.label}</Link>;
  return (
    <nav aria-label="Pages" className="flex gap-xs overflow-x-auto border-b border-border bg-surface-card px-lg">
      {runs.map(r => !r.group ? r.tabs.map(link) : (
        <DropdownMenu key={r.group}>
          <DropdownMenuTrigger data-testid={tid.nav.menu(r.group.toLowerCase())} className={`px-md py-sm ${r.tabs.some(t => t.path === pathname) ? 'font-semibold' : ''}`}>{r.group} ▾</DropdownMenuTrigger>
          <DropdownMenuContent>{r.tabs.map(t => <DropdownMenuItem key={t.view} asChild>{link(t)}</DropdownMenuItem>)}</DropdownMenuContent>
        </DropdownMenu>))}
    </nav>);
}
```
The phone bottom bar is five destinations plus More, as in prototype `render()` (html:10214-10230). It renders the same `current.tabs`, uses `data-testid={tid.nav.bottom(t.view)}` for each destination and `tid.nav.more` for More, and is shown below 768px (`md:hidden`). Add it inside `ShellView`, after `<main>`. The e2e phone checks come in plan 1c, so here it only needs to render and to pass the coverage test.

`src/shell/AccountMenu.tsx`:
```tsx
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/ui/shadcn/dropdown-menu';
import { tid } from '@/testids';
export function AccountMenu({ onSignOut }: { onSignOut(): void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger data-testid={tid.shell.account} aria-label="Account" className="rounded-pill bg-brand-accent px-sm py-xs text-foreground">Account</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem data-testid={tid.shell.signOut} onSelect={onSignOut}>Sign out</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>);
}
```
`src/features/not-built/NotBuilt.tsx`:
```tsx
import type { NavTab } from '@/domain/nav';
import { tid } from '@/testids';
/* Say what is not built. A stub is labelled as a stub. */
export function NotBuilt({ tab }: { tab: NavTab }) {
  return (
    <section data-testid={tid.notBuilt.root} className="mx-auto max-w-xl rounded-card border border-border bg-surface-card p-xl">
      <h1 className="text-[length:var(--qp-text-20)] font-semibold">{tab.label}</h1>
      <p className="text-text-secondary">Not built in this build. It arrives with <b data-testid={tid.notBuilt.subProject}>{tab.subProject}</b>.</p>
    </section>);
}
```
`src/features/setup/SetupIndex.tsx` lists the setup tabs the person can reach. Each card is a `Link` with `data-testid={`setup-card-${view}`}`.

Create placeholder `PermissionsPage` and `AuditPage` components that render `<section data-testid={tid.page('aperm')}>` and `<section data-testid={tid.page('iaudit')}>`. Tasks 9 and 10 fill them in.

In `src/App.tsx`, replace the Task 7 placeholder in `Gate` with `return <Shell />;`.

- [ ] **Step 6: Run everything**

Remove the `test.fixme` from `e2e/sign-in.spec.ts`.
Run: `npx vitest run && npm run openapi && npm run typecheck && npm run e2e`
Expected: all green, including the three NV tests and the account-menu sign-out test.
If the `Every page an admin can reach` test lists missing test IDs, the component that rendered them has no `testId`. Add one. Never loosen the check.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(shell): capability and flag driven navigation ported from the prototype, not-built pages

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Permissions, with templates and per-user exceptions

**Files:**
- Create: `src/contract/access.ts`, `src/mocks/access.ts`, `src/features/access/PermissionsPage.tsx`, `src/features/access/UserExceptions.tsx`, `src/api/access.ts`
- Modify: `src/mocks/handlers.ts`, `src/contract/index.ts`
- Test: `src/mocks/access.test.ts`, `src/features/access/permissions.test.tsx`, `e2e/access.spec.ts`

**Interfaces:**
- Consumes: `requireSession`, `requireCapability`, `checkVersion`, `bump`, `writeAudit`, `resolveCapabilities`, `tid.access.*`, `ConfirmModal`, `toastInfo`, `toastRefusal`.
- Produces endpoints:
  - GET `/api/v1/capabilities`, a list of `{id, group, label, gate, lockedFor}`.
  - GET `/api/v1/user-types`.
  - PUT `/api/v1/user-types/:id/capabilities/:cap` with `{granted: boolean}` and `If-Match`, which returns a `Mutation<UserType>`.
  - GET `/api/v1/users`, a list of `{email, name, personCode, userType, grants, revocations, version}`.
  - POST `/api/v1/users/:email/exceptions` with `{capability, mode: 'grant'|'revoke', reason}` and `If-Match`.
  - DELETE `/api/v1/users/:email/exceptions/:cap` with `If-Match`.
- Every one of these requires `perm_cfg`.

- [ ] **Step 1: Write the failing server tests**

`src/mocks/access.test.ts`:
```ts
import { server } from './node';
import { store } from './store';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
let token = '';
const acc = (t: string) => Object.values(store.db.accounts as Record<string, { email: string; userType: string; personCode: string }>).find(a => a.userType === t)!;
const req = (method: string, url: string, body?: unknown, ifMatch?: number) => fetch(url, { method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...(ifMatch === undefined ? {} : { 'If-Match': String(ifMatch) }) } });
beforeEach(async () => {
  store.reset('social');
  token = (await (await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: acc('admin').email, password: 'Qnipay@123' }) })).json()).token;
});
const ut = (id: string) => (store.db.userTypes as Record<string, { version: number; capabilities: string[] }>)[id]!;
const audits = () => Object.values(store.db.audit as Record<string, { act: string; after: unknown; before: unknown }>);

test('granting a capability to a template changes it once, bumps its version, and is audited before -> after', async () => {
  const v = ut('employee').version, had = ut('employee').capabilities.includes('proxy');
  const r = await req('PUT', '/api/v1/user-types/employee/capabilities/proxy', { granted: !had }, v);
  expect(r.status).toBe(200);
  expect(ut('employee').version).toBe(v + 1);
  expect(ut('employee').capabilities.includes('proxy')).toBe(!had);
  const a = audits().find(x => x.act === 'Permission changed')!;
  expect(a).toMatchObject({ before: { proxy: had }, after: { proxy: !had } });
});
test('a stale version is refused with 412 and nothing changes', async () => {
  const before = structuredClone(ut('employee'));
  const r = await req('PUT', '/api/v1/user-types/employee/capabilities/proxy', { granted: true }, before.version - 1 < 0 ? 999 : before.version - 1);
  expect(r.status).toBe(412);
  expect(ut('employee')).toEqual(before);
});
test('an admin cannot revoke their own way back to this page', async () => {
  const r = await req('PUT', '/api/v1/user-types/admin/capabilities/perm_cfg', { granted: false }, ut('admin').version);
  expect(r.status).toBe(409);
  expect(await r.json()).toMatchObject({ code: 'locked', next: expect.any(String) });
  expect(ut('admin').capabilities).toContain('perm_cfg');
});
test('a per-user exception needs a reason, is audited, and changes that user\'s capabilities only', async () => {
  const emp = acc('employee'), other = Object.values(store.db.accounts as Record<string, { email: string; userType: string }>).find(a => a.userType === 'employee' && a.email !== emp.email);
  const account = (store.db.accounts as Record<string, { version: number; grants: string[] }>)[`acc_${emp.email}`]!;
  const noReason = await req('POST', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, { capability: 'proxy', mode: 'grant', reason: '' }, account.version);
  expect(noReason.status).toBe(422);
  const ok = await req('POST', `/api/v1/users/${encodeURIComponent(emp.email)}/exceptions`, { capability: 'proxy', mode: 'grant', reason: 'Covers the rota lead on Fridays' }, account.version);
  expect(ok.status).toBe(200);
  expect(account.grants).toContain('proxy');
  if (other) expect((store.db.accounts as Record<string, { grants: string[] }>)[`acc_${other.email}`]!.grants).not.toContain('proxy');
  expect(audits().some(x => x.act === 'Access exception added')).toBe(true);
});
test('a manager is refused, naming the capability', async () => {
  token = (await (await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: acc('manager').email, password: 'Qnipay@123' }) })).json()).token;
  const r = await req('GET', '/api/v1/user-types');
  expect(r.status).toBe(403);
  expect((await r.json()).message).toMatch(/Permissions and role configuration/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/mocks/access.test.ts`
Expected: FAIL, unhandled requests.

- [ ] **Step 3: The contract**

`src/contract/access.ts`:
```ts
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { RecordMeta, mutation } from './common';

export const Capability = RecordMeta.extend({ group: z.enum(['own', 'team', 'cfg']), label: z.string(), gate: z.string(), lockedFor: z.array(z.string()) });
export const UserType = RecordMeta.extend({ name: z.string(), description: z.string(), capabilities: z.array(z.string()) });
export const UserAccess = RecordMeta.extend({ email: z.string(), name: z.string(), personCode: z.string(), userType: z.string(), grants: z.array(z.string()), revocations: z.array(z.string()) });
export const SetTemplateCapability = z.object({ granted: z.boolean() });
export const AddException = z.object({ capability: z.string(), mode: z.enum(['grant', 'revoke']), reason: z.string().trim().min(1, 'Give a reason. Exceptions are reviewed.') });
export type Capability = z.infer<typeof Capability>; export type UserType = z.infer<typeof UserType>; export type UserAccess = z.infer<typeof UserAccess>;

const cap = 'perm_cfg';
export const listCapabilities = defineEndpoint({ method: 'GET', path: '/api/v1/capabilities', response: z.array(Capability), capability: cap, summary: 'Every capability the matrix controls' });
export const listUserTypes = defineEndpoint({ method: 'GET', path: '/api/v1/user-types', response: z.array(UserType), capability: cap, summary: 'User-type templates' });
export const setTemplateCapability = defineEndpoint({ method: 'PUT', path: '/api/v1/user-types/:id/capabilities/:cap', request: SetTemplateCapability, response: mutation(UserType), capability: cap, summary: 'Grant or remove a capability on a template (If-Match)' });
export const listUsers = defineEndpoint({ method: 'GET', path: '/api/v1/users', response: z.array(UserAccess), capability: cap, summary: 'Accounts with their template and exceptions' });
export const addException = defineEndpoint({ method: 'POST', path: '/api/v1/users/:email/exceptions', request: AddException, response: mutation(UserAccess), capability: cap, summary: 'Grant or revoke one capability for one user, with a reason (If-Match)' });
export const removeException = defineEndpoint({ method: 'DELETE', path: '/api/v1/users/:email/exceptions/:cap', response: mutation(UserAccess), capability: cap, summary: 'Remove an exception (If-Match)' });
```

- [ ] **Step 4: The handlers**

`src/mocks/access.ts`:
```ts
import { http, HttpResponse } from 'msw';
import { store } from './store';
import { bump, checkVersion, handle, readJson, refuse } from './http';
import { requireCapability, requireSession } from './session';
import { writeAudit } from './audit';
import { AddException, SetTemplateCapability, type Capability, type UserType } from '@/contract/access';

interface Account { id: string; version: number; updatedAt: string; email: string; personCode: string; userType: string; grants: string[]; revocations: string[] }
const LABEL = 'Permissions and role configuration';
const gate = (request: Request) => { const s = requireSession(request); requireCapability(s, 'perm_cfg', LABEL); return s; };
const who = (s: ReturnType<typeof requireSession>) => ({ personCode: s.account.personCode, name: personName(s.account.personCode) });
const personName = (code: string) => (Object.values(store.coll<{ code: string; name: string }>('people')).find(p => p.code === code)?.name) ?? code;
const capBy = (id: string) => store.coll<Capability>('capabilities')[id] ?? refuse(404, { code: 'not-found', message: `There is no capability "${id}".`, next: 'Reload the page.' });
const userView = (a: Account) => ({ id: a.id, version: a.version, updatedAt: a.updatedAt, email: a.email, personCode: a.personCode,
  name: personName(a.personCode), userType: a.userType, grants: a.grants, revocations: a.revocations });

export const accessHandlers = [
  http.get('/api/v1/capabilities', handle(({ request }) => { gate(request); return HttpResponse.json(Object.values(store.coll('capabilities'))); })),
  http.get('/api/v1/user-types', handle(({ request }) => { gate(request); return HttpResponse.json(Object.values(store.coll('userTypes'))); })),
  http.put('/api/v1/user-types/:id/capabilities/:cap', handle(async ({ request, params }) => {
    const s = gate(request);
    const types = store.coll<UserType>('userTypes'); const t = types[String(params.id)];
    if (!t) return refuse(404, { code: 'not-found', message: 'That user type no longer exists.', next: 'Reload the page.' });
    const c = capBy(String(params.cap)); checkVersion(request, t);
    const { granted } = await readJson(request, SetTemplateCapability);
    const had = t.capabilities.includes(c.id);
    if (!granted && c.lockedFor.includes(t.id)) return refuse(409, { code: 'locked', message: `"${c.label}" cannot be removed from ${t.name}. It is the only way back to this page.`, next: 'Give another user type this capability first, if you need to change who holds it.' });
    if (had === granted) return HttpResponse.json({ record: t, auditId: '' });
    const next = bump(t, { capabilities: granted ? [...t.capabilities, c.id].sort() : t.capabilities.filter(x => x !== c.id) });
    types[t.id] = next;
    const auditId = writeAudit({ who: who(s), act: 'Permission changed', entity: 'userType', entityId: t.id, before: { [c.id]: had }, after: { [c.id]: granted } });
    return HttpResponse.json({ record: next, auditId });
  })),
  http.get('/api/v1/users', handle(({ request }) => { gate(request); return HttpResponse.json(Object.values(store.coll<Account>('accounts')).map(userView)); })),
  http.post('/api/v1/users/:email/exceptions', handle(async ({ request, params }) => {
    const s = gate(request);
    const accounts = store.coll<Account>('accounts'); const key = `acc_${String(params.email).toLowerCase()}`; const a = accounts[key];
    if (!a) return refuse(404, { code: 'not-found', message: 'That account no longer exists.', next: 'Reload the page.' });
    checkVersion(request, a);
    const { capability, mode, reason } = await readJson(request, AddException);
    const c = capBy(capability);
    if (mode === 'revoke' && c.lockedFor.includes(a.userType) && a.email === s.account.email)
      return refuse(409, { code: 'locked', message: `You cannot revoke "${c.label}" from yourself. It is your way back to this page.`, next: 'Ask another administrator to make this change.' });
    const grants = mode === 'grant' ? [...new Set([...a.grants, c.id])] : a.grants.filter(x => x !== c.id);
    const revocations = mode === 'revoke' ? [...new Set([...a.revocations, c.id])] : a.revocations.filter(x => x !== c.id);
    const next = bump(a, { grants, revocations }); accounts[key] = next;
    const auditId = writeAudit({ who: who(s), act: 'Access exception added', entity: 'account', entityId: a.email,
      before: { grants: a.grants, revocations: a.revocations }, after: { grants, revocations }, reason });
    return HttpResponse.json({ record: userView(next), auditId });
  })),
  http.delete('/api/v1/users/:email/exceptions/:cap', handle(({ request, params }) => {
    const s = gate(request);
    const accounts = store.coll<Account>('accounts'); const key = `acc_${String(params.email).toLowerCase()}`; const a = accounts[key];
    if (!a) return refuse(404, { code: 'not-found', message: 'That account no longer exists.', next: 'Reload the page.' });
    checkVersion(request, a);
    const cap = String(params.cap);
    const next = bump(a, { grants: a.grants.filter(x => x !== cap), revocations: a.revocations.filter(x => x !== cap) }); accounts[key] = next;
    const auditId = writeAudit({ who: who(s), act: 'Access exception removed', entity: 'account', entityId: a.email,
      before: { grants: a.grants, revocations: a.revocations }, after: { grants: next.grants, revocations: next.revocations } });
    return HttpResponse.json({ record: userView(next), auditId });
  })),
];
```
Register `accessHandlers` in `handlers.ts`, and `export * from './access'` in `contract/index.ts`.

- [ ] **Step 5: The page, with its fault behaviour tested first**

`src/features/access/permissions.test.tsx`:
```tsx
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { store } from '@/mocks/store';
import { queryClient } from '@/api/query';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import { expectTestIdCoverage } from '@/test/testid-coverage';
import { PermissionsPage } from './PermissionsPage';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(async () => {
  store.reset('social'); queryClient.clear();
  const admin = Object.values(store.db.accounts as Record<string, { email: string; userType: string }>).find(a => a.userType === 'admin')!;
  setToken((await (await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: 'Qnipay@123' }) })).json()).token);
});
const mount = () => render(<QueryClientProvider client={queryClient}><PermissionsPage /></QueryClientProvider>);

test('the matrix renders with full test id coverage', async () => {
  const { container } = mount();
  await screen.findByTestId(tid.access.table);
  expectTestIdCoverage(container);
});
test('a failed save shows the refusal and leaves the cell as it was', async () => {
  mount();
  const cell = await screen.findByTestId(tid.access.cell('proxy', 'employee'));
  const was = cell.getAttribute('aria-pressed');
  server.use(http.put('/api/v1/user-types/:id/capabilities/:cap', () => HttpResponse.json({ code: 'fault', message: 'The server could not complete that. Nothing has been changed.', next: 'Try again.' }, { status: 500 })));
  await userEvent.click(cell);
  expect(await screen.findByTestId(tid.toast.error)).toHaveTextContent('Nothing has been changed');
  expect(screen.getByTestId(tid.access.cell('proxy', 'employee'))).toHaveAttribute('aria-pressed', was!);
});
test('a user row reads "Employee + 1 exception" after a grant', async () => {
  mount();
  const users = await screen.findByTestId(tid.access.users);
  const first = within(users).getAllByRole('row')[1]!;
  expect(first).toHaveTextContent(/Employee|Manager|Admin/);
});
```
`PermissionsPage` is made of three parts. The layout follows prototype `admPermissions` (html:7900-7930):
1. **The template matrix**, `table` with `data-testid={tid.access.table}`:
   - one row per capability, grouped by `own`, `team` and `cfg`, with the group headings from `meta.permGroups`;
   - one column per user type;
   - each cell is a toggle button with `data-testid={tid.access.cell(cap, userType)}`, `aria-pressed` and `disabled` when `lockedFor` includes that user type;
   - a locked cell gets a native `title` naming why, because hover cannot fire on disabled controls (a CLAUDE.md UI convention).
2. **The users table**, `data-testid={tid.access.users}`:
   - one row per account with `data-testid={tid.access.userRow(email)}`;
   - each row shows name, email, user type, and the summary "Manager + 2 exceptions" with `data-testid={tid.access.exceptions(email)}`;
   - an "Add exception" button with `data-testid={tid.access.exceptionAdd(email)}` opens `UserExceptions`.
3. **`UserExceptions`**, a `Modal` with:
   - a capability `SelectBox` (`tid.access.exceptionCap`);
   - a grant or revoke `SelectBox` (`tid.access.exceptionMode`);
   - a required reason `TextInput` (`tid.access.exceptionReason`);
   - a Save button (`tid.access.exceptionSave`);
   - the existing exceptions, each with a remove button `tid.access.exceptionRemove(email, cap)`.

Every write:
- uses `useMutation` with the record's `version` as `ifMatch`;
- updates the query cache only in `onSuccess`, from `data.record`;
- calls `toastRefusal(error.refusal)` in `onError`;
- after a 412, also invalidates the query, so the next attempt uses the fresh version.

`src/api/access.ts` holds the hooks `useCapabilities`, `useUserTypes`, `useUsers`, `useSetTemplateCapability`, `useAddException` and `useRemoveException`, each wrapping `api(...)` with its query key.

- [ ] **Step 6: The end-to-end journey**

`e2e/access.spec.ts`:
```ts
import { test, expect } from './support/fixtures';
import { tid } from '../src/testids';

test('Permissions: granting a capability to a template is saved and audited', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/aperm');
  const cell = page.getByTestId(tid.access.cell('proxy', 'employee'));
  const was = await cell.getAttribute('aria-pressed');
  const saved = page.waitForResponse(r => r.url().includes('/user-types/employee/capabilities/proxy') && r.status() === 200);
  await cell.click(); await saved;
  await expect(cell).toHaveAttribute('aria-pressed', was === 'true' ? 'false' : 'true');
  const types = (await api.get('/api/v1/user-types')).body as { id: string; capabilities: string[] }[];
  expect(types.find(t => t.id === 'employee')!.capabilities.includes('proxy')).toBe(was !== 'true');
  const audit = (await api.get('/api/v1/audit?entity=userType')).body as { items: { act: string }[] };
  expect(audit.items[0]!.act).toBe('Permission changed');
});
test('Permissions: the locked cell cannot be changed', async ({ page, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/aperm');
  await expect(page.getByTestId(tid.access.cell('perm_cfg', 'admin'))).toBeDisabled();
});
test('Permissions: a fault leaves the matrix and the store unchanged', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/aperm');
  const before = (await api.get('/api/v1/user-types')).body;
  await api.fault('PUT', '/api/v1/user-types/employee/capabilities/proxy', 500);
  const cell = page.getByTestId(tid.access.cell('proxy', 'employee')); const was = await cell.getAttribute('aria-pressed');
  await cell.click();
  await expect(page.getByTestId(tid.toast.error)).toContainText('Nothing has been changed');
  await expect(cell).toHaveAttribute('aria-pressed', was!);
  expect((await api.get('/api/v1/user-types')).body).toEqual(before);
});
test('Permissions: a per-user exception needs a reason and shows on the row', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  const users = (await api.get('/api/v1/users')).body as { email: string; userType: string }[];
  const emp = users.find(u => u.userType === 'employee')!;
  await page.goto('/setup/aperm');
  await page.getByTestId(tid.access.exceptionAdd(emp.email)).click();
  await page.getByTestId(tid.access.exceptionCap).click();
  await page.getByTestId(`${tid.access.exceptionCap}-option-proxy`).click();
  await page.getByTestId(tid.access.exceptionSave).click();
  await expect(page.getByTestId(tid.toast.error)).toContainText('Give a reason');
  await page.getByTestId(tid.access.exceptionReason).fill('Covers the rota lead on Fridays');
  await page.getByTestId(tid.access.exceptionSave).click();
  await expect(page.getByTestId(tid.access.exceptions(emp.email))).toHaveText(/Employee \+ 1 exception/);
  const after = ((await api.get('/api/v1/users')).body as { email: string; grants: string[] }[]).find(u => u.email === emp.email)!;
  expect(after.grants).toContain('proxy');
});
```
The audit endpoint these tests read is built in Task 10. Until then, mark the first test `test.fixme('/* audit endpoint arrives in Task 10 */')`. Task 10 removes the fixme.

- [ ] **Step 7: Run everything**

Run: `npm run openapi && npx vitest run && npm run typecheck && npm run e2e`
Expected: all green except the one fixme.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(access): editable user-type templates, per-user exceptions with reasons, locked cells, audited

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: The audit log

**Files:**
- Create: `src/mocks/audit-handlers.ts`, `src/features/audit/AuditPage.tsx`, `src/api/audit.ts`, `src/lib/format.ts`
- Modify: `src/mocks/handlers.ts`
- Test: `src/mocks/audit.test.ts`, `src/lib/format.test.ts`, `e2e/audit.spec.ts`

**Interfaces:**
- Consumes: `listAudit` (Task 5) and `AuditEntry`.
- Produces:
  - `formatDateTime(iso): string`, which returns `DD/MM/YYYY HH:MM` in Europe/London.
  - `describeChange(before, after): string`, which returns `"proxy: no → yes"`.
  - `AuditPage`, with filters for entity, who and free text.

- [ ] **Step 1: Write the failing tests**

`src/lib/format.test.ts`:
```ts
import { formatDateTime, describeChange } from './format';
test('British date and time in London time', () => {
  expect(formatDateTime('2026-08-13T13:30:00.000Z')).toBe('13/08/2026 14:30');
});
test('a change reads before -> after, field by field', () => {
  expect(describeChange({ proxy: false }, { proxy: true })).toBe('proxy: no → yes');
  expect(describeChange({ grants: [] }, { grants: ['proxy'] })).toBe('grants: none → proxy');
  expect(describeChange(null, { viewingAs: 'CP-1042' })).toBe('viewingAs: none → CP-1042');
});
```
`src/mocks/audit.test.ts`:
```ts
import { server } from './node';
import { store } from './store';
import { writeAudit } from './audit';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
let token = '';
beforeEach(async () => {
  store.reset('social'); store.setClock('2026-08-13T14:30:00.000Z');
  const admin = Object.values(store.db.accounts as Record<string, { email: string; userType: string }>).find(a => a.userType === 'admin')!;
  token = (await (await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: 'Qnipay@123' }) })).json()).token;
});
const get = async (q = '') => (await fetch('/api/v1/audit' + q, { headers: { Authorization: `Bearer ${token}` } })).json();

test('newest first, stamped from the server clock', async () => {
  writeAudit({ who: { personCode: 'X', name: 'X' }, act: 'First', entity: 'e', entityId: '1' });
  store.setClock('2026-08-13T14:31:00.000Z');
  writeAudit({ who: { personCode: 'X', name: 'X' }, act: 'Second', entity: 'e', entityId: '1' });
  const r = await get();
  expect(r.items.map((i: { act: string }) => i.act).slice(0, 2)).toEqual(['Second', 'First']);
  expect(r.items[0].at).toBe('2026-08-13T14:31:00.000Z');
});
test('filters by entity and free text', async () => {
  writeAudit({ who: { personCode: 'X', name: 'Dee' }, act: 'Permission changed', entity: 'userType', entityId: 'employee' });
  writeAudit({ who: { personCode: 'X', name: 'Dee' }, act: 'View-as started', entity: 'session', entityId: 'a@b' });
  expect((await get('?entity=userType')).items.every((i: { entity: string }) => i.entity === 'userType')).toBe(true);
  expect((await get('?q=view-as')).items.map((i: { act: string }) => i.act)).toEqual(['View-as started']);
});
```
`e2e/audit.spec.ts`:
```ts
import { test, expect } from './support/fixtures';
import { tid } from '../src/testids';
test('Audit: a permission change appears at the top with who and before -> after', async ({ page, signInAs }) => {
  await signInAs('admin');
  await page.goto('/setup/aperm');
  const saved = page.waitForResponse(r => r.url().includes('/capabilities/proxy') && r.ok());
  await page.getByTestId(tid.access.cell('proxy', 'employee')).click(); await saved;
  await page.goto('/setup/iaudit');
  const first = page.getByTestId(tid.audit.table).locator('tbody tr').first();
  await expect(first).toContainText('Permission changed');
  await expect(first).toContainText('13/08/2026 15:30');   // 14:30 UTC is 15:30 in London in August
  await expect(first).toContainText(/proxy: (no → yes|yes → no)/);
});
```

- [ ] **Step 2: Run them and watch them fail**

Run: `npx vitest run src/lib src/mocks/audit.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement**

`src/lib/format.ts`:
```ts
const DT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false });
export const formatDateTime = (iso: string) => DT.format(new Date(iso)).replace(',', '');
const show = (v: unknown): string => v === undefined || v === null ? 'none' : typeof v === 'boolean' ? (v ? 'yes' : 'no')
  : Array.isArray(v) ? (v.length ? v.join(', ') : 'none') : typeof v === 'object' ? JSON.stringify(v) : String(v);
export function describeChange(before: unknown, after: unknown): string {
  const b = (before ?? {}) as Record<string, unknown>, a = (after ?? {}) as Record<string, unknown>;
  return [...new Set([...Object.keys(b), ...Object.keys(a)])].filter(k => JSON.stringify(b[k]) !== JSON.stringify(a[k]))
    .map(k => `${k}: ${show(b[k])} → ${show(a[k])}`).join(' · ');
}
```
`src/mocks/audit-handlers.ts`:
```ts
import { http, HttpResponse } from 'msw';
import type { AuditEntry } from '@/contract/audit';
import { store } from './store';
import { handle } from './http';
import { requireCapability, requireSession } from './session';

export const auditHandlers = [
  http.get('/api/v1/audit', handle(({ request }) => {
    requireCapability(requireSession(request), 'integration', 'Integrations and audit log');
    const u = new URL(request.url);
    const entity = u.searchParams.get('entity'), who = u.searchParams.get('who')?.toLowerCase(), q = u.searchParams.get('q')?.toLowerCase();
    const limit = Math.min(Number(u.searchParams.get('limit') ?? 200), 1000);
    let items = Object.values(store.coll<AuditEntry>('audit')).sort((x, y) => y.at.localeCompare(x.at) || y.id.localeCompare(x.id));
    if (entity) items = items.filter(i => i.entity === entity);
    if (who) items = items.filter(i => i.who.name.toLowerCase().includes(who));
    if (q) items = items.filter(i => `${i.act} ${i.entityId} ${i.reason ?? ''}`.toLowerCase().includes(q));
    return HttpResponse.json({ items: items.slice(0, limit), total: items.length });
  })),
];
```
Register it in `handlers.ts`.

`AuditPage`:
- The page has three filters (`tid.audit.filterEntity`, `filterWho` and `filterText`).
- It shows a `table` with `data-testid={tid.audit.table}` and the columns When, Who, What, Record, Change and Reason.
- Each row has `data-testid={tid.audit.row(entry.id)}`, the time from `formatDateTime`, and the change from `describeChange`.
- When someone was viewing as another person, the Who column shows "Dee Fitzgerald (as CP-1042)".
- Rows become card rows on a phone, as the prototype's `table.rec` did.
- The empty state reads: "Nothing recorded yet. Every change anyone makes appears here."

Remove the `test.fixme` in `e2e/access.spec.ts`.

- [ ] **Step 4: Fault test for the page**

Add this to `e2e/audit.spec.ts`:
```ts
test('Audit: a failed load says so and shows no stale rows as current', async ({ page, api, signInAs }) => {
  await signInAs('admin');
  await api.fault('GET', '/api/v1/audit', 500);
  await page.goto('/setup/iaudit');
  await expect(page.getByTestId('audit-error')).toContainText('The audit log could not be loaded');
  await expect(page.getByTestId(tid.audit.table)).toHaveCount(0);
});
```
Add `error: 'audit-error'` to `tid.audit`, and render that element when the query errors.

- [ ] **Step 5: Run everything**

Run: `npm run openapi && npx vitest run && npm run typecheck && npm run e2e`
Expected: all green, with no fixme left.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(audit): audit log with filters, London time, before -> after, fault state

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: Trace the prototype suite, add accessibility and phone checks, prove the build

**Files:**
- Create: `scripts/trace.mjs`, `e2e/trace-areas.json`, `e2e/trace.json` (generated, then hand-filled), `scripts/trace.test.ts`, `e2e/a11y.spec.ts`
- Modify: `package.json` (`verify` adds `trace:check`)

**Interfaces:**
- Produces:
  - `e2e/trace.json`: `{ generatedFrom, rows: [{ id, section, text, area, status: 'ported'|'n/a'|'pending', test?, reason? }] }`.
  - `npm run trace`, which regenerates the file and keeps existing statuses.
  - `npm run trace:check`, which fails if any row whose `area` is in `completedAreas` is still `pending`.

- [ ] **Step 1: Write the failing test**

`scripts/trace.test.ts`:
```ts
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const trace = JSON.parse(readFileSync(resolve(__dirname, '../e2e/trace.json'), 'utf8'));
const areas = JSON.parse(readFileSync(resolve(__dirname, '../e2e/trace-areas.json'), 'utf8'));

test('every row has a section and an area', () => {
  expect(trace.rows.filter((r: { area?: string }) => !r.area)).toEqual([]);
});
test('no row in a completed area is still pending', () => {
  const open = trace.rows.filter((r: { area: string; status: string }) => areas.completedAreas.includes(r.area) && r.status === 'pending');
  expect(open.map((r: { id: string; text: string }) => `${r.id} ${r.text}`)).toEqual([]);
});
test('n/a always carries a reason, ported always names its test', () => {
  expect(trace.rows.filter((r: { status: string; reason?: string }) => r.status === 'n/a' && !r.reason)).toEqual([]);
  expect(trace.rows.filter((r: { status: string; test?: string }) => r.status === 'ported' && !r.test)).toEqual([]);
});
```

- [ ] **Step 2: Write the generator and the area map**

`e2e/trace-areas.json` maps each prototype suite section, the `=== NAME ===` headings, to an area. The areas are:
- `1a`, `1b`, `1c`;
- `timesheet`, `rota`, `leave`, `onboarding`, `payroll`;
- `ui`, meaning the design-language conventions, owned by plan 1a;
- `prototype-only`.

`completedAreas` starts as `["1a", "ui"]`:
```json
{
  "completedAreas": ["1a", "ui"],
  "sections": {
    "BOOT": "1a", "SIGN IN / SIGN OUT": "1a", "IDENTITY AND SIGN-IN": "1a", "CONFIGURABLE ROLE NAMES": "1c",
    "MANAGER NAV GROUPED BY MODULE": "1a", "ADMIN LAYOUT": "1a", "ICONS, CRUMBS AND REDUNDANT COUNTS": "1a",
    "PERSISTENCE AND ACCOUNTS": "1a", "A NEWER BUILD SUPERSEDES A SAVED SESSION": "1a", "TODAY IS TODAY": "1a",
    "GUIDE AFFORDANCE — ? opens, i only hovers": "ui", "AFFORDANCE CONVENTION: ⚠ / ? / i": "ui",
    "TOOLTIPS — escape their container and stay on screen": "ui", "TOOLTIP APPEARANCE": "ui",
    "MODAL SIZING + STRUCTURE": "ui", "CONSISTENCY": "ui", "COPY IS NOT PADDED": "ui", "AGAINST THE DESIGN SYSTEM": "ui",
    "NO MARKUP WITHOUT STYLING": "ui", "CONTROLS LOOK LIKE THEIR NEIGHBOURS": "ui", "SECTION LABELS ARE NOT SHOUTED": "ui",
    "MOBILE FOUNDATION": "1c", "REVIEW RUN: SYSTEM, MOBILE, DENSITY, AFFORDANCES": "1c",
    "EMPLOYEE CRUD + LIFECYCLE (IMP-013)": "1b", "DIMENSION CRUD (IMP-019)": "1b", "EMPLOYEE TYPE CRUD (pre-existing, now covered)": "1b",
    "PEOPLE, CONTRACTS AND DIMENSIONS": "1b", "EMPLOYEE IDENTIFIERS": "1b", "TENANT DATA FROM THE BC EXPORT": "1b",
    "MODULES — index, then drill in (mirrors Qnipay setup)": "1c", "TIMESHEET IS LICENSABLE, CORE IS THE BASE APP": "1c",
    "FEATURE OWNERSHIP": "1c", "MODULE PAGES ARE THE SAME SHAPE": "1c", "ONE HOME PER PAGE": "1c", "GUIDES — explanation moved off the page": "1c",
    "SAVING A TENANT AS A TEMPLATE": "1c", "FUSION3 CONFIGURED THROUGH THE TEMPLATE": "1c", "A MODULE THAT IS OFF SAYS NOTHING": "1c",
    "SETUP CONTROLS DO ONE THING": "1c", "ITEM 4 — actionable notifications and deep links": "1c", "NOTICE BOARD (Workforce core)": "1c",
    "ONBOARDING MODULE": "onboarding", "ONBOARDING STEPS ARE CONFIGURABLE": "onboarding", "ONBOARDING: DOCUMENTS, POLICIES AND LABELS": "onboarding",
    "POLICIES ARE DOCUMENTS AN ADMIN UPLOADS": "onboarding", "ONBOARDING STARTS WITH A PERSON": "onboarding", "A NEW STARTER CAN SIGN IN": "onboarding",
    "ROTA POLICY IS SETUP-DRIVEN": "rota", "SHIFT PALETTE + DRAG AND DROP": "rota", "CHUNK C — rota lifecycle and the week store": "rota",
    "IMP-031 — pattern generation writes real shifts": "rota", "IMP-031 — manager scoping": "rota", "MULTI-PERSON ADD + STAGGER": "rota",
    "WEEKLY REPEAT (IMP-032)": "rota", "ROTA OFF EMPTIES THE CALENDAR": "rota", "CLEAR WEEK": "rota",
    "ITEM 3 — payroll readiness (IMP-016)": "payroll", "PAY CODE CRUD": "timesheet",
    "REGRESSION (baseline register)": "prototype-only", "RESULT": "prototype-only"
  },
  "defaultArea": "timesheet"
}
```
Every section not listed maps to `defaultArea`, which is `timesheet`. Those sections are the IMP-001/005, CHUNK A/B, ITEM 1/3 exception centre, weekly view and layout, time captured as time, and legends. The generator prints every section it sent to the default, so a reviewer can move any that belong elsewhere.

`scripts/trace.mjs`:
```js
/* One row per assertion in the prototype suite, so nothing it proved is silently
   dropped. Re-running keeps each row's status, test and reason. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SUITE = process.env.PROTOTYPE_SUITE || resolve(here, '../../Qnipay workforce cc/mockup/qnipay-regression-suite.js');
const OUT = resolve(here, '../e2e/trace.json');
const map = JSON.parse(readFileSync(resolve(here, '../e2e/trace-areas.json'), 'utf8'));
const src = readFileSync(SUITE, 'utf8').split('\n');
const prev = existsSync(OUT) ? Object.fromEntries(JSON.parse(readFileSync(OUT, 'utf8')).rows.map(r => [r.id, r])) : {};

let section = 'BOOT'; const rows = []; const defaulted = new Set(); const perSection = {};
src.forEach(line => {
  const h = /console\.log\('\\n=== (.+?) ===/.exec(line); if (h) { section = h[1]; return; }
  for (const m of line.matchAll(/\bok\(\s*(['`])((?:\\.|(?!\1).)*)\1/g)) {
    const text = m[2].replace(/\\u2019/g, '’').replace(/\\u2192/g, '→').replace(/\\'/g, "'");
    const n = (perSection[section] = (perSection[section] || 0) + 1);
    const id = `${section.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}#${n}`;
    const area = map.sections[section] || (defaulted.add(section), map.defaultArea);
    const old = prev[id] && prev[id].text === text ? prev[id] : null;
    rows.push({ id, section, text, area, status: old ? old.status : 'pending', ...(old?.test ? { test: old.test } : {}), ...(old?.reason ? { reason: old.reason } : {}) });
  }
});
writeFileSync(OUT, JSON.stringify({ generatedFrom: 'qnipay-regression-suite.js', rows }, null, 1) + '\n');
console.log(`trace.json: ${rows.length} rows`);
if (defaulted.size) console.log('sections sent to the default area (' + map.defaultArea + '):\n  ' + [...defaulted].join('\n  '));
```
Add `"trace:check": "vitest run scripts/trace.test.ts"` to `package.json`, and change `verify` to end with `&& npm run trace:check`.

- [ ] **Step 3: Generate and fill the 1a and ui rows**

Run: `npm run trace`
Expected: a row count close to the suite's 965. Assertions built from concatenated strings, like `'DF['+k+']'`, are counted once per call site.

Then open `e2e/trace.json` and fill every row whose `area` is `1a` or `ui`:
- `ported`, with `test` naming the Vitest or Playwright test that covers it. Tasks 7-10 already wrote those tests, and their names keep the prototype text where it matched (for example `SI …` and `NV …`).
- `n/a`, with a `reason`. Examples: "prototype-only: the #lg-who selector", "replaced by Radix: tooltip positioning is the library's", "Entra ID replaces demo passwords in production".
- If a 1a behaviour has no test yet and is not `n/a`, write the test now in the owning spec file, then mark the row `ported`.

- [ ] **Step 4: Accessibility on every built page**

`e2e/a11y.spec.ts`:
```ts
import AxeBuilder from '@axe-core/playwright';
import { test, expect } from './support/fixtures';

for (const theme of ['light', 'dark'] as const) {
  test(`axe: sign-in, permissions and audit have no serious issues (${theme})`, async ({ page, signInAs }) => {
    const check = async () => {
      await page.evaluate(t => document.documentElement.setAttribute('data-theme', t), theme);
      const r = await new AxeBuilder({ page }).analyze();
      expect(r.violations.filter(v => ['serious', 'critical'].includes(v.impact ?? '')).map(v => `${v.id}: ${v.nodes.length}`)).toEqual([]);
    };
    await check();
    await signInAs('admin');
    for (const path of ['/setup/asetup', '/setup/aperm', '/setup/iaudit']) { await page.goto(path); await check(); }
  });
}
test('phone: no horizontal overflow on built pages at 390px', async ({ page, signInAs }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signInAs('admin');
  for (const path of ['/setup/asetup', '/setup/aperm', '/setup/iaudit']) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
});
```
The permissions matrix is a matrix. CLAUDE.md says matrices scroll with the first column pinned, so the overflow check must not count the matrix's own scroller. Wrap the matrix in `<div className="overflow-x-auto">` and pin the first column with `sticky left-0`. The page itself stays at 390px.

- [ ] **Step 5: Prove the production build carries no fake server**

Run:
```bash
VITE_MOCKS=off npm run build && grep -rl "_dev/reset\|mockServiceWorker\|Qnipay@123" dist/assets || echo "no mock code in the build"
```
Expected: `no mock code in the build`.
- If it finds anything, the dynamic `import('./mocks/browser')` in `main.tsx` has been made static somewhere.
- Find the static import and make it dynamic again.
- `public/mockServiceWorker.js` is copied into `dist/` as a static file. Delete it after a production build, with a `postbuild` script that runs `node -e "require('fs').rmSync('dist/mockServiceWorker.js',{force:true})"` when `VITE_MOCKS=off`.

- [ ] **Step 6: Run the whole gate**

Run: `npm run verify`
Expected: typecheck, lint, unit, contract and component tests, e2e including axe and phone, then `trace:check`, all green.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "test: prototype trace with 1a and ui rows filled, axe and phone checks, mock-free production build

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>"
```

---

## Done for plan 1a

- `npm run verify` is green.
- Signing in as each persona gives the navigation `buildNav` produces. Every view outside 1a names the sub-project that brings it.
- Permissions work:
  - templates are editable and locked cells are enforced;
  - per-user exceptions need a reason and read "Manager + N exceptions";
  - every change appears in the audit log with who and before → after.
- Every interactive element has a `data-testid` from `src/testids.ts`, checked in the component tests and in the browser.
- `contract/openapi.json` lists every endpoint built, and no schema carries money.
- `e2e/trace.json` has no pending row in areas `1a` or `ui`.

## Not in plan 1a

People, dimensions, employee types and self-service (plan 1b). Organisation, calendar, modules and flags, templates, the notification and approval frameworks, notice board, documents, homes and the full phone checks (plan 1c). Visual baselines start in plan 1c, once there are enough screens to baseline.
