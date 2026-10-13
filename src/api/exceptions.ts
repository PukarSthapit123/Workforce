/* Module 6 group 2: Exceptions. The list is the server's derivation at one
   location; each move is its own endpoint, sent with the handling record's
   version (0 before anyone has acted on it) through useRecordMutation. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import {
  ignoreException, listExceptions, releaseException, reopenException, resolveException, takeException,
  type ExceptionItem, type ExceptionList, type ExceptionMoved,
} from '@/contract/exceptions';
import type { ExceptionMove } from '@/domain/exceptions';

export const exceptionKeys = {
  all: ['exceptions'] as const,
  at: (location: string) => ['exceptions', location] as const,
};
/* '' reads the reader's own location; the previous location stays on screen while another loads */
export const useExceptions = (location: string) => useQuery({
  queryKey: exceptionKeys.at(location), queryFn: () => api(listExceptions, { query: location ? { location } : {} }), placeholderData: keepPreviousData,
});

export interface MoveVars { id: string; move: ExceptionMove; ifMatch: number; note: string }
function send(v: MoveVars): Promise<ExceptionMoved> {
  const o = { params: { id: v.id }, ifMatch: v.ifMatch };
  switch (v.move) {
    case 'take': return api(takeException, o);
    case 'release': return api(releaseException, o);
    case 'resolve': return api(resolveException, { ...o, body: { note: v.note } });
    case 'ignore': return api(ignoreException, { ...o, body: { reason: v.note } });
    case 'reopen': return api(reopenException, o);
  }
}
export const useMoveException = () => useRecordMutation({
  mutationFn: send, recordKey: (v: MoveVars) => `exception/${v.id}`, invalidates: [exceptionKeys.all],
});

export type { ExceptionItem, ExceptionList };
