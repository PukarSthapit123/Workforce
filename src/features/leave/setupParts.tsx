import type { ReactNode } from 'react';
import { FormWarn } from '@/ui';
import type { Refusal } from '@/contract/common';

/* Small pieces Leave setup and its policy page share. */
export function Err({ text }: { text?: string }) {
  return text ? <p role="alert" className="mt-xs text-xs text-err">{text}</p> : null;
}
/* a control with its error under it, right-aligned in a setting row */
export function Control({ error, children }: { error?: string; children: ReactNode }) {
  return <div className="flex flex-col items-end max-md:items-start">{children}<Err text={error} /></div>;
}
export const invalid = (error: string | undefined) => (error ? true : undefined);

/* A refusal as the server gave it: what happened, what to do next, and what uses the record (D2). */
const kindLabel = (kind: string) => kind.charAt(0).toUpperCase() + kind.slice(1);
export function RefusalWarn({ testId, refusal }: { testId: string; refusal: Refusal }) {
  return (
    <FormWarn testId={testId}>
      {refusal.message} {refusal.next}
      {refusal.usedBy?.map(u => (
        <span key={u.kind} className="mt-xs block">{kindLabel(u.kind)} ({u.count}): {u.examples.join(', ')}{u.count > u.examples.length ? ' and more' : ''}</span>))}
    </FormWarn>);
}
