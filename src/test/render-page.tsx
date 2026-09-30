/* Component tests of a whole page: the fake server, a signed-in session, a
   router and the toaster, as the app gives them. */
import type { ReactElement, ReactNode } from 'react';
import { render } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { toast } from 'sonner';
import { server } from '@/mocks/node';
import { queryClient } from '@/api/query';
import { setToken } from '@/api/session-token';
import { SessionProvider, useSession } from '@/shell/SessionProvider';
import { Toaster } from '@/ui/shadcn/sonner';

/* The provider clears the query cache when it adopts a session, so a page
   mounts only once the session is in. */
function Ready({ children }: { children: ReactNode }) { return useSession().session ? <>{children}</> : null; }
export function renderPage(ui: ReactElement, path = '/') {
  queryClient.clear();
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[path]}><SessionProvider><Ready>{ui}</Ready></SessionProvider></MemoryRouter>
      <Toaster />
    </QueryClientProvider>);
}
/* Call once at the top of a page test file. sonner keeps its queue outside
   React, so toasts are dismissed between tests or one leaks into the next. */
export function withFakeServer() {
  beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
  afterAll(() => server.close());
  afterEach(() => { setToken(null); server.resetHandlers(); toast.dismiss(); });
}
