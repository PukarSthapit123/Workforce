/* 1c group 7: My home, the month calendar, and My documents (brief D7, D12,
   D13). One read gives a person's month as the server paints it: each day's
   shift from the published rota, leave and sickness from the leave records,
   what the timesheet holds, and the tenant's bank holidays, with the month's
   totals and live key and the figures around the calendar. The person is the
   one signed in, or the one being viewed as. Documents are per person and are
   listed only: opening one is not built. Payroll documents are payroll's and
   read "Not yet connected". */
import { z } from 'zod';
import { defineEndpoint } from './endpoints';
import { RecordMeta } from './common';
import { IsoDate } from './people';
import { TsState } from './timesheets';

/* the same as src/domain/home.ts (the contract test holds them together) */
export const GlyphKey = z.enum(['ok', 'pend', 'resub', 'back', 'draft', 'none']);
export type GlyphKey = z.infer<typeof GlyphKey>;
export const GlyphTone = z.enum(['ok', 'pend', 'att', 'draft']);
const ShiftTone = z.enum(['E', 'L', 'N']);
const Month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Give the month as YYYY-MM.');

export const HomeDay = z.object({
  date: IsoDate,
  /* the published rota's shift; null on a rest day, an absence, an unpublished week or while Rota is off */
  shift: z.object({ code: z.string(), name: z.string(), time: z.string(), hours: z.number().nonnegative(), tone: ShiftTone }).nullable(),
  /* approved leave (V) or sickness (S), with its type as the leave settings name it */
  absence: z.object({
    mark: z.enum(['V', 'S']), type: z.string(), name: z.string(), short: z.string(), icon: z.string(),
    /* the leave record behind it, when there is one */
    from: IsoDate.nullable(), to: IsoDate.nullable(), state: z.string(),
  }).nullable(),
  /* the day's timesheet record, its state and the time on it ("7h 30m") */
  ts: z.object({ state: TsState, minutes: z.number().int().nonnegative(), text: z.string() }).nullable(),
  glyph: GlyphKey.nullable(),
  /* the bank holiday's name, or '' */
  bankHoliday: z.string(),
  today: z.boolean(), future: z.boolean(),
  /* approved, or in a pay period that has closed */
  locked: z.boolean(),
  source: z.enum(['rota', 'leave', 'none']),
});
export type HomeDay = z.infer<typeof HomeDay>;
export const MonthKey = z.object({
  tones: z.array(z.object({ tone: ShiftTone, label: z.string(), count: z.number().int() })),
  leave: z.array(z.object({ name: z.string(), icon: z.string(), count: z.number().int() })),
  states: z.array(z.object({ key: GlyphKey, glyph: z.string(), tone: GlyphTone, label: z.string(), count: z.number().int() })),
});
export const HomeMonth = z.object({
  month: Month, label: z.string(), thisMonth: Month, bounds: z.object({ min: Month, max: Month }), today: IsoDate,
  person: z.object({ code: z.string(), name: z.string(), location: z.string() }),
  /* "Good afternoon, Amara" and "Support Worker · Shift worker · Willow House" */
  greeting: z.string(), who: z.string(),
  leadingBlanks: z.number().int().min(0).max(6),
  days: z.array(HomeDay),
  totals: z.object({ shifts: z.number().int(), minutes: z.number().int(), leaveDays: z.number().int() }),
  /* "8 shifts · 36.5h recorded · 2 days leave", or '' */
  summary: z.string(),
  key: MonthKey,
  /* today, whichever month is shown */
  todayDay: HomeDay,
  /* the next shift this week from today on, or null */
  nextShift: z.object({ date: IsoDate, name: z.string(), time: z.string() }).nullable(),
  /* this week: time recorded, the contracted hours (0 for bank) and the hours on the published rota */
  week: z.object({ minutes: z.number().int(), text: z.string(), contracted: z.number().nonnegative(), rotaHours: z.number().nonnegative() }),
  /* earlier days this week with a shift and nothing recorded */
  missing: z.array(IsoDate),
  /* the latest timesheet day sent back */
  sentBack: z.object({ date: IsoDate, reason: z.string() }).nullable(),
  /* what the day dialog may offer: hours (Timesheet on and own_ts), time off (Leave on and own_leave) */
  can: z.object({ recordHours: z.boolean(), bookLeave: z.boolean() }),
});
export type HomeMonth = z.infer<typeof HomeMonth>;

export const DocumentRow = RecordMeta.extend({
  personCode: z.string(), name: z.string(), category: z.string(), date: IsoDate, owner: z.string(), source: z.string(),
});
export type DocumentRow = z.infer<typeof DocumentRow>;
export const PayrollDocument = z.object({ id: z.string(), name: z.string(), category: z.string(), note: z.string() });
export const MyDocuments = z.object({
  person: z.object({ code: z.string(), name: z.string() }),
  items: z.array(DocumentRow), payroll: z.array(PayrollDocument),
});
export type MyDocuments = z.infer<typeof MyDocuments>;

export const getHome = defineEndpoint({ method: 'GET', path: '/api/v1/home', query: z.object({ month: Month.optional() }), response: HomeMonth,
  capability: 'own_home', errors: [422],
  summary: 'My month: each day\'s published shift, approved leave or sickness, timesheet state and bank holiday, with the totals, the live key and the figures around it. From the month before this one to the rota horizon; outside it is 422 (field month).' });
export const listMyDocuments = defineEndpoint({ method: 'GET', path: '/api/v1/documents/mine', response: MyDocuments, capability: 'own_home', errors: [403],
  summary: 'My documents and the payroll documents, which are not yet connected. Refused while Documents is switched off.' });
export const getDocument = defineEndpoint({ method: 'GET', path: '/api/v1/documents/:id', params: z.object({ id: z.string().min(1).max(40) }), response: DocumentRow,
  capability: 'own_home', errors: [403, 404], summary: 'One of my documents. Someone else\'s is not found (404).' });
