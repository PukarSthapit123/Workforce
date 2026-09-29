import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { ApiError } from './client';
import { useRecordMutation } from './mutation';
import { sessionEvents } from './session-events';

function setup<TVars>(mutationFn: (v: TVars) => Promise<unknown>, extra: { refreshesSession?: boolean } = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const invalidated: unknown[] = [];
  const spy = vi.spyOn(qc, 'invalidateQueries').mockImplementation(async f => { invalidated.push(f?.queryKey); });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => useRecordMutation({ mutationFn, recordKey: (v: TVars) => String(v), invalidates: [['things']], ...extra }), { wrapper });
  return { hook, invalidated, spy };
}

test('a success re-reads the caller\'s queries and the audit log, and asks for the session when told to', async () => {
  const refreshed = vi.fn();
  const off = sessionEvents.on('refresh', refreshed);
  const { hook, invalidated } = setup(async () => ({ ok: true }), { refreshesSession: true });
  act(() => { hook.result.current.mutate('a'); });
  await waitFor(() => expect(hook.result.current.isPending('a')).toBe(false));
  expect(invalidated).toEqual([['things'], ['audit']]);
  expect(refreshed).toHaveBeenCalledTimes(1);
  off();
});

test('a refusal naming a field becomes that field\'s error, and a 412 re-reads the caller\'s queries', async () => {
  const { hook, invalidated } = setup(async () => {
    throw new ApiError(412, { code: 'stale', field: 'reason', message: 'Somebody changed this.', next: 'Reload and apply your change again' });
  });
  act(() => { hook.result.current.mutate('a'); });
  await waitFor(() => expect(hook.result.current.fieldError('reason')).toBe('Somebody changed this.'));
  await waitFor(() => expect(hook.result.current.isPending('a')).toBe(false));
  expect(invalidated).toEqual([['things']]);
});

test('a second write to the same record while one is in flight sends nothing; another record goes ahead', async () => {
  let release = () => {};
  const calls: string[] = [];
  const { hook } = setup(async (v: string) => { calls.push(v); await new Promise<void>(r => { release = r; }); });
  let sent: boolean[] = [];
  act(() => { sent = [hook.result.current.mutate('a'), hook.result.current.mutate('a'), hook.result.current.mutate('b')]; });
  expect(sent).toEqual([true, false, true]);
  await waitFor(() => expect(calls).toEqual(['a', 'b']));
  expect(hook.result.current.isPending('a') && hook.result.current.isPending('b')).toBe(true);
  act(() => release());
});
