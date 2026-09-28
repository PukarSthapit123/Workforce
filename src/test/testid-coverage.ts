/* Every interactive element on a page carries a unique, well-formed data-testid.
   Scans document.body by default, not just a render container, so content a
   Radix Portal renders outside the container (dialogs, menus, select lists,
   tooltips) is checked too. */
const INTERACTIVE = 'button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="menuitem"], [role="switch"], [role="checkbox"], tbody tr';
const FORM = /^[a-z0-9]+(-[A-Za-z0-9]+)+$/;

export function expectTestIdCoverage(root: HTMLElement = document.body): void {
  const problems: string[] = [];
  const seen = new Map<string, number>();
  root.querySelectorAll<HTMLElement>(INTERACTIVE).forEach(el => {
    /* a Radix trigger forwards the id to its visible element; hidden inputs mirror them */
    if (el.getAttribute('aria-hidden') === 'true' || (el as HTMLInputElement).type === 'hidden') return;
    const id = el.getAttribute('data-testid');
    const label = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('name') || '').trim().slice(0, 40);
    if (!id) { problems.push(`${el.tagName.toLowerCase()} "${label}" has no data-testid`); return; }
    if (!FORM.test(id)) problems.push(`data-testid "${id}" is not in area-element form`);
    seen.set(id, (seen.get(id) ?? 0) + 1);
  });
  root.querySelectorAll<HTMLElement>('[data-testid]').forEach(el => {
    const id = el.getAttribute('data-testid');
    if (id && !el.matches(INTERACTIVE)) seen.set(id, (seen.get(id) ?? 0) + 1);
  });
  seen.forEach((n, id) => { if (n > 1) problems.push(`duplicate data-testid "${id}" (${n} elements)`); });
  if (problems.length) throw new Error('Test id coverage:\n  ' + problems.join('\n  '));
}
