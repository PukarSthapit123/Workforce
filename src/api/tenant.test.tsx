import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { server } from '@/mocks/node';
import { store } from '@/mocks/store';
import { resetTo, signInAs } from '@/test/api-helpers';
import { useSetModule, useTenant } from './tenant';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

test('a module switch is written once the server answers, and every module reader is read again', async () => {
  await signInAs('admin');
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  const keys: unknown[] = [];
  const invalidate = qc.invalidateQueries.bind(qc);
  vi.spyOn(qc, 'invalidateQueries').mockImplementation(async f => { keys.push(f?.queryKey); await invalidate(f); });
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const hook = renderHook(() => ({ tenant: useTenant(), setModule: useSetModule() }), { wrapper });
  await waitFor(() => expect(hook.result.current.tenant.data?.modules.L).toBe(true));
  const version = hook.result.current.tenant.data?.version ?? -1;
  act(() => { hook.result.current.setModule.mutate({ code: 'L', on: false, ifMatch: version }); });
  /* no optimistic update: the tenant changes only after the re-read */
  await waitFor(() => expect(hook.result.current.tenant.data?.modules.L).toBe(false));
  expect(store.coll<{ modules: Record<string, boolean> }>('tenant').tenant?.modules.L).toBe(false);
  expect(keys).toEqual(expect.arrayContaining([['tenant'], ['rota'], ['timesheets'], ['timesheet-config'], ['leave'], ['employee-types'], ['audit']]));
});
