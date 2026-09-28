import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    environment: 'jsdom', globals: true, setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    // The default 'forks' pool times out waiting for a worker to respond on
    // this machine (OneDrive-synced working directory, sandboxed subprocess
    // spawning). 'threads' runs reliably here; see task-1-report.md.
    pool: 'threads',
    // One worker per test file (24 files) on this machine's 12 logical cores
    // starved individual tests under contention (task-11 fix round 1: a
    // component test with several userEvent interactions timed out at the
    // default 5000ms only under the full parallel run, never standalone).
    // Measured (task-11-report.md, "Fix round 2"): 12 workers (= core count)
    // fails to even spawn reliably; 10 still reproduces the timeout; 8 is
    // green across repeated runs with headroom to spare. Do not raise this
    // back toward the core count without re-measuring.
    maxWorkers: 8,
    // The fake server's tests call `fetch('/api/...')` with a relative URL;
    // jsdom needs a base URL to resolve that against.
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
  },
}));
