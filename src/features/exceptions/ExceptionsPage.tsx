import { useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { tid } from '@/testids';
import { buttonVariants } from '@/ui/shadcn/button';
import {
  Banner, Button, ChipButton, Count, Empty, Fact, Field, FilterBar, Modal, NavLink, Page, PageHead, Pill, SearchFilter, SelectFilter, TextArea, Tip,
  toastInfo,
} from '@/ui';
import { useShellData } from '@/shell/shellData';
import { useExceptions, useMoveException, type ExceptionItem, type ExceptionList } from '@/api/exceptions';
import {
  EXCEPTION_FILTERS, EXC_STATES, MOVE_LABEL, SEVERITY_TIP, asksForNote, changesText, filterCounts, filterLabel, inFilter, matches, movesFrom,
  severityTone, type ExceptionFilter, type ExceptionMove,
} from '@/domain/exceptions';
import { formatDateTime } from '@/lib/format';

/* Exceptions: the prototype's mgrExceptions (qnipay-workforce-v15.html:7821-7859).
   Every exception at the location, derived by the server from the data as it
   stands, highest severity first. The state filters default to Needs action
   (open, in progress, reopened); each row has its severity, its state, who
   owns it, the moves its state allows and an Open link to the screen the
   fact is put right on; an exception about the reader offers no moves, as
   the server refuses them (SELF_APPROVAL). Resolve and Ignore ask for the
   note in a dialog (excResolveBox, 10001-10022); the others act at once.
   Nothing changes on screen until the server has answered. */
export function ExceptionsPage() {
  const [location, setLocation] = useState('');
  const q = useExceptions(location);
  return (
    <Page testId={tid.page('texc')}>
      {q.data
        ? <ExceptionsView l={q.data} onLocation={setLocation} />
        : <>
          <PageHead title="Exceptions" crumb="My team · Exceptions" />
          {q.isError
            ? <p data-testid={tid.texc.error} role="alert" className="text-err">The exceptions could not be loaded. Reload the page to try again.</p>
            : <p data-testid={tid.texc.loading} className="text-text-secondary">Loading the exceptions&hellip;</p>}
        </>}
    </Page>);
}

type Box = { x: ExceptionItem; move: 'resolve' | 'ignore' };

function ExceptionsView({ l, onLocation }: { l: ExceptionList; onLocation: (code: string) => void }) {
  const [filter, setFilter] = useState<ExceptionFilter>('open');
  const [search, setSearch] = useState('');
  const [box, setBox] = useState<Box | null>(null);
  const m = useMoveException();
  const shell = useShellData();
  /* Open goes to the screen the fact is put right on, where this reader can reach it */
  const pathOf = (view: string) => (shell.kind === 'ready' ? shell.nav.flatMap(g => g.tabs).find(t => t.view === view)?.path : undefined);
  const counts = filterCounts(l.items.map(i => i.state));
  const shown = l.items.filter(i => inFilter(filter, i.state) && matches(search, i));
  const act = (x: ExceptionItem, move: ExceptionMove) => {
    if (move === 'resolve' || move === 'ignore') { setBox({ x, move }); return; }
    m.mutate({ id: x.id, move, ifMatch: x.version, note: '' }, { onSuccess: r => toastInfo(r.message) });
  };
  return (
    <>
      <PageHead title="Exceptions" crumb="My team · Exceptions" actions={
        <SelectFilter testId={tid.texc.location} label="Location" searchable value={l.location.code} options={l.locations.map(x => ({ value: x.code, label: x.name }))}
          onValueChange={code => { if (code !== l.location.code) { onLocation(code); toastInfo(`Now working in ${l.locations.find(x => x.code === code)?.name ?? code}`); } }} />} />
      <FilterBar>
        <span className="inline-flex items-center text-xs leading-[1.45] text-text-muted">Severity<Tip testId={tid.texc.severityTip} text={SEVERITY_TIP} /></span>
        {EXCEPTION_FILTERS.map(f => (
          <ChipButton key={f} testId={tid.texc.filter(f)} on={filter === f} onClick={() => setFilter(f)}>{filterLabel(f)} · {counts[f]}</ChipButton>))}
        <SearchFilter testId={tid.texc.search} label="Search" placeholder="Search" value={search} onChange={e => setSearch(e.target.value)} />
        <Count testId={tid.texc.count}>{shown.length} of {l.items.length}</Count>
      </FilterBar>
      <div data-testid={tid.texc.list} className="mb-md overflow-auto rounded-card border bg-surface-card">
        {shown.length
          ? shown.map(x => <ExceptionRow key={x.id} x={x} openPath={pathOf(x.source)} pending={m.isPending(`exception/${x.id}`)} onMove={mv => act(x, mv)} />)
          : <Empty testId={tid.texc.empty}>Nothing matches that filter</Empty>}
      </div>
      {box && <NoteDialog box={box} onClose={() => setBox(null)} />}
    </>);
}

/* .att (v15:1210-1212): the severity and state pills, who and what, then the moves and Open; a footer line once it has been handled */
function ExceptionRow({ x, openPath, pending, onMove }: { x: ExceptionItem; openPath?: string; pending: boolean; onMove: (m: ExceptionMove) => void }) {
  const S = EXC_STATES[x.state], sev = severityTone(x.severity);
  const handled = x.owner || x.resolution || x.history.length;
  return (
    <div data-testid={tid.texc.row(x.id)} className="flex flex-wrap items-center gap-md border-b px-md py-[10px] text-sm last:border-b-0">
      <Pill testId={tid.texc.kind(x.id)} tone={sev} glyph={sev === 'neu' ? undefined : <TriangleAlert />}>{x.kind}</Pill>
      <Pill testId={tid.texc.state(x.id)} tone={S.tone} glyph={S.glyph}>{S.label}</Pill>
      <span><strong className="font-semibold">{x.subject}</strong> · {x.text}</span>
      <span className="ml-auto flex flex-wrap gap-[6px]">
        {x.mine
          ? <span data-testid={tid.texc.self(x.id)} className="self-center text-xs leading-[1.45] text-text-muted">This is about you, so someone else must handle it</span>
          : movesFrom(x.state).map(mv => (
            <Button key={mv} testId={tid.texc.move(x.id, mv)} kind="ghost" small pending={pending && !asksForNote(mv)} onClick={() => onMove(mv)}>{MOVE_LABEL[mv]}</Button>))}
        {openPath && <NavLink testId={tid.texc.open(x.id)} to={openPath} className={buttonVariants({ variant: 'ghost', size: 'sm' })}>Open</NavLink>}
      </span>
      {handled
        ? <div data-testid={tid.texc.meta(x.id)} className="basis-full pt-xs text-xs leading-[1.45] text-text-muted">
          {x.owner && <>Owner: {x.owner.name} · </>}
          First recorded {x.firstRecorded ? formatDateTime(x.firstRecorded) : '—'}
          {x.resolution && <> · Resolution: {x.resolution}</>}
          {x.history.length > 0 && <> · {changesText(x.history.length)}</>}
        </div>
        : null}
    </div>);
}

/* excResolveBox (v15:10001-10022): what the exception is, P's warning when
   ignoring, and the note the server requires: what was done, or why it is
   being ignored. A refusal lands on the note. */
function NoteDialog({ box: { x, move }, onClose }: { box: Box; onClose: () => void }) {
  const m = useMoveException();
  const [note, setNote] = useState('');
  const resolving = move === 'resolve';
  const field = resolving ? 'note' : 'reason';
  const send = () => m.mutate({ id: x.id, move, ifMatch: x.version, note }, { onSuccess: r => { toastInfo(r.message); onClose(); } });
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`${resolving ? 'Resolve' : 'Ignore'} this exception`}
      footer={<>
        <Button testId={tid.texc.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.texc.confirm} kind="primary" pending={m.isPending(`exception/${x.id}`)} onClick={send}>{resolving ? 'Resolve' : 'Ignore'}</Button>
      </>}>
      <Fact label="Type">{x.kind}</Fact>
      <Fact label="Subject">{x.subject}</Fact>
      <Fact label="Detail">{x.text}</Fact>
      <Fact label="First recorded">{x.firstRecorded ? formatDateTime(x.firstRecorded) : 'Not yet. Nobody has acted on it.'}</Fact>
      {!resolving && <div className="mt-md"><Banner testId={tid.texc.banner} tone="warn" title="Ignoring does not fix the underlying fact">
        The condition will still be detected. Ignoring records a decision not to act, and it stays on the audit trail.</Banner></div>}
      <div className="mt-md">
        <Field label={resolving ? 'What was done' : 'Why this is being ignored'} required error={m.fieldError(field)}>
          <TextArea testId={tid.texc.note} rows={3} value={note} onChange={e => { setNote(e.target.value); m.clearFieldErrors(); }}
            placeholder={resolving ? 'e.g. Hours corrected with the employee and resubmitted' : 'e.g. Accepted for this period, agreed with the service manager'} />
        </Field>
      </div>
    </Modal>);
}
