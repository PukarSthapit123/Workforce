import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';
import { sessionEvents } from './session-events';

/* A 401 from any query or mutation in the middle of a session means the
   token no longer works (the account was removed, revoked, or its session
   ended elsewhere): sign out, wherever in the app the request came from,
   carrying the refusal the server sent so the toast says why. A 5xx or a
   network failure (ApiError status 0) says nothing about the session, so
   the token stays.
   This does not see the two boot-time reads in SessionProvider (the initial
   GET /session and the 'refresh' re-read after a write): those call `api`
   directly, outside react-query, and already sign out on their own 401. */
function onSessionError(error: unknown) {
  if (error instanceof ApiError && error.status === 401) sessionEvents.emit('signed-out', error.refusal);
}

export const queryClient = new QueryClient({
  queryCache: new QueryCache({ onError: onSessionError }),
  mutationCache: new MutationCache({ onError: onSessionError }),
  defaultOptions: {
    /* A fault test sets a fault for exactly N requests (spec §10.2): a silent
       retry on a 5xx would swallow it, so the UI never sees the failure it is
       supposed to report and the test becomes unreliable. */
    queries: { retry: false, staleTime: 5_000 },
    /* no optimistic updates anywhere: the UI changes only when the server has answered */
    mutations: { retry: false },
  },
});
