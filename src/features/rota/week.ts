/* What Team rota prints about a week, its days and its cells: the prototype's
   DOW_SHORT, weekDates, SHNAME, TIME, SHORTT, shLetter and toneOf as the grid,
   the day view and the dialogs use them (qnipay-workforce-v15.html:1884-1917,
   7176-7348). The rules themselves are the domain's. */
import { DOW_SHORT, addDays, formatDmy, parseIso } from '@/domain/time';
import { isAbsence, isWorking, shiftBy, toneOf, type ShiftType } from '@/domain/rota';
import type { RotaRow } from '@/contract/rota';

export const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'] as const;
export const DAY_INDEXES = [0, 1, 2, 3, 4, 5, 6] as const;

const dateOf = (weekStart: string, day: number) => parseIso(addDays(weekStart, day));
export const dayNum = (weekStart: string, day: number) => dateOf(weekStart, day).getUTCDate();
export const dow = (day: number) => DOW_SHORT[day] ?? '';
/* "Fri 14" */
export const shortDay = (weekStart: string, day: number) => `${dow(day)} ${dayNum(weekStart, day)}`;
/* "Fri 14 August" */
export const longDay = (weekStart: string, day: number) => `${shortDay(weekStart, day)} ${MONTH_NAMES[dateOf(weekStart, day).getUTCMonth()] ?? ''}`;
/* "10/08/2026 – 16/08/2026" */
export const weekRange = (weekStart: string) => `${formatDmy(weekStart)} – ${formatDmy(addDays(weekStart, 6))}`;

/* The palette a cell is drawn in: a shift's tone, or leave and sickness. */
export type CellTone = 'early' | 'late' | 'night' | 'leave' | 'sick';
export function cellTone(shifts: readonly ShiftType[], code: string): CellTone {
  if (code === 'V') return 'leave';
  if (code === 'S') return 'sick';
  const t = toneOf(shifts, code);
  return t === 'L' ? 'late' : t === 'N' ? 'night' : 'early';
}
/* .chip.E/.L/.N/.V/.S and .pchip.tone-* (v15:849-853, 879-881): the rota tokens, a 3px bar in the ink. */
export const TONE_CLASS: Record<CellTone, string> = {
  early: 'bg-(--qp-rota-early-surface) text-(--qp-rota-early-ink) border-l-(color:--qp-rota-early-ink)',
  late: 'bg-(--qp-rota-late-surface) text-(--qp-rota-late-ink) border-l-(color:--qp-rota-late-ink)',
  night: 'bg-(--qp-rota-night-surface) text-(--qp-rota-night-ink) border-l-(color:--qp-rota-night-ink)',
  leave: 'bg-(--qp-rota-leave-surface) text-(--qp-rota-leave-ink) border-l-(color:--qp-rota-leave-ink)',
  sick: 'bg-(--qp-rota-sick-surface) text-(--qp-rota-sick-ink) border-l-(color:--qp-rota-sick-ink)',
};
/* The legend's swatch: the tone's surface with its 3px ink bar. */
export const SWATCH_CLASS: Record<CellTone, string> = {
  early: 'bg-(--qp-rota-early-surface) border-l-3 border-l-(color:--qp-rota-early-ink)',
  late: 'bg-(--qp-rota-late-surface) border-l-3 border-l-(color:--qp-rota-late-ink)',
  night: 'bg-(--qp-rota-night-surface) border-l-3 border-l-(color:--qp-rota-night-ink)',
  leave: 'bg-(--qp-rota-leave-surface) border-l-3 border-l-(color:--qp-rota-leave-ink)',
  sick: 'bg-(--qp-rota-sick-surface) border-l-3 border-l-(color:--qp-rota-sick-ink)',
};

/* A row's hours line (v15:7301-7303): "33h · 45h max", or "12h · bank". */
export const overCap = (r: RotaRow) => r.contractedHours > 0 && r.hours.rot > r.hours.cap;
export const hoursLine = (r: RotaRow) => (r.contractedHours > 0 ? `${r.hours.rot}h · ${r.hours.cap}h max` : `${r.hours.rot}h · bank`);
/* The day whose shift starts too soon after the one before (restIssues name the earlier day). */
export const restWarnedOn = (r: RotaRow, day: number) => r.restIssues.some(x => x.i + 1 === day);

/* filteredRoster (v15:7170-7175): search, job profile, Everyone/Contracted/Bank, and hours and rest warnings. */
export interface RotaFilters { q: string; role: string; type: string; flags: boolean }
export const NO_FILTERS: RotaFilters = { q: '', role: 'all', type: 'all', flags: false };
export function filterRows(rows: readonly RotaRow[], f: RotaFilters) {
  const q = f.q.trim().toLowerCase();
  return rows.filter(r => (!q || r.name.toLowerCase().includes(q) || r.personCode.toLowerCase().includes(q))
    && (f.role === 'all' || r.jobProfile === f.role)
    && (f.type === 'all' || r.category === f.type)
    && (!f.flags || r.restIssues.length > 0 || overCap(r)));
}

/* The cell's accessible name (v15:7308, 7319): who, which day, and what is there. */
export function cellLabel(shifts: readonly ShiftType[], r: RotaRow, weekStart: string, day: number) {
  const code = r.line[day] ?? '', when = `${r.name}, ${longDay(weekStart, day)}`;
  if (!code) return `${when}, no shift`;
  if (isAbsence(code)) return `${when}, ${code === 'V' ? 'Annual leave' : 'Sickness'}`;
  const s = shiftBy(shifts, code);
  return s ? `${when}, ${s.name}, ${s.from}–${s.to}` : `${when}, ${code}`;
}
export const working = (r: RotaRow, day: number) => isWorking(r.line[day]);
