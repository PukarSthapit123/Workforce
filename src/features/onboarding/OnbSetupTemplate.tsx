import { useEffect, useState } from 'react';
import { tid } from '@/testids';
import { ActionBar, Button, FormWarn, toastInfo } from '@/ui';
import { ApiError } from '@/api/client';
import {
  useDeleteOnboardingTemplate, useOnboardingTemplate, useSaveOnboardingTemplate, type OnbDocumentRecord, type OnbStepRecord, type OnbTemplateRecord, type OnboardingSetup, type UpdateOnbTemplate,
} from '@/api/onboarding';
import { versionKey } from '@/lib/latest';
import { StepsCard } from './OnbSetupSteps';
import { AppliesToCard } from './OnbSetupApplies';
import { DocumentsCard } from './OnbSetupDocuments';
import { PoliciesCard } from './OnbSetupPolicies';

/* A named template: its own draft, saved whole with If-Match. The labels,
   descriptions and checks of steps and documents stay on the shared config. */
const draftOf = (t: OnbTemplateRecord): UpdateOnbTemplate => ({
  name: t.name, jobProfiles: [...t.jobProfiles], steps: t.steps.map(s => ({ ...s })), documents: t.documents.map(d => ({ ...d })), policies: [...t.policies],
});

export function TemplateDraftView({ setup, id, onDirtyChange, onDeleted }: {
  setup: OnboardingSetup; id: string; onDirtyChange(dirty: boolean): void; onDeleted(): void;
}) {
  const row = useOnboardingTemplate(id);
  if (!row.data) {
    if (!row.isError) return <p data-testid={tid.monb.templateLoading} className="text-text-secondary">Loading the template&hellip;</p>;
    /* the template may be gone: another admin can delete it while this one has it open */
    const refused = row.error instanceof ApiError ? row.error.refusal : null;
    return <p data-testid={tid.monb.error} role="alert" className="text-err">
      {refused && refused.code !== 'network' ? `${refused.message} ${refused.next}` : 'The template could not be loaded. Reload the page.'}</p>;
  }
  /* the draft starts again from what the server holds whenever the template gets a new version */
  return <TemplateDraft key={versionKey(row.data)} setup={setup} record={row.data} onDirtyChange={onDirtyChange} onDeleted={onDeleted} />;
}

function TemplateDraft({ setup, record, onDirtyChange, onDeleted }: {
  setup: OnboardingSetup; record: OnbTemplateRecord; onDirtyChange(dirty: boolean): void; onDeleted(): void;
}) {
  const [draft, setDraft] = useState<UpdateOnbTemplate>(() => draftOf(record));
  const save = useSaveOnboardingTemplate();
  const remove = useDeleteOnboardingTemplate();
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(record));
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const fe = save.fieldError;
  const steps: OnbStepRecord[] = setup.config.steps.map(s => ({ ...s, on: s.fixed || (draft.steps.find(x => x.id === s.id)?.on ?? false) }));
  const setStep = (stepId: string, on: boolean) => setDraft(d => ({ ...d, steps: d.steps.map(s => (s.id === stepId ? { ...s, on } : s)) }));
  /* the rows come from the shared list; a document the draft lacks (added after it was loaded) shows switched off */
  const docs: OnbDocumentRecord[] = setup.config.documents.map(d => {
    const own = draft.documents.find(x => x.id === d.id);
    return { ...d, on: own?.on ?? false, req: own?.req ?? false, blocks: own?.blocks ?? false };
  });
  const setDoc = (docId: string, p: Partial<OnbDocumentRecord>) => setDraft(d => {
    const base = { id: docId, on: false, req: false, blocks: false };
    const next = (x: UpdateOnbTemplate['documents'][number]) => ({ ...x, ...(p.on !== undefined && { on: p.on }), ...(p.req !== undefined && { req: p.req }), ...(p.blocks !== undefined && { blocks: p.blocks }) });
    return { ...d, documents: d.documents.some(x => x.id === docId) ? d.documents.map(x => (x.id === docId ? next(x) : x)) : [...d.documents, next(base)] };
  });
  const askPolicy = (policyId: string, on: boolean) =>
    setDraft(d => ({ ...d, policies: [...d.policies.filter(x => x !== policyId), ...(on ? [policyId] : [])] }));
  const patch = (p: Partial<UpdateOnbTemplate>) => setDraft(d => ({ ...d, ...p }));
  const submit = () => save.mutate({ template: record, body: draft }, { onSuccess: d => toastInfo(d.summary) });
  const del = () => remove.mutate({ template: record }, { onSuccess: r => { onDeleted(); toastInfo(r.summary); } });
  const cancel = () => { setDraft(draftOf(record)); save.clearFieldErrors(); };

  return (
    <>
      <AppliesToCard setup={setup} templateId={record.id} draft={draft} fe={fe} onChange={patch} onDelete={del} deleting={remove.anyPending} />
      <StepsCard setup={setup} steps={steps} fe={fe} onChange={setStep} />
      <DocumentsCard setup={setup} docs={docs} locked={dirty} shared fe={fe} onChange={setDoc} />
      {save.refusal && <FormWarn testId={tid.monb.warn}>{save.refusal.message} {save.refusal.next}</FormWarn>}
      <PoliciesCard policies={setup.policies} asked={draft.policies} onAsk={askPolicy} locked={dirty} />
      <ActionBar stuck={dirty}>
        {dirty && <span data-testid={tid.monb.dirty} className="mr-auto text-xs text-text-muted">Unsaved changes</span>}
        <Button testId={tid.monb.cancel} kind="ghost" disabled={!dirty || save.anyPending} onClick={cancel}>Cancel</Button>
        <Button testId={tid.monb.save} kind="primary" disabled={!dirty} pending={save.anyPending} onClick={submit}>Save</Button>
      </ActionBar>
    </>);
}
