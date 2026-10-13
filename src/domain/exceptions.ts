/* Exceptions (module 6 group 2): the prototype's exception centre, IMP-015
   (qnipay-workforce-v15.html:7757-7859, 10001-10022, 11461-11475).

   An exception is derived on every read from the data as it stands (P's
   detectExceptions): a flag on someone's hours, a colleague not cleared to
   work, a qualification about to expire, scheduled days with no hours, a day
   under the minimum on shift, a leave request past its approval SLA, a failed
   posting. Nothing is stored for it until someone acts on it. Its key is
   built from the fact itself (P's excSig): it survives a re-derive while the
   fact holds, and changes when the fact changes, so a resolved exception never
   masks a new one. The handling record, stored under that key, holds the
   state, the owner, the note and the history.

   Every function here is pure; the server and the screen give the same answer.
   No money (brief P1). */
import type { HoursFlag } from './rota';
import { escalationText } from './leave';
import { formatDayMonth, formatDmy, weekdayShort } from './time';

/* --------------------------------------------------------------- states */
export const EXCEPTION_STATES = ['open', 'prog', 'resolved', 'ignored', 'reopened'] as const;
export type ExceptionState = (typeof EXCEPTION_STATES)[number];
export type ExceptionTone = 'err' | 'warn' | 'ok' | 'neu';
/* EXC_STATES (v15:7757-7763): each state's label, pill and glyph, and the
   states it may move to, in P's button order. */
export const EXC_STATES: Readonly<Record<ExceptionState, { label: string; tone: ExceptionTone; glyph: string; next: readonly ExceptionState[] }>> = {
  open: { label: 'Open', tone: 'err', glyph: '●', next: ['prog', 'ignored'] },
  prog: { label: 'In progress', tone: 'warn', glyph: '◐', next: ['resolved', 'ignored', 'open'] },
  resolved: { label: 'Resolved', tone: 'ok', glyph: '✓', next: ['reopened'] },
  ignored: { label: 'Ignored', tone: 'neu', glyph: '—', next: ['reopened'] },
  reopened: { label: 'Reopened', tone: 'err', glyph: '↻', next: ['prog', 'resolved', 'ignored'] },
};
/* excOpen: what "Needs action" means */
export const needsAction = (st: ExceptionState) => st === 'open' || st === 'prog' || st === 'reopened';

/* Each transition is its own endpoint. release is P's "Back to open". */
export const EXCEPTION_MOVES = ['take', 'release', 'resolve', 'ignore', 'reopen'] as const;
export type ExceptionMove = (typeof EXCEPTION_MOVES)[number];
export const MOVE_TO: Readonly<Record<ExceptionMove, ExceptionState>> = { take: 'prog', release: 'open', resolve: 'resolved', ignore: 'ignored', reopen: 'reopened' };
const MOVE_OF: Readonly<Record<ExceptionState, ExceptionMove>> = { prog: 'take', open: 'release', resolved: 'resolve', ignored: 'ignore', reopened: 'reopen' };
/* P's button labels (v15:7832-7834) */
export const MOVE_LABEL: Readonly<Record<ExceptionMove, string>> = { take: 'Take it', release: 'Back to open', resolve: 'Resolve', ignore: 'Ignore', reopen: 'Reopen' };
const MOVE_VERB: Readonly<Record<ExceptionMove, string>> = { take: 'taken', release: 'moved back to open', resolve: 'resolved', ignore: 'ignored', reopen: 'reopened' };
/* The moves a state offers, in P's order. */
export const movesFrom = (st: ExceptionState): ExceptionMove[] => EXC_STATES[st].next.map(s => MOVE_OF[s]);
/* resolve and ignore open the dialog that asks for the note; the others act at once */
export const asksForNote = (m: ExceptionMove) => m === 'resolve' || m === 'ignore';

/* --------------------------------------------------------------- refusals */
export interface ExceptionRefusal { status: 403 | 404 | 409 | 422; code: string; message: string; next: string; field?: string }
export const NO_EXCEPTION: ExceptionRefusal = { status: 404, code: 'not-found',
  message: 'That exception is no longer detected. The fact behind it has changed.', next: 'Reload the page to see the exceptions as they stand.' };
export const NOTE_REQUIRED: ExceptionRefusal = { status: 422, code: 'invalid', field: 'note',
  message: 'A resolution note is required.', next: 'Say what was done, then resolve it.' };
export const REASON_REQUIRED: ExceptionRefusal = { status: 422, code: 'invalid', field: 'reason',
  message: 'A reason is required to ignore an exception.', next: 'Say why it is being ignored, then ignore it.' };
const list = (xs: readonly string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} or ${xs.at(-1) ?? ''}` : xs[0] ?? '');
/* excTransition's refusal (v15:7764-7766): "An open exception cannot move to resolved". */
export function illegalMove(from: ExceptionState, move: ExceptionMove): ExceptionRefusal {
  const to = EXC_STATES[MOVE_TO[move]].label.toLowerCase(), label = EXC_STATES[from].label.toLowerCase();
  return { status: 409, code: 'ILLEGAL_TRANSITION', message: `A${/^[aeiou]/.test(label) ? 'n' : ''} ${label} exception cannot move to ${to}.`,
    next: `It can be ${list(movesFrom(from).map(m => MOVE_VERB[m]))}.` };
}
/* Whether the move is allowed from this state, and has the note it needs. */
export function moveProblem(from: ExceptionState, move: ExceptionMove, note: string): ExceptionRefusal | null {
  if (!EXC_STATES[from].next.includes(MOVE_TO[move])) return illegalMove(from, move);
  if (move === 'resolve' && !note.trim()) return NOTE_REQUIRED;
  if (move === 'ignore' && !note.trim()) return REASON_REQUIRED;
  return null;
}

/* --------------------------------------------------------- the handling */
export interface Who { personCode: string; name: string }
export interface HandlingStep { from: ExceptionState; to: ExceptionState; by: Who; at: string; note: string }
export interface Handling { state: ExceptionState; owner: Who | null; resolution: string; history: HandlingStep[] }
export const UNHANDLED: Handling = Object.freeze({ state: 'open', owner: null, resolution: '', history: [] });
/* The handling after a legal move (excTransition). Taking it makes the
   caller the owner; back to open leaves it with nobody; resolve and ignore
   record the note as the resolution. Every move is one step of history. */
export function applyMove(h: Handling, move: ExceptionMove, by: Who, at: string, note: string): Handling {
  const to = MOVE_TO[move], n = note.trim();
  return {
    state: to,
    owner: move === 'take' ? by : move === 'release' ? null : h.owner,
    resolution: asksForNote(move) ? n : h.resolution,
    history: [...h.history, { from: h.state, to, by, at, note: n }],
  };
}
/* The audit row's act: "Exception resolved" (v15:7771). */
export const moveAuditAct = (move: ExceptionMove) => `Exception ${EXC_STATES[MOVE_TO[move]].label.toLowerCase()}`;
/* P's toasts (v15:11466-11474). Reopening says what it does, where P reused "Moved back to open". */
export const MOVE_TOAST: Readonly<Record<ExceptionMove, string>> = {
  take: 'Taken · you are now the owner', release: 'Moved back to open', resolve: 'Resolved · recorded against the exception',
  ignore: 'Ignored · recorded against the exception', reopen: 'Reopened · it needs action again',
};

/* ------------------------------------------------------------- severity */
export const EXCEPTION_KINDS = ['Clearance', 'Coverage', 'Leave', 'Business Central', 'Compliance', 'Timesheet', 'Hours', 'Qualification'] as const;
export type ExceptionKind = (typeof EXCEPTION_KINDS)[number];
/* P's severities (v15:7795-7817): coverage and clearance first, then hours and qualifications. */
export const SEVERITY: Readonly<Record<ExceptionKind, number>> = {
  Clearance: 4, Coverage: 4, Leave: 4, 'Business Central': 4, Compliance: 3, Timesheet: 3, Hours: 2, Qualification: 2,
};
export const SEVERITY_TIP = 'Ranked by consequence: coverage and clearance first, then hours and qualifications. It is not a queue order — take whichever you can resolve.';
export const severityTone = (sev: number): ExceptionTone => (sev >= 4 ? 'err' : sev === 3 ? 'warn' : 'neu');
/* The screen each kind is put right on (P's act). */
export const SOURCE_VIEW: Readonly<Record<ExceptionKind, string>> = {
  Clearance: 'tpeople', Coverage: 'trota', Leave: 'tleave', 'Business Central': 'ibc', Compliance: 'thours', Timesheet: 'tteam', Hours: 'thours', Qualification: 'tpeople',
};

/* ------------------------------------------------------------ the key */
/* FNV-1a, run twice with different offsets for 64 bits: a short, URL-safe id
   for a key. Not cryptographic; it only has to be stable. */
function hash64(text: string): string {
  const run = (offset: number) => {
    let h = offset;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16).padStart(8, '0');
  };
  return run(0x811c9dc5) + run(0x01000193);
}
/* The key is built from stored values, never from display text, so a change
   to the date format or a label cannot turn one exception into another. */
export const exceptionKey = (kind: ExceptionKind, subjectId: string, fact: string) => `${kind}|${subjectId}|${fact}`;
export const exceptionId = (key: string) => `exc_${hash64(key)}`;

/* ----------------------------------------------------------- derivation */
export interface PersonFacts {
  code: string; name: string; location: string;
  /* the week at their location, its hours position flags, and the days before today scheduled with nothing recorded */
  weekStart: string;
  flags: readonly HoursFlag[]; missing: readonly string[];
  cleared: boolean; dbsExpiry: string; qualifications: string;
}
export interface ExceptionFacts {
  people: readonly PersonFacts[];
  gaps: readonly { location: string; locationName: string; date: string; onShift: number; min: number }[];
  leave: readonly { id: string; personCode: string; name: string; location: string; escalateTo: string }[];
  /* failed postings; location is the posted day's colleague's, or null for a batch, which is everyone's */
  postings: readonly { id: string; ref: string; attempt: number; reason: string; location: string | null }[];
}
export interface DerivedException {
  id: string; key: string; kind: ExceptionKind; severity: number; subject: string; text: string;
  /* where it belongs, for location scope; null for one that is every location's */
  location: string | null; source: string;
}

export const clearanceText = (dbsExpiry: string) =>
  (dbsExpiry ? `Not cleared to work. DBS expired ${formatDmy(dbsExpiry)}.` : 'Not cleared to work. No DBS check recorded.');
/* A qualification note that says something expires, not one already expired (v15:7801). */
export const expiringSoon = (q: string) => /expire/i.test(q) && !/expired/i.test(q);
export const missingText = (n: number) => `${n} scheduled day${n === 1 ? '' : 's'} with no hours recorded`;
export const coverageText = (date: string, on: number, min: number) => `${weekdayShort(date)} ${formatDayMonth(date)} is ${on} of ${min}`;
export const postingText = (reason: string, attempt: number) => `Posting failed · ${reason || 'no reason recorded'} · attempt ${attempt}`;

/* detectExceptions (v15:7792-7820), highest severity first, otherwise in
   the order found. A flag that is only a note (nights) is not an exception.
   P's flexible worker milestone is not derived: no count of a bank worker's
   weeks is stored. */
export function deriveExceptions(f: ExceptionFacts): DerivedException[] {
  const out: DerivedException[] = [];
  const add = (kind: ExceptionKind, subjectId: string, fact: string, subject: string, text: string, location: string | null) => {
    const key = exceptionKey(kind, subjectId, fact);
    out.push({ id: exceptionId(key), key, kind, severity: SEVERITY[kind], subject, text, location, source: SOURCE_VIEW[kind] });
  };
  for (const p of f.people) {
    for (const fl of p.flags) if (fl.c !== 'neu') add(fl.c === 'err' ? 'Compliance' : 'Hours', p.code, `${p.weekStart}|${fl.k}`, p.name, fl.k, p.location);
    if (!p.cleared) add('Clearance', p.code, `uncleared|${p.dbsExpiry}`, p.name, clearanceText(p.dbsExpiry), p.location);
    if (expiringSoon(p.qualifications)) add('Qualification', p.code, p.qualifications, p.name, p.qualifications, p.location);
    if (p.missing.length) add('Timesheet', p.code, p.missing.join(','), p.name, missingText(p.missing.length), p.location);
  }
  for (const g of f.gaps) add('Coverage', g.location, `${g.date}|${g.onShift}/${g.min}`, g.locationName, coverageText(g.date, g.onShift, g.min), g.location);
  for (const l of f.leave) add('Leave', l.personCode, l.id, l.name, escalationText(l.escalateTo), l.location);
  for (const x of f.postings) add('Business Central', x.id, `${x.id}|${x.attempt}`, x.ref, postingText(x.reason, x.attempt), x.location);
  return out.map((x, i) => ({ x, i })).sort((a, b) => b.x.severity - a.x.severity || a.i - b.i).map(({ x }) => x);
}

/* ---------------------------------------------------------- the screen */
export const EXCEPTION_FILTERS = ['open', 'prog', 'resolved', 'ignored', 'all'] as const;
export type ExceptionFilter = (typeof EXCEPTION_FILTERS)[number];
export const inFilter = (f: ExceptionFilter, st: ExceptionState) => (f === 'all' ? true : f === 'open' ? needsAction(st) : st === f);
export const filterLabel = (f: ExceptionFilter) => (f === 'all' ? 'All' : f === 'open' ? 'Needs action' : EXC_STATES[f].label);
export const filterCounts = (states: readonly ExceptionState[]): Record<ExceptionFilter, number> =>
  Object.fromEntries(EXCEPTION_FILTERS.map(f => [f, states.filter(st => inFilter(f, st)).length])) as Record<ExceptionFilter, number>;
/* P's search (hit): who, what and the kind */
export const matches = (q: string, x: { subject: string; text: string; kind: string }) =>
  !q.trim() || `${x.subject} ${x.text} ${x.kind}`.toLowerCase().includes(q.trim().toLowerCase());
export const changesText = (n: number) => `${n} change${n === 1 ? '' : 's'}`;
