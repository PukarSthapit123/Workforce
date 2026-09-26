import { resolveCapabilities } from './capabilities';

test('template plus grants minus revocations, sorted and unique', () => {
  expect(resolveCapabilities(['own_home', 'team_ts'], ['proxy', 'own_home'], ['team_ts'])).toEqual(['own_home', 'proxy']);
});
test('a revocation beats a grant of the same capability', () => {
  expect(resolveCapabilities([], ['proxy'], ['proxy'])).toEqual([]);
});
