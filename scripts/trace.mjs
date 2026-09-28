/* One row per assertion in the prototype suite, so nothing it proved is silently
   dropped. Re-running keeps each row's status, test and reason. */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const SUITE = process.env.PROTOTYPE_SUITE || resolve(here, '../../Qnipay workforce cc/mockup/qnipay-regression-suite.js');
const OUT = resolve(here, '../e2e/trace.json');
const map = JSON.parse(readFileSync(resolve(here, '../e2e/trace-areas.json'), 'utf8'));
const src = readFileSync(SUITE, 'utf8').split('\n');
const prev = existsSync(OUT) ? Object.fromEntries(JSON.parse(readFileSync(OUT, 'utf8')).rows.map(r => [r.id, r])) : {};

let section = 'BOOT'; const rows = []; const defaulted = new Set(); const perSection = {};
src.forEach(line => {
  const h = /console\.log\('\\n=== (.+?) ===/.exec(line); if (h) { section = h[1]; return; }
  for (const m of line.matchAll(/\bok\(\s*(['`])((?:\\.|(?!\1).)*)\1/g)) {
    const text = m[2].replace(/\\u2019/g, '’').replace(/\\u2192/g, '→').replace(/\\'/g, "'");
    const n = (perSection[section] = (perSection[section] || 0) + 1);
    const id = `${section.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')}#${n}`;
    const area = map.sections[section] || (defaulted.add(section), map.defaultArea);
    const old = prev[id] && prev[id].text === text ? prev[id] : null;
    rows.push({ id, section, text, area, status: old ? old.status : 'pending', ...(old?.test ? { test: old.test } : {}), ...(old?.reason ? { reason: old.reason } : {}) });
  }
});
writeFileSync(OUT, JSON.stringify({ generatedFrom: 'qnipay-regression-suite.js', rows }, null, 1) + '\n');
console.log(`trace.json: ${rows.length} rows`);
if (defaulted.size) console.log('sections sent to the default area (' + map.defaultArea + '):\n  ' + [...defaulted].join('\n  '));
