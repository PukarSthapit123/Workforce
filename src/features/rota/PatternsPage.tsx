import { useState } from 'react';
import { Repeat } from 'lucide-react';
import { tid } from '@/testids';
import { AdminCard, Button, ConfirmModal, Empty, GuideButton, Page, PageHead, Row, toastInfo } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { ApiError } from '@/api/client';
import { useDimension } from '@/api/reference';
import { useDeletePattern, usePatterns, useRotaHome, useShiftCatalogue, type PatternList, type PatternRecord } from '@/api/rota';
import { genLabel } from '@/domain/rota';
import { NewPatternDialog, PatternEditor, PatternPeopleDialog, activePill, useGenerateRun, type PatternCtx } from './PatternEditor';

/* Working patterns: the prototype's mgrPatternsPage and mgrPatternsBody
   (qnipay-workforce-v15.html:7238-7246, 7119-7141). The patterns that cover
   the manager's location, how many of their people each one carries, and
   from each: open it, add people, or generate the rota. The server scopes
   the list and every write to the manager's location, and Rota setup can
   keep patterns for administrators only (D5). */
type Box = { k: 'edit' | 'people' | 'delete'; code: string; back?: boolean } | { k: 'new' } | null;
const TIP = 'A pattern staffs a repeating cycle. Generating from it writes rota lines forward, skipping cells that are already filled and weeks that are already published.';

export function PatternsPage() {
  const home = useRotaHome(), list = usePatterns(), cat = useShiftCatalogue();
  const locs = useDimension('locations'), jobs = useDimension('job-profiles'), ccs = useDimension('cost-centres');
  const location = home.data?.location ?? '';
  const locName = (c: string) => locs.data?.find(l => l.code === c)?.name ?? home.data?.locations.find(l => l.code === c)?.name ?? c;
  const here = home.data ? locName(location) : '';
  const refused = list.error instanceof ApiError ? list.error.refusal : null;
  const ready = home.data && list.data && cat.data;
  const [box, setBox] = useState<Box>(null);
  return (
    <Page testId={tid.page('tpat')}>
      <PageHead title="Working patterns" crumb={`Rota · Working patterns${here ? ` · ${here}` : ''}`}
        actions={<>
          {ready && <Button testId={tid.tpat.newPattern} kind="primary" small onClick={() => setBox({ k: 'new' })}>New pattern</Button>}
          <GuideButton view="tpat" />
        </>} />
      {(home.isError || list.isError || cat.isError) && <p data-testid={tid.tpat.error} role="alert" className="text-err">
        {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'Working patterns could not be loaded. Reload the page to try again.'}</p>}
      {!ready && !(home.isError || list.isError || cat.isError) && <p data-testid={tid.tpat.loading} className="text-text-secondary">Loading working patterns&hellip;</p>}
      {ready && <Patterns list={list.data} location={location} ctx={{
        shifts: cat.data.items, people: list.data.people, today: home.data.today, canCover: home.data.locations,
        locations: (locs.data ?? home.data.locations).filter(l => !('active' in l) || l.active !== false).map(l => ({ code: l.code, name: l.name })),
        jobs: (jobs.data ?? []).map(j => ({ code: j.code, name: j.name })), costCentres: (ccs.data ?? []).map(c => ({ code: c.code, name: c.name })),
      }} locName={locName} box={box} setBox={setBox} />}
    </Page>);
}

function Patterns({ list, location, ctx, locName, box, setBox }: {
  list: PatternList; location: string; ctx: PatternCtx; locName: (c: string) => string; box: Box; setBox: (b: Box) => void;
}) {
  const gen = useGenerateRun(), del = useDeletePattern();
  const mine = list.items.filter(p => p.locations.includes(location));
  const at = (code: string) => list.items.find(p => p.code === code);
  const hereCount = (p: PatternRecord) => p.people.filter(x => list.people.find(c => c.code === x.personCode)?.location === location).length;
  const close = () => setBox(null);
  const cur = box && 'code' in box ? at(box.code) : undefined;
  return (
    <>
      <AdminCard icon={<Repeat />} title={`Patterns covering ${locName(location)}`} tip={TIP} tipTestId={tid.tpat.cardTip}
        desc="Set the cycle, add people, then generate">
        {mine.length
          ? <Table data-testid={tid.tpat.list}>
              <TableHeader><TableRow>
                <TableHead>Pattern</TableHead><TableHead className="text-right">Cycle</TableHead><TableHead className="text-right">People here</TableHead>
                <TableHead>Generates</TableHead><TableHead>State</TableHead><TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow></TableHeader>
              <TableBody>{mine.map(p => {
                const n = hereCount(p), elsewhere = p.locations.filter(c => c !== location);
                return (
                  <Row key={p.code} testId={tid.tpat.row(p.code)}>
                    <TableCell className="min-w-[220px]"><strong>{p.name}</strong>
                      {elsewhere.length > 0 && <span className="block text-xs text-text-muted">also runs at {elsewhere.map(locName).join(', ')}</span>}</TableCell>
                    <TableCell className="text-right font-mono">{p.cycle}</TableCell>
                    <TableCell className="text-right font-mono">{n}</TableCell>
                    <TableCell className="text-xs text-text-muted">{genLabel(p)}</TableCell>
                    <TableCell>{activePill(p, tid.tpat.state(p.code))}</TableCell>
                    <TableCell className="min-w-[260px] text-right whitespace-nowrap">
                      <span className="inline-flex gap-[6px]">
                        <Button testId={tid.tpat.open(p.code)} kind="ghost" small onClick={() => setBox({ k: 'edit', code: p.code })}>Open</Button>
                        <Button testId={tid.tpat.addPerson(p.code)} kind="ghost" small onClick={() => setBox({ k: 'people', code: p.code })}>Add a person</Button>
                        <Button testId={tid.tpat.generate(p.code)} kind="primary" small disabled={!n} pending={gen.pending(p.code)}
                          title={n ? undefined : `Nobody from ${locName(location)} is on this pattern yet`} onClick={() => gen.run(p)}>Generate</Button>
                      </span></TableCell>
                  </Row>);
              })}</TableBody>
            </Table>
          : <Empty testId={tid.tpat.empty}>No pattern covers {locName(location)} yet</Empty>}
      </AdminCard>
      {box?.k === 'new' && <NewPatternDialog patterns={list.items} ctx={ctx} onClose={close} onCreated={code => setBox({ k: 'edit', code })} />}
      {/* a saved pattern opens again from the server's copy */}
      {box?.k === 'edit' && cur && <PatternEditor key={`${cur.code}:${cur.version}`} pattern={cur} ctx={ctx} onClose={close}
        onAddPeople={() => setBox({ k: 'people', code: cur.code, back: true })} onDelete={() => setBox({ k: 'delete', code: cur.code })} />}
      {box?.k === 'people' && cur && <PatternPeopleDialog pattern={cur} ctx={ctx}
        onClose={() => setBox(box.back ? { k: 'edit', code: cur.code } : null)} />}
      {box?.k === 'delete' && cur && <ConfirmModal open onOpenChange={o => { if (!o) setBox({ k: 'edit', code: cur.code }); }}
        title={`Delete ${cur.name}?`} confirmLabel="Delete the pattern" danger busy={del.anyPending}
        body={`Shifts already generated and published stay on the rota. Nothing further will be generated from this pattern, and ${
          cur.people.length ? `${cur.people.length} person(s) will no longer be scheduled by it.` : 'nobody is currently on it.'}`}
        onConfirm={() => del.mutate(cur, { onSuccess: () => { close(); toastInfo(`${cur.name} deleted`, 'Published shifts are untouched.'); } })} />}
    </>);
}
