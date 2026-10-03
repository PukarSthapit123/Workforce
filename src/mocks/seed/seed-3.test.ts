import social from './social.json';
import qnipay from './qnipay.json';
import {
  COVER_REASONS, FULFIL_AUDIENCES, FULFIL_CHANNELS, ROTA_STATES, isValidCell, onRoster, recalcShift, rotaConfigProblem, rotaWeekId,
  type FulfilStage, type RotaConfig, type ShiftType, type TypeRota,
} from '@/domain/rota';
import { periodStart } from '@/domain/time';

type Rec = Record<string, unknown> & { id: string };
interface SeedFile { data: Record<string, Record<string, Rec>> }
interface Week extends Rec { location: string; weekStart: string; state: string; publishVersion: number; lines: Record<string, string[]>; publishedBy: { personCode: string } }
interface Pattern extends Rec { locations: string[]; jobProfiles: string[]; days: string[]; cycle: number; starts: string; people: { personCode: string; offset: number }[] }
interface Person extends Rec { code: string; location: string; state: string; contractedHours: number }
interface Cover extends Rec { location: string; date: string; shift: string; reason: string; stage: number }
interface Filled extends Rec { location: string; date: string; shift: string; personCode: string }
type Config = Rec & RotaConfig & { fulfilStages: FulfilStage[]; types: Record<string, TypeRota> };
const vals = <T = Rec>(s: SeedFile, c: string) => Object.values(s.data[c] ?? {}) as T[];
const seed = social as unknown as SeedFile;
const people = new Map(vals<Person>(seed, 'people').map(p => [p.code, p]));
const shifts = vals<Rec & ShiftType>(seed, 'shiftTypes');
const codes = shifts.map(s => s.code);
const locations = new Set(vals<Rec & { code: string }>(seed, 'locations').map(l => l.code));
const ROTA = ['shiftTypes', 'patterns', 'rotaWeeks', 'rotaProfiles', 'coverRequests', 'filledShifts', 'rotaConfig'];

describe('seed social for module 3', () => {
  test('the shift catalogue holds the times its derived fields come from', () => {
    expect(codes).toEqual(['E', 'L', 'N']);
    for (const s of shifts) expect(recalcShift(s), s.code).toMatchObject({ hours: s.hours, cross: s.cross, start: s.start, end: s.end });
  });
  test('rota weeks: one per location and week, the frozen clock\'s week and the one before, both published v1', () => {
    const weeks = vals<Week>(seed, 'rotaWeeks');
    expect(new Set(weeks.map(w => w.weekStart))).toEqual(new Set(['2026-08-10', '2026-08-03']));
    expect(periodStart('2026-08-13')).toBe('2026-08-10');
    for (const w of weeks) {
      expect(w.id).toBe(rotaWeekId(w.location, w.weekStart));
      expect(locations.has(w.location), w.id).toBe(true);
      expect(ROTA_STATES as readonly string[]).toContain(w.state);
      expect([w.state, w.publishVersion, people.has(w.publishedBy.personCode)], w.id).toEqual(['published', 1, true]);
    }
    expect(weeks.filter(w => w.weekStart === '2026-08-10').map(w => w.location).sort()).toEqual(['FS', 'LGW', 'MAN', 'SLO', 'WH']);
  });
  test('every line belongs to a real person on that location\'s roster, and every cell is a shift code, rest, leave or sickness', () => {
    for (const w of vals<Week>(seed, 'rotaWeeks')) for (const [code, line] of Object.entries(w.lines)) {
      const p = people.get(code);
      expect(p, `${w.id}/${code}`).toBeDefined();
      expect(line).toHaveLength(7);
      if (p) expect(onRoster(p, w.location, line), `${w.id}/${code}`).toBe(true);
      expect(line.filter(c => !isValidCell(c, shifts)), `${w.id}/${code}`).toEqual([]);
    }
  });
  test('the week on the clock keeps the prototype\'s lines, and the week before is each line a day on', () => {
    const now = seed.data.rotaWeeks?.['rw_WH_2026-08-10'] as Week | undefined, before = seed.data.rotaWeeks?.['rw_WH_2026-08-03'] as Week | undefined;
    expect(now?.lines['CP-1088']).toEqual(['V', 'V', 'L', 'L', '', 'E', '']);
    expect(before?.lines['CP-1088']).toEqual(['V', 'L', 'L', '', 'E', '', 'V']);
    expect(Object.keys(now?.lines ?? {})).not.toContain('CP-1288');
  });
  test('patterns name real shift codes, people, locations and job profiles', () => {
    const jobs = new Set(vals<Rec & { code: string }>(seed, 'jobProfiles').map(j => j.code));
    const pats = vals<Pattern>(seed, 'patterns');
    expect(pats.map(p => p.id)).toEqual(['pat_WP-01', 'pat_WP-02', 'pat_WP-03', 'pat_WP-04']);
    for (const p of pats) {
      expect(p.days).toHaveLength(p.cycle);
      expect(p.days.filter(c => c && !codes.includes(c)), p.id).toEqual([]);
      expect(p.people.filter(x => !people.has(x.personCode) || x.offset < 1 || x.offset > p.cycle), p.id).toEqual([]);
      expect(p.locations.filter(l => !locations.has(l)), p.id).toEqual([]);
      expect(p.jobProfiles.filter(j => !jobs.has(j)), p.id).toEqual([]);
      expect(p.starts).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  test('cover requests and filled shifts name real locations, shifts and people, in the current week', () => {
    for (const c of vals<Cover>(seed, 'coverRequests')) {
      expect([locations.has(c.location), codes.includes(c.shift), periodStart(c.date)], c.id).toEqual([true, true, '2026-08-10']);
      expect(COVER_REASONS as readonly string[]).toContain(c.reason);
    }
    for (const f of vals<Filled>(seed, 'filledShifts'))
      expect([locations.has(f.location), codes.includes(f.shift), people.has(f.personCode)], f.id).toEqual([true, true, true]);
  });
  test('rota config, fulfilment stages and per-type limits pass the setup check', () => {
    const cfg = seed.data.rotaConfig?.rotaConfig as Config;
    const types = vals<Rec & { code: string }>(seed, 'employeeTypes').map(t => t.code);
    expect(Object.keys(cfg.types).sort()).toEqual([...types].sort());
    expect(rotaConfigProblem(cfg, cfg.fulfilStages, cfg.types, { employeeTypes: types, shiftCodes: codes })).toBeNull();
    for (const s of cfg.fulfilStages) {
      expect(FULFIL_AUDIENCES as readonly string[]).toContain(s.audience);
      expect(FULFIL_CHANNELS as readonly string[]).toContain(s.channel);
    }
    expect(cfg.types.casual).toEqual({ shifts: ['E', 'L', 'N'], night: true, maxHours: 37.5, restHours: 11, maxConsec: 5, flexible: true });
  });
  test('every person has a safe-worker profile, and Kwame Boateng\'s lapsed DBS is kept', () => {
    const profiles = vals<Rec & { personCode: string; cleared: boolean; dbsExpiry: string }>(seed, 'rotaProfiles');
    expect(profiles.map(p => p.personCode).sort()).toEqual([...people.keys()].sort());
    expect(profiles.find(p => p.personCode === 'CP-1490')).toMatchObject({ cleared: false, dbsExpiry: '2026-06-30' });
  });
  test('no money in any rota collection', () => {
    expect(JSON.stringify(ROTA.map(c => seed.data[c]))).not.toMatch(/£|"rate"|"amount"|"cost"|"pay"/i);
  });
});

test('qnipay keeps Rota off and has no rota data (D9)', () => {
  const q = qnipay as unknown as SeedFile;
  expect((q.data.tenant?.tenant as Rec & { modules: Record<string, boolean> }).modules.R).toBe(false);
  for (const c of ROTA) expect(q.data[c], c).toBeUndefined();
});
