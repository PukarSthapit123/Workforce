/* 1c group 1: the tenant record, and the module, feature and settings
   switches on it. Every rule is src/domain/modules.ts's; the handlers build its
   inputs from the store and write its outputs. One audit row per request; a
   refusal or a fault writes nothing, because serve() restores the store.

   One home per setting (D6): the weekly grid's capture and layout live on
   timesheetConfig and the rota horizon on rotaConfig, so a write here goes
   through to that record and module 2 and 3 keep reading one source. Turning
   Rota off sets every scheduled shift aside in its own collection and turning
   it on puts them back (rotaShiftsOff / rotaShiftsOn), except on a day the
   person is now on leave or off sick: that cell takes the absence mark through
   module 3's week path when leave reaches the rota (module 4 D7), else it
   stays empty. */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import { recordAt } from './world';
import { leaveAbsenceOn } from './leave';
import { writeAbsence } from './rota';
import { casesInProgress } from './onboarding-cases';
import { getTenant, setFlag, setModule, updateTenantSettings, type ModuleEffect, type Tenant } from '@/contract/tenant';
import type { TimesheetConfig } from '@/contract/timesheets';
import type { RotaConfigRecord } from '@/contract/rota';
import {
  DEFAULT_EXTRAS, flagBy, flagChangeText, moduleSwitchText, restoreShifts, setAsideShifts, subName, switchFlag, switchModule,
  type Refusal as DomainRefusal, type WeekLines,
} from '@/domain/modules';
import { DEFAULT_ROTA_CONFIG, type RotaActor } from '@/domain/rota';
import { leaveCoverReason, leaveWritesRota } from '@/domain/leave';
import { addDays } from '@/domain/time';

interface Meta { id: string; version: number; updatedAt: string }
/* What the tenant record holds. rotaHorizon, weekGrid, weekLayout and
   rotaSetAside are read from their own homes into the view. */
export type StoredTenant = Omit<Tenant, 'rotaHorizon' | 'extras' | 'rotaSetAside'> & { extras: { breaksMax: number; vehiclesMax: number } };
interface SetAside extends Meta { weeks: Record<string, WeekLines>; count: number }
interface StoredWeek extends Meta { weekStart: string; lines: WeekLines }
interface StoredType extends Meta { code: string; name: string; capabilities: string[] }

const NO_TENANT = { code: 'not-found', message: 'This tenant has no settings loaded.', next: 'Reload the page. If it keeps happening, report it.' };
const SET_ASIDE = 'rotaSetAside';
export const tenantRec = (): StoredTenant => recordAt(store.coll<StoredTenant>('tenant'), 'tenant') ?? refuse(404, NO_TENANT);
export const saveTenant = (t: StoredTenant, changes: Partial<StoredTenant>) => {
  const saved = bump(t, changes);
  store.coll<StoredTenant>('tenant')[saved.id] = saved;
  return saved;
};
export const tsConfig = () => recordAt(store.coll<TimesheetConfig>('timesheetConfig'), 'timesheetConfig');
const rotaConfig = () => recordAt(store.coll<RotaConfigRecord>('rotaConfig'), 'rotaConfig');
const setAside = () => recordAt(store.coll<SetAside>(SET_ASIDE), SET_ASIDE);
const count = (coll: string) => Object.keys(store.coll(coll)).length;

export function view(t: StoredTenant): Tenant {
  const tc = tsConfig();
  return {
    ...t,
    flags: Object.fromEntries(Object.entries(t.flags).map(([k, v]) => [k, Boolean(v)])),
    restore: t.restore ?? {},
    rotaHorizon: rotaConfig()?.horizon ?? DEFAULT_ROTA_CONFIG.horizon,
    extras: { weekGrid: tc?.weekGrid ?? DEFAULT_EXTRAS.weekGrid, weekLayout: tc?.weekLayout ?? DEFAULT_EXTRAS.weekLayout,
      breaksMax: t.extras?.breaksMax ?? DEFAULT_EXTRAS.breaksMax, vehiclesMax: t.extras?.vehiclesMax ?? DEFAULT_EXTRAS.vehiclesMax },
    rotaSetAside: setAside()?.count ?? 0,
  };
}
export const rotaActor = (s: Parameters<typeof actor>[0]): RotaActor => { const w = actor(s); return { personCode: w.personCode, name: w.name }; };
const refuseWith = (r: DomainRefusal): never =>
  refuse(r.status, { code: r.code, message: r.message, next: r.next, ...(r.field ? { field: r.field } : {}) });

/* ------------------------------------------------------- Rota off and on */
export function rotaOff(): number {
  const weeks = store.coll<StoredWeek>('rotaWeeks');
  const r = setAsideShifts(Object.fromEntries(Object.values(weeks).map(w => [w.id, w.lines])));
  for (const [id, lines] of Object.entries(r.cleared)) {
    const w = recordAt(weeks, id);
    if (w) weeks[id] = bump(w, { lines });
  }
  const was = setAside();
  store.coll<SetAside>(SET_ASIDE)[SET_ASIDE] = { id: SET_ASIDE, version: (was?.version ?? 0) + 1, updatedAt: store.now(), weeks: r.kept, count: r.count };
  return r.count;
}
/* Called once the tenant record has Rota on, so the absence write sees the module live. */
export function rotaOn(by: RotaActor): { restored: number; notRestored: number } {
  const kept = setAside();
  if (!kept) return { restored: 0, notRestored: 0 };
  const weeks = store.coll<StoredWeek>('rotaWeeks');
  const dateOf = (id: string, day: number) => { const w = recordAt(weeks, id); return w ? addDays(w.weekStart, day) : ''; };
  const r = restoreShifts(Object.fromEntries(Object.values(weeks).map(w => [w.id, w.lines])), kept.weeks,
    (id, person, day) => { const date = dateOf(id, day); return date ? leaveAbsenceOn(person, date) : ''; });
  for (const [id, lines] of Object.entries(r.restored)) {
    const w = recordAt(weeks, id);
    if (w) weeks[id] = bump(w, { lines });
  }
  store.db[SET_ASIDE] = {};
  const t = tenantRec();
  if (leaveWritesRota(t.modules, Object.fromEntries(Object.entries(t.flags).map(([k, v]) => [k, Boolean(v)])))) {
    const byMark = new Map<string, { personCode: string; mark: string; dates: string[] }>();
    for (const h of r.held) {
      const key = `${h.person}|${h.mark}`, at = byMark.get(key) ?? { personCode: h.person, mark: h.mark, dates: [] };
      at.dates.push(dateOf(h.week, h.day));
      byMark.set(key, at);
    }
    for (const x of byMark.values()) writeAbsence({ personCode: x.personCode, dates: x.dates, mark: x.mark, by, coverReason: leaveCoverReason(x.mark) });
  }
  return { restored: r.count, notRestored: r.held.length };
}
/* Sites off takes the site capability from every employee type (the prototype's mod-off). */
export function sitesOff(): string[] {
  const types = store.coll<StoredType>('employeeTypes');
  const changed: string[] = [];
  for (const t of Object.values(types)) {
    if (!t.capabilities.includes('site')) continue;
    types[t.id] = bump(t, { capabilities: t.capabilities.filter(c => c !== 'site') });
    changed.push(t.name);
  }
  return changed;
}
/* What is left exactly as it was when a module goes off, counted from the store. */
function keptFor(code: string): ModuleEffect['kept'] {
  const rows: [string, string][] = ({
    TS: [['timesheet days', 'timesheetDays']], A: [['timesheet days', 'timesheetDays']],
    B: [['timesheet days', 'timesheetDays'], ['clock records', 'clockRecords']],
    R: [['rota weeks', 'rotaWeeks'], ['working patterns', 'patterns'], ['cover requests', 'coverRequests']],
    L: [['leave requests', 'leaveRequests'], ['sickness episodes', 'sickEpisodes']],
  } as Record<string, [string, string][]>)[code] ?? [];
  /* Onboarding: the cases of people still onboarding, kept for when the module returns */
  if (code === 'ON') return [{ what: 'onboarding cases in progress', count: casesInProgress() }];
  return rows.map(([what, coll]) => ({ what, count: count(coll) }));
}

export const tenantHandlers = [
  serve(getTenant, () => view(tenantRec())),

  serve(setModule, ({ session, params, body, checkVersion }) => {
    const t = tenantRec();
    checkVersion(t);
    const r = switchModule({ modules: t.modules, restore: t.restore ?? {} }, params.code, body.on);
    if (!r.ok) return refuseWith(r.refusal);
    const effect: ModuleEffect = { message: '', kept: [], shiftsSetAside: 0, shiftsRestored: 0, shiftsNotRestored: 0, capturesRestored: [], capturesRemembered: [], siteRemovedFrom: [] };
    if (!r.changed) return { record: view(t), auditId: null, effect: { ...effect, message: `${subName(params.code)} is already ${body.on ? 'on' : 'off'}.` } };
    /* saved first, so what the switch does sees the module as it now is */
    const saved = saveTenant(t, { modules: r.modules, restore: r.restore });
    if (params.code === 'R') {
      if (body.on) ({ restored: effect.shiftsRestored, notRestored: effect.shiftsNotRestored } = rotaOn(rotaActor(session)));
      else effect.shiftsSetAside = rotaOff();
    }
    if (params.code === 'C' && !body.on) effect.siteRemovedFrom = sitesOff();
    if (!body.on) effect.kept = keptFor(params.code);
    effect.capturesRestored = r.brought;
    effect.capturesRemembered = r.remembered;
    effect.message = moduleSwitchText(params.code, body.on,
      { cleared: effect.shiftsSetAside, restored: effect.shiftsRestored, notRestored: effect.shiftsNotRestored, sitesRemovedFrom: effect.siteRemovedFrom.length, brought: r.brought });
    const touched = Object.keys(r.modules).filter(k => t.modules[k] !== r.modules[k]);
    const auditId = writeAudit({ who: actor(session), act: body.on ? 'Module turned on' : 'Module turned off', entity: 'tenant', entityId: params.code,
      before: Object.fromEntries(touched.map(k => [k, Boolean(t.modules[k])])),
      after: { ...Object.fromEntries(touched.map(k => [k, Boolean(r.modules[k])])), detail: effect.message,
        ...(effect.kept.length ? { kept: effect.kept } : {}), ...(r.remembered.length ? { remembered: r.remembered } : {}),
        ...(effect.siteRemovedFrom.length ? { siteRemovedFrom: effect.siteRemovedFrom } : {}) } });
    return { record: view(saved), auditId, effect };
  }),

  serve(setFlag, ({ session, params, body, checkVersion }) => {
    const t = tenantRec();
    checkVersion(t);
    const r = switchFlag(t.modules, t.flags, params.code, body);
    if (!r.ok) return refuseWith(r.refusal);
    const f = flagBy(params.code) ?? refuse(404, NO_TENANT);
    const was = Boolean(t.flags[f.code]), current = view(t).extras;
    /* only what actually differs counts as a change */
    const extras = Object.fromEntries(Object.entries(r.extras).filter(([k, v]) => current[k as keyof typeof current] !== v)) as typeof r.extras;
    const message = flagChangeText(f, was, r.on, extras);
    if (was === r.on && !Object.keys(extras).length) return { record: view(t), auditId: null, message };
    if (extras.weekGrid !== undefined || extras.weekLayout !== undefined) {
      const tc = tsConfig();
      if (!tc) throw new Error('the store has no timesheet config');
      store.coll<TimesheetConfig>('timesheetConfig')[tc.id] = bump(tc, {
        ...(extras.weekGrid !== undefined ? { weekGrid: extras.weekGrid } : {}), ...(extras.weekLayout !== undefined ? { weekLayout: extras.weekLayout } : {}) });
    }
    const stored = { breaksMax: extras.breaksMax ?? current.breaksMax, vehiclesMax: extras.vehiclesMax ?? current.vehiclesMax };
    const saved = saveTenant(t, { flags: { ...t.flags, [f.code]: r.on }, extras: stored });
    const before = { ...(was !== r.on ? { on: was } : {}), ...Object.fromEntries(Object.keys(extras).map(k => [k, current[k as keyof typeof current]])) };
    const auditId = writeAudit({ who: actor(session), act: 'Feature changed', entity: 'tenant', entityId: f.code,
      before, after: { ...(was !== r.on ? { on: r.on } : {}), ...extras, detail: message } });
    return { record: view(saved), auditId, message };
  }),

  serve(updateTenantSettings, ({ session, body, checkVersion }) => {
    const t = tenantRec();
    checkVersion(t);
    const before: Record<string, unknown> = {}, after: Record<string, unknown> = {};
    const horizon = rotaConfig()?.horizon ?? DEFAULT_ROTA_CONFIG.horizon;
    if (body.rotaHorizon !== undefined && body.rotaHorizon !== horizon) { before.rotaHorizon = horizon; after.rotaHorizon = body.rotaHorizon; }
    if (body.name !== undefined && body.name !== t.name) { before.name = t.name; after.name = body.name; }
    const company = { ...t.company };
    for (const [k, v] of Object.entries(body.company ?? {}) as [keyof Tenant['company'], unknown][]) {
      if (v === undefined || company[k] === v) continue;
      before[k] = company[k]; after[k] = v;
      Object.assign(company, { [k]: v });
    }
    if (!Object.keys(after).length) return { record: view(t), auditId: null };
    if (after.rotaHorizon !== undefined) {
      /* the horizon's one home; created at the defaults if Rota was never set up */
      const rc = rotaConfig();
      const next = rc ? bump(rc, { horizon: body.rotaHorizon })
        : { id: 'rotaConfig', version: 1, updatedAt: store.now(), ...DEFAULT_ROTA_CONFIG, fulfilStages: [], types: {}, horizon: body.rotaHorizon ?? horizon };
      store.coll<RotaConfigRecord>('rotaConfig')[next.id] = next;
    }
    const saved = saveTenant(t, { company, ...(body.name !== undefined ? { name: body.name } : {}) });
    const auditId = writeAudit({ who: actor(session), act: Object.keys(after).every(k => k === 'rotaHorizon') ? 'Rota horizon changed' : 'Organisation settings changed',
      entity: 'tenant', entityId: 'settings', before, after });
    return { record: view(saved), auditId };
  }),
];
