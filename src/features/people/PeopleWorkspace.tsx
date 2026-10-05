import { useState, type ReactNode } from 'react';
import { tid } from '@/testids';
import type { Person } from '@/contract/people';
import { Button, GuideButton, Page, PageHead } from '@/ui';
import { usePeople } from '@/api/people';
import { useCaps } from '@/shell/useCaps';
import { useCurrentSession } from '@/shell/SessionProvider';
import { useTenant } from '@/shell/shellData';
import { ProxyEntry, type ProxyTarget } from '@/features/timesheet/ProxyEntry';
import { latest, versionKey } from '@/lib/latest';
import { PeopleList } from './PeopleList';
import { PersonRecord } from './PersonRecord';
import { PersonForm } from './PersonForm';
import { LifecycleDialog } from './LifecycleDialog';

/* The list, the record, the form and the lifecycle dialog together, shared
   by Qnipay setup · People and My team · People. Add and Edit show only to a
   holder of emp_crud; the server refuses anything shown by mistake. */
export function PeopleWorkspace({ variant, view, crumb, tip, above }: {
  variant: 'admin' | 'team'; view: string; crumb: string; tip: string; above?: ReactNode;
}) {
  const caps = useCaps(), crud = caps.has('emp_crud');
  const self = useCurrentSession()?.account.personCode, modules = useTenant().data?.modules;
  /* proxy entry (proxyBox): a manager entering time for someone they look after, while a timesheet module is on */
  const proxyOk = variant === 'team' && caps.has('proxy') && caps.has('team_ts') && Boolean(modules?.A || modules?.B);
  const [proxy, setProxy] = useState<ProxyTarget | null>(null);
  const everyone = usePeople(variant === 'admin' ? 'all' : 'here', '');
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ person?: Person } | null>(null);
  const [moving, setMoving] = useState<Person | null>(null);
  /* a manager adds people at their own location, so the form starts there */
  const defaultLocation = variant === 'team' ? everyone.data?.[0]?.location : undefined;
  /* the dialogs work on the record as last read, and start again when it changes */
  const editing = form?.person && latest(form.person, everyone.data);
  const move = moving && latest(moving, everyone.data);
  const add = crud && (variant === 'admin'
    ? <Button testId={tid.people.add} kind="ghost" small onClick={() => setForm({})}>Add person</Button>
    : <Button testId={tid.people.add} kind="primary" small onClick={() => setForm({})}>Add someone</Button>);
  return (
    <Page testId={tid.page(view)}>
      {above}
      <PageHead title="People" crumb={crumb} tip={tip} tipTestId={tid.head.tip(view)} actions={<>{add}<GuideButton view={view} /></>} />
      <PeopleList variant={variant} total={everyone.data?.length} onOpen={p => setOpen(p.id)}
        actions={crud ? p => <Button testId={tid.people.edit(p.code)} kind="ghost" small onClick={() => setForm({ person: p })}>Edit</Button> : undefined} />
      {open && <PersonRecord personId={open} onClose={() => setOpen(null)} actions={crud || proxyOk ? p => <>
        {crud && <Button testId={tid.person.changeState} kind="ghost" onClick={() => { setOpen(null); setMoving(p); }}>Change state</Button>}
        {proxyOk && p.code !== self && <Button testId={tid.proxy.open} kind={crud ? 'secondary' : 'primary'}
          onClick={() => { setOpen(null); setProxy({ code: p.code, name: p.name }); }}>Enter time on their behalf</Button>}
        {crud && <Button testId={tid.person.edit} kind="primary" onClick={() => { setOpen(null); setForm({ person: p }); }}>Edit</Button>}</> : undefined} />}
      {proxy && <ProxyEntry person={proxy} onClose={() => setProxy(null)} />}
      {form && <PersonForm key={editing ? versionKey(editing) : 'new'} person={editing} defaultLocation={defaultLocation} onClose={() => setForm(null)}
        onChangeState={p => { setForm(null); setMoving(p); }} />}
      {move && <LifecycleDialog key={versionKey(move)} person={move} onClose={() => setMoving(null)} />}
    </Page>);
}
