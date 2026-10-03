import { useState } from 'react';
import { Clock } from 'lucide-react';
import { tid } from '@/testids';
import { AdminCard, Caution, GuideButton, Page, PageHead, toastInfo } from '@/ui';
import { useShiftCatalogue } from '@/api/rota';
import { useCaps } from '@/shell/useCaps';
import { useTenant } from '@/shell/shellData';
import { Palette } from './Palette';
import { NewShiftTypeDialog, ShiftCatalogueBody } from './ShiftCatalogue';

/* Shift catalogue: the prototype's mgrShifts (qnipay-workforce-v15.html:
   7228-7237). The palette in the rota's colours, then the catalogue itself.
   A shift type is tenant-wide, which the caution says before anything is
   changed. Writing needs rota_shift, and Rota setup can keep it for
   administrators only; the server enforces both (D5). */
const TENANT_WIDE = 'A shift type is tenant-wide. Adding, renaming or retiming one changes it for every location, and the paid hours it derives change with it. Existing rota days keep the shift; their hours are recalculated.';

export function ShiftsPage() {
  const q = useShiftCatalogue(), caps = useCaps(), tenant = useTenant();
  const [adding, setAdding] = useState(false);
  const n = q.data?.items.length ?? 0;
  return (
    <Page testId={tid.page('tshifts')}>
      <PageHead title="Shift catalogue" crumb={`Rota · Shift catalogue${q.data ? ` · ${n} shift type${n === 1 ? '' : 's'}` : ''}${tenant.data ? ` · ${tenant.data.name}` : ''}`}
        actions={<><Caution testId={tid.head.caution('tshifts')} text={TENANT_WIDE} /><GuideButton view="tshifts" /></>} />
      {q.isError && <p data-testid={tid.tshifts.error} role="alert" className="text-err">The shift catalogue could not be loaded. Reload the page to try again.</p>}
      {!q.data && !q.isError && <p data-testid={tid.tshifts.loading} className="text-text-secondary">Loading the shift catalogue&hellip;</p>}
      {q.data && <>
        <Palette shifts={q.data.items} lifted={null} canMake={caps.has('rota_shift')} onNew={() => setAdding(true)}
          onLift={code => { const s = q.data.items.find(x => x.code === code); if (s) toastInfo(`${s.name} · ${s.from}–${s.to} · ${s.hours}h paid`, 'Place it on a person from Team rota.'); }}
          onDragStart={() => {}} onDragEnd={() => {}} />
        <AdminCard icon={<Clock />} title="Shift types" tipTestId={tid.tshifts.cardTip}
          tip="Times, breaks and paid hours. Paid hours, midnight crossing and the rota colour all follow from the times."
          desc="The shifts this workforce runs">
          <ShiftCatalogueBody catalogue={q.data} onAdd={() => setAdding(true)} />
        </AdminCard>
        {adding && <NewShiftTypeDialog codes={q.data.items.map(s => s.code)} onClose={() => setAdding(false)} />}
      </>}
    </Page>);
}
