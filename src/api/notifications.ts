/* 1c group 4 (brief D9): the bell's inbox and the notification matrix.
   Writes go through useRecordMutation, so the count and the panel change only
   once the server has answered and the inbox has been read again. Every write
   that can notify someone (rota, cover, leave and sickness) lists
   notificationKeys.all among the queries it re-reads. */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import {
  getMyNotifications, getNotificationMatrix, markAllNotificationsRead, markNotificationRead, updateNotificationMatrix,
  type MatrixSaved, type MyNotifications, type NotificationItem, type NotificationMatrix, type NotificationsRead, type UpdateMatrix,
} from '@/contract/notifications';

export const notificationKeys = { all: ['notifications'] as const, mine: ['notifications', 'me'] as const, matrix: ['notifications', 'matrix'] as const };
export const useMyNotifications = () => useQuery({ queryKey: notificationKeys.mine, queryFn: () => api(getMyNotifications) });
export const useNotificationMatrix = () => useQuery({ queryKey: notificationKeys.matrix, queryFn: () => api(getNotificationMatrix) });

export function useMarkRead() {
  return useRecordMutation<{ id: string }, NotificationsRead>({
    mutationFn: v => api(markNotificationRead, { params: { id: v.id } }), recordKey: v => `notification/${v.id}`, invalidates: [notificationKeys.mine],
  });
}
export function useMarkAllRead() {
  return useRecordMutation<null, NotificationsRead>({
    mutationFn: () => api(markAllNotificationsRead), recordKey: () => 'notifications/all', invalidates: [notificationKeys.mine],
  });
}
export function useUpdateMatrix() {
  return useRecordMutation<{ body: UpdateMatrix; ifMatch: number }, MatrixSaved>({
    mutationFn: v => api(updateNotificationMatrix, { body: v.body, ifMatch: v.ifMatch }), recordKey: () => 'notifications/matrix', invalidates: [notificationKeys.matrix],
  });
}
export type { MyNotifications, NotificationItem, NotificationMatrix, MatrixSaved, UpdateMatrix };
