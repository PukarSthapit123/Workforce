import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { tid } from '@/testids';
import { GuideButton, Page, PageHead, Seg } from '@/ui';
import { useTimesheetWeek } from '@/api/timesheets';
import { useCurrentSession } from '@/shell/SessionProvider';
import { todayIso } from '@/lib/format';
import { periodStart } from '@/domain/timesheet';
import { isIsoDate } from '@/domain/time';
import type { CaptureSetup } from '@/contract/timesheets';
import { flagOn } from './capture';
import { DayView } from './DayView';
import { WeekView } from './WeekView';

/* My timesheet: the prototype's essTimesheet (qnipay-workforce-v15.html:6330-6345).
   Day and Week follow the DAILY and WEEKLY flags; a grid-mode type opens on the
   week while WEEKLY is on (defaultTsView). The date is the server's: until
   the first week arrives the page asks for the week holding the browser's
   today, then follows the clock the server returned. Clocking (module B) and
   indicative pay lines (money) are not part of this page. A link from My
   home's day dialog (?date=YYYY-MM-DD) opens on that day. */
type View = 'day' | 'week';
const defaultView = (c: CaptureSetup): View => (c.mode === 'grid' && flagOn(c, 'WEEKLY') ? 'week' : 'day');

export function TimesheetPage() {
  const personId = useCurrentSession()?.account.personCode ?? '';
  const [serverToday, setServerToday] = useState<string | null>(null);
  const asked = useSearchParams()[0].get('date') ?? '';
  const [anchor, setAnchor] = useState<string | null>(isIsoDate(asked) ? asked : null);
  const [view, setView] = useState<View | null>(isIsoDate(asked) ? 'day' : null);
  const today = serverToday ?? todayIso();
  const date = anchor ?? today;
  const q = useTimesheetWeek(personId, periodStart(date), Boolean(personId));
  const week = q.data?.weekStart === periodStart(date) ? q.data : undefined;
  /* the server's clock, adopted once: a stored fact about the session, not a derived value */
  if (q.data && serverToday === null) setServerToday(q.data.now.date);

  const c = week?.capture;
  const weekOk = c ? flagOn(c, 'WEEKLY') : false, dayOk = c ? flagOn(c, 'DAILY') || !weekOk : true;
  let shown: View = view ?? (c ? defaultView(c) : 'day');
  if (shown === 'week' && !weekOk) shown = 'day';
  if (shown === 'day' && !dayOk) shown = 'week';
  return (
    <Page testId={tid.page('ts')}>
      <PageHead title="My timesheet" crumb="My work · Timesheet" actions={<>
        <GuideButton view="ts" />
        {c && <Seg label="Show the day or the week" value={shown} onChange={setView} testId={v => tid.ts.view(v)}
          options={[{ value: 'day', label: 'Day', disabled: !dayOk }, { value: 'week', label: 'Week', disabled: !weekOk }]} />}
      </>} />
      {q.isError && <p data-testid={tid.ts.error} role="alert" className="text-err">Your timesheet could not be loaded. Reload the page to try again.</p>}
      {!q.isError && (!week || serverToday === null) && <p className="text-text-secondary">Loading your timesheet&hellip;</p>}
      {week && serverToday !== null && (shown === 'day'
        ? <DayView week={week} date={date} today={today} onDate={setAnchor} personId={personId} />
        : <WeekView week={week} today={today} onAnchor={setAnchor} personId={personId} />)}
    </Page>);
}
