/* npm run build:demo: a build that carries the fake server, for a demo
   deploy with no real API behind it. Sets VITE_MOCKS=on without a shell
   specific `VAR=x cmd`, so it runs the same on Windows and elsewhere. */
import { spawnSync } from 'node:child_process';

const r = spawnSync('npm run build', { stdio: 'inherit', shell: true, env: { ...process.env, VITE_MOCKS: 'on' } });
process.exit(r.status ?? 1);
