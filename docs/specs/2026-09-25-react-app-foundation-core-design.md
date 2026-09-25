# React app, sub-project 1: Foundation and Workforce core — design

Date: 25/09/2026
Status: design agreed in conversation, awaiting spec review
Reference implementation: `../Qnipay workforce cc/mockup/qnipay-workforce-v15.html` and its suite `qnipay-regression-suite.js` beside it (paths relative to this repository root)

## 1. Purpose

Rebuild Qnipay Workforce as a React application, in stages. The first stages run
against a fake API that behaves like the future real one. Production replaces the
fake one endpoint at a time, so the application code does not change at the swap.

This document covers sub-project 1 only: the foundation every module stands on,
and the Workforce core that every module reads.

## 2. Decisions taken

| Question | Decision |
|---|---|
| What the React app is | A port first, then production. The UI is built against a fake data layer shaped like the future API, and the fake is swapped for the real API module by module. |
| UI foundation | shadcn/ui on Radix, themed with the existing `--qp` tokens. It matches the Dogma HIG, which is itself shadcn/Radix, and Radix supplies focus management, keyboard and ARIA. |
| First sub-project | Foundation plus Workforce core, so every later module sits on the real shared record. |
| Fake data layer | A typed HTTP contract answered by Mock Service Worker (MSW) from an in-memory store. |
| Test locators | `data-testid` on every interactive element, from one typed registry shared by components and Playwright tests. |

## 3. Assumptions (defaults, correct them in review)

- TypeScript in strict mode, Vite, React Router, TanStack Query for server state.
- Zod schemas are the single contract, used by the client, the fake server and the OpenAPI output.
- Vitest and Testing Library for unit, contract and component tests. Playwright on Chromium for end-to-end tests.
- The app is its own repository, `DesktopQniverseqnipay-workforce-app`, a sibling of the prototype folder `Qnipay workforce cc`. The prototype stays there as the reference and is not modified by this work.
- npm as the package manager, Node 22 or later.
- Sign-in is simulated: persona accounts behind a `session` endpoint shaped like an Entra ID session, so Entra can replace it.
- The domain rules in CLAUDE.md carry over unchanged: no money, codes immutable, nothing in use deleted, every state change audited, no outcome claimed that was not observed, stubs labelled as stubs.

## 4. The sub-projects

| # | Sub-project | Depends on |
|---|---|---|
| 1 | **Foundation and Workforce core** (this document) | none |
| 2 | Timesheet: day form (the even two-column layout), week grid, approvals, queued BC posting | 1 |
| 3 | Rota | 1 |
| 4 | Leave | 1, 3 |
| 5 | Onboarding | 1 |
| 6 | Payroll and Business Central surfaces | 2 |
| 7 | Production swap: the fake API replaced by the real one, endpoint by endpoint | ADR-000, ADR-001, and each module it swaps |

Rota comes before Leave, as in PRD §13. Each sub-project gets its own spec and plan.

## 5. Architecture

```
qnipay-workforce-app/
  src/
    contract/     Zod schemas and the endpoint list; generates contract/openapi.json
    api/          typed fetch client and TanStack Query hooks
    mocks/        MSW handlers, in-memory store, seed extracted from the prototype
    domain/       pure rules: lifecycle guards, code rules, in-use checks,
                  capability resolution, notice audience and status, audit diff
    ui/           shadcn components wrapped with a required testId; tokens.css
    shell/        sign-in, persona navigation, capability gate, bell, tabs, bottom bar
    features/     people/, dimensions/, access/, config/, audit/,
                  notices/, notifications/, documents/, home/
    testids.ts    the test ID registry
  e2e/            Playwright tests, support helpers, trace.json
```

- **One boundary.** Features call `api/` only. `api/` speaks HTTP only. MSW answers
  behind HTTP and can be switched off one endpoint at a time.
- **Rules live on the server side.** The MSW handlers call `domain/`. The client
  never enforces a rule the server does not also enforce. Client-side validation
  exists for fast feedback only and repeats a server rule, never replaces it.
- **Every state change goes through the server.** The handler writes the audit row:
  who, what, before → after, and why where a reason is required. The UI reports
  success only from the response.
- **Tokens.** The prototype's three-tier `--qp` stylesheet is lifted verbatim into
  `ui/tokens.css`, including the dark theme block. Tailwind's theme maps to those
  CSS variables, so shadcn components render in Qnipay colours, Inter and the 4px
  grid. The spacing scale is `--qp-space-xs` (4px) through `--qp-space-6xl` (120px).

## 6. Scope of sub-project 1

Each screen names the prototype view it is checked against.

| Area | Screens (prototype view) | Behaviour |
|---|---|---|
| Shell | Sign-in, persona navigation (My Work, My Team, Qnipay setup), tab strip with group menus, phone bottom bar, bell and notification panel, account menu, view-as | Navigation follows capabilities and flags. View-as is audited. The role pill shows the account's role, and says so while viewing as someone else. |
| People | Admin people (`apeople`), Team people (`tpeople`), person record, add and edit form | Create and edit with field-level history. The seven-state lifecycle with guarded moves. Employee ID unique on create and immutable after, with the next free ID proposed in the tenant's own scheme. |
| Self-service | My profile (`profile`), propose a change, the approval queue on Team people | Contact, emergency and bank changes take effect only once approved. Bank changes route to payroll as well. |
| Dimensions | Locations, departments, cost centres, job profiles (`aloc`); projects and contracts (`acon`) | Codes unique and immutable. Nothing in use can be deleted, and the refusal names what uses it. |
| Access | Permissions (`aperm`) | Editable user-type templates plus per-user grants and revocations, read as "Manager + 2 exceptions". Locked cells cannot be changed. Every change is audited. |
| Employee types | Employee types (`atypes`): name, category, capabilities | The type record. Which timesheet fields a type captures belongs to sub-project 2. |
| Tenant config | Organisation (`aorg`), Calendar (`acal`), Modules and features (`amods`, `mfeat`), industry templates | Modules and flags switch navigation on and off. Templates preset a whole tenant and can be saved, exported and imported. |
| Frameworks | Notifications (`anotif`), Approvals chain and delegations (`aappr`) | The shared configuration. Modules raise events and use chains in later sub-projects. |
| Audit | Audit log (`iaudit`) | Every state change from every area, filterable, showing before → after. |
| Notice board | Notices (`notices`), My team → Notices (`tnotices`), the Home card | As specified in `../Qnipay workforce cc/docs/superpowers/specs/2026-09-25-notice-board-design.md`, including its "Decisions made during the build". |
| Documents | Documents (`docs`) | Read-only list with its source. Payroll documents show "Not yet connected". |
| Home | Employee home, Team home, in their core form | The notices card and person summary. Timesheet, rota and leave tiles are labelled stubs until their module arrives. |

**Out of scope:** timesheet capture and approvals, pay codes, payroll readiness,
Business Central, hours position, exceptions, rota, leave, onboarding, IT service
desk. Their navigation entries render a page that says "Not built in this build"
and names the sub-project that brings it.

**Delivery in three plans**, each ending in something that runs:

- **1a. Foundation and access.** Scaffold, tokens and shadcn theme, test ID registry
  and coverage check, contract and MSW harness with `_dev` endpoints, seed
  extraction, sign-in and session, shell and navigation, permissions and templates
  with per-user exceptions, audit log, `trace.json`.
- **1b. People and dimensions.** People, lifecycle, field history, dimensions,
  employee types, self-service changes and their approval.
- **1c. Configuration and communication.** Organisation, calendar, modules and flags,
  industry templates, notification and approval frameworks, notice board,
  documents, homes.

Audit and access come first because every later write depends on them.

## 7. The contract

### 7.1 Shape

- Every entity is a Zod schema in `src/contract/`. The client parses every response
  with it, MSW validates every request with it, and a build step generates
  `contract/openapi.json` from the same schemas. That file is the draft API
  specification for the production team.
- REST under `/api/v1`. Resources: `session`, `people`, `people/{id}/history`,
  `people/{id}/transitions`, `locations`, `departments`, `cost-centres`,
  `job-profiles`, `projects`, `employee-types`, `user-types`, `users/{id}/grants`,
  `tenant`, `tenant/modules`, `tenant/flags`, `tenant/calendar`, `templates`,
  `notification-events`, `notifications`, `approval-chains`, `delegations`, `audit`,
  `notices`, `notices/{id}/acks`, `notices/{id}/withdraw`, `profile-changes`,
  `profile-changes/{id}/decision`, `documents`.
- Every record carries `id`, `version` and `updatedAt`. A write sends
  `If-Match: <version>`. A stale version gets 412. This is the optimistic
  concurrency Business Central uses with its etags.
- A successful mutation returns the updated record and the `auditId` it wrote.
- State changes are explicit endpoints, for example
  `POST /people/{id}/transitions {to, reason}`, never a PATCH of a state field.

### 7.2 Refusals

One shape for every refusal:

```ts
{ code: string; message: string; next: string; usedBy?: {kind: string; count: number; examples: string[]}[]; field?: string }
```

| Status | Meaning | Carries |
|---|---|---|
| 403 | Capability missing | `code: 'capability'`, the capability's name in `message` |
| 409 | In use, or an illegal transition | `usedBy` for in-use; the allowed next states for a transition |
| 412 | Stale version | `next: 'Reload and apply your change again'` |
| 422 | Validation | `field` and the rule that failed |

Toasts show `message` and `next`, which enforces the house rule that a refusal
states the consequence and what to do next.

### 7.3 Data rules

- Timestamps are ISO 8601 in UTC from the server clock. The UI formats them in
  British style (DD/MM/YYYY HH:MM).
- Record IDs are opaque. Codes (employee ID, cost centre, project code, location
  code) are separate fields, unique on create and immutable after. A code is
  never used as a key.
- No monetary field exists anywhere in the contract. A schema lint fails the
  build on any field whose name matches `amount`, `price`, `salary`, `wage`,
  `grossPay`, `netPay` or `rateValue`, and on any value or default containing a
  currency symbol (`£`, `$`, `€`). Pay codes, net hours and rate *types* are
  identifiers, not money, and are legitimate. A field that matches and is not money
  goes in `contract/money-lint.allow.json` with a one-line reason, which review
  reads.

## 8. The fake server

- An in-memory store, persisted to `localStorage` under a seed version. A store with
  an older seed version is set aside, never half-loaded.
- Seeded from the prototype's own data, both the `qcic` and `social` tenants, by a
  one-off extraction script. No sample data is retyped.
- Handlers call `domain/` for every rule.
- Development and test endpoints under `/api/_dev`, excluded from production
  builds:
  - `POST /api/_dev/reset`: back to the seed.
  - `POST /api/_dev/seed/{tenant}`: load a tenant.
  - `POST /api/_dev/clock {now}`: set the server clock.
  - `POST /api/_dev/faults {method, path, status, latencyMs, times}`: make the next
    calls to an endpoint fail or slow down, to test error and loading states.

## 9. Test IDs

- One attribute, `data-testid`. Playwright is configured with
  `testIdAttribute: 'data-testid'`.
- One source of names, `src/testids.ts`, a typed registry imported by components and
  by Playwright tests:

  ```ts
  tid.page('people')              // "page-people"
  tid.nav.group('team')           // "nav-group-team"
  tid.nav.tab('notices')          // "nav-tab-notices"
  tid.people.table                // "people-table"
  tid.people.row('CP-1042')       // "people-row-CP-1042"
  tid.people.add                  // "people-add"
  tid.personForm.field('email')   // "person-form-email"
  tid.notice.ack('NTC-0001')      // "notice-ack-NTC-0001"
  tid.toast.info                  // "toast-info"
  tid.toast.error                 // "toast-error"
  tid.modal.root                  // "modal"
  tid.modal.confirm               // "modal-confirm"
  ```

- Format `area-element[-recordId]`, kebab-case. A test ID never contains display
  text, so renaming a label never breaks a test. Rows are identified by their
  record's code or ID.
- Every wrapped shadcn component (Button, Input, Select, Checkbox, Switch, Tabs,
  Dialog, table row, Toast, link) takes a required `testId` prop. It does not
  compile without one.
- Every page container carries `page-<view>` and every table `<area>-table`.
- A Vitest check renders every page against the seed and fails when an interactive
  element (button, link, input, select, textarea, row) lacks a `data-testid`, or
  when two elements on one page share one.
- Role and label locators still work, because Radix supplies ARIA. Test IDs are the
  default locator; role locators are for accessibility assertions.

## 10. Testing

### 10.1 Layers

| Layer | Tool | Proves |
|---|---|---|
| Domain | Vitest | The rules: the lifecycle guard table for every from → to pair, code immutability, in-use checks naming their users, capability resolution (template + grants − revocations), notice audience and status, the audit diff |
| Contract | Vitest against MSW handlers | Every request and response parses against its schema; refusals use the one shape; stale `If-Match` gets 412; the OpenAPI snapshot changes only on purpose; no monetary fields |
| Component | Testing Library | Validation messages, refusal toasts showing `message` and `next`, test ID coverage |
| End to end | Playwright, Chromium | Journeys per persona, in a real browser |

### 10.2 Rules for every end-to-end test

- `beforeEach` calls `api.reset()` and `api.setClock('2026-08-13T14:30:00Z')`. No test
  depends on another's leftovers or on today's date.
- After an action, the test reads the record back through the API and asserts on
  it. A toast may be asserted as well, never alone.
- A refusal test proves nothing changed: the record is read back unchanged.
- Every mutation has a fault test: `api.fault(...)` returns 500, the error toast
  states the consequence, and the record is read back unchanged.
- No fixed sleeps. Tests wait on `page.waitForResponse` or on a test ID.

Helpers in `e2e/support/`: `signInAs(persona)`, `api.reset()`, `api.seed(tenant)`,
`api.setClock(iso)`, `api.fault(method, path, status)`, `api.get(path)`.

### 10.3 Checks beyond behaviour

- Accessibility: `@axe-core/playwright` on every page in light and dark. Serious
  and critical findings fail.
- Phone: every page at 390px wide. No horizontal overflow outside deliberate
  scrollers; touch targets at least 44px.
- Visual baselines: key pages at 1440 and 390, light and dark, frozen clock. A diff
  fails until reviewed and accepted.
- Keyboard: every dialog traps focus and returns it on close. Every drag has a
  keyboard and touch equivalent.

### 10.4 Carrying the prototype suite over

- Plan 1a generates `e2e/trace.json` from the prototype suite's assertion names.
  Each Workforce core assertion becomes a row:
  `{ id, text, status: 'ported' | 'n/a' | 'pending', test, reason }`.
- Each plan fills its area's rows. A ported test keeps the prototype's text in its
  name, for example `test('NB Acknowledging twice adds nothing')`.
- `n/a` requires a reason, such as "prototype only: localStorage seed version".
- A CI check fails if any row assigned to a completed plan is still `pending`.
- Timesheet, rota, leave and onboarding assertions stay `pending` until their
  sub-projects.

### 10.5 Pipeline gates

Lint and typecheck, domain and contract tests, component tests with test ID
coverage, Playwright end-to-end, axe, phone checks, visual diff. All must pass to
merge. The CI host (Azure DevOps or GitHub) is part of ADR-000; the pipeline is
written as npm scripts so it runs on either.

### 10.6 Done, for a screen

It matches its prototype view; its domain rules have unit tests; its endpoints
have contract tests; its journeys pass end to end with consequence and fault
checks; axe and phone checks are clean; its trace rows are filled; every
interactive element carries a test ID from `testids.ts`.

## 11. Carried from the prototype, and not carried

**Carried as specification:** the permission matrix and its groups, user-type
templates, the notification event × role × channel framework, feature flags gated
by module, industry templates, the approval chain with scopes, conditions and
delegation, the integration states queued → posted or failed with `sim`, the
lifecycle state machines, the in-use refusal pattern, stubs labelled as stubs, the
UI conventions (⚠, ?, i), and the design tokens.

**Not carried:** one global scope of mutable state, eval-based persistence,
client-side accounts and a shared password, a `setTimeout` standing in for a
queue, a hard-coded demo clock, configuration written on every keystroke without
audit, raw `innerHTML` templates.

## 12. Open items for review

- **Hosting and CI host** are not decided. They belong to ADR-000, which this
  work does not block: sub-project 1 runs locally and in any CI that can run npm.
- **Seed extraction.** The prototype keeps its data inside a closure. The
  extraction script loads the prototype in jsdom, signs in, and reads the store
  the prototype writes to `localStorage`, which holds every persisted collection.
  The collections the prototype does not persist are read from its source text.
  The script's output is committed as `src/mocks/seed/*.json`.
- **Per-user grants and revocations are new.** CLAUDE.md describes them, but the
  prototype's matrix holds only one column per persona (`emp`, `mgr`, `adm`) and
  no per-user exceptions. The React app builds them from the CLAUDE.md access
  model, so their trace rows are `n/a (not in prototype)` and their tests are
  written fresh.
- **Dark theme rules that switch token, not value.** For example, the dark primary
  button uses the lime accent. These are ported as CSS in `tokens.css` or as
  component variants, never lost.
