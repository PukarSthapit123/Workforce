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
    // The fake server's tests call `fetch('/api/...')` with a relative URL;
    // jsdom needs a base URL to resolve that against.
    environmentOptions: { jsdom: { url: 'http://localhost/' } },
  },
}));
