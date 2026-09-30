import { useState, type ReactNode } from 'react';
import { tid } from '@/testids';
import type { Person } from '@/contract/people';
import { Button, Page, PageHead } from '@/ui';
import { usePeople } from '@/api/people';
import { useCaps } from '@/shell/useCaps';
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
  const crud = useCaps().has('emp_crud');
  const everyone = usePeople(variant === 'admin' ? 'all' : 'here', '');
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState<{ person?: Person } | null>(null);
  const [moving, setMoving] = useState<Person | null>(null);
  /* a manager adds people at their own location, so the form starts there */
  const defaultLocation = variant === 'team' ? everyone.data?.[0]?.location : undefined;
  const add = crud && (variant === 'admin'
    ? <Button testId={tid.people.add} kind="ghost" small onClick={() => setForm({})}>Add person</Button>
    : <Button testId={tid.people.add} kind="primary" small onClick={() => setForm({})}>Add someone</Button>);
  return (
    <Page testId={tid.page(view)}>
      {above}
      <PageHead title="People" crumb={crumb} tip={tip} tipTestId={tid.head.tip(view)} actions={add || undefined} />
      <PeopleList variant={variant} total={everyone.data?.length} onOpen={p => setOpen(p.id)}
        actions={crud ? p => <Button testId={tid.people.edit(p.code)} kind="ghost" small onClick={() => setForm({ person: p })}>Edit</Button> : undefined} />
      {open && <PersonRecord personId={open} onClose={() => setOpen(null)} actions={crud ? p => <>
        <Button testId={tid.person.changeState} kind="ghost" onClick={() => { setOpen(null); setMoving(p); }}>Change state</Button>
        <Button testId={tid.person.edit} kind="primary" onClick={() => { setOpen(null); setForm({ person: p }); }}>Edit</Button></> : undefined} />}
      {form && <PersonForm person={form.person} defaultLocation={defaultLocation} onClose={() => setForm(null)}
        onChangeState={p => { setForm(null); setMoving(p); }} />}
      {moving && <LifecycleDialog person={moving} onClose={() => setMoving(null)} />}
    </Page>);
}
