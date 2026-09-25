import { QueryClient } from '@tanstack/react-query';
export const queryClient = new QueryClient({ defaultOptions: {
  /* A fault test sets a fault for exactly N requests (spec §10.2): a silent
     retry on a 5xx would swallow it, so the UI never sees the failure it is
     supposed to report and the test becomes unreliable. */
  queries: { retry: false, staleTime: 5_000 },
  /* no optimistic updates anywhere: the UI changes only when the server has answered */
  mutations: { retry: false } } });
