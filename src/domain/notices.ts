/* 1c group 6: the notice board (brief D10). Ported from the prototype's
   section 12b (qnipay-workforce-v15.html:5697-6097): seedNotices,
   noticeStatus, NOTICE_STATUS, noticeFor, noticeAudience, noticeAcked,
   noticeScopes, postedNotices, noticeOrder, noticeGate and noticeAction.

   Admins and managers publish notices to the people they are responsible
   for. An acknowledgement records that a person read one version of the
   text, so an edit to the words is a new version and asks everybody again.
   Nothing that went live is deleted: it is withdrawn, with a reason, and
   stays on record. Audience is worked out from the workforce record each
   time it is asked, so a mover or a starter sees the right notices without
   anything copied.

   Where the prototype and the brief part company, the brief wins:
   - `textVersion` is the prototype's `ver` (the words); the record's own
     `version` is the concurrency counter a write sends as If-Match;
   - acknowledging sends the textVersion it was read at, so an edit in
     between is refused (CHANGED) rather than acknowledged unseen;
   - a manager posts within their own location (from their record; the app
     has no "working in" picker), and anything wider needs notice_org.

   Every function is pure, so the server refuses with exactly what the
   screen shows. Copy is the prototype's, with each "·" aside rewritten as
   its own sentence. */
import { formatDmy } from './time';

/* ---------------------------------------------------------------- shapes */
export const SCOPE_KINDS = ['all', 'loc', 'dept'] as const;
export type ScopeKind = (typeof SCOPE_KINDS)[number];
/* A department scope carries the location it is limited to; '' is every location. */
export interface NoticeScope { kind: ScopeKind; code: string; loc: string }
export const NOTICE_STATES = ['draft', 'live', 'withdrawn'] as const;
export type NoticeState = (typeof NOTICE_STATES)[number];
export const NOTICE_STATUSES = ['draft', 'current', 'scheduled', 'expired', 'withdrawn'] as const;
export type NoticeStatus = (typeof NOTICE_STATUSES)[number];
export interface NoticeAck { personCode: string; textVersion: number; at: string }
export interface NoticeText { textVersion: number; title: string; body: string; by: string; at: string }
export interface Notice {
  id: string; textVersion: number; title: string; body: string; scope: NoticeScope;
  pinned: boolean; urgent: boolean; mustAck: boolean;
  /* ISO dates; until '' is no end date */
  from: string; until: string;
  state: NoticeState; by: string; at: string; withdrawReason: string;
  acks: NoticeAck[]; history: NoticeText[];
}
export interface NoticePerson { code: string; location: string; department: string; active: boolean }

/* ---------------------------------------------------------------- status */
/* Draft, live and withdrawn are stored. Scheduled and expired are read off
   the dates, so nobody has to remember to move a notice on. */
export function noticeStatus(n: Pick<Notice, 'state' | 'from' | 'until'>, today: string): NoticeStatus {
  if (n.state === 'draft') return 'draft';
  if (n.state === 'withdrawn') return 'withdrawn';
  if (n.until && n.until < today) return 'expired';
  if (n.from && n.from > today) return 'scheduled';
  return 'current';
}
export const NOTICE_STATUS: Readonly<Record<NoticeStatus, { label: string; tone: 'neu' | 'info' | 'ok' | 'err' }>> = {
  draft: { label: 'Draft', tone: 'neu' }, scheduled: { label: 'Scheduled', tone: 'info' }, current: { label: 'Live', tone: 'ok' },
  expired: { label: 'Expired', tone: 'neu' }, withdrawn: { label: 'Withdrawn', tone: 'err' },
};

/* -------------------------------------------------------------- audience */
export const noticeFor = (n: Pick<Notice, 'scope'>, p: Pick<NoticePerson, 'location' | 'department'> | undefined): boolean => !!p && (
  n.scope.kind === 'all'
  || (n.scope.kind === 'loc' && p.location === n.scope.code)
  || (n.scope.kind === 'dept' && p.department === n.scope.code && (!n.scope.loc || p.location === n.scope.loc)));
/* the active people a notice reaches, today */
export const audienceOf = <P extends NoticePerson>(n: Pick<Notice, 'scope'>, people: readonly P[]): P[] => people.filter(p => p.active && noticeFor(n, p));
export const ackedNow = (n: Pick<Notice, 'acks' | 'textVersion'>, code: string) => n.acks.some(a => a.personCode === code && a.textVersion === n.textVersion);
export const ackedEarlier = (n: Pick<Notice, 'acks' | 'textVersion'>, code: string) => !ackedNow(n, code) && n.acks.some(a => a.personCode === code);
/* the latest acknowledgement a person gave, at any version */
export const latestAck = (n: Pick<Notice, 'acks'>, code: string): NoticeAck | undefined =>
  n.acks.filter(a => a.personCode === code).sort((a, b) => b.textVersion - a.textVersion)[0];

/* What a colleague can see: live, started, and aimed at them. */
export const myNotices = <N extends Notice>(list: readonly N[], me: NoticePerson | undefined, today: string): N[] =>
  list.filter(n => ['current', 'expired'].includes(noticeStatus(n, today)) && noticeFor(n, me));
/* where a reader stands on one notice: the prototype's noticeStatePill */
export type ReaderState = 'info' | 'acknowledged' | 'again' | 'owed';
export function readerState(n: Notice, code: string): ReaderState {
  if (!n.mustAck) return 'info';
  if (ackedNow(n, code)) return 'acknowledged';
  if (ackedEarlier(n, code)) return 'again';
  return 'owed';
}
/* asked of me, and still open: current, must acknowledge, not yet at this version */
export const owes = (n: Notice, code: string, today: string) => noticeStatus(n, today) === 'current' && n.mustAck && !ackedNow(n, code);

/* ----------------------------------------------------------------- order */
/* urgent first, then pinned, then newest */
export const noticeOrder = (a: Notice, b: Notice) =>
  (Number(b.urgent) - Number(a.urgent)) || (Number(b.pinned) - Number(a.pinned)) || b.from.localeCompare(a.from);
/* the poster's list: draft, live, scheduled, expired, withdrawn, then as above */
const POSTER_RANK: readonly NoticeStatus[] = ['draft', 'current', 'scheduled', 'expired', 'withdrawn'];
export const posterOrder = (today: string) => (a: Notice, b: Notice) =>
  (POSTER_RANK.indexOf(noticeStatus(a, today)) - POSTER_RANK.indexOf(noticeStatus(b, today))) || noticeOrder(a, b);

/* ---------------------------------------------------------------- scopes */
export const scopeKey = (s: NoticeScope) => `${s.kind}:${s.code}:${s.loc}`;
export const sameScope = (a: NoticeScope, b: NoticeScope) => scopeKey(a) === scopeKey(b);
export interface ScopeWorld {
  /* holds notice_org */
  org: boolean;
  /* the poster's own location ('' when their record has none) */
  location: string;
  locations: readonly { code: string; name: string; active: boolean }[];
  departments: readonly { code: string; name: string }[];
  people: readonly NoticePerson[];
}
/* A manager works inside their own location and the departments people
   there belong to. Everything wider needs notice_org, and the server asks
   again rather than trusting the picker. */
export function noticeScopes(w: ScopeWorld): NoticeScope[] {
  if (w.org) return [
    { kind: 'all', code: '', loc: '' },
    ...w.locations.filter(l => l.active).map((l): NoticeScope => ({ kind: 'loc', code: l.code, loc: l.code })),
    ...w.departments.map((d): NoticeScope => ({ kind: 'dept', code: d.code, loc: '' })),
  ];
  if (!w.location) return [];
  const depts = [...new Set(w.people.filter(p => p.active && p.location === w.location).map(p => p.department).filter(Boolean))];
  return [{ kind: 'loc', code: w.location, loc: w.location }, ...depts.map((c): NoticeScope => ({ kind: 'dept', code: c, loc: w.location }))];
}
export const inScopes = (s: NoticeScope, scopes: readonly NoticeScope[]) => scopes.some(x => sameScope(x, s));
/* the notices a poster manages: everything they may target, plus organisation
   notices shown read-only so a manager knows what their people were told */
export const postedNotices = <N extends Notice>(list: readonly N[], scopes: readonly NoticeScope[]): N[] =>
  list.filter(n => inScopes(n.scope, scopes) || n.scope.kind === 'all');

export interface ScopeNames { location: (code: string) => string; department: (code: string) => string }
export const scopeLabel = (s: NoticeScope, names: ScopeNames) => (s.kind === 'all' ? 'Everyone'
  : s.kind === 'loc' ? names.location(s.code)
    : `${names.department(s.code)} · ${s.loc ? names.location(s.loc) : 'every location'}`);

/* ------------------------------------------------------------- refusals */
export interface NoticeRefusal { status: 403 | 404 | 409 | 422; code: string; message: string; next: string; field?: string }
export const NOTICES_OFF: NoticeRefusal = { status: 403, code: 'feature-off', message: 'The notice board is switched off for this tenant.',
  next: 'Turn it on in Qnipay setup → Modules and features.' };
export const NO_NOTICE: NoticeRefusal = { status: 404, code: 'not-found', message: 'That notice no longer exists.', next: 'Reload the page.' };
export const NO_LOCATION: NoticeRefusal = { status: 403, code: 'scope', message: 'You have no location to post to.',
  next: 'Ask an administrator to give you a location on your record.' };
export const outsideScope = (title: string, label: string): NoticeRefusal => ({ status: 403, code: 'scope',
  message: `${title} is outside your scope. It is for ${label}.`, next: 'Ask someone who can post there.' });
export const cannotPostTo = (label: string): NoticeRefusal => ({ status: 403, code: 'scope', field: 'scope',
  message: `You cannot post to ${label}. It needs Post notices to everyone in Permissions.`, next: 'Choose your location or a department within it.' });
export const AUDIENCE_FIXED: NoticeRefusal = { status: 409, code: 'AUDIENCE_FIXED', field: 'scope', message: 'The audience is fixed once a notice is live.',
  next: 'Withdraw it and post a new one to reach different people.' };
export const WITHDRAWN: NoticeRefusal = { status: 409, code: 'WITHDRAWN', message: 'This notice has been withdrawn, so it cannot be changed.',
  next: 'It stays on record. Post a new notice instead.' };
export const ALREADY_POSTED: NoticeRefusal = { status: 409, code: 'ALREADY_POSTED', message: 'Already posted.', next: 'It is live for everyone it reaches.' };
export const NOT_OPEN: NoticeRefusal = { status: 409, code: 'CLOSED', message: 'That notice is no longer open for acknowledgement.', next: 'Reload the page to see where it stands.' };
export const CHANGED: NoticeRefusal = { status: 409, code: 'CHANGED', message: 'This notice changed after you opened it.', next: 'Read the new version, then acknowledge again.' };
export const alreadyAcknowledged = (v: number): NoticeRefusal => ({ status: 409, code: 'ALREADY_ACKNOWLEDGED', message: `Already acknowledged. You acknowledged v${v}.`,
  next: 'Nothing more is needed.' });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
export function notDraft(n: Notice): NoticeRefusal {
  const k = n.acks.length;
  return { status: 409, code: 'NOT_DRAFT', next: 'Withdraw it instead.',
    message: `${n.title} cannot be deleted. It has been live${k ? ` and holds ${plural(k, 'acknowledgement')}` : ''}.` };
}
export const REASON_NEEDED: NoticeRefusal = { status: 422, code: 'invalid', field: 'reason', message: 'Give a reason. Colleagues who acknowledged keep their record.',
  next: 'Say why it is being withdrawn.' };
export const NOT_LIVE: NoticeRefusal = { status: 409, code: 'NOT_LIVE', message: 'A draft has not been posted, so there is nothing to withdraw.', next: 'Delete the draft instead.' };

/* --------------------------------------------------------------- writing */
export interface NoticeFields { title: string; body: string; from: string; until: string; mustAck: boolean; pinned: boolean; urgent: boolean }
/* A notice needs a title and its text, and cannot end before it starts. */
export function fieldsProblem(f: Pick<NoticeFields, 'title' | 'body' | 'from' | 'until'>): NoticeRefusal | null {
  if (!f.title.trim()) return { status: 422, code: 'invalid', field: 'title', message: 'Give the notice a title. Nothing has been saved.', next: 'Add a title, then save again.' };
  if (!f.body.trim()) return { status: 422, code: 'invalid', field: 'body', message: 'Write the notice. Nothing has been saved.', next: 'Write what colleagues need to know, then save again.' };
  if (f.until && f.until < f.from) return { status: 422, code: 'invalid', field: 'until', message: 'The end date is before the start date. Nothing has been saved.',
    next: 'Choose an end date on or after the start date, or leave it blank.' };
  return null;
}
/* Acknowledging: the notice is current, asks for it, reaches this person,
   is still at the version they read, and they have not already done so. */
export function ackProblem(n: Notice, me: NoticePerson | undefined, today: string, sentTextVersion: number): NoticeRefusal | null {
  if (!me || !noticeFor(n, me) || noticeStatus(n, today) !== 'current' || !n.mustAck) return NOT_OPEN;
  if (ackedNow(n, me.code)) return alreadyAcknowledged(n.textVersion);
  if (sentTextVersion !== n.textVersion) return CHANGED;
  return null;
}

const onOff = (b: boolean) => (b ? 'on → off' : 'off → on');
const dmyOr = (iso: string, none: string) => (iso ? formatDmy(iso) : none);
export interface EditPlan { next: Notice; textChanged: boolean; changes: string[] }
/* An edit. On a live notice only a title or text change makes a new
   version: the old words go to history and every acknowledgement stops
   counting but stays on record. Dates, pin, urgency and must-acknowledge
   change in place, each recorded before → after. A draft is simply
   rewritten. Null when nothing changed. */
export function planEdit(n: Notice, f: NoticeFields, by: string, at: string): EditPlan | null {
  const title = f.title.trim(), body = f.body.trim();
  const textChanged = title !== n.title || body !== n.body;
  const changes: string[] = [];
  if (f.mustAck !== n.mustAck) changes.push(`must acknowledge ${onOff(n.mustAck)}`);
  if (f.urgent !== n.urgent) changes.push(`urgent ${onOff(n.urgent)}`);
  if (f.pinned !== n.pinned) changes.push(`pinned ${onOff(n.pinned)}`);
  if (f.from !== n.from) changes.push(`from ${dmyOr(n.from, 'none')} → ${dmyOr(f.from, 'none')}`);
  if (f.until !== n.until) changes.push(`ends ${dmyOr(n.until, 'none')} → ${dmyOr(f.until, 'none')}`);
  if (!textChanged && !changes.length) return null;
  const rest = { mustAck: f.mustAck, urgent: f.urgent, pinned: f.pinned, from: f.from, until: f.until };
  if (n.state === 'draft')
    return { next: { ...n, ...rest, title, body, by, at }, textChanged, changes: textChanged ? ['text rewritten', ...changes] : changes };
  if (!textChanged) return { next: { ...n, ...rest }, textChanged, changes };
  const v = n.textVersion + 1;
  return {
    next: { ...n, ...rest, title, body, by, at, textVersion: v,
      history: [...n.history, { textVersion: n.textVersion, title: n.title, body: n.body, by: n.by, at: n.at }] },
    textChanged, changes: [`v${n.textVersion} → v${v}`, ...changes],
  };
}

/* ----------------------------------------------------------------- copy */
export const peopleIn = (k: number, label: string) => `${plural(k, 'person', 'people')} in ${label}`;
export const postedToast = (title: string, k: number, label: string, scheduledFrom: string | null) =>
  `Posted. ${title}. ${peopleIn(k, label)}.${scheduledFrom ? ` They see it from ${formatDmy(scheduledFrom)}.` : ''}`;
export const DRAFT_SAVED = 'Draft saved. Nobody sees it until you post it.';
export const NOTHING_CHANGED = 'Nothing has changed.';
export function editedToast(plan: EditPlan, again: number): string {
  const n = plan.next;
  if (n.state === 'draft') return DRAFT_SAVED;
  if (plan.textChanged) return `Saved as v${n.textVersion}. ${n.mustAck ? `${plural(again, 'person', 'people')} now need to acknowledge it.` : 'Colleagues see the new text.'}`;
  const list = plan.changes.join(', ');
  return `Saved. ${list.charAt(0).toUpperCase()}${list.slice(1)}.`;
}
export const pinnedToast = (pinned: boolean) => (pinned ? 'Pinned. It now sits at the top for everyone it reaches.' : 'Unpinned. It now sorts by date.');
export const DRAFT_DELETED = 'Draft deleted. Nobody had seen it.';
export const withdrawnToast = (title: string) => `Withdrawn. ${title}. Colleagues no longer see it. The record stays on My team → Notices.`;
export const ackedToast = (title: string, v: number) => `Acknowledged. ${title} v${v}. Whoever posted it can see this.`;
/* the notification a go-live or a text change sends to the audience */
export function postedNote(n: Notice, label: string, updated: boolean): { title: string; body: string } {
  if (updated) return { title: `Notice updated: ${n.title}`, body: `${label}.${n.mustAck ? ' Please acknowledge it again.' : ''}` };
  return { title: `${n.urgent ? 'Urgent notice' : 'Notice'}: ${n.title}`, body: `${label}.${n.mustAck ? ' Please acknowledge it.' : ''}` };
}
export const MUST_ACK_TIP = 'Colleagues must press Acknowledge. Editing the text later asks them again.';
export const URGENT_TIP = 'Shown first on Home, marked Urgent.';
