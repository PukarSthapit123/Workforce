import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button, Field, TextInput, Pill, SelectBox, CheckboxField, SwitchField, Modal, ConfirmModal, Tip, HelpButton, Caution } from '@/ui';
import { expectTestIdCoverage } from '@/test/testid-coverage';

test('Button renders its test id', () => {
  render(<Button testId="people-add">Add someone</Button>);
  expect(screen.getByTestId('people-add')).toHaveTextContent('Add someone');
});
test('Field wires label, hint and error to the control', () => {
  render(<Field testId="person-form-email" label="Email" hint="Used to sign in" error="Already used by Amara Okafor">
    <TextInput testId="person-form-email-input" /></Field>);
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
  const { container } = render(<SelectBox testId="role-select" options={[{ value: 'lead', label: 'Team lead' }, { value: 'agent', label: 'Agent' }]} />);
  expect(screen.getByTestId('role-select')).toBeInTheDocument();
  await userEvent.click(screen.getByTestId('role-select'));
  expect(screen.getByTestId('role-select-option-lead')).toHaveTextContent('Team lead');
  expectTestIdCoverage(container);
});
test('CheckboxField and SwitchField carry their test id and pass coverage', () => {
  const { container } = render(<div><CheckboxField testId="notify-checkbox" /><SwitchField testId="notify-switch" /></div>);
  expect(screen.getByTestId('notify-checkbox')).toBeInTheDocument();
  expect(screen.getByTestId('notify-switch')).toBeInTheDocument();
  expectTestIdCoverage(container);
});
test('Modal renders its title and a labelled close control', () => {
  const { container } = render(<Modal open onOpenChange={() => {}} title="Edit person" />);
  expect(screen.getByTestId('modal')).toBeInTheDocument();
  expect(screen.getByTestId('modal-title')).toHaveTextContent('Edit person');
  expect(screen.getByTestId('modal-close')).toBeInTheDocument();
  expectTestIdCoverage(container);
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
