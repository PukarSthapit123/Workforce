import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import { peopleKeys } from './people';
import { decideProfileChange, getProfile, listProfileChanges, proposeChanges, type ProfileChange, type ProposeChanges } from '@/contract/profile';

export const profileKeys = { mine: ['profile'] as const, queue: ['profile-changes'] as const };
export const useProfile = () => useQuery({ queryKey: profileKeys.mine, queryFn: () => api(getProfile) });
export const useProfileQueue = (enabled: boolean) => useQuery({ queryKey: profileKeys.queue, queryFn: () => api(listProfileChanges), enabled });

/* A decision can write the person's record, so the people lists refresh too. */
const AFTER = [profileKeys.mine, profileKeys.queue, peopleKeys.all] as const;
export const useProposeChanges = () => useRecordMutation({
  mutationFn: (body: ProposeChanges) => api(proposeChanges, { body }),
  recordKey: () => 'own-profile',
  invalidates: AFTER,
});
/* One pending key per change: approving one row never blocks another. */
export const useDecide = () => useRecordMutation({
  mutationFn: (v: { change: ProfileChange; decision: 'approve' | 'decline'; reason: string }) =>
    api(decideProfileChange, { params: { id: v.change.id }, body: { decision: v.decision, reason: v.reason }, ifMatch: v.change.version }),
  recordKey: v => v.change.id,
  invalidates: AFTER,
});
