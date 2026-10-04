/* 1c group 6: the notice board (D10). Writes go through useRecordMutation,
   so a list changes only once the server has answered and the notices have
   been read again. A poster's write sends the version it read as If-Match;
   an acknowledgement sends the textVersion the reader saw. Going live or a
   text change raises notifications, so those re-read the inbox too. */
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import { notificationKeys } from './notifications';
import {
  acknowledgeNotice, createNotice, deleteNotice, editNotice, getMyNotice, listMyNotices, listPostedNotices, pinNotice, postNotice, trackNotice, withdrawNotice,
  type Acknowledged, type CreateNotice, type EditNotice, type MyNotices, type NoticeDeleted, type NoticeSaved, type NoticeScope, type NoticeStatus, type NoticeTrack,
  type PostedNotices, type PosterNotice, type ReaderNotice, type ReaderState, type ScopeOption, type StatusFilter,
} from '@/contract/notices';

export const noticeKeys = {
  all: ['notices'] as const, mine: ['notices', 'mine'] as const, posted: (status: StatusFilter) => ['notices', 'posted', status] as const,
  track: (id: string) => ['notices', 'track', id] as const, one: (id: string) => ['notices', 'mine', id] as const,
};
export const useMyNotices = (enabled = true) => useQuery({ queryKey: noticeKeys.mine, queryFn: () => api(listMyNotices), enabled });
export const useMyNotice = (id: string) => useQuery({ queryKey: noticeKeys.one(id), queryFn: () => api(getMyNotice, { params: { id } }) });
export const usePostedNotices = (status: StatusFilter) =>
  useQuery({ queryKey: noticeKeys.posted(status), queryFn: () => api(listPostedNotices, { query: status === 'all' ? {} : { status } }) });
export const useNoticeTrack = (id: string) => useQuery({ queryKey: noticeKeys.track(id), queryFn: () => api(trackNotice, { params: { id } }) });

const WRITES = [noticeKeys.all, notificationKeys.all] as const;
/* A notice that changed or closed since it was read is read again, so the
   reader sees the new words (or that it has gone) before trying again. */
export function useAcknowledgeNotice() {
  const qc = useQueryClient();
  const m = useRecordMutation<{ id: string; textVersion: number }, Acknowledged>({
    mutationFn: v => api(acknowledgeNotice, { params: { id: v.id }, body: { textVersion: v.textVersion } }), recordKey: v => `notice/${v.id}`, invalidates: [noticeKeys.all],
  });
  const code = m.refusal?.code;
  useEffect(() => { if (code === 'CHANGED' || code === 'CLOSED') void qc.invalidateQueries({ queryKey: noticeKeys.all }); }, [code, qc]);
  return m;
}
export function useCreateNotice() {
  return useRecordMutation<CreateNotice, NoticeSaved>({ mutationFn: body => api(createNotice, { body }), recordKey: () => 'notices/new', invalidates: WRITES });
}
export function useEditNotice() {
  return useRecordMutation<{ id: string; change: EditNotice; ifMatch: number }, NoticeSaved>({
    mutationFn: v => api(editNotice, { params: { id: v.id }, body: v.change, ifMatch: v.ifMatch }), recordKey: v => `notice/${v.id}`, invalidates: WRITES,
  });
}
export function usePinNotice() {
  return useRecordMutation<{ id: string; pinned: boolean; ifMatch: number }, NoticeSaved>({
    mutationFn: v => api(pinNotice, { params: { id: v.id }, body: { pinned: v.pinned }, ifMatch: v.ifMatch }), recordKey: v => `notice/${v.id}`, invalidates: [noticeKeys.all],
  });
}
export function usePostNotice() {
  return useRecordMutation<{ id: string; ifMatch: number }, NoticeSaved>({
    mutationFn: v => api(postNotice, { params: { id: v.id }, ifMatch: v.ifMatch }), recordKey: v => `notice/${v.id}`, invalidates: WRITES,
  });
}
export function useWithdrawNotice() {
  return useRecordMutation<{ id: string; reason: string; ifMatch: number }, NoticeSaved>({
    mutationFn: v => api(withdrawNotice, { params: { id: v.id }, body: { reason: v.reason }, ifMatch: v.ifMatch }), recordKey: v => `notice/${v.id}`, invalidates: [noticeKeys.all],
  });
}
export function useDeleteNotice() {
  return useRecordMutation<{ id: string; ifMatch: number }, NoticeDeleted>({
    mutationFn: v => api(deleteNotice, { params: { id: v.id }, ifMatch: v.ifMatch }), recordKey: v => `notice/${v.id}`, invalidates: [noticeKeys.all],
  });
}
export type {
  Acknowledged, CreateNotice, EditNotice, MyNotices, NoticeDeleted, NoticeSaved, NoticeScope, NoticeStatus, NoticeTrack, PostedNotices, PosterNotice, ReaderNotice,
  ReaderState, ScopeOption, StatusFilter,
};
