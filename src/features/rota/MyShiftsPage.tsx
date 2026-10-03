import { useNavigate } from 'react-router';
import { tid } from '@/testids';
import { Button, Card, EssBig, EssButton, EssCard, EssCols, EssRow, GuideButton, Page, PageHead, Pill, Tip, WhyList, toastInfo, toastRefusal } from '@/ui';
import { ApiError } from '@/api/client';
import { useClaimShift, useMyShifts, type MyShifts, type OpenShift } from '@/api/rota';
import { useCaps } from '@/shell/useCaps';
import { DOW_SHORT, addDays, dowMon, formatDay, formatDmy, parseIso } from '@/domain/time';

/* My shifts: the prototype's essShifts and openShiftsFor
   (qnipay-workforce-v15.html:5487-5530), for an employee and for a manager's
   own record. The next shift, this week's shifts and hours, the rest days,
   and the open shifts this person may claim, which the server has already
   filtered through the safe-worker rules. A week shows only once it has been
   published (D14): the prototype showed the working week whatever its state,
   which put a manager's unpublished plan in front of employees. */
const dayNum = (iso: string) => `${DOW_SHORT[dowMon(iso)] ?? ''} ${parseIso(iso).getUTCDate()}`;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

export function MyShiftsPage() {
  const q = useMyShifts();
  const refused = q.error instanceof ApiError ? q.error.refusal : null;
  const m = q.data;
  return (
    <Page testId={tid.page('shifts')}>
      <PageHead title="My shifts" crumb={`My work · Shifts${m ? ` · ${m.person.locationName} · ${formatDmy(m.weekStart)} – ${formatDmy(addDays(m.weekStart, 6))}` : ''}`}
        actions={<GuideButton view="shifts" />} />
      {q.isError && <p data-testid={tid.shifts.error} role="alert" className="text-err">
        {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'Your shifts could not be loaded. Reload the page to try again.'}</p>}
      {!m && !q.isError && <p data-testid={tid.shifts.loading} className="text-text-secondary">Loading your shifts&hellip;</p>}
      {m && <Shifts m={m} />}
    </Page>);
}

function Shifts({ m }: { m: MyShifts }) {
  const caps = useCaps(), navigate = useNavigate();
  const claim = useClaimShift();
  const next = m.next;
  const whoOn = () => {
    if (!next) { toastInfo('No further shifts this week'); return; }
    toastInfo(next.with.length ? `${next.with.join(' and ')} ${next.with.length === 1 ? 'is' : 'are'} on with you` : 'You are the only one on that shift');
  };
  return (
    <>
      {/* the web-only strip (.card.wide-only): how far ahead is published, Outlook, the team rota */}
      <Card className="max-md:hidden">
        <div className="flex flex-wrap items-center gap-sm">
          <div data-testid={tid.shifts.published} className="text-sm font-semibold">
            Published to {m.publishedTo ? formatDmy(m.publishedTo) : '—'}
            <Tip testId={tid.shifts.publishedTip} text={`Shifts appear as soon as your manager publishes them, up to ${m.horizon} months ahead.`} /></div>
          <div className="ml-auto flex flex-wrap items-center gap-sm">
            {m.outlook && <Button testId={tid.shifts.outlook} kind="ghost" small
              onClick={() => toastRefusal({ message: 'Calendar sync is not built yet. No Outlook integration exists in this build.', next: 'Your shifts are here on My shifts.' })}>
              Add to Outlook</Button>}
            <Button testId={tid.shifts.teamRota} kind="ghost" small onClick={() => {
              if (caps.has('team_rota')) navigate('/team/trota');
              else toastInfo('Your team rota is visible from My shifts in the full build');
            }}>See the team rota</Button>
          </div>
        </div>
      </Card>

      <EssCols testId={tid.shifts.cards}>
        {m.visible && next
          ? <EssCard testId={tid.shifts.next} dark label={`Next shift · ${next.date === m.today ? 'today' : DOW_SHORT[dowMon(next.date)] ?? ''}`}>
              <EssBig testId={tid.shifts.nextWhen}>{formatDay(next.date)} · {next.time}</EssBig>
              <div className="mt-[2px] text-xs opacity-85">{next.name} · {next.hours} hours · {m.person.locationName}</div>
            </EssCard>
          : <EssCard testId={tid.shifts.next} label="Next shift">
              <div className="text-xs text-text-muted">{m.visible ? 'Nothing further scheduled this week.' : 'Not published yet.'}</div>
            </EssCard>}

        <EssCard testId={tid.shifts.week}
          label={<span data-testid={tid.shifts.weekHead}>{m.visible ? `This week · ${plural(m.days.length, 'shift')} · ${m.hours} hours` : 'This week'}</span>}>
          {!m.visible
            ? <div data-testid={tid.shifts.notPublished} className="text-xs text-text-muted">
                Not published yet. Your shifts for this week appear here once your manager publishes the rota.</div>
            : m.days.length
              ? m.days.map(d => (
                  <EssRow key={d.date} testId={tid.shifts.day(d.date)}>
                    <span><strong>{dayNum(d.date)}</strong> · {d.name}</span><span className="text-xs text-text-muted">{d.time}</span>
                  </EssRow>))
              : <div data-testid={tid.shifts.noShifts} className="text-xs text-text-muted">No shifts this week</div>}
        </EssCard>

        <EssCard testId={tid.shifts.rest} label="Rest days">
          <EssRow>
            <span>{m.visible ? (m.restDays.map(dayNum).join(', ') || 'None this week') : 'Not published yet'}</span>
            <Pill tone="neu" glyph="–">Off</Pill>
          </EssRow>
        </EssCard>

        {m.openShifts.length > 0 && (
          <EssCard testId={tid.shifts.open}
            label={<>Open shifts you can claim<Tip testId={tid.shifts.openTip} text="Only shifts you are cleared and qualified for, that do not clash with hours you are already working." /></>}>
            {m.openShifts.map(o => <Offer key={o.id} o={o} canClaim={m.canClaim} pending={claim.isPending(`rota/cover/${o.id}`)}
              onClaim={() => claim.mutate(o, { onSuccess: r => toastInfo(r.summary) })} />)}
          </EssCard>)}

        <EssButton testId={tid.shifts.whoOn} onClick={whoOn}>Who is on my next shift</EssButton>
      </EssCols>
    </>);
}

/* .sug for an open shift: the day and shift, its time and place, Urgent, Claim, and why it is offered. */
function Offer({ o, canClaim, pending, onClaim }: { o: OpenShift; canClaim: boolean; pending: boolean; onClaim: () => void }) {
  return (
    <div data-testid={tid.shifts.offer(o.id)} className="mb-sm rounded-card border bg-surface-card px-lg py-md">
      <div className="flex flex-wrap items-center gap-[10px]">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{formatDay(o.date)} · {o.shiftName}</div>
          <div className="text-xs text-text-muted">{o.time} · {o.locationName}
            {o.urgent && <> · <Pill testId={tid.shifts.urgent(o.id)} tone="err" glyph="⚠">Urgent</Pill></>}</div>
        </div>
        <span className="ml-auto flex flex-wrap gap-[6px]">
          {canClaim
            ? <Button testId={tid.shifts.claim(o.id)} kind="primary" small pending={pending} onClick={onClaim}>Claim</Button>
            : <Pill testId={tid.shifts.notPermitted(o.id)} tone="neu" glyph="–">Not permitted</Pill>}
        </span>
      </div>
      <WhyList items={[o.why]} />
    </div>);
}
