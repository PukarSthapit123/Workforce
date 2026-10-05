import { act, render, screen } from '@testing-library/react';
import { useNarrow } from './useNarrow';

/* MOBILE FOUNDATION: "Crossing the breakpoint re-renders, so a rotation is
   not left behind". A fake matchMedia stands in for the browser: turning the
   phone (crossing 767px) fires its change event, and the screen follows. */
function fakeMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<() => void>();
  const mql = {
    get matches() { return matches; }, media: '(max-width: 767px)',
    addEventListener: (_: string, l: () => void) => listeners.add(l), removeEventListener: (_: string, l: () => void) => listeners.delete(l),
  };
  const asked: string[] = [];
  window.matchMedia = ((q: string) => { asked.push(q); return mql; }) as unknown as typeof window.matchMedia;
  return { asked, listeners, cross: (to: boolean) => { matches = to; listeners.forEach(l => l()); } };
}
function Probe() { return <p data-testid="narrow">{useNarrow() ? 'phone' : 'wide'}</p>; }

const original = window.matchMedia;
afterEach(() => { window.matchMedia = original; });

test('crossing the phone breakpoint re-renders, both ways, and stops listening once gone', () => {
  const m = fakeMedia(false);
  const view = render(<Probe />);
  expect(screen.getByTestId('narrow')).toHaveTextContent('wide');
  expect(m.asked).toContain('(max-width: 767px)');
  act(() => m.cross(true));
  expect(screen.getByTestId('narrow')).toHaveTextContent('phone');
  act(() => m.cross(false));
  expect(screen.getByTestId('narrow')).toHaveTextContent('wide');
  view.unmount();
  expect(m.listeners.size).toBe(0);
});
