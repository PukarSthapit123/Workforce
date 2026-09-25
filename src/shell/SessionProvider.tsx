import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from '@/api/client';
import { getToken, setToken } from '@/api/session-token';
import { createSession, deleteSession, endViewAs, getSession, startViewAs, type Session } from '@/contract/session';
import { queryClient } from '@/api/query';

interface Ctx { session: Session | null; ready: boolean;
  signIn(email: string, password: string): Promise<void>; signOut(): Promise<void>;
  viewAs(personCode: string): Promise<void>; endViewAs(): Promise<void>; }
const SessionCtx = createContext<Ctx | null>(null);
export const useSession = () => { const c = useContext(SessionCtx); if (!c) throw new Error('useSession outside provider'); return c; };

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  /* No token means there is nothing to check, so the app is ready from the
     first render; a lazy initializer keeps that a pure read, not a setState
     call inside the effect body below. */
  const [ready, setReady] = useState(() => !getToken());
  const adopt = useCallback((s: Session | null) => { setToken(s?.token ?? null); setSession(s); queryClient.clear(); }, []);
  useEffect(() => {
    if (!getToken()) return;
    /* a token for an account that has gone is a signed-out person, not an empty shell */
    api(getSession).then(adopt, () => adopt(null)).finally(() => setReady(true));
  }, [adopt]);
  const value: Ctx = { session, ready,
    signIn: async (email, password) => adopt(await api(createSession, { body: { email, password } })),
    signOut: async () => { try { await api(deleteSession); } catch (e) { if (!(e instanceof ApiError)) throw e; } adopt(null); },
    viewAs: async personCode => adopt(await api(startViewAs, { body: { personCode } })),
    endViewAs: async () => adopt(await api(endViewAs)) };
  return <SessionCtx.Provider value={value}>{children}</SessionCtx.Provider>;
}
