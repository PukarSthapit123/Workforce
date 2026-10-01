import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { toast } from 'sonner';
import { server } from '@/mocks/node';
import { faults } from '@/mocks/faults';
import { store } from '@/mocks/store';
import { queryClient } from '@/api/query';
import { setToken } from '@/api/session-token';

/* src/ test files share workers (isolate: false in vitest.config.ts), so a
   module loaded by one file is the same instance in the next. This file runs
   again before every test file, so each starts from what a fresh worker gave
   it: no handlers a previous file added with server.use(), no armed faults,
   no stored session or data, the social seed on the wall clock, an empty
   query cache. Inside a file, state carries from test to test exactly as it
   did when every file had a worker of its own. */
server.resetHandlers();
faults.length = 0;
try { localStorage.clear(); sessionStorage.clear(); } catch { /* no storage: nothing to clear */ }
setToken(null);
store.setClock(null);
store.reset('social');
queryClient.clear();

/* Testing Library registers its own afterEach cleanup when it is first
   imported, which in a shared worker is once, for the first file only. */
afterEach(() => { cleanup(); });
/* sonner keeps its queue outside React and replays every toast still active to
   a Toaster that mounts. A toast raised after the last test's afterEach (a
   request still settling) would otherwise surface in the next test, or the
   next file sharing this worker. */
beforeEach(() => { toast.dismiss(); });

/* jsdom has no pointer-capture or scrollIntoView implementation. Radix's Select
   (and other Radix pieces built on the same primitive) call these when opening,
   so without a shim every test that opens one throws outside jsdom's support. */
/* A file that opts into the node environment has no Element at all. */
if (typeof Element !== 'undefined') {
  if (!Element.prototype.hasPointerCapture) Element.prototype.hasPointerCapture = () => false;
  if (!Element.prototype.setPointerCapture) Element.prototype.setPointerCapture = () => {};
  if (!Element.prototype.releasePointerCapture) Element.prototype.releasePointerCapture = () => {};
  if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};
  /* Radix Tooltip and Popper measure their content with ResizeObserver, which jsdom lacks. */
  if (!('ResizeObserver' in globalThis)) {
    globalThis.ResizeObserver = class { observe() {} unobserve() {} disconnect() {} };
  }
}
