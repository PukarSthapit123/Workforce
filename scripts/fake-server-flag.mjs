/* The build-time rule for src/lib/fake-server.ts, shared by vite.config.ts
   and scripts/postbuild.mjs so the two can never disagree. The fake server
   is in every non-production mode (vite dev, so every e2e run, and vitest),
   and in a production build only when VITE_MOCKS is 'on' (npm run
   build:demo), read the way Vite reads it: the environment, then .env files. */
import { loadEnv } from 'vite';

export const fakeServerOn = (mode, root = process.cwd()) =>
  mode !== 'production' || loadEnv(mode, root, 'VITE_').VITE_MOCKS === 'on';
