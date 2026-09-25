import type { z } from 'zod';
import { Refusal } from '@/contract/common';
import type { Endpoint } from '@/contract/endpoints';
import { getToken } from './session-token';

export class ApiError extends Error {
  constructor(public status: number, public refusal: Refusal) { super(refusal.message); }
}
const UNREADABLE: Refusal = { code: 'unreadable', message: 'The server sent something this screen cannot read. Nothing has been changed on screen.', next: 'Reload the page. If it happens again, report it.' };
const NETWORK: Refusal = { code: 'network', message: 'The server could not be reached, so nothing was saved.', next: 'Check your connection and try again.' };

export async function api<E extends Endpoint>(ep: E, opts: {
  params?: Record<string, string>; body?: unknown; ifMatch?: number; query?: Record<string, string | undefined>;
} = {}): Promise<z.infer<E['response']>> {
  let url: string = ep.path.replace(/:([A-Za-z]+)/g, (_, k: string) => encodeURIComponent(opts.params?.[k] ?? ''));
  const q = Object.entries(opts.query ?? {}).filter(([, v]) => v !== undefined && v !== '') as [string, string][];
  if (q.length) url += '?' + new URLSearchParams(q).toString();
  const headers: Record<string, string> = { Accept: 'application/json' };
  const token = getToken(); if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.ifMatch !== undefined) headers['If-Match'] = String(opts.ifMatch);
  let res: Response;
  try {
    res = await fetch(url, { method: ep.method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  } catch {
    /* offline, DNS failure, an aborted request: fetch rejects rather than resolving with a
       response, so there is no status or body to parse. status 0 marks "never reached the
       server" for anything that inspects it. */
    throw new ApiError(0, NETWORK);
  }
  const data: unknown = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) {
    const r = Refusal.safeParse(data);
    throw new ApiError(res.status, r.success ? r.data : UNREADABLE);
  }
  const parsed = ep.response.safeParse(data);
  if (!parsed.success) throw new ApiError(res.status, UNREADABLE);
  /* Zod 4's safeParse types its `data` via a `this`-typed return, which does not
     specialise through a generic `E['response']`; TS sees `data: unknown` here even
     though the runtime value was validated against ep.response. The guard above is
     what makes this assertion sound. */
  return parsed.data as z.infer<E['response']>;
}
