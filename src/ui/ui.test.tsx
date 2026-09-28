import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Field, TextInput, Pill, SelectBox, CheckboxField, SwitchField, Modal, ConfirmModal, Tip, HelpButton, Caution } from '@/ui';
import { expectTestIdCoverage } from '@/test/testid-coverage';

test('Button renders its test id', () => {
  render(<Button testId="people-add">Add someone</Button>);
  expect(screen.getByTestId('people-add')).toHaveTextContent('Add someone');
});
test('Field wires label, hint and error to the control, and takes its test ids from the control', () => {
  render(<Field label="Email" hint="Used to sign in" error="Already used by Amara Okafor" tip="The address they sign in with.">
    <TextInput testId="person-form-email-input" /></Field>);
  expect(screen.getByTestId('person-form-email-input-field')).toBeInTheDocument();
  expect(screen.getByTestId('person-form-email-input-field-tip')).toBeInTheDocument();
  const input = screen.getByTestId('person-form-email-input');
  expect(input).toHaveAccessibleName('Email');
  expect(input).toHaveAccessibleDescription(/Already used by Amara Okafor/);
  expect(input).toHaveAttribute('aria-invalid', 'true');
});
test('Pill carries its tone', () => {
  render(<Pill testId="state-pill" tone="ok">Active</Pill>);
  expect(screen.getByTestId('state-pill')).toHaveAttribute('data-tone', 'ok');
});
test('SelectBox wires the trigger and each option to a test id', async () => {
  render(<SelectBox testId="role-select" options={[{ value: 'lead', label: 'Team lead' }, { value: 'agent', label: 'Agent' }]} />);
  expect(screen.getByTestId('role-select')).toBeInTheDocument();
  await userEvent.click(screen.getByTestId('role-select'));
  expect(screen.getByTestId('role-select-option-lead')).toHaveTextContent('Team lead');
  expectTestIdCoverage();
});
test('CheckboxField and SwitchField carry their test id and pass coverage', () => {
  render(<div><CheckboxField testId="notify-checkbox" /><SwitchField testId="notify-switch" /></div>);
  expect(screen.getByTestId('notify-checkbox')).toBeInTheDocument();
  expect(screen.getByTestId('notify-switch')).toBeInTheDocument();
  expectTestIdCoverage();
});
test('Modal renders its title and a labelled close control', () => {
  render(<Modal open onOpenChange={() => {}} title="Edit person" />);
  expect(screen.getByTestId('modal')).toBeInTheDocument();
  expect(screen.getByTestId('modal-title')).toHaveTextContent('Edit person');
  expect(screen.getByTestId('modal-close')).toBeInTheDocument();
  expectTestIdCoverage();
});
test('ConfirmModal wires confirm and cancel to the registry ids', () => {
  render(<ConfirmModal open onOpenChange={() => {}} title="Remove person" body="This cannot be undone." confirmLabel="Remove" onConfirm={() => {}} />);
  expect(screen.getByTestId('modal-confirm')).toHaveTextContent('Remove');
  expect(screen.getByTestId('modal-cancel')).toHaveTextContent('Keep it as it is');
});
test('Tip, HelpButton and Caution render with their test ids', () => {
  const onOpen = () => {};
  render(<div><Tip testId="field-tip" text="Used to sign in." /><HelpButton testId="page-help" label="Open the guide" onOpen={onOpen} /><Caution testId="area-caution" text="Changes here affect everyone." /></div>);
  expect(screen.getByTestId('field-tip')).toHaveAttribute('aria-label', 'More information');
  expect(screen.getByTestId('page-help')).toHaveAttribute('aria-label', 'Open the guide');
  expect(screen.getByTestId('area-caution')).toHaveTextContent('Changes here affect everyone.');
});
/* TOOLTIPS: "Trigger exposes its text to assistive tech". The aria-label only
   ever says "More information" (what the control is), never the tip's own
   text (what it says); Radix only puts the tooltip bubble itself in the
   accessibility tree while it is open. This checks the tip's text is
   reachable via aria-describedby regardless of open state, not merely that a
   generic label exists. */
test('Tip exposes its own text to assistive tech via aria-describedby, not just a generic label', () => {
  render(<Tip testId="field-tip" text="Used to sign in." />);
  const trigger = screen.getByTestId('field-tip');
  const describedBy = trigger.getAttribute('aria-describedby');
  expect(describedBy).toBeTruthy();
  expect(document.getElementById(describedBy ?? '')).toHaveTextContent('Used to sign in.');
});

/* AFFORDANCE CONVENTION: "warning is a standing caution ... not a modal" /
   "... and clicking it opens nothing". Its sign comes from the icon set. */
test('Caution is a standing note, not a button, and clicking it opens nothing', async () => {
  render(<Caution testId="area-caution" text="Changes here affect everyone." />);
  const c = screen.getByTestId('area-caution');
  expect(c.tagName).not.toBe('BUTTON');
  expect(c).toHaveAttribute('role', 'note');
  expect(c.querySelector('svg')).not.toBeNull();
  expect(/\p{Extended_Pictographic}/u.test(c.textContent ?? '')).toBe(false);
  await userEvent.click(c);
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
});

/* TOOLTIP APPEARANCE: the bubble keeps the inverse-surface styling, with light text. */
test('the tooltip bubble uses the inverse surface with light text', async () => {
  render(<Tip testId="field-tip" text="Used to sign in." />);
  await userEvent.tab(); // focus opens it at once; hover waits out the delay
  expect(screen.getByTestId('field-tip')).toHaveFocus();
  await waitFor(() => expect(document.querySelector('[data-slot="tooltip-content"]')).not.toBeNull());
  const bubble = document.querySelector('[data-slot="tooltip-content"]');
  expect(bubble).toHaveTextContent('Used to sign in.');
  expect(bubble?.className).toMatch(/\bbg-surface-inverse\b/);
  expect(bubble?.className).toMatch(/\btext-text-on-brand\b/);
});

/* AFFORDANCE CONVENTION: "No i tooltip is guide-length". */
test('a guide-length tip is flagged in development, a short one is not', () => {
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  render(<Tip testId="short-tip" text="Used to sign in." />);
  expect(warn).not.toHaveBeenCalled();
  render(<Tip testId="long-tip" text={'x'.repeat(171)} />);
  expect(warn).toHaveBeenCalledWith(expect.stringContaining('long-tip'));
  warn.mockRestore();
});
