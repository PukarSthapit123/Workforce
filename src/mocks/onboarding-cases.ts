/* The onboarding case and gate the 1b handlers share with module 5's own
   (brief D1, D6). Kept apart from src/mocks/onboarding.ts so people.ts and
   transitions.ts can import it without an import cycle. Every rule is the
   domain's (src/domain/onboarding.ts). */
import { store } from './store';
import { bump } from './http';
import { people, recordAt } from './world';
import {
  caseId, emptyCase, isStarterState, onbFeatures, startProblem,
  type BlockerContext, type OnboardingCase, type OnboardingConfig, type OnbRefusal,
} from '@/domain/onboarding';

interface Meta { id: string; version: number; updatedAt: string }
export type StoredCase = Meta & OnboardingCase;
export type StoredConfig = Meta & OnboardingConfig;
interface Tenant { modules: Record<string, boolean>; flags: Record<string, unknown> }

export const casesColl = () => store.coll<StoredCase>('onboardingCases');
export function onbTenant(): Tenant {
  const t = recordAt(store.coll<Tenant>('tenant'), 'tenant');
  if (!t) throw new Error('the store has no tenant record');
  return t;
}
export const onbModuleOn = () => Boolean(onbTenant().modules.ON);
export const featuresNow = () => { const t = onbTenant(); return onbFeatures(t.modules, t.flags); };
export function onbConfig(): StoredConfig {
  const c = recordAt(store.coll<StoredConfig>('onboardingConfig'), 'onboardingConfig');
  if (!c) throw new Error('the store has no onboarding config');
  return c;
}
export const blockerContext = (): BlockerContext => ({ config: onbConfig(), features: featuresNow() });

/* The stored case, or an empty one at version 0 when none was ever written
   (a starter from before cases existed): the first write stores it at 1. */
export function caseOf(personCode: string): StoredCase {
  const id = caseId(personCode);
  return recordAt(casesColl(), id) ?? { id, version: 0, updatedAt: store.now(), ...emptyCase(personCode) };
}
export function putCase(c: StoredCase, next: OnboardingCase): StoredCase {
  const saved = bump(c, next);
  casesColl()[c.id] = saved;
  return saved;
}

/* The cases of people still onboarding (a candidate or preboarding). */
export const casesInProgress = () => Object.values(people()).filter(p => isStarterState(p.state) && recordAt(casesColl(), caseId(p.code))).length;

/* D1: an empty case for a person created in or moved into candidate or
   preboard. An existing case is kept. Returns the id when one was created. */
export function ensureCase(personCode: string, state: string): string | null {
  if (!isStarterState(state)) return null;
  const id = caseId(personCode);
  if (recordAt(casesColl(), id)) return null;
  casesColl()[id] = { id, version: 1, updatedAt: store.now(), ...emptyCase(personCode) };
  return id;
}

/* D6: moving a candidate or preboarding person to active, while the
   Onboarding module is on, is refused while anything blocks the start. */
export function activationProblem(p: { code: string; name: string; state: string }, to: string): OnbRefusal | null {
  if (to !== 'active' || !isStarterState(p.state) || !onbModuleOn()) return null;
  return startProblem(p.name, caseOf(p.code), blockerContext());
}
/* Once they are active the case records when they started. */
export function markStarted(personCode: string): void {
  const c = recordAt(casesColl(), caseId(personCode));
  if (c) putCase(c, { ...c, startedAt: store.now() });
}
