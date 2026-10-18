# QniConnect Workforce: delivery plan for the first shippable product

2026-10-18 · Status: draft for review

This plan takes the app from today's prototype (React, fake server) to a product a customer can buy. That first product is:

- **QniConnect** (the workforce core): sign-in, people, permissions, approvals, notifications, payslips and documents.
- **Timesheet**, including clocking and the timesheet calendar.
- **Onboarding**, including templates by job profile.

Rota, Leave, Notices, Hours, Exceptions and Payroll readiness are not in this product. They stay switched off and are added later in the same way.

The plan builds on the existing design documents and changes them only where this plan says so:

- [`01-bc-backend-design.md`](01-bc-backend-design.md): the Business Central data model (the `SIR_WF` tables).
- [`02-field-mapping.md`](02-field-mapping.md) and [`03-api-endpoints.md`](03-api-endpoints.md): the field mapping and the API.
- [`04-decisions.md`](04-decisions.md) (B1 to B17) and [`05-risks.md`](05-risks.md) (R1 to R22).
- The QniConnect merge design of 14 Oct, in the QniConnect repo under `docs/superpowers/specs` (D1 to D17).

## 1. The target

```
Browser (this React app, QniConnect look and Workforce screens)
   │  Microsoft Entra sign-in (MSAL), one access token
   ▼
QniConnect API (Node, TypeScript) on Azure App Service
   │  checks the token, finds the person, applies the rules in src/domain,
   │  caches reference data, spreads calls across connector identities
   ▼
Business Central (one environment and company per customer)
   ├─ Qnipay W1 payroll (existing): Employee, sites, pay codes, pay periods, payroll runs
   └─ Qnipay Workforce app SIR_WF (new AL app): workflow tables, API pages, job queues
         └─ on final approval: SIR Timesheet Interface → payroll
```

What this means:

- **Business Central is the database.** There is no separate Workforce database (B2). The Node layer keeps short-lived caches only.
- **One backend.** The Workforce API (`/api/v1`) is added to QniConnect's existing Node API, which already does Entra sign-in and talks to Business Central. This answers question Q3 of the merge design and replaces the Azure Functions proxy in 01 §2. The rules split stays as B5: the Node layer decides, Business Central commits.
- **One front end.** QniConnect's features move into this repo (section 3, decision P1).

## 2. Decisions this plan needs

Settle these in phase 0. Each one changes what gets built.

| # | Decision | Recommendation | Why it matters |
|---|---|---|---|
| P1 | Which repo is the product | **This repo.** Port QniConnect's 41 JavaScript files in, rather than this app's 436 files into the QniConnect repo. This reverses merge decision D4, which chose the QniConnect repo as the base, with the same end result. | Decides where all front-end work happens. |
| P2 | Where the Node layer runs | **Azure App Service, extending the QniConnect API**, in the same region as the customers' Business Central (UK South today). | One sign-in, one deployment, no cold starts. |
| P3 | Licensing (O2, R19) | **Get a written answer from Microsoft or the licensing partner before phase 2.** The question: do employees whose data reaches Business Central through the connector each need a licence, Team Members at the least? | It can add about $8 per employee per month to the customer's cost, and it decides whether the connector design stands. |
| P4 | Throughput (R1) | **A pool of connector app registrations**, with calls spread across them, plus a load test in phase 2. Microsoft's own guidance recommends spreading load across several users or service principals. | Business Central allows about 5 requests at once and 6,000 per 5 minutes per identity. 1,000 people on one identity will be throttled at busy times. |
| P5 | Posting approved hours to payroll | **Part of the first product**, as phase 4, straight after Timesheet. 04 B16 put it last. A timesheet that never reaches payroll is hard to sell. | Problems A to F in 04 §3 need payroll-team fixes in W1, so their spike starts in phase 0. |
| P6 | Onboarding files (00 D8) | **Azure Blob Storage through the Node layer**, with malware scanning. Business Central keeps the metadata only. | Business Central storage is expensive and is not a file store. Onboarding cannot ship without real uploads. |
| P7 | Object range (O1) | Allocate about 300 IDs for `SIR_WF`, clear of W1, NZ, DK and SG. | Nothing in AL can start without it. |
| P8 | Paying for modules (B11) | Choose before the first paying customer: a Qnipay signed licence, or AppSource paid offers. | Without it, any customer can switch on any module. |
| P9 | Product name and logo | **QniConnect** for the product. Rename the CORE module "Workforce core" to "QniConnect". | Every screen, page title and baseline. Agreed in principle, not yet done. |
| P10 | Access model | Keep B14: user types (employee, manager, admin) plus capabilities, grants and revocations, stored in `SIR_WF`. Review it with the React developer in phase 0 (section 4). | A React developer raised that the role-based access code may need a structure change. Every module depends on it. |

## 3. Phases

Each phase ends with something that works end to end. Front-end, AL and Node work run side by side. The AL work for a module starts one phase ahead of the Node work for it (R21).

| Phase | What | Rough length |
|---|---|---|
| 0 | Decisions, spikes and groundwork | 3–4 weeks |
| 1 | Front-end merge: QniConnect inside this app | 5–7 weeks (alongside 2) |
| 2 | Core backend: people, access, approvals, notifications | 7–9 weeks |
| 3 | Timesheet, clocking and the timesheet calendar | 6–8 weeks |
| 4 | Posting approved hours to payroll | 3–5 weeks |
| 5 | Onboarding, including templates by job profile | 5–7 weeks |
| 6 | Release hardening and the first customer | 4–6 weeks |

Lengths assume about three developers: one front-end, one AL, one Node. They overlap, so the whole product takes roughly **7 to 9 months**. 04 §5 has the effort figures these lengths come from.

### Phase 0. Decisions, spikes and groundwork

- **Settle P1 to P10.**
- **Load-test spike.** Build one Business Central API page and one command in a sandbox. Drive it from Node with 1, 2 and 4 connector identities, simulating 1,000 people opening a timesheet week at 9am. Record the throughput, the 429 rate and the p95 latency against the targets in O3:
  - week read under 300 ms
  - day save under 200 ms
  - 300-day bulk approval under 2 s
- **Posting spike with the payroll owner.** Problems A to F in 04 §3. Agree which W1 changes are allowed (B12 sets the bar) and who makes them.
- **Access model review** (section 4).
- **Freeze the contract for the three modules** (R3, R20):
  - Apply the planned contract changes: manager as an employee code (B15), `.max()` lengths, lower-case ids in Text fields, and the address.
  - Add what changed since 12 Oct: onboarding templates, setup hardening, the employee rename.
  - Regenerate 03's operation and refusal tables from `ENDPOINTS`, so drift fails a test.
- **Update 02 and 03** for the in-scope operations only (section 5 lists what is new).
- **Environments:**
  - a Business Central sandbox with W1 installed
  - Azure dev, test and production App Service slots
  - Entra app registrations: the sign-in app and the connector pool
  - Key Vault, Application Insights, CI pipelines for the React app, the Node API and the AL app
- **Done when:** every decision has an owner and an answer. The load test says whether the connector design holds, and if not, the plan is revised before phase 2. 02 and 03 match the frozen contract.

### Phase 1. Front-end merge (QniConnect inside this app)

This follows merge design phase 1, in this repo (P1).

- **Sign-in:**
  - MSAL (Entra) replaces the email and password sign-in.
  - The portal check (`/bc/portalUsers/verify`, `/session/init`), environment selection and first-login overlay follow (D7).
  - Inactivity sign-out and cross-tab sign-out move across.
- **QniConnect pages ported to TypeScript** on this app's layers (`contract`, `api`, `domain`, `features`, `ui`, `shell`): registration, pricing, account setup, admin (portal users, environments, authorisation, settings), the payslip Home dashboard, Documents (payslips, P45, P60, P11D) and Profile.
- **The `/bc` calls** become typed contract and API modules (payroll, portal users, environments).
- **The API client** sends the MSAL token and the `X-BC-Environment` and `X-Registration-ID` headers on every call.
- **The fake server** stays for `/api/v1` modules not yet real, switched per module (D9). It is compiled out of production.
- **Navigation** follows D6, with old QniConnect URLs redirected.
- **Out-of-scope modules** (Rota, Leave, Notices, Hours, Exceptions, Payroll readiness) are switched off.
- **Done when:** every current QniConnect feature works against the real backend in the new look, and `npm run verify` passes.

### Phase 2. Core backend

**AL (`SIR_WF`)**

- **Conventions** (01 §4): Public Id, Version, audit, refusals with `next`, idempotency, aggregate versions (R2).
- **New tables:** WF+1 Setup, WF+3 Feature Flag, WF+4 Account, WF+5 to 9 user types and capabilities, WF+10 Audit Event, WF+11 Template, WF+12 to 14 approval chains and delegations, WF+15 and 16 notification events and evidence, WF+20 Person History, WF+21 Job Profile, WF+22 Employee Type, WF+23 Profile Change, WF+56 Idempotency Key.
- **Modules:** WF+2 Module is replaced by `SIR Feature Register` rows (B8). This needs the W1 event change B12.
- **Extensions:** Employee, `SIR Approval Session`, `SIR Work Sites`, Dimension Value, Job, Job Task, `SIR TIme Sheet Elements`, `SIR Notification Entry`, Employee Relative, Document Attachment (01 §8).
- **API pages:** entity sets WF+100 to 141 and 178, except notices. Commands WF+200 to 218 (03 §3.1 to 3.3).
- **Permission sets:** `SIR_WF Connector`, `SIR_WF Admin`.
- **Job queues:** session cleanup and idempotency cleanup.
- **Setup pages** in the Business Central client for every config table (B7).

**Node**

- Entra token check, then mapping to the `SIR_WF Account` and the Business Central session (B13).
- A shared cache for session mapping (R11).
- The connector pool (P4) and retries with back-off on 429 and 503.
- Refusal mapping (01 §4.3), location scope on reads (R16), and the contract tests run against the real backend.

**React**

- Shared services (D10): People & access (D12), approvals (D11), the notification bell (D13), organisation, bank holidays, pay codes (read only), employee types, audit, and a read-only modules page (B8).
- The core modules switch from fake to real.

**Data**

- A migration script: managers from names to codes (B15), address splits, and existing QniConnect portal users linked to `SIR_WF Account` (R18).

**Done when:**
- A real person signs in with Entra.
- Admins manage people and permissions in React or in Business Central, and the same rules apply both ways.
- The phase 0 load test passes against the real API pages.

### Phase 3. Timesheet, clocking and the timesheet calendar

- **AL:**
  - Tables WF+24 Timesheet Config, WF+25 Day, WF+26 Entry, WF+27 Break and WF+28 Day Log.
  - Clocking tables WF+29 Clock Record and WF+30 Clock Event.
  - Entity sets WF+142 to 148.
  - Commands WF+224 to 228, 230 and 231 (03 §3.4). Posting commands wait for phase 4.
  - Aggregate version per employee week (R2).
  - Bulk approval in chunks (R6).
- **Node:**
  - The week view and approval queue as one `$batch` or query each (03 §5.1, 5.2).
  - Rules from `src/domain/timesheet.ts`, `clock.ts` and `approvals.ts`.
  - Reference data cached: pay codes, shift types, employee types, config.
- **React:**
  - The Timesheet screens move across as they are: own day and week, the clock card, multi-week, the team matrix, queue and approvals, proxy entry, and setup.
  - My Calendar with the timesheet layer only (D16).
  - The timesheet modules switch to real.
- **Done when:**
  - A day goes from capture to approved through the chain.
  - Bulk approval of 300 days takes under 2 s.
  - Clock in, break and out work against the Business Central clock.
  - The latency targets hold.

### Phase 4. Posting approved hours to payroll

- **W1 fixes agreed in the phase 0 spike** (04 §3, A to F):
  - a zero rate on interface rows
  - Period mode
  - leave status counting
  - `Posting Line Id` on history
  - an archiving event
  - Site Code creating records
- **AL:**
  - Tables WF+53 Posting Batch, WF+54 Posting Line and WF+55 Posting Attempt.
  - The interface extensions with `Posting Line Id`.
  - Command WF+229 `postingRetries`.
  - Job queues `SIR_WF Posting Dispatcher` (every minute) and `Posting Reconcile` (nightly).
  - The field order and rules in 02 §10.1. No rate or amount is ever written (IC-08).
- **Node and React:** the posting log and retry, using the integration capability.
- **Done when:**
  - An approved day reaches a payroll run.
  - The reconciliation finds it.
  - A retried line never posts twice.
  - A data error shows a plain reason.

### Phase 5. Onboarding, including templates by job profile

- **AL:**
  - Tables WF+48 Onboarding Config, WF+49 Doc. Type, WF+50 Policy, WF+51 Case and WF+52 Document.
  - **New tables for templates by job profile**, which are not in 01 yet:
    - Onboarding Template: name, version, steps, policy list
    - Template Job Profile: one template per profile, unique key
    - Template Document: Asked, Required and Blocks start per document
    - a policy list on the default config
  - Entity sets WF+169 to 174, commands WF+248 to 256, and new template commands.
  - The start write-back to Employee, Employee Relative and Employee Qualification, with the `OnApplyOnboardingTaxNumber` event for country tax numbers (02 §9.4).
  - Removing a job profile that a template lists is refused (`usedBy`).
- **Node:**
  - File upload to Azure Blob Storage with scanning (P6).
  - Rules from `src/domain/onboarding.ts` and `onboarding-templates.ts`, resolving each starter's template.
  - Special-category data (nationality, convictions, right to work) stays in the case only and never in audit (H1).
- **React:**
  - The starter portal, tracker and setup screens move across as they are.
  - Starting a starter offers the QniConnect portal invite (D12).
- **Done when:**
  - A candidate completes onboarding on their own template.
  - Their manager verifies the documents and starts them.
  - Their Employee record in Business Central has the data.
  - They get a portal invite.

### Phase 6. Release hardening and the first customer

- **Security:** a security review and penetration test of the Node layer and the API pages (R16), tenant isolation tests (R15), and an erasure routine (R17).
- **Load and accessibility:** a load test at 1,000 employees across all three modules, and an accessibility audit (WCAG 2.2 AA).
- **Operations:**
  - monitoring and alerts on job queue entries (R14), plus a health endpoint
  - runbooks
  - backup and restore notes
  - audit retention (R9)
- **Release:**
  - Module licensing (P8), packaging the AL app (AppSource or per tenant), and customer onboarding steps (consent, app registration, connector pool, Entra app).
  - A pilot customer, then general availability.
- **Done when:** the pilot customer has run one full pay period on timesheets and onboarded at least one starter.

## 4. The access model review (P10)

A React developer suggested the role-based access code may need a structure change. Review it in phase 0, before any `SIR_WF` table is built, because R3 makes table changes expensive later.

**How it works today**

- The front end asks `useCaps()` for the caller's capabilities.
- Navigation comes from `domain/nav.ts`, filtered by capability.
- The fake server checks each endpoint's `x-capability` and, for 29 endpoints, the record as well (location scope, self-approval).
- QniConnect has a single `isAdmin` flag.

**What to check**

1. **Where the decision is made.** The server must refuse, and the UI only hides. Confirm the Node layer checks capability and scope on every route, and that Business Central checks again on commit (01 §2).
2. **Admin truth.** QniConnect `isAdmin` against the Workforce admin user type. This plan proposes `SIR_WF Account."User Type Code"` as the one truth, with `isAdmin` derived from it. That removes the "two admin truths" in merge design D8.
3. **Scope.** One location per person today. Decide whether department scope or multi-location managers (00 D10) are needed for the first product, because adding them later changes keys.
4. **Front-end shape.** Whether capability checks are spread through feature code or centralised: route guards, a permission hook, a component. The review should name the files and the change.
5. **New-starter mode and view-as.** Both are session flags that refuse writes. Keep them in the Business Central session, not the token.

**Output:** a short decision note added to 04, and contract changes, if any, before the phase 0 contract freeze.

## 5. What changed since the 12 October design

These need adding to 01, 02 and 03 in phase 0 for the three modules in scope.

- **Onboarding templates by job profile** (built 18 Oct): the new tables and commands in phase 5, plus `template` on the case views, and the organisation template capture and apply.
- **Searchable pickers and the line manager chosen from employees.** These match B15, manager as a code.
- **Setup hardening:** time zone, calendar, approval chains enforced, and the Timesheet setup screen. Check the Timesheet Config fields against WF+24.
- **Renames:** people and person became employees and employee in the contract (15 Oct).
- **Payroll readiness, Hours, Exceptions and pay code editing** are built in the app but out of this product. Their screens stay switched off.

## 6. How each module is delivered

For each phase's module, in this order:

1. **Freeze** that module's contract (zod and OpenAPI).
2. **List** the Business Central tables reused and created, with their fields (01 and 02).
3. **Build** the AL tables, API pages, commands, setup pages and AL tests in the sandbox.
4. **Build** the Node routes, with the rules from `src/domain` and the contract tests against the sandbox.
5. **Switch** the module from fake to real in the React app (`VITE_FAKE_MODULES`). Run the end-to-end suite against the sandbox.
6. **Load-test** the module's busiest screen against the targets.
7. **Review** the whole module once, as for the front-end modules, then fix.

A module that is not finished stays switched off in Business Central (B17). Nothing ever runs half on the fake server and half on Business Central.
