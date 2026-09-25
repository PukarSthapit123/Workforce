import { render } from '@testing-library/react';
import { expectTestIdCoverage } from './testid-coverage';

test('passes when every interactive element has a unique test id', () => {
  const { container } = render(<div><button data-testid="a-b">x</button><input data-testid="a-c" /></div>);
  expect(() => expectTestIdCoverage(container)).not.toThrow();
});
test('fails on a button with no test id, naming it', () => {
  const { container } = render(<div><button>Save</button></div>);
  expect(() => expectTestIdCoverage(container)).toThrow(/button "Save" has no data-testid/);
});
test('fails on a duplicate test id', () => {
  const { container } = render(<div><button data-testid="x-y">1</button><a href="#" data-testid="x-y">2</a></div>);
  expect(() => expectTestIdCoverage(container)).toThrow(/duplicate data-testid "x-y"/);
});
test('fails on a test id that is not kebab-case area-element', () => {
  const { container } = render(<button data-testid="Save Button">x</button>);
  expect(() => expectTestIdCoverage(container)).toThrow(/not in area-element form/);
});
