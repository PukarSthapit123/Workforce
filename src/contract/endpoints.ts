import type { z } from 'zod';

export type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
export interface Endpoint<Req extends z.ZodType | undefined = z.ZodType | undefined, Res extends z.ZodType = z.ZodType> {
  method: Method; path: `/api/v1/${string}`; request?: Req; response: Res; capability?: string; summary: string;
}
export const ENDPOINTS: Endpoint[] = [];
/* Registering here is what puts an endpoint into the OpenAPI document and the
   contract tests, so an endpoint cannot exist without being specified. */
export function defineEndpoint<Req extends z.ZodType | undefined, Res extends z.ZodType>(e: Endpoint<Req, Res>) {
  ENDPOINTS.push(e as unknown as Endpoint); return e;
}
