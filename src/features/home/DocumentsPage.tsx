import type { ReactNode } from 'react';
import { FileText, Landmark, Receipt } from 'lucide-react';
import { tid } from '@/testids';
import { Card, CardHead, Empty, GuideButton, Page, PageHead, Pill, Small, Tip } from '@/ui';
import { ApiError } from '@/api/client';
import { useMyDocuments, type MyDocuments } from '@/api/home';
import { formatDmy } from '@/domain/time';

/* My documents: the prototype's essDocs (qnipay-workforce-v15.html:5673-5696).
   The documents Workforce holds for this person, and the payroll ones, which
   are payroll's and read "Not yet connected" (D12). There is no Open action:
   opening documents is not built yet, and an Open that opened nothing would
   say otherwise. */
export function DocumentsPage() {
  const q = useMyDocuments();
  const refused = q.error instanceof ApiError ? q.error.refusal : null;
  const d = q.data;
  return (
    <Page testId={tid.page('docs')}>
      <PageHead title="Documents" crumb={d ? `My work · Documents · ${d.person.name}` : 'My work · Documents'} actions={<GuideButton view="docs" />} />
      {q.isError && <p data-testid={tid.docs.error} role="alert" className="text-err">
        {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'Your documents could not be loaded. Reload the page to try again.'}</p>}
      {!d && !q.isError && <p data-testid={tid.docs.loading} className="text-text-secondary">Loading your documents&hellip;</p>}
      {d && <Docs d={d} />}
    </Page>);
}

/* .docrow (v15:1537-1541): a 32px icon tile, the name in 14px/600, a 12px muted line, what is at the end */
function DocRow({ testId, icon, name, line, end }: { testId: string; icon: ReactNode; name: string; line: string; end?: ReactNode }) {
  return (
    <div data-testid={testId} className="flex items-center gap-md border-b py-[11px] last:border-b-0">
      <span aria-hidden="true" className="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-tint [&_svg]:size-4">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold">{name}</div>
        <Small>{line}</Small>
      </div>
      {end}
    </div>);
}

function Docs({ d }: { d: MyDocuments }) {
  const notConnected = <Pill tone="neu" glyph="—">Not yet connected</Pill>;
  return (
    <>
      <Card testId={tid.docs.card}>
        <CardHead title={<>Workforce documents<Tip testId={tid.docs.tip} text="Held by Workforce. A document with an expiry raises an exception for your manager before it lapses." /></>}
          actions={<span data-testid={tid.docs.source} className="text-xs text-text-muted">Sourced from the HRIS and the learning system</span>} />
        {d.items.length
          ? d.items.map(x => <DocRow key={x.id} testId={tid.docs.row(x.id)} icon={<FileText />} name={x.name}
              line={`${x.category} · ${formatDmy(x.date)} · ${x.source}`} />)
          : <Empty testId={tid.docs.empty}>No documents are held for you yet.</Empty>}
        <Small testId={tid.docs.openNote} className="mt-[10px]">Opening documents is not built yet. Each row names the system that holds it.</Small>
      </Card>
      <Card testId={tid.docs.payroll}>
        <CardHead title="Pay information & payroll documents" actions={<Pill tone="neu" glyph="—">Payroll-owned</Pill>} />
        {d.payroll.map(x => <DocRow key={x.id} testId={tid.docs.payrollRow(x.id)} icon={<Receipt />} name={x.name} line={x.note} end={notConnected} />)}
        <DocRow testId={tid.docs.salary} icon={<Landmark />} name="Salary & pay history"
          line="Payroll-owned. Workforce posts hours and pay codes only, and never resolves what they are worth." end={notConnected} />
      </Card>
    </>);
}
