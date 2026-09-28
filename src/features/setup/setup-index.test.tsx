import { render, screen } from '@testing-library/react';
import { server } from '@/mocks/node';
import { store } from '@/mocks/store';
import { queryClient } from '@/api/query';
import { setToken } from '@/api/session-token';
import { tid } from '@/testids';
import { App } from '@/App';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => { store.reset('social'); queryClient.clear(); });
afterEach(() => { setToken(null); window.history.pushState({}, '', '/'); });

/* NO MARKUP WITHOUT STYLING: "Card descriptions are behind hover, not
   printed under every title" / "The setup index does the same". */
test('each setup card keeps what its section configures behind hover, and says its page count in words', async () => {
  const admin = Object.values(store.db.accounts as unknown as Record<string, { email: string; userType: string }>).find(a => a.userType === 'admin');
  if (!admin) throw new Error('no seeded admin');
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: admin.email, password: 'Qnipay@123' }) });
  setToken(((await r.json()) as { token: string }).token);
  window.history.pushState({}, '', '/setup/asetup');
  render(<App />);
  const card = await screen.findByTestId(tid.setup.card('gov'));
  expect(card).toHaveAccessibleName(/^Governance \d+ pages?$/);
  expect(card).toHaveAccessibleDescription('Who may do what, who is told, and who signs it off');
  expect(screen.getByTestId(tid.setup.cardDescription('gov'))).toHaveClass('sr-only');
  expect(card).not.toHaveTextContent('Who may do what');
});
