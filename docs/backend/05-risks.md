# Qnipay Workforce on Business Central: implementation risks

2026-10-13 · Status: draft for review

This document lists the risks of building the Workforce backend on Business Central, as decided in
[`04-decisions.md`](04-decisions.md). It covers the proxy (Azure Functions), the Business Central API and the
Business Central tables that hold the data. The payroll posting problems A to F are in 04 §3 and are not repeated here.

Business Central limits quoted below are approximate. Phase 0 checks them against Microsoft's current documentation.

Rating: **H** high · **M** medium · **L** low, for likelihood and impact.

## 1. Top three

These get much more expensive once tables and API pages exist, so they are settled first.

1. **R1 Throttling through one connector identity.**
2. **R2 Two people passing the same check at once.**
3. **R3 Table design locked in by Business Central's schema rules.**

## 2. Backend and database

| # | Risk | What goes wrong | Likelihood | Impact | Mitigation | Phase |
|---|---|---|---|---|---|---|
| R1 | **All traffic arrives as one Business Central user** | Business Central limits API calls per user: roughly 6,000 per 5 minutes and about 5 running at once. Every person's traffic goes through the one connector app registration, so about 500 people share one user's allowance. A Monday-morning rush of timesheets, or one manager's approval queue, can get the tenant throttled (HTTP 429). | H | H | Load-test in Phase 1. One `$batch` or view query per screen, never one call per entity. Cache reference data in the proxy (capabilities, user types, shift types, leave codes). Ask Microsoft whether a pool of connector registrations is allowed, as part of O2. | 0–1 |
| R2 | **Two people pass the same check at once** (from B5) | The proxy reads, decides, then Business Central commits. Two leave requests sent together both pass the balance check and overdraw it. Two approvers both pass `WRONG_LAYER`. A rest-rule check passes because a cell in the next week changed in between. A version check on one record does not catch these, because the rule depends on many rows. | H | H | Give each set of rows a rule depends on an **aggregate version**: a per-employee leave version, a per-employee timesheet week version, a per-site rota week version, a per-module chain version. The command checks it and bumps it in the same transaction. The second writer gets `stale`, and the proxy reads again and decides again. | 1 (design), 2 onwards |
| R3 | **Table design locked in** | On Business Central SaaS a field cannot be shortened, change type or be removed, and an enum value cannot be removed, without going through obsoletion over several releases. The contract changed four operations and several shapes on 13 October alone. Tables built now carry wrong lengths, Code fields that should be Text, and Blobs for years. | H | H | Freeze each module's contract before building its tables. Prefer Text to Code for anything case-sensitive. Use generous lengths. Build each module's tables in its own phase, not all 56 at once. | Every phase |
| R4 | **Two ways to edit setup** (B7) | A change in a Business Central page skips the proxy. It can skip the audit row, Public Id and Version, the in-use checks, and refreshing the proxy's cache. The two paths drift apart. | H | M | Put audit, Version and validation in table triggers or one shared codeunit, never in API pages. Expire the proxy's reference cache using `SystemModifiedAt`, or keep it short. Test every config rule through a page and through the API. | 1 |
| R5 | **Workforce shares the payroll Employee record** | Payroll users edit `Employee` directly (Status, Termination Date, Manager No.), skipping the Workforce state machine and history. Workforce writes run W1 validation with side effects; for example, Site Code validation creates missing records. A payroll run locks employee rows while Workforce writes to them. | H | M | Subscribe to Employee changes and write them to `SIR_WF Person History`. Agree which side owns each Employee field. Test Workforce writes while a payroll run is in progress. | 1 |
| R6 | **Locks and hot rows** | Bulk approval of 300 days in one transaction holds locks for a long time. If the session writes `Last Activity` on every request, every read becomes a write to one row. "Find last + 1" numbering (leave ledger, Leave Register) makes all writers wait in line. Deadlocks under load. | M | H | Bulk approval commits in chunks inside one command, or runs as a job with progress. Update `Last Activity` at most once a minute. Use AutoIncrement keys in every `SIR_WF` table. The proxy retries a deadlock once. | 1–2 |
| R7 | **Version does not change when only child rows change** | `OnModify` does not fire when only rota cells, timesheet entries or breaks change, and it does not fire on `Modify(false)`. Two editors then overwrite each other without either being refused. | H | M | Commands bump the parent's Version explicitly. Never rely on `OnModify` alone. | 1 (conventions) |
| R8 | **Slow queries and API pages** | `$filter` on fields that are not in a key scans the table. FlowFields and Blobs on API pages are calculated per row. The 300 ms week read and the approval queue across 500 people miss their targets. | M | H | Design keys from the proxy's actual filters. Keep FlowFields and Blobs off list pages. Use one view-shaped API query (an AL query object) per screen. Every phase's exit includes its latency targets. | Every phase |
| R9 | **Data growth** | The audit event table gets a row for every change, and clock events, rota cells and the day log grow fast. Business Central storage costs money, and large tables slow every unfiltered read. | M | M | Retention policies from day one (audit archived by year). Date keys, and always filter by a date range. | 1 |
| R10 | **Partial commits** | If any W1, country-app or Workforce code called by a command does a `Commit()` partway through, an approval is half written. | M | H | Every state change is one bound action on an API page. No `Commit` in `SIR_WF` code except the posting dispatcher. Check the W1 code each command calls. | 1 |

## 3. Proxy and runtime

| # | Risk | What goes wrong | Likelihood | Impact | Mitigation | Phase |
|---|---|---|---|---|---|---|
| R11 | **Session mapping across instances** | Azure Functions instances do not share memory. Mapping an Entra token to a Business Central session needs either a shared cache or a Business Central lookup on every call, which adds latency and calls (R1). | H | M | A shared cache (for example Redis) with a short time-to-live. The Business Central session stays the source of truth. | 1 |
| R12 | **Duplicate commands** | The client sends no Idempotency-Key. A POST that times out and is retried can clock someone in twice or submit twice. | M | M | The React client sends `Idempotency-Key` on commands. The state machines refuse repeats. | 1 |
| R13 | **Time zones** | `CurrentDateTime` in Business Central is UTC. "Today", period lock, clocking and night hours are in the tenant's time zone. Bugs appear around midnight and when the clocks change. | M | M | Convert with the tenant's time zone in exactly one place. Tests on the clock-change dates. | 1–2 |
| R14 | **Background jobs failing quietly** | SLA escalation, notice expiry, idempotency cleanup and later the posting dispatcher run on the job queue. Job queue entries go On Hold and stop without telling anyone. | M | M | Monitoring and alerts on job queue status. A health endpoint on the proxy. | 3 onwards |
| R15 | **Mapping customers to Business Central** | Each customer is one Business Central environment and company, with its own consent and app registration. A routing mistake sends one customer's data to another. | L | H | A routing table, with the tenant carried in the signed token. Tenant isolation tests. | 1 |

## 4. Security and data

| # | Risk | What goes wrong | Likelihood | Impact | Mitigation | Phase |
|---|---|---|---|---|---|---|
| R16 | **The connector can read everyone's data** | Under B5 the proxy alone applies location scope on reads. One proxy bug exposes other sites' people, bank details or onboarding data. | M | H | Mask sensitive fields on the API pages themselves. Separate API pages for sensitive data. Scope tests in the contract suite. | 1 |
| R17 | **Erasure against append-only audit** | A right-to-erasure request clashes with audit and history rows that cannot change. | L | M | Keep personal data out of audit, as 01 §4.1 already requires. An erasure routine that blanks personal fields in history. | 1 |
| R18 | **Migrating the seed and customer data** | The mock seed and existing customer data must be loaded into Business Central: ids, managers from names to codes (B15), address splits, codes that must keep their case. | M | M | A migration script with round-trip checks, run in Phase 1. | 1 |

## 5. Programme

| # | Risk | What goes wrong | Mitigation | Owner |
|---|---|---|---|---|
| R19 | **Licensing changes the architecture** (O2) | If Microsoft requires a licence per person, the cost changes. If calls must then be made as each user, R1 changes completely. | Settle O2 before Phase 1 starts. | Product, licensing |
| R20 | **The contract keeps moving** | The backend is built against a moving target and 02 and 03 fall behind again. | Generate 03 and the contract tests from `ENDPOINTS`, so drift shows as a failing test. Freeze each module's contract before its phase. | Architecture |
| R21 | **Business Central development is slow to iterate** | Each change needs a sandbox deploy and AL tests. Proxy work runs ahead of AL work and waits on it. | A fake Business Central for the proxy's unit tests. The real sandbox for contract tests. AL work starts a phase earlier than the proxy work for the same module. | Engineering |
| R22 | **Payment is not wired before go-live** (B11) | Modules can be switched on without being paid for. | Decide B11 before the first paying customer, and add it to that milestone's exit. | Product |

## 6. Review

This list is reviewed at the end of each phase in 04 §2. Closed risks stay in the table, with the date and how they were closed.
