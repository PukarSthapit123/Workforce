/* Module 6 group 1: the hours position (My hours, Team hours and its export).
   Derived on every read from what is already stored: the person's timesheet
   days (worked), their location's published rota (rota'd, module 3 D14: a
   plan not yet published is not a schedule anyone has been given, so both
   screens read the same published week) and their contracted hours. The
   rules are the domain's (domain/hours). My hours is the reader's own week
   only; Team hours is in the reader's location scope. The export writes one
   audit row and nothing else. Hours only (brief P1). */
import { store } from './store';
import { refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { effectiveCode, nameOf, people, personByCode, recordAt, scopeOf, today, type Signed, type StoredPerson } from './world';
import { hoursRulesFor, rotaDaysFor, weekOn } from './rota';
import { daysOf, waitingOnOf } from './timesheets';
import { leaveAbsenceOn } from './leave';
import { exportTeamHours, getMyHours, getTeamHours, type HoursDay, type TeamHoursRow } from '@/contract/hours';
import { dayStatus, dayVariance, hoursCsv, hoursFileName, minutesToHours, positionOf, rotaLineText } from '@/domain/hours';
import { emptyLine, isActive, onRoster } from '@/domain/rota';
import { dayMinutes } from '@/domain/timesheet';
import { weekDates, weekLabel } from '@/domain/time';

interface StoredLocation { code: string; name: string; active?: boolean }
const locations = () => Object.values(store.coll<StoredLocation>('locations'));
const rotaOn = () => Boolean(recordAt(store.coll<{ modules: Record<string, boolean> }>('tenant'), 'tenant')?.modules.R);

/* The person's week: the published rota (null while Rota is off), each day's
   stored timesheet day, and the hours worked across it. */
function weekOf(p: StoredPerson, ws: string) {
  const dates = weekDates(ws), rota = rotaOn() ? rotaDaysFor(p.code, ws) : undefined;
  const line = rotaOn() ? dates.map((_, i) => rota?.[i]?.code ?? '') : null;
  const stored = daysOf(p.code), days = dates.map(date => stored.find(d => d.date === date));
  const worked = minutesToHours(days.reduce((n, d) => n + (d ? dayMinutes(d.entries) : 0), 0));
  return { dates, rota, line, days, worked };
}
function positionFor(p: StoredPerson, w: ReturnType<typeof weekOf>) {
  const { worker, ctx } = hoursRulesFor(p);
  return positionOf({ ...worker, contractedHours: Math.max(0, worker.contractedHours) }, w.line, w.worked, ctx);
}

/* -------------------------------------------------------- location scope */
/* The locations the reader may look at: their own, or every active one with master data. */
function viewable(s: Signed) {
  const sc = scopeOf(s);
  return locations().filter(l => (sc.all ? l.active !== false : l.code === sc.location)).map(l => ({ code: l.code, name: l.name }));
}
function locationFor(s: Signed, code: string | undefined) {
  const list = viewable(s);
  if (code === undefined) {
    const own = personByCode(effectiveCode(s))?.location;
    const first = list.find(l => l.code === own) ?? list[0];
    return first ?? refuse(404, { code: 'not-found', message: 'There is no location whose hours you can see.', next: 'Ask an administrator to give you a location.' });
  }
  const l = locations().find(x => x.code === code);
  if (!l) return refuse(404, { code: 'not-found', message: 'That location no longer exists.', next: 'Choose a location from the list.' });
  const sc = scopeOf(s);
  if (!sc.all && sc.location !== l.code) refuse(403, { code: 'scope', message: `You can see hours at ${nameOf('locations', sc.location)} only.`,
    next: 'Ask an administrator if you need hours at another location.' });
  if (l.active === false) refuse(404, { code: 'not-found', message: `${l.name} is no longer an active location.`, next: 'Choose a location from the list.' });
  return { code: l.code, name: l.name };
}

/* The location's roster for the week (rosterAt): active people there with
   contracted hours or a shift on the published week, in record order. */
function teamAt(location: string, ws: string) {
  return Object.values(people()).flatMap(p => {
    if (p.location !== location || !isActive(p)) return [];
    const w = weekOf(p, ws);
    if (!onRoster(p, location, w.line ?? emptyLine())) return [];
    const row: TeamHoursRow = { personCode: p.code, name: p.name, category: p.category, jobProfileName: nameOf('jobProfiles', p.jobProfile),
      contractedHours: Math.max(0, p.contractedHours), position: positionFor(p, w) };
    return [row];
  });
}

export const hoursHandlers = [
  serve(getMyHours, ({ session }) => {
    const p = personByCode(effectiveCode(session))
      ?? refuse(404, { code: 'not-found', message: 'Your person record no longer exists.', next: 'Ask an administrator to check your record.' });
    const ws = weekOn(p.location, today()).weekStart, w = weekOf(p, ws), now = today();
    const days: HoursDay[] = w.dates.map((date, i) => {
      const r = w.rota?.[i], d = w.days[i], scheduled = r?.hours ?? 0, worked = d ? minutesToHours(dayMinutes(d.entries)) : 0;
      const waitingOn = d ? waitingOnOf(d) : undefined;
      const status = dayStatus({ cell: r?.code ?? '', absence: leaveAbsenceOn(p.code, date), state: d?.state ?? null, scheduled, future: date > now });
      return { date, code: r?.code ?? '', line: rotaLineText(r), scheduled, worked, variance: w.line ? dayVariance(scheduled, worked) : null,
        status: status.kind === 'recorded' && d ? { kind: 'recorded', state: d.state, ...(waitingOn ? { waitingOn } : {}) } : { kind: status.kind } };
    });
    return { person: { code: p.code, name: p.name, contractedHours: Math.max(0, p.contractedHours) }, weekStart: ws, label: weekLabel(ws),
      rota: w.line !== null, position: positionFor(p, w), days };
  }),

  serve(getTeamHours, ({ session, query }) => {
    const location = locationFor(session, query.location), ws = weekOn(location.code, today()).weekStart;
    return { location, locations: viewable(session), weekStart: ws, label: weekLabel(ws), rota: rotaOn(), rows: teamAt(location.code, ws) };
  }),

  serve(exportTeamHours, ({ session, body }) => {
    const location = locationFor(session, body.location), ws = weekOn(location.code, today()).weekStart;
    const rows = teamAt(location.code, ws), fileName = hoursFileName(location.code, ws);
    const file = hoursCsv(rows.map(r => ({ code: r.personCode, name: r.name, locationName: location.name, jobProfileName: r.jobProfileName,
      contractedHours: r.contractedHours, position: r.position })), rotaOn());
    const auditId = writeAudit({ who: actor(session), act: 'Export', entity: 'hours', entityId: fileName, before: null,
      after: { location: location.code, weekStart: ws, rows: rows.length } });
    return { fileName, rows: file, count: rows.length, auditId };
  }),
];
