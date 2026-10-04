/* Saved data (acal, D14): where this demonstration holds its work. A reset or
   a restore replaces everything, so every query is read again and so is the
   session. */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import { exportSavedData, getSavedData, resetSavedData, restoreSavedData, type SavedData, type SavedDataExport } from '@/contract/saved-data';

export const savedDataKeys = { all: ['saved-data'] as const };
export const useSavedData = () => useQuery({ queryKey: savedDataKeys.all, queryFn: () => api(getSavedData) });

const EVERYTHING = [[]] as const;
export function useResetSavedData() {
  return useRecordMutation<void, SavedData>({
    mutationFn: () => api(resetSavedData), recordKey: () => 'saved-data', invalidates: EVERYTHING, refreshesSession: true,
  });
}
export function useRestoreSavedData() {
  return useRecordMutation<void, SavedData>({
    mutationFn: () => api(restoreSavedData), recordKey: () => 'saved-data', invalidates: EVERYTHING, refreshesSession: true,
  });
}
/* The export is a read on demand: it is fetched when asked for and not kept. */
export function useExportSavedData() {
  const [pending, setPending] = useState(false);
  const run = async (): Promise<SavedDataExport> => {
    setPending(true);
    try { return await api(exportSavedData); } finally { setPending(false); }
  };
  return { run, pending };
}
export type { SavedData, SavedDataExport };
