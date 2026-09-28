import type { z } from 'zod';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
/* Everything the OpenAPI document and the client need to know about one
   endpoint. Only `method`, `path`, `response` and `summary` are required.
   - params: every `:name` in the path, as a zod object. buildOpenApi and the
     contract tests check the two agree, and the client refuses to send a
     request with one missing.
   - query: the query string, as a zod object the handler validates too.
   - versioned: the write must carry If-Match: the version of the record it
     was based on, as a bare whole number such as 3 (no quotes, no W/). 428
     when it is missing or empty, 412 when it is stale or not a whole number.
   - public: no session is needed (sign-in itself, the demo account list).
   - devOnly: served by the fake server for development and tests only (the
     demo account list). Left out of the OpenAPI document, so it is not part
     of the production contract.
   - allowedWhileViewing: one of the few writes a session viewing as someone
     else may still make (ending the view, signing out).
   - errors: refusal statuses this endpoint can answer beyond the ones the
     flags above already imply (for example 404 or 409). */
export interface Endpoint {
  method: Method; path: `/api/v1/${string}`; summary: string;
  request?: z.ZodType; response: z.ZodType; capability?: string;
  params?: z.ZodObject; query?: z.ZodObject; versioned?: true; public?: true; allowedWhileViewing?: true; devOnly?: true;
  errors?: readonly number[];
}
export const ENDPOINTS: Endpoint[] = [];
/* Registering here is what puts an endpoint into the OpenAPI document and the
   contract tests, so an endpoint cannot exist without being specified. The
   literal type is kept, so the client can tell which options each one needs. */
export function defineEndpoint<const E extends Endpoint>(e: E): E {
  ENDPOINTS.push(e); return e;
}

/* The `:name` segments of a path template, in order. */
export const pathParamNames = (path: string): string[] => [...path.matchAll(/:([A-Za-z]+)/g)].map(m => m[1] ?? '');
