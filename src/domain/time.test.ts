import { addMonths, daysBetween, dmyToIso, fmtMin, isIsoDate, periodStart, weekDates } from './time';

describe('shared date helpers', () => {
  test('whole days between two dates, months that roll as JavaScript dates do', () => {
    expect([daysBetween('2026-08-10', '2026-08-13'), daysBetween('2026-08-13', '2026-08-10'), daysBetween('2026-03-28', '2026-03-30')]).toEqual([3, -3, 2]);
    expect([addMonths('2026-08-13', 1), addMonths('2026-08-31', 1), addMonths('2026-12-15', 2)]).toEqual(['2026-09-13', '2026-10-01', '2027-02-15']);
  });
  test('dd/mm/yyyy to ISO, and only real dates count', () => {
    expect([dmyToIso('06/07/2026'), dmyToIso('6/7/2026'), dmyToIso('31/02/2026'), dmyToIso('')]).toEqual(['2026-07-06', '2026-07-06', '', '']);
    expect([isIsoDate('2026-08-13'), isIsoDate('2026-02-30'), isIsoDate('13/08/2026')]).toEqual([true, false, false]);
  });
  test('minutes back to the 24-hour clock, and the week from its Monday', () => {
    expect([fmtMin(30), fmtMin(1470), fmtMin(1320)]).toEqual(['00:30', '00:30', '22:00']);
    expect(periodStart('2026-08-13')).toBe('2026-08-10');
    expect(weekDates('2026-08-10').at(-1)).toBe('2026-08-16');
  });
});
