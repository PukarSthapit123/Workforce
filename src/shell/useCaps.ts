import { useCurrentSession } from './SessionProvider';

/* For showing and hiding controls only; the server refuses whatever the UI
   shows by mistake. Without a provider (a component test mounting a page on
   its own) there is no session, so nothing is offered. */
export const useCaps = (): ReadonlySet<string> => new Set(useCurrentSession()?.capabilities ?? []);
