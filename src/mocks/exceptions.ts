/* Module 6 group 2: Exceptions (team_hours, in the existing location scope).
   The exceptions are derived on every read from what is already stored (P's
   detectExceptions, domain/exceptions): each location's roster this week
   with its hours position and the scheduled days with nothing recorded
   (./hours), the rota profiles' clearance and qualifications, the published
   week's days under the minimum on shift (./rota), the leave requests past
   their approval SLA (./leave) and the failed postings. Nothing is written
   on a read. A handling record is stored under the exception's id the first
   time someone acts on it; each transition checks If-Match against it
   (version 0 before then) and writes one audit row. A refusal or a fault
   writes nothing, because serve() restores the store. No money (brief P1). */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { inScope, nameOf, personByCode, recordAt, type Signed } from './world';
import { locationFor, rosterWeek, viewable } from './hours';
import { coverageGaps, hoursRulesFor } from './rota';
import { escalatedLeave } from './leave';
import {
  ignoreException, listExceptions, releaseException, reopenException, resolveException, takeException, type ExceptionItem,
} from '@/contract/exceptions';
import type { IntegrationAttempt } from '@/contract/timesheets';
import type { RecordMeta } from '@/contract/common';
import {
  MOVE_TOAST, NO_EXCEPTION, UNHANDLED, applyMove, deriveExceptions, moveAuditAct, moveProblem,
  type DerivedException, type ExceptionFacts, type ExceptionMove, type ExceptionRefusal, type Handling,
} from '@/domain/exceptions';

export interface StoredHandling extends Handling, RecordMeta { key: string; kind: string; subject: string; firstRecorded: string }
const handlings = () => store.coll<StoredHandling>('exceptionHandling');
const refuseWith = (r: ExceptionRefusal): never =>
  refuse(r.status, { code: r.code, message: r.message, next: r.next, ...(r.field ? { field: r.field } : {}) });

/* ------------------------------------------------------------ the facts */
interface StoredLocation { code: string; name: string; active?: boolean }
const activeLocations = () => Object.values(store.coll<StoredLocation>('locations')).filter(l => l.active !== false).map(l => l.code);
/* A posting's location is its day's colleague's; a batch (no day) is every location's. */
function postingLocation(a: IntegrationAttempt): string | null {
  const day = a.dayId ? recordAt(store.coll<{ personCode: string }>('timesheetDays'), a.dayId) : undefined;
  return (day && personByCode(day.personCode)?.location) || null;
}
function factsAt(locations: readonly string[]): ExceptionFacts {
  const at = new Set(locations);
  const people = locations.flatMap(location => {
    const week = rosterWeek(location);
    return week.rows.map(r => {
      const w = hoursRulesFor(r.person).worker;
      return { code: r.person.code, name: r.person.name, location, weekStart: week.weekStart, flags: r.position.flags, missing: r.missing,
        cleared: w.cleared, dbsExpiry: w.dbsExpiry, qualifications: w.qualifications };
    });
  });
  const gaps = locations.flatMap(location => coverageGaps(location, rosterWeek(location).weekStart)
    .map(g => ({ ...g, location, locationName: nameOf('locations', location) })));
  const leave = escalatedLeave().flatMap(l => {
    const p = personByCode(l.personCode);
    return p && at.has(p.location) ? [{ ...l, name: p.name, location: p.location }] : [];
  });
  const postings = Object.values(store.coll<IntegrationAttempt>('integrationAttempts')).filter(a => a.state === 'failed').flatMap(a => {
    const location = postingLocation(a);
    return location === null || at.has(location) ? [{ id: a.id, ref: a.ref, attempt: a.attempt, reason: a.reason ?? a.cause ?? '', location }] : [];
  });
  return { people, gaps, leave, postings };
}

/* ------------------------------------------------------------ the views */
function itemOf(x: DerivedException): ExceptionItem {
  const h = recordAt(handlings(), x.id);
  return { id: x.id, version: h?.version ?? 0, key: x.key, kind: x.kind, severity: x.severity, subject: x.subject, text: x.text, location: x.location,
    source: x.source, state: h?.state ?? 'open', owner: h?.owner ?? null, resolution: h?.resolution ?? '', firstRecorded: h?.firstRecorded ?? null,
    history: h?.history ?? [] };
}

/* Payroll readiness (module 6 group 4): every exception at every active location, with its handling. */
export const exceptionsEverywhere = (): ExceptionItem[] => deriveExceptions(factsAt(activeLocations())).map(itemOf);

/* ------------------------------------------------------------- the moves */
/* The exception as it stands now, wherever it is: one outside the caller's
   location scope is refused with scope, one no longer detected is not found. */
function exceptionFor(s: Signed, id: string): DerivedException {
  const x = deriveExceptions(factsAt(activeLocations())).find(e => e.id === id) ?? refuseWith(NO_EXCEPTION);
  if (x.location !== null && !inScope(s, x.location))
    refuse(403, { code: 'scope', message: `That exception is at ${nameOf('locations', x.location)}, outside your scope.`,
      next: 'Ask a manager there, or an administrator, to handle it.' });
  return x;
}
function move(m: ExceptionMove, s: Signed, id: string, note: string, checkVersion: (r: RecordMeta) => void) {
  const x = exceptionFor(s, id), stored = recordAt(handlings(), x.id), now = store.now();
  checkVersion(stored ?? { id: x.id, version: 0, updatedAt: now });
  const was: Handling = stored ?? UNHANDLED;
  const problem = moveProblem(was.state, m, note);
  if (problem) return refuseWith(problem);
  const w = actor(s), by = { personCode: w.personCode, name: w.name };
  const next = applyMove(was, m, by, now, note);
  const saved: StoredHandling = stored ? bump(stored, next)
    : { id: x.id, version: 1, updatedAt: now, key: x.key, kind: x.kind, subject: x.subject, firstRecorded: now, ...next };
  handlings()[x.id] = saved;
  const n = next.history.at(-1)?.note ?? '';
  const auditId = writeAudit({ who: w, act: moveAuditAct(m), entity: 'exception', entityId: x.id,
    before: { state: was.state, owner: was.owner?.name ?? null },
    after: { state: next.state, owner: next.owner?.name ?? null, detail: `${x.kind} · ${x.subject}${n ? ` · "${n}"` : ''}` } });
  return { record: itemOf(x), auditId, message: MOVE_TOAST[m] };
}

export const exceptionHandlers = [
  serve(listExceptions, ({ session, query }) => {
    const location = locationFor(session, query.location, 'exceptions');
    const items = deriveExceptions(factsAt([location.code])).map(itemOf);
    return { location, locations: viewable(session), items };
  }),
  serve(takeException, ({ session, params, checkVersion }) => move('take', session, params.id, '', checkVersion)),
  serve(releaseException, ({ session, params, checkVersion }) => move('release', session, params.id, '', checkVersion)),
  serve(resolveException, ({ session, params, body, checkVersion }) => move('resolve', session, params.id, body.note, checkVersion)),
  serve(ignoreException, ({ session, params, body, checkVersion }) => move('ignore', session, params.id, body.reason, checkVersion)),
  serve(reopenException, ({ session, params, checkVersion }) => move('reopen', session, params.id, '', checkVersion)),
];
