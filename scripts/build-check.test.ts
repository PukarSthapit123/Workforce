// @vitest-environment node
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findMarkers, MARKERS } from './build-check.mjs';

/* I8: build:check fails the build on any trace of the fake server. */
let dir = '';
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'build-check-')); mkdirSync(join(dir, 'assets')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

test('a clean dist has no markers', () => {
  writeFileSync(join(dir, 'assets', 'index.js'), 'console.log("hello")');
  expect(findMarkers(dir)).toEqual([]);
});
test.each(MARKERS)('a dist carrying %s is caught', marker => {
  writeFileSync(join(dir, 'assets', 'index.js'), `const x = ${JSON.stringify(marker)};`);
  expect(findMarkers(dir)).toEqual([`assets/index.js: contains "${marker}"`]);
});
test('the worker script is caught by its file name alone', () => {
  writeFileSync(join(dir, 'mockServiceWorker.js'), '');
  expect(findMarkers(dir)).toContain('mockServiceWorker.js: file name contains "mockServiceWorker"');
});
