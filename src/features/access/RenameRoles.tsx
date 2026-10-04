import { useState } from 'react';
import { tid } from '@/testids';
import { Button, Field, FormWarn, Modal, TextInput, toastInfo } from '@/ui';
import { useRenameUserType } from '@/api/tenant';
import type { Self, UserType } from '@/api/access';
import { ROLE_NAME_MAX, roleNameProblem } from '@/domain/modules';

/* Rename roles: the prototype's role-names and role-names-save cases
   (qnipay-workforce-v15.html:12046-12071), opened from the Permissions page
   (8334). One field per user type, labelled with what that persona does.
   The names are checked together first (every role needs a name, no two may
   share one), so nothing is sent while one is wrong; then each changed name
   is saved on its own user type with that type's version, one after another,
   and a refusal from the server lands on the field it names. Renaming changes
   only the display name (D11): personas and capabilities stay as they are. */
export function RenameRolesDialog({ types, self, onClose }: { types: readonly UserType[]; self: Self | null; onClose(): void }) {
  const rename = useRenameUserType(self);
  const [names, setNames] = useState<Record<string, string>>(() => Object.fromEntries(types.map(t => [t.id, t.name])));
  const [problems, setProblems] = useState<Record<string, string>>({});
  /* the type whose save the server refused, so its message shows on that field */
  const [sending, setSending] = useState<string | null>(null);
  const nameOf = (t: UserType) => names[t.id] ?? t.name;
  const serverError = sending ? rename.fieldError('name') : undefined;
  const errorFor = (id: string) => problems[id] ?? (id === sending ? serverError : undefined);

  const save = () => {
    const found: Record<string, string> = {};
    /* as the prototype checks them: a name is taken when a role above it already has it */
    types.forEach((t, i) => {
      const p = roleNameProblem(nameOf(t), types.slice(0, i).map(nameOf));
      if (p) found[t.id] = p.message;
    });
    setProblems(found);
    if (Object.keys(found).length) return;
    const changed = types.filter(t => nameOf(t).trim() !== t.name);
    if (!changed.length) { onClose(); return; }
    /* a type taking a name another type is giving up goes after it */
    const queue = [...changed].sort((a, b) =>
      Number(changed.some(o => o.name.toLowerCase() === nameOf(a).trim().toLowerCase())) - Number(changed.some(o => o.name.toLowerCase() === nameOf(b).trim().toLowerCase())));
    const next = (rest: UserType[]) => {
      const [t, ...more] = rest;
      if (!t) {
        onClose();
        toastInfo(`Roles renamed: ${types.map(x => nameOf(x).trim()).join(', ')}.`, 'It is live for everyone now.');
        return;
      }
      setSending(t.id);
      rename.mutate({ id: t.id, name: nameOf(t).trim(), ifMatch: t.version }, { onSuccess: () => next(more) });
    };
    next(queue);
  };
  /* a refusal that names no field (a stale version, a lost connection) is said under the fields */
  const warn = sending && rename.refusal && !rename.refusal.field ? `${rename.refusal.message} ${rename.refusal.next}` : undefined;

  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title="Rename roles"
      description="What each persona may do is set by the permission matrix. This only changes what they are called, across the switcher, the matrix, notifications and the audit log."
      footer={<>
        <Button testId={tid.roleNames.cancel} kind="ghost" onClick={onClose}>Cancel</Button>
        <Button testId={tid.roleNames.save} kind="primary" pending={rename.anyPending} onClick={save}>Save names</Button>
      </>}>
      {types.map(t => (
        <Field key={t.id} label={t.description || t.id} error={errorFor(t.id)}>
          <TextInput testId={tid.roleNames.field(t.id)} value={nameOf(t)} maxLength={ROLE_NAME_MAX}
            onChange={e => { const v = e.target.value; setNames(n => ({ ...n, [t.id]: v })); }} />
        </Field>))}
      {warn && <FormWarn testId={tid.roleNames.warn}>{warn}</FormWarn>}
    </Modal>);
}
