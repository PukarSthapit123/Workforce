import { buildNav, everyTab } from './nav';
import {
  DEFAULT_MATRIX, NOTIF_CHANNELS, NOTIF_EVENTS, ageText, applyMatrixChange, areaLive, channelFor, channelLabel, deliveryOf, deliveryText, eventBy,
  eventShown, inboxOf, linkFor, plannedDeliveries, targetView, unreadOf, type InboxRow, type LiveContext,
} from './notifications';

const must = <T,>(v: T | undefined, what = 'value'): T => { if (v === undefined) throw new Error(`missing ${what}`); return v; };
const ALL = { CORE: true, TS: true, A: true, B: true, C: true, R: true, L: true, ON: true };
const FLAGS = { NOTICES: true, GEOFENCE: true, FULFIL: true };
const ctx = (over: Partial<LiveContext> = {}): LiveContext => ({ modules: ALL, flags: FLAGS, allowances: true, ...over });
const ev = (code: string) => must(eventBy(code), code);

describe('the catalogue (NOTIF_EVENTS, NOTIF_CHANNELS)', () => {
  test('carries the prototype\'s 30 events in its order, grouped by module, with their default channels', () => {
    expect(NOTIF_EVENTS).toHaveLength(30);
    expect(NOTIF_EVENTS.map(e => e.code).slice(0, 3)).toEqual(['ts_submitted', 'ts_approved', 'ts_returned']);
    expect([...new Set(NOTIF_EVENTS.map(e => e.module))]).toEqual(['Timesheet', 'Rota', 'Leave', 'Workforce']);
    expect(ev('lv_ok').defaults).toEqual({ employee: 'In-app + email', manager: 'Off', admin: 'Off' });
    expect(ev('cfg').defaults).toEqual({ employee: null, manager: null, admin: 'In-app + email' });
    expect(NOTIF_CHANNELS).toEqual(['Off', 'In-app', 'Email', 'In-app + email', 'In-app + email + SMS']);
    expect(DEFAULT_MATRIX.rt_it).toEqual({ employee: null, manager: 'In-app', admin: 'In-app + email' });
  });
  test('an email or SMS channel is labelled not connected', () => {
    expect(NOTIF_CHANNELS.map(channelLabel)).toEqual(['Off', 'In-app', 'Email (not connected)', 'In-app + email (not connected)', 'In-app + email + SMS (not connected)']);
  });
});

describe('what is offered and what is live', () => {
  test('an event is hidden while its module is off, Timesheet while neither capture method is on', () => {
    expect(eventShown(ev('rt_pub'), ctx({ modules: { ...ALL, R: false } }))).toBe(false);
    expect(eventShown(ev('lv_req'), ctx({ modules: { ...ALL, L: false } }))).toBe(false);
    expect(eventShown(ev('ts_submitted'), ctx({ modules: { ...ALL, A: false, B: false } }))).toBe(false);
    expect(eventShown(ev('ts_submitted'), ctx({ modules: { ...ALL, A: false } }))).toBe(true);
    expect(eventShown(ev('pf_req'), ctx({ modules: { CORE: true } }))).toBe(true);
  });
  test('an event that needs a feature or allowances is hidden without it', () => {
    expect(eventShown(ev('ts_geo'), ctx({ flags: { ...FLAGS, GEOFENCE: false } }))).toBe(false);
    expect(eventShown(ev('ts_geo'), ctx({ modules: { ...ALL, C: false } }))).toBe(false);
    expect(eventShown(ev('notice_posted'), ctx({ flags: { ...FLAGS, NOTICES: false } }))).toBe(false);
    expect(eventShown(ev('ts_allow'), ctx({ allowances: false }))).toBe(false);
    expect(eventShown(ev('ts_allow'), ctx())).toBe(true);
  });
  test('an area is live with its source (NOTIF_SRC_MOD); Workforce and Integration always are', () => {
    const off = { CORE: true };
    expect(['Rota', 'Leave', 'Timesheet', 'Onboarding', 'Notices', 'Workforce', 'Integration'].map(a => areaLive(a, off, {}))).toEqual([false, false, false, false, false, true, true]);
    expect(['Rota', 'Leave', 'Timesheet', 'Onboarding', 'Notices'].map(a => areaLive(a, ALL, FLAGS))).toEqual([true, true, true, true, true]);
  });
});

describe('delivery (Review Focus 4)', () => {
  test('Off and a dash deliver nothing; only In-app is delivered; email and SMS are never delivered, only recorded as not connected', () => {
    expect(deliveryOf('Off')).toBeNull();
    expect(deliveryOf(null)).toBeNull();
    expect(deliveryOf('In-app')).toEqual({ inApp: true, email: null, sms: null });
    expect(deliveryOf('Email')).toEqual({ inApp: false, email: 'not-connected', sms: null });
    expect(deliveryOf('In-app + email + SMS')).toEqual({ inApp: true, email: 'not-connected', sms: 'not-connected' });
    for (const c of NOTIF_CHANNELS) expect(deliveryText(deliveryOf(c))).not.toMatch(/sent/i);
    expect(deliveryText(deliveryOf('In-app + email'))).toBe('In-app, email not connected.');
    expect(deliveryText(deliveryOf('Email'))).toBe('Email not connected.');
  });
  test('the matrix is read per recipient\'s user type, and a change to it is respected', () => {
    const people = [{ personCode: 'E1', persona: 'employee' as const }, { personCode: 'M1', persona: 'manager' as const }, { personCode: 'A1', persona: 'admin' as const }];
    expect(plannedDeliveries(ev('lv_ok'), people, DEFAULT_MATRIX, ALL, FLAGS).map(d => [d.personCode, d.channel])).toEqual([['E1', 'In-app + email']]);
    const off = { ...DEFAULT_MATRIX, lv_ok: { employee: 'Off' as const, manager: 'In-app' as const, admin: 'Off' as const } };
    expect(plannedDeliveries(ev('lv_ok'), people, off, ALL, FLAGS).map(d => d.personCode)).toEqual(['M1']);
    expect(channelFor(off, 'lv_ok', 'employee')).toBe('Off');
    expect(channelFor({}, 'lv_ok', 'employee')).toBe('In-app + email');
  });
  test('an event whose module is off reaches nobody; a recipient named twice is told once', () => {
    const p = [{ personCode: 'E1', persona: 'employee' as const }, { personCode: 'E1', persona: 'employee' as const }];
    expect(plannedDeliveries(ev('rt_pub'), p, DEFAULT_MATRIX, { ...ALL, R: false }, FLAGS)).toEqual([]);
    expect(plannedDeliveries(ev('rt_pub'), p, DEFAULT_MATRIX, ALL, FLAGS)).toHaveLength(1);
  });
});

describe('deep links (NOTIF_TARGETS, notifReachable)', () => {
  const nav = (...caps: string[]) => buildNav({ caps: new Set(caps), modules: ALL, flags: FLAGS, onboarding: false });
  test('each area opens its page for each user type; an unknown area opens the Workforce one', () => {
    expect(['Timesheet', 'Rota', 'Leave', 'DBS', 'Workforce'].map(a => targetView(a, 'manager'))).toEqual(['tteam', 'trota', 'tleave', 'tpeople', 'tpeople']);
    expect(['Timesheet', 'Rota', 'Leave', 'DBS', 'Workforce'].map(a => targetView(a, 'employee'))).toEqual(['ts', 'shifts', 'leave', 'profile', 'home']);
    expect(['Timesheet', 'Rota', 'Leave', 'DBS', 'Workforce'].map(a => targetView(a, 'admin'))).toEqual(['ipay', 'mrota', 'mleave', 'apeople', 'asetup']);
    expect(targetView('Integration', 'admin')).toBe('asetup');
    expect(targetView('Notices', 'employee')).toBe('notices');
  });
  test('a link is offered only when the page is on that person\'s nav and built', () => {
    expect(linkFor('Rota', 'manager', nav('team_rota'))).toEqual({ view: 'trota', path: '/team/trota', label: 'Rota' });
    expect(linkFor('Rota', 'manager', nav('team_ts'))).toBeNull();
    expect(linkFor('Timesheet', 'admin', nav('integration'))).toBeNull(); // ipay is not built yet
    expect(linkFor('Workforce', 'employee', nav('own_home'))).toEqual({ view: 'home', path: '/work/home', label: 'Home' }); // built in 1c group 7
    expect(linkFor('Workforce', 'employee', nav('own_ts'))).toBeNull(); // not on the nav without own_home
    expect(linkFor('Workforce', 'admin', nav('mod_cfg'))).toEqual({ view: 'asetup', path: '/setup/asetup', label: 'Qnipay setup' });
  });
  test('every page the app knows is listed once, whoever reaches it', () => {
    const paths = everyTab().map(t => t.path);
    expect(paths).toEqual(expect.arrayContaining(['/work/onb', '/work/home', '/team/trota', '/setup/anotif', '/setup/ipay']));
    expect(new Set(paths).size).toBe(paths.length);
  });
});

describe('the inbox', () => {
  const row = (id: string, area: string, at: string, read = false, over: Partial<InboxRow> = {}): InboxRow => ({ id, personId: 'E1', area, at, read, ...over });
  test('mine, delivered in-app, from a live source, newest first; the unread count follows it', () => {
    const rows = [row('n1', 'Rota', '2026-08-10T09:00:00.000Z'), row('n2', 'Leave', '2026-08-12T09:00:00.000Z', true), row('n3', 'Leave', '2026-08-11T09:00:00.000Z'),
      row('n4', 'Leave', '2026-08-13T09:00:00.000Z', false, { personId: 'M1' }), row('n5', 'Leave', '2026-08-13T09:00:00.000Z', false, { delivery: { inApp: false, email: 'not-connected', sms: null } })];
    const mine = inboxOf(rows, 'E1', ALL, FLAGS);
    expect(mine.map(r => r.id)).toEqual(['n2', 'n3', 'n1']);
    expect(unreadOf(mine)).toBe(2);
    const rotaOff = inboxOf(rows, 'E1', { ...ALL, R: false }, FLAGS);
    expect(rotaOff.map(r => r.id)).toEqual(['n2', 'n3']);
    expect(unreadOf(rotaOff)).toBe(1);
  });
  test('the age reads as the prototype\'s ago column', () => {
    const now = '2026-08-13T14:30:00.000Z';
    expect(['2026-08-13T14:30:00.000Z', '2026-08-13T14:10:00.000Z', '2026-08-13T10:30:00.000Z', '2026-08-11T14:30:00.000Z', '2026-08-06T14:30:00.000Z'].map(a => ageText(a, now)))
      .toEqual(['now', '20m', '4h', '2d', '1w']);
  });
});

describe('changing the matrix', () => {
  test('a change lists each cell before and after, and keeps the rest', () => {
    const r = applyMatrixChange(DEFAULT_MATRIX, { lv_ok: { employee: 'Off', manager: 'Off' }, rt_pub: { manager: 'In-app + email' } }, ctx());
    if (!r.ok) throw new Error(r.problem.message);
    expect(r.before).toEqual({ 'lv_ok.employee': 'In-app + email', 'rt_pub.manager': 'In-app' });
    expect(r.after).toEqual({ 'lv_ok.employee': 'Off', 'rt_pub.manager': 'In-app + email' });
    expect(r.matrix.lv_ok).toEqual({ employee: 'Off', manager: 'Off', admin: 'Off' });
    expect(r.matrix.ts_submitted).toEqual(DEFAULT_MATRIX.ts_submitted);
  });
  test('an unknown event, a role the event never applies to and an event that is switched off are refused', () => {
    const bad = (change: Parameters<typeof applyMatrixChange>[1], c = ctx()) => { const r = applyMatrixChange(DEFAULT_MATRIX, change, c); return r.ok ? null : r.problem; };
    expect(bad({ nope: { employee: 'Off' } })).toMatchObject({ status: 422, field: 'events.nope' });
    expect(bad({ cfg: { employee: 'In-app' } })).toMatchObject({ status: 422, field: 'events.cfg.employee', message: 'Configuration changed never applies to that role.' });
    expect(bad({ rt_pub: { employee: 'Off' } }, ctx({ modules: { ...ALL, R: false } }))).toMatchObject({ status: 409, code: 'MODULE_OFF' });
  });
});
