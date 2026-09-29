import { useState } from 'react';
import { tid } from '@/testids';
import { Button, Field, TextInput, SelectBox, Modal } from '@/ui';
import { useExceptionWrite, type Capability, type Self, type UserAccess } from '@/api/access';

/* One capability granted or revoked for one person, listed together so both
   kinds of exception show in the order they were added. */
interface ExceptionRow { cap: string; mode: 'grant' | 'revoke' }

export function UserExceptions({ user, capabilities, typeName, templateCapabilities, self, onClose }: {
  user: UserAccess | null; capabilities: Capability[]; typeName: string; templateCapabilities: readonly string[]; self: Self | null; onClose: () => void;
}) {
  const write = useExceptionWrite(self);
  /* '' rather than undefined: kept controlled from the first render, so
     Radix's Select never has to switch from uncontrolled to controlled once
     a capability is chosen. No option ever has value '', so the placeholder
     shows until a real choice is made. */
  const [capId, setCapId] = useState('');
  const [mode, setMode] = useState<'grant' | 'revoke'>('grant');
  const [reason, setReason] = useState('');

  function reset() { setCapId(''); setMode('grant'); setReason(''); write.clearFieldErrors(); }
  function close() { reset(); onClose(); }

  /* An exception only means something as a difference from the template
     (the server refuses anything else with a 422), so the option list only
     ever offers a capability that mode could actually change: something to
     add on grant, something to take away on revoke. */
  const templateSet = new Set(templateCapabilities);
  const capOptions = capabilities.filter(c => (mode === 'grant' ? !templateSet.has(c.id) : templateSet.has(c.id)));

  function changeMode(next: 'grant' | 'revoke') {
    setMode(next);
    const stillOffered = next === 'grant' ? !templateSet.has(capId) : templateSet.has(capId);
    if (!capId || !stillOffered) setCapId('');
  }

  /* M3: one write at a time for this person. Save and every Remove send the
     same If-Match, so while one is in flight the others wait. They wait with
     aria-disabled, so the button just pressed keeps keyboard focus, and the
     handlers below refuse to send while busy. */
  const busy = user !== null && write.isPending(user.email.toLowerCase());
  function save() {
    if (!user || !capId || busy) return;
    write.mutate({ kind: 'add', email: user.email, capability: capId, mode, reason, ifMatch: user.version }, { onSuccess: close });
  }
  function remove(capability: string) {
    if (!user || busy) return;
    write.mutate({ kind: 'remove', email: user.email, capability, ifMatch: user.version });
  }
  const existing: ExceptionRow[] = user
    ? [...user.grants.map(cap => ({ cap, mode: 'grant' as const })), ...user.revocations.map(cap => ({ cap, mode: 'revoke' as const }))]
    : [];
  const capLabel = (id: string) => capabilities.find(c => c.id === id)?.label ?? id;

  return (
    <Modal open={user !== null} onOpenChange={o => { if (!o) close(); }}
      title={user ? `Exceptions for ${user.name}` : 'Exceptions'}
      description={user ? `${typeName}. These changes affect this person only.` : undefined}
      footer={<Button testId={tid.access.exceptionSave} kind="primary" disabled={!capId} pending={busy} onClick={save}>Save exception</Button>}>
      {user && <div className="flex flex-col gap-md">
        <Field label="Grant or revoke">
          <SelectBox testId={tid.access.exceptionMode} value={mode} onValueChange={v => changeMode(v === 'revoke' ? 'revoke' : 'grant')}
            options={[
              { value: 'grant', label: 'Grant: give it, on top of their template' },
              { value: 'revoke', label: 'Revoke: take it away, even though their template has it' },
            ]} />
        </Field>
        <Field label="Capability" required error={write.fieldError('capability')}
          hint={mode === 'grant' ? 'Only capabilities their template does not already include.' : 'Only capabilities their template already includes.'}>
          <SelectBox testId={tid.access.exceptionCap} value={capId} onValueChange={setCapId} placeholder="Choose a capability"
            options={capOptions.map(c => ({ value: c.id, label: c.label }))} />
        </Field>
        <Field label="Reason" required error={write.fieldError('reason')} hint="Exceptions are reviewed, so say why.">
          <TextInput testId={tid.access.exceptionReason} value={reason} onChange={e => setReason(e.target.value)} />
        </Field>
        {existing.length > 0 && <div className="flex flex-col gap-xs">
          <h3 className="text-xs font-semibold text-text-secondary">Current exceptions</h3>
          <ul className="flex flex-col gap-xs">
            {existing.map(x => (
              <li key={x.cap} className="flex items-center justify-between gap-sm rounded-control border border-border p-sm">
                <span>{capLabel(x.cap)}: {x.mode === 'grant' ? 'granted' : 'revoked'}</span>
                <Button testId={tid.access.exceptionRemove(user.email, x.cap)} kind="ghost" small pending={busy} onClick={() => remove(x.cap)}>Remove</Button>
              </li>))}
          </ul>
        </div>}
      </div>}
    </Modal>);
}
