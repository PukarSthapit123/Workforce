import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './client';
export const queryClient = new QueryClient({ defaultOptions: {
  queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 1, staleTime: 5_000 },
  /* no optimistic updates anywhere: the UI changes only when the server has answered */
  mutations: { retry: false } } });
