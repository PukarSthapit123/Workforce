import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { tid } from '@/testids';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/ui/shadcn/table';
import {
  Avatar, Button, Empty, FilterBar, GuideButton, Page, PageHead, Pill, Row, SearchFilter, SelectFilter, Stat, Stats, Tip, toastInfo, toastRefusal,
} from '@/ui';
import { cn } from '@/lib/utils';
import { downloadText, toCsv } from '@/lib/download';
import { useExportTeamHours, useTeamHours, type TeamHours, type TeamHoursRow } from '@/api/hours';
import {
  DOWNLOAD_BLOCKED, cellHours, exportedText, flagWarns, footHours, hoursText, isBank, teamTotals, varianceTone,
} from '@/domain/hours';
import { VARIANCE_CLASS } from './variance';

/* Team hours (Hours position): the prototype's mgrHours (qnipay-workforce-v15.html:7719-7748).
   One row per colleague on the location's roster this week: contracted,
   rota'd and worked side by side, both variances and the flags. The location
   picker lists the locations the reader may look at; Export saves a real CSV
   file of the location's week, which the server audits, and the toast gives
   the number of rows in it. */
export function TeamHoursPage() {
  const [location, setLocation] = useState('');
  const q = useTeamHours(location);
  return (
    <Page testId={tid.page('thours')}>
      {q.data
        ? <TeamView t={q.data} onLocation={setLocation} />
        : <>
          <PageHead title="Hours position" crumb="My team · Hours position" />
          {q.isError
            ? <p data-testid={tid.thours.error} role="alert" className="text-err">The hours position could not be loaded. Reload the page to try again.</p>
            : <p data-testid={tid.thours.loading} className="text-text-secondary">Loading the hours position&hellip;</p>}
        </>}
    </Page>);
}

const FLAGS_TIP = 'Overtime, over or under contracted, over maximum, rest warnings, consecutive days and night work.';

function TeamView({ t, onLocation }: { t: TeamHours; onLocation: (code: string) => void }) {
  const [search, setSearch] = useState('');
  const exp = useExportTeamHours();
  const s = search.trim().toLowerCase();
  const rows = t.rows.filter(r => !s || `${r.name} ${r.personCode}`.toLowerCase().includes(s));
  const tot = teamTotals(rows);
  const doExport = () => exp.mutate({ location: t.location.code }, { onSuccess: x => {
    if (downloadText(x.fileName, toCsv(x.rows))) toastInfo(exportedText(x.count, x.fileName));
    else toastRefusal(DOWNLOAD_BLOCKED);
  } });
  return (
    <>
      <PageHead title="Hours position" crumb="My team · Hours position" actions={<>
        <SelectFilter testId={tid.thours.location} label="Location" value={t.location.code} options={t.locations.map(l => ({ value: l.code, label: l.name }))}
          onValueChange={code => { if (code !== t.location.code) { onLocation(code); toastInfo(`Now working in ${t.locations.find(l => l.code === code)?.name ?? code}`); } }} />
        <Button testId={tid.thours.export} kind="ghost" small pending={exp.anyPending} onClick={doExport}>Export</Button>
        <GuideButton view="thours" />
      </>} />
      <Stats>
        <Stat label="Contracted" testId={tid.thours.contracted} foot={`${tot.contracted} contracted colleague${tot.contracted === 1 ? '' : 's'}`}>{hoursText(tot.con)}</Stat>
        <Stat label="Rota’d" testId={tid.thours.rotad} foot={t.rota ? `${footHours(tot.rotaVar)} against contract` : 'the rota is not in use'}>
          {t.rota ? hoursText(tot.rot) : '—'}</Stat>
        <Stat label="Worked" testId={tid.thours.worked} foot={t.rota ? `${footHours(tot.workVar)} against the rota` : 'this week'}>{hoursText(tot.wk)}</Stat>
        <Stat label="Discrepancies to check" testId={tid.thours.discrepancies} tone={tot.anyError ? 'bad' : 'good'}>{tot.discrepancies}</Stat>
      </Stats>
      <FilterBar>
        <SearchFilter testId={tid.thours.search} label="Search colleague" placeholder="Search colleague" value={search} onChange={e => setSearch(e.target.value)} />
      </FilterBar>
      <Table variant="records" dense data-testid={tid.thours.table}>
        <TableHeader><TableRow>
          <TableHead>Employee</TableHead><TableHead className="text-right">Contracted</TableHead><TableHead className="text-right">Rota’d</TableHead>
          <TableHead className="text-right">Worked</TableHead><TableHead className="text-right">Rota variance</TableHead>
          <TableHead className="text-right">Worked variance</TableHead>
          <TableHead><span className="inline-flex items-center">Flags<Tip testId={tid.thours.flagsTip} text={FLAGS_TIP} /></span></TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {!rows.length && <Row testId={tid.thours.empty}><TableCell colSpan={7}>
            <Empty>{s ? 'Nothing matches that search' : `Nobody is on the roster at ${t.location.name} this week`}</Empty></TableCell></Row>}
          {rows.map(r => <PersonRow key={r.personCode} r={r} rota={t.rota} />)}
        </TableBody>
      </Table>
    </>);
}

function PersonRow({ r, rota }: { r: TeamHoursRow; rota: boolean }) {
  const p = r.position, bank = isBank(r.contractedHours);
  const tone = (v: number) => VARIANCE_CLASS[varianceTone(v)];
  return (
    <Row testId={tid.thours.row(r.personCode)}>
      <TableCell kind="title">
        <span className="flex items-center gap-[9px]">
          <Avatar name={r.name} />
          <span><strong className="font-semibold">{r.name}</strong><span className="block font-mono text-xs text-text-muted">{r.personCode} · {r.category}</span></span>
        </span>
      </TableCell>
      <TableCell label="Contracted" className="text-right tabular-nums">{bank ? '—' : hoursText(r.contractedHours)}</TableCell>
      <TableCell label="Rota’d" className="text-right tabular-nums">{rota ? hoursText(p.rot) : '—'}</TableCell>
      <TableCell label="Worked" className="text-right tabular-nums">{hoursText(p.wk)}</TableCell>
      <TableCell label="Rota variance" data-testid={tid.thours.rotaVar(r.personCode)}
        className={cn('text-right tabular-nums', rota && !bank && tone(p.rotaVar))}>{rota && !bank ? cellHours(p.rotaVar) : '—'}</TableCell>
      <TableCell label="Worked variance" data-testid={tid.thours.workVar(r.personCode)}
        className={cn('text-right tabular-nums', tone(bank ? p.wk : p.workVar))}>{bank ? hoursText(p.wk) : cellHours(p.workVar)}</TableCell>
      <TableCell label="Flags">
        <span data-testid={tid.thours.flags(r.personCode)} className="inline-flex flex-wrap gap-[2px]">
          {p.flags.length
            ? p.flags.map(f => <Pill key={f.k} tone={f.c} glyph={flagWarns(f) ? <TriangleAlert /> : undefined}>{f.k}</Pill>)
            : <Pill tone="ok" glyph="✓">Clear</Pill>}
        </span>
      </TableCell>
    </Row>);
}

