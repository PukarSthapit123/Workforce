import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { api } from '@/api/client';
import { getTenant } from '@/contract/tenant';
import { buildNav } from '@/domain/nav';
import { tid } from '@/testids';
import { useSession } from '@/shell/SessionProvider';

/* Lists the setup tabs this account can reach; each links to its own route,
   which renders the real page where one exists (Permissions, Audit log) or
   NotBuilt otherwise. */
export function SetupIndex() {
  const { session } = useSession();
  const tenant = useQuery({ queryKey: ['tenant'], queryFn: () => api(getTenant) });
  if (!session || !tenant.data) return null;
  const nav = buildNav({ caps: new Set(session.capabilities), modules: tenant.data.modules, flags: tenant.data.flags, onboarding: false });
  const setup = nav.find(g => g.key === 'setup');
  const cards = setup ? setup.tabs.filter(t => t.view !== 'asetup') : [];
  return (
    <section data-testid={tid.page('asetup')} className="flex flex-col gap-lg">
      <div>
        <h1 className="text-[length:var(--qp-text-20)] font-semibold">Qnipay setup</h1>
        <p className="text-text-secondary">Configuration for how this workforce operates.</p>
      </div>
      <div className="grid grid-cols-1 gap-md sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(t => (
          <Link key={t.view} to={t.path} data-testid={`setup-card-${t.view}`}
            className="rounded-card border border-border bg-surface-card p-lg hover:border-brand">
            <h2 className="font-semibold">{t.label}</h2>
            {!t.built && <p className="text-text-secondary">Not built in this build. It arrives with {t.subProject}.</p>}
          </Link>))}
      </div>
    </section>);
}
