import { latest, versionKey } from './latest';

test('a held record is replaced by the copy the list now holds', () => {
  const held = { id: 'per_1', version: 1, name: 'Old' };
  const fresh = latest(held, [{ id: 'per_2', version: 4, name: 'Other' }, { id: 'per_1', version: 2, name: 'New' }]);
  expect(fresh).toEqual({ id: 'per_1', version: 2, name: 'New' });
  expect(versionKey(fresh)).not.toBe(versionKey(held));
});
test('the held record stands when the list has not loaded or no longer has it', () => {
  const held = { id: 'per_1', version: 1 };
  expect(latest(held, undefined)).toBe(held);
  expect(latest(held, [{ id: 'per_2', version: 1 }])).toBe(held);
});
