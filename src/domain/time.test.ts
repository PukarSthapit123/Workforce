import { addMonths, clockAt, daysBetween, dayIndex, dmyToIso, fmtMin, formatDmy, formatTime, isIsoDate, isTimeZone, periodStart, setActiveLocale,
  supportedTimeZones, weekDates, weekHeads } from './time';

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
  test('the tenant clock crosses London midnight at 00:30 BST, not UTC midnight', () => {
    expect(clockAt('2026-07-10T23:30:00.000Z', 'Europe/London')).toEqual({ date: '2026-07-11', time: '00:30' });
  });
  test('worldwide IANA zones retain their IDs, convert local time and apply DST automatically', () => {
    expect(supportedTimeZones()).toEqual(expect.arrayContaining(['Asia/Kathmandu', 'Asia/Tokyo', 'Pacific/Auckland', 'UTC']));
    expect([isTimeZone('Asia/Kathmandu'), isTimeZone('Pacific/Auckland'), isTimeZone('+05:45')]).toEqual([true, true, false]);
    expect(clockAt('2026-07-10T23:30:00.000Z', 'Asia/Kathmandu')).toEqual({ date: '2026-07-11', time: '05:15' });
    expect([
      clockAt('2026-03-08T06:30:00.000Z', 'America/New_York'),
      clockAt('2026-03-08T07:30:00.000Z', 'America/New_York'),
    ]).toEqual([{ date: '2026-03-08', time: '01:30' }, { date: '2026-03-08', time: '03:30' }]);
  });
  test('date, clock and week formatting follow the active tenant settings', () => {
    setActiveLocale({ timezone: 'Europe/London', dateFormat: 'mm/dd/yyyy', clock: '12h', weekStart: 'Sunday' });
    expect([formatDmy('2026-08-13'), formatTime('15:05'), periodStart('2026-08-13'), dayIndex('2026-08-13'), weekHeads()[0]])
      .toEqual(['08/13/2026', '3:05 pm', '2026-08-09', 4, 'Sun']);
    setActiveLocale({ timezone: 'Europe/London', dateFormat: 'dd/mm/yyyy', clock: '24h', weekStart: 'Monday' });
  });
});
