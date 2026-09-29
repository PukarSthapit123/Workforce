import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/api/client';
import { getToken, setToken } from '@/api/session-token';
import { createSession, deleteSession, endViewAs, getSession, startViewAs, type Session } from '@/contract/session';
import { queryClient } from '@/api/query';
import { toastRefusal } from '@/ui';
import { sessionEvents } from '@/api/session-events';

interface Ctx { session: Session | null; ready: boolean;
  signIn(email: string, password: string): Promise<void>; signOut(): Promise<void>;
  viewAs(personCode: string): Promise<void>; endViewAs(): Promise<void>; }
const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => { const c = useContext(SessionCtx); if (!c) throw new Error('useSession outside provider'); return c; };
/* The signed-in session, or null, without requiring a provider: for a page
   that only needs to know who is making a change (a component test may mount
   the page on its own). */
export const useCurrentSession = (): Session | null => useContext(SessionCtx)?.session ?? null;

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  /* No token means there is nothing to check, so the app is ready from the
     first render; a lazy initializer keeps that a pure read, not a setState
     call inside the effect body below. */
  const [ready, setReady] = useState(() => !getToken());
  const adopt = useCallback((s: Session | null) => { setToken(s?.token ?? null); setSession(s); queryClient.clear(); }, []);
  useEffect(() => {
    if (!getToken()) return;
    api(getSession).then(adopt, (err: unknown) => {
      /* Only a confirmed 401 (the token, or the account behind it, is gone)
         should clear a cached token: that is a signed-out person, not an
         empty shell. A 5xx or network failure (ApiError status 0) says
         nothing about whether the session is still valid, so the token stays
         and the person is told what happened instead of being silently
         signed out from under an unrelated outage. */
      if (err instanceof ApiError && err.status === 401) { adopt(null); return; }
      if (err instanceof ApiError) toastRefusal(err.refusal);
    }).finally(() => setReady(true));
  }, [adopt]);
  /* A write that can change this person's own capabilities (their own
     template or exception) asks for the session to be read again. Only the
     session and the tenant (which the nav is built from) are re-read; the
     rest of the cache is the writer's business, and is kept. */
  useEffect(() => sessionEvents.on('refresh', () => {
    if (!getToken()) return;
    api(getSession).then(s => { setSession(s); void queryClient.invalidateQueries({ queryKey: ['tenant'] }); },
      (err: unknown) => {
        /* Rare: the token stopped working between the write's own success and
           this re-read. Signed out, as on boot, rather than left showing a
           session that no longer holds. */
        if (err instanceof ApiError && err.status === 401) { adopt(null); return; }
        if (err instanceof ApiError) toastRefusal(err.refusal);
      });
  }), [adopt]);
  /* Global 401 handling: a query or a mutation anywhere in the app (not the
     two direct reads above, which already sign out on their own 401) was
     answered 401 by queryClient's QueryCache/MutationCache (src/api/query.ts).
     The refusal it carries is toasted here, once, and the session is cleared,
     so a request the person never sees directly still ends in a clear
     "you are signed out", not a page that quietly stops working. */
  useEffect(() => sessionEvents.on('signed-out', refusal => {
    if (refusal) toastRefusal(refusal);
    adopt(null);
  }), [adopt]);
  /* Starting or ending view-as changes the session only from a real
     response. A refusal or fault is toasted and the session stays exactly as
     it was, so a failed "Return to my account" is never silent. A 401 means
     the session itself is gone, so that one signs out, as on boot above. */
  const switchView = useCallback(async (call: () => Promise<Session>) => {
    let next: Session;
    try { next = await call(); }
    catch (err) {
      if (!(err instanceof ApiError)) throw err;
      toastRefusal(err.refusal);
      if (err.status === 401) adopt(null);
      return;
    }
    adopt(next);
  }, [adopt]);
  const value: Ctx = { session, ready,
    signIn: async (email, password) => adopt(await api(createSession, { body: { email, password } })),
    signOut: async () => { try { await api(deleteSession); } catch (e) { if (!(e instanceof ApiError)) throw e; } adopt(null); },
    viewAs: personCode => switchView(() => api(startViewAs, { body: { personCode } })),
    endViewAs: () => switchView(() => api(endViewAs)) };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
