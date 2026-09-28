import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    // The default 'forks' pool timed out waiting for a worker to respond when
    // spawning subprocesses in this sandbox; 'threads' runs reliably.
    pool: 'threads',
    // A workaround for CPU contention, not a fix for any one test: one worker
    // per test file on every logical core starved individual component tests
    // with several userEvent interactions until they hit the 5000ms timeout,
    // but only under the full parallel run. Half the cores (6 on a 12-core
    // machine) is relative, so it scales to other machines, and was measured
    // green across three consecutive full runs (final-fix-report.md, M14).
    maxWorkers: '50%',
    // The fake server's tests call `fetch('/api/...')` with a relative URL;
    // jsdom needs a base URL to resolve that against.
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
  },
}));
