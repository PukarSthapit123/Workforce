import {
  POSTING_STATE, byNewest, dispatchAuditText, integrationIdOf, isMapped, postingCounts, postingNote, resolutionToast,
} from './integration';

test('the integration id is P\'s INT- form of the record id', () => {
  expect(integrationIdOf('int_a1f3')).toBe('INT-a1f3');
  expect(integrationIdOf('int_000000000007')).toBe('INT-000000000007');
});

test('no state claims a Business Central confirmation or acceptance', () => {
  for (const s of Object.values(POSTING_STATE)) expect(s.note).not.toMatch(/confirmed by|accepted/i);
  expect(postingNote({ state: 'posted' })).toBe('Posted by the simulated dispatcher. Not a Business Central confirmation.');
  expect(postingNote({ state: 'queued' })).toBe('Queued. No result yet.');
  expect(postingNote({ state: 'failed', reason: 'Line 2: unknown cost centre CC-991' })).toBe('Line 2: unknown cost centre CC-991');
  expect(postingNote({ state: 'failed' })).toBe('Failed');
});

test('the tiles: posted is the period\'s, queued and failed are every record\'s, mapped is the codes with an element', () => {
  const all = [{ state: 'posted' as const }, { state: 'posted' as const }, { state: 'queued' as const }, { state: 'failed' as const }];
  expect(postingCounts(all, all.slice(1), [{ element: 'PE-STD' }, { element: '' }, { element: '—' }]))
    .toEqual({ posted: 1, queued: 1, failed: 1, mapped: 1, codes: 3 });
  expect(isMapped(' ')).toBe(false);
});

test('newest first, then by id', () => {
  const xs = [{ id: 'a', at: '2026-08-10T00:00:00Z' }, { id: 'c', at: '2026-08-11T00:00:00Z' }, { id: 'b', at: '2026-08-11T00:00:00Z' }];
  expect([...xs].sort(byNewest).map(x => x.id)).toEqual(['c', 'b', 'a']);
});

test('the resolution toast: posted is simulated, a failure says why and what next, queued says nothing', () => {
  expect(resolutionToast({ state: 'posted', ref: 'Rosa Mendes · 10/08/2026' })).toEqual({ kind: 'info', message: 'Posted (simulated) · Rosa Mendes · 10/08/2026' });
  expect(resolutionToast({ state: 'failed', ref: 'Batch WK32', reason: 'Line 2: unknown cost centre CC-991' }))
    .toEqual({ kind: 'error', message: 'Posting failed · Batch WK32 · Line 2: unknown cost centre CC-991', next: 'Fix the cause, then retry.' });
  expect(resolutionToast({ state: 'queued', ref: 'x' })).toBeNull();
  expect(dispatchAuditText([{ state: 'posted' }, { state: 'failed' }])).toBe('2 resolved by the simulated dispatcher: 1 posted (simulated), 1 failed');
});
