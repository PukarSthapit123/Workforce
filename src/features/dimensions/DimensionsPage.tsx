import { useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router';
import { Banknote, Building, Check, Folder, Minus, ShieldCheck, Users } from 'lucide-react';
import { tid } from '@/testids';
import { DIMENSIONS, DIMENSION_KINDS, type DimensionKind } from '@/contract/dimensions';
import { Button, Card, Empty, Page, PageHead, Pill, Row, SetupCardButton, Small, Tip } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { useDimension, type InUseRow } from '@/api/reference';
import { DIM_GROUPS, DIM_SPECS } from './spec';
import { DimensionForm } from './DimensionForm';

const ICON: Record<string, ReactNode> = { building: <Building />, shield: <ShieldCheck />, money: <Banknote />, users: <Users />, folder: <Folder /> };
const isKind = (k: string | null): k is DimensionKind => !!k && (DIMENSION_KINDS as readonly string[]).includes(k);

/* Ported from the prototype's admDimensions and dimPage (qnipay-workforce-v15.
   html:9228-9270, IMP-019): an index of five cards grouped by the question
   each answers, and one page per dimension. The page is ?d=<kind>, so a
   dimension can be linked to (Employee types links to job profiles). */
export function DimensionsPage() {
  const [params, setParams] = useSearchParams();
  const kind = params.get('d');
  return (
    <Page testId={tid.page('aloc')}>
      {isKind(kind) ? <DimensionTable kind={kind} onBack={() => setParams({})} /> : <DimensionIndex onOpen={k => setParams({ d: k })} />}
    </Page>);
}

function DimensionCard({ kind, onOpen }: { kind: DimensionKind; onOpen(k: DimensionKind): void }) {
  const n = useDimension(kind).data?.length ?? 0, spec = DIM_SPECS[kind], entries = `${n} entr${n === 1 ? 'y' : 'ies'}`;
  const descId = tid.dims.cardDescription(kind);
  return (
    <div className="contents">
      <SetupCardButton testId={tid.dims.card(kind)} icon={ICON[spec.icon]} title={DIMENSIONS[kind].label} sub={entries} count={n} countLabel={entries}
        describedBy={descId} onClick={() => onOpen(kind)} />
      <span id={descId} data-testid={descId} className="sr-only">{spec.desc}</span>
    </div>);
}
function DimensionIndex({ onOpen }: { onOpen(k: DimensionKind): void }) {
  return (<>
    <PageHead title="Dimensions" crumb="Qnipay setup · Dimensions" tipTestId={tid.head.tip('aloc')}
      tip="What every rota entry and timesheet line carries: where the work happened, who owns it, what it is costed to, and who did it." />
    {DIM_GROUPS.map(g => (
      <section key={g.key} className="mt-lg mb-sm border-t pt-sm first-of-type:mt-0">
        <h2 className="mt-lg mb-md text-base">{g.label}<Tip testId={tid.dims.groupTip(g.key)} text={g.note} /></h2>
        <div className="mb-md grid grid-cols-[repeat(auto-fill,minmax(min(100%,320px),1fr))] gap-md">
          {g.kinds.map(k => <DimensionCard key={k} kind={k} onOpen={onOpen} />)}
        </div>
      </section>))}
  </>);
}

function DimensionTable({ kind, onBack }: { kind: DimensionKind; onBack(): void }) {
  const spec = DIM_SPECS[kind], list = useDimension(kind);
  const [form, setForm] = useState<{ row?: InUseRow } | null>(null);
  const cols = spec.fields.filter(f => !f.wide).slice(0, 6);
  const cell = (r: InUseRow, key: string, kindOf: string) => {
    const v = r[key];
    if (kindOf === 'bool') return <Pill testId={tid.dims.cell(r.code, key)} tone={v ? 'ok' : 'neu'} glyph={v ? <Check /> : <Minus />}>{v ? 'Yes' : 'No'}</Pill>;
    return v === '' || v === undefined || v === null ? '—' : String(v);
  };
  return (<>
    <PageHead title={spec.label} crumb={`Qnipay setup · ${spec.label}`} tip={spec.desc} tipTestId={tid.head.tip(`aloc-${kind}`)}
      actions={<>
        <Button testId={tid.dims.back} kind="ghost" small onClick={onBack}>‹ All dimensions</Button>
        <Button testId={tid.dims.add} kind="primary" small onClick={() => setForm({})}>New {DIMENSIONS[kind].singular}</Button></>} />
    {list.isPending && <p className="text-text-secondary">Loading&hellip;</p>}
    {list.isError && <p data-testid={tid.dims.error} role="alert" className="text-err">This list could not be loaded, so nothing here is current. Reload the page.</p>}
    {list.data && list.data.length > 0 && (
      <Table data-testid={tid.dims.table} variant="records" dense>
        <TableHeader><TableRow>
          {cols.map(c => <TableHead key={c.key} className={c.kind === 'number' ? 'text-right' : undefined}>{c.label}</TableHead>)}
          <TableHead className="text-right">In use</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
        </TableRow></TableHeader>
        <TableBody>{list.data.map(r => (
          <Row key={r.id} testId={tid.dims.row(r.code)}>
            {cols.map((c, i) => <TableCell key={c.key} kind={i === 0 ? 'title' : undefined} label={c.label}
              className={c.kind === 'number' ? 'text-right tabular-nums' : c.code ? 'tabular-nums' : undefined}>{cell(r, c.key, c.kind)}</TableCell>)}
            <TableCell label="In use" className="text-right tabular-nums max-md:text-left">{r.inUse}</TableCell>
            <TableCell kind="foot" className="text-right"><Button testId={tid.dims.edit(r.code)} kind="ghost" small onClick={() => setForm({ row: r })}>Edit</Button></TableCell>
          </Row>))}</TableBody>
      </Table>)}
    {list.data?.length === 0 && <Card><Empty testId={tid.dims.empty}>Nothing here yet.</Empty></Card>}
    <Small>In use counts {spec.usedAs}. An entry that is in use cannot be removed.</Small>
    {form && <DimensionForm kind={kind} row={form.row} onClose={() => setForm(null)} />}
  </>);
}
