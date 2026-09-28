import { z } from 'zod';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ENDPOINTS } from '@/contract';
import { buildOpenApi } from '../../scripts/openapi';

/* camelCase is split into words first, so budgetAmount and hourlyRateValue are caught
   while payCode, netHours and rateType are not */
const words = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').toLowerCase();
const MONEY = /\b(amount|price|salary|wage|gross pay|net pay|rate value)\b/;
const CURRENCY = /[£$€]/;
const allow: Record<string, string> = JSON.parse(readFileSync(resolve(__dirname, '../../contract/money-lint.allow.json'), 'utf8'));

/* A currency symbol can turn up as a `default`, a `const` (from z.literal), a member of an
   `enum` (from z.enum) or an `examples` array — check every value a JSON Schema node can carry,
   not just the property itself. */
function hasCurrency(value: unknown): boolean {
  if (typeof value === 'string') return CURRENCY.test(value);
  if (Array.isArray(value)) return value.some(hasCurrency);
  return false;
}

function walk(schema: unknown, path: string, out: string[]) {
  const js = z.toJSONSchema(schema as z.ZodType, { unrepresentable: 'any' }) as Record<string, unknown>;
  const visit = (node: unknown, p: string) => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.properties) for (const [key, v] of Object.entries(n.properties as object)) {
      const full = `${p}.${key}`;
      if (MONEY.test(words(key)) && !allow[full]) out.push(full);
      const vv = v as { default?: unknown; const?: unknown; enum?: unknown; examples?: unknown };
      if (hasCurrency(vv.default)) out.push(full + ' (currency default)');
      if (hasCurrency(vv.const)) out.push(full + ' (currency const)');
      if (hasCurrency(vv.enum)) out.push(full + ' (currency enum)');
      if (hasCurrency(vv.examples)) out.push(full + ' (currency examples)');
      visit(v, full);
    }
    for (const k of ['items', 'anyOf', 'oneOf', 'allOf']) {
      const c = n[k]; if (Array.isArray(c)) c.forEach((x, i) => visit(x, `${p}[${i}]`)); else if (c) visit(c, p + '[]');
    }
  };
  visit(js, path);
}

test('the money lint reads camelCase as words', () => {
  expect(MONEY.test(words('budgetAmount'))).toBe(true);
  expect(MONEY.test(words('hourlyRateValue'))).toBe(true);
  expect(['payCode', 'netHours', 'rateType', 'costCentre'].some(k => MONEY.test(words(k)))).toBe(false);
});
test('the walker flags a currency symbol in const or enum, not just default', () => {
  const constHits: string[] = [];
  walk(z.object({ note: z.literal('£5') }), 'schema', constHits);
  expect(constHits).toContain('schema.note (currency const)');

  const enumHits: string[] = [];
  walk(z.object({ symbol: z.enum(['$']) }), 'schema', enumHits);
  expect(enumHits).toContain('schema.symbol (currency enum)');

  const defaultHits: string[] = [];
  walk(z.object({ label: z.string().default('€10') }), 'schema', defaultHits);
  expect(defaultHits).toContain('schema.label (currency default)');

  const clean: string[] = [];
  walk(z.object({ payCode: z.string().default('A'), rateType: z.enum(['hourly', 'fixed']) }), 'schema', clean);
  expect(clean).toEqual([]);
});
test('no schema carries money', () => {
  const hits: string[] = [];
  for (const ep of ENDPOINTS) {
    if (ep.request) walk(ep.request, `${ep.method} ${ep.path} request`, hits);
    walk(ep.response, `${ep.method} ${ep.path} response`, hits);
  }
  expect(hits).toEqual([]);
});

test('every endpoint path is under /api/v1 and unique by method', () => {
  const keys = ENDPOINTS.map(e => `${e.method} ${e.path}`);
  expect(keys.every(k => / \/api\/v1\//.test(k))).toBe(true);
  expect(new Set(keys).size).toBe(keys.length);
});

test('the committed OpenAPI file matches the contract', () => {
  const committed = JSON.parse(readFileSync(resolve(__dirname, '../../contract/openapi.json'), 'utf8'));
  expect(buildOpenApi()).toEqual(committed);
});

/* I9: the document must be structurally sound, not just match the snapshot. */
describe('the OpenAPI document is structurally valid 3.1', () => {
  const doc = buildOpenApi() as unknown as {
    openapi: string; info: { title: string; version: string }; components: { securitySchemes: Record<string, unknown>; schemas: Record<string, unknown> };
    paths: Record<string, Record<string, { summary: string; security: Record<string, unknown>[]; parameters?: { name: string; in: string; required?: boolean; schema?: unknown }[];
      responses: Record<string, { description?: string; content?: Record<string, { schema?: { $ref?: string } }> }> }>>;
  };
  const ops = Object.entries(doc.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method, op })));

  test('it declares its version, info and the bearer scheme', () => {
    expect(doc.openapi).toBe('3.1.0');
    expect(doc.info.title && doc.info.version).toBeTruthy();
    expect(doc.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' });
  });
  test('every {param} in a path is declared as a required path parameter, and nothing else is', () => {
    const problems: string[] = [];
    for (const { path, method, op } of ops) {
      const inPath = [...path.matchAll(/\{([^}]+)\}/g)].map(m => m[1]);
      const declared = (op.parameters ?? []).filter(p => p.in === 'path');
      for (const name of inPath) if (!declared.some(p => p.name === name && p.required === true && p.schema)) problems.push(`${method} ${path}: {${name}} is not declared`);
      for (const p of declared) if (!inPath.includes(p.name)) problems.push(`${method} ${path}: ${p.name} is declared but not in the path`);
    }
    expect(problems).toEqual([]);
  });
  test('every operation has a summary, a security requirement and described responses whose refs resolve', () => {
    const problems: string[] = [];
    for (const { path, method, op } of ops) {
      if (!op.summary) problems.push(`${method} ${path}: no summary`);
      if (!Array.isArray(op.security)) problems.push(`${method} ${path}: no security`);
      for (const req of op.security ?? []) for (const k of Object.keys(req)) if (!doc.components.securitySchemes[k]) problems.push(`${method} ${path}: unknown scheme ${k}`);
      if (!op.responses['200']) problems.push(`${method} ${path}: no 200`);
      for (const [status, r] of Object.entries(op.responses)) {
        if (!r.description) problems.push(`${method} ${path} ${status}: no description`);
        const ref = r.content?.['application/json']?.schema?.$ref;
        if (ref && !doc.components.schemas[ref.replace('#/components/schemas/', '')]) problems.push(`${method} ${path} ${status}: ${ref} does not resolve`);
      }
    }
    expect(problems).toEqual([]);
  });
  test('versioned writes declare If-Match and answer 412 and 428; capability endpoints answer 403', () => {
    for (const e of ENDPOINTS.filter(x => !x.devOnly)) {
      const op = doc.paths[e.path.replace(/:([A-Za-z]+)/g, '{$1}')]?.[e.method.toLowerCase()];
      if (!op) throw new Error(`${e.method} ${e.path} is missing from the document`);
      if (e.versioned) {
        expect(op.parameters?.some(p => p.name === 'If-Match' && p.in === 'header' && p.required), `${e.method} ${e.path}`).toBe(true);
        expect(Object.keys(op.responses)).toEqual(expect.arrayContaining(['412', '428']));
      }
      if (e.capability) expect(Object.keys(op.responses), `${e.method} ${e.path}`).toContain('403');
      if (!e.public) expect(op.security).toEqual([{ bearer: [] }]);
    }
  });
  /* M9: the demo account list is the fake server's own, so it is not part
     of the production contract. */
  test('a devOnly endpoint, the demo account list among them, is left out of the document', () => {
    const devOnly = ENDPOINTS.filter(e => e.devOnly);
    expect(devOnly.map(e => `${e.method} ${e.path}`)).toContain('GET /api/v1/session/accounts');
    for (const e of devOnly) expect(doc.paths[e.path.replace(/:([A-Za-z]+)/g, '{$1}')]?.[e.method.toLowerCase()], `${e.method} ${e.path}`).toBeUndefined();
  });
  test('If-Match is documented as a bare whole number', () => {
    const op = doc.paths['/api/v1/user-types/{id}/capabilities/{capability}']?.put;
    expect(op?.parameters?.find(p => p.name === 'If-Match')).toMatchObject({ in: 'header', required: true, schema: { type: 'string', pattern: '^[0-9]+$' } });
  });
  test('the audit query is described, limit included', () => {
    const op = doc.paths['/api/v1/audit']?.get;
    expect(op?.parameters?.filter(p => p.in === 'query').map(p => p.name)).toEqual(['entity', 'who', 'q', 'limit']);
  });
});
