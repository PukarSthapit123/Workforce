import { render, screen } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/node';
import { store } from '@/mocks/store';
import { writeAudit } from '@/mocks/audit';
import { queryClient } from '@/api/query';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import { AuditPage } from './AuditPage';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());

interface SeedAccount { email: string; version: number; userType: string }
const anyAccount = (userType: string): SeedAccount => {
  const found = Object.values(store.db.accounts as unknown as Record<string, SeedAccount>).find(a => a.userType === userType);
  if (!found) throw new Error(`no seeded account with userType "${userType}"`);
  return found;
};

beforeEach(async () => {
  store.reset('social');
  queryClient.clear();
  const admin = anyAccount('admin');
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: 'Qnipay@123' }) });
  const s = (await r.json()) as { token: string };
  setToken(s.token);
});
afterEach(() => setToken(null));

const mount = () => render(<QueryClientProvider client={queryClient}><AuditPage /></QueryClientProvider>);

/* Pinned review focus: a fault on a read must show the error state and never
   present the previous, now-unconfirmed rows as current. This proves it for a
   REFETCH of the same query (not a new filter, which would be a different
   query key with no prior data to confuse the point) by seeding a real row,
   letting the page render it, then failing the very next request for the
   same list and checking the table is gone, not merely stale underneath the
   error. */
test('a refetch failure replaces the table with the error state, not stale rows', async () => {
  const id = writeAudit({ who: { personCode: 'A', name: 'Dee' }, act: 'Permission changed', entity: 'userType', entityId: 'employee' });
  mount();

  await screen.findByTestId(tid.audit.table);
  expect(screen.getByTestId(tid.audit.row(id))).toHaveTextContent('Permission changed');

  server.use(http.get('/api/v1/audit', () => HttpResponse.json(
    { code: 'fault', message: 'The server could not complete that. Nothing has been changed.', next: 'Try again.' }, { status: 500 })));
  await queryClient.invalidateQueries({ queryKey: ['audit'] });

  const error = await screen.findByTestId(tid.audit.error);
  expect(error).toHaveTextContent('The audit log could not be loaded');
  expect(error).toHaveTextContent('Reload the page');
  expect(screen.queryByTestId(tid.audit.table)).not.toBeInTheDocument();
  expect(screen.queryByTestId(tid.audit.row(id))).not.toBeInTheDocument();
});
