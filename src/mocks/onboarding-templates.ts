/* Onboarding templates: what a starter is asked can differ by job profile. A
   template is a row of its own with its own version, written whole with If-Match
   and one audit row. Every rule is the domain's (src/domain/onboarding-templates.ts).
   With the Onboarding module off every endpoint refuses (module-off). */
import { store } from './store';
import { bump, refuse } from './http';
import { serve } from './serve';
import { actor } from './auth';
import { writeAudit } from './audit';
import {
  createOnboardingTemplate, deleteOnboardingTemplate, getOnboardingTemplate, updateOnboardingTemplate,
} from '@/contract/onboarding';
import {
  featuresNow, onbConfig, policiesNow, refuseOnb, requireOnboarding, templatesColl, templatesNow, type StoredTemplate,
} from './onboarding-cases';
import {
  newTemplateFrom, normaliseTemplate, onbTemplateId, onbTemplateNameProblem, onbTemplateProblem,
  templateCreatedText, templateDeletedText, templateSavedText, type OnbTemplateDraft,
} from '@/domain/onboarding-templates';

const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const byId = <T extends { id: string }>(list: readonly T[], pick: (x: T) => unknown) => Object.fromEntries(list.map(x => [x.id, pick(x)]));
const view = (t: StoredTemplate): StoredTemplate => normaliseTemplate(t, onbConfig());
function templateAt(id: string): StoredTemplate {
  return templatesColl()[id] ?? refuse(404, { code: 'not-found', message: 'That onboarding template no longer exists.', next: 'Reload the page.' });
}

export const onboardingTemplateHandlers = [
  serve(getOnboardingTemplate, ({ params }) => {
    requireOnboarding();
    return view(templateAt(params.id));
  }),

  serve(createOnboardingTemplate, ({ session, body }) => {
    requireOnboarding();
    const all = templatesNow(), base = onbConfig();
    const source = body.copyFrom === undefined ? null : templateAt(body.copyFrom);
    const bad = onbTemplateNameProblem(body.name, all);
    if (bad) return refuseOnb(bad);
    const name = body.name.trim();
    const row: StoredTemplate = { ...newTemplateFrom(onbTemplateId(name, all.map(t => t.id)), name, source, base), version: 1, updatedAt: store.now() };
    templatesColl()[row.id] = row;
    const summary = templateCreatedText(name);
    const auditId = writeAudit({ who: actor(session), act: 'Onboarding template created', entity: 'onboardingTemplate', entityId: row.id, before: null,
      after: { name, copiedFrom: source?.name ?? 'Default', detail: summary } });
    return { record: view(row), summary, auditId };
  }),

  serve(updateOnboardingTemplate, ({ session, params, body, checkVersion }) => {
    requireOnboarding();
    const row = templateAt(params.id);
    checkVersion(row);
    const base = onbConfig();
    const draft: OnbTemplateDraft = { name: body.name.trim(), jobProfiles: [...new Set(body.jobProfiles)], steps: body.steps, documents: body.documents, policies: [...new Set(body.policies)] };
    /* the row being saved is not "another template" holding its own job profiles */
    const others = templatesNow().filter(t => t.id !== row.id);
    const jobProfiles = Object.values(store.coll<{ code: string; name: string }>('jobProfiles'));
    const bad = onbTemplateProblem(draft, { base, was: row, others, jobProfiles, policyIds: policiesNow().map(p => p.id), features: featuresNow() });
    if (bad) return refuseOnb(bad);
    const was = view(row);
    const next: StoredTemplate = normaliseTemplate({ ...row, ...draft }, base);
    const summary = templateSavedText(draft.name);
    const steps = next.steps.filter(s => was.steps.find(x => x.id === s.id)?.on !== s.on);
    const documents = next.documents.filter(d => !sameJson(d, was.documents.find(x => x.id === d.id)));
    const changed = { name: next.name !== was.name, jobProfiles: !sameJson(next.jobProfiles, was.jobProfiles), policies: !sameJson(next.policies, was.policies) };
    if (!changed.name && !changed.jobProfiles && !changed.policies && !steps.length && !documents.length)
      return { record: was, summary: 'Nothing has changed.', auditId: null };
    const saved: StoredTemplate = bump(row, next);
    templatesColl()[row.id] = saved;
    const pick = (side: 'was' | 'now') => {
      const t = side === 'was' ? was : next;
      return {
        ...(changed.name ? { name: t.name } : {}),
        ...(changed.jobProfiles ? { jobProfiles: t.jobProfiles } : {}),
        ...(steps.length ? { steps: byId(steps, s => t.steps.find(x => x.id === s.id)?.on) } : {}),
        ...(documents.length ? { documents: byId(documents, d => { const r = t.documents.find(x => x.id === d.id); return r ? { on: r.on, req: r.req, blocks: r.blocks } : null; }) } : {}),
        ...(changed.policies ? { policies: t.policies } : {}),
      };
    };
    const auditId = writeAudit({ who: actor(session), act: 'Onboarding template saved', entity: 'onboardingTemplate', entityId: row.id, before: pick('was'), after: pick('now') });
    return { record: view(saved), summary, auditId };
  }),

  serve(deleteOnboardingTemplate, ({ session, params, checkVersion }) => {
    requireOnboarding();
    const row = templateAt(params.id);
    checkVersion(row);
    Reflect.deleteProperty(templatesColl(), row.id);
    const auditId = writeAudit({ who: actor(session), act: 'Onboarding template deleted', entity: 'onboardingTemplate', entityId: row.id,
      before: { name: row.name, jobProfiles: row.jobProfiles }, after: null });
    return { id: row.id, summary: templateDeletedText(row.name), auditId };
  }),
];
