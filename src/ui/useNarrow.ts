import { useSyncExternalStore } from 'react';

/* True below the prototype's phone breakpoint (max-width 767px, its
   narrowScreen()). A screen that changes its layout there, such as the
   weekly view turning into the day list, reads this; anything that only
   restyles uses Tailwind's max-md: instead. Without matchMedia (a test
   environment) it is false. */
const QUERY = '(max-width: 767px)';
const media = () => (typeof window !== 'undefined' && typeof window.matchMedia === 'function' ? window.matchMedia(QUERY) : null);
function subscribe(onChange: () => void) {
  const m = media();
  if (!m) return () => {};
  m.addEventListener('change', onChange);
  return () => m.removeEventListener('change', onChange);
}
export const useNarrow = () => useSyncExternalStore(subscribe, () => media()?.matches ?? false, () => false);
