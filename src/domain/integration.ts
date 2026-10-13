/* Module 6 group 5: Business Central (ibc), the prototype's admBC, INT_STATES
   and dispatchInt (qnipay-workforce-v15.html:9911-9948, 2301-2354). The
   platform posts hours and pay codes and never resolves money (P1). The
   outbound call is simulated (P2): approval or a retry queues a posting, and
   only the dispatcher resolves it, so nothing here says a record was
   accepted or confirmed by Business Central. */
import type { AttemptState } from './timesheet';

/* P's INT-a1f3: the record's id as the posting log shows it. */
export const integrationIdOf = (id: string) => `INT-${id.replace(/^int_/, '')}`;

/* INT_STATES, with P's per-row tooltip in plain sentences. */
export const POSTING_STATE: Record<AttemptState, { label: string; tone: 'warn' | 'ok' | 'err'; note: string }> = {
  queued: { label: 'Queued', tone: 'warn', note: 'Queued. No result yet.' },
  posted: { label: 'Posted', tone: 'ok', note: 'Posted by the simulated dispatcher. Not a Business Central confirmation.' },
  failed: { label: 'Failed', tone: 'err', note: 'Failed' },
};
/* A failed row's tooltip is why it failed. */
export const postingNote = (a: { state: AttemptState; reason?: string }) =>
  a.state === 'failed' ? (a.reason || POSTING_STATE.failed.note) : POSTING_STATE[a.state].note;

export interface PostingCounts { posted: number; queued: number; failed: number; mapped: number; codes: number }
/* P's four tiles. Posted counts the current pay period's postings, as P's
   label says; queued and failed count every record still waiting or stuck.
   A code is mapped when it has a Business Central element. */
export function postingCounts(all: readonly { state: AttemptState }[], thisPeriod: readonly { state: AttemptState }[],
  mapping: readonly { element: string }[]): PostingCounts {
  const n = (xs: readonly { state: AttemptState }[], s: AttemptState) => xs.filter(x => x.state === s).length;
  return { posted: n(thisPeriod, 'posted'), queued: n(all, 'queued'), failed: n(all, 'failed'),
    mapped: mapping.filter(m => isMapped(m.element)).length, codes: mapping.length };
}
export const isMapped = (element: string) => element.trim() !== '' && element !== '—';

/* Newest first, as P unshifts each new record. */
export const byNewest = <T extends { at: string; id: string }>(a: T, b: T) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id);

/* dispatchInt's toast, for each record the dispatcher resolved: posted is
   labelled simulated, and a failure says why and what to do. */
export type Resolution = { kind: 'info'; message: string } | { kind: 'error'; message: string; next: string };
export function resolutionToast(a: { state: AttemptState; ref: string; reason?: string }): Resolution | null {
  if (a.state === 'posted') return { kind: 'info', message: `Posted (simulated) · ${a.ref}` };
  if (a.state === 'failed') return { kind: 'error', message: `Posting failed · ${a.ref} · ${a.reason || 'No reason was given.'}`, next: 'Fix the cause, then retry.' };
  return null;
}
/* The one audit row a dispatch run writes. */
export function dispatchAuditText(resolved: readonly { state: AttemptState }[]): string {
  const posted = resolved.filter(a => a.state === 'posted').length, failed = resolved.length - posted;
  return `${resolved.length} resolved by the simulated dispatcher: ${posted} posted (simulated), ${failed} failed`;
}
/* P's dispatcher delay (INT_DELAY): how long a queued record waits on screen before the dispatcher is asked to resolve it. */
export const DISPATCH_DELAY_MS = 2200;
