import { useCallback, useRef, useState } from 'react';
import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from './client';
import { sessionEvents } from './session-events';
import { toastRefusal } from '@/ui/toast';
import type { Refusal } from '@/contract/common';

export interface RecordMutationOptions<TVars, TData> {
  mutationFn: (vars: TVars) => Promise<TData>;
  /* The record a call writes, such as the template id or the account email.
     While a call for a key is in flight, a second call for the same key is
     dropped, and isPending(key) is true. Calls for different keys run side by
     side, each guarded on its own. */
  recordKey: (vars: TVars) => string;
  /* The caller's queries this write can change. ['audit'] is always added. */
  invalidates: readonly QueryKey[];
  /* True when the write can change the caller's own capabilities (their own
     template, their own exception): the session and the nav are re-read. */
  refreshesSession?: boolean | ((vars: TVars, data: TData) => boolean);
}

/* The one way a screen writes a record. No optimistic updates: the screen
   changes only once the server has answered and the affected queries have
   been read again. On a refusal the toast says what happened and what to do
   next; a 412 re-reads the caller's queries first, so the next attempt sends
   the fresh version; refusal.field becomes a field error a form shows
   through Field's `error`. */
export function useRecordMutation<TVars, TData>(opts: RecordMutationOptions<TVars, TData>) {
  const qc = useQueryClient();
  /* The ref is the guard (it is up to date inside the same click); the state
     copy is what render reads. */
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());
  const [fieldErrors, setFieldErrors] = useState<Readonly<Record<string, string>>>({});
  /* The last refusal, so a form can also say inline why it was not saved (a
     409 names what uses a record and has no single field). Cleared when the
     next call is sent. */
  const [refusal, setRefusal] = useState<Refusal | null>(null);
  const refetch = (keys: readonly QueryKey[]) => Promise.all(keys.map(queryKey => qc.invalidateQueries({ queryKey })));

  const m = useMutation({
    mutationFn: opts.mutationFn,
    /* Returning the promise keeps the call pending until the queries it
       changed have been read again, so a control is never re-enabled over a
       stale version. */
    onSuccess: async (data, vars) => {
      const refresh = typeof opts.refreshesSession === 'function' ? opts.refreshesSession(vars, data) : opts.refreshesSession === true;
      if (refresh) sessionEvents.emit('refresh');
      await refetch([...opts.invalidates, ['audit']]);
    },
    onError: async error => {
      if (!(error instanceof ApiError)) return;
      /* A 401 is handled once, globally (src/api/query.ts's MutationCache
         onError signs out and toasts the same refusal); toasting it again
         here would just double it up. */
      if (error.status === 401) return;
      toastRefusal(error.refusal);
      setRefusal(error.refusal);
      const field = error.refusal.field;
      if (field) setFieldErrors(f => ({ ...f, [field]: error.refusal.message }));
      if (error.status === 412) await refetch(opts.invalidates);
    },
    onSettled: (_data, _error, vars) => {
      inFlight.current.delete(opts.recordKey(vars));
      setPending(new Set(inFlight.current));
    },
  });
  const { mutateAsync } = m;

  /* Returns false, and sends nothing, when a write to the same record is
     already in flight. onSuccess runs for this call only, whichever call
     finishes last. */
  const mutate = useCallback((vars: TVars, callbacks?: { onSuccess?: (data: TData) => void }): boolean => {
    const key = opts.recordKey(vars);
    if (inFlight.current.has(key)) return false;
    inFlight.current.add(key);
    setPending(new Set(inFlight.current));
    setFieldErrors({});
    setRefusal(null);
    mutateAsync(vars).then(data => callbacks?.onSuccess?.(data), () => { /* toasted in onError */ });
    return true;
  }, [mutateAsync, opts]);

  return {
    mutate,
    isPending: (key: string) => pending.has(key),
    anyPending: pending.size > 0,
    fieldError: (field: string): string | undefined => fieldErrors[field],
    clearFieldErrors: () => { setFieldErrors({}); setRefusal(null); },
    refusal,
  };
}
