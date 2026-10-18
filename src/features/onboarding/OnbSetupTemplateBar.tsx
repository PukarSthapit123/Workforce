import { useState } from 'react';
import { tid } from '@/testids';
import { Button, Combobox, ConfirmModal, Field, FieldGrid, FormWarn, Modal, SelectBox, TextInput, Wide, toastInfo } from '@/ui';
import { useCreateOnboardingTemplate, type OnboardingSetup } from '@/api/onboarding';
import { DEFAULT_KEY, DEFAULT_TEMPLATE, ONB_TEMPLATE_NAME_MAX, onbTemplateNameProblem } from '@/domain/onboarding-templates';

const profiles = (n: number) => `${n} job profile${n === 1 ? '' : 's'}`;

/* The picker's options: Default first, with the job profiles no template
   holds, then each template by name. */
function templateOptions(setup: OnboardingSetup) {
  const held = new Set(setup.templates.flatMap(t => t.jobProfiles.map(p => p.code)));
  const free = setup.jobProfiles.filter(p => !held.has(p.code)).length;
  return [
    { value: DEFAULT_KEY, label: `${DEFAULT_TEMPLATE} (${profiles(free)})` },
    ...setup.templates.map(t => ({ value: t.id, label: `${t.name} (${profiles(t.jobProfiles.length)})` })),
  ];
}

type Ask = { k: 'switch'; key: string } | { k: 'new' } | null;

/* Which template the page is on, and New template. While the open template has
   unsaved changes, moving away or starting a new one asks first. */
export function TemplateBar({ setup, selected, dirty, dirtyName, onSelect }: {
  setup: OnboardingSetup; selected: string; dirty: boolean; dirtyName: string; onSelect(key: string): void;
}) {
  const [ask, setAsk] = useState<Ask>(null);
  const [creating, setCreating] = useState(false);
  const go = (a: NonNullable<Ask>) => { if (dirty) setAsk(a); else if (a.k === 'new') setCreating(true); else onSelect(a.key); };
  const discard = () => {
    const a = ask;
    setAsk(null);
    if (a?.k === 'new') setCreating(true);
    else if (a) onSelect(a.key);
  };
  return (
    <div data-testid={tid.monb.templateBar} className="mb-md flex flex-wrap gap-sm">
      <div className="min-w-0 max-md:w-full md:w-[320px]">
        <Combobox testId={tid.monb.template} aria-label="Template" searchLabel="Search templates" options={templateOptions(setup)} value={selected}
          onValueChange={key => { if (key !== selected) go({ k: 'switch', key }); }} />
      </div>
      <Button testId={tid.monb.templateNew} kind="ghost" onClick={() => go({ k: 'new' })}>New template</Button>
      {ask && <ConfirmModal open onOpenChange={o => { if (!o) setAsk(null); }} title="Discard your changes?"
        body={`Save or discard your changes to ${dirtyName} before opening another template.`}
        confirmLabel="Discard changes" cancelLabel="Keep editing" danger onConfirm={discard} />}
      {creating && <NewTemplateDialog setup={setup} onClose={() => setCreating(false)} onCreated={onSelect} />}
    </div>);
}

/* The name rule the server applies is checked here first, so a missing,
   reserved or taken name is said in the form. */
function NewTemplateDialog({ setup, onClose, onCreated }: { setup: OnboardingSetup; onClose(): void; onCreated(id: string): void }) {
  const [name, setName] = useState('');
  const [from, setFrom] = useState(DEFAULT_KEY);
  const [shown, setShown] = useState(false);
  const create = useCreateOnboardingTemplate();
  const problem = onbTemplateNameProblem(name, setup.templates);
  const warn = (shown ? problem?.message : undefined) ?? create.fieldError('name');
  const go = () => {
    if (problem) { setShown(true); return; }
    create.mutate({ name, ...(from === DEFAULT_KEY ? {} : { copyFrom: from }) }, {
      onSuccess: r => { onClose(); onCreated(r.record.id); toastInfo(r.summary); },
    });
  };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="New template"
      footer={<>
        <Button testId={tid.monb.newCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.monb.newCreate} kind="primary" pending={create.anyPending} onClick={go}>Create template</Button>
      </>}>
      <FieldGrid>
        <Wide><Field label="Name" required>
          <TextInput testId={tid.monb.newName} placeholder="e.g. Senior consultants" maxLength={ONB_TEMPLATE_NAME_MAX} aria-invalid={warn ? true : undefined}
            value={name} onChange={e => { setName(e.target.value); setShown(false); create.clearFieldErrors(); }} /></Field></Wide>
        <Wide><Field label="Start from">
          <SelectBox testId={tid.monb.newFrom} options={templateStarts(setup)} value={from} onValueChange={setFrom} /></Field></Wide>
      </FieldGrid>
      <p className="mt-md text-xs text-text-muted">It starts as a copy and applies to nobody until you add a job profile and save.</p>
      {warn && <FormWarn testId={tid.monb.newWarn}>{warn}</FormWarn>}
    </Modal>);
}

const templateStarts = (setup: OnboardingSetup) => [
  { value: DEFAULT_KEY, label: DEFAULT_TEMPLATE }, ...setup.templates.map(t => ({ value: t.id, label: t.name })),
];
