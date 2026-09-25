import { setupServer } from 'msw/node';
import { handlers } from './handlers';
import { store } from './store';
import { guardFaults } from './faults';

store.reset('social');
const raw = setupServer(...handlers);

/* Wraps listen/close so the fault guard (see faults.ts) is installed once MSW
   has patched fetch, and removed again on close so a later test file starts clean. */
let restoreFetch: (() => void) | null = null;
export const server = {
  ...raw,
  listen(options?: Parameters<typeof raw.listen>[0]) {
    raw.listen(options);
    const original = globalThis.fetch;
    globalThis.fetch = guardFaults(original);
    restoreFetch = () => { globalThis.fetch = original; };
  },
  close() {
    restoreFetch?.();
    restoreFetch = null;
    raw.close();
  },
};
