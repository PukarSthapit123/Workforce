import type { Refusal } from '@/contract/common';

/* Signals from the data layer to whoever holds the session (the shell's
   SessionProvider), so src/api never imports the shell:
   - 'refresh': a write may have changed the caller's own capabilities, so
     re-read the session and the nav built from it;
   - 'signed-out': a request in the middle of a session was answered 401,
     carrying the refusal the server sent, so the toast says why. */
type SessionEvent = 'refresh' | 'signed-out';
type Listener = (refusal?: Refusal) => void;
const listeners: Record<SessionEvent, Set<Listener>> = { refresh: new Set(), 'signed-out': new Set() };

export const sessionEvents = {
  on(event: SessionEvent, fn: Listener): () => void {
    listeners[event].add(fn);
    return () => { listeners[event].delete(fn); };
  },
  emit(event: SessionEvent, refusal?: Refusal) { for (const fn of [...listeners[event]]) fn(refusal); },
};
