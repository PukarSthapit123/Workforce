import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useNavigate } from 'react-router';
import { tid } from '@/testids';
import {
  Button, Card, CardHead, ChipButton, Count, Empty, Field, FieldGrid, FilterBar, GroupLabel, NavLink, Page, PageHead, Pill, RuledOutList, RuledOutRow,
  SearchFilter, SectionHead, SelectBox, SelectFilter, Small, SugCard, Tip, toastInfo,
} from '@/ui';
import { buttonVariants } from '@/ui/shadcn/button';
import {
  useAskAllCover, useAssignCover, useCellSuggestions, useConfirmFilled, useCoverBoard, useCoverReason, useEscalateCover, useFillCover, useRotaHome, useRotaWeek,
  type CoverBoard, type CoverStatus, type CoverView, type FilledView,
} from '@/api/rota';
import { useCaps } from '@/shell/useCaps';
import { formatDateTime } from '@/lib/format';
import { DOW_SHORT, dowMon, formatDay, parseIso, periodStart } from '@/domain/time';
import { COVER_REASONS, NO_REASONS_WHY, askFirstText } from '@/domain/rota';
import type { FulfilStage, PlanItem } from '@/contract/rota';
import { AdhocDialog } from './Dialogs';

/* Cover requests: the prototype's mgrCover and sugBlock (qnipay-workforce-v15.html:
   7386-7450). The fulfilment stages in force, then each open request: why it
   needs filling, who has been asked, who could take it and who is ruled out,
   and the moves a manager makes (give it to someone, ask everyone, escalate).
   Stages move only when a manager acts (D7); there is no clock, and messaging
   is simulated, as the prototype says. Giving the shift to someone writes the
   rota through the same path as an assignment (D15); confirming it was worked
   raises an IT access request while that is switched on. */
const SIMULATED = 'Messaging is simulated in this build. No message is sent.';
const STATUSES: readonly { value: CoverStatus; label: string }[] = [{ value: 'all', label: 'All' }, { value: 'urgent', label: 'Urgent' }, { value: 'filled', label: 'Filled' }];
const longDate = (iso: string) => `${formatDay(iso)} ${parseIso(iso).getUTCFullYear()}`;

export function CoverPage() {
  const home = useRotaHome();
  const [status, setStatus] = useState<CoverStatus>('all');
  const [q, setQ] = useState('');
  const [loc, setLoc] = useState('all');
  const [adhoc, setAdhoc] = useState(false);
  const board = useCoverBoard(status);
  const week = useRotaWeek(home.data?.location ?? '', home.data?.weekStart ?? '', adhoc && !!home.data);
  const navigate = useNavigate();
  const caps = useCaps();
  const b = board.data;
  const at = (x: { location: string }) => loc === 'all' || x.location === loc;
  const hit = (c: CoverView) => {
    const s = q.trim().toLowerCase();
    return !s || [DOW_SHORT[dowMon(c.date)] ?? '', String(parseIso(c.date).getUTCDate()), c.reason, c.shiftName].some(x => x.toLowerCase().includes(s));
  };
  const open = b && status !== 'filled' ? b.requests.filter(c => c.open && at(c) && hit(c)) : [];
  const filled = b ? b.filled.filter(at) : [];
  const toConfirm = filled.filter(f => !f.confirmed).length;
  const locations = home.data?.locations ?? [];
  return (
    <Page testId={tid.page('tcover')}>
      <PageHead title="Cover requests" crumb="My team · Cover requests" tipTestId={tid.tcover.tip}
        tip="Opens on its own when a shift drops below the minimum. Each stage is configurable and moves on when you act, escalating to the Service Manager."
        actions={<>
          {locations.length > 1 && <SelectFilter testId={tid.tcover.location} label="Location" value={loc} onValueChange={setLoc}
            options={[{ value: 'all', label: 'All locations' }, ...locations.map(l => ({ value: l.code, label: l.name }))]} />}
          <Button testId={tid.tcover.adhoc} kind="ghost" small disabled={!home.data} onClick={() => setAdhoc(true)}>Add an extra shift</Button>
        </>} />
      {(board.isError || home.isError) && <p data-testid={tid.tcover.error} role="alert" className="text-err">Cover requests could not be loaded. Reload the page to try again.</p>}
      {!b && !board.isError && <p data-testid={tid.tcover.loading} className="text-text-secondary">Loading cover requests&hellip;</p>}
      {b && <>
        <Stages stages={b.stages} configure={caps.has('mod_cfg')} />
        <FilterBar>
          <SearchFilter testId={tid.tcover.search} label="Search day or reason" placeholder="Search day or reason" value={q} onChange={e => setQ(e.target.value)} />
          {STATUSES.map(s => <ChipButton key={s.value} testId={tid.tcover.filter(s.value)} on={status === s.value} onClick={() => setStatus(s.value)}>{s.label}</ChipButton>)}
          <Count testId={tid.tcover.count}>{b.counts.all} open · {toConfirm} to confirm</Count>
        </FilterBar>
        {open.length
          ? open.map(c => <Request key={`${c.id}:${c.version}`} c={c} stages={b.stages} />)
          : <Card><Empty testId={tid.tcover.empty}>Nothing needs filling</Empty></Card>}
        {filled.length > 0 && <SectionHead title="Filled" />}
        {filled.map(f => <Filled key={f.id} f={f} board={b} />)}
      </>}
      {adhoc && week.data && <AdhocDialog view={week.data} onClose={() => setAdhoc(false)}
        onPlan={(items: PlanItem[]) => { void navigate('/team/trota', { state: { plan: items } }); }} />}
    </Page>);
}

/* The fulfilment workflow in force (.stagerow, v15:1530-1536). */
function Stages({ stages, configure }: { stages: readonly FulfilStage[]; configure: boolean }) {
  return (
    <Card testId={tid.tcover.stages}>
      <CardHead title={<span className="flex items-center">Fulfilment workflow in force
        <Tip testId={tid.tcover.stagesTip} text="Configured in Rota setup. Every audience, wait and channel below is a setting, not a fixed rule." /></span>}
        actions={configure ? <NavLink testId={tid.tcover.configure} to="/setup/mrota" className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Configure</NavLink> : undefined} />
      {stages.map(s => (
        <div key={s.n} data-testid={tid.tcover.stage(s.n)}
          className="grid grid-cols-[44px_1fr_92px_1fr_1fr] items-center gap-sm border-b py-[9px] last:border-b-0 max-md:grid-cols-[34px_1fr] max-md:gap-y-xs">
          <span className="grid size-[26px] place-items-center rounded-full bg-surface-tint text-xs font-bold">{s.n}</span>
          <strong className="text-sm">{s.audience}</strong>
          <span className="font-mono text-xs text-text-muted">{s.wait} min</span>
          <span className="text-xs text-text-muted">{s.channel}</span>
          <span className="text-xs text-text-muted">→ {s.next}</span>
        </div>))}
    </Card>);
}

function Request({ c, stages }: { c: CoverView; stages: readonly FulfilStage[] }) {
  const reason = useCoverReason(), askAll = useAskAllCover(), escalate = useEscalateCover(), fill = useFillCover();
  const key = `rota/cover/${c.id}`;
  const busy = reason.isPending(key) || askAll.isPending(key) || escalate.isPending(key) || fill.isPending(key);
  const last = stages[stages.length - 1];
  return (
    <Card testId={tid.tcover.request(c.id)}>
      <div className="flex flex-wrap items-start gap-md">
        <div>
          <div className="flex flex-wrap items-center gap-sm text-sm font-semibold">{c.shiftName} · {formatDay(c.date)}
            {c.urgent && <Pill testId={tid.tcover.urgent(c.id)} tone="err" glyph={<TriangleAlert aria-hidden="true" />}>Urgent</Pill>}</div>
          <Small>{c.time} · {c.locationName} · stage {c.stage} of {stages.length} · opened {formatDateTime(c.openedAt)}</Small>
        </div>
        <div className="ml-auto"><Pill tone="warn" glyph="◷">Waiting</Pill></div>
      </div>
      <div className="mt-[14px]">
        <FieldGrid>
          <Field label="Why this shift needs filling" hint="Needed before anyone is asked, and used in your cover reporting.">
            <SelectBox testId={tid.tcover.reason(c.id)} placeholder="Choose a reason" value={c.reason || undefined} disabled={busy}
              options={COVER_REASONS.map(r => ({ value: r, label: r }))}
              onValueChange={r => { if (r !== c.reason) reason.mutate({ cover: c, reason: r }, { onSuccess: () =>
                toastInfo(`Reason saved. Eligible colleagues at ${c.locationName} are asked first.`, SIMULATED) }); }} />
          </Field>
          <div>
            <div className="mb-[5px] flex items-center text-xs font-semibold text-text-secondary">Who has been asked
              <Tip testId={tid.tcover.askedTip(c.id)} text="Favourites get a head start. Anyone not cleared to work is never asked." /></div>
            <div className="text-sm">{c.asked}</div>
            <Small className="mt-xs">{c.next}</Small>
            {c.log.length > 0 && <Small testId={tid.tcover.log(c.id)} className="mt-sm">
              {c.log.map(l => <span key={`${l.stage}-${l.at}`} className="block">Stage {l.stage} · {formatDateTime(l.at)} · {l.audience} · {l.channel} · {l.sent} notified</span>)}</Small>}
          </div>
        </FieldGrid>
      </div>
      {c.reason
        ? <Suggestions c={c} wait={stages[0]?.wait ?? 0} />
        : <Small testId={tid.tcover.noReason(c.id)} className="mt-md">Choose a reason to see suggestions.</Small>}
      <div className="mt-[14px] flex flex-wrap gap-sm">
        <Button testId={tid.tcover.fill(c.id)} kind="primary" small pending={busy} onClick={() => fill.mutate(c, { onSuccess: r => toastInfo(r.summary) })}>Someone has taken it</Button>
        <Button testId={tid.tcover.askAll(c.id)} kind="ghost" small pending={busy}
          onClick={() => askAll.mutate(c, { onSuccess: () => toastInfo('Asked every cleared worker whose alerts and eligibility match.', SIMULATED) })}>Ask everyone now</Button>
        <Button testId={tid.tcover.escalate(c.id)} kind="ghost" small pending={busy}
          onClick={() => escalate.mutate(c, { onSuccess: () => toastInfo(`Escalated to the ${last?.audience ?? 'last stage'}.`, SIMULATED) })}>Escalate for agency cover</Button>
      </div>
    </Card>);
}

/* sugBlock (v15:7437-7450): the eligible people best first with their
   reasons, and who is ruled out by which rule. The ruled-out list is the
   week's own cell suggestions for that day and shift. */
function Suggestions({ c, wait }: { c: CoverView; wait: number }) {
  const assign = useAssignCover();
  const cell = useCellSuggestions(c.location, periodStart(c.date), dowMon(c.date), c.shift);
  const no = cell.data?.no ?? [];
  const ruled = (label: string) => no.length > 0 && <RuledOutList label={label}>
    {no.slice(0, 6).map(x => <RuledOutRow key={x.personCode} testId={tid.tcover.ruled(c.id, x.personCode)} name={x.name} why={`${x.rule}: ${x.reason}`} />)}
  </RuledOutList>;
  if (!c.suggestions.length) return (
    <div data-testid={tid.tcover.nobody(c.id)} className="mt-md border-t border-dashed pt-md">
      <GroupLabel>Nobody available · {no.length} ruled out</GroupLabel>
      {no.slice(0, 6).map(x => <RuledOutRow key={x.personCode} testId={tid.tcover.ruled(c.id, x.personCode)} name={x.name} why={`${x.rule}: ${x.reason}`} />)}
    </div>);
  return (
    <div className="mt-lg">
      <div className="mb-sm flex items-center text-xs font-semibold text-text-secondary">Suggested
        <Tip testId={tid.tcover.sugTip(c.id)} text="Eligibility is a hard rule and is checked first. The ranking only orders the people who already passed it." /></div>
      {c.suggestions.slice(0, 3).map((x, i) => (
        <SugCard key={x.personCode} testId={tid.tcover.sug(c.id, x.personCode)} best={i === 0} name={x.name} sub={x.category}
          why={x.why.length ? x.why : [NO_REASONS_WHY]}
          actions={<>
            <Button testId={tid.tcover.assign(c.id, x.personCode)} kind={i === 0 ? 'primary' : 'ghost'} small pending={assign.anyPending}
              onClick={() => assign.mutate({ cover: c, personCode: x.personCode }, { onSuccess: r => toastInfo(r.summary) })}>Assign</Button>
            <Button testId={tid.tcover.askFirst(c.id, x.personCode)} kind="ghost" small
              onClick={() => toastInfo(askFirstText(x.name.split(' ')[0] ?? x.name, wait))}>Ask first</Button>
          </>} />))}
      {ruled('Not eligible, and why')}
    </div>);
}

function Filled({ f, board }: { f: FilledView; board: CoverBoard }) {
  const confirm = useConfirmFilled();
  return (
    <Card testId={tid.tcover.filled(f.id)}>
      <div className="flex flex-wrap items-start gap-md">
        <div>
          <div className="text-sm font-semibold">{longDate(f.date)} · {f.shiftName} · filled</div>
          <Small>Taken by {f.name} · <span className="font-mono">{f.personCode}</span> · {f.time} · {f.locationName}</Small>
          {f.itRequest && <div className="mt-xs"><Pill testId={tid.tcover.it(f.id)} tone="ok" glyph="✓">IT access request {f.itRequest}</Pill></div>}
        </div>
        <div className="ml-auto flex items-center">
          {f.confirmed
            ? <Pill testId={tid.tcover.confirmed(f.id)} tone="ok" glyph="✓">Confirmed</Pill>
            : <><Button testId={tid.tcover.confirm(f.id)} kind="primary" small pending={confirm.isPending(`rota/filled/${f.id}`)}
                  onClick={() => confirm.mutate(f, { onSuccess: r => toastInfo(r.summary) })}>Confirm it was worked</Button>
                <Tip testId={tid.tcover.confirmTip(f.id)} text={board.itAccess
                  ? 'Closes the request and raises an IT access request carrying the employee ID, location and shift so site access can be set up.'
                  : 'Closes the request.'} /></>}
        </div>
      </div>
    </Card>);
}
