import { useState } from 'react';
import { Clock } from 'lucide-react';
import { tid } from '@/testids';
import { Avatar, Button, Card, CardHead, Fact, GuideButton, NavLink, Page, PageHead, Pill, Small, Tip } from '@/ui';
import { useProfile } from '@/api/profile';
import { useTenant } from '@/api/tenant';
import { flagOn } from '@/domain/modules';
import { buttonVariants } from '@/ui/shadcn/button';
import { useNames } from '@/api/reference';
import { formatDate } from '@/lib/format';
import { StatePill } from '@/features/people/StatePill';
import { perWeek } from '@/features/people/PersonRecord';
import { ProposeChange } from './ProposeChange';

/* Ported from the prototype's essProfile (qnipay-workforce-v15.html:5587-
   5645): who you are and your contract, both set by HR, then your own
   details, which you may propose changes to. The rota and leave cards belong
   to modules not built yet. */
export function ProfilePage() {
  const profile = useProfile(), names = useNames(), tenant = useTenant();
  const docs = tenant.data ? flagOn(tenant.data.modules, tenant.data.flags, 'DOCS') : false;
  const [proposing, setProposing] = useState(false);
  const data = profile.data, p = data?.person;
  return (
    <Page testId={tid.page('profile')}>
      <PageHead title="My profile" crumb="My work · Profile" actions={<GuideButton view="profile" />} />
      {profile.isPending && <p className="text-text-secondary">Loading your profile&hellip;</p>}
      {profile.isError && <p data-testid={tid.profile.error} role="alert" className="text-err">Your profile could not be loaded. Reload the page to try again.</p>}
      {data && p && <>
        <div className="grid grid-cols-2 gap-x-md max-md:grid-cols-1">
          <Card>
            <CardHead title={<span className="flex items-center gap-md"><Avatar name={p.name} large />
              <span><span className="block">{p.name}</span><Small className="font-normal">{names.job(p.jobProfile)} · {names.location(p.location)}</Small></span></span>}
              actions={<StatePill testId={tid.profile.state} state={p.state} />} />
            <Fact label="Employee ID" testId={tid.profile.fact('code')}><span className="tabular-nums">{p.code}</span></Fact>
            <Fact label="Email" testId={tid.profile.fact('email')}><span className="text-xs font-normal text-text-secondary">{p.email || '—'}</span></Fact>
            <Fact label="Employee type" testId={tid.profile.fact('employeeType')}>{names.type(p.employeeType)}</Fact>
            <Fact label="Job profile" testId={tid.profile.fact('jobProfile')}>{names.job(p.jobProfile)}</Fact>
            <Fact label="Department" testId={tid.profile.fact('department')}>{names.department(p.department)}</Fact>
            <Fact label="Location" testId={tid.profile.fact('location')}>{names.location(p.location)}</Fact>
            <Fact label="Reporting manager" testId={tid.profile.fact('manager')}>{p.manager || '—'}</Fact>
          </Card>
          <Card>
            <CardHead title={<>Employment and contract<Tip testId={tid.profile.managedTip} text="Set by HR. You cannot change these here. Ask your administrator." /></>} />
            <Fact label="Worker category" testId={tid.profile.fact('category')}>{p.category}</Fact>
            <Fact label="Contracted hours" testId={tid.profile.fact('contractedHours')}>{perWeek(p.contractedHours, `${p.category} · no contracted hours`)}</Fact>
            <Fact label="Maximum hours" testId={tid.profile.fact('maxHours')}>{perWeek(p.maxHours, 'No maximum set')}</Fact>
            <Fact label="Employment start" testId={tid.profile.fact('start')}>{formatDate(p.start)}</Fact>
            {p.end && <Fact label="Employment end" testId={tid.profile.fact('end')}>{formatDate(p.end)}</Fact>}
          </Card>
        </div>
        <Card>
          <CardHead title={<>Your own details<Tip testId={tid.profile.detailsTip} text="Your line manager approves every change. Bank details are also verified by payroll before they take effect." /></>}
            actions={<>
              {data.pending.length > 0 && <Pill testId={tid.profile.pendingCount} tone="warn" glyph={<Clock />}>{data.pending.length} awaiting approval</Pill>}
              {data.selfEdit && <Button testId={tid.profile.propose} kind="secondary" small onClick={() => setProposing(true)}>Propose a change</Button>}</>} />
          {!data.selfEdit && <p data-testid={tid.profile.off} className="mb-sm text-sm text-text-secondary">
            Self-service changes are switched off for your organisation. Ask HR to change these details.</p>}
          {data.fields.map(f => {
            const c = data.pending.find(x => x.field === f.key);
            return (
              <Fact key={f.key} label={f.label} testId={tid.profile.value(f.key)}>
                <span className="block">{p[f.key] || '—'}</span>
                {c && <span data-testid={tid.profile.pending(f.key)} className="block text-xs font-normal text-warn">{c.to} awaiting approval</span>}
              </Fact>);
          })}
        </Card>
        {/* the way to the documents, while the Document centre is on (v15:5647) */}
        {docs && <div className="mt-md"><NavLink testId={tid.profile.docs} to="/work/docs" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Open documents</NavLink></div>}
        {proposing && <ProposeChange profile={data} onClose={() => setProposing(false)} />}
      </>}
    </Page>);
}
