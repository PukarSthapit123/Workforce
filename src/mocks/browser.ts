import { http } from 'msw';
import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { store } from './store';

/* Each tab runs its own copy of the fake server. Before any handler reads the
   database, this reloads it if another tab has saved since, so a stale write
   from a second tab meets the first tab's version and is refused with 412
   instead of overwriting it. It answers nothing itself. */
const syncFromOtherTabs = http.all('/api/*', () => { store.sync(); return undefined; });

export async function startFakeServer() {
  store.boot();
  /* every write persists; a handler never has to remember to */
  const worker = setupWorker(syncFromOtherTabs, ...handlers);
  worker.events.on('response:mocked', ({ request }) => { if (request.method !== 'GET') store.save(); });
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
}
