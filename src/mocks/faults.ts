import { http, HttpResponse, delay } from 'msw';

interface Fault { method: string; path: string; status?: number; latencyMs?: number; times: number }
export const faults: Fault[] = [];

const FAULT_BODY = { code: 'fault', message: 'The server could not complete that. Nothing has been changed.', next: 'Try again. If it keeps failing, report it.' };

/* Both sides are compared decoded, so a fault set on /api/v1/users/a@b.org
   matches the request the client actually sends, /api/v1/users/a%40b.org,
   and the other way round. A path that will not decode is compared as it is. */
const decoded = (path: string) => { try { return decodeURIComponent(path); } catch { return path; } };

/* Finds and consumes a matching, still-live fault, applying its latency. */
async function takeFault(method: string, pathname: string): Promise<Response | undefined> {
  const path = decoded(pathname);
  const f = faults.find(x => x.method === method && decoded(x.path) === path && x.times > 0);
  if (!f) return undefined;
  f.times--;
  if (f.latencyMs) await delay(f.latencyMs);
  if (!f.status) return undefined;
  return HttpResponse.json(FAULT_BODY, { status: f.status });
}

/* node.ts reinstalls this handler ahead of anything a test registers afterwards
   with server.use() (MSW otherwise lets that win), which can leave more than
   one copy of this handler reachable for a single request. A request must
   still only ever consume a fault once, so a request already seen is a no-op
   the second time. */
const checkedRequests = new Set<string>();
function firstTimeSeeing(requestId: string): boolean {
  if (checkedRequests.has(requestId)) return false;
  checkedRequests.add(requestId);
  if (checkedRequests.size > 2000) checkedRequests.clear(); // a long dev session should not grow this forever
  return true;
}

/* First in the handler list. A matching fault answers or delays; otherwise it
   returns nothing and MSW moves on to the real handler. Matches only a
   same-origin /api/v1/ path: a bare path pattern like '/api/v1/*' would
   otherwise match any host whose path happens to coincide. */
export const faultsHandler = http.all('/api/v1/*', ({ request, requestId }) => {
  if (!firstTimeSeeing(requestId)) return undefined;
  const url = new URL(request.url);
  if (typeof location !== 'undefined' && url.origin !== location.origin) return undefined;
  return takeFault(request.method, url.pathname);
});
