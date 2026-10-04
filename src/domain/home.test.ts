import {
  GLYPH_ORDER, dayGlyph, greeting, inBounds, keyIsEmpty, leadingBlanks, monthBounds, monthDates, monthKey, monthLabel, monthSummary, monthTotals,
  outOfBoundsProblem, shiftMonth, whoLine, type KeyDay,
} from './home';

const day = (o: Partial<KeyDay>): KeyDay => ({ tone: null, leave: null, absence: '', glyph: null, minutes: 0, ...o });

describe('the month window', () => {
  test('runs from the month before today to today plus the rota horizon (P: July 2026 to August 2027 at 12 months)', () => {
    expect(monthBounds('2026-08-13', 12)).toEqual({ min: '2026-07', max: '2027-08' });
    expect(monthBounds('2026-08-13', 3)).toEqual({ min: '2026-07', max: '2026-11' });
    expect(monthBounds('2026-01-05', 6)).toEqual({ min: '2025-12', max: '2026-07' });
  });
  test('a month inside it is allowed, one outside or malformed is not, and the refusal names the range', () => {
    const b = monthBounds('2026-08-13', 12);
    expect(['2026-07', '2026-08', '2027-08'].map(m => inBounds(m, b))).toEqual([true, true, true]);
    expect(['2026-06', '2027-09', '2026-13', '2026-8', ''].map(m => inBounds(m, b))).toEqual([false, false, false, false, false]);
    expect(outOfBoundsProblem(b)).toEqual({ field: 'month', message: 'The calendar runs from July 2026 to August 2027.' });
  });
  test('months step across years, and a month knows its days and where its first falls', () => {
    expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    expect(monthLabel('2026-08')).toBe('August 2026');
    expect(monthDates('2026-08')).toHaveLength(31);
    expect(monthDates('2027-02')).toHaveLength(28);
    expect(leadingBlanks('2026-08')).toBe(5);
  });
});

describe('who is greeted, and how', () => {
  test('morning before noon, afternoon before six, evening after', () => {
    expect(['00:00', '11:59', '12:00', '17:59', '18:00', '23:30'].map(greeting))
      .toEqual(['Good morning', 'Good morning', 'Good afternoon', 'Good afternoon', 'Good evening', 'Good evening']);
  });
  test('the who-line names the job, the type only when it differs, and the location', () => {
    expect(whoLine({ job: 'Support Worker', type: 'Shift worker', location: 'Willow House' })).toBe('Support Worker · Shift worker · Willow House');
    expect(whoLine({ job: 'Shift worker', type: 'shift worker', location: 'Willow House' })).toBe('Shift worker · Willow House');
    expect(whoLine({ job: '', type: 'Salaried', location: '' })).toBe('Salaried');
  });
});

describe('a day carries one status glyph', () => {
  test('leave and sickness carry none; a recorded day carries its timesheet state; a past shift with nothing recorded is flagged', () => {
    expect(dayGlyph({ absence: 'V', ts: 'ok', shift: true, past: true })).toBeNull();
    expect(dayGlyph({ absence: 'S', ts: null, shift: true, past: true })).toBeNull();
    expect(dayGlyph({ absence: '', ts: 'pend', shift: false, past: true })).toBe('pend');
    expect(dayGlyph({ absence: '', ts: 'draft', shift: true, past: false })).toBe('draft');
    expect(dayGlyph({ absence: '', ts: null, shift: true, past: true })).toBe('none');
    expect(dayGlyph({ absence: '', ts: null, shift: true, past: false })).toBeNull();
    expect(dayGlyph({ absence: '', ts: null, shift: false, past: true })).toBeNull();
  });
  test('the glyphs keep the prototype order: approved, awaiting, resubmitted, sent back, draft, nothing recorded', () => {
    expect(GLYPH_ORDER).toEqual(['ok', 'pend', 'resub', 'back', 'draft', 'none']);
  });
});

describe('the live key', () => {
  test('counts only what the month holds, in the key order, each glyph with the calendar state colour', () => {
    const k = monthKey([
      day({ tone: 'N', glyph: 'none' }), day({ tone: 'E', glyph: 'draft', minutes: 450 }), day({ tone: 'E', glyph: 'none' }),
      day({ leave: { name: 'Annual leave', icon: '☀' }, absence: 'V' }), day({ leave: { name: 'Annual leave', icon: '☀' }, absence: 'V' }),
      day({ leave: { name: 'Sickness', icon: '✚' }, absence: 'S' }), day({ glyph: 'pend', minutes: 480 }),
    ]);
    expect(k.tones).toEqual([{ tone: 'E', label: 'Early', count: 2 }, { tone: 'N', label: 'Night', count: 1 }]);
    expect(k.leave).toEqual([{ name: 'Annual leave', icon: '☀', count: 2 }, { name: 'Sickness', icon: '✚', count: 1 }]);
    expect(k.states).toEqual([
      { key: 'pend', glyph: '◷', tone: 'pend', label: 'Submitted', count: 1 },
      { key: 'draft', glyph: '✎', tone: 'draft', label: 'Draft', count: 1 },
      { key: 'none', glyph: '⚠', tone: 'att', label: 'Nothing recorded', count: 2 },
    ]);
    expect(keyIsEmpty(k)).toBe(false);
  });
  test('an empty month has an empty key and no month line', () => {
    expect(keyIsEmpty(monthKey([day({}), day({})]))).toBe(true);
    expect(monthSummary(monthTotals([day({})]))).toBe('');
  });
  test('the month line counts shifts, recorded hours and days of leave (not sickness)', () => {
    const t = monthTotals([day({ tone: 'E', minutes: 450 }), day({ tone: 'L', minutes: 0 }), day({ absence: 'V' }), day({ absence: 'S' }), day({ minutes: 30 })]);
    expect(t).toEqual({ shifts: 2, minutes: 480, leaveDays: 1 });
    expect(monthSummary(t)).toBe('2 shifts · 8.0h recorded · 1 day leave');
    expect(monthSummary({ shifts: 1, minutes: 0, leaveDays: 2 })).toBe('1 shift · 2 days leave');
  });
});
