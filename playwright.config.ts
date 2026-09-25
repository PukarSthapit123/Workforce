import { defineConfig, devices } from '@playwright/test';
export default defineConfig({
  testDir: 'e2e', fullyParallel: false, workers: 1, retries: 0, reporter: [['list'], ['html', { open: 'never' }]],
  use: { baseURL: 'http://localhost:5173', testIdAttribute: 'data-testid', trace: 'retain-on-failure', locale: 'en-GB', timezoneId: 'Europe/London' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 1000 } } }],
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: !process.env.CI },
});
