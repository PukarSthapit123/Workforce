/* Module 3 Rota: the reads and writes the trota, tshifts, tpat, tcover, shifts and
   mrota screens use. Writes go through useRecordMutation, so nothing changes on
   screen until the server has answered and the queries below have been read again.
   Every week write sends the week's version as last read (RotaWeekView.version,
   0 for a week not stored yet). */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import { timesheetKeys } from './timesheets';
import {
  acceptRotaPlan, addPatternPeople, askAllCover, assignCover, claimCover, clearRotaWeek, confirmFilled, copyRotaWeek, createPattern,
  createShiftType, deletePattern, deleteShiftType, escalateCover, fillCover, generatePattern, getMyShifts, getRotaConfig, getRotaWeek,
  listCover, listPatterns, listShiftTypes, openCover, planRotaWeek, repeatRotaWeek, setCoverReason, suggestRotaCell, transitionRotaWeek,
  updatePattern, updateRotaConfig, updateShiftType, writeRotaCell,
  type AcceptPlan, type AddPatternPeople, type CellInput, type CellSaved, type CellSuggestions, type CoverBoard, type CoverFilled,
  type CoverSaved, type CoverView, type CreatePattern, type CreateShiftType, type FilledConfirmed, type FilledView, type GeneratePattern,
  type MyShifts, type OpenCover, type OpenShift, type PatternGenerated, type PatternList, type PatternRecord, type PlanAccepted,
  type PlanItem, type RotaConfigRecord, type RotaRow, type RotaSetup, type RotaWeekView, type ShiftCatalogue, type ShiftTypeRecord,
  type UpdatePattern, type UpdateRotaConfig, type UpdateShiftType, type WeekCleared, type WeekCopied, type WeekMoved, type WeekPlan,
  type WeekRepeated,
} from '@/contract/rota';

export type CoverStatus = 'all' | 'urgent' | 'filled';
export const rotaKeys = {
  all: ['rota'] as const,
  weeks: ['rota', 'week'] as const,
  week: (location: string, weekStart: string) => ['rota', 'week', location, weekStart] as const,
  plan: (location: string, weekStart: string) => ['rota', 'week', location, weekStart, 'plan'] as const,
  suggest: (location: string, weekStart: string, day: number, code: string) => ['rota', 'week', location, weekStart, 'suggest', day, code] as const,
  shifts: ['rota', 'shift-types'] as const,
  patterns: ['rota', 'patterns'] as const,
  cover: ['rota', 'cover'] as const,
  coverList: (status: CoverStatus) => ['rota', 'cover', status] as const,
  mine: ['rota', 'my-shifts'] as const,
  myWeek: (weekStart: string) => ['rota', 'my-shifts', weekStart] as const,
  config: ['rota', 'config'] as const,
};

/* ---------------------------------------------------------------- reads */
export const useRotaWeek = (location: string, weekStart: string, enabled = true) => useQuery({
  queryKey: rotaKeys.week(location, weekStart), queryFn: () => api(getRotaWeek, { params: { location, weekStart } }), enabled: enabled && !!location,
});
/* Suggestions for the days below the minimum. Nothing is written until accepted. */
export const useRotaPlan = (location: string, weekStart: string, enabled = true) => useQuery({
  queryKey: rotaKeys.plan(location, weekStart), queryFn: () => api(planRotaWeek, { params: { location, weekStart } }), enabled: enabled && !!location,
});
export const useCellSuggestions = (location: string, weekStart: string, day: number, code: string, enabled = true) => useQuery({
  queryKey: rotaKeys.suggest(location, weekStart, day, code),
  queryFn: () => api(suggestRotaCell, { params: { location, weekStart }, query: { day, code } }), enabled: enabled && !!location && !!code,
});
export const useShiftCatalogue = (enabled = true) => useQuery({ queryKey: rotaKeys.shifts, queryFn: () => api(listShiftTypes), enabled });
export const usePatterns = (enabled = true) => useQuery({ queryKey: rotaKeys.patterns, queryFn: () => api(listPatterns), enabled });
export const useCoverBoard = (status: CoverStatus = 'all', enabled = true) => useQuery({
  queryKey: rotaKeys.coverList(status), queryFn: () => api(listCover, { query: { status } }), enabled,
});
/* The signed-in person's week; weekStart defaults to the server's current week. */
export const useMyShifts = (weekStart?: string, enabled = true) => useQuery({
  queryKey: rotaKeys.myWeek(weekStart ?? ''), queryFn: () => api(getMyShifts, { query: { weekStart } }), enabled,
});
export const useRotaConfig = (enabled = true) => useQuery({ queryKey: rotaKeys.config, queryFn: () => api(getRotaConfig), enabled });

/* --------------------------------------------------------------- writes */
/* A rota write can change any week (repeat and generate reach forward), cover,
   my shifts, and the timesheet's rota line. */
const AFTER = [rotaKeys.all, timesheetKeys.all] as const;
export interface WeekRef { location: string; weekStart: string; version: number }
const weekParams = (w: WeekRef) => ({ location: w.location, weekStart: w.weekStart });
const weekKey = (w: WeekRef) => `rota/${w.location}/${w.weekStart}`;

/* Assign, change or remove one cell (code '' removes). One pending key per week:
   the version moves on every write, so a second write waits for the first. */
export const useWriteCell = () => useRecordMutation({
  mutationFn: (v: WeekRef & { body: CellInput }) => api(writeRotaCell, { params: weekParams(v), body: v.body, ifMatch: v.version }),
  recordKey: weekKey, invalidates: AFTER,
});
export const useMoveWeek = () => useRecordMutation({
  mutationFn: (v: WeekRef & { to: 'review' | 'draft' | 'published' }) => api(transitionRotaWeek, { params: weekParams(v), body: { to: v.to }, ifMatch: v.version }),
  recordKey: weekKey, invalidates: AFTER,
});
export const useCopyWeek = () => useRecordMutation({
  mutationFn: (v: WeekRef) => api(copyRotaWeek, { params: weekParams(v), ifMatch: v.version }),
  recordKey: weekKey, invalidates: AFTER,
});
export const useRepeatWeek = () => useRecordMutation({
  mutationFn: (v: WeekRef & { weeks: number }) => api(repeatRotaWeek, { params: weekParams(v), body: { weeks: v.weeks }, ifMatch: v.version }),
  recordKey: weekKey, invalidates: AFTER,
});
export const useClearWeek = () => useRecordMutation({
  mutationFn: (v: WeekRef) => api(clearRotaWeek, { params: weekParams(v), ifMatch: v.version }),
  recordKey: weekKey, invalidates: AFTER,
});
export const useAcceptPlan = () => useRecordMutation({
  mutationFn: (v: WeekRef & { body: AcceptPlan }) => api(acceptRotaPlan, { params: weekParams(v), body: v.body, ifMatch: v.version }),
  recordKey: weekKey, invalidates: AFTER,
});

/* Shift types: the manager catalogue (tshifts) and Rota setup (mrota). */
export const useCreateShiftType = () => useRecordMutation({
  mutationFn: (body: CreateShiftType) => api(createShiftType, { body }), recordKey: () => 'rota/shift-type/new', invalidates: AFTER,
});
export const useUpdateShiftType = () => useRecordMutation({
  mutationFn: (v: { shift: Pick<ShiftTypeRecord, 'code' | 'version'>; body: UpdateShiftType }) =>
    api(updateShiftType, { params: { code: v.shift.code }, body: v.body, ifMatch: v.shift.version }),
  recordKey: v => `rota/shift-type/${v.shift.code}`, invalidates: AFTER,
});
export const useDeleteShiftType = () => useRecordMutation({
  mutationFn: (s: Pick<ShiftTypeRecord, 'code' | 'version'>) => api(deleteShiftType, { params: { code: s.code }, ifMatch: s.version }),
  recordKey: s => `rota/shift-type/${s.code}`, invalidates: AFTER,
});

/* Working patterns. Every write to one pattern carries its version. */
type PatternRef = Pick<PatternRecord, 'code' | 'version'>;
export const useCreatePattern = () => useRecordMutation({
  mutationFn: (body: CreatePattern) => api(createPattern, { body }), recordKey: () => 'rota/pattern/new', invalidates: [rotaKeys.patterns],
});
export const useUpdatePattern = () => useRecordMutation({
  mutationFn: (v: { pattern: PatternRef; body: UpdatePattern }) => api(updatePattern, { params: { code: v.pattern.code }, body: v.body, ifMatch: v.pattern.version }),
  recordKey: v => `rota/pattern/${v.pattern.code}`, invalidates: [rotaKeys.patterns],
});
export const useDeletePattern = () => useRecordMutation({
  mutationFn: (p: PatternRef) => api(deletePattern, { params: { code: p.code }, ifMatch: p.version }),
  recordKey: p => `rota/pattern/${p.code}`, invalidates: [rotaKeys.patterns],
});
export const useAddPatternPeople = () => useRecordMutation({
  mutationFn: (v: { pattern: PatternRef; body: AddPatternPeople }) => api(addPatternPeople, { params: { code: v.pattern.code }, body: v.body, ifMatch: v.pattern.version }),
  recordKey: v => `rota/pattern/${v.pattern.code}`, invalidates: [rotaKeys.patterns],
});
export const useGeneratePattern = () => useRecordMutation({
  mutationFn: (v: { pattern: PatternRef; body: GeneratePattern }) => api(generatePattern, { params: { code: v.pattern.code }, body: v.body, ifMatch: v.pattern.version }),
  recordKey: v => `rota/pattern/${v.pattern.code}`, invalidates: AFTER,
});

/* Cover. Assign, fill and claim write the rota week too, so they re-read everything rota. */
type CoverRef = Pick<CoverView, 'id' | 'version'>;
export const useOpenCover = () => useRecordMutation({
  mutationFn: (body: OpenCover) => api(openCover, { body }), recordKey: b => `rota/cover/new/${b.location}/${b.date}/${b.shift}`, invalidates: [rotaKeys.cover],
});
export const useCoverReason = () => useRecordMutation({
  mutationFn: (v: { cover: CoverRef; reason: string }) => api(setCoverReason, { params: { id: v.cover.id }, body: { reason: v.reason }, ifMatch: v.cover.version }),
  recordKey: v => `rota/cover/${v.cover.id}`, invalidates: [rotaKeys.cover],
});
export const useAskAllCover = () => useRecordMutation({
  mutationFn: (c: CoverRef) => api(askAllCover, { params: { id: c.id }, ifMatch: c.version }), recordKey: c => `rota/cover/${c.id}`, invalidates: [rotaKeys.cover],
});
export const useEscalateCover = () => useRecordMutation({
  mutationFn: (c: CoverRef) => api(escalateCover, { params: { id: c.id }, ifMatch: c.version }), recordKey: c => `rota/cover/${c.id}`, invalidates: [rotaKeys.cover],
});
export const useAssignCover = () => useRecordMutation({
  mutationFn: (v: { cover: CoverRef; personCode: string }) => api(assignCover, { params: { id: v.cover.id }, body: { personCode: v.personCode }, ifMatch: v.cover.version }),
  recordKey: v => `rota/cover/${v.cover.id}`, invalidates: AFTER,
});
export const useFillCover = () => useRecordMutation({
  mutationFn: (c: CoverRef) => api(fillCover, { params: { id: c.id }, ifMatch: c.version }), recordKey: c => `rota/cover/${c.id}`, invalidates: AFTER,
});
/* The employee's claim, from My shifts (OpenShift carries id and version). */
export const useClaimShift = () => useRecordMutation({
  mutationFn: (c: Pick<OpenShift, 'id' | 'version'>) => api(claimCover, { params: { id: c.id }, ifMatch: c.version }), recordKey: c => `rota/cover/${c.id}`, invalidates: AFTER,
});
export const useConfirmFilled = () => useRecordMutation({
  mutationFn: (f: Pick<FilledView, 'id' | 'version'>) => api(confirmFilled, { params: { id: f.id }, ifMatch: f.version }), recordKey: f => `rota/filled/${f.id}`, invalidates: [rotaKeys.cover],
});

/* Rota setup (mrota): applies on Save, versioned, one audit row. */
export const useSaveRotaConfig = () => useRecordMutation({
  mutationFn: (v: { config: Pick<RotaConfigRecord, 'version'>; body: UpdateRotaConfig }) => api(updateRotaConfig, { body: v.body, ifMatch: v.config.version }),
  recordKey: () => 'rota/config', invalidates: AFTER,
});

export type {
  AcceptPlan, CellInput, CellSaved, CellSuggestions, CoverBoard, CoverFilled, CoverSaved, CoverView, CreatePattern, CreateShiftType,
  FilledConfirmed, FilledView, GeneratePattern, MyShifts, OpenCover, OpenShift, PatternGenerated, PatternList, PatternRecord, PlanAccepted,
  PlanItem, RotaConfigRecord, RotaRow, RotaSetup, RotaWeekView, ShiftCatalogue, ShiftTypeRecord, UpdatePattern, UpdateRotaConfig,
  UpdateShiftType, WeekCleared, WeekCopied, WeekMoved, WeekPlan, WeekRepeated,
};
