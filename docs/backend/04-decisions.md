# Qnipay Workforce on Business Central: decisions

2026-10-13 · Status: agreed

This document records the decisions taken after reviewing the backend design
([`01-bc-backend-design.md`](01-bc-backend-design.md)), the field mapping
([`02-field-mapping.md`](02-field-mapping.md)) and the API mapping
([`03-api-endpoints.md`](03-api-endpoints.md)) against this repo and the Qnipay W1 and NZ source.
Where a decision here conflicts with 01, 02 or 03, this document wins until those documents are updated.

Decisions B1 to B4 are in 01 §1 and still stand, except where B5 to B17 change them.

## 1. Decisions

| # | Decision | Chosen | Consequence | Changes |
|---|---|---|---|---|
| B5 | Where the business rules run | **The proxy decides, Business Central commits.** The proxy runs the computed rules with the TypeScript `src/domain` package: leave balance and entitlement, the approval chain walk and delegation, timesheet validation and period lock, rota eligibility and rest, onboarding readiness. Business Central enforces the structural rules (versions, codes, in-use, state machines, capability, payroll boundary) and commits each command in one transaction. The proxy sends the versions it read with the command, and Business Central refuses with `stale` if any of them has changed. | The rules have one copy, in TypeScript. About 7–8k lines of TypeScript are not ported to AL. Only the proxy's app registration holds `SIR_WF Connector`, so nothing else can write through the API. | 01 §2 "Business Central enforces every invariant on write" |
| B6 | Who edits setup | **React edits, Business Central stores.** Organisation, calendar, module configuration, people and structure, and governance (permissions, approval chains, notifications, delegations) are edited in the React setup screens and saved to Business Central. | The config write endpoints in 03 stay. | — |
| B7 | Editing setup in the Business Central client | **Allowed as well.** Admins may edit Workforce setup in Business Central pages as well as in React. | Config validation and in-use checks run in AL, because a Business Central page does not go through the proxy. The proxy passes config writes through and maps the refusals, without running the checks a second time. Config held as JSON in a Blob becomes real tables and fields, because Business Central pages cannot edit JSON: capture rules, type capture, allowances, leave stages and sickness reasons, rota safe rules and fulfil stages, onboarding steps. | 01 §4.1 "JSON configuration columns" and "the proxy validates it with the same zod schema" |
| B8 | Switching modules on and off | **Payroll feature management in Business Central.** The Workforce modules (CORE, the capture methods A, B and C, Rota, Leave, Onboarding) are registered in W1's `SIR Feature Register` and switched on the `SIR Payroll Feature Mgt` page. React shows them read-only. | The `SIR_WF Module` table in 01 §6.1 (WF+2) is replaced by feature register rows. The React modules page becomes read-only, and `moduleSwitches` leaves the API. What switching a module does (setting rota shifts aside, restoring captures) runs in AL, on the event from B12. | 01 §5.1 and §6.1 WF+2, 03 module switch operations |
| B9 | What payment controls | **Modules only.** | A module can be switched on only if the customer has paid for it, once B11 is settled. | — |
| B10 | Feature flags | **Ordinary Workforce settings.** All 39 flags stay in `SIR_WF Feature Flag`, editable in React and in Business Central. A flag works only while its module is on. | No flag is sold separately. If Product later sells one as a paid add-on, it moves to the feature register. | — |
| B11 | How payment unlocks modules | **Not decided.** The options are a Qnipay signed licence that the Workforce app checks, or AppSource paid offers using Business Central's built-in licensing. | The early phases build the module switches without a payment check. Licensing is added before the first paying customer. When payment lapses, a module goes read-only. Data is never deleted. | — |
| B12 | Changing W1 | **A small W1 change is allowed** to make `OnAfterUpdateFeatureAvailibility` in codeunit `SIR Payroll Feature Mgt.` an integration event that other apps can subscribe to. Today it is a plain procedure with an empty `case`. | Qnipay Workforce subscribes to the event when a module is switched. Any other W1 change still needs its own decision. | 01 §5.8 "W1 or NZ objects changed: none" |
| B13 | Sign-in | **Microsoft Entra ID.** The React app signs in with MSAL. The proxy validates the Entra token and maps it to the `SIR_WF Account` and a session in `SIR Approval Session`. | The email and password sign-in (`POST /session`) is replaced. The Business Central session token stays between the proxy and Business Central, and never goes in a URL or a `$filter`. | 03 #1, and the `$filter=sessionToken` reads in 03 |
| B14 | Roles | **A User Type field on `Employee`** with values such as employee, manager and admin, each with its own capability set (`SIR_WF User Type` and `SIR_WF User Type Capability`). | It is called User Type, not Employee Type, because Employee Type already means Contracted, Bank, Agency or Salaried and drives how hours are captured. The user type codes are lower case in the contract, so they are stored in a Text field, not a Code field. | 01 §5.2.1 "user type" row (`SIR_WF Account."User Type Code"`) |
| B15 | Line manager | **`Employee."Manager No."`**, the manager's employee code. | The contract's `manager` changes from a name to an employee code, on people, locations, departments and projects. React shows the name. Approvals, clocking and onboarding look the manager up by code, not by name. | 02 manager rows, the contract and the mock handlers |
| B16 | When posting to payroll lands | **The last phase.** Approved hours and leave are not posted until a spike with the payroll owner has settled problems A to F (§3). | Timesheet and Leave end at final approval. The fixed Business Central step at the end of the Timesheet chain stays hidden until posting is built. B1 still decides where posting goes. | 01 §7 timing |
| B17 | Delivery | **In phases, one module at a time.** A module that is not built yet stays switched off in Business Central (B8). | The app already hides a module that is off, so nothing runs half on the fake API and half on Business Central. | 01 has no delivery plan |

## 2. Phases

| Phase | Scope | Switched on | Done when |
|---|---|---|---|
| 0 | The object range (O1). Licensing for the connector account (O2). The W1 event (B12). Contract changes: manager as a code (B15), `.max()` lengths, lower-case ids in Text fields, the address. 01 and 03 updated for this document, and 03's operation and refusal tables generated from the code. The Blob configs redesigned as tables (B7). | — | Every document matches this one, and the contract changes are merged. |
| 1 | Foundation. AL conventions (Public Id, Version, audit, refusals that carry `next`), the account and session (B13), user types and capabilities (B14), people on `Employee`, employee types, dimensions, organisation and calendar, approval chains, delegations, the notification matrix, and the Business Central pages for each (B7). The proxy: Entra, refusals, location scope, and the contract tests run against it. React: MSAL, hosting the proxy on the app's origin, a read-only modules page, `SavedDataCard` hidden when the fake API is off. | CORE | A real person signs in. Admins edit people and permissions in React or in Business Central, and the same rules apply both ways. The week read meets the latency target (O3). |
| 2 | Timesheet and clocking, without posting. | CORE, A, B, C | A day goes from capture to `ok` through the chain. Bulk approval of 300 days works. |
| 3 | Leave, without posting. | + Leave | A request goes from raised to approved. The proxy computes balances. |
| 4 | Rota. | + Rota | A week goes from draft to published and through sign-off. |
| 5 | Onboarding, notices, profile changes, documents. | + Onboarding | A starter goes from invite to active. |
| 6 | Posting to payroll (B16): the spike on A to F, then posting and reconciliation, then the parked payroll pages. | all | An approved day reaches a payroll run, and the reconciliation finds it. |
| Before the first paying customer | Licensing (B11). | — | A module the customer has not paid for cannot be switched on. |

## 3. Problems found in the review

These are why B16 puts posting last. They come from the W1 source and must be settled in phase 6.

| # | Problem | Where |
|---|---|---|
| A | Creating a timesheet from the interface refuses a rate of 0. Workforce never sends a rate, so payroll must run Pull Employee Rates first. | `SIRTimesheetCreateMgt.Codeunit.al:331-334` |
| B | In Daily mode, each interface row becomes one line per day of the pay period, each carrying all the hours. Workforce rows are only correct in Period mode. | `SIRTimesheetCreateMgt.Codeunit.al:169-248` |
| C | Payroll counts Leave Register Detail rows whatever their approval status, and counts them as days whatever the unit. A cancelled row is still paid. | `SIRPayrollLine.Table.al:2464-2476` |
| D | A unique key on `Posting Line Id` fails on rows that imports leave blank, and on existing history. | 01 §7.1 step 4 |
| E | Archiving interface rows raises no event, and the archived row gets a new Entry No. | `SIRTimesheetCreateMgt.Codeunit.al:338-377` |
| F | Validating Site Code creates a missing work site and employee site instead of refusing. `SIR Work Sites` has no Blocked field. | `SIRTimesheetInterface.Table.al:91-173` |

The full review also lists case, length and mapping problems in 02 and missing operations and refusal codes in 03. Phase 0 fixes them.

## 4. Open

| # | Item | Owner |
|---|---|---|
| O1 | Object range for Qnipay Workforce, about 300 IDs. | Product |
| O2 | Licensing: whether calls made by one connector account on behalf of about 500 people need a Business Central licence per person. | Product, licensing |
| O3 | Latency: the week read in under 300 ms and the day save in under 200 ms, at p95. | Architecture |
| B11 | How payment unlocks modules. | Product |
| — | Who owns the problems A to F with the payroll team. | Payroll |

## 5. Effort, roughly

| Part | Estimate |
|---|---|
| AL (structural rules, config rules, tables, pages, tests) | 4–7k lines, about 2–3 months for one developer, spread over the phases |
| Proxy | 1–2 months. Most of the rules already exist in `src/domain`. |
| React | A few weeks: sign-in, the manager change, the read-only modules page |
| Posting | Known after the spike |

For comparison, porting every rule to AL (the choice B5 turned down) was estimated at 150–200 developer-days, and every later rule change would have to be made twice.
