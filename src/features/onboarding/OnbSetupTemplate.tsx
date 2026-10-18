import { useEffect, useState } from 'react';
import { UsersRound } from 'lucide-react';
import { tid } from '@/testids';
import { ActionBar, AdminCard, Button, FormWarn, toastInfo } from '@/ui';
import {
  useOnboardingTemplate, useSaveOnboardingTemplate, type OnbStepRecord, type OnbTemplateRecord, type OnboardingSetup, type UpdateOnbTemplate,
} from '@/api/onboarding';
import { versionKey } from '@/lib/latest';
import { StepsCard } from './OnbSetupSteps';

/* A named template: its own draft, saved whole with If-Match. The labels,
   descriptions and checks of steps and documents stay on the shared config. */
const draftOf = (t: OnbTemplateRecord): UpdateOnbTemplate => ({
  name: t.name, jobProfiles: [...t.jobProfiles], steps: t.steps.map(s => ({ ...s })), documents: t.documents.map(d => ({ ...d })), policies: [...t.policies],
});

export function TemplateDraftView({ setup, id, onDirtyChange }: {
  setup: OnboardingSetup; id: string; onDirtyChange(dirty: boolean): void; onDeleted(): void;
}) {
  const row = useOnboardingTemplate(id);
  if (!row.data) return row.isError ? null : <p data-testid={tid.monb.templateLoading} className="text-text-secondary">Loading the template&hellip;</p>;
  /* the draft starts again from what the server holds whenever the template gets a new version */
  return <TemplateDraft key={versionKey(row.data)} setup={setup} record={row.data} onDirtyChange={onDirtyChange} />;
}

function TemplateDraft({ setup, record, onDirtyChange }: { setup: OnboardingSetup; record: OnbTemplateRecord; onDirtyChange(dirty: boolean): void }) {
  const [draft, setDraft] = useState<UpdateOnbTemplate>(() => draftOf(record));
  const save = useSaveOnboardingTemplate();
  const dirty = JSON.stringify(draft) !== JSON.stringify(draftOf(record));
  useEffect(() => { onDirtyChange(dirty); }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange(false), [onDirtyChange]);
  const fe = save.fieldError;
  const steps: OnbStepRecord[] = setup.config.steps.map(s => ({ ...s, on: s.fixed || (draft.steps.find(x => x.id === s.id)?.on ?? false) }));
  const setStep = (stepId: string, on: boolean) => setDraft(d => ({ ...d, steps: d.steps.map(s => (s.id === stepId ? { ...s, on } : s)) }));
  const submit = () => save.mutate({ template: record, body: draft }, { onSuccess: d => toastInfo(d.summary) });
  const cancel = () => { setDraft(draftOf(record)); save.clearFieldErrors(); };

  return (
    <>
      {/* filled by the job profiles, documents and policies of the template */}
      <AdminCard testId={tid.monb.card('applies')} icon={<UsersRound />} title="Applies to" tipTestId={tid.monb.tip('applies')}
        tip="The job profiles whose starters are asked what this template asks.">{null}</AdminCard>
      <StepsCard setup={setup} steps={steps} fe={fe} onChange={setStep} />
      {save.refusal && <FormWarn testId={tid.monb.warn}>{save.refusal.message} {save.refusal.next}</FormWarn>}
      <ActionBar stuck={dirty}>
        {dirty && <span data-testid={tid.monb.dirty} className="mr-auto text-xs text-text-muted">Unsaved changes</span>}
        <Button testId={tid.monb.cancel} kind="ghost" disabled={!dirty || save.anyPending} onClick={cancel}>Cancel</Button>
        <Button testId={tid.monb.save} kind="primary" disabled={!dirty} pending={save.anyPending} onClick={submit}>Save</Button>
      </ActionBar>
    </>);
}
