/* Vite copies public/ into dist/, which includes MSW's worker script. A
   build without the fake server must not ship it. `npm run build` is a
   production build, so this reads the same rule vite.config.ts used. */
import { rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fakeServerOn } from './fake-server-flag.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (!fakeServerOn('production', root)) {
  rmSync(resolve(root, 'dist/mockServiceWorker.js'), { force: true });
  console.log('postbuild: no fake server in this build, so dist/mockServiceWorker.js was removed');
} else {
  console.log('postbuild: VITE_MOCKS=on, so the fake server and its worker stay in dist/');
}
