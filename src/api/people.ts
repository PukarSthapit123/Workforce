import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import {
  createPerson, getNextCode, getPerson, listHistory, listPeople, transitionPerson, updatePerson,
  type CreatePerson, type Person, type UpdatePerson,
} from '@/contract/people';

type StateFilter = 'here' | 'all' | Person['state'];
export const peopleKeys = {
  all: ['people'] as const,
  list: (state: string, q: string) => ['people', 'list', state, q] as const,
  one: (id: string) => ['people', 'one', id] as const,
  history: (id: string) => ['people', 'history', id] as const,
  next: ['people', 'next-code'] as const,
};
/* The previous page of results stays on screen while a new search is read,
   so typing in the search box does not blank the table between keystrokes. */
export const usePeople = (state: StateFilter, q: string) =>
  useQuery({ queryKey: peopleKeys.list(state, q), queryFn: () => api(listPeople, { query: { state, q } }), placeholderData: keepPreviousData });
export const usePerson = (id: string) =>
  useQuery({ queryKey: peopleKeys.one(id), queryFn: () => api(getPerson, { params: { id } }) });
export const useHistory = (id: string) =>
  useQuery({ queryKey: peopleKeys.history(id), queryFn: () => api(listHistory, { params: { id } }) });
export const useNextCode = (enabled: boolean) =>
  useQuery({ queryKey: peopleKeys.next, queryFn: () => api(getNextCode), enabled, staleTime: 0 });

/* A person's writes change the in-use counts of the dimensions and types, and
   who is onboarding (a starter has a case, D1). The onboarding key is written
   out rather than imported, since src/api/onboarding.ts imports from here. */
const AFTER_PERSON = [peopleKeys.all, ['dims'], ['employee-types'], ['onboarding']] as const;

export const useCreatePerson = () => useRecordMutation({
  mutationFn: (body: CreatePerson) => api(createPerson, { body }),
  recordKey: () => 'new-person',
  invalidates: AFTER_PERSON,
});
/* Every edit of one person shares one pending key, so a second save waits
   for the first and always sends the fresh version. */
export const useUpdatePerson = () => useRecordMutation({
  mutationFn: (v: { person: Person; body: UpdatePerson }) =>
    api(updatePerson, { params: { id: v.person.id }, body: v.body, ifMatch: v.person.version }),
  recordKey: v => v.person.id,
  invalidates: AFTER_PERSON,
});
export const useMovePerson = () => useRecordMutation({
  mutationFn: (v: { person: Person; to: string; reason: string }) =>
    api(transitionPerson, { params: { id: v.person.id }, body: { to: v.to, reason: v.reason }, ifMatch: v.person.version }),
  recordKey: v => v.person.id,
  invalidates: [peopleKeys.all, ['onboarding']],
});
export type { StateFilter };
