# Qnipay Workforce on Business Central: backend design

2026-10-12 · Status: draft for review

This document says how Business Central, with the Qnipay payroll apps, becomes the backend
of the Qnipay Workforce app. It maps the 58 tables of the Workforce backend design
([`00-workforce-backend-design.md`](00-workforce-backend-design.md)) to existing
Business Central and Qnipay tables, and it specifies the new tables and fields that must be built.

Companion documents:

- [`02-field-mapping.md`](02-field-mapping.md): every contract field mapped to a Business Central table and field.
- [`03-api-endpoints.md`](03-api-endpoints.md): every contract operation mapped to a Business Central API entity set or command.

Sources read for this design:

- Workforce: `C:\dev\qnipay-workforce-app\src\contract\*.ts` (the zod contract) and `contract\openapi.json` (172 operations, 138 paths).
- Business Central: `src/Apps/W1/Qnipay.W1` (170 tables in the repo, 25 table extensions) and `src/Apps/NZ/Qnipay.NZ`.

## 1. Decisions taken

| # | Decision | Chosen | Consequence |
|---|---|---|---|
| B1 | Where approved hours and leave land | **Qnipay payroll.** Hours go to `SIR Timesheet Interface`; leave goes to `SIR Leave Register` and `SIR Leave Register Detail`. | The design doc's Job Journal route (its D1) is not used. Business Central Jobs are master data only. |
| B2 | System of record | **Business Central is the backend.** Every Workforce entity has a Business Central table. | Azure SQL is not used. The Azure Functions become a thin proxy. Supersedes the design doc's D2. |
| B3 | API style | **Custom API pages** (OData v4), one entity set per table, plus command entity sets for state changes. | Standard ETag concurrency, `$batch`, `$filter`, `$expand` and paging. |
| B4 | Table strategy | **Hybrid.** Master data reuses and extends Business Central and Qnipay tables. Operational workflow lives in new `SIR_WF` tables. Final approval posts into Qnipay's inbound tables. | One master record. Payroll is unchanged. Workforce states never leak into payroll states. |

## 2. Architecture

```
React app ──HTTPS──> Azure Functions (proxy)
                       · validates the Entra ID token
                       · maps the contract to Business Central calls
                       · computes derived, display-only fields with src/domain
                       └──OAuth client credentials──> Business Central API
                             /api/qnipay/workforce/v1.0/companies({id})/<entitySet>
                               └─ Qnipay Workforce app (SIR_WF)
                                    ├─ new SIR_WF tables (workflow, config, audit)
                                    ├─ extensions of Employee, SIR Work Sites, SIR Leave Code, ...
                                    └─ on final approval ──> SIR Timesheet Interface
                                                         ──> SIR Leave Register (+ Detail)
                                                               └─ Qnipay W1 payroll run (unchanged)
```

Rules on each side of the boundary:

- **Business Central enforces every invariant on write.** That covers state machines, code uniqueness, the in-use check, self-approval, location scope, capability, versions and the audit row. A client that bypasses the proxy cannot break a rule.
- **The proxy computes presentation only.** Labels, tones, minutes, advisory flags, balances and texts come from the existing TypeScript `src/domain` package, on data read from Business Central. The proxy also applies location scope to reads with `$filter`, and the scope comes from Business Central's `myScope` entity set.
- **No money crosses the API.** No `SIR_WF` table holds a rate, an amount or a currency. The reused Qnipay tables do have amount fields, but no Workforce API page exposes them.

## 3. App packaging

| Item | Value |
|---|---|
| App name | Qnipay Workforce |
| Folder | `src/Apps/WF/Qnipay.Workforce/App` (+ `Test/`) |
| Dependencies | Qnipay W1 only. Never a country app ([ADR 0001](../adr/0001-one-app-per-country.md)). |
| Affix | `SIR_WF`. Never bare `SIR`. |
| Namespace | `Qnipay.Workforce.<Area>` (Foundation, People, Timesheet, Clock, Rota, Leave, Onboarding, Communication, Posting, Api) |
| Object range | **To be allocated: about 300 IDs.** The app installs beside Qnipay W1 and a country app, so its range must not overlap W1 (`73642225–73642424`), NZ (`73642025–73642224`) or the DK and SG range (`70702675–70703099`). This document gives IDs as offsets, `WF+n`. |
| Table extension field IDs | Inside the same allocated range, as `WF+n`. |
| Permission sets | `SIR_WF Connector` (the proxy's app registration: read and write on every API page) and `SIR_WF Admin` (the setup pages in the client). |

Country coupling: the onboarding case writes the tax number. In NZ that is `SIR_NZ IRD Number` on `Employee`. Qnipay Workforce raises an integration event, `OnApplyOnboardingTaxNumber`, and a small subscriber in Qnipay NZ handles it. W1 and the Workforce app stay country-neutral.

## 4. Conventions

### 4.1 How the design doc's rules become Business Central rules

| Design doc rule | Business Central implementation |
|---|---|
| `tenant_id` on every row, row-level security | One Business Central company is one tenant. No column. The design doc's `tenant_bc_link` and `bc_sync_state` are dropped. |
| Opaque `id`, string `public_id` | The platform `SystemId` (Guid) is the API `id`. The contract's string ids (`per_EMP001`, `tsd_EMP001_2026-08-13`) are kept in `Public Id` (Text[50]) with a unique secondary key. |
| `version` and If-Match, 412 `stale` | A `Version` field (Integer) is set to 1 on insert and incremented in `OnModify`. The API page also carries `@odata.etag`. The proxy sends `If-Match` with the etag and maps the contract version to it. A command that carries `version` compares it with the stored `Version` and refuses with `stale` (412). |
| Codes unique and never changed | The code is the primary key. `OnRename` raises `invalid` (422) with `field: code`, as the contract's `z.never()` does. |
| Nothing in use can be deleted (409 `usedBy`) | `OnDelete` calls `SIR_WF Usage Check.AssertNotInUse(RecordRef)`. It raises `in-use` (409) with the `usedBy` JSON (see 4.3). |
| One audit row per change | `SIR_WF Audit Event`, written by `SIR_WF Audit.Write(...)` in the same transaction. A no-op write writes nothing and returns an empty `auditId`. The Business Central Change Log is not used, because it cannot hold the reason, the viewing-as person or the correlation id. |
| JSON configuration columns | A Blob field holds the JSON, and the API page exposes it as a Text property. The proxy validates it with the same zod schema before writing. A row that is queried, filtered or joined gets real fields. |
| No rate, amount or currency | Applies to every `SIR_WF` table and field. The test app scans field names and types (Decimal fields named `*Amount*`, `*Rate*`, `*Currency*`) in the `SIR_WF` range. |
| Idempotency-Key | `SIR_WF Idempotency Key` stores the key, the operation, the result and an expiry 24 hours on. A repeated key returns the stored result. |
| Personal data | Bank details stay in `SIR Employee Bank Account`, and the API pages return them masked (last 4 characters). Sensitive onboarding answers are a Blob with `DataClassification = EndUserIdentifiableInformation`, never copied into the audit. |
| Server time | Every timestamp is `CurrentDateTime` in Business Central. Clock events never take a time from the client. |

### 4.2 Standard fields on every `SIR_WF` table the API writes

| No. | Field | Type | Notes |
|---|---|---|---|
| 9900 | Public Id | Text[50] | Unique secondary key `PublicId`. Filled on insert by `SIR_WF Public Id.Next(TableNo, Prefix)` when blank. |
| 9901 | Version | Integer | 1 on insert, +1 on every modify. |

`SystemId`, `SystemCreatedAt`, `SystemModifiedAt` and `SystemModifiedBy` are platform fields. The API exposes `SystemModifiedAt` as `updatedAt`.

### 4.3 Refusals

AL raises a refusal as `Error('<CODE>: <message>')`. A refusal that carries usage adds the JSON after a bar: `in-use: This location is used by 12 people.|{"usedBy":[...]}`. The proxy parses the code before the first colon, maps it to the HTTP status and the contract's `next` text, and returns the contract refusal shape `{ code, message, next, field?, usedBy? }`. Messages are plain British English. The codes are the contract's exact strings, in the case the contract uses: platform codes are lower-kebab (`stale`, `version-required`, `invalid`, `in-use`, `not-found`, `scope`, `capability`, `module-off`, `feature-off`, `viewing-as`, `not-started`, `signed-out`, `locked`) and domain codes are upper-snake (`SELF_APPROVAL`, `WRONG_LAYER`, `TS_INVALID`, `PERIOD_LOCKED`, `ALREADY_SUBMITTED`, `QUEUE_CHANGED`, `LOOP`, `OVERLAP`, `MODULE_OFF`, `FLAG_OFF`, `LOCKED` and the rest). The full list, with HTTP statuses, is in `03-api-endpoints.md` §1.6.

### 4.4 Who is acting

The proxy calls Business Central service to service, as one Entra app registration that holds the `SIR_WF Connector` permission set. The signed-in person is identified per request by a session token:

- The `sessionOpens` command takes the Entra Object ID that the proxy has validated. It finds the `SIR_WF Account`, then opens a row in the existing W1 table `SIR Approval Session` and returns the token.
- Every command and every write through an entity page carries `sessionToken`. `SIR_WF Session.Resolve(Token)` returns the acting Employee No., the viewing-as Employee No. and the capabilities, or refuses with `signed-out` (401).
- Viewing as another person is a field on the session (`SIR_WF Viewing As Emp. No.`, a table extension on `SIR Approval Session`). While it is set, every write except `endViewAs` and sign-out refuses with `viewing-as` (403).

## 5. Table mapping

Kind: **R** reuse as is · **X** reuse and extend with `SIR_WF` fields · **N** new `SIR_WF` table · **D** derived, no table · **—** dropped.

### 5.1 Foundation, access and configuration

| Workforce table | Business Central table | Kind | Why |
|---|---|---|---|
| `tenant` | `Company Information` (name, registration, address, country) + `SIR_WF Setup` | X + N | The organisation's details already live in Company Information. Workforce-only settings go in a singleton. |
| `tenant.financial_year` | `SIR Fiscal Year` | R | Payroll's fiscal year. One source. |
| `tenant.company.payFrequency` | `SIR Pay Frequency` (via `SIR Payroll Setup."Default Pay Frequency"`) | R | |
| `tenant.bank_holidays` | `Base Calendar Change` of the calendar in `SIR Timesheet Setup."Base Calender"` | R | Payroll already reads non-working days from it. |
| `tenant.modules`, `tenant.flags` | `SIR_WF Module`, `SIR_WF Feature Flag` | N | Every request checks `module-off`, so these are rows, not JSON. |
| `tenant_bc_link` | — | — | Business Central is the backend. |
| `account` | `SIR_WF Account` | N | Entra Object ID, email, Employee No. and user type. W1's `SIR Approver Entra Object ID` on `Employee` is set from it, so the payroll approval portal and Workforce share one identity. |
| `account.grants`, `.revocations` | `SIR_WF Capability Exception` | N | One row per exception, with mode and reason. |
| `user_type` | `SIR_WF User Type` + `SIR_WF User Type Capability` | N | The matrix toggles one capability at a time, so capabilities are rows. |
| `capability`, `capability_group` | `SIR_WF Capability`, `SIR_WF Capability Group` | N | Reference data, seeded by the install codeunit. |
| `audit_event` | `SIR_WF Audit Event` | N | |
| `template` | `SIR_WF Template` | N | Shipped templates stay in the proxy. Saved and imported ones are stored. |
| `approval_chain` | `SIR_WF Approval Chain` + `SIR_WF Approval Chain Step` | N | `SIR Approval Setup Header/Line` keys on Table ID, carries amount thresholds and drives payroll batch approval. It does not fit a free-text layer list per module. |
| `delegation` | `SIR_WF Delegation` | N | |
| `notification` | `SIR Notification Entry` | X | One inbox for payslip notices and Workforce. `Seen` is `read`. `Message` (Text[250]) is the short body, and a Blob holds anything longer. The enum `SIR Notification Type` is Extensible and gets the value `Workforce`. |
| `notification_matrix` | `SIR_WF Notification Event` | N | One row per event code. |
| `notification_evidence` | `SIR_WF Notification Evidence` | N | |
| `notice`, `notice_ack` | `SIR_WF Notice`, `SIR_WF Notice Text Version`, `SIR_WF Notice Ack` | N | |
| `document` | `Document Attachment` (Table ID 5200 Employee) | X | The standard attachment store. Category, owner and source are added. |
| `payroll_document` | `SIR Posted Payroll Header` for the employee | D | The person's posted payslips, listed read-only. |

### 5.2 People and dimensions

| Workforce table | Business Central table | Kind | Why |
|---|---|---|---|
| `person` | `Employee` + W1 `SIR Employee` + `SIR_WF Employee` | X | The payroll employee is the person. See 5.2.1. |
| `person_history` | `SIR_WF Person History` | N | Needs source and reason, which the Change Log lacks. |
| `location` | `SIR Work Sites` | X | Qnipay's location: code, name, address and site manager, with default dimensions. Payroll splits pay by site. |
| person → location | `SIR Employee Sites` with `Is Default Site = true` | R | |
| `department` | `Dimension Value` of `SIR_WF Setup."Department Dimension Code"` | X | The design doc already mirrors departments to dimension values. |
| `cost_centre` | `Dimension Value` of `SIR_WF Setup."Cost Centre Dimension Code"` | X | |
| `job_profile` | `SIR_WF Job Profile` | N | Business Central has no coded job profile. |
| `project` | `Job` | X | Master data only. There is no Job Journal posting (B1). |
| `project_task` | `Job Task` | X | |
| `employee_type` | `SIR_WF Employee Type` | N | |
| `profile_change` | `SIR_WF Profile Change` | N | The last approval writes `Employee` or `SIR Employee Bank Account`. |
| `pay_code` | `SIR TIme Sheet Elements` | X | `SIR Timesheet Interface."Interface Code"` resolves through `External Field Mapping` to the `Pay Element`. So the Workforce pay code **is** `External Field Mapping`. |

#### 5.2.1 Person on Employee

| Workforce | Business Central | Note |
|---|---|---|
| code | `Employee."No."` | Code[20]. Immutable. |
| name | `First Name`, `Middle Name`, `Last Name` | The proxy splits on the last space and joins for reads. `SIR_WF Display Name` keeps the name exactly as typed. |
| email | `Company E-Mail` | |
| phone | `Mobile Phone No.` | |
| address | `Address`, `Address 2`, `City`, `Post Code` | The contract's single string is split on commas. |
| emergency name and phone | `Employee Relative` row with `SIR_WF Emergency Contact = true` | |
| bank account, sort code | `SIR Employee Bank Account` (`Bank Account No.`, `Bank Branch No.`), the one in `SIR Preferred Bank Acc. Code` | Masked in every response. |
| job profile | `SIR_WF Job Profile Code` | New field. |
| employee type | `SIR_WF Employee Type Code` | New field. |
| category | `SIR_WF Category` | New field. |
| location | default `SIR Employee Sites."Site Code"` | |
| department, cost centre | `Default Dimension` (Table 5200) for the two dimension codes | |
| manager | `Manager No.` | Base field. Replaces the free-text manager name (design doc D12). |
| contracted hours | `SIR Contracted Hours` | W1 field. This answers design doc D5. |
| max hours, night, CIS | `SIR_WF Max Hours`, `SIR_WF Night Worker`, `SIR_WF CIS` | New fields. |
| resource | `Resource No.` | Base field. |
| start, end | `Employment Date`, `Termination Date` | |
| state | `SIR_WF State` | New enum with 7 values, synchronised to base `Status` (see 02 §2). |
| user type | `SIR_WF Account."User Type Code"` | |

### 5.3 Timesheet and clocking

| Workforce table | Business Central table | Kind |
|---|---|---|
| `timesheet_config` | `SIR_WF Timesheet Config` | N |
| `timesheet_day` | `SIR_WF Timesheet Day` | N |
| `timesheet_entry` | `SIR_WF Timesheet Entry` | N |
| `timesheet_break` | `SIR_WF Timesheet Break` | N |
| `timesheet_day_history` | `SIR_WF Timesheet Day Log` | N |
| `clock_record` | `SIR_WF Clock Record` + `SIR_WF Clock Event` | N |

`SIR Timesheet Header/Line` is not used for the Workforce day. Those records are released payroll documents per site and period. The interface worksheet is their only way in, and Workforce feeds that worksheet (see §7).

### 5.4 Rota

| Workforce table | Business Central table | Kind | Why |
|---|---|---|---|
| `shift_type` | `SIR Employee Work Shift` + one `SIR Emp. Work Shift Line` (`Day = All Days`) | X | Qnipay's shift catalogue already has start, end and break times, and approval setup lines refer to it. |
| `rota_config` | `SIR_WF Rota Config` | N | |
| `pattern` | `SIR_WF Rota Pattern` + `SIR_WF Rota Pattern Person` | N | |
| `rota_week` | `SIR_WF Rota Week` | N | |
| `rota_cell` | `SIR_WF Rota Cell` | N | |
| `rota_change` | `SIR_WF Rota Change` | N | |
| `rota_profile` | `SIR_WF Rota Profile`; qualifications in `Employee Qualification` | N + R | DBS and other qualifications with expiry are a standard HR table. |
| `cover_request` | `SIR_WF Cover Request` | N | |
| `filled_shift` | `SIR_WF Filled Shift` | N | |
| `it_request` | `SIR_WF IT Request` | N | |
| `rota_set_aside` | `SIR_WF Rota Set Aside` | N | |

### 5.5 Leave

| Workforce table | Business Central table | Kind | Why |
|---|---|---|---|
| `leave_config` (settings, stages, typeLeave) | `SIR_WF Leave Config` | N | |
| `leave_config.types` | `SIR Leave Code` | X | Payroll already uses the leave codes. Icon, short name, policy, evidence and active are added. |
| `leave_config.policies` | `SIR_WF Leave Policy` + `SIR_WF Leave Service Rule` | N | `SIR Company Leave Policy` sets a proportion of salary (it values leave). The Workforce policy sets entitlement. They are different things. |
| `leave_request` | `SIR_WF Leave Request` + `SIR_WF Leave Request Log` | N | The last approval writes `SIR Leave Register` and `SIR Leave Register Detail` (§7.2). |
| `leave_ledger` | `SIR Leave Ledger Entry` | X | One ledger for payroll and Workforce. Why, counts, by and dates are added. |
| `leave_base` | `SIR Leave Ledger Entry` with `Leave Entry Type = Opening` | X | The enum `SIR Leave Entry Type` is Extensible and gets `Opening` and `TOIL`. |
| `leaver` | `Employee."Termination Date"` + `SIR_WF Leaver Note` | X | |
| `sick_episode` | `SIR_WF Sick Episode` | N | Statutory sick pay stays with the `SIR Stat. Leave Entitlement` flow. |

### 5.6 Onboarding

| Workforce table | Business Central table | Kind |
|---|---|---|
| `onboarding_config` | `SIR_WF Onboarding Config` + `SIR_WF Onboarding Doc. Type` | N |
| `onboarding_policy` | `SIR_WF Onboarding Policy` | N |
| `onboarding_case` | `SIR_WF Onboarding Case` + `SIR_WF Onboarding Document` | N |

When a starter becomes active, the case writes `Employee` (`Birth Date`, address, `Mobile Phone No.`), `Employee Relative` (emergency contacts), `Employee Qualification` (qualifications) and, through `OnApplyOnboardingTaxNumber`, the country's tax number.

### 5.7 Posting and infrastructure

| Workforce table | Business Central table | Kind |
|---|---|---|
| `posting_batch` | `SIR_WF Posting Batch` | N |
| `posting_line` | `SIR_WF Posting Line` | N |
| `posting_attempt` | `SIR_WF Posting Attempt` | N |
| `bc_sync_state` | — | — |
| (idempotency) | `SIR_WF Idempotency Key` | N |

### 5.8 Count

| Kind | Tables |
|---|---|
| New `SIR_WF` tables | 56 (§6) |
| Business Central and Qnipay tables extended | 15 (§8) |
| Reused without change | 7 (`SIR Fiscal Year`, `SIR Pay Frequency`, `SIR Pay Period`, `Base Calendar Change`, `SIR Employee Sites`, `Employee Qualification`, `SIR Posted Payroll Header`) |
| W1 or NZ objects changed | none |

## 6. New tables

The standard fields from §4.2 (`Public Id`, `Version`) are on every table below and are not repeated. Text lengths follow the contract's `max()` where it has one. Otherwise they are sized to the data. "Blob (JSON)" means a Blob that the API page exposes as a Text property.

### 6.1 Foundation and access

**WF+1 `SIR_WF Setup`** (singleton)

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Primary Key | Code[10] | |
| 10 | Template Code | Code[50] | The template applied last. |
| 11 | Time Zone | Text[100] | IANA name. |
| 12 | Date Format | Enum `SIR_WF Date Format` | dd/mm/yyyy, yyyy-mm-dd, mm/dd/yyyy |
| 13 | Clock Style | Enum `SIR_WF Clock Style` | 24h, 12h |
| 14 | Week Start | Enum `SIR Weekday` | W1 enum. Monday, Sunday, Saturday allowed. |
| 15 | Full-Time Weekly Hours | Decimal | 1 to 80. |
| 16 | Rota Horizon (Months) | Integer | 12, 6 or 3. |
| 17 | NMW Check | Boolean | |
| 18 | Bank Holiday Region | Text[30] | |
| 19 | Week Ending | Enum `SIR Weekday` | |
| 20 | First Pay Date | Date | |
| 30 | Department Dimension Code | Code[20] | TableRelation `Dimension`. |
| 31 | Cost Centre Dimension Code | Code[20] | TableRelation `Dimension`. |
| 40 | Week Grid | Enum `SIR_WF Week Grid` | hours, times |
| 41 | Week Layout | Enum `SIR_WF Week Layout` | classic, grid, days |
| 42 | Breaks Max | Integer | |
| 43 | Vehicles Max | Integer | |
| 50 | Posting Journal Delay (Min.) | Integer | How long the dispatcher waits before it picks a queued line. |
| 51 | Idempotency Retention (Hours) | Integer | Default 24. |

**WF+2 `SIR_WF Module`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Code | Code[20] | PK. CORE, TS, TS_A, TS_B, TS_C, R, L, ON. |
| 10 | Name | Text[60] | |
| 11 | Enabled | Boolean | |
| 12 | Locked | Boolean | CORE cannot be turned off. |
| 13 | Parent Module Code | Code[20] | A capture method's parent is TS. |
| 14 | Restore | Blob (JSON) | What turning the module back on restores. |

**WF+3 `SIR_WF Feature Flag`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Code | Code[20] | PK. The 39 flags. |
| 10 | Module Code | Code[20] | TableRelation `SIR_WF Module`. A flag is live only while its module is on. |
| 11 | Name | Text[80] | |
| 12 | Enabled | Boolean | |

**WF+4 `SIR_WF Account`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Email | Text[80] | PK. Lower case. |
| 10 | Entra Object ID | Guid | Unique key. |
| 11 | Employee No. | Code[20] | TableRelation `Employee`. Unique key. |
| 12 | User Type Code | Code[20] | TableRelation `SIR_WF User Type`. |
| 13 | Blocked | Boolean | |

**WF+5 `SIR_WF User Type`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Code | Code[20] | PK. employee, manager, admin. |
| 10 | Name | Text[24] | Unique ignoring case (checked in `OnValidate`). |
| 11 | Description | Text[250] | |

**WF+6 `SIR_WF User Type Capability`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | User Type Code | Code[20] | PK 1 |
| 2 | Capability Code | Code[20] | PK 2. TableRelation `SIR_WF Capability`. |
| 10 | Default | Boolean | Part of the seeded defaults (the contract's `defaults`). |
| 11 | Granted | Boolean | |

**WF+7 `SIR_WF Capability`** (reference data, not writable through the API)

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Code | Code[20] | PK. The 32 capabilities. |
| 10 | Group Code | Code[10] | own, team, cfg |
| 11 | Label | Text[100] | |
| 12 | Gate | Text[50] | Module or flag that gates it. |
| 13 | Locked For | Text[100] | Comma list of user type codes. |

**WF+8 `SIR_WF Capability Group`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Code | Code[10] | PK |
| 10 | Label | Text[60] | |
| 11 | Description | Text[250] | |
| 12 | Sort Order | Integer | |

**WF+9 `SIR_WF Capability Exception`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Account Email | Text[80] | PK 1 |
| 2 | Capability Code | Code[20] | PK 2 |
| 10 | Mode | Enum `SIR_WF Exception Mode` | grant, revoke. A revocation always wins. |
| 11 | Reason | Text[250] | Required. |
| 12 | Added By | Code[20] | Employee No. |
| 13 | Added At | DateTime | |

**WF+10 `SIR_WF Audit Event`** (append-only; `OnModify` and `OnDelete` refuse)

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Entry No. | BigInteger | PK, AutoIncrement. |
| 10 | At | DateTime | |
| 11 | Who Employee No. | Code[20] | The real signed-in person. |
| 12 | Viewing As Employee No. | Code[20] | |
| 13 | Act | Text[60] | |
| 14 | Entity | Text[60] | |
| 15 | Entity Id | Text[50] | Public Id of the record. |
| 16 | Before | Blob (JSON) | Never personal data. |
| 17 | After | Blob (JSON) | Never personal data. |
| 18 | Reason | Text[500] | |
| 19 | Source | Enum `SIR_WF Audit Source` | api, job, install |
| 20 | Correlation Id | Guid | |
| 21 | Posting Attempt Entry No. | BigInteger | |
| 22 | Device | Text[100] | |

Keys: `(Entity, At)`, `(Who Employee No., At)`, `(Correlation Id)`. Archive by year (retention policy).

**WF+11 `SIR_WF Template`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Key | Code[50] | PK |
| 10 | Name | Text[80] | |
| 11 | Description | Text[300] | |
| 12 | Scope | Text[30] | |
| 13 | Source | Enum `SIR_WF Template Source` | saved, imported |
| 14 | Saved At | DateTime | |
| 15 | Saved By | Code[20] | |
| 16 | From Key | Code[50] | |
| 17 | Body | Blob (JSON) | The whole template. |

**WF+12 `SIR_WF Approval Chain`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Module | Enum `SIR_WF Chain Module` | PK. Timesheet, Profile, Leave, Rota. |
| 10 | Saved | Boolean | False until first saved. Reads return the defaults at version 0. |

**WF+13 `SIR_WF Approval Chain Step`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Module | Enum `SIR_WF Chain Module` | PK 1 |
| 2 | Step No. | Integer | PK 2. At most 12 steps. |
| 10 | Role | Text[40] | Line manager, Service Manager, Payroll, HR administrator, Business Central. |
| 11 | Scope | Text[60] | |
| 12 | When | Text[80] | |
| 13 | SLA | Text[40] | |
| 14 | Fixed | Boolean | The Business Central posting step, last in Timesheet. |
| 15 | Capability Code | Code[20] | Derived from Role: team_ts, pay_appr, team_leave. |

**WF+14 `SIR_WF Delegation`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Entry No. | Integer | PK, AutoIncrement. |
| 10 | From Employee No. | Code[20] | |
| 11 | To Employee No. | Code[20] | Cannot equal From. Loops are refused. |
| 12 | Date From | Date | |
| 13 | Date Until | Date | Both days included. |
| 14 | Timesheet | Boolean | Modules covered. |
| 15 | Profile | Boolean | |
| 16 | Leave | Boolean | |
| 17 | Rota | Boolean | |

**WF+15 `SIR_WF Notification Event`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Code | Code[40] | PK |
| 10 | Module | Text[30] | |
| 11 | Label | Text[100] | |
| 12 | Description | Text[250] | |
| 13 | Employee Channel | Enum `SIR_WF Notif. Channel` | Off, In-app, Email, In-app + email, In-app + email + SMS |
| 14 | Manager Channel | Enum `SIR_WF Notif. Channel` | |
| 15 | Admin Channel | Enum `SIR_WF Notif. Channel` | |
| 16 | Employee Locked | Boolean | |
| 17 | Manager Locked | Boolean | |
| 18 | Admin Locked | Boolean | |

**WF+16 `SIR_WF Notification Evidence`** (append-only)

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Entry No. | BigInteger | PK, AutoIncrement. |
| 10 | Employee No. | Code[20] | |
| 11 | Event Code | Code[40] | |
| 12 | At | DateTime | |
| 13 | Recipient | Text[100] | |
| 14 | Channel | Text[30] | |
| 15 | Ref | Text[50] | |

**WF+17 `SIR_WF Notice`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Code | Code[20] | PK. NTC-0001 from a number series. |
| 10 | Text Version | Integer | +1 when the title or body changes after posting. |
| 11 | Title | Text[90] | |
| 12 | Body | Blob | Up to 4,000 characters. |
| 13 | Scope Kind | Enum `SIR_WF Notice Scope` | all, loc, dept |
| 14 | Scope Code | Code[20] | Work site or department value. |
| 15 | Scope Location | Code[20] | |
| 16 | Pinned | Boolean | |
| 17 | Urgent | Boolean | |
| 18 | Must Acknowledge | Boolean | |
| 19 | Date From | Date | |
| 20 | Date Until | Date | Blank = open-ended. |
| 21 | State | Enum `SIR_WF Notice State` | draft, live, withdrawn. The reader status (current, scheduled, expired) is derived. |
| 22 | Posted By | Code[20] | |
| 23 | Posted At | DateTime | |
| 24 | Withdraw Reason | Text[300] | |

**WF+18 `SIR_WF Notice Text Version`** (the notice history)

| No. | Field | Type |
|---|---|---|
| 1 | Notice Code | Code[20] (PK 1) |
| 2 | Text Version | Integer (PK 2) |
| 10 | Title | Text[90] |
| 11 | Body | Blob |
| 12 | By | Code[20] |
| 13 | At | DateTime |

**WF+19 `SIR_WF Notice Ack`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Notice Code | Code[20] | PK 1 |
| 2 | Employee No. | Code[20] | PK 2 |
| 3 | Text Version | Integer | PK 3. A new text version needs a new acknowledgement. |
| 10 | At | DateTime | |

### 6.2 People and dimensions

**WF+20 `SIR_WF Person History`** (append-only)

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Entry No. | BigInteger | PK, AutoIncrement. |
| 10 | Employee No. | Code[20] | Key `(Employee No., At)`. |
| 11 | At | DateTime | |
| 12 | By Employee No. | Code[20] | |
| 13 | Source | Enum `SIR_WF History Source` | created, edited, transition, profile-change |
| 14 | Field Name | Text[50] | |
| 15 | From Value | Text[250] | Bank values are stored masked. |
| 16 | To Value | Text[250] | |
| 17 | Reason | Text[500] | |

**WF+21 `SIR_WF Job Profile`**

| No. | Field | Type |
|---|---|---|
| 1 | Code | Code[20] (PK) |
| 10 | Name | Text[100] |
| 11 | Night | Boolean |

**WF+22 `SIR_WF Employee Type`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Code | Code[32] | PK. Lower-case letters, digits and underscore. |
| 10 | Name | Text[60] | |
| 11 | Category | Enum `SIR_WF Worker Category` | Contracted, Bank, Agency, Salaried |
| 12 | Entry Mode | Enum `SIR_WF Entry Mode` | form, grid, clock |
| 13 | Pay Basis | Enum `SIR_WF Pay Basis` | hour, day. Drives the unit posted (§7.1). |
| 14 | Vehicle | Boolean | Type capabilities. |
| 15 | Site | Boolean | |
| 16 | Project | Boolean | |
| 17 | Shift | Boolean | |
| 18 | Employment Type | Enum `SIR Employment Type` | W1 enum. Mapped from Category (02 §2.6). |

**WF+23 `SIR_WF Profile Change`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Entry No. | Integer | PK, AutoIncrement. |
| 10 | Employee No. | Code[20] | |
| 11 | Field Key | Enum `SIR_WF Self Field` | phone, address, emergencyName, emergencyPhone, bankAccount, bankSortCode |
| 12 | From Value | Text[250] | Masked for bank fields. |
| 13 | To Value | Blob | Kept whole until applied, then cleared for bank fields. Classified `EndUserIdentifiableInformation`. |
| 14 | Note | Text[500] | |
| 15 | Raised At | DateTime | |
| 16 | Status | Enum `SIR_WF Change Status` | pending, approved, declined |
| 17 | Stage | Enum `SIR_WF Change Stage` | manager, payroll, done |
| 18 | Route | Text[30] | "manager,payroll" |
| 19 | Decisions | Blob (JSON) | Stage, decision, by, at and reason, per decision. |

### 6.3 Timesheet and clocking

**WF+24 `SIR_WF Timesheet Config`** (singleton)

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Primary Key | Code[10] | |
| 10 | Max Daily | Decimal | Capture rules: one field per rule. |
| 11 | Warn Daily | Decimal | |
| 12 | Min Net | Decimal | |
| 13 | Variance Warn | Decimal | |
| 14 | Block Future | Boolean | |
| 15 | Enforce Rest | Boolean | |
| 16 | Enforce Lock | Boolean | |
| 17 | OT Daily | Decimal | |
| 18 | Night From | Text[5] | HH:MM |
| 19 | Night To | Text[5] | |
| 20 | Cutoff | Text[40] | |
| 21 | Time Format | Enum `SIR_WF Time Format` | HH:MM, h m |
| 22 | Return Reason Required | Boolean | |
| 30 | Field Defaults | Blob (JSON) | |
| 31 | Allowances | Blob (JSON) | Code, label, pay code, tier, element and basis. Never an amount. |
| 32 | Type Capture | Blob (JSON) | Fields, allowances and rules per employee type. |

**WF+25 `SIR_WF Timesheet Day`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Employee No. | Code[20] | PK 1 |
| 2 | Date | Date | PK 2 |
| 10 | State | Enum `SIR_WF TS State` | draft, pend, back, resub, ok, mgrok |
| 11 | Work Type | Code[20] | The derived pay code (`SIR TIme Sheet Elements."External Field Mapping"`). |
| 12 | Allowances | Text[250] | Comma list of allowance codes (at most 20). |
| 13 | Shift Code | Code[10] | `SIR Employee Work Shift`. |
| 14 | Non-Working Reason | Text[200] | |
| 15 | Capture Source | Enum `SIR_WF Capture Source` | self, proxy, clock |
| 16 | Entered By | Code[20] | Employee No. |
| 17 | Submitted At | DateTime | |
| 18 | Return Reason | Text[500] | |
| 19 | Warnings | Blob (JSON) | |
| 20 | Worked Anyway | Boolean | |
| 21 | Current Layer | Integer | Step No. of the approval chain waiting to decide. |
| 22 | Work Site Code | Code[20] | The person's location on the day, copied for the approval queue's key. |
| 23 | Posting State | Enum `SIR_WF Posting State` | none, queued, posted, failed, reconciled. Mirrors the latest posting line. |
| 24 | Last Posting Line No. | BigInteger | |

Keys: `(State, Work Site Code, Date)` for the approval queue. `(Employee No., Date)` is the primary key and serves the week read.

**WF+26 `SIR_WF Timesheet Entry`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Employee No. | Code[20] | PK 1 |
| 2 | Date | Date | PK 2 |
| 3 | Line No. | Integer | PK 3. At most 6 per day. |
| 10 | Start | Text[5] | HH:MM |
| 11 | Finish | Text[5] | |
| 12 | Hours | Decimal | The hours-only capture, read when there are no times. |
| 13 | Net Minutes | Integer | Computed on save, after breaks. |
| 14 | Job No. | Code[20] | TableRelation `Job`. |
| 15 | Job Task No. | Code[20] | TableRelation `Job Task` where `Job No.` = field. |
| 16 | Cost Centre Code | Code[20] | Dimension value. |
| 17 | Work Site Code | Code[20] | TableRelation `SIR Work Sites`. |
| 18 | Fields | Blob (JSON) | The other capture fields by code. |

**WF+27 `SIR_WF Timesheet Break`**

| No. | Field | Type |
|---|---|---|
| 1 | Employee No. | Code[20] (PK 1) |
| 2 | Date | Date (PK 2) |
| 3 | Entry Line No. | Integer (PK 3) |
| 4 | Line No. | Integer (PK 4), at most 5 |
| 10 | Start | Text[5] |
| 11 | End | Text[5] |

**WF+28 `SIR_WF Timesheet Day Log`** (append-only)

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Entry No. | BigInteger | PK, AutoIncrement. |
| 10 | Employee No. | Code[20] | Key `(Employee No., Date, Entry No.)`. |
| 11 | Date | Date | |
| 12 | From State | Enum `SIR_WF TS State` | |
| 13 | To State | Enum `SIR_WF TS State` | |
| 14 | By Employee No. | Code[20] | |
| 15 | At | DateTime | |
| 16 | Reason | Text[500] | |
| 17 | Layer | Text[40] | Chain role the approval was made as. |

**WF+29 `SIR_WF Clock Record`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Employee No. | Code[20] | PK 1 |
| 2 | Date | Date | PK 2 |
| 10 | Late | Boolean | |
| 11 | Closed Late Finish | Text[5] | |
| 12 | Closed Late At | DateTime | |
| 13 | Written Breaks | Blob (JSON) | Null until the clock first writes the day. |
| 14 | Closed No Day Finish | Text[5] | |
| 15 | Closed No Day At | DateTime | |

**WF+30 `SIR_WF Clock Event`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Employee No. | Code[20] | PK 1 |
| 2 | Date | Date | PK 2 |
| 3 | Seq | Integer | PK 3 |
| 10 | Kind | Enum `SIR_WF Clock Kind` | in, breakStart, breakEnd, out |
| 11 | At | DateTime | `CurrentDateTime` only. |

### 6.4 Rota

**WF+31 `SIR_WF Rota Config`** (singleton)

| No. | Field | Type |
|---|---|---|
| 1 | Primary Key | Code[10] |
| 10 | Min Default | Integer |
| 11 | Max Hours | Decimal |
| 12 | Cap Tolerance | Decimal |
| 13 | Rest Hours | Decimal |
| 14 | Rest Warn | Boolean |
| 15 | Max Consecutive | Integer |
| 16 | Horizon | Integer |
| 17 | Favourite Head Start | Integer |
| 18 | Flex Milestones | Text[100] (comma list, at most 12) |
| 19 | Flex Notify To | Text[80] |
| 20 | IT Access | Boolean |
| 21 | Agency Manual | Boolean |
| 22 | Bank Holiday Enhanced | Boolean |
| 23 | Outlook | Boolean |
| 24 | Publish Block On Gap | Boolean |
| 25 | Rota Built By | Text[30] |
| 30 | Safe Rules | Blob (JSON) |
| 31 | Fulfil Stages | Blob (JSON) |
| 32 | Type Rota | Blob (JSON) |

**WF+32 `SIR_WF Rota Pattern`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Code | Code[20] | PK |
| 10 | Name | Text[100] | |
| 11 | Cycle (Days) | Integer | |
| 12 | Work Site Codes | Blob (JSON) | Up to 20 codes. |
| 13 | Job Profile Codes | Blob (JSON) | Up to 20 codes. |
| 14 | Cost Centre Code | Code[20] | |
| 15 | Starts | Text[20] | |
| 16 | Horizon | Integer | |
| 17 | Generate | Text[20] | |
| 18 | Generate From | Date | |
| 19 | Generate To | Date | |
| 20 | Active | Boolean | |
| 21 | Days | Blob (JSON) | One shift code per cycle day. |

**WF+33 `SIR_WF Rota Pattern Person`**

| No. | Field | Type |
|---|---|---|
| 1 | Pattern Code | Code[20] (PK 1) |
| 2 | Employee No. | Code[20] (PK 2) |
| 10 | Offset | Integer |

**WF+34 `SIR_WF Rota Week`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Work Site Code | Code[20] | PK 1 |
| 2 | Week Start | Date | PK 2 |
| 10 | State | Enum `SIR_WF Rota State` | draft, review, published, amendment, republished |
| 11 | Publish Version | Integer | |
| 12 | Published At | DateTime | |
| 13 | Published By | Code[20] | |
| 14 | Sign-off | Blob (JSON) | Requested by, layers signed and who signs next, while the week waits on the Rota approval chain. |
| 15 | Sent Back By | Code[20] | |
| 16 | Sent Back At | DateTime | |
| 17 | Sent Back Reason | Text[300] | |

**WF+35 `SIR_WF Rota Cell`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Work Site Code | Code[20] | PK 1 |
| 2 | Week Start | Date | PK 2 |
| 3 | Employee No. | Code[20] | PK 3 |
| 4 | Day | Integer | PK 4. 0 to 6. |
| 10 | Value | Code[4] | A shift code, blank (rest), V (leave) or S (sickness). |
| 11 | Date | Date | Week Start + Day. Key `(Employee No., Date)` for My shifts. |

**WF+36 `SIR_WF Rota Change`** (append-only)

| No. | Field | Type |
|---|---|---|
| 1 | Entry No. | BigInteger (PK) |
| 10 | Work Site Code | Code[20] |
| 11 | Week Start | Date |
| 12 | At | DateTime |
| 13 | By Employee No. | Code[20] |
| 14 | Employee No. | Code[20] |
| 15 | Date | Date |
| 16 | From Value | Code[4] |
| 17 | To Value | Code[4] |
| 18 | Why | Text[200] |
| 19 | After Publish | Boolean |
| 20 | Week Version | Integer |

**WF+37 `SIR_WF Rota Profile`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Employee No. | Code[20] | PK |
| 10 | Cleared | Boolean | |
| 11 | Favourite | Boolean | |
| 12 | Preferred Days | Text[30] | Comma list of 0 to 6. |

DBS expiry and qualifications are `Employee Qualification` rows (base table: `Qualification Code`, `Expiration Date`).

**WF+38 `SIR_WF Cover Request`**

| No. | Field | Type |
|---|---|---|
| 1 | Entry No. | Integer (PK, AutoIncrement) |
| 10 | Work Site Code | Code[20] |
| 11 | Date | Date |
| 12 | Shift Code | Code[4] |
| 13 | Reason | Text[40] |
| 14 | Stage | Integer |
| 15 | Open | Boolean |
| 16 | Urgent | Boolean |
| 17 | Opened At | DateTime |
| 18 | Asked | Text[100] |
| 19 | Log | Blob (JSON) |

**WF+39 `SIR_WF Filled Shift`**

| No. | Field | Type |
|---|---|---|
| 1 | Entry No. | Integer (PK, AutoIncrement) |
| 10 | Cover Entry No. | Integer |
| 11 | Work Site Code | Code[20] |
| 12 | Date | Date |
| 13 | Shift Code | Code[4] |
| 14 | Employee No. | Code[20] |
| 15 | Confirmed | Boolean |
| 16 | IT Request Ref | Code[20] |

**WF+40 `SIR_WF IT Request`**

| No. | Field | Type |
|---|---|---|
| 1 | Ref | Code[20] (PK, ITR-1007) |
| 10 | Employee No. | Code[20] |
| 11 | Work Site Code | Code[20] |
| 12 | Shift Code | Code[4] |
| 13 | Date | Date |
| 14 | Worker | Text[100] |
| 15 | Status | Text[30] |
| 16 | Raised At | DateTime |
| 17 | System | Text[50] |

**WF+41 `SIR_WF Rota Set Aside`**

| No. | Field | Type |
|---|---|---|
| 1 | Work Site Code | Code[20] (PK 1) |
| 2 | Week Start | Date (PK 2) |
| 10 | Lines | Blob (JSON) |

### 6.5 Leave

**WF+42 `SIR_WF Leave Config`** (singleton)

| No. | Field | Type |
|---|---|---|
| 1 | Primary Key | Code[10] |
| 10 | SLA Days | Integer |
| 11 | TOIL Max | Decimal |
| 12 | TOIL Window | Integer |
| 13 | Bank Holiday Paid | Boolean |
| 14 | Absence Trigger | Integer |
| 15 | Auto Entitlement | Boolean |
| 16 | Blocks Timesheet | Boolean |
| 17 | Affects Rota | Boolean |
| 18 | Min Notice | Integer |
| 19 | Cancel Window | Integer |
| 20 | Fin. Year Start | Text[5] (MM-DD) |
| 30 | Sickness Reasons | Blob (JSON) |
| 31 | Stages | Blob (JSON) |
| 32 | Type Leave | Blob (JSON) (policy and unit per employee type) |

**WF+43 `SIR_WF Leave Policy`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Code | Code[10] | PK |
| 10 | Name | Text[60] | |
| 11 | Method | Enum `SIR_WF Leave Method` | The domain's LEAVE_METHODS. |
| 12 | Unit | Enum `SIR_WF Leave Unit` | days, hours, weeks |
| 13 | Base | Decimal | |
| 14 | Pro Rata | Boolean | |
| 15 | Carry | Decimal | |
| 16 | Approval | Boolean | |
| 17 | SLA Days | Integer | Blank = tenant default. |
| 18 | Bank Holiday Handling | Enum `SIR_WF BH Handling` | The domain's BANK_HOLIDAY_HANDLING. |

**WF+44 `SIR_WF Leave Service Rule`**

| No. | Field | Type |
|---|---|---|
| 1 | Policy Code | Code[10] (PK 1) |
| 2 | Line No. | Integer (PK 2) |
| 10 | After Years | Decimal |
| 11 | Add | Decimal |
| 12 | Cap | Decimal |

**WF+45 `SIR_WF Leave Request`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Entry No. | Integer | PK, AutoIncrement. |
| 10 | Employee No. | Code[20] | Key `(Employee No., Date From)`. |
| 11 | Leave Code | Code[20] | TableRelation `SIR Leave Code`. |
| 12 | Date From | Date | |
| 13 | Date To | Date | |
| 14 | Part | Enum `SIR_WF Leave Part` | full, am, pm, hours |
| 15 | Quantity | Decimal | |
| 16 | Unit | Enum `SIR_WF Balance Unit` | days, hours |
| 17 | State | Enum `SIR_WF Leave State` | pending, approved, declined, cancelled |
| 18 | Raised At | DateTime | |
| 19 | Note | Text[200] | |
| 20 | Impact | Text[250] | The effect on cover when it was sent. |
| 21 | Short | Boolean | |
| 22 | Escalated | Boolean | |
| 23 | Decided At | DateTime | |
| 24 | Decided By | Code[20] | |
| 25 | Decline Reason | Text[300] | |
| 26 | Current Layer | Integer | |
| 27 | Work Site Code | Code[20] | Copied for the team queue's key. |
| 28 | Register Entry No. | Integer | `SIR Leave Register."Entry No."` once approved. |

**WF+46 `SIR_WF Leave Request Log`** (append-only; the request history)

| No. | Field | Type |
|---|---|---|
| 1 | Entry No. | BigInteger (PK) |
| 10 | Request Entry No. | Integer |
| 11 | From State | Text[20] |
| 12 | To State | Text[20] |
| 13 | By Employee No. | Code[20] |
| 14 | At | DateTime |
| 15 | Reason | Text[300] |
| 16 | Layer | Text[40] |

**WF+47 `SIR_WF Sick Episode`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Entry No. | Integer | PK, AutoIncrement. |
| 10 | Employee No. | Code[20] | |
| 11 | Date From | Date | |
| 12 | Date To | Date | Blank while still off. |
| 13 | Reason | Text[40] | |
| 14 | Note | Text[200] | |
| 15 | RTW Requested At | DateTime | |
| 16 | RTW Requested By | Code[20] | |

### 6.6 Onboarding

**WF+48 `SIR_WF Onboarding Config`** (singleton)

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Primary Key | Code[10] | |
| 10 | Steps | Blob (JSON) | id, label, on, fixed and desc, at most 10. |

**WF+49 `SIR_WF Onboarding Doc. Type`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Code | Code[20] | PK |
| 10 | Label | Text[60] | |
| 11 | Required | Boolean | |
| 12 | Verifier | Enum `SIR_WF Verifier` | hr, mgr, either, none |
| 13 | Blocks Start | Boolean | |
| 14 | Has Expiry | Boolean | |
| 15 | Hint | Text[200] | |
| 16 | Sort Order | Integer | |

**WF+50 `SIR_WF Onboarding Policy`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Code | Code[20] | PK |
| 10 | Label | Text[80] | |
| 11 | Ver | Text[20] | |
| 12 | Summary | Text[300] | |
| 13 | Body | Blob (JSON) | Paragraphs. |
| 14 | Sort Order | Integer | |
| 15 | File Name | Text[255] | Metadata only (design doc D8). |
| 16 | File Size | Integer | |
| 17 | File Type | Text[120] | |
| 18 | File At | DateTime | |

**WF+51 `SIR_WF Onboarding Case`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Employee No. | Code[20] | PK |
| 10 | Steps | Blob (JSON) | Task state per step. |
| 11 | Policy Acks | Blob (JSON) | Policy, version and date per acknowledgement. |
| 12 | Policies Read | Blob (JSON) | |
| 13 | Data | Blob (JSON) | Date of birth, nationality, tax number, address, emergency, convictions, qualifications. `EndUserIdentifiableInformation`. Never returned to the tracker or written to the audit. |
| 14 | Signature | Text[120] | |
| 15 | Consent | Boolean | |
| 16 | Submitted At | DateTime | |
| 17 | Ref | Code[20] | |
| 18 | Invited At | DateTime | |
| 19 | Started At | DateTime | |
| 20 | Asked | Blob (JSON) | Steps and documents asked of this starter. |

**WF+52 `SIR_WF Onboarding Document`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Employee No. | Code[20] | PK 1 |
| 2 | Doc. Type Code | Code[20] | PK 2 |
| 10 | State | Enum `SIR_WF Task State` | todo, prog, done, verified, rejected |
| 11 | File Name | Text[255] | |
| 12 | File Size | Integer | |
| 13 | File Type | Text[120] | |
| 14 | File Kind | Enum `SIR_WF File Kind` | image, pdf, file |
| 15 | File At | DateTime | |
| 16 | Preview | Blob | Image data URL only. |
| 17 | Rejection Reason | Text[300] | |
| 18 | Verified By | Code[20] | Cannot be the starter. |

### 6.7 Posting and infrastructure

**WF+53 `SIR_WF Posting Batch`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | No. | Code[20] | PK. Number series. One per approval action. |
| 10 | Created At | DateTime | |
| 11 | Created By | Code[20] | |
| 12 | Source | Enum `SIR_WF Posting Source` | timesheet, leave |
| 13 | Line Count | Integer | FlowField. |
| 14 | Total Quantity | Decimal | FlowField. |
| 15 | Correlation Id | Guid | |

**WF+54 `SIR_WF Posting Line`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Entry No. | BigInteger | PK, AutoIncrement. |
| 10 | Batch No. | Code[20] | |
| 11 | Source | Enum `SIR_WF Posting Source` | |
| 12 | Employee No. | Code[20] | |
| 13 | Date | Date | Day, or the first leave day. |
| 14 | Date To | Date | Leave only. |
| 15 | Pay Code | Code[20] | `External Field Mapping` (timesheet) or Leave Code. |
| 16 | Work Site Code | Code[20] | |
| 17 | Quantity | Decimal | Hours or days. Never money. |
| 18 | Unit | Enum `SIR TS Unit of Measure` | W1 enum: Hour, Day. |
| 19 | Start DateTime | DateTime | |
| 20 | End DateTime | DateTime | |
| 21 | Leave Request Entry No. | Integer | |
| 22 | Idempotency Key | Guid | Unique key. Equals `SystemId`. |
| 23 | State | Enum `SIR_WF Posting State` | queued, posted, failed, reconciled |
| 24 | Attempt | Integer | |
| 25 | Last Error | Text[500] | In plain words. |
| 26 | Error Kind | Enum `SIR_WF Posting Error Kind` | none, transient, data |
| 27 | Target Entry No. | Integer | `SIR Timesheet Interface."Entry No."` or `SIR Leave Register."Entry No."`. |
| 28 | Queued At | DateTime | |
| 29 | Posted At | DateTime | |
| 30 | Reconciled At | DateTime | |
| 31 | Description | Text[100] | |

Key `(State, Queued At)` for the dispatcher.

**WF+55 `SIR_WF Posting Attempt`** (append-only)

| No. | Field | Type |
|---|---|---|
| 1 | Entry No. | BigInteger (PK) |
| 10 | Posting Line Entry No. | BigInteger |
| 11 | Attempt | Integer |
| 12 | At | DateTime |
| 13 | Outcome | Enum `SIR_WF Posting State` |
| 14 | Error Code | Text[50] |
| 15 | Message | Text[500] |
| 16 | Duration (ms) | Integer |

**WF+56 `SIR_WF Idempotency Key`**

| No. | Field | Type | Notes |
|---|---|---|---|
| 1 | Key | Text[100] | PK 1 |
| 2 | Operation | Text[100] | PK 2. Method and path template. |
| 10 | Employee No. | Code[20] | A key is per person. |
| 11 | Result | Blob (JSON) | The first response. |
| 12 | Expires At | DateTime | A job queue entry deletes expired rows. |

Table IDs WF+1 to WF+56 are the 56 new tables. Pages, codeunits and enums take later IDs and are listed in the implementation plan.

## 7. Posting into Qnipay

### 7.1 Approved hours to `SIR Timesheet Interface`

1. The last approval layer approves a day (or a bulk set). In one transaction, Business Central:
   - sets the day to `ok`;
   - writes one `SIR_WF Posting Batch` and one `SIR_WF Posting Line` per pay code of the day (state `queued`);
   - sets `Posting State = queued` on the day;
   - writes the audit row.
2. The job queue codeunit `SIR_WF Posting Dispatcher` runs every minute. It picks queued lines older than `Posting Journal Delay` and handles each line in its own transaction (`Commit` per line), so one bad line never blocks the rest.
3. For each line it inserts one `SIR Timesheet Interface` row. The field mapping is in `02-field-mapping.md` §8.1. The pay period comes from `SIR Pay Period`, using the employee's `SIR Pay Cycle Code` and the date (`Start Date <= date <= End Date`).
4. A table extension on `SIR Timesheet Interface` and `SIR Posted Timesheet Interface` adds `SIR_WF Posting Line Id` (Guid) with a unique key. A second insert for the same line fails at the key, so a retry can never double-post (IC-03).
5. States:

| State | Meaning | Set when |
|---|---|---|
| queued | Waiting for the dispatcher. | Approval. |
| posted | An interface row exists with this line's id. | Insert succeeded. `Target Entry No.` holds the row. |
| reconciled | Payroll consumed the row. | A subscriber on `SIR Timesheet Create Mgt` archiving finds the id in `SIR Posted Timesheet Interface`. A nightly check catches anything missed. |
| failed | Data error. | No open pay period, the period is posted, the pay code is unknown, the employee was terminated before the date, or the site is blocked. Business Central's message is stored in plain words. |

6. A transient error (lock timeout, deadlock) retries after 1, 5, 15 and 60 minutes, then becomes `failed`. Each try writes a `SIR_WF Posting Attempt` row.
7. `POST postingRetries {lineId, version, sessionToken}` re-queues a failed line. It needs the `integration` capability and writes an audit row naming the attempt number (IC-07).
8. A person with no `SIR Pay Cycle Code`, or an entry with no work site, cannot be approved. The refusal (`MISSING_PAY_SETUP`, 409) says what is missing (IC-09, adapted).

What does not reach payroll: the project and job task. `SIR Timesheet Interface` has no fields for them. They stay on `SIR_WF Timesheet Entry` and its `Job` link for reporting. This is correct under B1.

Bulk approval of 300 days commits days, batches and lines only. The interface writes happen later in the dispatcher, so IC-13 (under 2 s) is realistic.

### 7.2 Approved leave to `SIR Leave Register`

1. The last approval layer approves a request. In the same transaction, Business Central writes:
   - one `SIR Leave Register` row: `Approval Status = Approved`, `External Request ID = request SystemId`, `External ID = Public Id`;
   - one `SIR Leave Register Detail` row per leave day: `Leave Qty.`, `Unit of Measure` and `External Request Dtl ID`.

   This is synchronous, because no pay period lookup is needed. `SIR Payroll Line` already reads the Detail rows to count absence days. Nothing in W1 writes them today; the W1 code expects "an outside leave-request integration".
2. A cancel or decline after approval sets both rows to `Cancelled`. A day already inside a posted payroll run is refused with `LEAVE_IN_PAYROLL`.
3. A give-back after sickness writes a `SIR Leave Ledger Entry` adjustment and cancels the matching Detail rows.

## 8. Extensions of existing tables

Every field added by an extension is named with the `SIR_WF ` prefix (for example `SIR_WF State`, `SIR_WF Max Hours`), takes a `WF+n` ID and is listed below without the prefix.

| Table | Extension | Fields added (`WF+n`) |
|---|---|---|
| `Employee` | `SIR_WF Employee` | Public Id Text[50], Version Integer, State (enum, 7), Display Name Text[100], Employee Type Code Code[32], Job Profile Code Code[20], Category Enum, Max Hours Decimal, Night Worker Boolean, CIS Boolean, Leaver Note Text[250] |
| `SIR Approval Session` | `SIR_WF Approval Session` | Viewing As Emp. No. Code[20], Correlation Id Guid |
| `SIR Work Sites` | `SIR_WF Work Sites` | Public Id Text[50], Version Integer, Area Text[80], Support Level Text[40], Min Per Shift Integer, Active Boolean, Department Code Code[20], Cost Centre Code Code[20] |
| `Dimension Value` | `SIR_WF Dimension Value` | Public Id Text[50], Version Integer, Manager No. Code[20] |
| `Job` | `SIR_WF Job` | Public Id Text[50], Version Integer, Client Name Text[120], Budget Hours Decimal, Billable Boolean, Work Site Code Code[20], Manager Employee No. Code[20] |
| `Job Task` | `SIR_WF Job Task` | Public Id Text[50], Version Integer, Task Group Text[60], Billable Boolean |
| `SIR TIme Sheet Elements` | `SIR_WF TS Elements` | Public Id Text[50], Version Integer, Pay Basis Text[20], Multiplier Decimal (a factor, never money), Label Text[60], Work Type Boolean |
| `SIR Employee Work Shift` | `SIR_WF Work Shift` | Public Id Text[50], Version Integer, Night Boolean, Tone Enum (E, L, N), Eligible All Boolean |
| `SIR Leave Code` | `SIR_WF Leave Code` | Public Id Text[50], Version Integer, Name Text[60], Icon Text[4], Short Name Text[20], Policy Code Code[10], Paid Boolean, Evidence Boolean, Unit Enum, Active Boolean |
| `SIR Leave Ledger Entry` | `SIR_WF Leave Ledger Entry` | Why Text[250], Counts Boolean, By Employee No. Code[20], Dates Blob (JSON), Leave Year Code[20] |
| `SIR Notification Entry` | `SIR_WF Notification Entry` | Area Text[30], Title Text[100], Body Blob, Link View Text[50], Link Path Text[250], Link Label Text[60], Channel Text[30], At DateTime |
| `Employee Relative` | `SIR_WF Employee Relative` | Emergency Contact Boolean |
| `Document Attachment` | `SIR_WF Document Attachment` | Public Id Text[50], Category Text[50], Owner Text[50], Source Text[50], Document Date Date |
| `SIR Timesheet Interface`, `SIR Posted Timesheet Interface` | `SIR_WF TS Interface`, `SIR_WF Pstd TS Interface` | Posting Line Id Guid (unique key) |

A reused table that the API writes carries `SIR_WF Public Id` and `SIR_WF Version` in its extension, with the same rules as §4.2.

Enum extensions:

| Enum | Values added |
|---|---|
| `SIR Notification Type` (Extensible) | Workforce |
| `SIR Leave Entry Type` (Extensible) | Opening, TOIL, Adjustment |

`SIR Leave Code."Description"` is Text[50], but the contract allows 60 characters for a leave type name. The full name goes in `SIR_WF Name`, and `Description` holds the first 50 characters.

## 9. Integration criteria, restated

The design doc's IC-01 to IC-16 still apply, adapted to posting inside Business Central:

| ID | Change |
|---|---|
| IC-01 | Approval, batch, lines and audit commit in one Business Central transaction. |
| IC-02 | `posted` only after the interface row exists. |
| IC-03 | Guaranteed by the unique `SIR_WF Posting Line Id` key on the interface table. |
| IC-04 | No longer needed: there is no network between approval and posting. The dispatcher checks the key before inserting. |
| IC-08 | Test: no `SIR_WF` field and no API page property holds a rate, amount or currency, and the interface row's `Rate` and `Gross Pay` are blank. |
| IC-09 | The approval refuses a person with no pay cycle and an entry with no work site. |
| IC-10 | Reconciliation compares posted lines with `SIR Posted Timesheet Interface` by `Posting Line Id`. |
| IC-11, IC-12 | No sync remains. A blocked site or a terminated employee is refused on write. |
| IC-14, IC-16 | One company per tenant, and job queue entries are per company. |

## 10. Risks and open decisions

| # | Item | Owner | Note |
|---|---|---|---|
| O1 | **Object range** for Qnipay Workforce, about 300 IDs. | Product | Must not overlap W1, NZ or DK/SG. AppSource needs a registered range. |
| O2 | **Licensing.** Service-to-service calls made on behalf of about 500 people may count as multiplexing, so each Workforce user may need a Business Central licence. | Product, licensing | Confirm with Microsoft before the first customer. Not a technical blocker. |
| O3 | **Latency.** Every screen read is a Business Central API call. Week read under 300 ms and day save under 200 ms at p95 are not guaranteed. Business Central throttles API calls per user (about 6,000 per 5 minutes) and per environment. | Architecture | Mitigations: `$expand` and `$batch` for each view, short proxy caches for reference data (capabilities, modules, shift types), and load testing against a sandbox before go-live. |
| O4 | **Approval portal overlap.** W1's `SIR Portal Gateway` and `SIR Approval Session` already serve payroll approvals. Workforce reuses the session table. | Architecture | Keep one session table. Revoking a session signs the person out of both. |
| O5 | **Pay period required.** An approved day cannot post until an open `SIR Pay Period` covers it. | Payroll setup | The day stays `failed` with a plain message until the period exists, then a retry posts it. |
| O6 | **Leave valuation.** W1 does not value leave. A paid leave day reaches payroll as Detail rows only. The country app decides pay. | Country apps | NZ: `SIR_NZ Alt. Holiday Leave Code` and `Otherwise Working Day` decide public holiday handling. |
| O7 | **Design doc decisions that no longer apply.** D1 (Job Journal or Time Sheet), D2 (system of record), D3 (Azure SQL), D5 (contracted hours) and D11 (webhooks) are settled or removed by B1 to B4. D4, D6, D7, D8, D9, D10 and D12 still stand. | Product | |
