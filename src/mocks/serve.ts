/* serve(endpoint, fn): the one way a contract endpoint gets a fake-server
   handler. It applies, in order, everything the contract says about the
   endpoint, so a handler body holds only its own rules:
     1. the session (requireSession), unless the endpoint is public; this
        includes the view-as read-only guard, relaxed only for an endpoint
        marked allowedWhileViewing, and the new-starter guard: a person still
        onboarding may write only to an endpoint marked allowedWhileOnboarding;
     2. ep.capability (requireCapability);
     3. path params and the query, against the endpoint's schemas (422);
     4. the body, against ep.request (422);
     5. fn, which calls checkVersion(record) once it has found the record,
        when the endpoint is versioned;
     6. in dev and test, the response against ep.response (a loud 500).
   fn is synchronous on purpose. Everything it needs has been read by then, so
   it runs start to finish without yielding to another request, and serve can
   restore the database when fn throws: a refusal can never half-apply,
   whatever order fn checks and writes in. The audit write stays explicit in
   fn, next to the change it records. */
import { http, HttpResponse, type HttpHandler, type JsonBodyType } from 'msw';
import type { z } from 'zod';
import type { Endpoint } from '@/contract/endpoints';
import type { RecordMeta } from '@/contract/common';
import { store } from './store';
import { checkVersion, handle, readJson, readParams, readQuery, refuse, Refused } from './http';
import { requireCapability, requireSession, type AuthedSession } from './auth';

export interface Served<E extends Endpoint> {
  request: Request;
  params: E extends { params: z.ZodType } ? z.output<E['params']> : Record<string, never>;
  query: E extends { query: z.ZodType } ? z.output<E['query']> : Record<string, never>;
  body: E extends { request: z.ZodType } ? z.output<E['request']> : undefined;
  session: E extends { public: true } ? undefined : AuthedSession;
  /* Refuses 428/412 unless If-Match names this record's version. Only a
     versioned endpoint has it, and its fn must call it. */
  checkVersion: E extends { versioned: true } ? (record: RecordMeta) => void : never;
}

/* Every endpoint serve() has registered a handler for, and those handlers,
   so a test can prove the registry and the fake server agree. */
export const SERVED = new Set<Endpoint>();
export const SERVED_HANDLERS = new WeakSet<HttpHandler>();

/* Response validation is a development aid: a demo build (VITE_MOCKS=on in
   production mode) skips it. */
const CHECK_RESPONSES = import.meta.env.DEV || import.meta.env.MODE === 'test';

const METHOD = { GET: http.get, POST: http.post, PUT: http.put, PATCH: http.patch, DELETE: http.delete } as const;

export function serve<const E extends Endpoint>(ep: E, fn: (ctx: Served<E>) => z.input<E['response']>): HttpHandler {
  SERVED.add(ep);
  const name = `${ep.method} ${ep.path}`;
  const handler = METHOD[ep.method](ep.path, handle(async ({ request, params }: { request: Request; params: Record<string, unknown> }) => {
    const session = ep.public ? undefined : requireSession(request, ep.allowedWhileViewing === true, ep.allowedWhileOnboarding === true);
    if (ep.capability && session) requireCapability(session, ep.capability);
    const p: unknown = ep.params ? readParams(params, ep.params) : {};
    const q: unknown = ep.query ? readQuery(request, ep.query) : {};
    const body: unknown = ep.request ? await readJson(request, ep.request) : undefined;

    let versionChecked = false;
    const check = (record: RecordMeta) => { checkVersion(request, record); versionChecked = true; };
    const snapshot = ep.method === 'GET' ? null : structuredClone(store.db);
    try {
      const data = fn({ request, params: p, query: q, body, session, checkVersion: check } as Served<E>);
      if (ep.versioned && !versionChecked)
        throw new Error(`${name} is versioned, but its handler returned without calling checkVersion(record).`);
      if (CHECK_RESPONSES) {
        const r = ep.response.safeParse(data);
        if (!r.success) {
          const issue = r.error.issues[0];
              throw new Error(`${name} answered with a response its contract does not allow (${issue?.path.join('.') || 'the response'}: ${issue?.message ?? ''}).`);
        }
      }
      return HttpResponse.json(data as JsonBodyType);
    } catch (e) {
      if (snapshot) store.db = snapshot;
      if (e instanceof Refused) throw e;
      /* A defect in a handler, not a refusal: answered loudly, as a 500 in the
         refusal shape that names the endpoint, so the screen can still show it. */
      console.error(e);
      const detail = e instanceof Error ? e.message : String(e);
      return refuse(500, { code: 'server-defect', message: detail.startsWith(name) ? detail : `${name} failed: ${detail}`, next: 'Report this. It is a fault in the fake server, not in what you did.' });
    }
  }));
  SERVED_HANDLERS.add(handler);
  return handler;
}
