import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { server } from '@/mocks/node';
import { store } from '@/mocks/store';
import { queryClient } from '@/api/query';
import { setToken } from '@/api/session-token';
import { App } from '@/App';
import { resetTo } from '@/test/api-helpers';

/* Module 5 D8: a candidate or preboarding person signs in to the portal only.
   The shell builds the nav from session.onboarding, so their one tab is
   Onboarding and "/" lands on it. */
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterAll(() => server.close());
beforeEach(() => resetTo('social'));
afterEach(() => { cleanup(); setToken(null); window.history.pushState({}, '', '/'); });

async function signIn(email: string) {
  const r = await fetch('/api/v1/session', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: 'Qnipay@123' }) });
  const { token } = (await r.json()) as { token: string };
  queryClient.clear();
  setToken(token);
  window.history.pushState({}, '', '/');
  render(<App />);
  const strip = await screen.findByRole('navigation', { name: 'Pages' });
  return within(strip).queryAllByTestId(/^nav-tab-/).map(a => (a.getAttribute('data-testid') ?? '').replace('nav-tab-', ''));
}

test('a candidate sees the onboarding portal and nothing else, and lands on it', async () => {
  expect(await signIn('priya.raman@brightpath.org')).toEqual(['onb']);
  await waitFor(() => expect(window.location.pathname).toBe('/work/onb'));
});
test('with the Onboarding module off the same person gets the ordinary employee nav', async () => {
  const t = store.coll<{ modules: Record<string, boolean> }>('tenant').tenant;
  if (t) t.modules.ON = false;
  const tabs = await signIn('priya.raman@brightpath.org');
  expect(tabs).not.toContain('onb');
  expect(tabs).toContain('home');
});
