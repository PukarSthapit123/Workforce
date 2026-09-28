/* npm run build:check: make the plain production build and fail if any part
   of the fake server reached it. A plain build must never carry the _dev
   control endpoints, the demo password, MSW's worker or the seed. */
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve, dirname, relative, join, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(root, 'dist');
/* The seed marker is the demo tenant's email domain: every seeded person and
   account in social.json carries it, and nothing outside the seed does. */
export const MARKERS = ['_dev/', 'Qnipay@123', 'setupWorker', 'mockServiceWorker', '@brightpath.org'];

export function findMarkers(dir) {
  const hits = [];
  const walk = d => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) { walk(p); continue; }
      const rel = relative(dir, p).split(sep).join('/');
      for (const m of MARKERS) if (rel.includes(m)) hits.push(`${rel}: file name contains "${m}"`);
      if (!/\.(js|mjs|css|html|json|map|txt)$/.test(name)) continue;
      const text = readFileSync(p, 'utf8');
      for (const m of MARKERS) if (text.includes(m)) hits.push(`${rel}: contains "${m}"`);
    }
  };
  walk(dir);
  return hits;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const env = { ...process.env };
  delete env.VITE_MOCKS;
  const r = spawnSync('npm run build', { cwd: root, stdio: 'inherit', shell: true, env });
  if (r.status !== 0) { console.error('build:check: the production build failed'); process.exit(r.status ?? 1); }
  const hits = findMarkers(dist);
  if (hits.length) {
    console.error('build:check: the production build carries the fake server:\n  ' + hits.join('\n  '));
    process.exit(1);
  }
  console.log(`build:check: dist/ is free of ${MARKERS.join(', ')}`);
}
