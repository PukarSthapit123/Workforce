import { server } from './node';
import { store } from './store';
import { MatrixSaved, MyNotifications, NotifChannel, NotificationMatrix, NotificationsRead } from '@/contract/notifications';
import { Refusal } from '@/contract/common';
import { NOTIF_CHANNELS } from '@/domain/notifications';
import { audits, caller, fault, resetTo, snapshot, tokenFor, type Persona } from '@/test/api-helpers';

beforeAll(() => server.listen({ onUnhandledRequest: 'error' })); afterAll(() => server.close());
beforeEach(() => resetTo('social'));

const as = async (p: Persona) => caller(await tokenFor(p));
const mine = async (call: Awaited<ReturnType<typeof as>>) => MyNotifications.parse((await call('GET', '/api/v1/notifications/me')).body);
const matrix = async (call: Awaited<ReturnType<typeof as>>) => NotificationMatrix.parse((await call('GET', '/api/v1/notifications/matrix')).body);
const refusal = (r: { body: unknown }) => Refusal.parse(r.body);
const own = () => audits().filter(a => a.act !== 'Signed in');
const setModule = (k: string, on: boolean) => { const t = store.coll<{ modules: Record<string, boolean> }>('tenant').tenant; if (t) t.modules[k] = on; };
const WRITES = ['notifications', 'notifMatrix', 'audit'];

test('the contract\'s channels are the catalogue\'s', () => {
  expect(NotifChannel.options).toEqual([...NOTIF_CHANNELS]);
});

describe('my notifications (Review Focus 4)', () => {
  test('mine only, newest first, with the unread count and a link only where I can go', async () => {
    const me = await mine(await as('employee'));
    expect(me.items.map(i => [i.title, i.ago, i.read])).toEqual([
      ['Open shift matches your alerts', '4h', false], ['Leave request sent', '1d', false], ['Rota published', '2d', true], ['Timesheet approved', '2d', true]]);
    expect(me.unread).toBe(2);
    expect(me.items.map(i => i.link?.path ?? null)).toEqual(['/work/shifts', '/work/leave', '/work/shifts', '/work/ts']);
    const mgr = await mine(await as('manager'));
    expect(mgr.items).toHaveLength(6);
    /* Workforce opens People for a manager; Timesheet opens Approvals */
    expect(mgr.items.find(i => i.area === 'Workforce')?.link).toEqual({ view: 'tpeople', path: '/team/tpeople', label: 'People' });
    /* the admin's Timesheet target, Payroll readiness, is not built yet: no link */
    const adm = await mine(await as('admin'));
    expect(adm.items.find(i => i.area === 'Integration')?.link).toEqual({ view: 'asetup', path: '/setup/asetup', label: 'Qnipay setup' });
  });
  test('an item whose module is off is hidden and not counted, and comes back with the module', async () => {
    const call = await as('employee');
    setModule('R', false);
    const off = await mine(call);
    expect(off.items.map(i => i.area)).toEqual(['Leave', 'Timesheet']);
    expect(off.unread).toBe(1);
    setModule('R', true);
    expect((await mine(call)).unread).toBe(2);
  });
  test('marking one read lowers the count with one audit row; someone else\'s is not found; again changes nothing', async () => {
    const call = await as('employee'), first = (await mine(call)).items[0];
    if (!first) throw new Error('no item');
    const r = NotificationsRead.parse((await call('POST', `/api/v1/notifications/${first.id}/read`)).body);
    expect(r).toMatchObject({ unread: 1, marked: 1, auditId: expect.any(String) });
    expect(own()).toEqual([expect.objectContaining({ act: 'Notification read', entityId: first.id })]);
    const again = NotificationsRead.parse((await call('POST', `/api/v1/notifications/${first.id}/read`)).body);
    expect(again).toEqual({ unread: 1, marked: 0, auditId: null });
    const theirs = (await mine(await as('manager'))).items[0];
    const before = snapshot(...WRITES);
    const r404 = await call('POST', `/api/v1/notifications/${theirs?.id ?? ''}/read`);
    expect(r404.status).toBe(404);
    expect(snapshot(...WRITES)).toEqual(before);
  });
  test('mark all read marks what is in my inbox, once; a hidden item stays unread', async () => {
    const call = await as('employee');
    setModule('R', false);
    const r = NotificationsRead.parse((await call('POST', '/api/v1/notifications/read-all')).body);
    expect(r).toMatchObject({ unread: 0, marked: 1 });
    expect(own().filter(a => a.act === 'Notifications marked read')).toHaveLength(1);
    expect(NotificationsRead.parse((await call('POST', '/api/v1/notifications/read-all')).body)).toEqual({ unread: 0, marked: 0, auditId: null });
    setModule('R', true);
    expect((await mine(call)).unread).toBe(1);
  });
});

describe('the matrix (Review Focus 1, 4, 7)', () => {
  test('framework only; events of an off module are hidden; the evidence table shows while FLEXMON is on', async () => {
    const emp = await as('employee');
    expect((await emp('GET', '/api/v1/notifications/matrix')).status).toBe(403);
    const call = await as('admin'), m = await matrix(call);
    expect(m.version).toBe(0);
    expect(m.events.find(e => e.code === 'lv_ok')?.channels).toEqual({ employee: 'In-app + email', manager: 'Off', admin: 'Off' });
    expect(m.events.some(e => e.code === 'ts_geo')).toBe(false); // GEOFENCE is off in social
    expect(m.evidence?.map(e => e.channel)).toEqual(expect.arrayContaining(['In-app, email not connected.']));
    expect(JSON.stringify(m.evidence)).not.toMatch(/sent/i);
    setModule('R', false);
    expect((await matrix(call)).events.some(e => e.module === 'Rota')).toBe(false);
  });
  test('a change is saved whole with one audit row, and the migrated event follows it: Leave approved off for Employee tells nobody', async () => {
    const call = await as('admin');
    const r = await call('PATCH', '/api/v1/notifications/matrix', { events: { lv_ok: { employee: 'Off' } } }, 0);
    expect(r.status).toBe(200);
    const saved = MatrixSaved.parse(r.body);
    expect(saved.record.version).toBe(1);
    expect(saved.message).toBe('Leave approved for Employee: off.');
    expect(own()).toEqual([expect.objectContaining({ act: 'Notification settings changed', before: { 'lv_ok.employee': 'In-app + email' } })]);
    const mgr = await as('manager');
    expect((await mgr('POST', '/api/v1/leave/requests/lr_1/approve', undefined, 1)).status).toBe(200);
    const told = Object.values(store.coll<{ personId: string; title: string }>('notifications')).filter(n => n.personId === 'CP-1201' && n.title === 'Leave approved');
    expect(told).toEqual([]);
  });
  test('an email channel is recorded on the row as not connected and never reaches the inbox', async () => {
    const call = await as('admin');
    expect((await call('PATCH', '/api/v1/notifications/matrix', { events: { lv_ok: { employee: 'Email' } } }, 0)).status).toBe(200);
    await (await as('manager'))('POST', '/api/v1/leave/requests/lr_1/approve', undefined, 1);
    const rows = Object.values(store.coll<{ personId: string; title: string; delivery?: unknown }>('notifications')).filter(n => n.personId === 'CP-1201' && n.title === 'Leave approved');
    expect(rows).toEqual([expect.objectContaining({ delivery: { inApp: false, email: 'not-connected', sms: null } })]);
  });
  test('stale, forbidden, switched off, never-applies and a fault each leave no change and no audit row', async () => {
    const call = await as('admin'), before = snapshot(...WRITES);
    expect((await call('PATCH', '/api/v1/notifications/matrix', { events: { lv_ok: { employee: 'Off' } } }, 3)).status).toBe(412);
    const mgr = await as('manager');
    const forbidden = await mgr('PATCH', '/api/v1/notifications/matrix', { events: { lv_ok: { employee: 'Off' } } }, 0);
    expect(forbidden.status).toBe(403);
    expect(refusal(forbidden).code).toBe('capability');
    const never = await call('PATCH', '/api/v1/notifications/matrix', { events: { cfg: { employee: 'In-app' } } }, 0);
    expect(refusal(never)).toMatchObject({ code: 'invalid', field: 'events.cfg.employee' });
    setModule('R', false);
    const off = await call('PATCH', '/api/v1/notifications/matrix', { events: { rt_pub: { employee: 'Off' } } }, 0);
    expect(off.status).toBe(409);
    expect(refusal(off).code).toBe('MODULE_OFF');
    setModule('R', true);
    await fault('PATCH', '/api/v1/notifications/matrix');
    expect((await call('PATCH', '/api/v1/notifications/matrix', { events: { lv_ok: { employee: 'Off' } } }, 0)).status).toBe(500);
    expect(snapshot('notifications', 'notifMatrix')).toEqual({ notifications: before.notifications, notifMatrix: before.notifMatrix });
    expect(own()).toEqual([]);
  });
});
