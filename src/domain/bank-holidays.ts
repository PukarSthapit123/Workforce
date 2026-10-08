export type BankHolidayRegion = 'England & Wales' | 'Scotland' | 'Northern Ireland' | 'None';
export interface BankHoliday { date: string; name: string }

const DATES: Readonly<Record<Exclude<BankHolidayRegion, 'None'>, readonly BankHoliday[]>> = {
  'England & Wales': [
    { date: '2026-01-01', name: 'New Year’s Day' }, { date: '2026-04-03', name: 'Good Friday' },
    { date: '2026-04-06', name: 'Easter Monday' }, { date: '2026-05-04', name: 'Early May bank holiday' },
    { date: '2026-05-25', name: 'Spring bank holiday' }, { date: '2026-08-31', name: 'Summer bank holiday' },
    { date: '2026-12-25', name: 'Christmas Day' }, { date: '2026-12-28', name: 'Boxing Day' },
    { date: '2027-01-01', name: 'New Year’s Day' }, { date: '2027-03-26', name: 'Good Friday' },
    { date: '2027-03-29', name: 'Easter Monday' }, { date: '2027-05-03', name: 'Early May bank holiday' },
    { date: '2027-05-31', name: 'Spring bank holiday' }, { date: '2027-08-30', name: 'Summer bank holiday' },
    { date: '2027-12-27', name: 'Christmas Day' }, { date: '2027-12-28', name: 'Boxing Day' },
    { date: '2028-01-03', name: 'New Year’s Day' }, { date: '2028-04-14', name: 'Good Friday' },
    { date: '2028-04-17', name: 'Easter Monday' }, { date: '2028-05-01', name: 'Early May bank holiday' },
    { date: '2028-05-29', name: 'Spring bank holiday' }, { date: '2028-08-28', name: 'Summer bank holiday' },
    { date: '2028-12-25', name: 'Christmas Day' }, { date: '2028-12-26', name: 'Boxing Day' },
  ],
  Scotland: [
    { date: '2026-01-01', name: 'New Year’s Day' }, { date: '2026-01-02', name: '2 January' },
    { date: '2026-04-03', name: 'Good Friday' }, { date: '2026-05-04', name: 'Early May bank holiday' },
    { date: '2026-05-25', name: 'Spring bank holiday' }, { date: '2026-08-03', name: 'Summer bank holiday' },
    { date: '2026-11-30', name: 'St Andrew’s Day' }, { date: '2026-12-25', name: 'Christmas Day' },
    { date: '2026-12-28', name: 'Boxing Day' },
    { date: '2027-01-01', name: 'New Year’s Day' }, { date: '2027-01-04', name: '2 January' },
    { date: '2027-03-26', name: 'Good Friday' }, { date: '2027-05-03', name: 'Early May bank holiday' },
    { date: '2027-05-31', name: 'Spring bank holiday' }, { date: '2027-08-02', name: 'Summer bank holiday' },
    { date: '2027-11-30', name: 'St Andrew’s Day' }, { date: '2027-12-27', name: 'Christmas Day' },
    { date: '2027-12-28', name: 'Boxing Day' },
    { date: '2028-01-03', name: 'New Year’s Day' }, { date: '2028-01-04', name: '2 January' },
    { date: '2028-04-14', name: 'Good Friday' }, { date: '2028-05-01', name: 'Early May bank holiday' },
    { date: '2028-05-29', name: 'Spring bank holiday' }, { date: '2028-08-07', name: 'Summer bank holiday' },
    { date: '2028-11-30', name: 'St Andrew’s Day' }, { date: '2028-12-25', name: 'Christmas Day' },
    { date: '2028-12-26', name: 'Boxing Day' },
  ],
  'Northern Ireland': [
    { date: '2026-01-01', name: 'New Year’s Day' }, { date: '2026-03-17', name: 'St Patrick’s Day' },
    { date: '2026-04-03', name: 'Good Friday' }, { date: '2026-04-06', name: 'Easter Monday' },
    { date: '2026-05-04', name: 'Early May bank holiday' }, { date: '2026-05-25', name: 'Spring bank holiday' },
    { date: '2026-07-13', name: 'Battle of the Boyne (Orangemen’s Day)' }, { date: '2026-08-31', name: 'Summer bank holiday' },
    { date: '2026-12-25', name: 'Christmas Day' }, { date: '2026-12-28', name: 'Boxing Day' },
    { date: '2027-01-01', name: 'New Year’s Day' }, { date: '2027-03-17', name: 'St Patrick’s Day' },
    { date: '2027-03-26', name: 'Good Friday' }, { date: '2027-03-29', name: 'Easter Monday' },
    { date: '2027-05-03', name: 'Early May bank holiday' }, { date: '2027-05-31', name: 'Spring bank holiday' },
    { date: '2027-07-12', name: 'Battle of the Boyne (Orangemen’s Day)' }, { date: '2027-08-30', name: 'Summer bank holiday' },
    { date: '2027-12-27', name: 'Christmas Day' }, { date: '2027-12-28', name: 'Boxing Day' },
    { date: '2028-01-03', name: 'New Year’s Day' }, { date: '2028-03-17', name: 'St Patrick’s Day' },
    { date: '2028-04-14', name: 'Good Friday' }, { date: '2028-04-17', name: 'Easter Monday' },
    { date: '2028-05-01', name: 'Early May bank holiday' }, { date: '2028-05-29', name: 'Spring bank holiday' },
    { date: '2028-07-12', name: 'Battle of the Boyne (Orangemen’s Day)' }, { date: '2028-08-28', name: 'Summer bank holiday' },
    { date: '2028-12-25', name: 'Christmas Day' }, { date: '2028-12-26', name: 'Boxing Day' },
  ],
};

export function bankHolidaysFor(region: BankHolidayRegion, from: string, until: string): BankHoliday[] {
  if (region === 'None') return [];
  return DATES[region].filter(h => h.date >= from && h.date <= until).map(h => ({ ...h }));
}
