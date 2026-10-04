import { tid } from '@/testids';
import { Button, CalNav, Pill } from '@/ui';
import { formatDateTime } from '@/lib/format';
import { rotaLive, rotaState, rotaVisible } from '@/domain/rota';
import type { RotaWeekView } from '@/contract/rota';
import { weekRange } from './week';

/* The week bar: Rota's one permitted extra shell row (qnipay-workforce-v15.html:
   10662-10692, CSS 365-371 and 1542-1551). It sits under the tab strip, sticky
   at 100px (56px on a phone, where the strip becomes the bottom bar), and reads
   the week's own record: its state, its version and the changes made since it
   was published. Publish is disabled while gaps block it or the week is live;
   Copy and Clear while colleagues can see the week, amended included. */
export interface WeekActions {
  onWeek: (step: -1 | 1 | 0) => void; onHorizon: () => void; onCopy: () => void; onRepeat: () => void; onClear: () => void;
  onReview: () => void; onAdhoc: () => void; onPublish: () => void;
}
export function WeekBar({ view, atCurrent, busy, actions }: { view: RotaWeekView; atCurrent: boolean; busy: boolean; actions: WeekActions }) {
  const s = rotaState(view.state), live = rotaLive(view.state), seen = rotaVisible(view.state);
  const amend = view.changes.filter(c => c.afterPublish && c.version === view.publishVersion).length;
  const blocked = view.rules.publishBlockOnGap && view.gapDays.length > 0;
  const note = live ? `Published ${view.publishedAt ? formatDateTime(view.publishedAt) : ''} · visible to colleagues`
    : view.state === 'amendment' ? `${amend} unpublished change(s) since v${view.publishVersion}`
      : view.state === 'review' ? 'Sent for review · not visible yet' : 'Not published · not visible yet';
  return (
    <div data-testid={tid.trota.weekbar}
      className="sticky top-[100px] z-[55] flex flex-wrap items-center gap-md border-b bg-surface-card px-xl py-[9px] max-lg:px-md max-md:top-14">
      <CalNav label={weekRange(view.weekStart)} labelTestId={tid.trota.weekLabel}
        prev={{ testId: tid.trota.weekPrev, label: 'Previous week', onClick: () => actions.onWeek(-1) }}
        next={{ testId: tid.trota.weekNext, label: 'Next week', onClick: () => actions.onWeek(1) }}
        back={{ testId: tid.trota.weekNow, label: 'Back to this week', current: 'This week', atCurrent, onClick: () => actions.onWeek(0) }} />
      <Pill testId={tid.trota.state} tone={s.tone} glyph={s.glyph} note={note}>{s.label}{view.publishVersion ? ` · v${view.publishVersion}` : ''}</Pill>
      {view.state === 'amendment' && <Pill testId={tid.trota.amended} tone="warn" glyph="✎">{amend} unpublished change{amend === 1 ? '' : 's'}</Pill>}
      <span data-testid={tid.trota.isoWeek} className="text-xs text-text-muted">Week {view.isoWeek}</span>
      <span className="ml-auto flex flex-wrap gap-sm">
        <Button testId={tid.trota.horizon} kind="ghost" small onClick={actions.onHorizon}>{view.rules.horizon}-month horizon</Button>
        <Button testId={tid.trota.copy} kind="ghost" small pending={busy} disabled={seen} onClick={actions.onCopy}
          title={seen ? `This week is ${s.label.toLowerCase()}. Copying over it would replace shifts colleagues can see.` : undefined}>Copy last week</Button>
        <Button testId={tid.trota.repeat} kind="ghost" small onClick={actions.onRepeat}>Repeat forward</Button>
        <Button testId={tid.trota.clear} kind="ghost" small disabled={seen} onClick={actions.onClear}
          title={seen ? `This week is ${s.label.toLowerCase()}. Clear it by amending the shifts you want removed.` : undefined}>Clear week</Button>
        {view.state === 'draft' && <Button testId={tid.trota.review} kind="ghost" small pending={busy} onClick={actions.onReview}>Send for review</Button>}
        <Button testId={tid.trota.adhoc} kind="ghost" small onClick={actions.onAdhoc}>Add an extra shift</Button>
        <Button testId={tid.trota.publish} kind="primary" small pending={busy} disabled={blocked || live} onClick={actions.onPublish}
          title={blocked ? 'Coverage gaps block publishing' : live ? `Already ${s.label.toLowerCase()} at v${view.publishVersion}` : undefined}>
          {view.state === 'amendment' ? 'Republish' : 'Publish'}</Button>
      </span>
    </div>);
}
