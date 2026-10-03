import type { RotaConfigRecord } from '@/api/rota';
import { DEFAULT_ROTA_CONFIG, DEFAULT_TYPE_ROTA } from '@/domain/rota';
import { draftOf, newStageDraft, rotaBody } from './setup';

const config: RotaConfigRecord = {
  id: 'rotaConfig', version: 3, updatedAt: '2026-08-13T14:30:00.000Z', ...DEFAULT_ROTA_CONFIG,
  fulfilStages: [
    { n: 1, audience: 'Employees at location', wait: 15, channel: 'In-app + email', next: 'Favourite workers' },
    { n: 2, audience: 'Service Manager', wait: 240, channel: 'Email', next: 'Agency / manual booking' },
  ],
  /* stored in another key order than the draft builds, which is not a change */
  types: { shift: { flexible: false, maxConsec: 6, restHours: 11, maxHours: 48, night: true, shifts: ['L', 'E'] } },
};

test('an untouched draft sends nothing, whatever order its blocks were stored in', () => {
  expect(rotaBody(config, draftOf(config, ['shift', 'casual']))).toEqual({});
});

test('only what changed is sent: one rule, one type by its code, numbers as numbers', () => {
  const d = draftOf(config, ['shift', 'casual']);
  d.nums.minDefault = '6';
  d.safeRules.night = false;
  const casual = d.types.casual;
  if (!casual) throw new Error('no casual draft');
  d.types.casual = { ...casual, nums: { ...casual.nums, maxHours: '30' } };
  expect(rotaBody(config, d)).toEqual({ minDefault: 6, safeRules: { night: false }, types: { casual: { ...DEFAULT_TYPE_ROTA, maxHours: 30 } } });
});

test('a value that is not a number is sent as -1, for the server to refuse on its field', () => {
  const d = draftOf(config, []);
  d.nums.restHours = '';
  d.nums.maxHours = '1e';
  expect(rotaBody(config, d)).toMatchObject({ restHours: -1, maxHours: -1 });
});

test('stages are sent as one list, renumbered by position, once any changes', () => {
  const d = draftOf(config, []);
  d.stages = [d.stages[1] ?? newStageDraft(1), newStageDraft(2)];
  expect(rotaBody(config, d).fulfilStages).toEqual([
    { n: 1, audience: 'Service Manager', wait: 240, channel: 'Email', next: 'Agency / manual booking' },
    { n: 2, audience: 'Everyone cleared organisation-wide', wait: 60, channel: 'In-app + email', next: 'Manager escalation' },
  ]);
});
