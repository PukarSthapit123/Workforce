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
  /* the prototype's .setupcard: the section, then the pages it holds, then
     their count (a pill that says "3 pages" to a screen reader) */
  expect(card).toHaveAccessibleName(/^Governance Permissions · .+ \d+ pages?$/);
  expect(card).toHaveAccessibleDescription('Who may do what, who is told, and who signs it off');
  expect(screen.getByTestId(tid.setup.cardDescription('gov'))).toHaveClass('sr-only');
  expect(card).not.toHaveTextContent('Who may do what');
  /* SETUP_SECTIONS: Modules lists only Modules & features; each module's own
     setup page is reached through that module's drill-in */
  expect(screen.getByTestId(tid.setup.card('mods'))).toHaveAccessibleName('Modules Modules & features 1 page');
  /* HEADER PILLS REMOVED, WARNING RELOCATED: the caution is behind a warning
     icon a keyboard reaches, carries the whole of it, and is not printed */
  const caution = screen.getByTestId(tid.head.caution('asetup'));
  expect(caution).toHaveAttribute('tabindex', '0');
  expect(caution).toHaveAttribute('role', 'note');
  expect(caution).toHaveTextContent(/no draft, no approval and no scheduled release/);
  expect(caution.tagName).not.toBe('BUTTON');
  expect(screen.getByTestId(tid.page('asetup'))).not.toHaveTextContent(/Applies immediately/);
});
