import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath, URL } from 'node:url';
import { fakeServerOn } from './scripts/fake-server-flag.mjs';

/* Replaces __FAKE_SERVER_ON__ with a literal true or false for the mode being
   built, so src/lib/fake-server.ts exports a constant the bundler inlines at
   each use and, when it is false, drops the fake server, its seed and the
   demo sign-in from the bundle. */
const fakeServerFlag = (): Plugin => ({
  name: 'qnipay-fake-server-flag',
  config: (config, { mode }) => ({ define: { __FAKE_SERVER_ON__: JSON.stringify(fakeServerOn(mode, config.root ?? process.cwd())) } }),
});

export default defineConfig({
  plugins: [react(), tailwindcss(), fakeServerFlag()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: { port: 5173, strictPort: true },
});
