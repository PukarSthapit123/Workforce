import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClientProvider, useMutation } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from './client';
import { queryClient } from './query';
import { sessionEvents } from './session-events';

const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;

const SIGNED_OUT = { code: 'signed-out', message: 'You are signed out.', next: 'Sign in again to continue.' };
const SERVER_ERROR = { code: 'server-defect', message: 'Something went wrong.', next: 'Try again.' };

/* Both caches share the queryClient built in src/api/query.ts, so these run
   against the same wiring the app uses, not a copy of it. */
test('a 401 from a query signs out, carrying the refusal the server sent', async () => {
  const signedOut = vi.fn();
  const off = sessionEvents.on('signed-out', signedOut);
  await queryClient.fetchQuery({ queryKey: ['query-test-401'], queryFn: () => { throw new ApiError(401, SIGNED_OUT); } })
    .catch(() => { /* the rejection itself is not the point here */ });
  expect(signedOut).toHaveBeenCalledTimes(1);
  expect(signedOut).toHaveBeenCalledWith(SIGNED_OUT);
  off();
  queryClient.removeQueries({ queryKey: ['query-test-401'] });
});

test('a 5xx from a query keeps the token: no sign-out is raised', async () => {
  const signedOut = vi.fn();
  const off = sessionEvents.on('signed-out', signedOut);
  await queryClient.fetchQuery({ queryKey: ['query-test-500'], queryFn: () => { throw new ApiError(500, SERVER_ERROR); } })
    .catch(() => { /* expected */ });
  expect(signedOut).not.toHaveBeenCalled();
  off();
  queryClient.removeQueries({ queryKey: ['query-test-500'] });
});

test('a 401 from a mutation also signs out', async () => {
  const signedOut = vi.fn();
  const off = sessionEvents.on('signed-out', signedOut);
  const hook = renderHook(() => useMutation({ mutationFn: () => Promise.reject(new ApiError(401, SIGNED_OUT)) }), { wrapper });
  act(() => { hook.result.current.mutate(); });
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(signedOut).toHaveBeenCalledTimes(1);
  expect(signedOut).toHaveBeenCalledWith(SIGNED_OUT);
  off();
});

test('a 5xx from a mutation keeps the token: no sign-out is raised', async () => {
  const signedOut = vi.fn();
  const off = sessionEvents.on('signed-out', signedOut);
  const hook = renderHook(() => useMutation({ mutationFn: () => Promise.reject(new ApiError(500, SERVER_ERROR)) }), { wrapper });
  act(() => { hook.result.current.mutate(); });
  await waitFor(() => expect(hook.result.current.isError).toBe(true));
  expect(signedOut).not.toHaveBeenCalled();
  off();
});

test('a network failure (status 0) keeps the token: no sign-out is raised', async () => {
  const signedOut = vi.fn();
  const off = sessionEvents.on('signed-out', signedOut);
  await queryClient.fetchQuery({ queryKey: ['query-test-network'], queryFn: () => { throw new ApiError(0, { code: 'network', message: 'The server could not be reached.', next: 'Check your connection and try again.' }); } })
    .catch(() => { /* expected */ });
  expect(signedOut).not.toHaveBeenCalled();
  off();
  queryClient.removeQueries({ queryKey: ['query-test-network'] });
});
