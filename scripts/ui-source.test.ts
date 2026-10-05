// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';

/* Rules from the prototype suite that are about the source as a whole, not
   one screen: each test names the suite rows it ports. */
const SRC = resolve(__dirname, '../src');
const files = (dir: string): string[] => readdirSync(dir).flatMap(f => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? files(p) : [p];
});
const product = files(SRC).filter(f => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f) && !f.includes(`${join('src', 'test')}`));
const rel = (f: string) => relative(resolve(__dirname, '..'), f).replace(/\\/g, '/');

/* REVIEW RUN: "Native title only on disabled controls". A native tooltip
   cannot be reached by touch or keyboard, so the only place it is used is the
   prototype's: saying why a control is disabled (v15's title="" attributes all
   sit on disabled buttons). Explanations go in a Tip or the accessible name.
   The one exception is the role pill, which carries who you are looking at
   the app as on hover, as the prototype sets it (v15:10606), beside the
   banner that says it in words. */
const TITLED = new Set(['Button', 'NavLink']);
const EXEMPT = [{ file: 'src/shell/Shell.tsx', testId: 'tid.shell.rolePill' }];
test('a native title is only ever on a control that can be disabled, saying why it is', () => {
  const bad: string[] = [];
  for (const f of product.filter(x => x.endsWith('.tsx'))) {
    const text = readFileSync(f, 'utf8');
    const sf = ts.createSourceFile(f, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (n: ts.Node) => {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const tag = n.tagName.getText(sf);
        const attrs = n.attributes.properties.filter(ts.isJsxAttribute);
        const named = (a: string) => attrs.find(x => x.name.getText(sf) === a);
        if ((/^[a-z]/.test(tag) || TITLED.has(tag)) && named('title') && !named('disabled')) {
          const testId = named('data-testid')?.initializer?.getText(sf) ?? named('testId')?.initializer?.getText(sf) ?? '';
          if (!EXEMPT.some(e => e.file === rel(f) && testId.includes(e.testId)))
            bad.push(`${rel(f)}:${sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1} <${tag}>`);
        }
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
  }
  expect(bad).toEqual([]);
});

/* MOBILE FOUNDATION: "One helper decides what counts as a phone". Only
   useNarrow asks the browser about the phone breakpoint; anything that only
   restyles uses max-md:. */
test('one helper decides what counts as a phone', () => {
  const asking = product.filter(f => /matchMedia\s*\(/.test(readFileSync(f, 'utf8'))).map(rel);
  expect(asking).toEqual(['src/ui/useNarrow.ts']);
  expect(readFileSync(resolve(SRC, 'ui/useNarrow.ts'), 'utf8')).toContain("'(max-width: 767px)'");
});

/* HEADER PILLS REMOVED: "The \"applies immediately\" pill is gone from page
   headers" and "It is gone from every admin page, not just this one". */
test('no page carries an "Applies immediately" pill', () => {
  expect(product.filter(f => /Applies immediately/i.test(readFileSync(f, 'utf8'))).map(rel)).toEqual([]);
});
