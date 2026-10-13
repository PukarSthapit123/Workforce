/* Hours position (module 6 group 1): contracted, rota'd and worked hours, the
   variances between them and the flags they raise, for My hours (essHours,
   qnipay-workforce-v15.html:5702-5738) and Team hours (mgrHours, v15:7719-7748),
   and the Team hours export (v15:12972-12995). The figures are the prototype's
   shared engine, hoursPosition (v15:4027-4046), which Rota already ports
   (./rota); this adds what the two screens and the file read from it. Every
   function is pure: the server and the screens give the same answer.

   Hours only. Nothing here holds a rate, an amount or a currency (brief P1). */
import { hoursCap, hoursPosition, LEAVE, SICK, type HoursFlag, type Line, type RotaWorker, type RuleContext } from './rota';

export type { HoursFlag };
export interface HoursPosition { con: number; rot: number; wk: number; rotaVar: number; workVar: number; schedVar: number; flags: HoursFlag[]; cap: number }

const r1 = (v: number) => Number(v.toFixed(1));
const r2 = (v: number) => Number(v.toFixed(2));

/* A bank (or zero-hours) colleague has no contracted baseline: the screens show
   "Bank" in its place and leave out the variances against it. */
export const isBank = (contractedHours: number) => !(contractedHours > 0);

/* The person's position for the week. `line` is their published rota line,
   Monday first; null while the Rota module is off, when there is no rota'd
   baseline, so nothing is measured against one and no rota flag is raised.
   `worked` is the hours on their timesheet days. */
export function positionOf(w: RotaWorker, line: Line | null, worked: number, ctx: Omit<RuleContext, 'safeWorker'>): HoursPosition {
  if (line) return hoursPosition(w, line, r2(worked), ctx);
  const wk = r2(worked);
  return { con: w.contractedHours, rot: 0, wk, rotaVar: 0, workVar: r1(wk - w.contractedHours), schedVar: 0, flags: [],
    cap: hoursCap(w, ctx.typeRota, ctx.config) };
}

/* "Things to check" and "Discrepancies to check": a flag that is only a note
   (nights, c "neu") is shown but not counted; an error turns the tile red. */
export const checkCount = (flags: readonly HoursFlag[]) => flags.filter(f => f.c !== 'neu').length;
export const hasError = (flags: readonly HoursFlag[]) => flags.some(f => f.c === 'err');
/* A flag a reader must look at carries the warning glyph; a note does not (v15:5718, 7745). */
export const flagWarns = (f: HoursFlag) => f.c === 'err' || f.c === 'warn';

/* Hours as the prototype prints them: 7.5h, and a variance with its sign.
   A stat tile's foot reads "+0h against contract" (>= 0); a table cell reads
   "0h" with no sign (> 0), as each does in the prototype. */
export const hoursText = (v: number) => `${v}h`;
export const footHours = (v: number) => `${v >= 0 ? '+' : ''}${r1(v)}h`;
export const cellHours = (v: number) => `${v > 0 ? '+' : ''}${v}h`;
/* .hp up (over, warning ink), .hp dn (under, information ink), .hp ok (level, success ink) */
export type VarianceTone = 'up' | 'dn' | 'ok';
export const varianceTone = (v: number): VarianceTone => (v > 0 ? 'up' : v < 0 ? 'dn' : 'ok');

/* ---------------------------------------------------------------- one day */
export const minutesToHours = (minutes: number) => r2(minutes / 60);
/* Worked against scheduled on one day; null when neither has any hours ("—"). */
export function dayVariance(scheduled: number, worked: number): number | null {
  return scheduled || worked ? r1(worked - scheduled) : null;
}
/* The day's status (v15:5726-5727): leave and sickness first, then the
   timesheet day's own state, then nothing recorded against a shift, then a
   rest day. A shift still to come is not yet missing, so it says so rather
   than warning. */
export type DayStatus =
  | { kind: 'leave' } | { kind: 'sickness' } | { kind: 'recorded'; state: string }
  | { kind: 'missing' } | { kind: 'upcoming' } | { kind: 'rest' };
export function dayStatus(d: { cell: string; absence: '' | 'V' | 'S'; state: string | null; scheduled: number; future: boolean }): DayStatus {
  if (d.cell === LEAVE || d.absence === LEAVE) return { kind: 'leave' };
  if (d.cell === SICK || d.absence === SICK) return { kind: 'sickness' };
  if (d.state) return { kind: 'recorded', state: d.state };
  if (d.scheduled) return d.future ? { kind: 'upcoming' } : { kind: 'missing' };
  return { kind: 'rest' };
}
/* The Rota line cell: the shift's name and times, or the absence, or nothing. */
export function rotaLineText(r: { code: string; name: string; time: string } | undefined): string {
  if (!r) return '';
  if (r.code === LEAVE) return 'Annual leave';
  if (r.code === SICK) return 'Sickness';
  return r.code ? `${r.name} · ${r.time}` : '';
}

/* ------------------------------------------------------------------ team */
export interface TeamMember { contractedHours: number; position: HoursPosition }
/* The four tiles over the rows on screen (v15:7720-7735): sums, and how many
   colleagues have something to check. Summed at two places, so floating point
   never shows as 112.50000001. */
export function teamTotals(rows: readonly TeamMember[]) {
  const sum = (f: (r: TeamMember) => number) => r2(rows.reduce((a, r) => a + f(r), 0));
  const con = sum(r => r.contractedHours), rot = sum(r => r.position.rot), wk = sum(r => r.position.wk);
  return {
    con, rot, wk, rotaVar: r1(rot - con), workVar: r1(wk - rot),
    contracted: rows.filter(r => !isBank(r.contractedHours)).length,
    discrepancies: rows.filter(r => checkCount(r.position.flags) > 0).length,
    anyError: rows.some(r => hasError(r.position.flags)),
  };
}

/* --------------------------------------------------------------- export */
export const HOURS_CSV_HEADER = ['Employee ID', 'Name', 'Location', 'Job profile', 'Contracted', 'Rota’d', 'Worked',
  'Rota variance', 'Worked variance', 'Flags'] as const;
export interface ExportMember extends TeamMember { code: string; name: string; locationName: string; jobProfileName: string }
/* One line of the file. A bank colleague's contracted cell says Bank and the
   variances against a contract are left blank, as the screen shows them; with
   the Rota module off the rota'd cells are blank too. Hours only (P1). */
export function hoursCsvRow(r: ExportMember, rota: boolean): (string | number)[] {
  const bank = isBank(r.contractedHours), p = r.position;
  return [r.code, r.name, r.locationName, r.jobProfileName, bank ? 'Bank' : r.contractedHours, rota ? p.rot : '', p.wk,
    bank || !rota ? '' : p.rotaVar, bank ? '' : p.workVar, p.flags.map(f => f.k).join('; ')];
}
export const hoursCsv = (rows: readonly ExportMember[], rota: boolean): (string | number)[][] =>
  [[...HOURS_CSV_HEADER], ...rows.map(r => hoursCsvRow(r, rota))];
/* qnipay-hours-position-WH-10-08-2026.csv: the location and the week's first day, day first. */
export function hoursFileName(location: string, weekStart: string): string {
  const [y = '', m = '', d = ''] = weekStart.split('-');
  return `qnipay-hours-position-${location}-${d}-${m}-${y}.csv`;
}
export const exportedText = (rows: number, file: string) => `Exported · ${rows} row${rows === 1 ? '' : 's'} · ${file}`;
export const DOWNLOAD_BLOCKED = { message: 'Download blocked by the browser. No file was produced.', next: 'Allow downloads for this site, then export again.' };
