/* The one switch for the fake server (MSW) and everything that only makes
   sense beside it, such as the demo account list on the sign-in screen. On in
   development (vite dev, and so every e2e run) and in tests, and in a
   production build only when made with VITE_MOCKS=on (npm run build:demo).
   vite.config.ts replaces __FAKE_SERVER_ON__ with a literal, so in a plain
   `npm run build` this is `false`, the bundler inlines it at each use, and
   the fake server, its seed and the demo password are dropped entirely.
   npm run build:check proves it. */
export const FAKE_SERVER_ON: boolean = __FAKE_SERVER_ON__;
