/* Signals from the data layer to whoever holds the session (the shell's
   SessionProvider), so src/api never imports the shell:
   - 'refresh': a write may have changed the caller's own capabilities, so
     re-read the session and the nav built from it;
   - 'signed-out': a request in the middle of a session was answered 401. */
type SessionEvent = 'refresh' | 'signed-out';
const listeners: Record<SessionEvent, Set<() => void>> = { refresh: new Set(), 'signed-out': new Set() };

export const sessionEvents = {
  on(event: SessionEvent, fn: () => void): () => void {
    listeners[event].add(fn);
    return () => { listeners[event].delete(fn); };
  },
  emit(event: SessionEvent) { for (const fn of [...listeners[event]]) fn(); },
};
