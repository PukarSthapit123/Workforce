import { HttpResponse } from 'msw';
import type { z } from 'zod';
import type { Refusal, RecordMeta } from '@/contract/common';
import { store } from './store';

export class Refused extends Error { constructor(public status: number, public body: Refusal) { super(body.message); } }
export const refuse = (status: number, body: Refusal): never => { throw new Refused(status, body); };

/* Wraps a handler so a thrown Refused becomes the one refusal shape. */
export const handle = <A extends unknown[]>(fn: (...a: A) => Promise<Response> | Response) =>
  async (...a: A) => {
    try { return await fn(...a); }
    catch (e) { if (e instanceof Refused) return HttpResponse.json(e.body, { status: e.status }); throw e; }
  };

export async function readJson<T extends z.ZodType>(request: Request, schema: T): Promise<z.infer<T>> {
  const body = await request.json().catch(() => undefined);
  const r = schema.safeParse(body);
  if (!r.success) {
    const issue = r.error.issues[0];
    return refuse(422, { code: 'invalid', field: issue?.path.join('.'), message: issue?.message ?? 'That request was not valid.', next: 'Correct the highlighted field and try again.' });
  }
  return r.data;
}
export function checkVersion(request: Request, record: RecordMeta) {
  const m = request.headers.get('If-Match');
  if (m === null) refuse(428, { code: 'version-required', message: 'This change was sent without the version it was based on.', next: 'Reload and apply your change again' });
  if (Number(m) !== record.version) refuse(412, { code: 'stale', message: 'Somebody changed this since you opened it. Your change has not been saved.', next: 'Reload and apply your change again' });
}
export function bump<T extends RecordMeta>(record: T, changes: Partial<T>): T {
  return { ...record, ...changes, version: record.version + 1, updatedAt: store.now() };
}
