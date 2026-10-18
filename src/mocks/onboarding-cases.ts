/* The onboarding case and gate the 1b handlers share with module 5's own
   (brief D1, D6). Kept apart from src/mocks/onboarding.ts so employees.ts and
   transitions.ts can import it without an import cycle. Every rule is the
   domain's (src/domain/onboarding.ts). */
import { store } from './store';
import { bump, refuse } from './http';
import { employees, employeeByCode, recordAt } from './world';
import {
  caseId, emptyCase, isStarterState, onbFeatures, startProblem,
  type BlockerContext, type OnboardingCase, type OnboardingConfig, type OnbPolicy, type OnbRefusal,
} from '@/domain/onboarding';
import { DEFAULT_TEMPLATE, configFor, templateFor, withPolicies, type BaseConfig, type OnbTemplate, type ResolvedOnboarding } from '@/domain/onboarding-templates';
import type { OnbTemplateRef } from '@/contract/onboarding';

interface Meta { id: string; version: number; updatedAt: string }
export type StoredCase = Meta & OnboardingCase;
export type StoredConfig = Meta & OnboardingConfig;
interface Tenant { modules: Record<string, boolean>; flags: Record<string, unknown> }

/* Each template is a row of its own, listed by name. */
export type StoredTemplate = Meta & OnbTemplate;
export const templatesColl = () => store.coll<StoredTemplate>('onboardingTemplates');
export const templatesNow = () => Object.values(templatesColl()).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
export const casesColl = () => store.coll<StoredCase>('onboardingCases');
/* Each policy is a row of its own (D2), listed in its order. */
export type StoredPolicy = Meta & OnbPolicy;
export const policiesColl = () => store.coll<StoredPolicy>('onboardingPolicies');
export const policiesNow = () => Object.values(policiesColl()).sort((a, b) => a.order - b.order || a.id.localeCompare(b.id));
export function onbTenant(): Tenant {
  const t = recordAt(store.coll<Tenant>('tenant'), 'tenant');
  if (!t) throw new Error('the store has no tenant record');
  return t;
}
export const onbModuleOn = () => Boolean(onbTenant().modules.ON);
export const featuresNow = () => { const t = onbTenant(); return onbFeatures(t.modules, t.flags); };
/* With the Onboarding module off the whole module is hidden, and so refused here. */
export function requireOnboarding(): void {
  if (!onbModuleOn()) refuse(403, { code: 'module-off', message: 'Onboarding is switched off for this organisation.', next: 'An administrator can switch the Onboarding module on in Qnipay setup.' });
}
/* A domain refusal, with the status its code carries. */
export const STATUS: Record<string, number> = { NOT_FOUND: 404, SUBMITTED: 409, OUTSTANDING: 409, STALE: 409, FIXED: 409, FLAG_OFF: 409, NOT_READY: 409, PROFILE_TAKEN: 409 };
export const refuseOnb = (p: OnbRefusal): never => refuse(STATUS[p.code] ?? 422, { ...p, code: p.code === 'VALIDATION' ? 'invalid' : p.code });
export function onbConfig(): StoredConfig & BaseConfig {
  const c = recordAt(store.coll<StoredConfig>('onboardingConfig'), 'onboardingConfig');
  if (!c) throw new Error('the store has no onboarding config');
  /* a config stored before module 8 asks for every document, each built in */
  const withDocs = { ...c, documents: c.documents.map(d => ({ ...d, on: d.on ?? true, custom: d.custom ?? false })) };
  return { ...withDocs, ...withPolicies(withDocs, policiesNow().map(pol => pol.id)) };
}

/* What an employee is asked: their job profile's template, or the default when
   none lists it (or the employee is unknown). */
export function resolvedFor(employeeCode: string): ResolvedOnboarding & { template: StoredTemplate | null } {
  const template = templateFor(employeeByCode(employeeCode)?.jobProfile ?? '', templatesNow());
  return { ...configFor(template, onbConfig()), template };
}
export const caseContext = (employeeCode: string): BlockerContext => ({ config: resolvedFor(employeeCode).config, features: featuresNow() });
export const templateRef = (t: StoredTemplate | null): OnbTemplateRef => ({ id: t?.id ?? null, name: t?.name ?? DEFAULT_TEMPLATE });

/* The stored case, or an empty one at version 0 when none was ever written
   (a starter from before cases existed): the first write stores it at 1. */
export function caseOf(employeeCode: string): StoredCase {
  const id = caseId(employeeCode);
  return recordAt(casesColl(), id) ?? { id, version: 0, updatedAt: store.now(), ...emptyCase(employeeCode) };
}
export function putCase(c: StoredCase, next: OnboardingCase): StoredCase {
  const saved = bump(c, next);
  casesColl()[c.id] = saved;
  return saved;
}

/* A case whose employee is still a candidate or preboarding and has not
   started: only they are asked to acknowledge a policy again. */
export const stillOnboarding = (c: OnboardingCase) => {
  const p = employeeByCode(c.employeeCode);
  return Boolean(p && isStarterState(p.state) && !c.startedAt);
};
/* The cases of employees still onboarding (a candidate or preboarding). */
export const casesInProgress = () => Object.values(employees()).filter(p => isStarterState(p.state) && recordAt(casesColl(), caseId(p.code))).length;

/* D1: an empty case for an employee created in or moved into candidate or
   preboard. An existing case is kept. Returns the id when one was created. */
export function ensureCase(employeeCode: string, state: string): string | null {
  if (!isStarterState(state)) return null;
  const id = caseId(employeeCode);
  if (recordAt(casesColl(), id)) return null;
  casesColl()[id] = { id, version: 1, updatedAt: store.now(), ...emptyCase(employeeCode) };
  return id;
}

/* A case that exists and never recorded a start: the employee began onboarding
   and has not finished it, whatever state they were moved to since. */
const unstartedCase = (employeeCode: string) => {
  const c = recordAt(casesColl(), caseId(employeeCode));
  return c && !c.startedAt ? c : undefined;
};
/* D6: moving a candidate or preboarding employee to active, while the
   Onboarding module is on, is refused while anything blocks the start. The
   same holds for anybody whose onboarding never started, from whatever state
   (a starter parked in Archived and then made active is still a starter). */
export function activationProblem(p: { code: string; name: string; state: string }, to: string): OnbRefusal | null {
  if (to !== 'active' || !onbModuleOn()) return null;
  if (!isStarterState(p.state) && !unstartedCase(p.code)) return null;
  return startProblem(p.name, caseOf(p.code), caseContext(p.code));
}
/* Once they are active the case records when they started (once only). */
export function markStarted(employeeCode: string): void {
  const c = unstartedCase(employeeCode);
  if (c) putCase(c, { ...c, startedAt: store.now() });
}
