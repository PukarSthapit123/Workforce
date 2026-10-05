/* 1c group 4: the shared notification framework (brief D9). Ported from the
   prototype's NOTIF_CHANNELS, NOTIF_EVENTS (qnipay-workforce-v15.html:2163-2197),
   notifyEvent (2137-2148), NOTIF_TARGETS, notifTarget, notifReachable
   (5205-5225) and NOTIF_SRC_MOD, notifSrcLive (5247-5252).

   One platform model: every module raises an event from the catalogue; the
   matrix (anotif) says, per event and per user type, which channel is used.
   Only In-app is delivered. Email and SMS are recorded on the row as not
   connected and the screen says so; nothing ever claims they were sent. A
   row is addressed to a person. An item whose source module is off is hidden,
   never deleted, and comes back when the module does. A deep link is offered
   only when the page it opens is on that person's nav and built. */
import { captureOn, flagOn, modOn, type Switches } from './modules';
import type { NavGroup, NavTab } from './nav';

export const NOTIF_CHANNELS = ['Off', 'In-app', 'Email', 'In-app + email', 'In-app + email + SMS'] as const;
export type NotifChannel = typeof NOTIF_CHANNELS[number];
export const isNotifChannel = (v: unknown): v is NotifChannel => typeof v === 'string' && (NOTIF_CHANNELS as readonly string[]).includes(v);

/* The three user types (the prototype's emp, mgr and adm personas). */
export const NOTIF_PERSONAS = ['employee', 'manager', 'admin'] as const;
export type NotifPersona = typeof NOTIF_PERSONAS[number];
export const isNotifPersona = (v: unknown): v is NotifPersona => typeof v === 'string' && (NOTIF_PERSONAS as readonly string[]).includes(v);

export type EventModule = 'Timesheet' | 'Rota' | 'Leave' | 'Workforce';
/* null: the event never applies to that user type (shown as a dash). */
export type EventChannels = Readonly<Record<NotifPersona, NotifChannel | null>>;
/* What else an event needs before it is offered in settings: an employee type
   with allowances (ts_allow), or a feature switched on. */
export type EventNeed = { kind: 'allowances' } | { kind: 'flag'; flag: string };
export interface NotifEvent { code: string; module: EventModule; label: string; description: string; defaults: EventChannels; needs?: EventNeed }

const ch = (employee: NotifChannel | null, manager: NotifChannel | null, admin: NotifChannel | null): EventChannels => ({ employee, manager, admin });
export const NOTIF_EVENTS: readonly NotifEvent[] = [
  { code: 'ts_submitted', module: 'Timesheet', label: 'Timesheet submitted', description: 'A day or week arrives for approval', defaults: ch(null, 'In-app + email', 'Off') },
  { code: 'ts_approved', module: 'Timesheet', label: 'Timesheet approved', description: 'Sign-off complete and handed to Business Central', defaults: ch('In-app + email', 'Off', 'Off') },
  { code: 'ts_returned', module: 'Timesheet', label: 'Timesheet returned', description: 'Sent back with a reason', defaults: ch('In-app + email', 'In-app', 'Off') },
  { code: 'ts_overdue', module: 'Timesheet', label: 'Overdue approval', description: 'A submission has passed its approval SLA', defaults: ch(null, 'In-app + email', 'Email') },
  { code: 'ts_cutoff', module: 'Timesheet', label: 'Cut-off approaching', description: 'Unsubmitted days close to the deadline', defaults: ch('Email', 'In-app', 'Off') },
  { code: 'ts_missing', module: 'Timesheet', label: 'Missing days at cut-off', description: 'The period closed with gaps', defaults: ch(null, 'In-app + email', 'Email') },
  { code: 'ts_late', module: 'Timesheet', label: 'Late clock-in', description: 'A shift started after its scheduled time', defaults: ch('In-app', 'In-app', 'Off') },
  { code: 'ts_absence', module: 'Timesheet', label: 'Non-working day submitted', description: 'Leave, sickness or another absence reason', defaults: ch(null, 'In-app', 'Off') },
  { code: 'ts_allow', module: 'Timesheet', label: 'Allowance above review threshold', description: 'A claim a manager should look at', defaults: ch(null, 'In-app', 'Off'), needs: { kind: 'allowances' } },
  { code: 'ts_proxy', module: 'Timesheet', label: 'Entered on someone’s behalf', description: 'A manager logged time for an employee', defaults: ch('In-app', 'Off', 'Off') },
  { code: 'ts_geo', module: 'Timesheet', label: 'Clocked in outside the site radius', description: 'Geofence check failed', defaults: ch('In-app', 'In-app + email', 'Off'), needs: { kind: 'flag', flag: 'GEOFENCE' } },
  { code: 'rt_pub', module: 'Rota', label: 'Rota published', description: 'A week has been released to employees', defaults: ch('In-app + email', 'In-app', 'Off') },
  { code: 'rt_cov', module: 'Rota', label: 'Coverage issue', description: 'A shift has fallen below minimum staffing', defaults: ch(null, 'In-app + email', 'In-app') },
  { code: 'rt_cover', module: 'Rota', label: 'Cover request opened', description: 'A shift is being advertised', defaults: ch('In-app + email', 'In-app', 'Off') },
  { code: 'rt_stage', module: 'Rota', label: 'Fulfilment stage change', description: 'The audience has widened to the next stage', defaults: ch('In-app + email', 'In-app', 'Off') },
  { code: 'rt_esc', module: 'Rota', label: 'Fulfilment escalation', description: 'A cover request has reached the Service Manager', defaults: ch(null, 'In-app + email', 'Email') },
  { code: 'rt_assign', module: 'Rota', label: 'Worker assigned', description: 'Somebody has been placed on a shift', defaults: ch('In-app + email', 'In-app', 'Off') },
  { code: 'rt_it', module: 'Rota', label: 'IT access request raised', description: 'A fulfilled shift needs site access', defaults: ch(null, 'In-app', 'In-app + email') },
  { code: 'rt_9wk', module: 'Rota', label: 'Flexible worker · 9-week milestone', description: 'A bank worker has reached 9 weeks', defaults: ch(null, 'In-app', 'In-app + email') },
  { code: 'rt_12wk', module: 'Rota', label: 'Flexible worker · 12-week milestone', description: 'A bank worker has reached 12 weeks', defaults: ch(null, 'In-app', 'In-app + email') },
  { code: 'lv_req', module: 'Leave', label: 'Leave requested', description: 'An employee has submitted a request', defaults: ch('In-app', 'In-app + email', 'Off') },
  { code: 'lv_ok', module: 'Leave', label: 'Leave approved', description: 'A request has been granted', defaults: ch('In-app + email', 'Off', 'Off') },
  { code: 'lv_no', module: 'Leave', label: 'Leave rejected', description: 'A request has been declined with a reason', defaults: ch('In-app + email', 'Off', 'Off') },
  { code: 'lv_late', module: 'Leave', label: 'Leave approval overdue', description: 'The approval SLA has been breached', defaults: ch('In-app', 'In-app + email', 'Email') },
  { code: 'lv_esc', module: 'Leave', label: 'Leave escalation', description: 'A request has moved to the next approver', defaults: ch('In-app', 'In-app + email', 'In-app + email') },
  { code: 'lv_ent', module: 'Leave', label: 'Entitlement changed', description: 'A recalculation has altered a balance', defaults: ch('In-app + email', 'In-app', 'In-app') },
  { code: 'pf_req', module: 'Workforce', label: 'Profile change requested', description: 'A colleague has proposed a change to their own details', defaults: ch('In-app', 'In-app + email', 'Off') },
  { code: 'pf_done', module: 'Workforce', label: 'Profile change decided', description: 'A proposed change was approved or declined', defaults: ch('In-app + email', 'Off', 'Off') },
  { code: 'notice_posted', module: 'Workforce', label: 'Notice posted', description: 'A notice went live, or its text changed, for people in its audience', defaults: ch('In-app', 'In-app', 'Off'), needs: { kind: 'flag', flag: 'NOTICES' } },
  /* configurable, but not raised by any 1c write (D9) */
  { code: 'cfg', module: 'Workforce', label: 'Configuration changed', description: 'Template, feature, employee type or policy edited', defaults: ch(null, null, 'In-app + email') },
];
export const eventBy = (code: string) => NOTIF_EVENTS.find(e => e.code === code);
export type EventMatrix = Readonly<Record<string, EventChannels>>;
export const DEFAULT_MATRIX: EventMatrix = Object.fromEntries(NOTIF_EVENTS.map(e => [e.code, e.defaults]));

/* ---------------------------------------------------------- what is live */
export interface LiveContext { modules: Switches; flags: Readonly<Record<string, unknown>>; allowances: boolean }
/* The module an area's items come from (NOTIF_SRC_MOD). Timesheet is live
   while either capture method is on, as every Timesheet gate reads it; a
   notice is live while the notice board is. Workforce, Integration and any
   other area are always live. */
export function areaLive(area: string, modules: Switches, flags: Readonly<Record<string, unknown>>): boolean {
  if (area === 'Timesheet') return captureOn(modules);
  if (area === 'Rota') return modOn(modules, 'R');
  if (area === 'Leave') return modOn(modules, 'L');
  if (area === 'Onboarding') return modOn(modules, 'ON');
  if (area === 'Notices') return flagOn(modules, flags, 'NOTICES');
  return true;
}
/* Offered in settings: its module is live and what it needs is there (admNotifications). */
export function eventShown(e: NotifEvent, ctx: LiveContext): boolean {
  if (!areaLive(e.module, ctx.modules, ctx.flags)) return false;
  if (e.needs?.kind === 'allowances') return ctx.allowances;
  if (e.needs?.kind === 'flag') return flagOn(ctx.modules, ctx.flags, e.needs.flag);
  return true;
}

/* ------------------------------------------------------------- delivery */
/* What a channel does: in-app is delivered; email and SMS are not connected. */
export interface Delivery { inApp: boolean; email: 'not-connected' | null; sms: 'not-connected' | null }
export function deliveryOf(channel: NotifChannel | null | undefined): Delivery | null {
  if (!channel || channel === 'Off') return null;
  return { inApp: channel.includes('In-app'), email: /email/i.test(channel) ? 'not-connected' : null, sms: channel.includes('SMS') ? 'not-connected' : null };
}
/* The channel an event uses for a user type: the matrix's, else the catalogue default. */
export function channelFor(matrix: EventMatrix, code: string, persona: NotifPersona): NotifChannel | null {
  const row = Object.hasOwn(matrix, code) ? matrix[code] : eventBy(code)?.defaults;
  return row?.[persona] ?? null;
}
/* How a channel reads on screen. Never "sent" for email or SMS. */
export function deliveryText(d: Delivery | null): string {
  if (!d) return 'Off';
  const parts = [d.inApp && 'in-app', d.email && 'email not connected', d.sms && 'SMS not connected'].filter((x): x is string => !!x);
  const text = parts.join(', ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
/* An option's label in the matrix: an email or SMS channel says it is not connected. */
export const channelLabel = (c: NotifChannel) => (c === 'Email' ? 'Email (not connected)' : c === 'In-app + email' ? 'In-app + email (not connected)'
  : c === 'In-app + email + SMS' ? 'In-app + email + SMS (not connected)' : c);

/* A recipient's part in the event picks the matrix column, whatever their
   account type (the prototype's employee, manager and admin inboxes): the
   person the event is about takes the Employee column, an approver or manager
   acting on it (a delegate too) the Manager column, and the back office told
   for oversight (HR, IT, administrators) the Admin column. */
export const NOTIF_PARTS = ['subject', 'actor', 'backOffice'] as const;
export type NotifPart = typeof NOTIF_PARTS[number];
export const PART_COLUMN: Readonly<Record<NotifPart, NotifPersona>> = { subject: 'employee', actor: 'manager', backOffice: 'admin' };

/* Who an event reaches: each recipient whose column's channel is not Off,
   with what that channel delivers (notifyEvent). Nothing at all while the
   event's module is off. */
export interface Recipient { personCode: string; persona: NotifPersona }
export function plannedDeliveries(e: NotifEvent, recipients: readonly Recipient[], matrix: EventMatrix, modules: Switches, flags: Readonly<Record<string, unknown>>) {
  if (!areaLive(e.module, modules, flags)) return [];
  const seen = new Set<string>();
  return recipients.flatMap(r => {
    if (seen.has(r.personCode)) return [];
    seen.add(r.personCode);
    const channel = channelFor(matrix, e.code, r.persona), delivery = deliveryOf(channel);
    return channel && delivery ? [{ personCode: r.personCode, channel, delivery }] : [];
  });
}

/* ------------------------------------------------------------ deep links */
/* Where an item opens, per area and user type (NOTIF_TARGETS). An area the
   table does not name opens the Workforce destination. */
export const NOTIF_TARGETS: Readonly<Record<string, Readonly<Record<NotifPersona, string>>>> = {
  Timesheet: { employee: 'ts', manager: 'tteam', admin: 'ipay' },
  Rota: { employee: 'shifts', manager: 'trota', admin: 'mrota' },
  Leave: { employee: 'leave', manager: 'tleave', admin: 'mleave' },
  DBS: { employee: 'profile', manager: 'tpeople', admin: 'apeople' },
  Workforce: { employee: 'home', manager: 'tpeople', admin: 'asetup' },
  Notices: { employee: 'notices', manager: 'notices', admin: 'tnotices' },
};
export function targetView(area: string, persona: NotifPersona): string {
  const m = (Object.hasOwn(NOTIF_TARGETS, area) ? NOTIF_TARGETS[area] : undefined) ?? NOTIF_TARGETS.Workforce;
  return m?.[persona] ?? 'home';
}
/* The tab a view opens on this person's nav, when it is there and built
   (notifReachable). A view that is not on the nav, or not built yet, is no link. */
export function reachableTab(view: string, nav: readonly NavGroup[]): NavTab | null {
  return nav.flatMap(g => g.tabs).find(t => t.view === view && t.built && !t.back) ?? null;
}
export interface NotifLink { view: string; path: string; label: string }
export function linkFor(area: string, persona: NotifPersona, nav: readonly NavGroup[]): NotifLink | null {
  const t = reachableTab(targetView(area, persona), nav);
  return t ? { view: t.view, path: t.path, label: t.label } : null;
}

/* ------------------------------------------------------------ the inbox */
export interface InboxRow { id: string; personId: string; area: string; at: string; read: boolean; delivery?: Delivery }
/* Mine, delivered in-app, from a live source, newest first. */
export function inboxOf<R extends InboxRow>(rows: readonly R[], personCode: string, modules: Switches, flags: Readonly<Record<string, unknown>>): R[] {
  return rows.filter(r => r.personId === personCode && (r.delivery?.inApp ?? true) && areaLive(r.area, modules, flags))
    .sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));
}
export const unreadOf = (rows: readonly InboxRow[]) => rows.filter(r => !r.read).length;
/* "2d", "4h", "now": the prototype's ago column. */
export function ageText(at: string, now: string): string {
  const mins = Math.max(0, Math.floor((Date.parse(now) - Date.parse(at)) / 60000));
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return d < 7 ? `${d}d` : `${Math.floor(d / 7)}w`;
}

/* ------------------------------------------------- changing the matrix */
export interface MatrixProblem { status: 409 | 422; code: string; message: string; next: string; field: string }
export type MatrixChange = Readonly<Record<string, Partial<Record<NotifPersona, NotifChannel>>>>;
/* Applies a change to the matrix, or says why it cannot be made. Only shown
   events can change (one whose module is off is hidden), and a user type an
   event never applies to keeps its dash. */
export function applyMatrixChange(matrix: EventMatrix, change: MatrixChange, ctx: LiveContext):
  { ok: true; matrix: Record<string, EventChannels>; before: Record<string, NotifChannel | null>; after: Record<string, NotifChannel> } | { ok: false; problem: MatrixProblem } {
  const next: Record<string, EventChannels> = Object.fromEntries(NOTIF_EVENTS.map(e => [e.code, { ...((Object.hasOwn(matrix, e.code) ? matrix[e.code] : undefined) ?? e.defaults) }]));
  const before: Record<string, NotifChannel | null> = {}, after: Record<string, NotifChannel> = {};
  for (const [code, cells] of Object.entries(change)) {
    const e = eventBy(code), row = next[code];
    if (!e || !row) return { ok: false, problem: { status: 422, code: 'invalid', field: `events.${code}`, message: `There is no notification event "${code}".`, next: 'Reload the page and choose an event from the list.' } };
    if (!eventShown(e, ctx)) return { ok: false, problem: { status: 409, code: 'MODULE_OFF', field: `events.${code}`, message: `${e.label} belongs to something that is switched off, so it cannot be changed.`, next: 'Turn it on under Modules & features first.' } };
    for (const [p, c] of Object.entries(cells)) {
      if (!isNotifPersona(p) || !c) continue;
      if (row[p] === null) return { ok: false, problem: { status: 422, code: 'invalid', field: `events.${code}.${p}`, message: `${e.label} never applies to that role.`, next: 'Leave that cell as it is.' } };
      if (row[p] === c) continue;
      before[`${code}.${p}`] = row[p];
      after[`${code}.${p}`] = c;
      const cells: Record<NotifPersona, NotifChannel | null> = { ...(next[code] ?? row) };
      cells[p] = c;
      next[code] = cells;
    }
  }
  return { ok: true, matrix: next, before, after };
}
