import { useEffect, useState } from 'react';
import { tid } from '@/testids';
import { ActionBar, Button, FormWarn, toastInfo } from '@/ui';
import { ApiError } from '@/api/client';
import {
  useDeleteOnboardingTemplate, useOnboardingTemplate, useSaveOnboardingTemplate, type OnbStepRecord, type OnbTemplateRecord, type OnboardingSetup, type UpdateOnbTemplate,
} from '@/api/onboarding';
import { versionKey } from '@/lib/latest';
import { StepsCard } from './OnbSetupSteps';
import { AppliesToCard } from './OnbSetupApplies';

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
  const patch = (p: Partial<UpdateOnbTemplate>) => setDraft(d => ({ ...d, ...p }));
  const submit = () => save.mutate({ template: record, body: draft }, { onSuccess: d => toastInfo(d.summary) });
  const del = () => remove.mutate({ template: record }, { onSuccess: r => { onDeleted(); toastInfo(r.summary); } });
  const cancel = () => { setDraft(draftOf(record)); save.clearFieldErrors(); };

  return (
    <>
      <AppliesToCard setup={setup} templateId={record.id} draft={draft} fe={fe} onChange={patch} onDelete={del} deleting={remove.anyPending} />
      <StepsCard setup={setup} steps={steps} fe={fe} onChange={setStep} />
      {save.refusal && <FormWarn testId={tid.monb.warn}>{save.refusal.message} {save.refusal.next}</FormWarn>}
      <ActionBar stuck={dirty}>
        {dirty && <span data-testid={tid.monb.dirty} className="mr-auto text-xs text-text-muted">Unsaved changes</span>}
        <Button testId={tid.monb.cancel} kind="ghost" disabled={!dirty || save.anyPending} onClick={cancel}>Cancel</Button>
        <Button testId={tid.monb.save} kind="primary" disabled={!dirty} pending={save.anyPending} onClick={submit}>Save</Button>
      </ActionBar>
    </>);
}
