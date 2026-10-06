/* Module 2b Clocking: the clock card's read and writes. Writes go through
   useRecordMutation, so nothing changes on screen until the server has
   answered (no optimistic updates); each one also re-reads the timesheet
   weeks, since clock out and a close write the day. The timer ticks locally
   from MyClock.serverNow plus current.elapsedSeconds, never from the browser's clock. */
import { useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import { timesheetKeys } from './timesheets';
import { clockIn, clockOut, closeClock, endBreak, getMyClock, startBreak, type ClockMoved, type ClockRecord, type MyClock } from '@/contract/clock';

export const clockKeys = { me: ['clock', 'me'] as const };
export const useMyClock = (enabled = true) => useQuery({ queryKey: clockKeys.me, queryFn: () => api(getMyClock), enabled });

const AFTER = [clockKeys.me, timesheetKeys.all] as const;
/* `version` is MyClock.version as last read: the current record's, 0 for none. One pending key for the card. */
interface Move { version: number }
export const useClockIn = () => useRecordMutation({
  mutationFn: (v: Move) => api(clockIn, { ifMatch: v.version }), recordKey: () => 'clock', invalidates: AFTER,
});
export const useStartBreak = () => useRecordMutation({
  mutationFn: (v: Move) => api(startBreak, { ifMatch: v.version }), recordKey: () => 'clock', invalidates: AFTER,
});
export const useEndBreak = () => useRecordMutation({
  mutationFn: (v: Move) => api(endBreak, { ifMatch: v.version }), recordKey: () => 'clock', invalidates: AFTER,
});
export const useClockOut = () => useRecordMutation({
  mutationFn: (v: Move) => api(clockOut, { ifMatch: v.version }), recordKey: () => 'clock', invalidates: AFTER,
});
/* A forgotten clock (MyClock.open): its date and version, and the time the person finished. */
export const useCloseClock = () => useRecordMutation({
  mutationFn: (v: { date: string; version: number; finish: string }) =>
    api(closeClock, { params: { date: v.date }, body: { finish: v.finish }, ifMatch: v.version }),
  recordKey: v => `clock/${v.date}`, invalidates: AFTER,
});

export type { ClockMoved, ClockRecord, MyClock };
