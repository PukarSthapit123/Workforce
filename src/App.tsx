import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { Toaster } from '@/ui/shadcn/sonner';
import { queryClient } from '@/api/query';
import { SessionProvider, useSession } from '@/shell/SessionProvider';
import { SignIn } from '@/shell/SignIn';
import { Shell } from '@/shell/Shell';
import { tid } from '@/testids';

function Gate() {
  const { session, ready } = useSession();
  if (!ready) return null;
  if (!session) return <SignIn />;
  return <Shell />;
}
export function App() {
  return (
    <div data-testid={tid.app}>
      <QueryClientProvider client={queryClient}><BrowserRouter><SessionProvider><Gate /></SessionProvider></BrowserRouter></QueryClientProvider>
      <Toaster />
    </div>);
}
