/* Module 6 group 1: the hours position reads (My hours, Team hours) and the
   Team hours export. The export goes through useRecordMutation because it
   writes an audit row; the file is built from the rows the server returns. */
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from './client';
import { useRecordMutation } from './mutation';
import { exportTeamHours, getMyHours, getTeamHours, type ExportTeamHours, type MyHours, type TeamHours, type TeamHoursRow } from '@/contract/hours';

export const hoursKeys = {
  all: ['hours'] as const,
  mine: ['hours', 'me'] as const,
  team: (location: string) => ['hours', 'team', location] as const,
};

export const useMyHours = () => useQuery({ queryKey: hoursKeys.mine, queryFn: () => api(getMyHours) });
/* '' reads the reader's own location; the previous location stays on screen while another loads */
export const useTeamHours = (location: string) => useQuery({
  queryKey: hoursKeys.team(location), queryFn: () => api(getTeamHours, { query: location ? { location } : {} }), placeholderData: keepPreviousData,
});
export const useExportTeamHours = () => useRecordMutation({
  mutationFn: (body: ExportTeamHours) => api(exportTeamHours, { body }), recordKey: b => `hours/export/${b.location}`, invalidates: [],
});

export type { MyHours, TeamHours, TeamHoursRow };
