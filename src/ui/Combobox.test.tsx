import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Combobox, COMBOBOX_LIMIT, Field } from '@/ui';
import { expectTestIdCoverage } from '@/test/testid-coverage';

const ROLES = [
  { value: 'consultant', label: 'Consultant' },
  { value: 'senior', label: 'Senior Consultant' },
  { value: 'pm', label: 'Project Manager' },
];

beforeAll(() => {
  /* jsdom has no layout, so it lacks scrollIntoView */
  Element.prototype.scrollIntoView = vi.fn();
});

test('shows the placeholder, then the selected label', () => {
  const { rerender } = render(<Combobox testId="role-select" options={ROLES} placeholder="Pick a role" />);
  expect(screen.getByTestId('role-select')).toHaveTextContent('Pick a role');
  rerender(<Combobox testId="role-select" options={ROLES} value="pm" placeholder="Pick a role" />);
  expect(screen.getByTestId('role-select')).toHaveTextContent('Project Manager');
});

test('a value that matches no option shows the raw value', () => {
  render(<Combobox testId="role-select" options={ROLES} value="legacy-code" />);
  expect(screen.getByTestId('role-select')).toHaveTextContent('legacy-code');
});

test('opening the panel focuses the search input', async () => {
  render(<Combobox testId="role-select" options={ROLES} />);
  await userEvent.click(screen.getByTestId('role-select'));
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  expect(screen.getByTestId('role-select-search')).toHaveFocus();
  expect(screen.getByTestId('role-select')).toHaveAttribute('aria-expanded', 'true');
});

test('typing filters on label or value, ignoring case', async () => {
  render(<Combobox testId="role-select" options={ROLES} />);
  await userEvent.click(screen.getByTestId('role-select'));
  await userEvent.type(screen.getByTestId('role-select-search'), ' CONS ');
  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Consultant', 'Senior Consultant']);
  await userEvent.clear(screen.getByTestId('role-select-search'));
  await userEvent.type(screen.getByTestId('role-select-search'), 'pm');
  expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual(['Project Manager']);
});

test('caps the list at the limit and says how many matched', async () => {
  const many = Array.from({ length: 120 }, (_, i) => ({ value: `c${i}`, label: `Company ${i}` }));
  render(<Combobox testId="co-select" options={many} />);
  await userEvent.click(screen.getByTestId('co-select'));
  expect(COMBOBOX_LIMIT).toBe(50);
  expect(screen.getAllByRole('option')).toHaveLength(50);
  expect(screen.getByText('Showing 50 of 120. Type to narrow down.')).toBeInTheDocument();
});

test('a query with no match says so', async () => {
  render(<Combobox testId="role-select" options={ROLES} />);
  await userEvent.click(screen.getByTestId('role-select'));
  await userEvent.type(screen.getByTestId('role-select-search'), 'zzz');
  expect(screen.queryAllByRole('option')).toHaveLength(0);
  expect(screen.getByText('No matches')).toBeInTheDocument();
});

test('arrow keys move, Enter picks, Escape closes without picking', async () => {
  const onValueChange = vi.fn();
  render(<Combobox testId="role-select" options={ROLES} onValueChange={onValueChange} />);
  await userEvent.click(screen.getByTestId('role-select'));
  await userEvent.keyboard('{ArrowDown}{Enter}');
  expect(onValueChange).toHaveBeenCalledWith('senior');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(screen.getByTestId('role-select')).toHaveFocus();

  onValueChange.mockClear();
  await userEvent.click(screen.getByTestId('role-select'));
  await userEvent.keyboard('{Escape}');
  expect(onValueChange).not.toHaveBeenCalled();
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  expect(screen.getByTestId('role-select')).toHaveFocus();
});

test('arrows wrap and Home and End jump', async () => {
  const onValueChange = vi.fn();
  render(<Combobox testId="role-select" options={ROLES} onValueChange={onValueChange} />);
  await userEvent.click(screen.getByTestId('role-select'));
  await userEvent.keyboard('{ArrowUp}{Enter}');
  expect(onValueChange).toHaveBeenLastCalledWith('pm');
  await userEvent.click(screen.getByTestId('role-select'));
  await userEvent.keyboard('{End}{Home}{Enter}');
  expect(onValueChange).toHaveBeenLastCalledWith('consultant');
});

test('clicking an option picks it', async () => {
  const onValueChange = vi.fn();
  render(<Combobox testId="role-select" options={ROLES} onValueChange={onValueChange} />);
  await userEvent.click(screen.getByTestId('role-select'));
  await userEvent.click(screen.getByTestId('role-select-option-pm'));
  expect(onValueChange).toHaveBeenCalledWith('pm');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('inside a Field the label, hint and required state reach the trigger', () => {
  render(<Field label="Job title" hint="Shown on payslips" required>
    <Combobox testId="role-select" options={ROLES} /></Field>);
  const trigger = screen.getByLabelText('Job title');
  expect(trigger).toBe(screen.getByTestId('role-select'));
  expect(trigger).toHaveAttribute('aria-describedby');
  expect(trigger).toHaveAttribute('aria-required', 'true');
});

test('a disabled combobox does not open', async () => {
  render(<Combobox testId="role-select" options={ROLES} disabled />);
  await userEvent.click(screen.getByTestId('role-select'));
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
});

test('posts the value under its name', () => {
  const { container } = render(<Combobox testId="role-select" options={ROLES} value="pm" name="role" />);
  expect(container.querySelector('input[name="role"]')).toHaveValue('pm');
});

test('passes test id coverage with the panel open', async () => {
  render(<Combobox testId="role-select" options={ROLES} value="pm" name="role" />);
  await userEvent.click(screen.getByTestId('role-select'));
  expectTestIdCoverage();
});

test('scrolls the active option into view on open and when a query moves it', async () => {
  const many = Array.from({ length: 40 }, (_, i) => ({ value: `c${i}`, label: `Company ${i}` }));
  const seen: unknown[] = [];
  Element.prototype.scrollIntoView = function scroll(this: Element) { seen.push(this); };
  render(<Combobox testId="co-select" options={many} value="c35" />);
  await userEvent.click(screen.getByTestId('co-select'));
  expect(seen.at(-1)).toBe(screen.getByTestId('co-select-option-c35'));
  seen.length = 0;
  await userEvent.type(screen.getByTestId('co-select-search'), '3');
  expect(seen.at(-1)).toBe(screen.getAllByRole('option')[0]);
});
