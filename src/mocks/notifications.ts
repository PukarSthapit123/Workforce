/* 1c group 4 (brief D9): the bell's inbox and the notification matrix. Every
   rule is src/domain/notifications.ts's; the handlers read the store into it.
   A refusal or a fault writes nothing, because serve() restores the store. */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor, onboardingNow } from './auth';
import { writeAudit } from './audit';
import { effectiveCode, recordAt } from './world';
import { MATRIX_ID, matrixNow, matrixRec, notifications, personaOf, switchesNow, type StoredMatrix, type StoredNotification } from './notify';
import {
  getMyNotifications, getNotificationMatrix, markAllNotificationsRead, markNotificationRead, updateNotificationMatrix,
  type EvidenceRow, type MatrixEvent, type NotificationItem, type NotificationMatrix,
} from '@/contract/notifications';
import type { ItRequest } from '@/contract/rota';
import type { AuthedSession } from './auth';
import {
  NOTIF_EVENTS, ageText, applyMatrixChange, channelFor, deliveryOf, deliveryText, eventShown, inboxOf, isNotifChannel, linkFor, unreadOf,
  type LiveContext,
} from '@/domain/notifications';
import { buildNav } from '@/domain/nav';
import { flagOn } from '@/domain/modules';

/* ---------------------------------------------------------------- inbox */
function inbox(s: AuthedSession): StoredNotification[] {
  const { modules, flags } = switchesNow();
  return inboxOf(Object.values(notifications()), effectiveCode(s), modules, flags);
}
function myNotifications(s: AuthedSession) {
  const { modules, flags } = switchesNow(), mine = inbox(s), now = store.now();
  const nav = buildNav({ caps: new Set(s.caps), modules, flags: Object.fromEntries(Object.entries(flags).map(([k, v]) => [k, Boolean(v)])), onboarding: onboardingNow(effectiveCode(s)) });
  const persona = personaOf(effectiveCode(s));
  const items: NotificationItem[] = mine.map(n => ({ id: n.id, area: n.area, title: n.title, body: n.body, at: n.at, read: n.read,
    ago: ageText(n.at, now), link: linkFor(n.area, persona, nav) }));
  return { items, unread: unreadOf(mine) };
}
const NOT_FOUND = { code: 'not-found', message: 'That notification is not in your inbox.', next: 'Open the bell again to see your notifications.' };

/* --------------------------------------------------------------- matrix */
interface TypeCapture { allowances?: string[] }
interface StoredEvidence { id: string; employee: string; employeeId: string; event: string; at: string; recipient: string; channel: string; ref: string }
function liveContext(): LiveContext {
  const { modules, flags } = switchesNow();
  const types = recordAt(store.coll<{ types?: Record<string, TypeCapture> }>('timesheetConfig'), 'timesheetConfig')?.types ?? {};
  return { modules, flags, allowances: Object.values(types).some(t => (t.allowances ?? []).length > 0) };
}
/* The matrix as stored, or the catalogue's defaults at version 0 when it has never been saved. */
const matrixRecord = (): StoredMatrix => matrixRec() ?? { id: MATRIX_ID, version: 0, updatedAt: store.now(), events: matrixNow() };
function evidence(ctx: LiveContext): EvidenceRow[] | null {
  if (!flagOn(ctx.modules, ctx.flags, 'FLEXMON')) return null;
  const kept = Object.values(store.coll<StoredEvidence>('notifEvidence')).map(e => ({ employee: e.employee, employeeId: e.employeeId, event: e.event, at: e.at,
    recipient: e.recipient, channel: isNotifChannel(e.channel) ? deliveryText(deliveryOf(e.channel)) : e.channel, ref: e.ref }));
  const it = Object.values(store.coll<ItRequest>('itRequests')).map(r => ({ employee: r.name, employeeId: r.personCode, event: 'IT access request',
    at: r.raisedAt, recipient: 'IT service desk', channel: 'System', ref: r.ref }));
  return [...kept, ...it];
}
function matrixView(m: StoredMatrix): NotificationMatrix {
  const ctx = liveContext();
  const events: MatrixEvent[] = NOTIF_EVENTS.filter(e => eventShown(e, ctx)).map(e => ({ code: e.code, module: e.module, label: e.label, description: e.description,
    channels: { employee: channelFor(m.events, e.code, 'employee'), manager: channelFor(m.events, e.code, 'manager'), admin: channelFor(m.events, e.code, 'admin') } }));
  return { id: m.id, version: m.version, updatedAt: m.updatedAt, events, evidence: evidence(ctx) };
}
const PERSONA_LABEL = { employee: 'Employee', manager: 'Manager', admin: 'Admin' } as const;
/* "Leave approved for Employee: off." One sentence per cell changed. */
function changeText(after: Record<string, string>): string {
  const parts = Object.entries(after).map(([key, c]) => {
    const [code = '', p = ''] = key.split('.');
    const label = NOTIF_EVENTS.find(e => e.code === code)?.label ?? code;
    return `${label} for ${PERSONA_LABEL[p as keyof typeof PERSONA_LABEL] ?? p}: ${c.toLowerCase()}.`;
  });
  return parts.join(' ');
}

export const notificationHandlers = [
  serve(getMyNotifications, ({ session }) => myNotifications(session)),

  serve(markNotificationRead, ({ session, params }) => {
    const n = recordAt(notifications(), params.id);
    if (!n || !inbox(session).some(x => x.id === n.id)) return refuse(404, NOT_FOUND);
    if (n.read) return { unread: myNotifications(session).unread, marked: 0, auditId: null };
    notifications()[n.id] = bump(n, { read: true });
    const auditId = writeAudit({ who: actor(session), act: 'Notification read', entity: 'notification', entityId: n.id,
      before: { read: false }, after: { read: true, detail: n.title } });
    return { unread: myNotifications(session).unread, marked: 1, auditId };
  }),

  serve(markAllNotificationsRead, ({ session }) => {
    const unread = inbox(session).filter(n => !n.read);
    if (!unread.length) return { unread: 0, marked: 0, auditId: null };
    for (const n of unread) notifications()[n.id] = bump(n, { read: true });
    const auditId = writeAudit({ who: actor(session), act: 'Notifications marked read', entity: 'notification', entityId: effectiveCode(session),
      before: { unread: unread.length }, after: { unread: 0, detail: `${unread.length} marked read` } });
    return { unread: myNotifications(session).unread, marked: unread.length, auditId };
  }),

  serve(getNotificationMatrix, () => matrixView(matrixRecord())),

  serve(updateNotificationMatrix, ({ session, body, checkVersion }) => {
    const m = matrixRecord();
    checkVersion(m);
    const r = applyMatrixChange(m.events, body.events, liveContext());
    if (!r.ok) return refuse(r.problem.status, { code: r.problem.code, message: r.problem.message, next: r.problem.next, field: r.problem.field });
    if (!Object.keys(r.after).length) return { record: matrixView(m), auditId: null, message: 'Nothing has changed.' };
    const saved = bump(m, { events: r.matrix });
    store.coll<StoredMatrix>(MATRIX_ID)[MATRIX_ID] = saved;
    const message = changeText(r.after);
    const auditId = writeAudit({ who: actor(session), act: 'Notification settings changed', entity: 'notifMatrix', entityId: MATRIX_ID,
      before: r.before, after: { ...r.after, detail: message } });
    return { record: matrixView(saved), auditId, message };
  }),
];
