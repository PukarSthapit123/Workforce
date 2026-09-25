import { setupServer } from 'msw/node';
import { handlers } from './handlers';
import { store } from './store';
import { faultsHandler } from './faults';

store.reset('social');
const raw = setupServer(...handlers);

/* MSW gives a handler added later with server.use() priority over the handlers
   passed to setupServer, even over one already first in that list — so a test
   that registers its own handler after this module loads would otherwise let
   it dodge a fault meant to pre-empt it. Reinstalling faultsHandler ahead of
   whatever a test adds keeps it first; faultsHandler's own per-request dedupe
   (see faults.ts) is what keeps that safe if this ends up reinstalling it more
   than once for the same request. */
export const server = {
  ...raw,
  use: (...h: Parameters<typeof raw.use>) => raw.use(faultsHandler, ...h),
};
