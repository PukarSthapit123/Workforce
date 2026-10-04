/* 1c group 7: My home's month and My documents. Reads only: the month moves
   by asking the server for another one, never by working days out here.
   A request for leave sent from the month waits for approval, which does
   not paint a day, so nothing here needs to be re-read after it. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './client';
import { getDocument, getHome, listMyDocuments, type DocumentRow, type HomeDay, type HomeMonth, type MyDocuments } from '@/contract/home';

export const homeKeys = {
  all: ['home'] as const, month: (month: string) => ['home', month] as const,
  documents: ['documents', 'mine'] as const, document: (id: string) => ['documents', id] as const,
};
/* `month` is '' for the server's current month. The month on screen stays while the next is read. */
export const useHome = (month: string) => useQuery({
  queryKey: homeKeys.month(month), queryFn: () => api(getHome, { query: month ? { month } : {} }), placeholderData: keepPreviousData,
});
export const useMyDocuments = (enabled = true) => useQuery({ queryKey: homeKeys.documents, queryFn: () => api(listMyDocuments), enabled });
export const useDocument = (id: string) => useQuery({ queryKey: homeKeys.document(id), queryFn: () => api(getDocument, { params: { id } }) });
export type { DocumentRow, HomeDay, HomeMonth, MyDocuments };
