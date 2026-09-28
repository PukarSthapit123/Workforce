import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
const trace = JSON.parse(readFileSync(resolve(__dirname, '../e2e/trace.json'), 'utf8'));
const areas = JSON.parse(readFileSync(resolve(__dirname, '../e2e/trace-areas.json'), 'utf8'));
interface TraceRow { id: string; text: string; area: string; deferredTo?: string; status: string; test?: string; reason?: string }
const rows = trace.rows as TraceRow[];

test('every row has a section and an area', () => {
  expect(rows.filter(r => !r.area)).toEqual([]);
});
test('no row in a completed area is still pending', () => {
  const open = rows.filter(r => areas.completedAreas.includes(r.area) && r.status === 'pending');
  expect(open.map(r => `${r.id} ${r.text}`)).toEqual([]);
});
test('n/a always carries a reason, ported always names its test', () => {
  expect(rows.filter(r => r.status === 'n/a' && !r.reason)).toEqual([]);
  expect(rows.filter(r => r.status === 'ported' && !r.test)).toEqual([]);
});

/* I10: n/a is only for what will never be built here: a mechanic of the
   prototype itself, behaviour a library or the real API replaces, or a
   deliberate divergence the plan made. "Not built yet" is pending in the
   area that builds it (deferredTo), never n/a. */
const NA_PREFIXES = ['prototype-only:', 'replaced by', 'diverges by plan:'];
test('n/a reasons use one of the allowed prefixes, and none says "not built" or "not tested"', () => {
  const bad = rows.filter(r => r.status === 'n/a' && !NA_PREFIXES.some(p => r.reason?.startsWith(p)));
  expect(bad.map(r => `${r.id}: ${r.reason ?? ''}`)).toEqual([]);
  expect(rows.filter(r => r.status === 'n/a' && /^not (built|tested)/i.test(r.reason ?? '')).map(r => r.id)).toEqual([]);
});
test('a deferred row sits in the later area it names, and that area is not already complete', () => {
  const known = new Set<string>([...Object.values(areas.sections as Record<string, string>), areas.defaultArea]);
  const bad = rows.filter(r => r.deferredTo !== undefined && (r.area !== r.deferredTo || !known.has(r.deferredTo) || areas.completedAreas.includes(r.deferredTo)));
  expect(bad.map(r => `${r.id} -> ${r.deferredTo ?? ''}`)).toEqual([]);
});

/* A ported row's test must still exist under that name, so renaming a test
   cannot quietly leave a row pointing at nothing. */
const plain = (s: string) => s.replace(/[’‘]/g, "'").replace(/\\'/g, "'");
test('every ported row names a test file that exists and a test title it contains', () => {
  const missing: string[] = [];
  for (const r of rows.filter(x => x.status === 'ported')) {
    const [file, title] = (r.test ?? '').split(' › ');
    const path = resolve(__dirname, '..', file ?? '');
    if (!file || !title || !existsSync(path)) { missing.push(`${r.id}: ${r.test ?? ''}`); continue; }
    if (!plain(readFileSync(path, 'utf8')).includes(plain(title))) missing.push(`${r.id}: "${title}" is not in ${file}`);
  }
  expect(missing).toEqual([]);
});
