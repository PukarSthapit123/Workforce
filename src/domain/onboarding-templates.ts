/* Onboarding templates: what a starter is asked can differ by job profile. A
   template holds only the switches (steps on or off; each document's on,
   Required and Blocks start; the policies asked). Labels, verifiers and the
   other shared settings stay on the one config. Every function is pure. */
import {
  STEP_IDS, stepSwitchProblem, type OnbFeatures, type OnbRefusal, type OnbStepId, type OnboardingConfig,
} from './onboarding';

export const DEFAULT_TEMPLATE = 'Default';
/* The picker's value for the Default template. */
export const DEFAULT_KEY = 'default';
export const ONB_TEMPLATE_NAME_MAX = 60;

export interface OnbTemplateStep { id: OnbStepId; on: boolean }
export interface OnbTemplateDocument { id: string; on: boolean; req: boolean; blocks: boolean }
export interface OnbTemplate {
  id: string; name: string; jobProfiles: string[]; steps: OnbTemplateStep[]; documents: OnbTemplateDocument[]; policies: string[];
}
export type OnbTemplateDraft = Omit<OnbTemplate, 'id'>;
export interface ResolvedOnboarding { config: OnboardingConfig; policies: string[] }
export type BaseConfig = OnboardingConfig & { policies: readonly string[] };

export const TEMPLATE_NAME_NEEDED = 'A template needs a name.';
export const TEMPLATE_NAME_LONG = 'Keep the name to 60 characters.';
export const TEMPLATE_NAME_RESERVED = 'Default is the template every other job profile uses. Choose another name.';
export const TEMPLATE_NAME_TAKEN = 'A template with that name already exists.';
export const profileTakenText = (profileName: string, code: string, templateName: string) =>
  `${profileName} (${code}) is already in ${templateName}. Take it out of ${templateName} first.`;
export const unknownProfileText = (code: string) => `There is no job profile with the code ${code}.`;
export const templateCreatedText = (name: string) => `${name} created. It applies to nobody until you add a job profile and save.`;
export const templateSavedText = (name: string) => `${name} saved. Starters who have not submitted are asked what it asks from now on.`;
export const templateDeletedText = (name: string) => `${name} deleted. Its job profiles use the Default template from now on.`;

const invalid = (field: string, message: string, next: string): OnbRefusal => ({ code: 'VALIDATION', message, next, field });

/* The base config with its policies resolved: absent reads as every policy. */
export const withPolicies = (base: OnboardingConfig, allPolicyIds: readonly string[]): BaseConfig =>
  ({ ...base, policies: base.policies ?? [...allPolicyIds] });

/* The template listing the starter's job profile, or null for the default. */
export const templateFor = (jobProfile: string, templates: readonly OnbTemplate[]): OnbTemplate | null =>
  (jobProfile ? templates.find(t => t.jobProfiles.includes(jobProfile)) : undefined) ?? null;

export function configFor(template: OnbTemplate | null, base: BaseConfig): ResolvedOnboarding {
  const { policies, ...shared } = base;
  if (!template) return { config: shared, policies: [...policies] };
  return {
    config: {
      ...shared,
      steps: base.steps.map(s => ({ ...s, on: s.fixed || (template.steps.find(r => r.id === s.id)?.on ?? false) })),
      documents: base.documents.map(d => {
        const row = template.documents.find(r => r.id === d.id);
        return row ? { ...d, on: row.on, req: row.req, blocks: row.blocks } : { ...d, on: false };
      }),
    },
    policies: [...template.policies],
  };
}

/* Documents in the shared list's order, a missing one switched off, an unknown one dropped. */
export function normaliseTemplate<T extends OnbTemplate>(t: T, base: OnboardingConfig): T {
  return {
    ...t,
    documents: base.documents.map(d => t.documents.find(r => r.id === d.id) ?? { id: d.id, on: false, req: false, blocks: false }),
  };
}

/* A copy of the source (the default when null), with a new id and name and no job profiles. */
export function newTemplateFrom(id: string, name: string, source: OnbTemplate | null, base: BaseConfig): OnbTemplate {
  const from: OnbTemplate = source ?? {
    id: DEFAULT_KEY, name: DEFAULT_TEMPLATE, jobProfiles: [],
    steps: base.steps.map(s => ({ id: s.id, on: s.on })),
    documents: base.documents.map(d => ({ id: d.id, on: d.on, req: d.req, blocks: d.blocks })),
    policies: [...base.policies],
  };
  return normaliseTemplate({
    id, name, jobProfiles: [],
    steps: from.steps.map(s => ({ ...s })),
    documents: from.documents.map(d => ({ ...d })),
    policies: [...from.policies],
  }, base);
}

export function onbTemplateId(name: string, taken: readonly string[]): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'template';
  const base = `onbt-${slug}`;
  let id = base;
  for (let n = 2; taken.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export function onbTemplateNameProblem(name: string, others: readonly { id: string; name: string }[], editingId?: string): OnbRefusal | null {
  const n = name.trim(), key = n.toLowerCase();
  if (!n) return invalid('name', TEMPLATE_NAME_NEEDED, 'Type a name for the template.');
  if (n.length > ONB_TEMPLATE_NAME_MAX) return invalid('name', TEMPLATE_NAME_LONG, 'Shorten the name.');
  if (key === DEFAULT_TEMPLATE.toLowerCase()) return invalid('name', TEMPLATE_NAME_RESERVED, 'Choose another name.');
  if (others.some(o => o.id !== editingId && o.name.trim().toLowerCase() === key))
    return invalid('name', TEMPLATE_NAME_TAKEN, 'Choose another name, or change the one already there.');
  return null;
}

export interface TemplateRuleContext {
  base: BaseConfig;
  was: OnbTemplate | null;
  others: readonly OnbTemplate[];
  jobProfiles: readonly { code: string; name: string }[];
  policyIds: readonly string[];
  features: OnbFeatures;
}

export function onbTemplateProblem(next: OnbTemplateDraft, ctx: TemplateRuleContext): OnbRefusal | null {
  const name = onbTemplateNameProblem(next.name, ctx.others, ctx.was?.id);
  if (name) return name;
  for (const code of next.jobProfiles) {
    const profile = ctx.jobProfiles.find(p => p.code === code);
    if (!profile) return invalid('jobProfiles', unknownProfileText(code), 'Choose a job profile from the list.');
    const holder = ctx.others.find(t => t.jobProfiles.includes(code));
    if (holder) return { code: 'PROFILE_TAKEN', field: 'jobProfiles', message: profileTakenText(profile.name, code, holder.name), next: 'Reload the page to see who holds it.' };
  }
  if (next.steps.map(s => s.id).join() !== STEP_IDS.join())
    return invalid('steps', 'Steps can be switched on or off, not added, removed or reordered.', 'Reload the page and switch the steps you need.');
  for (const s of next.steps) {
    const baseStep = ctx.base.steps.find(x => x.id === s.id);
    if (!baseStep) continue;
    const wasOn = ctx.was ? (ctx.was.steps.find(x => x.id === s.id)?.on ?? false) : baseStep.on;
    const p = stepSwitchProblem({ ...baseStep, on: wasOn }, s.on, ctx.features);
    if (p) return p;
  }
  const ids = next.documents.map(d => d.id);
  if (ids.some((id, i) => ids.indexOf(id) !== i) || ids.some(id => !ctx.base.documents.some(d => d.id === id)))
    return invalid('documents', 'A template can only set documents that are in the shared list, once each.', 'Reload the page and change the documents you need.');
  if (next.policies.some(id => !ctx.policyIds.includes(id)))
    return { code: 'VALIDATION', field: 'policies', message: 'That policy no longer exists.', next: 'Reload the page.' };
  return null;
}
