import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ENDPOINTS, Refusal, pathParamNames, type Endpoint } from '../src/contract';

const json = (schema: z.ZodType) => z.toJSONSchema(schema, { unrepresentable: 'any', io: 'input' });
const REFUSAL_REF = { $ref: '#/components/schemas/Refusal' };
const DESCRIPTION: Record<number, string> = {
  401: 'Signed out, or the credentials do not match',
  403: 'The session lacks the capability, or is viewing as someone else and so cannot make changes',
  404: 'The record does not exist',
  409: 'The change is refused because of the state of the data',
  412: 'The record changed since it was read (If-Match is stale)',
  422: 'The request is not valid; field names the part to correct',
  428: 'If-Match is missing',
};

/* The refusal statuses one endpoint can answer, from its definition. */
export function refusalStatuses(e: Endpoint): number[] {
  const out = new Set<number>(e.errors ?? []);
  if (!e.public) out.add(401);
  if (e.capability || (!e.public && e.method !== 'GET' && !e.allowedWhileViewing)) out.add(403);
  if (e.versioned) { out.add(412); out.add(428); }
  if (e.request || e.query || e.params) out.add(422);
  return [...out].sort((a, b) => a - b);
}

function parameters(e: Endpoint) {
  const names = pathParamNames(e.path);
  const declared = Object.keys(e.params?.shape ?? {});
  if (names.join() !== declared.join())
    throw new Error(`${e.method} ${e.path}: the path has parameters [${names.join(', ')}] but params declares [${declared.join(', ')}].`);
  const out: Record<string, unknown>[] = names.map(name => ({ name, in: 'path', required: true, schema: json(e.params?.shape[name] as z.ZodType) }));
  for (const [name, schema] of Object.entries(e.query?.shape ?? {}))
    out.push({ name, in: 'query', required: !(schema as z.ZodType).safeParse(undefined).success, schema: json(schema as z.ZodType) });
  if (e.versioned) out.push({ name: 'If-Match', in: 'header', required: true, description: 'The version the change is based on', schema: { type: 'string', pattern: '^[0-9]+$' } });
  return out;
}

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of [...ENDPOINTS].sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method))) {
    const p = e.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const params = parameters(e);
    const responses: Record<string, unknown> = {
      200: { description: 'OK', content: { 'application/json': { schema: z.toJSONSchema(e.response, { unrepresentable: 'any' }) } } },
    };
    for (const status of refusalStatuses(e)) responses[status] = { description: DESCRIPTION[status] ?? 'Refusal', content: { 'application/json': { schema: REFUSAL_REF } } };
    responses.default = { description: 'Any other refusal or failure', content: { 'application/json': { schema: REFUSAL_REF } } };
    const op: Record<string, unknown> = {
      summary: e.summary,
      security: e.public ? [] : [{ bearer: [] }],
      ...(e.capability ? { 'x-capability': e.capability } : {}),
      ...(params.length ? { parameters: params } : {}),
      ...(e.request ? { requestBody: { required: true, content: { 'application/json': { schema: json(e.request) } } } } : {}),
      responses,
    };
    (paths[p] ??= {})[e.method.toLowerCase()] = op;
  }
  return {
    openapi: '3.1.0', info: { title: 'Qnipay Workforce API (draft, from the fake server)', version: '0.1.0' },
    security: [{ bearer: [] }],
    components: {
      securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'The session token from POST /api/v1/session' } },
      schemas: { Refusal: z.toJSONSchema(Refusal) },
    },
    paths,
  };
}
if (process.argv[1]?.endsWith('openapi.ts')) {
  mkdirSync(resolve(import.meta.dirname, '../contract'), { recursive: true });
  writeFileSync(resolve(import.meta.dirname, '../contract/openapi.json'), JSON.stringify(buildOpenApi(), null, 2) + '\n');
  console.log('contract/openapi.json written:', ENDPOINTS.length, 'endpoints');
}
