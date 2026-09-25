import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { Toaster } from '@/ui/shadcn/sonner';
import { queryClient } from '@/api/query';
import { SessionProvider, useSession } from '@/shell/SessionProvider';
import { SignIn } from '@/shell/SignIn';
import { tid } from '@/testids';

/* Avoids a non-null assertion on userType[0]: charAt(0) is always defined,
   even for an empty string, so this needs no unsafe indexing. */
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function Gate() {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (!session) return <SignIn />;
  /* replaced by <Shell /> in Task 8 */
  return <div data-testid={tid.shell.rolePill}>{capitalise(session.account.userType)}</div>;
}
export function App() {
  return (
    <div data-testid={tid.app}>
      <QueryClientProvider client={queryClient}><BrowserRouter><SessionProvider><Gate /></SessionProvider></BrowserRouter></QueryClientProvider>
      <Toaster position="bottom-right" />
    </div>);
}
