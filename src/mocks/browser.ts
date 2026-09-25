import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { store } from './store';
import { guardFaults } from './faults';

export async function startFakeServer() {
  store.boot();
  /* every write persists; a handler never has to remember to */
  const worker = setupWorker(...handlers);
  worker.events.on('response:mocked', ({ request }) => { if (request.method !== 'GET') store.save(); });
  await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
  /* see faults.ts: keeps a fault ahead of anything registered afterwards with worker.use() */
  globalThis.fetch = guardFaults(globalThis.fetch);
}
