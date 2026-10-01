import { defineConfig, mergeConfig } from 'vitest/config';
import viteConfig from './vite.config';

/* Start-up, not the tests, was what made `npm test` time out at random. With
   isolation on, every file got a fresh worker that loaded jsdom, React, the
   seed and the contracts again (~9–12 s each under a full run, "environment"
   over half the run), so whichever test came first in a slow worker, often the
   first ESLint lint in scripts/lint-rules.test.ts, ran out of time (2 s alone,
   over 50 s in the full run). So:
   - src/ tests reuse workers across files (isolate: false). src/test/setup.ts
     runs before every file and puts back what a fresh worker gave it (fake
     server handlers and faults, storage, session, seed, clock, query cache,
     DOM, toasts), so a file sees what it saw with a worker of its own;
   - the one test that reads serve()'s registry, which serve.test.ts adds its
     own endpoints to, keeps a fresh worker;
   - scripts/ tests run in node with no jsdom and no setup file (they read
     files and lint text), and as a second group once src/ is done: ESLint
     loads typescript-eslint and its plugins outside Vitest's module cache,
     and that load is what starved while six jsdom workers were busy. */
const REGISTRY = 'src/mocks/served-registry.test.ts';

export default mergeConfig(viteConfig, defineConfig({
  test: {
    globals: true,
    // The default 'forks' pool timed out waiting for a worker to respond when
    // spawning subprocesses in this sandbox; 'threads' runs reliably.
    pool: 'threads',
    // Half the logical cores, so a full run leaves the machine room to breathe
    // (and scales to other machines).
    maxWorkers: '50%',
    projects: [
      { extends: true, test: { name: 'scripts', environment: 'node', include: ['scripts/**/*.test.ts'], sequence: { groupOrder: 1 } } },
      { extends: true, test: {
        name: 'app', environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], isolate: false,
        include: ['src/**/*.test.{ts,tsx}'], exclude: [REGISTRY],
        // The fake server's tests call `fetch('/api/...')` with a relative URL;
        // jsdom needs a base URL to resolve that against.
        environmentOptions: { jsdom: { url: 'http://localhost/' } },
      } },
      { extends: true, test: {
        name: 'registry', environment: 'jsdom', setupFiles: ['./src/test/setup.ts'], include: [REGISTRY],
        environmentOptions: { jsdom: { url: 'http://localhost/' } },
      } },
    ],
  },
}));
