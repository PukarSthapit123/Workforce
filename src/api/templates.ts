/* Templates (D1-D4) on the Organisation page. Writes go through
   useRecordMutation, so nothing changes on screen until the server has
   answered and what it changed has been read again. Applying a template can
   change any module's settings, employee types, role names and structure, so
   it reads everything again, the session included (a role name is in the
   role pill). */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import {
  applyTemplate, exportTemplate, getTemplatePlan, importTemplate, listTemplates, removeTemplate, saveTemplate,
  type SaveTemplate, type TemplateApplied, type TemplateFile, type TemplateImported, type TemplateList, type TemplatePlan, type TemplateRow,
} from '@/contract/templates';

export const templateKeys = { all: ['templates'] as const, plan: (key: string) => ['templates', key, 'plan'] as const };
export const useTemplates = (enabled = true) => useQuery({ queryKey: templateKeys.all, queryFn: () => api(listTemplates), enabled });
/* The preview an apply asks for first; read fresh each time it is opened. */
export const useTemplatePlan = (key: string | null) => useQuery({
  queryKey: templateKeys.plan(key ?? ''), queryFn: () => api(getTemplatePlan, { params: { key: key ?? '' } }), enabled: key !== null, staleTime: 0, gcTime: 0,
});

export function useSaveTemplate() {
  return useRecordMutation<SaveTemplate, { record: TemplateRow; auditId: string }>({
    mutationFn: body => api(saveTemplate, { body }), recordKey: () => 'templates', invalidates: [templateKeys.all],
  });
}
const EVERYTHING = [[]] as const;
export function useApplyTemplate() {
  return useRecordMutation<{ key: string; ifMatch: number }, TemplateApplied>({
    mutationFn: v => api(applyTemplate, { params: { key: v.key }, ifMatch: v.ifMatch }),
    recordKey: () => 'tenant', invalidates: EVERYTHING, refreshesSession: true,
  });
}
export function useImportTemplate() {
  return useRecordMutation<{ text: string }, TemplateImported>({
    mutationFn: body => api(importTemplate, { body }), recordKey: () => 'templates', invalidates: [templateKeys.all],
  });
}
export function useRemoveTemplate() {
  return useRecordMutation<{ key: string; ifMatch: number }, { auditId: string }>({
    mutationFn: v => api(removeTemplate, { params: { key: v.key }, ifMatch: v.ifMatch }), recordKey: v => v.key, invalidates: [templateKeys.all],
  });
}
/* The export is a read on demand: fetched when asked for and not kept. */
export function useExportTemplate() {
  const [pending, setPending] = useState<string | null>(null);
  const run = async (key: string): Promise<TemplateFile> => {
    setPending(key);
    try { return await api(exportTemplate, { params: { key } }); } finally { setPending(null); }
  };
  return { run, pending };
}
export type { TemplateList, TemplatePlan, TemplateRow, TemplateApplied, TemplateImported, TemplateFile, SaveTemplate };
