# Qnipay Workforce — Backend and Business Central Integration Design

Oct 7, 2026 · @Manish Nepal

## Overview

The backend replaces the app's in-browser fake API with Azure Functions, an Azure SQL database and a queued connector to Microsoft Dynamics 365 Business Central. It keeps every endpoint, response shape and refusal the React app already uses. The React app holds the contract today: zod schemas in `src/contract`, and the behaviour in the fake handlers in `src/mocks`. The backend implements that contract, so the front end changes only its base URL and its sign-in.

**In scope**

- One HTTP API for every module the app has built: foundation and access, people and dimensions, configuration and communication, timesheet, clocking, rota, leave and onboarding.
- Persistent, multi-tenant storage of the workforce record, with an audit row for every change.
- Sign-in through Microsoft Entra ID, with capabilities and location scope enforced on the server.
- Two-way integration with Business Central: master data in, approved hours out.

**Out of scope for this phase**

- Payroll and the Business Central surfaces (Hours, Team hours, Exceptions, Payroll readiness, Pay codes and the Business Central page). They stay parked, but the posting pipeline is designed here so they can be built on it later.
- A real document store for onboarding files, e-signature and background-check providers.
- Email and SMS delivery. Notifications stay in-app.

**Rules the backend must keep**

- Workforce never resolves money. It posts hours with a pay code, and Business Central owns what that code is worth. No table holds a rate, an amount or a currency.
- Codes are identity: unique on create and never changed after.
- Nothing in use can be deleted. The refusal names what uses it.
- Every state change writes one audit row: who, what, before, after and why.
- The system never claims an outcome it has not observed. Hours sent to Business Central stay "queued" until Business Central confirms them.

## Architecture

The React app calls one HTTP API built on Azure Functions. Only two background functions talk to Business Central: the posting worker sends approved hours out, and the sync worker brings master data in. A Business Central outage therefore never blocks a timesheet save or an approval; it only delays posting.

&#91;embedded content: backend architecture · Azure services and Business Central\]

Approval writes the posting lines and an outbox message in the same SQL transaction. Service Bus then hands the work to the posting worker, which retries on its own schedule and reports each line's state back to SQL.

## Tenancy, identity and permissions

Every request resolves to one tenant, one signed-in person and one effective person before any handler runs. The API enforces capability and location scope; the React app only hides what the API would refuse.

**Tenancy**

- A Workforce tenant is one customer organisation. It maps to exactly one Business Central environment and company (`tenant_bc_link`).
- Every table carries `tenant_id`. Azure SQL row-level security filters on it from the session context, so a missed `WHERE` cannot leak another tenant's rows.
- The tenant record holds the module switches (CORE, TS with capture methods A, B and C, R, L, ON) and 39 feature flags. A flag is live only while its module is on. A handler for a module that is off refuses with 403 `module-off`.

**Sign-in**

- Users sign in with Microsoft Entra ID through MSAL in the React app. The API validates the access token (issuer, audience, signature, expiry) on every call.
- The token's object id maps to an `account` row, and the account to one `person` by employee code. An unknown user gets 401 `signed-out`.
- `POST /session` and the demo password go away. `GET /session` keeps its shape, with `simulated: false`.
- Viewing as another person (`perm_cfg`) stays a server-side session flag. Every write is refused with 403 `viewing-as` while it is set, except returning to your own account and signing out.

**Capabilities**

- There are 32 capabilities in three groups: own work (8), team (16) and configuration (8). The source of truth is the `capability` table.
- A user's capabilities = their user type's set (employee, manager or admin) + their personal grants − their revocations. A revocation always wins.
- Each endpoint declares its capability in the contract (`x-capability` in `contract/openapi.json`). The function host checks it before the handler runs. 29 endpoints check access in the handler instead, because the rule depends on the record (for example, your own timesheet or one in your scope).

**Location scope**

- `master_data` sees every location. Everyone else is scoped to their own person's location; there is no department scope today.
- Team reads filter by scope in SQL. Team writes refuse an out-of-scope target with 403 `scope`.
- Nobody approves their own timesheet (403 `SELF_APPROVAL`). Nobody checks their own onboarding documents.
- A candidate or preboarding person may write only to their own onboarding case, their notifications and sign-out (403 `not-started` otherwise).

**Audit**

- Every mutating request writes exactly one `audit_event` row in the same database transaction as the change. A no-op writes none and returns `auditId: null`.
- The row records the real signed-in person, the person they were viewing as, the action, the entity and id, before, after and the reason. The PRD (NA-05) adds source, device, correlation id and integration attempt id.
- Audit rows are append-only. Personal data (NI number, address, bank details, document content) never goes into before or after; changed section names do.

## Data model

The database has 58 tables in Azure SQL. Most map one to one to a collection in the fake store. Five split a nested list out so it can be queried: `timesheet_entry`, `timesheet_break`, `timesheet_day_history`, `rota_cell` and `notice_ack`. Five are new for Business Central: `tenant_bc_link`, `posting_batch`, `posting_line`, `posting_attempt` and `bc_sync_state`. Column names follow the contract's field names in snake\_case, so the mapping from `src/contract` stays mechanical.

**Rules for every table**

- `id` is an opaque `uniqueidentifier`, never a business code. The API keeps today's string ids (`per_EMP001`, `tsd_EMP001_2026-08-13`) in a unique `public_id` column, so no client change is needed.
- `tenant_id` is on every row and leads every index.
- `version int` and `updated_at datetime2` are on every row the API can write. A write runs `UPDATE … WHERE id = @id AND version = @ifMatch`. Zero rows updated means 412 `stale`. Records that do not exist yet are created at version 1 from an If-Match of 0.
- Codes (employee ID, location, job, pay code and so on) are unique per tenant (`UNIQUE (tenant_id, code)`) and never updated.
- Nested configuration that the API always reads and writes whole (capture rules, rota rules, leave policies, onboarding steps) is a JSON column validated by the same zod schema. Rows that are queried, filtered or joined get real columns.
- Deletion is refused while a row is referenced. Foreign keys enforce it, and the handler turns the error into the 409 `in-use` refusal with `usedBy`.
- No column holds a rate, an amount or a currency. The schema lint that guards the contract today also runs against the database migrations.

**Foundation, access and configuration**

| Table | Key columns | Notes |
| --- | --- | --- |
| `tenant` | name, template, modules (JSON), flags (JSON), company (JSON), financial\_year, week\_start, bank\_holidays (JSON), extras (JSON), restore (JSON) | One row per tenant. No currency. |
| `tenant_bc_link` | bc\_tenant\_id, environment, company\_id, company\_name, entra\_app\_id, key\_vault\_secret, status, last\_checked\_at | New. Which Business Central environment and company this tenant posts to. Secrets stay in Key Vault. |
| `account` | entra\_object\_id, email, person\_id, user\_type, grants (JSON), revocations (JSON) | One per user who can sign in. Unique on (tenant, email) and on entra\_object\_id. |
| `user_type` | code (employee, manager, admin), name, description, capabilities (JSON) | Name ≤ 24 characters, unique ignoring case. |
| `capability`, `capability_group` | code, group, label, gate, locked\_for | Reference data, the same for every tenant. Read-only. |
| `audit_event` | at, who\_person\_id, viewing\_as\_person\_id, act, entity, entity\_id, before (JSON), after (JSON), reason, source, correlation\_id, integration\_attempt\_id | Append-only. Indexed on (tenant, entity, at) and (tenant, who, at). |
| `template` | key, source, saved\_at, saved\_by, body (JSON) | Saved and imported templates. Shipped templates stay in code. |
| `approval_chain` | module, steps (JSON) | One per module. The Business Central posting step is fixed last in Timesheet. |
| `delegation` | from\_person\_id, to\_person\_id, date\_from, date\_until, modules (JSON) | Loops and overlaps refused. |
| `notification_matrix` | events (JSON) | One per tenant: event × employee, manager and admin channels. |
| `notification` | person\_id, area, event, title, body, at, read, channel, delivery (JSON), ref | Indexed on (tenant, person, read, at). |
| `notification_evidence` | person\_id, event, at, recipient, channel, ref | Kept while FLEXMON is on. |
| `notice` | code (NTC-0001), text\_version, title, body, scope (JSON), pinned, urgent, must\_ack, date\_from, date\_until, state, posted\_by\_person\_id, at, withdraw\_reason, history (JSON) |  |
| `notice_ack` | notice\_id, person\_id, text\_version, at | Split out of the notice so acknowledgement counts are a query. |
| `document`, `payroll_document` | person\_id, name, category, date, owner, source | Read-only listings. Payroll documents stay placeholders until the payroll feed. |

**People and dimensions**

| Table | Key columns | Notes |
| --- | --- | --- |
| `person` | code, name, email, phone, address, emergency\_name, emergency\_phone, bank\_account, bank\_sort\_code, job\_profile\_id, employee\_type\_id, category, location\_id, department\_id, manager\_person\_id, contracted\_hours, max\_hours, night, cis, state, start\_date, end\_date, bc\_resource\_no, bc\_employee\_no | Bank fields are encrypted (Always Encrypted) and masked in every response. `manager_person_id` replaces today's free-text manager name. State changes only through the transition endpoint. |
| `person_history` | person\_id, at, by\_person\_id, source, field, from\_value, to\_value, reason | Append-only. |
| `location` | code, name, area, department\_id, cost\_centre\_id, support\_level, min\_per\_shift, manager\_person\_id, address, active, bc\_dimension\_value |  |
| `department`, `cost_centre` | code, name, manager\_person\_id, bc\_dimension\_value | Mirror Business Central dimension values. |
| `job_profile` | code, name, night |  |
| `project` | code (BC Job No.), name, client, cost\_centre\_id, manager\_person\_id, status, start\_date, end\_date, budget\_hours (decimal), billable, location\_id, bc\_job\_no, bc\_synced\_at | Mirrors a Business Central Job. `budget_hours` becomes a number, not today's text. |
| `project_task` | project\_id, code (BC Job Task No.), name, group, billable, bc\_synced\_at | Mirrors a Job Task. Unique on (project, code). |
| `employee_type` | code, name, category, mode, uom, capabilities (JSON) | Per-type capture, rota and leave settings stay in their module's config. |
| `profile_change` | person\_id, field, from\_value, to\_value, note, raised\_at, status, stage, route (JSON), decisions (JSON) | Bank values encrypted. |
| `pay_code` | code, basis, value, element (BC pay element), label, work\_type, bc\_work\_type\_code | Multiplier or unit count only. Read-only until the Payroll module. |

**Timesheet and clocking**

| Table | Key columns | Notes |
| --- | --- | --- |
| `timesheet_config` | rules (JSON), cutoff, time\_format, return\_reason\_required, week\_grid, week\_layout, field\_defaults (JSON), allowances (JSON), types (JSON) | One per tenant. |
| `timesheet_day` | person\_id, date, state, work\_type, allowances (JSON), shift\_code, non\_working\_reason, capture\_source, entered\_by\_person\_id, submitted\_at, return\_reason, warnings (JSON), worked\_anyway, posting\_line\_id | Unique on (tenant, person, date). Indexed on (tenant, state, location) for the approval queue. |
| `timesheet_entry` | day\_id, seq, start, finish, hours, project\_id, project\_task\_id, cost\_centre\_id, location\_id, fields (JSON) | Split out of the day. Allocation becomes ids, not today's display names, so a posting carries Job No. and Job Task No. |
| `timesheet_break` | entry\_id, start, end |  |
| `timesheet_day_history` | day\_id, from\_state, to\_state, by\_person\_id, at, reason | Append-only. |
| `clock_record` | person\_id, date, events (JSON), late, closed\_late (JSON), written (JSON), closed\_no\_day (JSON) | Unique on (tenant, person, date). Event times always come from the server clock. |

**Rota**

| Table | Key columns | Notes |
| --- | --- | --- |
| `rota_config` | rules and stages (JSON), types (JSON) | One per tenant. |
| `shift_type` | code, name, time\_from, time\_to, break\_minutes, night, tone |  |
| `pattern` | code, name, cycle, location\_ids (JSON), job\_profile\_ids (JSON), cost\_centre\_id, starts, horizon, active, days (JSON), people (JSON) |  |
| `rota_week` | location\_id, week\_start, state, publish\_version, published\_at, published\_by\_person\_id | Unique on (tenant, location, week\_start). |
| `rota_cell` | rota\_week\_id, person\_id, day (0-6), value | A shift code, rest, V (leave) or S (sickness). Split out of the week so a person's shifts are a query. |
| `rota_change` | rota\_week\_id, at, by\_person\_id, person\_id, date, from\_value, to\_value, why, after\_publish, version | Append-only. |
| `rota_profile` | person\_id, cleared, dbs\_expiry, qualifications, favourite, preferred\_days (JSON) | Source system to decide (HR or Business Central). |
| `cover_request`, `filled_shift` | location\_id, date, shift\_code, reason, stage, open, urgent, log (JSON); person\_id, confirmed, it\_request\_id |  |
| `it_request` | ref (ITR-1007), person\_id, location\_id, shift, date, worker, status, raised\_at, system |  |
| `rota_set_aside` | rota\_week\_id, lines (JSON) | Shifts kept while Rota is off. |

**Leave**

| Table | Key columns | Notes |
| --- | --- | --- |
| `leave_config` | settings, types, policies, stages, type\_leave (all JSON) | One per tenant. |
| `leave_request` | person\_id, type\_code, date\_from, date\_to, part, qty, unit, state, raised\_at, note, decided\_at, decided\_by\_person\_id, reason, history (JSON) |  |
| `leave_ledger` | person\_id, date, type, qty, unit, why, counts, dates (JSON), by\_person\_id | Append-only adjustments. |
| `leave_base` | person\_id, year, unit, taken, toil, toil\_by, accrued\_hours | The opening position. Balances are derived, never stored. |
| `leaver`, `sick_episode` | person\_id, leave\_date, note; person\_id, date\_from, date\_to, reason, note, rtw (JSON) |  |

**Onboarding**

| Table | Key columns | Notes |
| --- | --- | --- |
| `onboarding_config` | steps (JSON), documents (JSON) | One per tenant. |
| `onboarding_policy` | code, label, ver, summary, body (JSON), sort\_order, file (JSON) |  |
| `onboarding_case` | person\_id, steps (JSON), docs (JSON), files (JSON), rejections (JSON), acks (JSON), read (JSON), data (JSON, encrypted), signature, consent, submitted\_at, ref, invited\_at, started\_at, asked (JSON) | One per starter. `data` holds the NI number, date of birth, address and convictions answer, so it is encrypted and never returned to the tracker. |

**Business Central integration** (new)

| Table | Key columns | Notes |
| --- | --- | --- |
| `posting_batch` | document\_no, created\_at, state, line\_count, total\_hours, bc\_journal\_batch, correlation\_id | One per approval action (one day, or one bulk approval). |
| `posting_line` | batch\_id, day\_id, idempotency\_key, posting\_date, bc\_resource\_no, bc\_job\_no, bc\_job\_task\_no, bc\_work\_type\_code, quantity, unit, description, line\_type, state, attempt, last\_error, bc\_entry\_no, request\_id, response\_id, reconciled\_at, queued\_at, posted\_at | Replaces today's `integrationAttempts`. One line per approved day and work type. Holds hours and codes only. |
| `posting_attempt` | line\_id, attempt, at, outcome, http\_status, bc\_error\_code, message, duration\_ms | Every try, kept for support. |
| `bc_sync_state` | entity, last\_sync\_at, delta\_token, subscription\_id, subscription\_expires\_at, status | Inbound master-data sync position per entity. |

## API surface

The backend serves the 171 operations already specified in `contract/openapi.json` (137 paths under `/api/v1`), with the same request bodies, responses and refusals. The OpenAPI file is generated from the zod contract, so it is the build target and the test oracle.

| Module | Operations | Endpoint groups |
| --- | --- | --- |
| Foundation and access | 15 | session and view-as, capabilities, user types, users and exceptions, audit |
| People and dimensions | 36 | people and lifecycle transitions, locations, departments, cost centres, job profiles, projects, employee types, profile changes |
| Configuration and communication | 36 | tenant modules, flags and settings, templates, notifications and matrix, approval chains and delegations, notices, home and documents |
| Timesheet | 11 | week read, day save and submit, week and multi-week submit, approve or return, approval queue, bulk approve, setup, posting retry |
| Clocking | 6 | clock card, in, break start and end, out, close a forgotten clock |
| Rota | 33 | week read and edit, publish, copy, repeat, plan, shift types, patterns, cover requests, filled shifts, IT requests, my shifts, setup |
| Leave | 15 | my leave, requests, team approvals, balances, entitlement, leavers, sickness, return to work, setup |
| Onboarding | 19 | my case and its steps, documents, policies and submit; tracker, verify, reject, invite, start, chase; setup and policies |

Five development endpoints (`/session/accounts`, `/saved-data/*`) and the `/_dev/*` helpers are not built in the backend.

**Conventions every function keeps**

- **One pipeline.** Each HTTP function runs: authenticate, resolve tenant and session, check the capability, validate parameters and body with the zod schema (422 `invalid`), run the handler, write the audit row. Steps 1 to 4 live in one shared middleware, as `serve()` does today.
- **One transaction per request.** The handler's changes and its audit row commit together or not at all. Today the fake server restores a snapshot on any error; SQL gives the same guarantee.
- **Optimistic concurrency.** A versioned write needs `If-Match` with the record's version as a bare number. Missing is 428 `version-required`; stale is 412 `stale`. Week submit carries a version per day, and bulk approve carries a checksum of the queue instead.
- **State changes are explicit endpoints** (`/transitions`, `/approve`, `/submit`, `/start`), never a PATCH of a state field.
- **One refusal shape:** `{ code, message, next, field?, usedBy? }` with the status codes the contract lists. Messages are plain British English sentences, written by the domain rules.
- **Mutation response:** `{ record, auditId }`, plus `summary`, `effect` or `warnings` where the contract says so. The app shows success only from the response.
- **Time** is the server's clock in ISO 8601 UTC. Clock events never take a time from the client.
- **Idempotency.** Every POST that creates something accepts an `Idempotency-Key` header. A repeat within 24 hours returns the first response, not a second record.
- **Paging.** Lists that can grow (approval queue, audit, notifications, people) take a cursor and a limit.

**Reuse, not rewrite**

The functions are written in TypeScript on Node 22, so they import `src/contract` (schemas) and `src/domain` (validation, lifecycle, work-type derivation, blockers, entitlement) directly from a shared package. The fake handlers in `src/mocks` are the reference implementation: each becomes a function with the store calls replaced by SQL repositories.

## Business Central integration

Two flows cross the boundary. Master data comes in from Business Central. Approved hours go out to it with a pay code. No money crosses in either direction; Business Central decides what a pay code is worth.

**What crosses**

| Direction | What | Business Central side | Workforce side | When |
| --- | --- | --- | --- | --- |
| In | Resources and employees | Resource, Employee | `person.bc_resource_no`, `person.bc_employee_no` | Nightly, and on change through a webhook |
| In | Jobs and job tasks | Job, Job Task | `project`, `project_task` | Nightly, and on change |
| In | Dimension values | Dimension Value (department, cost centre, location) | `department`, `cost_centre`, `location` | Nightly |
| In | Work types and pay elements | Work Type | `pay_code.bc_work_type_code`, `pay_code.element` | Nightly |
| Out | Approved hours | Job Journal line, or Time Sheet line and detail (decision D1) | `posting_line` | Within minutes of approval |
| Out | New job task for a contract | Job Task | `project_task` | When an admin adds one, sent by the posting worker |
| In, later | The employee's own posted payroll amounts, read-only | Payroll ledger | Not stored. Read through and shown masked | On request, when the Payroll module is built |

**Field mapping for a posted line**

Every approved day becomes one posting line per work type. These are the 13 Job Journal fields the customer's change map lists (Fusion3 §3.7), and where each comes from.

| Business Central field | Source in Workforce |
| --- | --- |
| Journal Template and Batch Name | `tenant_bc_link` setting, fixed per tenant |
| Posting Date | `timesheet_day.date` |
| Document No. | `posting_batch.document_no`, one per approval action |
| Type | Fixed: Resource |
| No. | `person.bc_resource_no`. A person without one cannot be approved for posting. |
| Job No. | `project.bc_job_no` from the entry's project |
| Job Task No. | `project_task.code`. Must belong to that job. |
| Work Type Code | `pay_code.bc_work_type_code` of the day's derived work type |
| Quantity | Net hours, decimal, after breaks |
| Unit of Measure | Fixed: HOUR, or DAY for a day-rate employee type |
| Line Type | From the entry's billable flag |
| Description | Day notes, cut to the field length |
| Workforce idempotency key | `posting_line.idempotency_key`, in a field the connector extension adds |

The rate, the line amount and the cost are left blank. Business Central fills them from the resource and work type.

**How Azure Functions talks to Business Central**

- Sign-in is service to service: an Entra ID app registration per environment, the OAuth client credentials flow, and the app registered on Business Central's Microsoft Entra Applications page. It holds only the connector's permission set (PRD AC-08).
- Reads use Business Central's standard API v2.0 where it covers the entity (employees, dimensions and dimension values). Everything else goes through a custom API page in a small AL extension, the Qnipay Workforce Connector: resources, jobs, job tasks, work types, journal lines and posting status.
- The connector extension adds an idempotency key field to the journal or time sheet line, with a unique index. Business Central itself then refuses a second line with the same key.
- Master-data changes arrive through Business Central API webhook subscriptions where the entity supports them. A nightly delta sync catches anything missed. Subscriptions expire, so a timer function renews them; check the current expiry period for the target version.
- Calls are batched with OData `$batch` and kept inside Business Central's published API limits. A 429 response is retried after its `Retry-After`.

**Posting flow**

1. A manager approves a day, or a bulk set. In the same database transaction, the API sets the day to approved, writes a `posting_batch` and its `posting_line` rows in state `queued`, and writes the audit row.
2. An outbox message goes to the Azure Service Bus queue `bc-posting`. The message holds the batch id only.
3. The posting function reads the lines, builds the journal lines with their idempotency keys and sends them to the connector API.
4. Business Central confirms with its entry numbers. Only then does the line become `posted`, with `bc_entry_no` and `posted_at`.
5. A timeout or 5xx is unknown, not failed. Before any retry, the function asks the connector whether a line with that idempotency key exists. If it does, the line becomes `posted` without sending it again.
6. A transient error (429, 5xx, timeout) retries with backoff: 1, 5, 15 and 60 minutes. After 4 attempts the line becomes `failed`.
7. A data error (unknown job task, blocked resource, closed period) becomes `failed` at once, with Business Central's message in plain words. An admin fixes the data and retries from Integrations.
8. A nightly reconciliation compares posted lines with Business Central's job ledger by idempotency key and marks them `reconciled`. A mismatch raises an exception for the integration owner.

&#91;embedded content: posting line states · 6 states, 7 transitions\]

A timeout never marks a line failed by itself: the worker first asks Business Central for the idempotency key, so a line that already landed is marked posted instead of being sent twice.

## Integration criteria

The integration is done when every criterion below passes in an automated test against a Business Central sandbox. The IDs carry into the test names.

| ID | Criterion | How it is tested |
| --- | --- | --- |
| IC-01 | Approving a day writes its posting lines in the same transaction. If the approval fails, no line exists. | Fault injected after the line insert; nothing committed. |
| IC-02 | A line shows `posted` only after Business Central returns an entry number for it. Queued is queued. | The connector mock answers late; the line stays `queued` until the answer arrives. |
| IC-03 | Posting the same line twice never creates two journal lines. | Send the same idempotency key twice; Business Central holds one line. |
| IC-04 | A timeout is checked by idempotency key before any retry. | The connector times out after committing; the retry finds the line and marks it `posted`. |
| IC-05 | Transient errors retry 4 times with backoff, then become `failed`. Each try writes a `posting_attempt` row. | 503 four times in a row. |
| IC-06 | A data error fails at once with Business Central's message in plain words, and stays retryable after the data is fixed. | Post to a job task that is not on the job. |
| IC-07 | A retry needs the `integration` capability and the line's current version, and writes an audit row naming the attempt number. | API test on `POST /integration/attempts/:id/retry`. |
| IC-08 | No request to Business Central carries a rate, amount, cost or currency. | Payload schema lint on every outbound message. |
| IC-09 | A person without a Business Central resource number, or an entry without a job and task, cannot be approved. The refusal says what is missing. | API test on approve and bulk approve. |
| IC-10 | Nightly reconciliation marks every posted line `reconciled` or raises an exception. | Delete a line in the sandbox; the next run flags it. |
| IC-11 | Master-data sync is add and update only. A job or resource removed in Business Central is marked inactive in Workforce, never deleted while timesheets use it. | Block a resource in the sandbox. |
| IC-12 | Codes never change. A renamed job keeps its job number; a different number is a new row. | Rename a job; sync. |
| IC-13 | Bulk approval of 300 days returns within 2 seconds and posts in the background. | Load test. |
| IC-14 | The queue drains within the tenant's cut-off window at 500 resources. | Load test against the sandbox with its API limits. |
| IC-15 | Each call carries a correlation id from the approval request to the Business Central call and back to the audit row. | Trace one approval through Application Insights. |
| IC-16 | One tenant's posting failures never block another tenant's queue. | Two tenants, one with a broken link. |

## Non-functional requirements

The targets come from the PRD (§32) and TIMESHEET\_PHASE1 (§6.2, §8), at 500 resources per tenant.

| Area | Requirement |
| --- | --- |
| Week read | Under 300 ms at the 95th percentile |
| Day save | Under 200 ms at the 95th percentile |
| Approval queue | First page under 500 ms with 500 days pending |
| Bulk approve | 300 days accepted in under 2 s; posting completes in the background |
| Data volume | 250,000 to 625,000 timesheet detail rows a year per tenant; audit 2 to 4 times that. Partition or archive audit by year. |
| Indexes | (tenant, person, week), (tenant, state, approver location), (tenant, period, state), and audit (tenant, entity, at) |
| Tenant isolation | `tenant_id` on every row, row-level security in SQL, tenant in every log line |
| Secrets | Key Vault for the Business Central client secret and SQL credentials; managed identity between Azure services |
| Personal data | Bank details and onboarding answers encrypted at column level. Never logged, never in audit before or after values. |
| Rate limits | Per tenant and per user at Azure API Management, so one tenant cannot starve others |
| Observability | Application Insights with a correlation id per request. Integration dashboard of queued, posted, failed, retrying and reconciled. Alerts on queue depth, failure rate and age of the oldest queued line. |
| Availability | Function app and SQL in one region with zone redundancy. Service Bus keeps queued postings through an outage. |
| Backup | Azure SQL point-in-time restore for 35 days; long-term retention for audit per the customer's policy |
| Cold start | Flex Consumption or Premium plan with always-ready instances, so the first request of the day stays inside the targets |
| Environments | Dev, test (with a Business Central sandbox) and production. Each has its own SQL database, Service Bus namespace and Entra app registration. |

## Delivery plan

The swap goes module by module, following the PRD's phase order. The fake API keeps serving every endpoint not yet built, so the app works at every step. A switch in the front end's config sends a listed set of endpoints to the real API and lets the fake server answer the rest.

1. **Foundations.** Infrastructure as code (Bicep) for all three environments. SQL schema and migrations, Entra ID sign-in, the request pipeline, audit, tenant, access, people and dimensions. The `tenant_bc_link` and nightly master-data sync from a Business Central sandbox.
   - Gate: the People and Setup screens run on the real API, and resources, jobs and dimensions arrive from the sandbox.
2. **Timesheet, clocking and posting.** Day, week and approval endpoints, clocking, the Qnipay Workforce Connector extension in the sandbox, the Service Bus posting pipeline, retry and reconciliation.
   - Gate: IC-01 to IC-16 pass against the sandbox, and one real week posts end to end.
3. **Configuration and communication.** Templates, approval chains, delegations, notification matrix and inbox, notices, home and documents.
   - Gate: the 1c screens run on the real API.
4. **Rota.** Weeks, cells, publish, patterns, cover and IT requests.
5. **Leave.** Requests, approvals, entitlement, sickness and the rota link.
6. **Onboarding.** Cases, tracker, setup. Uploads stay metadata-only until a document store is chosen.

**Testing**

- **Contract tests:** every response is validated against the zod schema in test environments, as the fake server does today.
- **Handler tests:** the 2,039 unit tests in the repo are ported where they test a handler. They run against a containerised SQL Server with the seed loaded.
- **End-to-end:** the 172 Playwright journeys run unchanged against the real API with a seeded test tenant. A green run is the gate for each phase.
- **Integration:** the IC tests run against a Business Central sandbox nightly, plus a mocked connector in every pull request.
- **Load:** the NFR targets are checked before the first customer goes live.

## Open questions and decisions needed

The decisions marked D below change the design if answered differently. ADR-000 (stack) and ADR-001 (Business Central timesheet model) are referenced in the specs but not written yet; D1 to D3 are their content.

- [ ] **D1. Where approved hours land in Business Central.** This design posts Job Journal lines through the connector extension. The PRD (Q1, §6.2) recommends extending Business Central's own Time Sheet instead, with start, finish and break fields added. The Time Sheet route keeps Business Central's approval states but needs more AL work. Decide before phase 2.
- [ ] **D2. System of record.** The PRD says "Business Central is the backend". This design keeps the operational record (drafts, rota, leave, onboarding, notifications, audit) in Azure SQL, and keeps Business Central as the record for master data and posted time. Confirm that split.
- [ ] **D3. Stack.** Azure Functions in TypeScript on Node 22 (reuses the existing contract and domain code), Azure SQL, Service Bus, API Management, Key Vault, Application Insights, and Static Web Apps for the React app. Confirm, or name the alternative (.NET isolated, Cosmos DB).
- [ ] **D4. Resource, Employee and user mapping** (PRD WC-01, ADR-002). Is every Workforce person a Business Central Resource? Which also need an Employee record? How is the Entra user linked?
- [ ] **D5. Contracted hours.** Business Central's Resource has no contracted-hours field. Hold it in Workforce only, or add it in the connector extension? (PRD Q2)
- [ ] **D6. Two-stage approval.** The approval chain declares a payroll stage, but the app enforces one stage today. Build the second stage before the first live posting? (PRD AP-08)
- [ ] **D7. Source of rota profiles and leave opening balances.** No screen writes them. Do they come from Business Central, an HR system, or a one-off import?
- [ ] **D8. Onboarding files.** Keep metadata only, or add Azure Blob Storage with malware scanning?
- [ ] **D9. Email and SMS.** Notifications are in-app only. Add Azure Communication Services, and when?
- [ ] **D10. Scope.** Scope is one location per person. Do managers need department scope or several locations, and should delegation take part in the permission check (PRD AP-10)?
- [ ] **D11. Target Business Central version.** Confirm the version, its API limits, its webhook support for the entities above and the subscription expiry period, against the customer's tenant (PRD Q4).
- [ ] **D12. Data clean-up before migration.** Managers, project managers and timesheet allocations are stored as names today and must become ids. The social seed's PRJ-114 points at a cost centre and location that do not exist.
