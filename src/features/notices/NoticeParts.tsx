import type { ReactNode } from 'react';
import { Ban, Check, CircleAlert, CircleCheck, Clock, Hourglass, Info, PencilLine, RotateCw } from 'lucide-react';
import { Pill } from '@/ui';
import { formatDateTime } from '@/lib/format';
import type { NoticeStatus, ReaderState } from '@/api/notices';
import { NOTICE_STATUS } from '@/domain/notices';

/* Pieces both sides of the notice board share: the prototype's noticeMarks
   (v15:5805) and noticeStatePill (5797-5804). */
export function NoticeMarks({ urgent, pinned }: { urgent: boolean; pinned: boolean }) {
  if (!urgent && !pinned) return null;
  return (
    <span className="mr-xs inline-flex gap-xs align-[1px]">
      {urgent && <Pill tone="err">Urgent</Pill>}
      {pinned && <Pill tone="hi">Pinned</Pill>}
    </span>);
}

/* Where a reader stands: for information, acknowledged (with the day), asked
   again after an edit, or still to acknowledge. */
export function ReaderPill({ testId, you, at }: { testId?: string; you: ReaderState; at: string | null }) {
  if (you === 'info') return <Pill testId={testId} tone="neu" glyph={<Info />}>For information</Pill>;
  if (you === 'acknowledged') return <Pill testId={testId} tone="ok" glyph={<Check />}>Acknowledged {at ? formatDateTime(at).slice(0, 5) : ''}</Pill>;
  if (you === 'again') return <Pill testId={testId} tone="warn" glyph={<RotateCw />}>Updated, acknowledge again</Pill>;
  return <Pill testId={testId} tone="warn" glyph={<CircleAlert />}>Acknowledge</Pill>;
}


/* A notice's state for its poster (NOTICE_STATUS), with a glyph so colour never carries it alone. */
const GLYPH: Record<NoticeStatus, ReactNode> = { draft: <PencilLine />, scheduled: <Clock />, current: <CircleCheck />, expired: <Hourglass />, withdrawn: <Ban /> };
export function StatusPill({ testId, status }: { testId?: string; status: NoticeStatus }) {
  const s = NOTICE_STATUS[status];
  return <Pill testId={testId} tone={s.tone} glyph={GLYPH[status]}>{s.label}</Pill>;
}
