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

function walk(schema: unknown, path: string, out: string[]) {
  const js = z.toJSONSchema(schema as z.ZodType, { unrepresentable: 'any' }) as Record<string, unknown>;
  const visit = (node: unknown, p: string) => {
    if (!node || typeof node !== 'object') return;
    const n = node as Record<string, unknown>;
    if (n.properties) for (const [key, v] of Object.entries(n.properties as object)) {
      const full = `${p}.${key}`;
      if (MONEY.test(words(key)) && !allow[full]) out.push(full);
      if (typeof (v as { default?: unknown }).default === 'string' && CURRENCY.test((v as { default: string }).default)) out.push(full + ' (currency default)');
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
