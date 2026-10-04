/* 1c group 4 (brief D9): the bell's inbox and the notification matrix.
   Rows are addressed to a person; a person reads only their own. Only In-app
   is delivered: an item an Email-only channel recorded never reaches the
   inbox, and nothing here says an email or SMS was sent. An item whose source
   module is off is hidden, not deleted, and is not counted. A deep link is
   given only when the page it opens is on the reader's nav and built. */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDateTime, RecordMeta } from './common';

/* the same five as src/domain/notifications.ts NOTIF_CHANNELS (the contract test holds them together) */
export const NotifChannel = z.enum(['Off', 'In-app', 'Email', 'In-app + email', 'In-app + email + SMS']);
export type NotifChannel = z.infer<typeof NotifChannel>;
export const NotifPersona = z.enum(['employee', 'manager', 'admin']);

export const NotifLink = z.object({ view: z.string(), path: z.string(), label: z.string() });
export const NotificationItem = z.object({
  id: z.string(), area: z.string(), title: z.string(), body: z.string(), at: IsoDateTime, read: z.boolean(),
  /* "now", "4h", "2d", "1w", from the server's clock */
  ago: z.string(),
  /* where it opens, when that page is on the reader's nav and built; null otherwise */
  link: NotifLink.nullable(),
});
export type NotificationItem = z.infer<typeof NotificationItem>;
export const MyNotifications = z.object({ items: z.array(NotificationItem), unread: z.number().int().nonnegative() });
export type MyNotifications = z.infer<typeof MyNotifications>;
export const NotificationsRead = z.object({ unread: z.number().int().nonnegative(), marked: z.number().int().nonnegative(), auditId: z.string().nullable() });
export type NotificationsRead = z.infer<typeof NotificationsRead>;

/* null: the event never applies to that user type */
const Cell = NotifChannel.nullable();
export const MatrixEvent = z.object({
  code: z.string(), module: z.string(), label: z.string(), description: z.string(),
  channels: z.object({ employee: Cell, manager: Cell, admin: Cell }),
});
export type MatrixEvent = z.infer<typeof MatrixEvent>;
/* Retained for audit while flexible-worker monitoring is on: milestones and IT access requests. */
export const EvidenceRow = z.object({
  employee: z.string(), employeeId: z.string(), event: z.string(), at: IsoDateTime, recipient: z.string(), channel: z.string(), ref: z.string(),
});
export type EvidenceRow = z.infer<typeof EvidenceRow>;
/* Only the events this tenant can raise: one whose module or feature is off is left out. */
export const NotificationMatrix = RecordMeta.extend({ events: z.array(MatrixEvent), evidence: z.array(EvidenceRow).nullable() });
export type NotificationMatrix = z.infer<typeof NotificationMatrix>;
export const UpdateMatrix = z.strictObject({
  events: z.record(z.string().max(40), z.strictObject({ employee: NotifChannel, manager: NotifChannel, admin: NotifChannel }).partial()),
});
export type UpdateMatrix = z.infer<typeof UpdateMatrix>;
export const MatrixSaved = z.object({ record: NotificationMatrix, auditId: z.string().nullable(), message: z.string() });
export type MatrixSaved = z.infer<typeof MatrixSaved>;

export const getMyNotifications = defineEndpoint({ method: 'GET', path: '/api/v1/notifications/me', response: MyNotifications,
  summary: 'My notifications, newest first: only my own, only those delivered in-app, only from modules that are on, each with its link when I can open it, and my unread count' });
export const markNotificationRead = defineEndpoint({ method: 'POST', path: '/api/v1/notifications/:id/read', params: z.object({ id: z.string().min(1).max(40) }),
  response: NotificationsRead, errors: [404], summary: 'Mark one of my notifications read. Someone else\'s is not found. One audit row; none when it was already read.' });
export const markAllNotificationsRead = defineEndpoint({ method: 'POST', path: '/api/v1/notifications/read-all', response: NotificationsRead,
  summary: 'Mark every notification in my inbox read. One audit row; none when nothing was unread.' });
export const getNotificationMatrix = defineEndpoint({ method: 'GET', path: '/api/v1/notifications/matrix', response: NotificationMatrix, capability: 'framework',
  summary: 'Who is told of each event, per user type and channel, for the events this tenant can raise; with the evidence table while flexible-worker monitoring is on' });
export const updateNotificationMatrix = defineEndpoint({ method: 'PATCH', path: '/api/v1/notifications/matrix', request: UpdateMatrix, response: MatrixSaved,
  capability: 'framework', versioned: true, errors: [409],
  summary: 'Change channels in the matrix (If-Match). An event that is switched off is MODULE_OFF; a role an event never applies to is refused. Email and SMS are recorded as not connected. One audit row.' });
