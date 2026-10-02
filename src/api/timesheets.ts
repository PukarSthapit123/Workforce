/* Module 2 Timesheet: the reads and writes the ts, tteam, proxy and mts screens
   use. Writes go through useRecordMutation, so nothing changes on screen until
   the server has answered and the queries below have been read again. */
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from './client';
import { useRecordMutation } from './mutation';
import {
  bulkApproveTimesheets, getTimesheetConfig, getTimesheetWeek, listTimesheetApprovals, retryIntegrationAttempt, saveTimesheetDay,
  submitMultiweek, submitTimesheetDay, submitTimesheetWeek, transitionTimesheetDay, updateTimesheetConfig,
  type ApprovalQueue, type BulkApproved, type DayInput, type IntegrationAttempt, type QueueRow, type TimesheetConfig, type TimesheetDay, type TimesheetSetup,
  type TimesheetWeek, type UpdateTimesheetConfig, type WeekSubmit,
} from '@/contract/timesheets';

export type QueueStatus = 'pend' | 'all' | 'resub' | 'ok' | 'back';
export const timesheetKeys = {
  all: ['timesheets'] as const,
  week: (personId: string, weekStart: string) => ['timesheets', 'week', personId, weekStart] as const,
  queue: ['timesheets', 'queue'] as const,
  queueList: (status: QueueStatus, q: string, weekStart: string, cursor: string) => ['timesheets', 'queue', status, q, weekStart, cursor] as const,
  config: ['timesheet-config'] as const,
};

/* One person's week: your own, or a team member's for proxy entry (the grid
   and the form are the target's, D6). */
export const useTimesheetWeek = (personId: string, weekStart: string, enabled = true) => useQuery({
  queryKey: timesheetKeys.week(personId, weekStart), queryFn: () => api(getTimesheetWeek, { params: { personId, weekStart } }), enabled,
});
/* The approver's queue. The previous page stays on screen while a new filter is read. */
export const useApprovalQueue = (f: { status: QueueStatus; q?: string; weekStart?: string; cursor?: string }, enabled = true) => useQuery({
  queryKey: timesheetKeys.queueList(f.status, f.q ?? '', f.weekStart ?? '', f.cursor ?? ''),
  queryFn: () => api(listTimesheetApprovals, { query: { status: f.status, q: f.q, weekStart: f.weekStart, cursor: f.cursor } }),
  placeholderData: keepPreviousData, enabled,
});
export const useTimesheetConfig = (enabled = true) => useQuery({ queryKey: timesheetKeys.config, queryFn: () => api(getTimesheetConfig), enabled });

/* Every timesheet write can change a week, the queue and its counts. */
const AFTER = [timesheetKeys.all] as const;
/* `version` is the day's version as last read: WeekDay.version, 0 for a day with no record. */
export interface DayWrite { personId: string; date: string; version: number; body: DayInput }
export const useSaveDay = () => useRecordMutation({
  mutationFn: (v: DayWrite) => api(saveTimesheetDay, { params: { personId: v.personId, date: v.date }, body: v.body, ifMatch: v.version }),
  recordKey: v => `${v.personId}/${v.date}`,
  invalidates: AFTER,
});
export const useSubmitDay = () => useRecordMutation({
  mutationFn: (v: DayWrite) => api(submitTimesheetDay, { params: { personId: v.personId, date: v.date }, body: v.body, ifMatch: v.version }),
  recordKey: v => `${v.personId}/${v.date}`,
  invalidates: AFTER,
});
export const useSubmitWeek = () => useRecordMutation({
  mutationFn: (v: { personId: string; weekStart: string; body: WeekSubmit }) =>
    api(submitTimesheetWeek, { params: { personId: v.personId, weekStart: v.weekStart }, body: v.body }),
  recordKey: v => `${v.personId}/week/${v.weekStart}`,
  invalidates: AFTER,
});
export const useSubmitMultiweek = () => useRecordMutation({
  mutationFn: (v: { personId: string; weeks: string[] }) => api(submitMultiweek, { params: { personId: v.personId }, body: { weeks: v.weeks } }),
  recordKey: v => `${v.personId}/multiweek`,
  invalidates: AFTER,
});
/* Approve or return one day. One pending key per day: deciding one row never blocks another. */
export const useDecideDay = () => useRecordMutation({
  mutationFn: (v: { day: Pick<TimesheetDay, 'id' | 'version'>; to: 'ok' | 'back'; reason: string }) =>
    api(transitionTimesheetDay, { params: { id: v.day.id }, body: { to: v.to, reason: v.reason }, ifMatch: v.day.version }),
  recordKey: v => v.day.id,
  invalidates: AFTER,
});
/* The ids and checksum are the ones the queue read returned (ApprovalQueue.bulk),
   or for the matrix the chosen rows' ids with queueChecksum over those rows. */
/* QUEUE_CHANGED approves nothing (D7); the queue is read again before the
   refusal reaches the screen, so the next attempt is over what is there now. */
export const useBulkApprove = () => {
  const qc = useQueryClient();
  return useRecordMutation({
    mutationFn: async (v: { ids: string[]; checksum: string }) => {
      try { return await api(bulkApproveTimesheets, { body: v }); } catch (e) {
        if (e instanceof ApiError && e.refusal.code === 'QUEUE_CHANGED') await qc.invalidateQueries({ queryKey: timesheetKeys.queue });
        throw e;
      }
    },
    recordKey: () => 'timesheet-bulk',
    invalidates: AFTER,
  });
};
export const useSaveTimesheetConfig = () => useRecordMutation({
  mutationFn: (v: { config: Pick<TimesheetConfig, 'version'>; body: UpdateTimesheetConfig }) =>
    api(updateTimesheetConfig, { body: v.body, ifMatch: v.config.version }),
  recordKey: () => 'timesheet-config',
  invalidates: [timesheetKeys.config, timesheetKeys.all],
});
/* No screen in this module (the Business Central page is module 6). */
export const useRetryAttempt = () => useRecordMutation({
  mutationFn: (a: Pick<IntegrationAttempt, 'id' | 'version'>) => api(retryIntegrationAttempt, { params: { id: a.id }, ifMatch: a.version }),
  recordKey: a => a.id,
  invalidates: AFTER,
});

export type { ApprovalQueue, BulkApproved, DayInput, IntegrationAttempt, QueueRow, TimesheetConfig, TimesheetDay, TimesheetSetup, TimesheetWeek, UpdateTimesheetConfig, WeekSubmit };
