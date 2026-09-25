import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { z } from 'zod';
import { ENDPOINTS, Refusal } from '../src/contract';

export function buildOpenApi() {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const e of [...ENDPOINTS].sort((a, b) => (a.path + a.method).localeCompare(b.path + b.method))) {
    const p = e.path.replace(/:([A-Za-z]+)/g, '{$1}');
    const op: Record<string, unknown> = {
      summary: e.summary,
      ...(e.capability ? { 'x-capability': e.capability } : {}),
      responses: {
        200: { description: 'OK', content: { 'application/json': { schema: z.toJSONSchema(e.response, { unrepresentable: 'any' }) } } },
        default: { description: 'Refusal', content: { 'application/json': { schema: z.toJSONSchema(Refusal) } } },
      },
    };
    if (e.request) op.requestBody = { content: { 'application/json': { schema: z.toJSONSchema(e.request, { unrepresentable: 'any' }) } } };
    (paths[p] ??= {})[e.method.toLowerCase()] = op;
  }
  return { openapi: '3.1.0', info: { title: 'Qnipay Workforce API (draft, from the fake server)', version: '0.1.0' }, paths };
}
if (process.argv[1]?.endsWith('openapi.ts')) {
  mkdirSync(resolve(import.meta.dirname, '../contract'), { recursive: true });
  writeFileSync(resolve(import.meta.dirname, '../contract/openapi.json'), JSON.stringify(buildOpenApi(), null, 2) + '\n');
  console.log('contract/openapi.json written:', ENDPOINTS.length, 'endpoints');
}
