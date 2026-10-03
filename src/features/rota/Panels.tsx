import { tid } from '@/testids';
import { Banner, Button, Card, CardHead, Empty, Pill, Row, Small, SugCard, SugPanel } from '@/ui';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import { formatDateTime } from '@/lib/format';
import { formatDay } from '@/domain/time';
import { NO_REASONS_WHY, rotaState, shiftName, shiftTime } from '@/domain/rota';
import type { PlanItem, RotaWeekView } from '@/contract/rota';
import { longDay, weekRange } from './week';

/* planPanel (qnipay-workforce-v15.html:7349-7368): the suggested cover, held
   on screen until accepted or dismissed. Nothing reaches the rota until it is
   accepted, and accepting goes through the server's assignment path. */
export function PlanPanel({ view, items, busy, onAccept, onAcceptAll, onAsk, onSkip, onDismiss }: {
  view: RotaWeekView; items: readonly PlanItem[]; busy: boolean;
  onAccept: (i: number) => void; onAcceptAll: () => void; onAsk: (name: string) => void; onSkip: (i: number) => void; onDismiss: () => void;
}) {
  const good = items.map((x, i) => ({ x, i })).filter(({ x }) => !x.none);
  return (
    <SugPanel testId={tid.trota.plan}>
      <div className="mb-md flex flex-wrap items-start gap-md">
        <div>
          <div className="text-xs font-bold tracking-[.08em] text-text-muted">Suggested cover</div>
          <div className="text-sm font-semibold">{good.length} shift{good.length === 1 ? '' : 's'} could be filled now</div>
          <Small>Nothing reaches the rota until you accept it.</Small>
        </div>
        <div className="ml-auto flex gap-sm">
          {good.length > 0 && <Button testId={tid.trota.planAcceptAll} kind="primary" small pending={busy} onClick={onAcceptAll}>Accept all</Button>}
          <Button testId={tid.trota.planDismiss} kind="ghost" small onClick={onDismiss}>Dismiss</Button>
        </div>
      </div>
      {good.map(({ x, i }) => (
        <SugCard key={`${x.day}-${x.code}-${x.personCode}`} testId={tid.trota.planItem(i)} best name={x.name}
          sub={`${shiftName(view.shifts, x.code)} · ${shiftTime(view.shifts, x.code)} · ${longDay(view.weekStart, x.day)}`}
          why={x.why.length ? x.why : [NO_REASONS_WHY]}
          actions={<>
            <Button testId={tid.trota.planAccept(i)} kind="primary" small pending={busy} onClick={() => onAccept(i)}>Accept</Button>
            <Button testId={tid.trota.planAsk(i)} kind="ghost" small onClick={() => onAsk(x.name)}>Ask first</Button>
            <Button testId={tid.trota.planSkip(i)} kind="ghost" small onClick={() => onSkip(i)}>Skip</Button>
          </>} />))}
      {items.some(x => x.none) && <Banner testId={tid.trota.planNone} tone="warn" title="Some gaps have nobody available">
        Every eligible colleague is already working, off, or would breach a hard rule. Advertise those shifts through a cover request instead.</Banner>}
    </SugPanel>);
}

/* rotaHistory (v15:7142-7169): the week's state, its last publication, the
   change log (12 most recent) and recent publications at your locations. */
export function RotaHistory({ view }: { view: RotaWeekView }) {
  const s = rotaState(view.state), ch = view.changes;
  const name = (code: string) => (code ? shiftName(view.shifts, code) || code : '—');
  return (
    <Card testId={tid.trota.history}>
      <CardHead title={`Version history · week ${view.isoWeek}`}
        actions={<Pill tone={s.tone} glyph={s.glyph}>{s.label}{view.publishVersion ? ` · v${view.publishVersion}` : ''}</Pill>} />
      <Small testId={tid.trota.historyNote} className="mb-md">{view.publishedAt
        ? `Last published ${formatDateTime(view.publishedAt)} by ${view.publishedBy?.name ?? ''}. ${view.state === 'amendment'
          ? 'There are unpublished changes below. Republish to make them live.' : 'No changes since.'}`
        : 'Not yet published. Colleagues cannot see these shifts.'}</Small>
      {ch.length ? <>
        <Table>
          <TableHeader><TableRow>
            <TableHead>When</TableHead><TableHead>Who</TableHead><TableHead>Colleague</TableHead><TableHead>Day</TableHead>
            <TableHead>From</TableHead><TableHead>To</TableHead><TableHead>Against</TableHead>
          </TableRow></TableHeader>
          <TableBody>{ch.slice(0, 12).map((c, i) => (
            <Row key={`${c.at}-${c.personCode}-${c.date}-${String(i)}`} testId={tid.trota.change(i)}>
              <TableCell className="text-xs tabular-nums">{formatDateTime(c.at)}</TableCell>
              <TableCell className="text-xs">{c.by.name}</TableCell>
              <TableCell>{c.name}</TableCell>
              <TableCell className="text-xs">{formatDay(c.date)}</TableCell>
              <TableCell className="text-xs">{name(c.from)}</TableCell>
              <TableCell className="text-xs">{name(c.to)}</TableCell>
              <TableCell>{c.afterPublish ? <Pill tone="warn" glyph="✎">published v{c.version}</Pill> : <Pill tone="neu" glyph="—">draft</Pill>}</TableCell>
            </Row>))}</TableBody>
        </Table>
        {ch.length > 12 && <Small testId={tid.trota.changesMore}>Showing the most recent 12 of {ch.length} changes.</Small>}
      </> : <Empty testId={tid.trota.changesEmpty}>No changes recorded against this week yet</Empty>}
      {view.publications.length > 0 && <>
        <div className="mt-[14px] mb-md text-sm font-semibold">Recent publications</div>
        <Table>
          <TableHeader><TableRow>
            <TableHead>Location</TableHead><TableHead>Week</TableHead><TableHead>Published</TableHead>
            <TableHead className="text-right">Version</TableHead><TableHead className="text-right">Notified</TableHead>
          </TableRow></TableHeader>
          <TableBody>{view.publications.slice(0, 6).map((p, i) => (
            <Row key={`${p.location}-${p.weekStart}-${String(p.version)}`} testId={tid.trota.pub(i)}>
              <TableCell>{p.locationName}</TableCell>
              <TableCell className="text-xs">{weekRange(p.weekStart)}</TableCell>
              <TableCell className="text-xs tabular-nums">{formatDateTime(p.at)}</TableCell>
              <TableCell className="text-right tabular-nums">{p.version ? `v${p.version}` : '—'}</TableCell>
              <TableCell className="text-right tabular-nums">{p.notified}</TableCell>
            </Row>))}</TableBody>
        </Table>
      </>}
    </Card>);
}

