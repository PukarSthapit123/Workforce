import { HttpResponse } from 'msw';
import type { z } from 'zod';
import type { Refusal, RecordMeta } from '@/contract/common';
import { store } from './store';

export class Refused extends Error { constructor(public status: number, public body: Refusal) { super(body.message); } }
export const refuse = (status: number, body: Refusal): never => { throw new Refused(status, body); };

/* Wraps a handler so a thrown Refused becomes the one refusal shape. serve()
   uses it; the _dev control handlers may too. */
export const handle = <A extends unknown[]>(fn: (...a: A) => Promise<Response> | Response) =>
  async (...a: A) => {
    try { return await fn(...a); }
    catch (e) { if (e instanceof Refused) return HttpResponse.json(e.body, { status: e.status }); throw e; }
  };

/* camelCase and snake_case keys read as words: personCode -> "person code". */
const words = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
const EXPECTED: Record<string, string> = {
  string: 'text', number: 'a number', int: 'a whole number', boolean: 'true or false', array: 'a list', object: 'a set of fields',
  date: 'a date', null: 'empty',
};
/* Zod's own messages ("Invalid input: expected number, received NaN") are
   written for developers. This error map, passed to every server-side parse,
   says the same thing in plain words. A message a schema sets itself (such as
   'Give a reason. Exceptions are reviewed.') still wins, because Zod ranks a
   schema's own message above a per-parse map. */
export const plainError: z.core.$ZodErrorMap = iss => {
  const key = iss.path?.length ? String(iss.path[iss.path.length - 1]) : '';
  const the = key ? `The ${words(key)}` : 'This request';
  switch (iss.code) {
    case 'invalid_type':
      if (iss.input === undefined) return key ? `${the} is missing.` : 'This request has no details in it.';
      return `${the} must be ${EXPECTED[iss.expected] ?? 'a different kind of value'}.`;
    case 'too_small':
      if (iss.origin === 'string') return Number(iss.minimum) <= 1 ? `${the} cannot be empty.` : `${the} must be at least ${String(iss.minimum)} characters.`;
      if (iss.origin === 'array') return `${the} needs at least ${String(iss.minimum)} ${Number(iss.minimum) === 1 ? 'item' : 'items'}.`;
      return `${the} must be at least ${String(iss.minimum)}.`;
    case 'too_big':
      if (iss.origin === 'string') return `${the} can be at most ${String(iss.maximum)} characters.`;
      if (iss.origin === 'array') return `${the} can have at most ${String(iss.maximum)} items.`;
      return `${the} can be at most ${String(iss.maximum)}.`;
    case 'invalid_value': return `${the} must be one of: ${iss.values.map(String).join(', ')}.`;
    case 'invalid_format': return `${the} is not in the right format.`;
    case 'unrecognized_keys': return `This request has fields it should not: ${iss.keys.join(', ')}.`;
    default: return `${the} is not valid.`;
  }
};

function parseOr422<T extends z.ZodType>(schema: T, value: unknown, next: string): z.output<T> {
  const r = schema.safeParse(value, { error: plainError });
  if (r.success) return r.data;
  const issue = r.error.issues[0];
  const field = issue?.path.length ? issue.path.join('.') : undefined;
  return refuse(422, { code: 'invalid', ...(field ? { field } : {}), message: issue?.message ?? 'That request was not valid.', next });
}

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.output<T>> {
  const body: unknown = await request.json().catch(() => undefined);
  return parseOr422(schema, body, 'Correct the highlighted field and try again.');
}
/* The query string, validated against the endpoint's own query schema. A
   bad value is refused with 422 naming the field, never quietly clamped. */
export function readQuery<T extends z.ZodType>(request: Request, schema: T): z.output<T> {
  return parseOr422(schema, Object.fromEntries(new URL(request.url).searchParams), 'Correct the value in the address and try again.');
}
/* Path parameters, as MSW decoded them from the URL. */
export function readParams<T extends z.ZodType>(params: Record<string, unknown>, schema: T): z.output<T> {
  return parseOr422(schema, params, 'Check the address and try again.');
}

/* If-Match carries the version the change was based on as a bare whole
   number, such as 3: no quotes and no W/ prefix. A missing or empty one is
   428; anything else that is not a whole number is refused with 412 rather
   than read loosely (Number('') is 0, which could match a version 0 record). */
export function checkVersion(request: Request, record: RecordMeta) {
  const m = request.headers.get('If-Match')?.trim() ?? '';
  if (m === '') refuse(428, { code: 'version-required', message: 'This change was sent without the version it was based on, so it has not been saved.', next: 'Reload and apply your change again' });
  if (!/^\d+$/.test(m)) refuse(412, { code: 'version-unreadable', message: `The version sent with this change (${m}) is not a whole number, so it has not been saved.`, next: 'Reload and apply your change again' });
  if (Number(m) !== record.version) refuse(412, { code: 'stale', message: 'Somebody changed this since you opened it. Your change has not been saved.', next: 'Reload and apply your change again' });
}
export function bump<T extends RecordMeta>(record: T, changes: Partial<T>): T {
  return { ...record, ...changes, version: record.version + 1, updatedAt: store.now() };
}
