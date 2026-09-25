import { z } from 'zod';
import { refuse, Refused, readJson, checkVersion, bump } from './http';
import { store } from './store';

beforeEach(() => { store.reset('social'); });

test('refuse throws a Refused carrying the status and refusal body', () => {
  try {
    refuse(403, { code: 'capability', message: 'nope', next: 'ask an administrator' });
    throw new Error('refuse should have thrown');
  } catch (e) {
    expect(e).toBeInstanceOf(Refused);
    const refused = e as Refused;
    expect(refused.status).toBe(403);
    expect(refused.body).toEqual({ code: 'capability', message: 'nope', next: 'ask an administrator' });
  }
});

describe('readJson', () => {
  const schema = z.object({ name: z.string() });
  test('returns the parsed body when it matches the schema', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ name: 'A' }) });
    await expect(readJson(request, schema)).resolves.toEqual({ name: 'A' });
  });
  test('refuses 422 with the failing field when the body does not match', async () => {
    const request = new Request('http://localhost/x', { method: 'POST', body: JSON.stringify({ name: 5 }) });
    await expect(readJson(request, schema)).rejects.toMatchObject({ status: 422, body: { code: 'invalid', field: 'name' } });
  });
});

describe('checkVersion', () => {
  const record = { id: 'a', version: 3, updatedAt: '2026-08-13T14:30:00.000Z' };
  test('passes silently when If-Match matches the record version', () => {
    const request = new Request('http://localhost/x', { headers: { 'If-Match': '3' } });
    expect(() => checkVersion(request, record)).not.toThrow();
  });
  test('refuses 428 when If-Match is missing', () => {
    const request = new Request('http://localhost/x');
    expect(() => checkVersion(request, record)).toThrow(Refused);
    try { checkVersion(request, record); } catch (e) { expect((e as Refused).status).toBe(428); }
  });
  test('refuses 412 with a reload-and-reapply next when the version is stale', () => {
    const request = new Request('http://localhost/x', { headers: { 'If-Match': '2' } });
    try {
      checkVersion(request, record);
      throw new Error('should have refused');
    } catch (e) {
      expect(e).toBeInstanceOf(Refused);
      const refused = e as Refused;
      expect(refused.status).toBe(412);
      expect(refused.body).toMatchObject({ code: 'stale', next: 'Reload and apply your change again' });
    }
  });
});

test('bump returns a new record with version+1 and the store clock as updatedAt', () => {
  store.setClock('2026-09-25T00:00:00.000Z');
  const record = { id: 'a', version: 3, updatedAt: '2026-08-13T14:30:00.000Z' };
  const next = bump(record, {});
  expect(next).toEqual({ id: 'a', version: 4, updatedAt: '2026-09-25T00:00:00.000Z' });
  expect(record.version).toBe(3); // the original is untouched
  store.setClock(null);
});
