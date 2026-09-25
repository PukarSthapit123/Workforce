import { http, HttpResponse, delay } from 'msw';

interface Fault { method: string; path: string; status?: number; latencyMs?: number; times: number }
export const faults: Fault[] = [];

const FAULT_BODY = { code: 'fault', message: 'The server could not complete that. Nothing has been changed.', next: 'Try again. If it keeps failing, report it.' };

/* Finds and consumes a matching, still-live fault, applying its latency. Shared
   by the MSW handler below and the fetch guard installed alongside the server/
   worker (see guardFaults). */
async function takeFault(method: string, pathname: string): Promise<Response | undefined> {
  const f = faults.find(x => x.method === method && x.path === pathname && x.times > 0);
  if (!f) return undefined;
  f.times--;
  if (f.latencyMs) await delay(f.latencyMs);
  if (!f.status) return undefined;
  return HttpResponse.json(FAULT_BODY, { status: f.status });
}

/* First in the handler list. A matching fault answers or delays; otherwise it
   returns nothing and MSW moves on to the real handler. */
export const faultsHandler = http.all('/api/v1/*', ({ request }) => takeFault(request.method, new URL(request.url).pathname));

/* MSW gives a handler added at runtime with server.use()/worker.use() priority
   over the handlers passed to setupServer/setupWorker, even over one already
   first in that list. That is fine for the app's own endpoints (registered
   once, never overridden), but it would let a handler a test adds afterwards
   dodge a fault meant to pre-empt it. This wraps the ambient fetch, installed
   right after listen()/start() so it sits outside MSW and sees every request
   first; a fault it consumes never reaches MSW at all. */
export function guardFaults(inner: typeof fetch): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const href = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const base = typeof location === 'undefined' ? 'http://localhost/' : location.href;
    const url = new URL(href, base);
    if (url.pathname.startsWith('/api/v1/')) {
      const faulted = await takeFault(method, url.pathname);
      if (faulted) return faulted;
    }
    return inner(input, init);
  }) as typeof fetch;
}
