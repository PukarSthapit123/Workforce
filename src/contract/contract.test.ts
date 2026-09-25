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
