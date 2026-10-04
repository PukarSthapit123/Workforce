/* 1c group 7: My home's month and My documents (brief D7, D12, D13). Every
   rule is src/domain/home.ts's; this reads the store into it. A day's shift
   is the published rota's (nothing while Rota is off or the week is a draft
   or in review), its absence is the one the timesheet already reads (a V or
   S cell on the published rota, else approved leave or recorded sickness
   while Leave is on), its timesheet state is the stored day's, and its bank
   holiday is the tenant's. Both reads are the person signed in, or the one
   being viewed as. Nothing here writes. */
import { store } from './store';
import { refuse } from './http';
import { serve } from './serve';
import { effectiveCode, nameOf, personByCode, recordAt, type StoredPerson } from './world';
import { tenantRec, view } from './tenant';
import { rotaDaysFor, rotaToneOf } from './rota';
import { absenceOf, daysOf, hm, isLocked } from './timesheets';
import { leaveRecordOn, leaveTypeInfo } from './leave';
import { getDocument, getHome, listMyDocuments, type DocumentRow, type HomeDay } from '@/contract/home';
import type { RotaDay, TimesheetDay } from '@/contract/timesheets';
import {
  dayGlyph, firstName, greeting, inBounds, leadingBlanks, monthBounds, monthDates, monthKey, monthLabel, monthOf, monthSummary, monthTotals,
  outOfBoundsProblem, whoLine, type KeyDay,
} from '@/domain/home';
import { flagOn } from '@/domain/modules';
import { clockFromIso, dowMon, periodStart, weekDates } from '@/domain/time';
import { dayMinutes } from '@/domain/timesheet';

type StoredDay = Omit<TimesheetDay, 'minutes' | 'posting' | 'enteredByName'>;
interface StoredPayrollDoc { id: string; name: string; category: string; note: string }

const NO_PERSON = () => refuse(404, { code: 'not-found', message: 'There is no employee record behind this account.', next: 'Ask an administrator to link your account to your record.' });
const personOf = (code: string): StoredPerson => personByCode(code) ?? NO_PERSON();

/* One person's days, read once per request: the published rota by week and
   the stored timesheet days by date. */
function reader(p: StoredPerson, today: string) {
  const weeks = new Map<string, RotaDay[] | undefined>();
  const rotaOn = (date: string) => {
    const ws = periodStart(date);
    if (!weeks.has(ws)) weeks.set(ws, rotaDaysFor(p.code, ws));
    return weeks.get(ws)?.[dowMon(date)];
  };
  const stored = new Map(daysOf(p.code).map(d => [d.date, d as StoredDay]));
  const holidays = new Map(view(tenantRec()).bankHolidays.map(b => [b.date, b.name]));
  return (date: string): HomeDay => {
    const r = rotaOn(date);
    const shift = r && r.code && r.code !== 'V' && r.code !== 'S'
      ? { code: r.code, name: r.name, time: r.time, hours: r.hours, tone: rotaToneOf(r.code) } : null;
    const mark = absenceOf(p.code, date);
    const rec = mark ? leaveRecordOn(p.code, date) : null;
    const type = rec?.type ?? (mark === 'S' ? 'SICK' : 'AL');
    const absence = mark ? { mark, type, ...leaveTypeInfo(type), from: rec?.from ?? null, to: rec?.to ?? null, state: rec?.state ?? 'approved' } : null;
    const d = stored.get(date), minutes = d ? dayMinutes(d.entries) : 0;
    /* a draft with nothing on it is not a record yet */
    const ts = d && (d.state !== 'draft' || minutes > 0 || d.nonWorkingReason) ? { state: d.state, minutes, text: minutes ? hm(minutes) : '' } : null;
    const future = date > today, isToday = date === today;
    return {
      date, shift: absence ? null : shift, absence, ts,
      glyph: dayGlyph({ absence: mark, ts: ts?.state ?? null, shift: Boolean(shift), past: date < today }),
      bankHoliday: holidays.get(date) ?? '', today: isToday, future,
      locked: ts?.state === 'ok' || isLocked(date),
      source: absence ? 'leave' : shift ? 'rota' : 'none',
    };
  };
}
const keyDay = (d: HomeDay): KeyDay => ({
  tone: d.shift?.tone ?? null, leave: d.absence ? { name: d.absence.name, icon: d.absence.icon } : null,
  absence: d.absence?.mark ?? '', glyph: d.glyph, minutes: d.ts?.minutes ?? 0,
});

const documentsOn = () => { const t = tenantRec(); return flagOn(t.modules, t.flags, 'DOCS'); };
function requireDocuments() {
  if (!documentsOn()) refuse(403, { code: 'feature-off', message: 'Documents is switched off for this tenant.', next: 'Turn it on in Qnipay setup → Modules and features.' });
}
const docColl = () => store.coll<DocumentRow>('documents');
const NO_DOCUMENT = () => refuse(404, { code: 'not-found', message: 'That document is not one of yours, or it no longer exists.', next: 'Open Documents to see the ones you have.' });

export const homeHandlers = [
  serve(getHome, ({ session, query }) => {
    const p = personOf(effectiveCode(session)), t = view(tenantRec());
    const clock = clockFromIso(store.now()), today = clock.date, bounds = monthBounds(today, t.rotaHorizon);
    const month = query.month ?? monthOf(today);
    if (!inBounds(month, bounds)) {
      const problem = outOfBoundsProblem(bounds);
      return refuse(422, { code: 'invalid', field: problem.field, message: problem.message, next: 'Choose a month in that range.' });
    }
    const dayOf = reader(p, today), days = monthDates(month).map(dayOf), keyDays = days.map(keyDay), totals = monthTotals(keyDays);
    const week = weekDates(periodStart(today)).map(dayOf);
    const next = week.find(d => d.date >= today && d.shift);
    const own = daysOf(p.code) as StoredDay[];
    const back = own.filter(d => d.state === 'back').sort((a, b) => b.date.localeCompare(a.date))[0];
    const weekMinutes = week.reduce((n, d) => n + (d.ts?.minutes ?? 0), 0);
    const ts = t.modules.A || t.modules.B;
    return {
      month, label: monthLabel(month), thisMonth: monthOf(today), bounds, today,
      person: { code: p.code, name: p.name, location: nameOf('locations', p.location) },
      greeting: `${greeting(clock.time)}, ${firstName(p.name)}`,
      who: whoLine({ job: p.jobProfile ? nameOf('jobProfiles', p.jobProfile) : '', type: p.employeeType ? nameOf('employeeTypes', p.employeeType) : '', location: nameOf('locations', p.location) }),
      leadingBlanks: leadingBlanks(month), days, totals, summary: monthSummary(totals), key: monthKey(keyDays),
      todayDay: dayOf(today),
      nextShift: next?.shift ? { date: next.date, name: next.shift.name, time: next.shift.time } : null,
      week: { minutes: weekMinutes, text: hm(weekMinutes), contracted: p.contractedHours, rotaHours: week.reduce((n, d) => n + (d.shift?.hours ?? 0), 0) },
      missing: week.filter(d => d.date < today && d.glyph === 'none').map(d => d.date),
      sentBack: back ? { date: back.date, reason: back.returnReason || 'Correct it and resubmit.' } : null,
      can: { recordHours: Boolean(ts) && session.caps.includes('own_ts'), bookLeave: Boolean(t.modules.L) && session.caps.includes('own_leave') },
    };
  }),

  serve(listMyDocuments, ({ session }) => {
    requireDocuments();
    const p = personOf(effectiveCode(session));
    return {
      person: { code: p.code, name: p.name },
      items: Object.values(docColl()).filter(d => d.personCode === p.code),
      payroll: Object.values(store.coll<StoredPayrollDoc>('payrollDocuments')).map(d => ({ id: d.id, name: d.name, category: d.category, note: d.note })),
    };
  }),

  serve(getDocument, ({ session, params }) => {
    requireDocuments();
    const d = recordAt(docColl(), params.id);
    return d && d.personCode === effectiveCode(session) ? d : NO_DOCUMENT();
  }),
];
