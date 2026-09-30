import { defineConfig, devices } from '@playwright/test';
/* E2E_PORT moves the dev server off 5173, so a second checkout (a git
   worktree) can run its suite without reusing another checkout's server. */
const port = Number(process.env.E2E_PORT ?? 5173);
const baseURL = `http://localhost:${port}`;
export default defineConfig({
  testDir: 'e2e', fullyParallel: false, workers: 1, retries: 0, reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL, testIdAttribute: 'data-testid', trace: 'retain-on-failure', locale: 'en-GB', timezoneId: 'Europe/London' },
  /* Visual baselines (e2e/visual.spec.ts): font smoothing and sub-pixel text
     differ a little between runs, never by a layout's worth. */
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled', caret: 'hide' } },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: { command: `npm run dev -- --port ${port}`, url: baseURL, reuseExistingServer: !process.env.CI },
});
