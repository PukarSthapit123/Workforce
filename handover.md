# Handover: onboarding templates by job profile

Date: 2026-10-18. Branch: `main` (the only branch; commit straight to it, no Claude co-author line).

## Where things stand

**Project A (searchable combobox) is complete** on `main` (`7abdf2b`..`f4ed4a8`). `src/ui/Combobox.tsx` is a searchable drop-in for `SelectBox`; `SelectFilter` takes `searchable`. The line manager is chosen from current employees.

**Project B (onboarding templates by job profile) is complete** on `main` (`4471d90`..`943c991`). It was reviewed task by task, then as a whole, and the fix wave was re-reviewed clean. Typecheck, lint, unit (156 files, 2494 tests), every e2e spec and build:check pass. Nothing is pushed.

- Setup › Onboarding setup has a template picker (`?template=<id>`), New template (copied from Default or another template), an Applies to card (job profiles, rename, delete), and per-template steps, documents (Asked, Required, Blocks start) and policies (Asked).
- Today's setup is the Default template. A job profile belongs to at most one template; everyone else gets Default.
- Until a starter submits, they follow their current template live (profile changes and template edits reach them). After submission the recorded `asked` holds.
- Team onboarding shows each starter's template. A job profile a template lists cannot be removed from Dimensions. Organisation templates capture and apply onboarding templates.
- Domain: `src/domain/onboarding-templates.ts`. Mock: `src/mocks/onboarding-templates.ts`, `resolvedFor` in `src/mocks/onboarding-cases.ts`. Design: `docs/specs/2026-10-18-onboarding-templates-design.md` (local only).

Decisions made on the user's behalf for B:

- New documents join every template switched off; new policies join only the Default.
- Verified by, Expiry tracked, and adding, renaming or removing documents happen on Default only.
- Applying an organisation template: a job profile missing in the target is skipped with a warning; one held by another template moves. The file's Default policy choices apply only to policies the file knows; held policies it lacks keep their Default status.
- Policy Add and Remove wait while the setup page has unsaved changes.

Known gaps left as they are: browser Back and Forward can drop an unsaved template draft; Team onboarding shows a Template column reading "Default" even with no templates.

**Project C (custom field library and form builder) is PARKED** by the user (2026-10-18). Do not start it until they say so.

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
