import { z } from 'zod';
import { refuse, Refused, readJson, checkVersion, bump, requireSession, requireCapability, type Session } from './http';
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

describe('requireSession and requireCapability', () => {
  const session: Session = { personCode: 'per_1', name: 'Ana', capabilities: ['own.timesheet.view'] };

  test('requireSession refuses 401 when there is no bearer token', () => {
    const request = new Request('http://localhost/x');
    expect(() => requireSession(request)).toThrow(Refused);
    try { requireSession(request); } catch (e) { expect((e as Refused).status).toBe(401); }
  });
  test('requireSession refuses 401 when the token matches no session', () => {
    const request = new Request('http://localhost/x', { headers: { Authorization: 'Bearer nope' } });
    expect(() => requireSession(request)).toThrow(Refused);
  });
  test('requireSession returns the session for a known bearer token', () => {
    store.coll<Session>('sessions').tok1 = session;
    const request = new Request('http://localhost/x', { headers: { Authorization: 'Bearer tok1' } });
    expect(requireSession(request)).toEqual(session);
  });
  test('requireCapability passes silently when the session has the capability', () => {
    expect(() => requireCapability(session, 'own.timesheet.view')).not.toThrow();
  });
  test('requireCapability refuses 403 naming the missing capability, without saving the session', () => {
    try {
      requireCapability(session, 'cfg.tenant.edit');
      throw new Error('should have refused');
    } catch (e) {
      expect(e).toBeInstanceOf(Refused);
      const refused = e as Refused;
      expect(refused.status).toBe(403);
      expect(refused.body.code).toBe('capability');
      expect(refused.body.message).toContain('cfg.tenant.edit');
    }
  });
});
