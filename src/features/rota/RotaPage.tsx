import { useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import { CircleCheck } from 'lucide-react';
import { tid } from '@/testids';
import {
  Banner, Button, Count, FilterBar, GuideButton, Page, PageHead, SearchFilter, SelectFilter, ChipButton, toastInfo, toastRefusal,
} from '@/ui';
import {
  useAcceptPlan, useCopyWeek, useMoveWeek, useRotaHome, useRotaPlan, useRotaWeek, useWriteCell, type CellSaved, type RotaRow, type RotaWeekView,
} from '@/api/rota';
import { useCaps } from '@/shell/useCaps';
import { MONTH_SHORT, addDays, daysBetween, parseIso } from '@/domain/time';
import { OVER_MAXIMUM_NOTE, clearProblem, gapBannerText, isAbsence, overMaximumText, shiftBy, shiftName, shiftTime } from '@/domain/rota';
import type { PlanItem } from '@/contract/rota';
import { Palette } from './Palette';
import { DayView, RotaGrid } from './RotaGrid';
import { PlanPanel, RotaHistory } from './Panels';
import { WeekBar } from './WeekBar';
import { AddShiftDialog, AdhocDialog, ClearDialog, GapDialog, HorizonDialog, RepeatDialog, ShiftDialog, askFirst } from './Dialogs';
import { NO_FILTERS, dow, filterRows, overCap, shortDay, type RotaFilters } from './week';

/* Team rota: the prototype's mgrRota (qnipay-workforce-v15.html:7071-7106).
   The page opens on the manager's own location and the server's week (rota
   home), then reads that location's week: lines, coverage, hours, state and
   history in one call. Nothing on screen changes until the server has
   answered; every assignment (drag, keyboard, tap, the picker, a suggestion,
   the plan) goes through one write path, which runs eligibility on the server
   and turns a change to a live week into an amendment. */
/* Cover requests' Add an extra shift hands its suggestion over in the route state. */
const planFrom = (state: unknown): PlanItem[] | null => {
  const plan = state && typeof state === 'object' && 'plan' in state ? state.plan : null;
  return Array.isArray(plan) && plan.length ? (plan as PlanItem[]) : null;
};

export function RotaPage() {
  const home = useRotaHome();
  const sent = planFrom(useLocation().state);
  const [loc, setLoc] = useState<string | null>(null);
  const [ws, setWs] = useState<string | null>(null);
  const location = loc ?? home.data?.location ?? '';
  const weekStart = ws ?? home.data?.weekStart ?? '';
  const q = useRotaWeek(location, weekStart, !!weekStart);
  /* while another week loads, the one on screen stays (placeholder data); a new location starts afresh */
  const view = q.data && q.data.location.code === location ? q.data : undefined;
  const failed = home.isError || q.isError;
  return (
    <>
      {view && home.data && <Board key={location} view={view} loading={view.weekStart !== weekStart} thisWeek={home.data.weekStart}
        initialPlan={location === home.data.location && view.weekStart === home.data.weekStart ? sent : null} onLocation={setLoc} onWeek={setWs} />}
      {!view && (
        <Page testId={tid.page('trota')}>
          <PageHead title="Team rota" crumb="My team · Team rota" />
          {failed
            ? <p data-testid={tid.trota.error} role="alert" className="text-err">The rota could not be loaded. Reload the page to try again.</p>
            : home.data && !home.data.location
              ? <p data-testid={tid.trota.error} role="alert" className="text-text-secondary">There is no location you can build a rota for.</p>
              : <p data-testid={tid.trota.loading} className="text-text-secondary">Loading the rota&hellip;</p>}
        </Page>)}
    </>);
}

type Box = { k: 'add' | 'shift'; person: string; day: number } | { k: 'gap'; day: number } | { k: 'clear' | 'repeat' | 'horizon' | 'adhoc' } | null;
const LEAVE_NOTE = 'Annual leave. Change it on Team leave, and the rota follows.';
const SICK_NOTE = 'Sickness. Change it on the Sickness tab.';

function Board({ view, loading, thisWeek, initialPlan, onLocation, onWeek }: {
  view: RotaWeekView; loading: boolean; thisWeek: string; initialPlan: PlanItem[] | null; onLocation: (code: string) => void; onWeek: (weekStart: string) => void;
}) {
  const caps = useCaps();
  const [filters, setFilters] = useState<RotaFilters>(NO_FILTERS);
  const [day, setDay] = useState(() => (view.today >= view.weekStart && view.today <= addDays(view.weekStart, 6) ? daysBetween(view.weekStart, view.today) : 0));
  const [plan, setPlan] = useState<PlanItem[] | null>(initialPlan);
  const [lifted, setLifted] = useState<string | null>(null);
  const [box, setBox] = useState<Box>(null);
  const write = useWriteCell(), move = useMoveWeek(), copy = useCopyWeek(), accept = useAcceptPlan();
  const planQ = useRotaPlan(view.location.code, view.weekStart, false);
  const ref = { location: view.location.code, weekStart: view.weekStart, version: view.version };
  const shifts = view.shifts, rows = filterRows(view.rows, filters), close = () => setBox(null);
  const rowOf = (code: string) => view.rows.find(r => r.personCode === code);
  /* a suggestion, an open dialog and a picked-up shift belong to the week they were made on */
  const goWeek = (w: string) => { setPlan(null); setBox(null); setLifted(null); onWeek(w); };

  /* Escape puts a picked-up shift back (v15:13218-13220). */
  useEffect(() => {
    if (!lifted) return;
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setLifted(null); };
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [lifted]);

  /* assignShift (v15:7188-7204): the one assignment path. The server checks
     leave and sickness, the same shift, and eligibility, and refuses with the
     rule's text; advisories come back with the saved week and never block. */
  const advisory = (r: Pick<CellSaved, 'advisories'>) =>
    (r.advisories.length ? `Advisory only: ${r.advisories.map(a => a.k.toLowerCase()).join(', ')}. Hours warnings do not block publishing.` : undefined);
  const assign = (personCode: string, d: number, code: string, why: string, after?: () => void) => {
    const name = rowOf(personCode)?.name ?? personCode;
    write.mutate({ ...ref, body: { personCode, day: d, code, why } }, { onSuccess: r => {
      after?.();
      toastInfo(`${shiftName(shifts, code)} → ${name} · ${shortDay(view.weekStart, d)} · ${shiftTime(shifts, code)}`, advisory(r));
    } });
  };
  const lift = (code: string, keyboard: boolean) => {
    const name = shiftName(shifts, code);
    if (lifted === code) { setLifted(null); toastInfo(`Put ${name} down`); return; }
    setLifted(code);
    toastInfo(`${name} picked up · ${keyboard ? 'choose a rota cell and press Enter' : 'tap a rota cell to place it'}`);
  };
  const onCell = (r: RotaRow, d: number, keyboard: boolean) => {
    if (lifted) {
      const code = lifted;
      setLifted(null);
      assign(r.personCode, d, code, keyboard ? 'Assigned by keyboard' : 'Assigned by touch');
      return;
    }
    const code = r.line[d] ?? '';
    if (isAbsence(code)) { toastInfo(code === 'V' ? LEAVE_NOTE : SICK_NOTE); return; }
    setBox({ k: shiftBy(shifts, code) ? 'shift' : 'add', person: r.personCode, day: d });
  };

  const suggestCover = () => {
    void planQ.refetch().then(res => {
      if (!res.data) return;
      setPlan(res.data.items.length ? res.data.items : null);
      toastInfo(res.data.summary);
    });
  };
  const acceptItems = (items: PlanItem[], after: () => void, said: (summary: string) => string) => {
    const good = items.filter(x => !x.none);
    if (!good.length) return;
    accept.mutate({ ...ref, body: { items: good.map(x => ({ personCode: x.personCode, day: x.day, code: x.code })) } },
      { onSuccess: r => { after(); toastInfo(said(r.summary), advisory(r)); } });
  };

  const publish = () => move.mutate({ ...ref, to: 'published' }, { onSuccess: r => toastInfo(r.summary) });
  const review = () => move.mutate({ ...ref, to: 'review' }, { onSuccess: () =>
    toastInfo(`Week ${view.isoWeek} sent for review`, 'Not yet visible to colleagues.') });
  const doCopy = () => copy.mutate(ref, { onSuccess: r => toastInfo(r.summary) });
  const openClear = () => {
    const p = clearProblem({ state: view.state, weekStart: view.weekStart, lines: Object.fromEntries(view.rows.map(r => [r.personCode, [...r.line]])) },
      view.rows.map(r => r.personCode), view.location.name);
    if (p) { toastRefusal(p); return; }
    setBox({ k: 'clear' });
  };
  const openRepeat = () => {
    if (!view.rows.some(r => r.line.some(c => !!shiftBy(shifts, c)))) {
      toastRefusal({ message: 'This week has no shifts to repeat.', next: 'Build this week from the palette or a pattern.' });
      return;
    }
    setBox({ k: 'repeat' });
  };

  const gaps = view.gapDays, over = view.rows.find(overCap);
  const busy = move.anyPending || copy.anyPending;
  const roles = [...new Map(view.rows.map(r => [r.jobProfile, r.jobProfileName])).entries()];
  const cur = box && 'person' in box ? rowOf(box.person) : undefined;
  return (
    <>
      <WeekBar view={view} atCurrent={view.weekStart === thisWeek} busy={busy} actions={{
        onWeek: step => goWeek(step === 0 ? thisWeek : addDays(view.weekStart, 7 * step)),
        onHorizon: () => setBox({ k: 'horizon' }), onCopy: doCopy, onRepeat: openRepeat, onClear: openClear,
        onReview: review, onAdhoc: () => setBox({ k: 'adhoc' }), onPublish: publish,
      }} />
      <Page testId={tid.page('trota')}>
        <PageHead title="Team rota" crumb={`My team · Team rota · ${view.location.name}`} tipTestId={tid.trota.tip}
          tip={`${view.location.name} · ${view.location.level} support · needs ${view.min} per shift. Most shifts come from working patterns. Tap an empty cell to add one, or a shift to change it.`}
          actions={<>
            <SelectFilter testId={tid.trota.location} label="Location" value={view.location.code}
              options={view.locations.map(l => ({ value: l.code, label: l.name }))}
              onValueChange={l => { if (l !== view.location.code) { onLocation(l); toastInfo(`Now working in ${view.locations.find(x => x.code === l)?.name ?? l}`); } }} />
            <GuideButton view="trota" />
          </>} />
        {view.rules.minStaff && (gaps.length
          ? <Banner testId={tid.trota.gaps} tone="err"
              title={`${gaps.length} shift${gaps.length > 1 ? 's' : ''} uncovered · ${gaps.map(i => shortDay(view.weekStart, i)).join(', ')} ${MONTH_SHORT[parseIso(view.weekStart).getUTCMonth()] ?? ''}`}
              actions={<Button testId={tid.trota.suggest} kind="primary" small pending={planQ.isFetching} onClick={suggestCover}>Suggest cover</Button>}>
              {gapBannerText(view.min, view.location.level, view.rules.publishBlockOnGap)}</Banner>
          : <Banner testId={tid.trota.covered} tone="ok" icon={<CircleCheck />} title="Every shift is covered">
              Cover meets the minimum of {view.min} on all seven days.</Banner>)}
        {over && <Banner testId={tid.trota.over} tone="warn" title={overMaximumText(over.name, over.hours.rot, over.hours.cap)}
          actions={<Button testId={tid.trota.showFlags} kind="ghost" small onClick={() => setFilters(f => ({ ...f, flags: true }))}>Show</Button>}>
          {OVER_MAXIMUM_NOTE}</Banner>}
        <FilterBar>
          <SearchFilter testId={tid.trota.search} label="Search colleague" placeholder="Search colleague" value={filters.q}
            onChange={e => setFilters(f => ({ ...f, q: e.target.value }))} />
          <SelectFilter testId={tid.trota.role} label="Job profile" value={filters.role} onValueChange={v => setFilters(f => ({ ...f, role: v }))}
            options={[{ value: 'all', label: 'All job profiles' }, ...roles.map(([code, name]) => ({ value: code, label: name }))]} />
          <SelectFilter testId={tid.trota.type} label="Worker category" value={filters.type} onValueChange={v => setFilters(f => ({ ...f, type: v }))}
            options={[{ value: 'all', label: 'Everyone' }, { value: 'Contracted', label: 'Contracted' }, { value: 'Bank', label: 'Bank' }]} />
          <ChipButton testId={tid.trota.flags} on={filters.flags} onClick={() => setFilters(f => ({ ...f, flags: !f.flags }))}>Hours &amp; rest warnings</ChipButton>
          <Count testId={tid.trota.count}>{rows.length} of {view.rows.length} colleagues</Count>
        </FilterBar>
        {plan?.length
          ? <PlanPanel view={view} items={plan} busy={accept.anyPending} onAsk={askFirst}
              onAccept={i => { const x = plan[i]; if (x) acceptItems([x], () => setPlan(p => { const n = (p ?? []).filter((_, k) => k !== i); return n.length ? n : null; }),
                () => `${x.name} assigned to ${shiftName(shifts, x.code)} on ${dow(x.day)}. They have been notified.`); }}
              onAcceptAll={() => acceptItems(plan, () => setPlan(null), s => `${s}. Everyone assigned has been notified.`)}
              onSkip={i => setPlan(p => { const n = (p ?? []).filter((_, k) => k !== i); return n.length ? n : null; })}
              onDismiss={() => { setPlan(null); toastInfo('Suggestions dismissed'); }} />
          : <Palette shifts={shifts} lifted={lifted} onLift={lift} onDragStart={setLifted} onDragEnd={() => setLifted(null)} canMake={caps.has('rota_shift')} />}
        <p className="mb-md hidden text-xs text-text-muted max-md:block">A week grid needs more width than a phone has, so this is the day view. Use the day buttons below to move through the week.</p>
        <div aria-busy={loading || undefined} className={loading ? 'opacity-60' : undefined}>
          <RotaGrid view={view} rows={rows} handlers={{
            lifted, onCell, onFill: d => setBox({ k: 'gap', day: d }),
            onDrop: (r, d, code) => { setLifted(null); assign(r.personCode, d, code, 'Assigned by drag'); },
          }} />
          <DayView view={view} rows={rows} day={day} onDay={setDay} onFill={d => setBox({ k: 'gap', day: d })} />
        </div>
        <RotaHistory view={view} />
      </Page>
      {box?.k === 'add' && cur && <AddShiftDialog view={view} row={cur} day={box.day} busy={write.anyPending}
        onAssign={(p, code) => assign(p, box.day, code, 'Assigned', close)} onClose={close} />}
      {box?.k === 'shift' && cur && <ShiftDialog view={view} row={cur} day={box.day} busy={write.anyPending} onClose={close}
        onChange={code => write.mutate({ ...ref, body: { personCode: cur.personCode, day: box.day, code, why: 'Changed' } }, { onSuccess: r => {
          close(); toastInfo(`Shift changed to ${shiftName(shifts, code)}. ${cur.name} notified.`, advisory(r));
        } })}
        onRemove={() => write.mutate({ ...ref, body: { personCode: cur.personCode, day: box.day, code: '', why: 'Removed' } }, { onSuccess: r => {
          close(); toastInfo(r.cover ? 'Shift removed. That day is now short, so a cover request has been opened.' : `Shift removed. ${cur.name} notified.`);
        } })} />}
      {box?.k === 'gap' && <GapDialog view={view} day={box.day} busy={write.anyPending}
        onAssign={(p, code) => assign(p, box.day, code, 'Assigned', close)} onClose={close} />}
      {box?.k === 'clear' && <ClearDialog view={view} onClose={close} />}
      {box?.k === 'repeat' && <RepeatDialog view={view} onClose={close} />}
      {box?.k === 'horizon' && <HorizonDialog view={view} onClose={close} onJump={goWeek} />}
      {box?.k === 'adhoc' && <AdhocDialog view={view} onClose={close} onPlan={setPlan} />}
    </>);
}
