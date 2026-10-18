import { useState } from 'react';
import { UsersRound, XIcon } from 'lucide-react';
import { tid } from '@/testids';
import { AdminCard, Button, Combobox, ConfirmModal, Field, FormWarn, Modal, Pill, TextInput } from '@/ui';
import type { OnboardingSetup, UpdateOnbTemplate } from '@/api/onboarding';
import { ONB_TEMPLATE_NAME_MAX, onbTemplateNameProblem } from '@/domain/onboarding-templates';

/* The Applies to card of a named template: the job profiles whose starters are
   asked what it asks, a picker to add one, and Rename and Delete. Rename only
   changes the draft's name; it is stored with Save. A job profile belongs to
   one template at most, so one another template holds is shown but cannot be
   chosen. */
export function AppliesToCard({ setup, templateId, draft, fe, onChange, onDelete, deleting }: {
  setup: OnboardingSetup; templateId: string; draft: UpdateOnbTemplate; fe(field: string): string | undefined;
  onChange(patch: Partial<UpdateOnbTemplate>): void; onDelete(): void; deleting: boolean;
}) {
  const [box, setBox] = useState<'rename' | 'delete' | null>(null);
  const nameOf = (code: string) => setup.jobProfiles.find(p => p.code === code)?.name ?? code;
  const holder = (code: string) => setup.templates.find(t => t.id !== templateId && t.jobProfiles.some(p => p.code === code));
  const options = setup.jobProfiles.filter(p => !draft.jobProfiles.includes(p.code)).map(p => {
    const other = holder(p.code);
    return other
      ? { value: p.code, label: `${p.name} (${p.code}), in ${other.name}`, disabled: true }
      : { value: p.code, label: `${p.name} (${p.code})` };
  });
  const profileError = fe('jobProfiles'), nameError = fe('name');
  return (
    <AdminCard testId={tid.monb.card('applies')} icon={<UsersRound />} title="Applies to" tipTestId={tid.monb.tip('applies')}
      tip="The job profiles that use this template. A job profile belongs to one template at most; every other one uses Default.">
      {draft.jobProfiles.length === 0
        ? <p data-testid={tid.monb.profilesEmpty} className="text-sm text-text-muted">No job profiles yet. Nobody uses this template until you add one and save.</p>
        : <div className="flex flex-wrap gap-sm">
          {draft.jobProfiles.map(code => (
            <Pill key={code} testId={tid.monb.profile(code)} tone="neu" className="gap-xs pr-[3px]">
              {nameOf(code)}
              <Button testId={tid.monb.profileRemove(code)} kind="ghost" small className="size-5 min-h-0 p-0" aria-label={`Remove ${nameOf(code)}`}
                onClick={() => onChange({ jobProfiles: draft.jobProfiles.filter(c => c !== code) })}><XIcon /></Button>
            </Pill>))}
        </div>}
      {profileError && <p data-testid={tid.monb.profileError} role="alert" className="mt-xs text-xs text-err">{profileError}</p>}
      {nameError && <p data-testid={tid.monb.nameError} role="alert" className="mt-xs text-xs text-err">{nameError}</p>}
      <div className="mt-md min-w-0 max-md:w-full md:w-[320px]">
        <Combobox testId={tid.monb.profileAdd} aria-label="Add job profile" searchLabel="Search job profiles" placeholder="Add job profile" options={options}
          onValueChange={code => onChange({ jobProfiles: [...draft.jobProfiles, code] })} />
      </div>
      <div className="mt-lg flex flex-wrap gap-sm">
        <Button testId={tid.monb.templateRename} kind="ghost" small onClick={() => setBox('rename')}>Rename</Button>
        <Button testId={tid.monb.templateDelete} kind="ghost" small onClick={() => setBox('delete')}>Delete</Button>
      </div>
      {box === 'rename' && <RenameDialog setup={setup} templateId={templateId} name={draft.name} onClose={() => setBox(null)}
        onRename={name => { onChange({ name }); setBox(null); }} />}
      {box === 'delete' && <ConfirmModal open onOpenChange={o => { if (!o) setBox(null); }} title={`Delete ${draft.name}?`}
        body="Its job profiles use the Default template from now on. Starters who have not submitted follow the Default template too."
        confirmLabel="Delete template" danger busy={deleting} onConfirm={onDelete} />}
    </AdminCard>);
}

/* The name rule the server applies is checked here first. */
function RenameDialog({ setup, templateId, name: was, onClose, onRename }: {
  setup: OnboardingSetup; templateId: string; name: string; onClose(): void; onRename(name: string): void;
}) {
  const [name, setName] = useState(was);
  const [shown, setShown] = useState(false);
  const problem = onbTemplateNameProblem(name, setup.templates, templateId);
  const go = () => { if (problem) setShown(true); else onRename(name.trim()); };
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={`Rename ${was}`}
      footer={<>
        <Button testId={tid.monb.renameCancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.monb.renameSave} kind="primary" onClick={go}>Rename</Button>
      </>}>
      <Field label="Name" required>
        <TextInput testId={tid.monb.renameName} maxLength={ONB_TEMPLATE_NAME_MAX} aria-invalid={shown && problem ? true : undefined}
          value={name} onChange={e => { setName(e.target.value); setShown(false); }} /></Field>
      <p className="mt-md text-xs text-text-muted">The new name is saved with the rest of the template.</p>
      {shown && problem && <FormWarn testId={tid.monb.renameWarn}>{problem.message}</FormWarn>}
    </Modal>);
}
