/* Notifications are stored rows in one collection (module 3 D8, module 4 D12),
   each addressed to a person. 1c group 4 (brief D9): every module raises an
   event from the catalogue (src/domain/notifications.ts) through notifyEvent,
   which reads the channel matrix in the column of each recipient's part in
   the event (subject, actor or back office; PART_COLUMN) and the tenant's
   modules. An Off channel stores nothing; Email and SMS are recorded
   on the row as not connected and never delivered; nothing is raised while
   the event's module is off. Ids are a zero-padded counter one past the
   highest stored, so they sort in write order under the frozen clock. */
import { store } from './store';
import { recordAt } from './world';
import {
  DEFAULT_MATRIX, PART_COLUMN, eventBy, isNotifPersona, plannedDeliveries, type Delivery, type EventMatrix, type NotifChannel, type NotifPart, type NotifPersona,
} from '@/domain/notifications';

export interface StoredNotification {
  id: string; version: number; updatedAt: string; personId: string; area: string; title: string; body: string; at: string; read: boolean;
  /* the catalogue event that raised it, the channel the matrix gave and what that channel did; a seeded row has none */
  event?: string; channel?: NotifChannel; delivery?: Delivery; ref?: string;
}
export interface StoredMatrix { id: string; version: number; updatedAt: string; events: EventMatrix }
export const MATRIX_ID = 'notifMatrix';
export const notifications = () => store.coll<StoredNotification>('notifications');
export const matrixRec = (): StoredMatrix | undefined => recordAt(store.coll<StoredMatrix>(MATRIX_ID), MATRIX_ID);
export const matrixNow = (): EventMatrix => matrixRec()?.events ?? DEFAULT_MATRIX;

interface TenantSwitches { modules: Record<string, boolean>; flags: Record<string, unknown> }
export const switchesNow = (): TenantSwitches => {
  const t = recordAt(store.coll<TenantSwitches>('tenant'), 'tenant');
  return { modules: t?.modules ?? {}, flags: t?.flags ?? {} };
};
interface Acc { personCode: string; userType: string }
/* The account's user type, for where an item opens. A person without an account is an employee. */
export const personaOf = (code: string): NotifPersona => {
  const t = Object.values(store.coll<Acc>('accounts')).find(a => a.personCode === code)?.userType;
  return isNotifPersona(t) ? t : 'employee';
};

const NTF = /^ntf_(\d{12})$/;
function nextId(coll: Record<string, unknown>): () => string {
  let max = 0;
  for (const id of Object.keys(coll)) max = Math.max(max, Number(NTF.exec(id)?.[1] ?? 0));
  return () => `ntf_${String(++max).padStart(12, '0')}`;
}

/* Raises one catalogue event to the people named, each taking the matrix
   column of the part the caller says they play. Returns the rows written. */
/* The row's area is the event's module unless the caller names a narrower one
   (a notice is filed under Notices, so it opens the notice board and hides with it). */
export function notifyEvent(code: string, part: NotifPart, recipients: Iterable<string>, n: { title: string; body: string; ref?: string; area?: string }): StoredNotification[] {
  const e = eventBy(code);
  if (!e) throw new Error(`There is no notification event "${code}".`);
  const { modules, flags } = switchesNow();
  const planned = plannedDeliveries(e, [...recipients].map(personCode => ({ personCode, persona: PART_COLUMN[part] })), matrixNow(), modules, flags);
  const coll = notifications(), next = nextId(coll);
  return planned.map(d => {
    const id = next();
    const row: StoredNotification = { id, version: 1, updatedAt: store.now(), personId: d.personCode, area: n.area ?? e.module, title: n.title, body: n.body, at: store.now(), read: false,
      event: e.code, channel: d.channel, delivery: d.delivery, ...(n.ref ? { ref: n.ref } : {}) };
    coll[id] = row;
    return row;
  });
}
