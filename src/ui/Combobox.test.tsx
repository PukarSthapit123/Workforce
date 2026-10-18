import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { Combobox, COMBOBOX_LIMIT, Field, Modal } from '@/ui';
import { expectTestIdCoverage } from '@/test/testid-coverage';

const ROLES = [
  { value: 'consultant', label: 'Consultant' },
  { value: 'senior', label: 'Senior Consultant' },
  { value: 'pm', label: 'Project Manager' },
];

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
  const spy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function scroll(this: Element) { seen.push(this); });
  render(<Combobox testId="co-select" options={many} value="c35" />);
  await userEvent.click(screen.getByTestId('co-select'));
  expect(seen.at(-1)).toBe(screen.getByTestId('co-select-option-c35'));
  seen.length = 0;
  await userEvent.type(screen.getByTestId('co-select-search'), '3');
  expect(seen.at(-1)).toBe(screen.getAllByRole('option')[0]);
  spy.mockRestore();
});

test('a click on the dialog overlay while the list is open does not close the dialog', async () => {
  const onOpenChange = vi.fn();
  render(<Modal open onOpenChange={onOpenChange} title="Edit"><Combobox testId="role-select" options={ROLES} /></Modal>);
  await userEvent.click(screen.getByTestId('role-select'));
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  const overlay = document.querySelector('[data-slot="dialog-overlay"]');
  if (!overlay) throw new Error('no overlay');
  await userEvent.pointer([{ target: overlay }, { keys: '[MouseLeft]', target: overlay }]);
  expect(onOpenChange).not.toHaveBeenCalledWith(false);
});

test('ArrowDown and ArrowUp on the closed trigger open the panel', async () => {
  render(<Combobox testId="role-select" options={ROLES} />);
  screen.getByTestId('role-select').focus();
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByRole('listbox')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  await userEvent.keyboard('{ArrowUp}');
  expect(screen.getByRole('listbox')).toBeInTheDocument();
});

test('the active descendant stays on a shown row when the options shrink while open', async () => {
  const { rerender } = render(<Combobox testId="role-select" options={ROLES} />);
  await userEvent.click(screen.getByTestId('role-select'));
  await userEvent.keyboard('{End}');
  rerender(<Combobox testId="role-select" options={ROLES.slice(0, 1)} />);
  const id = screen.getByTestId('role-select-search').getAttribute('aria-activedescendant');
  expect(id).toBe(screen.getAllByRole('option')[0]?.id);
});

test('Enter during IME composition does not pick', async () => {
  const onValueChange = vi.fn();
  render(<Combobox testId="role-select" options={ROLES} onValueChange={onValueChange} />);
  await userEvent.click(screen.getByTestId('role-select'));
  fireEvent.keyDown(screen.getByTestId('role-select-search'), { key: 'Enter', isComposing: true });
  expect(onValueChange).not.toHaveBeenCalled();
  expect(screen.getByRole('listbox')).toBeInTheDocument();
});

test('the trigger carries the select-trigger slot', () => {
  render(<Combobox testId="role-select" options={ROLES} />);
  expect(screen.getByTestId('role-select')).toHaveAttribute('data-slot', 'select-trigger');
});

test('a disabled option is shown, announced as unavailable and cannot be picked', async () => {
  const onValueChange = vi.fn();
  render(<Combobox testId="t-pick" aria-label="Pick" options={[{ value: 'A', label: 'A' }, { value: 'B', label: 'B, in X', disabled: true }]} onValueChange={onValueChange} />);
  await userEvent.click(screen.getByTestId('t-pick'));
  const b = screen.getByTestId('t-pick-option-B');
  expect(b).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(b);
  await userEvent.keyboard('{Enter}');
  expect(onValueChange).not.toHaveBeenCalled();
});

test('the arrow keys still reach a disabled option, and Enter on it picks nothing', async () => {
  const onValueChange = vi.fn();
  render(<Combobox testId="t-pick" aria-label="Pick" options={[{ value: 'A', label: 'A' }, { value: 'B', label: 'B, in X', disabled: true }]} onValueChange={onValueChange} />);
  await userEvent.click(screen.getByTestId('t-pick'));
  await userEvent.keyboard('{ArrowDown}');
  expect(screen.getByTestId('t-pick-search')).toHaveAttribute('aria-activedescendant', screen.getByTestId('t-pick-option-B').id);
  await userEvent.keyboard('{Enter}');
  expect(onValueChange).not.toHaveBeenCalled();
  expect(screen.getByRole('listbox')).toBeInTheDocument();
});

test('options without the flag are not announced as unavailable', async () => {
  render(<Combobox testId="t-pick" aria-label="Pick" options={ROLES} />);
  await userEvent.click(screen.getByTestId('t-pick'));
  for (const o of screen.getAllByRole('option')) expect(o).not.toHaveAttribute('aria-disabled');
});
