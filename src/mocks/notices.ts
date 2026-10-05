/* 1c group 6: the notice board (brief D10). Every rule is
   src/domain/notices.ts's; the handlers read the store into it. The audience
   is worked out from the people collection on every read, never copied onto
   the notice. A refusal or a fault writes nothing, because serve() restores
   the store. One audit row per write; going live, or a text change on a live
   notice, raises notice_posted to the audience through the channel matrix. */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { effectiveCode, nameOf, people, personByCode, recordAt, today, type Signed, type StoredPerson } from './world';
import { tenantRec } from './tenant';
import { notifyEvent } from './notify';
import {
  acknowledgeNotice, createNotice, deleteNotice, editNotice, getMyNotice, listMyNotices, listPostedNotices, pinNotice, postNotice, trackNotice, withdrawNotice,
  type PosterNotice, type ReaderNotice, type StatusFilter,
} from '@/contract/notices';
import type { AuditEntry } from '@/contract/audit';
import {
  ALREADY_POSTED, AUDIENCE_FIXED, DRAFT_DELETED, DRAFT_SAVED, NOTHING_CHANGED, NOTICES_OFF, NOTICE_STATUSES, NOT_LIVE, NO_LOCATION, NO_NOTICE, REASON_NEEDED,
  WITHDRAWN, ackProblem, ackedNow, ackedToast, audienceOf, cannotPostTo, editedToast, fieldsProblem, inScopes, latestAck, myNotices, noticeFor, noticeOrder,
  noticeScopes, noticeStatus, notDraft, outsideScope, owes, pinnedToast, planEdit, postedNote, postedNotices, postedToast, posterOrder, readerState,
  sameScope, scopeKey, scopeLabel, withdrawnToast, type Notice, type NoticePerson, type NoticeRefusal, type NoticeScope,
} from '@/domain/notices';
import { flagOn } from '@/domain/modules';

export interface StoredNotice extends Notice { version: number; updatedAt: string }
export const notices = () => store.coll<StoredNotice>('notices');
const refuseWith = (r: NoticeRefusal): never =>
  refuse(r.status, { code: r.code, message: r.message, next: r.next, ...(r.field ? { field: r.field } : {}) });

/* -------------------------------------------------------------- the world */
/* The notice board is a Workforce core feature: off, every surface refuses and the notices are kept. */
function requireBoard() {
  const t = tenantRec();
  if (!flagOn(t.modules, t.flags, 'NOTICES')) refuseWith(NOTICES_OFF);
}
const asPerson = (p: StoredPerson): NoticePerson => ({ code: p.code, location: p.location, department: p.department, active: p.state === 'active' });
const everyone = () => Object.values(people()).map(asPerson);
const names = { location: (c: string) => nameOf('locations', c), department: (c: string) => nameOf('departments', c) };
const labelOf = (s: NoticeScope) => scopeLabel(s, names);
interface Place { code: string; name: string; active?: boolean }
const scopesFor = (s: Signed) => noticeScopes({
  org: s.caps.includes('notice_org'), location: personByCode(effectiveCode(s))?.location ?? '', people: everyone(),
  locations: Object.values(store.coll<Place>('locations')).map(l => ({ code: l.code, name: l.name, active: l.active !== false })),
  departments: Object.values(store.coll<Place>('departments')).map(d => ({ code: d.code, name: d.name })),
});
const list = () => Object.values(notices());
const noticeAt = (id: string) => recordAt(notices(), id) ?? refuseWith(NO_NOTICE);
/* the poster's gate: the notice must be in a scope they may post to (noticeGate) */
function requireMine(s: Signed, n: StoredNotice) {
  if (!inScopes(n.scope, scopesFor(s))) refuseWith(outsideScope(n.title, labelOf(n.scope)));
}
const NTC = /^NTC-(\d+)$/;
function nextId(): string {
  let max = 0;
  for (const id of Object.keys(notices())) max = Math.max(max, Number(NTC.exec(id)?.[1] ?? 0));
  return `NTC-${String(max + 1).padStart(4, '0')}`;
}

/* ------------------------------------------------------------------ views */
const base = (n: StoredNotice) => ({
  id: n.id, version: n.version, updatedAt: n.updatedAt, textVersion: n.textVersion, title: n.title, body: n.body, scope: n.scope, scopeLabel: labelOf(n.scope),
  pinned: n.pinned, urgent: n.urgent, mustAck: n.mustAck, from: n.from, until: n.until, status: noticeStatus(n, today()), by: n.by, at: n.at,
});
function readerView(n: StoredNotice, code: string): ReaderNotice {
  const a = n.acks.find(x => x.personCode === code && x.textVersion === n.textVersion);
  return { ...base(n), you: readerState(n, code), acknowledgedAt: a?.at ?? null, owed: owes(n, code, today()) };
}
function posterView(n: StoredNotice, scopes: readonly NoticeScope[]): PosterNotice {
  const aud = audienceOf(n, everyone());
  return { ...base(n), state: n.state, withdrawReason: n.withdrawReason, mine: inScopes(n.scope, scopes), audience: aud.length,
    acknowledged: aud.filter(p => ackedNow(n, p.code)).length, history: n.history };
}
const viewFor = (s: Signed, n: StoredNotice) => posterView(n, scopesFor(s));

/* --------------------------------------------------------------- writing */
const audit = (s: Signed, act: string, n: StoredNotice, detail: string, before: Record<string, unknown> | null, after: Record<string, unknown> | null) =>
  writeAudit({ who: actor(s), act, entity: 'notice', entityId: n.id, before, after: after ? { ...after, detail } : { detail } });
/* Tells the audience: the event's matrix decides each person's channel. The
   poster is not told of their own notice, though they still count in its
   audience (main-session ruling). */
function tell(s: Signed, n: StoredNotice, updated: boolean) {
  const note = postedNote(n, labelOf(n.scope), updated), poster = s.account.personCode;
  const told = audienceOf(n, everyone()).map(p => p.code).filter(c => c !== poster);
  notifyEvent('notice_posted', 'subject', told, { ...note, area: 'Notices', ref: n.id });
}
/* Sends a notice live and returns how many it reaches (noticeGoLive). */
function goLive(s: Signed, n: StoredNotice): StoredNotice {
  const live = { ...n, state: 'live' as const };
  notices()[n.id] = live;
  tell(s, live, false);
  return live;
}
const posted = (n: StoredNotice) => postedToast(n.title, audienceOf(n, everyone()).length, labelOf(n.scope), noticeStatus(n, today()) === 'scheduled' ? n.from : null);
const checkFields = (f: { title: string; body: string; from: string; until: string }) => { const p = fieldsProblem(f); if (p) refuseWith(p); };

export const noticeHandlers = [
  serve(listMyNotices, ({ session }) => {
    requireBoard();
    const code = effectiveCode(session), me = personByCode(code);
    const mine = myNotices(list(), me && asPerson(me), today()).sort(noticeOrder);
    const items = mine.map(n => readerView(n, code)), current = items.filter(n => n.status === 'current').length;
    return { items, counts: { current, expired: items.length - current }, owed: items.filter(n => n.owed).length };
  }),

  serve(getMyNotice, ({ session, params }) => {
    requireBoard();
    const code = effectiveCode(session), me = personByCode(code);
    const n = myNotices(list(), me && asPerson(me), today()).find(x => x.id === params.id) ?? refuseWith(NO_NOTICE);
    return readerView(n, code);
  }),

  serve(acknowledgeNotice, ({ session, params, body }) => {
    requireBoard();
    const n = noticeAt(params.id), code = effectiveCode(session), me = personByCode(code);
    const problem = ackProblem(n, me && asPerson(me), today(), body.textVersion);
    if (problem) return refuseWith(problem);
    const saved = bump(n, { acks: [...n.acks, { personCode: code, textVersion: n.textVersion, at: store.now() }] });
    notices()[n.id] = saved;
    const auditId = audit(session, 'Notice acknowledged', saved, `v${n.textVersion} · outstanding → acknowledged`,
      { acknowledged: false }, { acknowledged: true, textVersion: n.textVersion });
    return { record: readerView(saved, code), auditId, message: ackedToast(n.title, n.textVersion) };
  }),

  serve(listPostedNotices, ({ session, query }) => {
    requireBoard();
    const scopes = scopesFor(session), all = postedNotices(list(), scopes).sort(posterOrder(today()));
    const statusOf = (n: StoredNotice) => noticeStatus(n, today());
    const counts = Object.fromEntries([['all', all.length], ...NOTICE_STATUSES.map(st => [st, all.filter(n => statusOf(n) === st).length])]) as Record<StatusFilter, number>;
    const want = query.status ?? 'all';
    const me = personByCode(effectiveCode(session));
    return {
      items: all.filter(n => want === 'all' || statusOf(n) === want).map(n => posterView(n, scopes)), counts,
      scopes: scopes.map(s => ({ scope: s, key: scopeKey(s), label: labelOf(s) })), org: session.caps.includes('notice_org'),
      location: me?.location ? nameOf('locations', me.location) : '', today: today(),
    };
  }),

  serve(trackNotice, ({ session, params }) => {
    requireBoard();
    const n = noticeAt(params.id), scopes = scopesFor(session);
    if (!postedNotices([n], scopes).length) refuseWith(outsideScope(n.title, labelOf(n.scope)));
    const here = personByCode(effectiveCode(session))?.location ?? '';
    const all = Object.values(people()).filter(p => p.state === 'active' && noticeFor(n, asPerson(p)));
    const visible = session.caps.includes('notice_org') ? all : all.filter(p => p.location === here);
    const trail = Object.values(store.coll<AuditEntry>('audit')).filter(a => a.entity === 'notice' && a.entityId === n.id)
      .sort((a, b) => b.id.localeCompare(a.id))
      .map(a => ({ id: a.id, at: a.at, who: a.who.name, act: a.act, detail: String((a.after as { detail?: unknown } | undefined)?.detail ?? '') }));
    return {
      notice: posterView(n, scopes),
      people: visible.map(p => {
        const a = latestAck(n, p.code);
        return { code: p.code, name: p.name, location: nameOf('locations', p.location), acknowledged: ackedNow(n, p.code), textVersion: a?.textVersion ?? null, at: a?.at ?? null };
      }),
      trail,
    };
  }),

  serve(createNotice, ({ session, body }) => {
    requireBoard();
    const scopes = scopesFor(session);
    if (!scopes.length) return refuseWith(NO_LOCATION);
    const from = body.from || today();
    checkFields({ ...body, from });
    if (!inScopes(body.scope, scopes)) return refuseWith(cannotPostTo(labelOf(body.scope)));
    const by = actor(session).name, id = nextId();
    const draft: StoredNotice = { id, version: 1, updatedAt: store.now(), textVersion: 1, title: body.title.trim(), body: body.body.trim(),
      scope: scopes.find(s => sameScope(s, body.scope)) ?? body.scope, pinned: body.pinned, urgent: body.urgent, mustAck: body.mustAck, from, until: body.until,
      state: 'draft', by, at: store.now(), withdrawReason: '', acks: [], history: [] };
    notices()[id] = draft;
    if (!body.post) {
      const auditId = audit(session, 'Notice drafted', draft, `new → draft · ${draft.title}`, null, { state: 'draft', title: draft.title, scope: labelOf(draft.scope) });
      return { record: viewFor(session, draft), auditId, message: DRAFT_SAVED };
    }
    const live = goLive(session, draft);
    const k = audienceOf(live, everyone()).length;
    const auditId = audit(session, 'Notice posted', live, `new → live · ${labelOf(live.scope)} · ${k} people`, null,
      { state: 'live', title: live.title, scope: labelOf(live.scope), audience: k });
    return { record: viewFor(session, live), auditId, message: posted(live) };
  }),

  serve(editNotice, ({ session, params, body, checkVersion }) => {
    requireBoard();
    const n = noticeAt(params.id);
    checkVersion(n);
    requireMine(session, n);
    if (n.state === 'withdrawn') return refuseWith(WITHDRAWN);
    const scopes = scopesFor(session);
    let scope = n.scope;
    if (body.scope && !sameScope(body.scope, n.scope)) {
      if (n.state !== 'draft') return refuseWith(AUDIENCE_FIXED);
      if (!inScopes(body.scope, scopes)) return refuseWith(cannotPostTo(labelOf(body.scope)));
      scope = body.scope;
    }
    const from = body.from || n.from;
    checkFields({ ...body, from });
    if (body.post && n.state !== 'draft') return refuseWith(ALREADY_POSTED);
    const by = actor(session).name;
    const plan = planEdit(n, { ...body, from }, by, store.now());
    const moved = !sameScope(scope, n.scope);
    if (!plan && !moved && !body.post) return { record: viewFor(session, n), auditId: null, message: NOTHING_CHANGED };
    const changes = [...(plan?.changes ?? []), ...(moved ? [`for ${labelOf(n.scope)} → ${labelOf(scope)}`] : [])];
    let saved = bump(n, { ...(plan?.next ?? {}), scope });
    notices()[n.id] = saved;
    if (body.post) {
      saved = goLive(session, saved);
      const k = audienceOf(saved, everyone()).length;
      const auditId = audit(session, 'Notice posted', saved, [`draft → live · ${labelOf(saved.scope)} · ${k} people`, ...changes].join(' · '),
        { state: 'draft' }, { state: 'live', audience: k });
      return { record: viewFor(session, saved), auditId, message: posted(saved) };
    }
    if (plan?.textChanged && saved.state === 'live') tell(session, saved, true);
    const detail = changes.join(' · ');
    const before = { textVersion: n.textVersion, title: n.title, mustAck: n.mustAck, urgent: n.urgent, pinned: n.pinned, from: n.from, until: n.until };
    const after = { textVersion: saved.textVersion, title: saved.title, mustAck: saved.mustAck, urgent: saved.urgent, pinned: saved.pinned, from: saved.from, until: saved.until };
    const auditId = audit(session, 'Notice edited', saved, detail, before, after);
    const again = saved.mustAck ? audienceOf(saved, everyone()).filter(p => !ackedNow(saved, p.code)).length : 0;
    const message = plan ? editedToast({ ...plan, next: saved }, again) : DRAFT_SAVED;
    return { record: viewFor(session, saved), auditId, message };
  }),

  serve(pinNotice, ({ session, params, body, checkVersion }) => {
    requireBoard();
    const n = noticeAt(params.id);
    checkVersion(n);
    requireMine(session, n);
    if (n.state === 'withdrawn') return refuseWith(WITHDRAWN);
    if (body.pinned === n.pinned) return { record: viewFor(session, n), auditId: null, message: NOTHING_CHANGED };
    const saved = bump(n, { pinned: body.pinned });
    notices()[n.id] = saved;
    const auditId = audit(session, body.pinned ? 'Notice pinned' : 'Notice unpinned', saved, `pinned ${body.pinned ? 'off → on' : 'on → off'}`,
      { pinned: n.pinned }, { pinned: body.pinned });
    return { record: viewFor(session, saved), auditId, message: pinnedToast(body.pinned) };
  }),

  serve(postNotice, ({ session, params, checkVersion }) => {
    requireBoard();
    const n = noticeAt(params.id);
    checkVersion(n);
    requireMine(session, n);
    if (n.state !== 'draft') return refuseWith(n.state === 'withdrawn' ? WITHDRAWN : ALREADY_POSTED);
    const live = goLive(session, bump(n, {}));
    const k = audienceOf(live, everyone()).length;
    const auditId = audit(session, 'Notice posted', live, `draft → live · ${labelOf(live.scope)} · ${k} people`, { state: 'draft' }, { state: 'live', audience: k });
    return { record: viewFor(session, live), auditId, message: posted(live) };
  }),

  serve(withdrawNotice, ({ session, params, body, checkVersion }) => {
    requireBoard();
    const n = noticeAt(params.id);
    checkVersion(n);
    requireMine(session, n);
    if (n.state === 'draft') return refuseWith(NOT_LIVE);
    if (n.state === 'withdrawn') return refuseWith(WITHDRAWN);
    const why = body.reason.trim();
    if (!why) return refuseWith(REASON_NEEDED);
    const saved = bump(n, { state: 'withdrawn', withdrawReason: why });
    notices()[n.id] = saved;
    const auditId = writeAudit({ who: actor(session), act: 'Notice withdrawn', entity: 'notice', entityId: n.id, before: { state: 'live' },
      after: { state: 'withdrawn', detail: `live → withdrawn · ${why}` }, reason: why });
    return { record: viewFor(session, saved), auditId, message: withdrawnToast(n.title) };
  }),

  serve(deleteNotice, ({ session, params, checkVersion }) => {
    requireBoard();
    const n = noticeAt(params.id);
    checkVersion(n);
    requireMine(session, n);
    if (n.state !== 'draft') return refuseWith(notDraft(n));
    Reflect.deleteProperty(notices(), n.id);
    const auditId = audit(session, 'Notice deleted', n, `draft → deleted · ${n.title}`, { state: 'draft', title: n.title }, null);
    return { auditId, message: DRAFT_DELETED };
  }),
];
