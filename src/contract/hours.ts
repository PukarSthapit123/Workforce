/* Module 6 group 1: the hours position. My hours (own_hours) is the reader's
   own week, and only theirs: there is no person in its path. Team hours
   (team_hours) is one location's week, in the reader's location scope (their
   own location, or any with master data). The figures are derived on every
   read from the timesheet days, the published rota and the person record;
   nothing is stored. The export is a write only because it is audited: one
   audit row, and the rows of the file, whose count the screen reports.
   Hours only: no rate, amount, cost or currency anywhere (brief P1). */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { IsoDate } from './people';
import { HoursPosition, LocationOption } from './rota';
import { TsState } from './timesheets';

/* What the day's Status column shows (domain/hours dayStatus); `state` is the
   timesheet day's, with `waitingOn` naming the layer an mgrok day waits on. */
export const HoursDayStatus = z.object({
  kind: z.enum(['leave', 'sickness', 'recorded', 'missing', 'upcoming', 'rest']), state: TsState.optional(), waitingOn: z.string().optional(),
});
export const HoursDay = z.object({
  date: IsoDate,
  /* the published rota cell: a shift code, V, S or '' */
  code: z.string(), line: z.string(), scheduled: z.number().nonnegative(), worked: z.number().nonnegative(),
  /* worked less scheduled; null when the day has no hours either way */
  variance: z.number().nullable(), status: HoursDayStatus,
});
export type HoursDay = z.infer<typeof HoursDay>;
/* rota: the Rota module is on, so a rota'd figure exists; while it is off the screens show none. */
export const MyHours = z.object({
  person: z.object({ code: z.string(), name: z.string(), contractedHours: z.number().nonnegative() }),
  weekStart: IsoDate, label: z.string(), rota: z.boolean(), position: HoursPosition, days: z.array(HoursDay).length(7),
});
export type MyHours = z.infer<typeof MyHours>;

export const TeamHoursRow = z.object({
  personCode: z.string(), name: z.string(), category: z.string(), jobProfileName: z.string(),
  contractedHours: z.number().nonnegative(), position: HoursPosition,
});
export type TeamHoursRow = z.infer<typeof TeamHoursRow>;
/* locations: the ones this reader may look at, for the location picker */
export const TeamHours = z.object({
  location: LocationOption, locations: z.array(LocationOption), weekStart: IsoDate, label: z.string(), rota: z.boolean(), rows: z.array(TeamHoursRow),
});
export type TeamHours = z.infer<typeof TeamHours>;
export const TeamHoursQuery = z.object({ location: z.string().min(1).max(20).optional() });

export const ExportTeamHours = z.strictObject({ location: z.string().min(1, 'Choose a location.').max(20) });
export type ExportTeamHours = z.infer<typeof ExportTeamHours>;
/* rows: the file, its header first; count: the colleagues in it */
export const TeamHoursExported = z.object({
  fileName: z.string(), rows: z.array(z.array(z.union([z.string(), z.number()]))), count: z.number().int().nonnegative(), auditId: z.string(),
});
export type TeamHoursExported = z.infer<typeof TeamHoursExported>;

export const getMyHours = defineEndpoint({ method: 'GET', path: '/api/v1/hours/me', response: MyHours, capability: 'own_hours',
  summary: 'The reader\'s own hours position for this week: contracted, rota\'d and worked, the variances and the flags, and each day against the rota' });
export const getTeamHours = defineEndpoint({ method: 'GET', path: '/api/v1/hours/team', query: TeamHoursQuery, response: TeamHours,
  capability: 'team_hours', errors: [404],
  summary: 'One location\'s hours position for this week, a row per colleague on its roster. Query: location (default: the reader\'s own). A location outside the reader\'s scope is refused with scope.' });
export const exportTeamHours = defineEndpoint({ method: 'POST', path: '/api/v1/hours/team/export', request: ExportTeamHours, response: TeamHoursExported,
  capability: 'team_hours', errors: [404],
  summary: 'The rows of the hours position file for one location\'s week, hours only. One audit row naming the file and its row count. A location outside the reader\'s scope is refused with scope.' });
