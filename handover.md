# Handover: onboarding templates by job profile

Date: 2026-10-18. Branch: `main` (the only branch; commit straight to it, no Claude co-author line).

## Where things stand

**Project A (searchable combobox) is complete** on `main` (commits `7abdf2b`..`f4ed4a8`). It was reviewed task by task, then as a whole, and the one fix wave was re-reviewed clean. Typecheck, lint, unit (153 files, 2393 tests), every e2e spec and build:check pass. No visual baseline moved.

- `src/ui/Combobox.tsx` is a searchable drop-in for `SelectBox` (`searchLabel` names the search box). `SelectFilter` takes `searchable`.
- The panel is a modal popover, so a click outside it inside a dialog closes only the list. It stays inside a phone screen and wraps long labels.
- The line manager on the employee form is chosen from current employees (leavers and archived people are not offered). A saved manager who has since left still shows.

Decisions made on the user's behalf:

- The manager picker lists the employees the caller may see. A manager sees only their own location, so a site manager cannot pick a head-office line manager. Admins can.
- In the closed state, ArrowUp and ArrowDown open the list. There is no typeahead.
- Left as known minor polish: the search input has `role="searchbox"`, and the panel and its list share one accessible name.

**Next: project B's design** (onboarding templates by job profile, below). Start with the open questions, one at a time.

---

Background from before project A started follows.

Earlier, the user was told "onboarding templates based on employee type" had been built. They had not. What exists is a single tenant-wide onboarding setup, and Organisation templates that capture and apply that one setup. Do not repeat that claim.

## What the user asked for

1. **Onboarding templates chosen by the employee's job profile.** A company can have hundreds of job profiles.
2. **Searchable dropdowns** for employee type, job profile and similar fields, instead of long plain selects.
3. **A form creator and editor** for onboarding, without a field-mapping problem.

## Decisions made with the user

- **"Role" means job profile.** That is the `jobProfiles` dimension (Setup › Employees › Dimensions), not employee type and not user type.
- **A template varies steps, documents and policies.** All three can differ per template.
- **Approach (agreed):** a field library, not free-form fields.
  - Admins define each custom field once, on the employee record. Types: text, number, date, yes/no, dropdown and file.
  - The form builder only places fields from that library, so every answer has one known home and nothing needs mapping.
  - This is how BambooHR, Personio, HiBob and Rippling do it.
- **The seven built-in steps keep their fixed shape**, because payroll depends on it. A template can switch them on or off and add **custom steps**. A custom step has a title, an intro, and fields from the library (each required or optional, in a set order).
- **Questions with no field behind them are out of scope.** A possible later addition is a "keep on the onboarding record only" field kind.
- **Build order:** three projects, each with its own spec, plan and implementation.

### A. Searchable combobox (first)

- Build one reusable component with type-to-filter, and keyboard and screen-reader support. Nothing like it exists yet: `ui/Select.tsx` (`SelectBox`) is a Radix select with no search, and `ui/shadcn` has no `command` or `popover`.
- Use it for employee type, job profile, location, department and category on `features/employees/EmployeeForm.tsx`.
- Manager is free text at `EmployeeForm.tsx:123`. It should become a combobox of employees.
- Use it for the long employee pickers too: `features/leave/SicknessPage.tsx:123`, `features/leave/TeamLeaveDialogs.tsx:77`, `features/access/UserExceptions.tsx:71`, `features/dimensions/DimensionForm.tsx:59` and `features/rota/Dialogs.tsx:75,151`.

### B. Onboarding templates by job profile

- Each template has steps, documents and policies, plus a searchable multi-select of job profiles.
- Each job profile can belong to only one template.
- Today's tenant-wide setup becomes the **default template**, used for any job profile not assigned elsewhere.
- Organisation templates must capture and apply onboarding templates.

### C. Custom field library and form builder

- A Custom fields page under Setup › Employees.
- Custom fields show on the employee profile.
- Removing a field that is in use is refused, with `usedBy` naming where it is used (the same pattern as custom onboarding documents, D2).
- Custom steps in templates use the library fields.
- Organisation templates capture the fields and the custom steps.

### Open questions for B (ask the user, one at a time)

- When a starter's job profile changes mid-onboarding, do they switch template? Suggestion: before submission, what is asked follows the current template; after submission, the recorded `asked` holds.
- Is the template frozen when the case is created, or followed live? The current code judges against today's config before submission (`askedOf`).
- Do policies stay tenant-wide rows that each template picks from? Suggestion: yes. Templates reference policy ids, so one policy version re-ask still works.
- Who can edit templates? Suggestion: the existing Configure onboarding (`onb_cfg`) capability.

## Process to follow

Use the superpowers brainstorming flow on the **architectural** path:

1. Clarifying questions, one at a time.
2. Present the design in sections and get approval on each.
3. Write the spec to `docs/specs/YYYY-MM-DD-<topic>-design.md` and commit it.
4. The user reviews the spec.
5. Use writing-plans to write the plan to `docs/plans/`.
6. Execute.

Project A is small enough that its spec can be short. Still get the user's approval before writing code.

Project rules are in `.superpowers/` (gitignored, local only):

- `roadmap.md`
- `sdd/ui-fidelity-audit.md`. The UI must match the v15 mockup. The new screens have no mockup, so match the existing setup pages' look.

No AI traces in app copy: no process ids, no prototype references, no "in this build" wording. Do not use em dashes in sentences.

Run all checks with `npm run verify` (typecheck, lint, vitest, playwright, build check).

## Map of the current code (paths under `src/`)

**Job profile**
- Shape `{code, name, night}`: `contract/dimensions.ts:14`.
- Seeded in `mocks/seed/qnipay.json` under `data.jobProfiles`: 4 entries (CONS, SCONS, PM, ADM).
- Managed in `features/dimensions/DimensionsPage.tsx` and `features/dimensions/DimensionForm.tsx`.

**Employee type**
- Shape `{code, name, category, mode, uom, capabilities[]}`: `contract/employee-types.ts:11`.
- Seeded: `salaried` and `hourly`.
- Managed in `features/employee-types/`.

**Onboarding config**
- `OnboardingConfigRecord = RecordMeta + {steps, documents}`: `contract/onboarding.ts:38`.
- Policies are separate versioned rows (`OnbPolicyRecord`, `:41`).
- Seeded in `data.onboardingConfig` (one record) and `data.onboardingPolicies` (4).

**What a starter is asked**
- `stepsAsked` and `docsAsked`: `domain/onboarding.ts:78,81`.
- `askedNow` and `askedOf`: `:383,394`.
- `blockers`, `readyToStart` and `progress`: `:409-426`.
- `policyAcknowledged`: `:510`.
- These are the functions that must take a template instead of the tenant config.

**Writes**
- `mocks/onboarding.ts:354-491`. Every write follows the same sequence: If-Match `checkVersion`, then `configProblem`, then `bump`, then one `writeAudit` row.
- Endpoints: `contract/onboarding.ts:248-271`.

**Setup UI**
- `features/onboarding/OnboardingSetupPage.tsx`
- `features/onboarding/OnbSetupDocuments.tsx`
- `features/onboarding/OnbSetupPolicies.tsx`

**Organisation templates**
- `TemplateOnboarding`: `domain/templates.ts:87-91`.
- `captureOnboarding`: `:289`.
- `planApply` and `planOnboarding`: `:493,700`.
- `readTemplateFile`: `:344`.
- Mock side: `mocks/templates.ts`. `onboardingNow` is at `:106`; `carryOut` is at `:146`, with onboarding at `:200-204`.

**Also update when the contract changes**
- `contract/openapi.json` (`npm run openapi`)
- `scripts/extract-seed.mjs`
- `e2e/trace.json`
- the visual baselines
