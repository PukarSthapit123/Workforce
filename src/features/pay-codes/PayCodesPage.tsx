import { useState, type ReactNode } from 'react';
import { Check, Minus } from 'lucide-react';
import { tid } from '@/testids';
import { Button, Page, PageHead, Pill, Row, Small, Tip } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useCaps } from '@/shell/useCaps';
import { usePayCodes, type AllowanceCodeRow, type PayCodeRow } from '@/api/pay-codes';
import { PAY_BASIS } from '@/domain/timesheet';
import { latest, versionKey } from '@/lib/latest';
import { PayCodeForm } from './PayCodeForm';

export const LEDE = 'Every code carries a basis, which is what lets one value column hold 1.5×, 1 day and a marker without ambiguity';
const WORK_TYPE_TIP = 'At what rate the hour was worked. Posts as Business Central’s Work Type Code.';
const FOOTER = 'Workforce posts hours and a pay code. Business Central owns the rate, the tax treatment and gross-to-net. No monetary value is set anywhere in this platform.';

/* Ported from the prototype's admPayCodes (qnipay-workforce-v15.html:
   9596-9633): one table of the base codes, then the allowance codes, each
   with its name, whether it is a work type, what it posts as, its value, its
   Business Central element and the employee types that claim it. A base
   code opens the new or edit dialog; an allowance code is read only here,
   as it is kept with the allowances in Timesheet setup. No money (P1): the
   prototype's inline £ value is not ported; a value is a multiplier or a
   unit count, edited in the dialog, and a flat code has none. */
export function PayCodesPage() {
  const list = usePayCodes(), caps = useCaps();
  const canEdit = caps.has('master_data');
  const [form, setForm] = useState<{ row?: PayCodeRow } | null>(null);
  /* the dialog works on the code as last read, and starts again when it changes */
  const editing = form?.row && latest(form.row, list.data?.codes);
  return (
    <Page testId={tid.page('mpay')}>
      <PageHead title="Pay codes" crumb="Qnipay setup · Pay codes" tip={LEDE} tipTestId={tid.head.tip('mpay')} />
      {list.isPending && <p data-testid={tid.mpay.loading} className="text-text-secondary">Loading the pay codes&hellip;</p>}
      {list.isError && <p data-testid={tid.mpay.error} role="alert" className="text-err">The pay codes could not be loaded, so nothing here is current. Reload the page.</p>}
      {list.data && (
        <Table data-testid={tid.mpay.table} variant="records" dense>
          <TableHeader><TableRow>
            <TableHead>Code</TableHead><TableHead>Name</TableHead>
            <TableHead>Work type<Tip testId={tid.mpay.workTypeTip} text={WORK_TYPE_TIP} /></TableHead>
            <TableHead>Posts as</TableHead><TableHead>Value</TableHead><TableHead>BC element</TableHead><TableHead>Claimed by</TableHead>
            <TableHead><span className="sr-only">Actions</span></TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {list.data.codes.map(r => (
              <CodeRow key={r.id} r={r} action={canEdit
                ? <Button testId={tid.mpay.edit(r.code)} kind="ghost" small onClick={() => setForm({ row: r })}>Edit</Button>
                : <span className="text-xs text-text-muted">Read only</span>} />))}
            {list.data.allowances.map(a => (
              <CodeRow key={a.code} r={{ ...a, basis: 'flat', value: '', workType: false }} action={
                <span data-testid={tid.mpay.readOnly(a.code)} className="text-xs text-text-muted">Allowance, read only here</span>} />))}
          </TableBody>
        </Table>)}
      {canEdit && <div className="mb-md flex flex-wrap justify-start gap-sm">
        <Button testId={tid.mpay.add} kind="primary" small onClick={() => setForm({})}>New pay code</Button></div>}
      <Small testId={tid.mpay.footer}>Allowance codes are kept with the allowances in Timesheet setup, so they are read only here. {FOOTER}</Small>
      {form && <PayCodeForm key={editing ? versionKey(editing) : 'new'} row={editing} onClose={() => setForm(null)} />}
    </Page>);
}

type Shown = Pick<PayCodeRow, 'code' | 'label' | 'basis' | 'value' | 'element' | 'workType'> & { claimedBy: AllowanceCodeRow['claimedBy'] };
function CodeRow({ r, action }: { r: Shown; action: ReactNode }) {
  const b = PAY_BASIS[r.basis];
  return (
    <Row testId={tid.mpay.row(r.code)}>
      <TableCell kind="title" className="font-bold tabular-nums">{r.code}</TableCell>
      <TableCell label="Name">{r.label || '—'}</TableCell>
      <TableCell label="Work type">
        <Pill testId={tid.mpay.workType(r.code)} tone={r.workType ? 'ok' : 'neu'} glyph={r.workType ? <Check /> : <Minus />}>{r.workType ? 'Yes' : 'No'}</Pill></TableCell>
      <TableCell label="Posts as">{b.label}<span className="block text-xs text-text-muted">{b.hint}</span></TableCell>
      <TableCell label="Value" className="tabular-nums" data-testid={tid.mpay.value(r.code)}>
        {r.value ? `${r.value} ${b.unit}` : <span className="text-xs text-text-muted">—</span>}</TableCell>
      <TableCell label="BC element" className="text-xs tabular-nums">{r.element}</TableCell>
      <TableCell label="Claimed by" className="text-xs" data-testid={tid.mpay.claimed(r.code)}>
        {r.claimedBy.length ? r.claimedBy.map(t => t.name).join(', ') : <span className="text-text-muted">No type yet</span>}</TableCell>
      <TableCell kind="foot" className="text-right">{action}</TableCell>
    </Row>);
}
