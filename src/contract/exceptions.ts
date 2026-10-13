/* Module 6 group 2: Exceptions (team_hours, in location scope). The list is
   derived on every read from the data as it stands (domain/exceptions); a
   handling record, stored under the exception's id once someone acts on it,
   holds the state, the owner, the resolution and the history. Each
   transition is its own endpoint, versioned on the handling record (an
   exception nobody has acted on is version 0), with one audit row. No money
   (brief P1). */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime } from './common';
import { LocationOption } from './rota';

export const ExceptionState = z.enum(['open', 'prog', 'resolved', 'ignored', 'reopened']);
export const ExceptionKind = z.enum(['Clearance', 'Coverage', 'Leave', 'Business Central', 'Compliance', 'Timesheet', 'Hours', 'Qualification']);
const Who = z.object({ personCode: z.string(), name: z.string() });
export const HandlingStep = z.object({ from: ExceptionState, to: ExceptionState, by: Who, at: IsoDateTime, note: z.string() });
export const ExceptionItem = z.object({
  id: z.string(), version: z.number().int().nonnegative(),
  /* the fact it was derived from, which the id is the hash of */
  key: z.string(), kind: ExceptionKind, severity: z.number().int().min(1).max(4), subject: z.string(), text: z.string(),
  /* null: every location's, such as a failed batch posting */
  location: z.string().nullable(),
  /* the view the fact is put right on */
  source: z.string(),
  state: ExceptionState, owner: Who.nullable(), resolution: z.string(),
  /* when someone first acted on it; null until then, as nothing is stored for an exception before that */
  firstRecorded: IsoDateTime.nullable(), history: z.array(HandlingStep),
});
export type ExceptionItem = z.infer<typeof ExceptionItem>;
export const ExceptionList = z.object({
  location: LocationOption, locations: z.array(LocationOption),
  /* highest severity first; every state, the screen filters */
  items: z.array(ExceptionItem),
});
export type ExceptionList = z.infer<typeof ExceptionList>;
export const ExceptionsQuery = z.object({ location: z.string().min(1).max(20).optional() });

export const ResolveException = z.strictObject({ note: z.string().max(500) });
export const IgnoreException = z.strictObject({ reason: z.string().max(500) });
export const ExceptionMoved = z.object({ record: ExceptionItem, auditId: z.string(), message: z.string() });
export type ExceptionMoved = z.infer<typeof ExceptionMoved>;

const IdParams = z.object({ id: z.string().min(1).max(40) });
const CAP = 'team_hours';
const MOVE_ERRORS = [404, 409] as const;
export const listExceptions = defineEndpoint({ method: 'GET', path: '/api/v1/exceptions', query: ExceptionsQuery, response: ExceptionList,
  capability: CAP, errors: [404],
  summary: 'The exceptions at one location, derived now, highest severity first, each with its handling. Query: location (default: the reader\'s own). A location outside the reader\'s scope is refused with scope.' });
export const takeException = defineEndpoint({ method: 'POST', path: '/api/v1/exceptions/:id/take', params: IdParams, response: ExceptionMoved,
  capability: CAP, versioned: true, errors: [...MOVE_ERRORS],
  summary: 'Take it (If-Match): in progress, owned by the caller. From open or reopened; otherwise ILLEGAL_TRANSITION. One audit row.' });
export const releaseException = defineEndpoint({ method: 'POST', path: '/api/v1/exceptions/:id/release', params: IdParams, response: ExceptionMoved,
  capability: CAP, versioned: true, errors: [...MOVE_ERRORS],
  summary: 'Back to open (If-Match), owned by nobody. From in progress only. One audit row.' });
export const resolveException = defineEndpoint({ method: 'POST', path: '/api/v1/exceptions/:id/resolve', params: IdParams, request: ResolveException,
  response: ExceptionMoved, capability: CAP, versioned: true, errors: [...MOVE_ERRORS],
  summary: 'Resolve it with a note of what was done (If-Match); without one, 422 on note. From in progress or reopened. One audit row.' });
export const ignoreException = defineEndpoint({ method: 'POST', path: '/api/v1/exceptions/:id/ignore', params: IdParams, request: IgnoreException,
  response: ExceptionMoved, capability: CAP, versioned: true, errors: [...MOVE_ERRORS],
  summary: 'Ignore it with a reason (If-Match); without one, 422 on reason. The condition is still detected. From open, in progress or reopened. One audit row.' });
export const reopenException = defineEndpoint({ method: 'POST', path: '/api/v1/exceptions/:id/reopen', params: IdParams, response: ExceptionMoved,
  capability: CAP, versioned: true, errors: [...MOVE_ERRORS],
  summary: 'Reopen a resolved or ignored exception (If-Match). One audit row.' });
