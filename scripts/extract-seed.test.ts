import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

/* Module 8 (review I2): the seeds are written by scripts/extract-seed.mjs and
   never edited by hand. A fresh run into a scratch folder must match the
   committed seeds, so a field added to the contract but not to the extractor
   (or the other way round) fails here, not on the next `npm run seed`.
   Line endings are ignored: Git may check the seeds out with CRLF. */
const SEEDS = ['qnipay.json', 'social.json', 'meta.json'];
const text = (path: string) => readFileSync(path, 'utf8').replace(/\r\n/g, '\n');

test('a fresh extractor run reproduces the committed seeds exactly', () => {
  const out = mkdtempSync(join(tmpdir(), 'qnipay-seed-'));
  try {
    /* a cold jsdom load alone can take most of a minute on Windows */
    execFileSync(process.execPath, [resolve(__dirname, 'extract-seed.mjs')], { env: { ...process.env, SEED_OUT: out }, stdio: 'pipe', timeout: 240_000 });
    const drift = SEEDS.filter(f => text(join(out, f)) !== text(resolve(__dirname, '../src/mocks/seed', f)));
    expect(drift).toEqual([]);
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
}, 300_000);
