/* Module 4 Leave: the reads and writes the leave, tleave, tsick and mleave
   screens use. Writes go through useRecordMutation, so nothing changes on screen
   until the server has answered and the queries below have been read again.
   Approving leave, recording sickness and giving days back can write the rota
   (D7) and change the timesheet's absence (D8), so they re-read both. */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import { rotaKeys } from './rota';
import { timesheetKeys } from './timesheets';
import { notificationKeys } from './notifications';
import {
  approveLeave, arrangeRtw, cancelLeave, declineLeave, getEntitlement, getLeaveConfig, getMyLeave, getSicknessBoard, getTeamBalances, giveDaysBack,
  listLeavers, listTeamLeave, recordSickness, requestLeave, updateLeaveConfig,
  type BalanceView, type DaysGivenBack, type EntitlementDetail, type EntitlementView, type GiveDaysBack, type LeaveConfigRecord, type LeaveDecided,
  type LeaveMoved, type LeaveRequested, type LeaveRequestView, type LeaveSetup, type LeaveStage, type LeaveTypeOption, type LeaveTypeRecord,
  type LeaverRow, type Leavers, type LedgerView, type MyLeave, type RecordSickness, type RequestLeave, type RtwArranged, type SickEpisodeRecord,
  type SicknessBoard, type SicknessRecorded, type SicknessRow, type TeamBalanceRow, type TeamBalances, type TeamRequests, type TeamRequestView,
  type UpdateLeaveConfig,
} from '@/contract/leave';

export interface TeamLeaveFilters { q?: string; type?: string; short?: boolean }
export const leaveKeys = {
  all: ['leave'] as const,
  mine: ['leave', 'me'] as const,
  team: ['leave', 'team'] as const,
  teamRequests: (f: TeamLeaveFilters) => ['leave', 'team', 'requests', f.q ?? '', f.type ?? '', f.short ? 'short' : ''] as const,
  balances: ['leave', 'team', 'balances'] as const,
  leavers: ['leave', 'team', 'leavers'] as const,
  entitlement: (personCode: string) => ['leave', 'entitlement', personCode] as const,
  sickness: ['leave', 'sickness'] as const,
  config: ['leave', 'config'] as const,
};

/* ---------------------------------------------------------------- reads */
export const useMyLeave = (enabled = true) => useQuery({ queryKey: leaveKeys.mine, queryFn: () => api(getMyLeave), enabled });
export const useTeamLeave = (f: TeamLeaveFilters = {}, enabled = true) => useQuery({
  queryKey: leaveKeys.teamRequests(f),
  queryFn: () => api(listTeamLeave, { query: { q: f.q || undefined, type: f.type || undefined, short: f.short ? 'true' : undefined } }), enabled,
});
export const useTeamBalances = (enabled = true) => useQuery({ queryKey: leaveKeys.balances, queryFn: () => api(getTeamBalances), enabled });
/* "How this was worked out": your own, or a colleague's at your location. */
export const useEntitlement = (personCode: string, enabled = true) => useQuery({
  queryKey: leaveKeys.entitlement(personCode), queryFn: () => api(getEntitlement, { params: { personCode } }), enabled: enabled && !!personCode,
});
/* Only while LV_LEAVER is on: the server refuses it otherwise (feature-off). */
export const useLeavers = (enabled = true) => useQuery({ queryKey: leaveKeys.leavers, queryFn: () => api(listLeavers), enabled });
export const useSicknessBoard = (enabled = true) => useQuery({ queryKey: leaveKeys.sickness, queryFn: () => api(getSicknessBoard), enabled });
export const useLeaveConfig = (enabled = true) => useQuery({ queryKey: leaveKeys.config, queryFn: () => api(getLeaveConfig), enabled });

/* --------------------------------------------------------------- writes */
/* A write that can reach the rota and the timesheet's absence. */
const REACHES = [leaveKeys.all, rotaKeys.all, timesheetKeys.all, notificationKeys.all] as const;
/* a request, decision or cancellation tells someone (lv_* events) */
const TELLS = [leaveKeys.all, notificationKeys.all] as const;
type RequestRef = Pick<LeaveRequestView, 'id' | 'version'>;

export const useRequestLeave = () => useRecordMutation({
  mutationFn: (body: RequestLeave) => api(requestLeave, { body }), recordKey: () => 'leave/request/new', invalidates: TELLS,
});
export const useCancelLeave = () => useRecordMutation({
  mutationFn: (r: RequestRef) => api(cancelLeave, { params: { id: r.id }, ifMatch: r.version }),
  recordKey: r => `leave/request/${r.id}`, invalidates: TELLS,
});
export const useApproveLeave = () => useRecordMutation({
  mutationFn: (r: RequestRef) => api(approveLeave, { params: { id: r.id }, ifMatch: r.version }),
  recordKey: r => `leave/request/${r.id}`, invalidates: REACHES,
});
export const useDeclineLeave = () => useRecordMutation({
  mutationFn: (v: { request: RequestRef; reason: string }) => api(declineLeave, { params: { id: v.request.id }, body: { reason: v.reason }, ifMatch: v.request.version }),
  recordKey: v => `leave/request/${v.request.id}`, invalidates: TELLS,
});
export const useRecordSickness = () => useRecordMutation({
  mutationFn: (body: RecordSickness) => api(recordSickness, { body }), recordKey: b => `leave/sickness/new/${b.personCode}`, invalidates: REACHES,
});
export const useArrangeRtw = () => useRecordMutation({
  mutationFn: (e: Pick<SickEpisodeRecord, 'id' | 'version'>) => api(arrangeRtw, { params: { id: e.id }, ifMatch: e.version }),
  recordKey: e => `leave/sickness/${e.id}`, invalidates: TELLS,
});
export const useGiveDaysBack = () => useRecordMutation({
  mutationFn: (body: GiveDaysBack) => api(giveDaysBack, { body }), recordKey: b => `leave/give-back/${b.personCode}`, invalidates: REACHES,
});
/* Leave setup (mleave): applies on Save, versioned, one audit row. blocksTimesheet changes the timesheet. */
export const useSaveLeaveConfig = () => useRecordMutation({
  mutationFn: (v: { config: Pick<LeaveConfigRecord, 'version'>; body: UpdateLeaveConfig }) => api(updateLeaveConfig, { body: v.body, ifMatch: v.config.version }),
  recordKey: () => 'leave/config', invalidates: [leaveKeys.all, timesheetKeys.all],
});

export type {
  BalanceView, DaysGivenBack, EntitlementDetail, EntitlementView, GiveDaysBack, LeaveConfigRecord, LeaveDecided, LeaveMoved, LeaveRequested,
  LeaveRequestView, LeaveSetup, LeaveStage, LeaveTypeOption, LeaveTypeRecord, LeaverRow, Leavers, LedgerView, MyLeave, RecordSickness, RequestLeave,
  RtwArranged, SickEpisodeRecord, SicknessBoard, SicknessRecorded, SicknessRow, TeamBalanceRow, TeamBalances, TeamRequests, TeamRequestView,
  UpdateLeaveConfig,
};
