import { tid } from '@/testids';
import { Button, CheckboxField, Modal, Pill, ScopeBadge, Small } from '@/ui';
import { cn } from '@/lib/utils';
import type { OnbPolicyView } from '@/api/onboarding';

/* The prototype's onbPolicies and the onb-read and onb-ack handlers
   (qnipay-workforce-v15.html:4448-4467, 11593-11620). A policy is a document
   you read and tick, so it reads as a list of documents with a checkbox each,
   not as a settings page with switches. Each shows the version it is at; a
   tick records that version, so a new upload asks again (D10). */

/* .doc-item (v15:1094-1100): green once acknowledged. */
export const DOC_ITEM = 'flex items-start gap-md rounded-control border bg-surface-card p-md max-md:flex-col max-md:items-stretch';
export const DOC_DONE = 'border-ok bg-ok-surface';

export function PolicyList({ policies, disabled, lockTicks, error, onAck, onRead }: {
  policies: readonly OnbPolicyView[]; disabled: boolean;
  /* after submission a tick can be given but not taken back */
  lockTicks?: boolean;
  error(id: string): string | undefined;
  onAck(p: OnbPolicyView, on: boolean): void; onRead(p: OnbPolicyView): void;
}) {
  return (
    <ul className="m-0 flex list-none flex-col gap-sm p-0">
      {policies.map(p => {
        const bad = error(p.id);
        return (
          <li key={p.id} data-testid={tid.onb.pol(p.id)} className={cn(DOC_ITEM, p.acknowledged && DOC_DONE)}>
            <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-sm">
              <CheckboxField testId={tid.onb.polAck(p.id)} className="mt-[2px] shrink-0" checked={p.acknowledged}
                aria-label={`I have read ${p.label} ${p.ver}`} disabled={disabled || (lockTicks && p.acknowledged)}
                onCheckedChange={on => onAck(p, on === true)} />
              <span className="min-w-0">
                <span className="block text-sm font-[650]">{p.label}<span data-testid={tid.onb.polVer(p.id)}><ScopeBadge>{p.ver}</ScopeBadge></span>
                  {p.read && !p.acknowledged && <Pill testId={tid.onb.polReadPill(p.id)} tone="neu" className="ml-[6px]">Read</Pill>}</span>
                <span className="mt-[2px] block text-xs text-text-secondary">{p.sum}</span>
                {bad && <span data-testid={tid.onb.polError(p.id)} role="alert" className="mt-xs block text-xs text-err">{bad}</span>}
              </span>
            </label>
            <Button testId={tid.onb.polRead(p.id)} kind="ghost" small onClick={() => onRead(p)}>Read it</Button>
          </li>);
      })}
    </ul>);
}

export function PoliciesStep(props: Parameters<typeof PolicyList>[0]) {
  const done = props.policies.filter(p => p.acknowledged).length;
  return (
    <>
      <p className="mb-xs text-sm text-text-secondary">Read each one, then tick to confirm you have.{' '}
        <b data-testid={tid.onb.polCount} className="font-semibold text-text-primary">{done} of {props.policies.length}</b> done.</p>
      <PolicyList {...props} />
      <Small className="mt-xs">Your confirmation records the version shown. If a policy changes you will be asked again.</Small>
    </>);
}

/* onb-read (v15:11593-11606): the policy's text, and "I have read and understood". */
export function ReadDialog({ p, busy, onClose, onAck }: { p: OnbPolicyView; busy: boolean; onClose(): void; onAck(): void }) {
  return (
    <Modal open onOpenChange={o => { if (!o) onClose(); }} title={p.label} scope={p.ver} width="wide"
      footer={<>
        <Button testId={tid.onb.readClose} kind="ghost" onClick={onClose}>Close</Button>
        {!p.acknowledged && <Button testId={tid.onb.readAck} kind="primary" pending={busy} onClick={onAck}>I have read and understood</Button>}
      </>}>
      <p className="mb-md text-sm text-text-secondary">{p.sum}</p>
      <div data-testid={tid.onb.readBody} className="max-h-[46vh] overflow-auto rounded-control border bg-surface-sunken p-lg">
        {p.body.length
          ? p.body.map((x, i) => <p key={i} className="mb-md text-sm leading-[1.65] last:mb-0">{x}</p>)
          : <p className="text-sm leading-[1.65]">Only the summary above is held here. Ask HR for the full document.</p>}
      </div>
      <Small className="mt-md">An extract. The policy is versioned, so a change asks everyone to read it again.</Small>
    </Modal>);
}
