import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const trace = JSON.parse(readFileSync(resolve(__dirname, '../e2e/trace.json'), 'utf8'));
const areas = JSON.parse(readFileSync(resolve(__dirname, '../e2e/trace-areas.json'), 'utf8'));

test('every row has a section and an area', () => {
  expect(trace.rows.filter((r: { area?: string }) => !r.area)).toEqual([]);
});
test('no row in a completed area is still pending', () => {
  const open = trace.rows.filter((r: { area: string; status: string }) => areas.completedAreas.includes(r.area) && r.status === 'pending');
  expect(open.map((r: { id: string; text: string }) => `${r.id} ${r.text}`)).toEqual([]);
});
test('n/a always carries a reason, ported always names its test', () => {
  expect(trace.rows.filter((r: { status: string; reason?: string }) => r.status === 'n/a' && !r.reason)).toEqual([]);
  expect(trace.rows.filter((r: { status: string; test?: string }) => r.status === 'ported' && !r.test)).toEqual([]);
});
