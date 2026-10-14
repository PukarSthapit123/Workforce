# Qnipay Workforce on Business Central: field mapping

2026-10-12 · Status: draft for review · Companion to [`01-bc-backend-design.md`](01-bc-backend-design.md) and [`03-api-endpoints.md`](03-api-endpoints.md)

This document maps every field in the Workforce contract (`C:\dev\qnipay-workforce-app\src\contract\*.ts`) to the Business Central table and field that stores it, or says that the field is derived and not stored. Table and field names follow `01-bc-backend-design.md` §6 (new `SIR_WF` tables) and §8 (extension fields, which carry the `SIR_WF ` prefix in Business Central).

## 1. How to read this document

Each table has these columns:

| Column | Meaning |
|---|---|
| Contract field | The zod property name. A nested property is written with a dot (`company.address`). |
| Type / limit | The zod type, and its `max()` where the contract sets one. |
| BC table.field | Where the value is stored. `—` means it is not stored. |
| BC type | The Business Central field type. |
| Rule | One of the transform kinds below, plus any note. |

Transform kinds:

| Kind | Meaning |
|---|---|
| direct | Stored as sent and returned as stored. |
| split / join | One contract value is split across several Business Central fields on write and joined again on read. |
| enum map | The contract's string is mapped to a Business Central enum value. The map is given in the table or in a note. |
| mask | Stored in full and returned masked: every character except the last 4 becomes `•`. |
| lookup | A contract code or id is resolved to a Business Central key, or back. "Code ↔ No." means the contract carries the code and Business Central keys by the same code. "Id ↔ Public Id" means the contract's string id is `Public Id`. |
| derived in proxy | Not stored. The Azure Functions proxy computes it from stored data with the TypeScript `src/domain` package. Labels, tones, texts, counts and totals are of this kind. |
| derived in BC | Not stored as a value the API writes. Business Central computes it with a FlowField or in the API page's `OnAfterGetRecord`. |
| Blob JSON | Stored as JSON in a Blob field. The API page exposes it as a Text property, and the proxy validates it with the contract's zod schema. |

Every record has these meta fields. They are not repeated in the tables below.

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `<table>."Public Id"` | Text[50] | lookup (Id ↔ Public Id). For a reused table without a `Public Id` field, the id is the record's code or `SystemId`. The tables below say which. |
| `version` | int ≥ 0 | `<table>."SIR_WF Version"` or `."Version"` | Integer | direct. The `@odata.etag` travels beside it. 0 means "no record yet". |
| `updatedAt` | ISO date-time | `<table>.SystemModifiedAt` | DateTime | direct, UTC. |

A reused table that the API writes gets two fields in its `SIR_WF` extension: `SIR_WF Public Id` (Text[50]) and `SIR_WF Version` (Integer). These are `Employee`, `SIR Work Sites`, `Dimension Value`, `Job`, `Job Task`, `SIR Employee Work Shift`, `SIR Leave Code` and `SIR TIme Sheet Elements`. `01` §8 has been updated to list them.

Mutation responses (`record`, `auditId`, `changed`, `summary`, `message`, `warnings`) are not fields. `auditId` is `SIR_WF Audit Event."Entry No."` as text, or null. `changed` and the texts are derived in the proxy.

## 2. People

### 2.1 Person (`people.ts` → `Person`)

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `Employee."SIR_WF Public Id"` | Text[50] | lookup. `per_<No.>` for migrated rows. |
| `code` | string | `Employee."No."` | Code[20] | direct. Immutable: `OnRename` refuses with `invalid` and `field: code`. |
| `name` | string | `Employee."SIR_WF Display Name"`, and `"First Name"`, `"Middle Name"`, `"Last Name"` | Text[100], Text[30], Text[30], Text[30] | split / join. The display name keeps the name as typed. On write the proxy splits at the last space: everything before it is the first name (the first 30 characters, and the rest of the words go to the middle name), the last word is the last name. The read returns the display name. |
| `email` | string | `Employee."Company E-Mail"` | Text[80] | direct. Also the key of `SIR_WF Account`. |
| `phone` | string | `Employee."Mobile Phone No."` | Text[30] | direct. |
| `address` | string | `Employee.Address`, `"Address 2"`, `City`, `"Post Code"` | Text[100], Text[50], Text[30], Code[20] | split / join on commas. The first part goes to Address, the last part that looks like a post code goes to Post Code, the part before it goes to City, and anything else goes to Address 2. The read joins the non-blank parts with ", ". |
| `emergencyName` | string | `Employee Relative."First Name"` where `"SIR_WF Emergency Contact" = true` | Text[30] | direct. The first emergency row, created if missing. |
| `emergencyPhone` | string | `Employee Relative."Phone No."` (same row) | Text[30] | direct. |
| `bankAccount` | string | `SIR Employee Bank Account."Bank Account No."`, the row in `Employee."SIR Preferred Bank Acc. Code"` | Text[30] | mask. Written only through an approved profile change (§2.3) or by `emp_crud` on create. |
| `bankSortCode` | string | `SIR Employee Bank Account."Bank Branch No."` (same row) | Text[20] | mask. |
| `jobProfile` | string | `Employee."SIR_WF Job Profile Code"` | Code[20] | lookup to `SIR_WF Job Profile.Code`. |
| `employeeType` | string | `Employee."SIR_WF Employee Type Code"` | Code[32] | lookup to `SIR_WF Employee Type.Code`. |
| `category` | string | `Employee."SIR_WF Category"` | Enum `SIR_WF Worker Category` | enum map (Contracted, Bank, Agency, Salaried). Also sets `SIR Employee."SIR Employment Type"`, see §2.6. |
| `location` | string | `SIR Employee Sites."Site Code"` where `"Employee Code" = No.` and `"Is Default Site" = true` | Code[20] | lookup to `SIR Work Sites.Code`. A change moves the default flag. It inserts the site row if it is missing and never deletes another. |
| `department` | string | `Default Dimension."Dimension Value Code"` (Table ID 5200, No. = Employee No., Dimension Code = `SIR_WF Setup."Department Dimension Code"`) | Code[20] | lookup. |
| `manager` | string | `Employee."Manager No."` | Code[20] | lookup (the contract sends a person code). Today's data holds names (design doc D12): migration resolves them once. |
| `contractedHours` | number | `Employee."SIR Contracted Hours"` | Decimal | direct. W1 field. |
| `maxHours` | number | `Employee."SIR_WF Max Hours"` | Decimal | direct. |
| `night` | boolean | `Employee."SIR_WF Night Worker"` | Boolean | direct. |
| `resource` | string | `Employee."Resource No."` | Code[20] | direct. Base field. Not used for posting (B1). |
| `cis` | boolean | `Employee."SIR_WF CIS"` | Boolean | direct. |
| `start` | IsoDate or '' | `Employee."Employment Date"` | Date | direct. '' is 0D. |
| `end` | IsoDate or '' | `Employee."Termination Date"` | Date | direct. '' is 0D. Written only through a transition. |
| `state` | PersonState | `Employee."SIR_WF State"` + base `Employee.Status` | Enum `SIR_WF Person State` + Enum `Employee Status` | enum map, §2.2. Written only through `personTransitions`. |
| `userType` | employee, manager, admin or null | `SIR_WF Account."User Type Code"` where `"Employee No." = No.` | Code[20] | lookup. null when there is no account. |

The cost centre is not a person field in the contract. Location carries it.

### 2.2 Person state

`SIR_WF State` keeps all 7 values. The base `Status` follows it, so standard Business Central and Qnipay payroll see a consistent employee.

| `state` | `SIR_WF State` | Base `Employee.Status` | Other effect |
|---|---|---|---|
| candidate | Candidate | Inactive | `Inactive Date` blank. Payroll skips the person. |
| preboard | Preboard | Inactive | |
| active | Active | Active | `Employment Date` must be set. |
| suspended | Suspended | Inactive | `Inactive Date` = today. |
| onleave | On Leave | Inactive | `Inactive Date` = today. |
| leaver | Leaver | Terminated | `Termination Date` = the leave date given. |
| archived | Archived | Terminated | Blocks further edits. |

### 2.3 Profile change (`profile.ts` → `ProfileChange`)

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `SIR_WF Profile Change."Public Id"` | Text[50] | lookup. |
| `personCode` | string | `."Employee No."` | Code[20] | direct. |
| `personName` | string | — | | derived in BC from `Employee`. |
| `field` | SelfFieldKey | `."Field Key"` | Enum `SIR_WF Self Field` | enum map: phone, address, emergencyName, emergencyPhone, bankAccount, bankSortCode. |
| `from` | string | `."From Value"` | Text[250] | direct. Masked for the two bank fields. |
| `to` | string | `."To Value"` | Blob | direct. Masked on read for bank fields. Cleared for bank fields once applied. |
| `note` | string | `.Note` | Text[500] | direct. |
| `raisedAt` | ISO date-time | `."Raised At"` | DateTime | direct. |
| `status` | pending, approved, declined | `.Status` | Enum `SIR_WF Change Status` | enum map. |
| `stage` | manager, payroll, done | `.Stage` | Enum `SIR_WF Change Stage` | enum map. |
| `route` | ApprovalStage[] | `.Route` | Text[30] | join with ",". |
| `decisions[]` (stage, decision, by.personCode, by.name, at, reason) | array | `.Decisions` | Blob JSON | Blob JSON. `by.name` is derived on read. |

On the last approval, the change writes the target field of §2.1: phone goes to `Mobile Phone No.`, address to the split address fields, the emergency fields to `Employee Relative`, and the bank fields to `SIR Employee Bank Account`. Each write also adds a `SIR_WF Person History` row with source `profile-change`.

`Profile` (the `GET /profile` view) and `SelfField` are derived in the proxy. `pending` lists `SIR_WF Profile Change` rows with `Status = pending`, and `selfEdit` comes from the feature flag.

### 2.4 History entry (`people.ts` → `HistoryEntry`)

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `SIR_WF Person History."Entry No."` | BigInteger | lookup (as text). |
| `personCode` | string | `."Employee No."` | Code[20] | direct. |
| `at` | ISO date-time | `.At` | DateTime | direct. |
| `by.personCode` | string | `."By Employee No."` | Code[20] | direct. |
| `by.name` | string | — | | derived in BC from `Employee`. |
| `source` | created, edited, transition, profile-change | `.Source` | Enum `SIR_WF History Source` | enum map. |
| `field` | string | `."Field Name"` | Text[50] | direct. |
| `from` | string | `."From Value"` | Text[250] | direct. Bank values stored masked. |
| `to` | string | `."To Value"` | Text[250] | direct. Bank values stored masked. |
| `reason` | string, optional | `.Reason` | Text[500] | direct. |

### 2.5 Create, update and transition bodies

| Contract | Fields | Rule |
|---|---|---|
| `CreatePerson` | `code` + the editable fields of §2.1 + `state` (candidate, preboard, active) + `userType` | Inserts `Employee`, the default `SIR Employee Sites` row, the Default Dimension rows, the emergency `Employee Relative` and, when `email` is set, `SIR_WF Account`. |
| `UpdatePerson` | editable fields (partial) + `userType` | `code` and `state` are refused (`invalid` with `field: code` or `field: state`, as the contract's `z.never()` does). |
| `Transition` | `to` (string), `reason` (string) | `to` is enum-mapped to `SIR_WF State` (§2.2). `reason` goes to `SIR_WF Person History.Reason` and the audit row. |
| `NextCode` | `code` | Derived in BC: the next `Employee."No."` from `Human Resources Setup."Employee Nos."`. |

### 2.6 Employee type (`employee-types.ts` → `EmployeeType`)

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `SIR_WF Employee Type."Public Id"` | Text[50] | lookup. |
| `code` | string, `^[a-z][a-z0-9_]{1,31}$` | `.Code` | Code[32] | direct. Business Central upper-cases Code fields, so the read returns `Code` lower-cased. Immutable. |
| `name` | string ≤ 60 | `.Name` | Text[60] | direct. |
| `category` | WorkerCategory | `.Category` | Enum `SIR_WF Worker Category` | enum map. |
| `mode` | form, grid, clock | `."Entry Mode"` | Enum `SIR_WF Entry Mode` | enum map. |
| `uom` | hour, day | `."Pay Basis"` | Enum `SIR_WF Pay Basis` | enum map. |
| `capabilities[]` | vehicle, site, project, shift | `.Vehicle`, `.Site`, `.Project`, `.Shift` | Boolean ×4 | split / join. |
| `inUse` (row) | int | — | | derived in BC: count of `Employee` with this type. |
| `startedFrom` (create) | string | — | | Not stored. Audited as the reason. |

Category to the W1 employment type (`."Employment Type"`, enum `SIR Employment Type`):

| `category` | `SIR Employment Type` |
|---|---|
| Salaried | Salary |
| Contracted | Hourly Contracted |
| Bank | Zero Hour |
| Agency | " " (blank: payroll does not pay agency workers) |

`Archetype` and `TypeLibrary` are reference data shipped in the proxy. They are not stored.

## 3. Dimensions

### 3.1 Location → `SIR Work Sites`

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `SIR Work Sites."SIR_WF Public Id"` | Text[50] | lookup. |
| `code` | string (template: `^[A-Z0-9][A-Z0-9_.-]{0,19}$`) | `.Code` | Code[20] | direct. Immutable. |
| `name` | string (template ≤ 80) | `.Description` | Text[100] | direct. |
| `area` | string ≤ 80 | `."SIR_WF Area"` | Text[60] | direct. **Mismatch**: the template allows 80 characters (§11). |
| `department` | string ≤ 20 | `."SIR_WF Department Code"` | Code[20] | lookup to the department dimension value. Also written as a `Default Dimension` on `SIR Work Sites`, so payroll and the interface get the dimension. |
| `costCentre` | string ≤ 20 | `."SIR_WF Cost Centre Code"` | Code[20] | lookup. Also a `Default Dimension`. |
| `level` | string ≤ 40 | `."SIR_WF Support Level"` | Text[30] | direct. **Mismatch**: 40 vs 30 (§11). |
| `minPerShift` | int ≥ 0 | `."SIR_WF Min Per Shift"` | Integer | direct. |
| `manager` | string | `."Site Manager"` | Code[20] | lookup (person code to `Employee."No."`). W1 field. |
| `address` | string ≤ 200 | `.Address` | Text[100] | direct. **Mismatch**: 200 vs 100 (§11). |
| `active` | boolean | `."SIR_WF Active"` | Boolean | direct. |
| `inUse` | int | — | | derived in BC: the people (default sites), rota weeks and timesheet entries that use it. |

### 3.2 Department and cost centre → `Dimension Value`

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `Dimension Value."SIR_WF Public Id"` | Text[50] | lookup. |
| `code` | string | `Dimension Value.Code` where `"Dimension Code" = SIR_WF Setup."Department Dimension Code"` (or `"Cost Centre Dimension Code"`) | Code[20] | direct. Immutable. |
| `name` | string | `.Name` | Text[50] | direct. **Mismatch**: the template allows 80 (§11). |
| `manager` (department only) | string | `."SIR_WF Manager No."` | Code[20] | lookup. |
| `inUse` | int | — | | derived in BC: Default Dimension rows on Employee and SIR Work Sites, plus timesheet entries. |

### 3.3 Job profile → `SIR_WF Job Profile`

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `code` | string | `.Code` | Code[20] | direct. Immutable. |
| `name` | string | `.Name` | Text[100] | direct. |
| `night` | boolean | `.Night` | Boolean | direct. |
| `inUse` | int | — | | derived in BC: Employee and Rota Pattern references. |

### 3.4 Project → `Job`

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `Job."SIR_WF Public Id"` | Text[50] | lookup. |
| `code` | string | `Job."No."` | Code[20] | direct. Immutable. |
| `name` | string ≤ 120 | `Job.Description` | Text[100] | direct. **Mismatch**: 120 vs 100 (§11). |
| `client` | string ≤ 120 | `Job."SIR_WF Client Name"` | Text[100] | direct. `Bill-to Customer No.` is not used: Workforce has no customer. |
| `costCentre` | string ≤ 20 | `Job."Global Dimension 1 Code"` or `"Global Dimension 2 Code"`, whichever is the cost centre dimension; otherwise a `Default Dimension` (Table 167) | Code[20] | lookup. |
| `manager` | string | `Job."SIR_WF Manager Employee No."` | Code[20] | lookup. `Person Responsible` is a Resource, so it is not used. |
| `status` | string ≤ 40 | `Job.Status` | Enum `Job Status` | enum map: Active → Open, Planned or Planning → Planning, Quote → Quote, Closed or Completed → Completed. Any other text is refused (§11). |
| `start` | IsoDate or '' | `Job."Starting Date"` | Date | direct. |
| `end` | IsoDate or '' | `Job."Ending Date"` | Date | direct. |
| `budgetHours` | string (contract today) | `Job."SIR_WF Budget Hours"` | Decimal | The proxy parses it as a number. Blank is 0. Design doc: it becomes a number. |
| `billable` | boolean | `Job."SIR_WF Billable"` | Boolean | direct. |
| `location` | string ≤ 20 | `Job."SIR_WF Work Site Code"` | Code[20] | lookup to `SIR Work Sites`. |
| `inUse` | int | — | | derived in BC: `SIR_WF Timesheet Entry` rows with this `Job No.`. |

### 3.5 Project task → `Job Task`

The contract carries tasks as names: `OpenProject.tasks[]` and the template's `contracts[].tasks[]`.

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| (project) | | `Job Task."Job No."` | Code[20] | lookup. |
| (task code) | | `Job Task."Job Task No."` | Code[20] | Generated `T0010`, `T0020`, … on create. Immutable. |
| `name` | string ≤ 120 | `Job Task.Description` | Text[100] | direct. **Mismatch**: 120 vs 100 (§11). |
| `group` | string ≤ 60 | `Job Task."SIR_WF Task Group"` | Text[50] | direct. **Mismatch**: 60 vs 50 (§11). |
| `billable` | boolean | `Job Task."SIR_WF Billable"` | Boolean | direct. |
| `OpenProject.tasks[]` | string[] | — | | derived in BC: the descriptions of `Job Task` rows with `Job Task Type = Posting`. |

## 4. Foundation and access

### 4.1 Session (`session.ts`)

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `token` | string | `SIR Approval Session."Session Token"` | Guid | direct (formatted without braces). |
| `account.email` | string | `SIR_WF Account.Email` | Text[80] | lookup from `SIR Approval Session."Entra Object ID"`. |
| `account.userType` | enum | `SIR_WF Account."User Type Code"` | Code[20] | direct. |
| `account.personCode` | string | `SIR Approval Session."Employee No."` | Code[20] | direct. |
| `account.name` | string | — | | derived in BC from `Employee`. |
| `account.roleName`, `roleDescription` | string | `SIR_WF User Type.Name`, `.Description` | Text[24], Text[250] | lookup. |
| `account.locationName` | string | — | | derived in BC: the default site's `Description`. |
| `capabilities[]` | string[] | — | | derived in BC: the user type's granted capabilities, plus grants, minus revocations (`SIR_WF Capability Exception`). A revocation wins. |
| `viewingAs.personCode` | string | `SIR Approval Session."SIR_WF Viewing As Emp. No."` | Code[20] | direct. |
| `viewingAs.name`, `userType`, `roleName` | | — | | derived in BC from the viewed person's account. |
| `onboarding` | boolean | — | | derived in BC: the viewed person's state is Candidate or Preboard and the module ON is enabled. |
| `simulated` | literal true today | — | | Constant `false` in production (design doc). |

Also on `SIR Approval Session`: `"Issued-At"`, `"Expires-At"`, `"Last Activity"` and `Revoked` (W1 fields), plus `"SIR_WF Correlation Id"`. `SignInRequest` and `DemoAccount` are development only and are not mapped.

### 4.2 Access (`access.ts`)

**Capability → `SIR_WF Capability`**

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `.Code` | Code[20] | lookup (the code is the id). |
| `group` | own, team, cfg | `."Group Code"` | Code[10] | direct (lower-cased on read). |
| `label` | string | `.Label` | Text[100] | direct. |
| `gate` | string | `.Gate` | Text[50] | direct. |
| `lockedFor[]` | string[] | `."Locked For"` | Text[100] | join with ",". |

**Capability group → `SIR_WF Capability Group`**: `id` = `.Code`, `label` = `.Label`, `description` = `.Description`, `order` = `."Sort Order"`. All direct.

**User type → `SIR_WF User Type` + `SIR_WF User Type Capability`**

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `SIR_WF User Type.Code` | Code[20] | lookup. |
| `name` | string ≤ 24 | `.Name` | Text[24] | direct. Unique ignoring case. |
| `description` | string | `.Description` | Text[250] | direct. |
| `capabilities[]` | string[] | `SIR_WF User Type Capability."Capability Code"` where `Granted = true` | Code[20] | join (child rows). |
| `defaults[]` | string[] | same rows where `Default = true` | Boolean | join. |

**User access → `SIR_WF Account` + `SIR_WF Capability Exception`**

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `SIR_WF Account."Public Id"` | Text[50] | lookup. |
| `email` | string | `.Email` | Text[80] | direct. Lower-cased. |
| `name` | string | — | | derived in BC from `Employee`. |
| `personCode` | string | `."Employee No."` | Code[20] | direct. |
| `userType` | string | `."User Type Code"` | Code[20] | direct. |
| `grants[]` | string[] | `SIR_WF Capability Exception."Capability Code"` where `Mode = grant` | Code[20] | join. |
| `revocations[]` | string[] | same, where `Mode = revoke` | Code[20] | join. |
| `AddException.capability`, `.mode`, `.reason` | | `."Capability Code"`, `.Mode`, `.Reason` | Code[20], Enum, Text[250] | direct. `."Added By"` and `."Added At"` are set by Business Central. |

`SIR_WF Account."Entra Object ID"` is set on first sign-in and is not in the contract. `Employee."SIR Approver Entra Object ID"` (W1) is set to the same value.

### 4.3 Audit entry (`audit.ts`)

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `SIR_WF Audit Event."Entry No."` | BigInteger | lookup (as text). |
| `at` | ISO date-time | `.At` | DateTime | direct. |
| `who.personCode` | string | `."Who Employee No."` | Code[20] | direct. |
| `who.name` | string | — | | derived in BC. |
| `who.viewingAs` | string, optional | `."Viewing As Employee No."` | Code[20] | direct. |
| `act` | string | `.Act` | Text[60] | direct. |
| `entity` | string | `.Entity` | Text[60] | direct. |
| `entityId` | string | `."Entity Id"` | Text[50] | direct. |
| `before` | unknown | `.Before` | Blob JSON | Never personal data. |
| `after` | unknown | `.After` | Blob JSON | Never personal data. |
| `reason` | string, optional | `.Reason` | Text[500] | direct. |
| `AuditPage.total` | int | — | | derived in BC (count with the same filters). |

Not in the contract today, stored for the PRD (NA-05): `.Source`, `."Correlation Id"`, `."Posting Attempt Entry No."` and `.Device`.

### 4.4 Tenant (`tenant.ts`)

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `SIR_WF Setup."Public Id"` | Text[50] | lookup. |
| `name` | string ≤ 80 | `Company Information.Name` | Text[100] | direct. |
| `template` | string | `SIR_WF Setup."Template Code"` | Code[50] | direct. |
| `modules` | record<string, boolean> | `SIR_WF Module.Enabled`, keyed by `.Code` | Boolean | join (one row per key). |
| `flags` | record<string, boolean> | `SIR_WF Feature Flag.Enabled`, keyed by `.Code` | Boolean | join. |
| `company.registration` | string ≤ 20 | `Company Information."Registration No."` | Text[20] | direct. |
| `company.address` | string ≤ 200 | `Company Information.Address`, `"Address 2"`, `City`, `"Post Code"` | Text[100], Text[50], Text[30], Code[20] | split / join as for the person (§2.1). |
| `company.country` | United Kingdom, Ireland, Nepal | `Company Information."Country/Region Code"` | Code[10] | enum map: GB, IE, NP. |
| `company.nmwCheck` | boolean | `SIR_WF Setup."NMW Check"` | Boolean | direct. |
| `company.bankHolidayRegion` | enum | `SIR_WF Setup."Bank Holiday Region"` | Text[30] | direct. |
| `company.payFrequency` | Weekly, Fortnightly, Four-weekly, Monthly | `SIR Payroll Setup."Default Pay Frequency"` → `SIR Pay Frequency.Frequency` | Code[20] → Enum | lookup. Business Central finds the pay frequency whose `Frequency` enum matches, and refuses with `NO_PAY_FREQUENCY` if there is none. Workforce never creates one. |
| `company.weekEnding` | Sunday, Saturday, Friday | `SIR_WF Setup."Week Ending"` | Enum `SIR Weekday` | enum map. |
| `company.firstPayDate` | IsoDate or '' | `SIR_WF Setup."First Pay Date"` | Date | direct. Read-only beside payroll: the real pay dates are `SIR Pay Period."Pay Date"`. |
| `financialYear.start`, `.end` | IsoDate | `SIR Fiscal Year` (the current year: start and end date fields) | Date | lookup. The year containing today. A change writes the next `SIR Fiscal Year` row only when payroll has none for those dates. Otherwise it is refused with `PAYROLL_OWNS_YEAR`. |
| `financialYear.label` | string | `SIR Fiscal Year` code | Code[20] | direct. |
| `weekStart` | Monday, Sunday, Saturday | `SIR_WF Setup."Week Start"` | Enum `SIR Weekday` | enum map. |
| `bankHolidays[].date`, `.name` | IsoDate, string ≤ 80 | `Base Calendar Change.Date`, `.Description`, with `"Base Calendar Code" = SIR Timesheet Setup."Base Calender"`, `Nonworking = true`, `"Recurring System" = " "` | Date, Text[30] | direct. **Mismatch**: Description is 30 characters, the contract allows 80 (§11). Rows with `"SIR Is Weekend" = true` are weekends, not bank holidays, and are left out. |
| `timezone` | IANA ≤ 100 | `SIR_WF Setup."Time Zone"` | Text[100] | direct. |
| `dateFormat` | enum | `SIR_WF Setup."Date Format"` | Enum `SIR_WF Date Format` | enum map. |
| `clock` | 24h, 12h | `SIR_WF Setup."Clock Style"` | Enum `SIR_WF Clock Style` | enum map. |
| `fullTimeWeeklyHours` | 1–80 | `SIR_WF Setup."Full-Time Weekly Hours"` | Decimal | direct. |
| `rotaHorizon` | 12, 6 or 3 | `SIR_WF Setup."Rota Horizon (Months)"` | Integer | direct. `SIR_WF Rota Config.Horizon` holds the same value: the setup is the source and the config follows. |
| `extras.weekGrid` | hours, times | `SIR_WF Setup."Week Grid"` | Enum | enum map. |
| `extras.weekLayout` | classic, grid, days | `SIR_WF Setup."Week Layout"` | Enum | enum map. |
| `extras.breaksMax` | int | `SIR_WF Setup."Breaks Max"` | Integer | direct. |
| `extras.vehiclesMax` | int | `SIR_WF Setup."Vehicles Max"` | Integer | direct. |
| `restore` | record<string, string[]> | `SIR_WF Module.Restore` | Blob JSON | one Blob per module. |
| `rotaSetAside` | int ≥ 0 | — | | derived in BC: line count of `SIR_WF Rota Set Aside`. |
| `ModuleEffect.*` | | — | | derived in BC by the module switch command. Not stored. |

### 4.5 Template (`templates.ts`)

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `key` | string | `SIR_WF Template.Key` | Code[50] | direct. |
| `name` | string ≤ 80 | `.Name` | Text[80] | direct. |
| `description` | string ≤ 300 | `.Description` | Text[300] | direct. |
| `scope` | config, structure | `.Scope` | Text[30] | direct. |
| `source` | shipped, saved, imported | `.Source` | Enum `SIR_WF Template Source` | enum map. Shipped templates are not stored. |
| `savedAt`, `savedBy`, `from` | | `."Saved At"`, `."Saved By"`, `."From Key"` | DateTime, Code[20], Code[50] | direct. |
| `template` (the whole `Template` object) | object | `.Body` | Blob JSON | Blob JSON. Holds no money: no currency, pay-code values, rates or pay rules. |
| `inUse`, `types`, `modules` (row) | | — | | derived in proxy from the body and `SIR_WF Setup."Template Code"`. |

Applying a template writes the tables its parts map to: `modules` and `flags` (§4.4), `employeeTypes` (§2.6), `roleNames` (`SIR_WF User Type.Name`), `approvalChain` (§4.6), `structure.*` (§3), `onboarding` (§9), `tenantSettings` (§4.4) and `leaveConfig` (§8). `labels` is stored in the template body only.

### 4.6 Approval chain and delegation (`approvals.ts`)

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `ApprovalChain.module` | Timesheet, Profile, Leave, Rota | `SIR_WF Approval Chain.Module` | Enum `SIR_WF Chain Module` | enum map. |
| `ApprovalChain.steps[]` | ChainLayer[] ≤ 12 | `SIR_WF Approval Chain Step` rows, `"Step No."` = position | | one row per layer. |
| `steps[].role` | string ≤ 40 | `.Role` | Text[40] | direct. |
| `steps[].scope` | string ≤ 60 | `.Scope` | Text[60] | direct. |
| `steps[].when` | string ≤ 80 | `.When` | Text[80] | direct. |
| `steps[].sla` | string ≤ 40 | `.SLA` | Text[40] | direct. |
| `steps[].fixed` | boolean | `.Fixed` | Boolean | direct. |
| (version) | | `SIR_WF Approval Chain."Version"`, 0 while `Saved = false` | Integer | direct. |
| `SignOff.emailApproval` | boolean | `SIR_WF Feature Flag.Enabled` (the email approval flag) | Boolean | lookup. |
| `SignOff.cutoff`, `.enforceLock`, `.returnReasonRequired` | | `SIR_WF Timesheet Config.Cutoff`, `."Enforce Lock"`, `."Return Reason Required"` | | lookup. |
| `SignOff.current`, `.previous` (from, to, closed) | | — | | derived in BC from `SIR Pay Period` for the default pay frequency. `closed` is `SIR Pay Period.Posted`. |
| `Delegation.id` | string | `SIR_WF Delegation."Public Id"` | Text[50] | lookup. |
| `Delegation.who` | string ≤ 20 | `."From Employee No."` | Code[20] | direct. |
| `Delegation.to` | string ≤ 20 | `."To Employee No."` | Code[20] | direct. |
| `Delegation.whoName`, `.toName` | string | — | | derived in BC. |
| `Delegation.from`, `.until` | IsoDate | `."Date From"`, `."Date Until"` | Date | direct. |
| `Delegation.modules[]` | ChainModule[] ≤ 4 | `.Timesheet`, `.Profile`, `.Leave`, `.Rota` | Boolean ×4 | split / join. |
| `Delegation.active` | boolean | — | | derived in BC: today is inside the dates. |
| `Approver.code`, `.name` | | — | | derived in BC: the people holding an approver capability. |

### 4.7 Notifications (`notifications.ts`)

**Inbox item → `SIR Notification Entry` + `SIR_WF Notification Entry` extension**

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string ≤ 40 | `SIR Notification Entry."Entry No."` | Integer | lookup (as text). |
| (addressee) | | `."Employee No."` | Code[20] | direct. A person reads only their own rows. |
| (type) | | `."Notification Type"` = `Workforce` | Enum `SIR Notification Type` (extended) | Constant for Workforce rows. Payroll's own rows (payslips) also show in the inbox with area `payroll`. |
| `area` | string | `."SIR_WF Area"` | Text[30] | direct. |
| `title` | string | `."SIR_WF Title"` | Text[100] | direct. |
| `body` | string | `.Message`, and `."SIR_WF Body"` when the body is longer than 250 characters | Text[250], Blob | split / join. |
| `at` | ISO date-time | `."SIR_WF At"` | DateTime | direct. W1's `"Created Date"` and `"Created Time"` are also filled. |
| `read` | boolean | `.Seen` | Boolean | direct. W1 field. |
| `ago` | string | — | | derived in proxy. |
| `link.view`, `.path`, `.label` | | `."SIR_WF Link View"`, `."SIR_WF Link Path"`, `."SIR_WF Link Label"` | Text[50], Text[250], Text[60] | direct. Returned only when the page is on the reader's navigation (derived in proxy). |
| (channel) | | `."SIR_WF Channel"` | Text[30] | direct. Only `In-app` rows reach the inbox. |
| `MyNotifications.unread`, `NotificationsRead.unread`, `.marked` | int | — | | derived in BC. |

**Matrix → `SIR_WF Notification Event`**

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `NotificationMatrix.id`, `.version` | | `SIR_WF Setup` (one matrix per company) | | The matrix version is `SIR_WF Setup."Version"`. **Gap**: 01 has no single matrix version field, see §11. |
| `events[].code` | string ≤ 40 | `.Code` | Code[40] | direct. |
| `events[].module` | string | `.Module` | Text[30] | direct. |
| `events[].label`, `.description` | string | `.Label`, `.Description` | Text[100], Text[250] | direct. |
| `events[].channels.employee` | NotifChannel or null | `."Employee Channel"`, null when `."Employee Locked"` | Enum `SIR_WF Notif. Channel` | enum map. |
| `events[].channels.manager` | NotifChannel or null | `."Manager Channel"` / `."Manager Locked"` | Enum | enum map. |
| `events[].channels.admin` | NotifChannel or null | `."Admin Channel"` / `."Admin Locked"` | Enum | enum map. |

**Evidence → `SIR_WF Notification Evidence`**

| Contract field | BC table.field | Rule |
|---|---|---|
| `employee` | — | derived in BC (name). |
| `employeeId` | `."Employee No."` | direct. |
| `event` | `."Event Code"` | direct. |
| `at` | `.At` | direct. |
| `recipient` | `.Recipient` | direct. |
| `channel` | `.Channel` | direct. |
| `ref` | `.Ref` | direct. |

### 4.8 Notices (`notices.ts`)

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string ≤ 20 | `SIR_WF Notice.Code` | Code[20] | lookup (NTC-0001). |
| `textVersion` | int > 0 | `."Text Version"` | Integer | direct. |
| `title` | string ≤ 90 | `.Title` | Text[90] | direct. |
| `body` | string ≤ 4000 | `.Body` | Blob | direct. |
| `scope.kind` | all, loc, dept | `."Scope Kind"` | Enum `SIR_WF Notice Scope` | enum map. |
| `scope.code` | string ≤ 20 | `."Scope Code"` | Code[20] | direct. |
| `scope.loc` | string ≤ 20 | `."Scope Location"` | Code[20] | direct. |
| `scopeLabel` | string | — | | derived in proxy. |
| `pinned`, `urgent`, `mustAck` | boolean | `.Pinned`, `.Urgent`, `."Must Acknowledge"` | Boolean | direct. |
| `from` | IsoDate | `."Date From"` | Date | direct. '' on create means today. |
| `until` | IsoDate or '' | `."Date Until"` | Date | direct. |
| `status` | draft, current, scheduled, expired, withdrawn | — | | derived in BC from `State` and the dates. |
| `state` (poster) | draft, live, withdrawn | `.State` | Enum `SIR_WF Notice State` | enum map. |
| `by` | string | `."Posted By"` | Code[20] | direct. |
| `at` | ISO date-time | `."Posted At"` | DateTime | direct. |
| `withdrawReason` | string ≤ 300 | `."Withdraw Reason"` | Text[300] | direct. |
| `mine`, `audience`, `acknowledged` | | — | | derived in BC (scope against the reader, audience count, ack count for the current text version). |
| `history[]` (textVersion, title, body, by, at) | | `SIR_WF Notice Text Version` rows | | direct, one row per earlier version. |
| `you`, `acknowledgedAt`, `owed` (reader) | | `SIR_WF Notice Ack` for the reader | | derived in BC. |
| `Acknowledge.textVersion` | int > 0 | `SIR_WF Notice Ack."Text Version"` | Integer | direct. `.At` is set by Business Central. |
| `TrackRow.*` | | `SIR_WF Notice Ack` + `Employee` | | derived in BC. |
| `NoticeTrack.trail[]` | | `SIR_WF Audit Event` where `Entity = notice` | | lookup. |
| `PostedNotices.counts`, `scopes`, `org`, `location`, `today` | | — | | derived in BC. |

### 4.9 Home and documents (`home.ts`)

**Document → `Document Attachment` (Table ID 5200) + `SIR_WF Document Attachment` extension**

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string ≤ 40 | `Document Attachment."SIR_WF Public Id"` | Text[50] | lookup. **Gap**: 01 §8 lacked this field. It has been added. |
| `personCode` | string | `."No."` with `"Table ID" = 5200` | Code[20] | direct. |
| `name` | string | `."File Name"` + `."File Extension"` | Text[250], Text[30] | join. |
| `category` | string | `."SIR_WF Category"` | Text[50] | direct. |
| `date` | IsoDate | `."SIR_WF Document Date"` | Date | direct. Falls back to `."Attached Date"`. |
| `owner` | string | `."SIR_WF Owner"` | Text[50] | direct. |
| `source` | string | `."SIR_WF Source"` | Text[50] | direct. |

**Payroll document**: derived in BC from `SIR Posted Payroll Header` rows for the employee. `id` is the posted document `"No."`, `name` is "Payslip " plus the period description, `category` is `payslip`, and `note` is blank. Opening a payslip is not built (the contract says "not yet connected").

**Home month (`HomeMonth`, `HomeDay`, `MonthKey`)**: derived in proxy, from `SIR_WF Rota Cell` (shift), `SIR_WF Leave Request` and `SIR_WF Sick Episode` (absence), `SIR_WF Timesheet Day` (ts), `Base Calendar Change` (bank holiday) and `SIR Pay Period.Posted` (locked). Nothing in it is stored.

## 5. Timesheet

### 5.1 Timesheet day (`timesheets.ts` → `TimesheetDay`)

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `SIR_WF Timesheet Day."Public Id"` | Text[50] | lookup (`tsd_<EmployeeNo>_<date>`). |
| `personCode` | string | `."Employee No."` | Code[20] | direct. PK 1. |
| `date` | IsoDate | `.Date` | Date | direct. PK 2. |
| `state` | draft, pend, back, resub, ok, mgrok | `.State` | Enum `SIR_WF TS State` | enum map (same names). |
| `entries[]` | TimeEntry[] ≤ 6 | `SIR_WF Timesheet Entry` rows | | §5.2. |
| `workType` | string | `."Work Type"` | Code[20] | direct. The derived pay code. |
| `allowances[]` | string[] ≤ 20 | `.Allowances` | Text[250] | join with ",". |
| `shift` | string ≤ 10 | `."Shift Code"` | Code[10] | direct. |
| `nonWorkingReason` | string ≤ 200 | `."Non-Working Reason"` | Text[200] | direct. |
| `captureSource` | self, proxy, clock | `."Capture Source"` | Enum `SIR_WF Capture Source` | enum map. |
| `enteredBy` | string | `."Entered By"` | Code[20] | direct. |
| `enteredByName` | string | — | | derived in BC. |
| `submittedAt` | ISO date-time or '' | `."Submitted At"` | DateTime | direct. |
| `returnReason` | string ≤ 500 | `."Return Reason"` | Text[500] | direct. |
| `warnings[]` | string[] | `.Warnings` | Blob JSON | Blob JSON. |
| `history[]` | TsHistory[] | `SIR_WF Timesheet Day Log` rows | | §5.4. |
| `integrationAttemptId` | string | `."Last Posting Line No."` | BigInteger | lookup (as text; '' when 0). |
| `workedAnyway` | boolean, optional | `."Worked Anyway"` | Boolean | direct. |
| `minutes` | int ≥ 0 | — | | derived in BC: the sum of `SIR_WF Timesheet Entry."Net Minutes"`. |
| `posting` | none, queued, posted, failed | `."Posting State"` | Enum `SIR_WF Posting State` | enum map. `reconciled` is returned as `posted`, because the contract has no reconciled value. |
| (current layer) | | `."Current Layer"` | Integer | Not in the contract. Drives `QueueRow.decide`. |
| (site key) | | `."Work Site Code"` | Code[20] | Not in the contract. Copied from the person on save. |

### 5.2 Time entry and breaks

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| (position) | | `SIR_WF Timesheet Entry."Line No."` | Integer | 10000, 20000, … |
| `start` | string ≤ 5 (HH:MM) | `.Start` | Text[5] | direct. |
| `finish` | string ≤ 5 | `.Finish` | Text[5] | direct. |
| `breaks[]` | BreakInput[] ≤ 5 | `SIR_WF Timesheet Break` rows | | one row per break. |
| `breaks[].start`, `.end` | string ≤ 5 | `SIR_WF Timesheet Break.Start`, `.End` | Text[5] | direct. |
| `hours` | 0–24 or null | `.Hours` | Decimal | direct. 0 means null when Start and Finish are set. |
| `fields` | record<string, string ≤ 500 or boolean> | `.Fields` | Blob JSON | Blob JSON. Two keys are also lifted into real fields, see the next rows. |
| `fields.project` (allocation) | string | `."Job No."` | Code[20] | lookup to `Job."No."`. Refused with `TS_INVALID` unless the job is open. |
| `fields.task` (allocation) | string | `."Job Task No."` | Code[20] | lookup. The task must belong to the job. The contract sends the task's name: Business Central resolves it to `Job Task No.` within the job. |
| `fields.site` (allocation) | string | `."Work Site Code"` | Code[20] | lookup. Blank means the person's default site. |
| (cost centre) | | `."Cost Centre Code"` | Code[20] | Copied from the work site's `SIR_WF Cost Centre Code`, or from the job. |
| (net) | | `."Net Minutes"` | Integer | derived in BC on save: finish minus start, less breaks, or hours × 60. |

The capture-field codes for project, task and site are the codes in the timesheet field catalogue (`TimesheetField.c`). The implementation plan names them from `src/domain`.

### 5.3 Day input, week submit and transitions

| Contract | Fields | Rule |
|---|---|---|
| `DayInput` | `entries`, `allowances`, `shift`, `nonWorkingReason`, `workedAnyway` | Replaces the day's entries and breaks whole, then sets the day fields of §5.1. |
| `WeekSubmit.days[]` | `DayInput` + `date` + `version` | One `timesheetWeekSubmits` command. `version` is checked per day against `SIR_WF Timesheet Day."Version"`. |
| `MultiweekSubmit.weeks[]` | IsoDate ≤ 8 | Command parameter only. |
| `DayTransition` | `to` (ok, back), `reason` ≤ 500 | `to` sets `.State`, and `reason` sets `."Return Reason"` on back. Both go to the log. |
| `BulkApprove` | `ids[]` ≤ 500, `checksum` | Command parameters. `ids` are `Public Id`s. The checksum is computed in BC over (Public Id, Version) of the approver's pending set. |
| `HeldDay`, `WeekSubmitted`, `BulkApproved`, `MultiweekSubmitted` | | Command results. Not stored. |

### 5.4 History (`TsHistory`) → `SIR_WF Timesheet Day Log`

| Contract field | BC field | BC type | Rule |
|---|---|---|---|
| `from` | `."From State"` | Enum `SIR_WF TS State` | enum map. |
| `to` | `."To State"` | Enum | enum map. |
| `by.personCode` | `."By Employee No."` | Code[20] | direct. |
| `by.name` | — | | derived in BC. |
| `at` | `.At` | DateTime | direct. |
| `reason` | `.Reason` | Text[500] | direct. |
| `layer` | `.Layer` | Text[40] | direct. |

### 5.5 Week, queue and capture views

All derived in proxy, from stored rows:

| View | Fields | Source |
|---|---|---|
| `WeekDay` | `date`, `record`, `state` ('none' when no row), `version` (0 when no row), `minutes`, `future`, `locked`, `lockNote`, `flags[]`, `absence`, `rota`, `clock` | `SIR_WF Timesheet Day` + entries; `locked` from `SIR Pay Period.Posted` and the cut-off; `absence` from leave and sickness; `rota` from `SIR_WF Rota Cell` + shift type; `clock` from `SIR_WF Clock Record`. |
| `TimesheetWeek` | `person` (code, name, employeeType, typeName, location, manager, contractedHours), `weekStart`, `label`, `now`, `days`, `weekMinutes`, `byAllocation`, `capture`, `earlierWeeks` | Employee, Employee Type and the rows above. |
| `CaptureSetup` | `rules`, `cutoff`, `timeFormat`, `returnReasonRequired`, `weekGrid`, `weekLayout`, `fields`, `type`, `modules`, `flags`, `capabilities`, `fieldDefaults`, `allowances`, `payCodes`, `mode`, `projects`, `rotaLines` | `SIR_WF Timesheet Config`, `SIR_WF Setup`, modules, flags, the session, `SIR TIme Sheet Elements`, open `Job` and `Job Task`, `SIR Employee Work Shift`. |
| `QueueRow` | the day + `personName`, `location`, `locationName`, `flags`, `clock`, `decide` | Day rows filtered by `State` and `Work Site Code`. `decide` comes from `Current Layer`, the chain and the session. |
| `ApprovalQueue` | `rows`, `nextCursor`, `counts`, `oldestPending`, `bulk`, `now`, `returnReasonRequired`, `sla`, `rota` | `nextCursor` is the OData `$skiptoken`. `bulk.checksum` is derived in BC (`approvalChecksums`). |
| `EarlierWeek`, `AdvisoryFlag`, `ClockMark`, `RotaDay`, `OpenProject`, `RotaLineOption` | | As above. |

### 5.6 Timesheet config (`TimesheetConfig`) → `SIR_WF Timesheet Config`

| Contract field | Type | BC field | BC type | Rule |
|---|---|---|---|---|
| `rules.maxDaily` | number | `."Max Daily"` | Decimal | direct. |
| `rules.warnDaily` | number | `."Warn Daily"` | Decimal | direct. |
| `rules.minNet` | number | `."Min Net"` | Decimal | direct. |
| `rules.varianceWarn` | number | `."Variance Warn"` | Decimal | direct. |
| `rules.blockFuture` | boolean | `."Block Future"` | Boolean | direct. |
| `rules.enforceRest` | boolean | `."Enforce Rest"` | Boolean | direct. |
| `rules.enforceLock` | boolean | `."Enforce Lock"` | Boolean | direct. |
| `rules.otDaily` | number | `."OT Daily"` | Decimal | direct. |
| `rules.nightFrom`, `.nightTo` | string | `."Night From"`, `."Night To"` | Text[5] | direct. |
| `cutoff` | string | `.Cutoff` | Text[40] | direct. |
| `timeFormat` | HH:MM, h m | `."Time Format"` | Enum `SIR_WF Time Format` | enum map. |
| `returnReasonRequired` | boolean | `."Return Reason Required"` | Boolean | direct. |
| `weekGrid`, `weekLayout` | enum | `SIR_WF Setup."Week Grid"`, `."Week Layout"` | Enum | lookup. One home (tenant extras), read here too. |
| `fieldDefaults` | record<string, {vis, mand, label}> | `."Field Defaults"` | Blob JSON | Blob JSON. |
| `allowances` | record<string, AllowanceDef> (code, label, payCode, tier, element?, basis?) | `.Allowances` | Blob JSON | Blob JSON. Strict: no amount key is accepted. `payCode` must exist in `SIR TIme Sheet Elements."External Field Mapping"`. |
| `types` | record<string, TypeCapture> (fields, allowances, rules[trigger, when, code, value, how]) | `."Type Capture"` | Blob JSON | Blob JSON. `rules[].value` is a multiplier or threshold. A currency value is refused. |

`TimesheetField` (the field catalogue) is reference data shipped in the proxy and is not stored.

### 5.7 Pay code (`PayCode`) → `SIR TIme Sheet Elements`

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `code` | string | `."External Field Mapping"` | Code[20] | direct. The code Workforce posts as `Interface Code`. |
| `basis` | string | `."SIR_WF Pay Basis"` | Text[20] | direct. |
| `value` | string (multiplier or unit count; blank for a flat code) | `."SIR_WF Multiplier"` | Decimal | The proxy formats it ("1.5"). Never money. |
| `element` | string | `."Pay Element"` | Code[20] | direct. The W1 `SIR Payroll Element` code. |
| `label` | string | `."SIR_WF Label"` | Text[60] | direct. Falls back to `.Description`. |
| `workType` | boolean | `."SIR_WF Work Type"` | Boolean | direct. |
| (unit) | | `."Unit Of Measure"` | Enum `SIR TS Unit of Measure` | Not in the contract. Hour or Day, used for the posted unit. |

Pay codes are read-only through the Workforce API until the Payroll module is built. Payroll staff maintain them in Business Central.

### 5.8 Integration attempt (`IntegrationAttempt`) → `SIR_WF Posting Line`

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `SIR_WF Posting Line."Entry No."` | BigInteger | lookup (as text). |
| `version` | int | `."Version"` | Integer | direct. |
| `event` | string | `.Source` | Enum `SIR_WF Posting Source` | enum map: timesheet → `timesheet.approved`, leave → `leave.approved`. |
| `ref` | string | `."Batch No."` | Code[20] | direct. |
| `summary` | string | `.Description` | Text[100] | direct. |
| `state` | queued, posted, failed | `.State` | Enum `SIR_WF Posting State` | enum map. `reconciled` is returned as `posted`. |
| `attempt` | int > 0 | `.Attempt` | Integer | direct. |
| `simulated` | boolean | — | | Constant `false`. |
| `dayId` | string | `SIR_WF Timesheet Day."Public Id"` for `."Employee No."` + `.Date` | Text[50] | lookup. |
| `at` | ISO date-time | `."Posted At"`, else `."Queued At"` | DateTime | direct. |
| `cause` | string, optional | `."Error Kind"` | Enum `SIR_WF Posting Error Kind` | enum map. |
| `reason` | string, optional | `."Last Error"` | Text[500] | direct. |

Each try also writes a `SIR_WF Posting Attempt` row (§10.1). The contract does not expose those rows.

## 6. Clock (`clock.ts`)

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `ClockRecord.id` | string | `SIR_WF Clock Record."Public Id"` | Text[50] | lookup. |
| `personCode` | string | `."Employee No."` | Code[20] | direct. |
| `date` | IsoDate | `.Date` | Date | direct. |
| `events[]` (kind, at) | ClockEvent[] | `SIR_WF Clock Event` rows: `.Kind`, `.At` | Enum `SIR_WF Clock Kind`, DateTime | direct. `At` is always `CurrentDateTime`. |
| `late` | boolean | `.Late` | Boolean | direct. Set by BC on the first clock in. |
| `closedLate` (finish, at) or null | | `."Closed Late Finish"`, `."Closed Late At"` | Text[5], DateTime | split. null when blank. |
| `written` ({breaks}) or null | | `."Written Breaks"` | Blob JSON | null when the Blob is empty. |
| `closedNoDay` (finish, at) or null | | `."Closed No Day Finish"`, `."Closed No Day At"` | Text[5], DateTime | split. |
| `state` | idle, running, onBreak, clockedOut | — | | derived in proxy from the events. |
| `elapsedSeconds` | int | — | | derived in proxy against `serverNow`. |
| `label` | string | — | | derived in proxy. |
| `CloseClock.finish` | string ≤ 5 | `."Closed Late Finish"` or `."Closed No Day Finish"` | Text[5] | direct. |
| `MyClock.*` (serverNow, now, date, current, version, rota, targetHours, open, openBlocked, gates, status) | | — | | derived in BC (`serverNow` is `CurrentDateTime`) and in the proxy. |
| `ClockMoved.day` | | `SIR_WF Timesheet Day` | | The draft day that clock out wrote (§5.1). |

## 7. Rota (`rota.ts`)

### 7.1 Shift type → `SIR Employee Work Shift` + `SIR Emp. Work Shift Line`

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `SIR Employee Work Shift."SIR_WF Public Id"` | Text[50] | lookup. |
| `code` | string ≤ 4 | `SIR Employee Work Shift.Code` | Code[20] | direct. Immutable. |
| `name` | string ≤ 60 | `.Description` | Text[100] | direct. |
| `from` | string ≤ 5 | `SIR Emp. Work Shift Line."Shift Start Time"` (the line with `Day = All Days`) | Time | HH:MM ↔ Time. |
| `to` | string ≤ 5 | `."Shift End Time"` | Time | HH:MM ↔ Time. |
| `breakMinutes` | int ≥ 0 | `."Break Minutes"` | Integer | direct. |
| `night` | boolean | `SIR Employee Work Shift."SIR_WF Night"` | Boolean | direct. |
| `tone` | E, L, N | `."SIR_WF Tone"` | Enum | enum map. |
| `hours`, `cross`, `start`, `end` | number, boolean | — | | derived in proxy (`recalcShift`) from the times and the break. |
| `eligibleAll` (create) | boolean | `."SIR_WF Eligible All"` | Boolean | direct. It also adds the shift to each type in `SIR_WF Rota Config."Type Rota"`. |
| `ShiftUsage.rota`, `.patterns` | int | — | | derived in BC: `SIR_WF Rota Cell` and `SIR_WF Rota Pattern.Days` that use the code. |

The line's `Start Date` and `End Date` stay blank. `Break Start Time` and `Break End Time` stay blank, because the contract has break minutes only.

### 7.2 Rota week → `SIR_WF Rota Week`, `SIR_WF Rota Cell`, `SIR_WF Rota Change`

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `RotaWeekView.id` | string | `SIR_WF Rota Week."Public Id"` | Text[50] | lookup. |
| `version` | int | `."Version"` (0 when no row) | Integer | direct. |
| `location.code` | string | `."Work Site Code"` | Code[20] | direct. PK 1. |
| `location.name`, `.area`, `.level`, `.minPerShift` | | `SIR Work Sites` | | lookup (§3.1). |
| `weekStart` | IsoDate | `."Week Start"` | Date | direct. PK 2. |
| `state` | RotaState | `.State` | Enum `SIR_WF Rota State` | enum map. |
| `publishVersion` | int | `."Publish Version"` | Integer | direct. |
| `publishedAt` | date-time or '' | `."Published At"` | DateTime | direct. |
| `publishedBy` | Actor or null | `."Published By"` | Code[20] | lookup. The name is derived. |
| `rows[].line[7]` | string[7] | `SIR_WF Rota Cell.Value` for Day 0–6 | Code[4] | join (7 rows, one per day). A missing row is ''. |
| `rows[].personCode` | string | `SIR_WF Rota Cell."Employee No."` | Code[20] | direct. |
| `rows[].name`, `jobProfile`, `jobProfileName`, `category`, `employeeType`, `typeName`, `contractedHours` | | `Employee` and its `SIR_WF` fields | | lookup. |
| `rows[].hours`, `rows[].restIssues` | | — | | derived in proxy. |
| `changes[]` | RotaChange[] | `SIR_WF Rota Change` rows | | §7.3. |
| `label`, `isoWeek`, `today`, `prevWeek`, `nextWeek`, `locations`, `min`, `gapDays`, `onShift`, `coverage`, `key`, `shifts`, `rules`, `publications` | | — | | derived in proxy from the week, its cells, the shift types, `SIR_WF Rota Config` and the flags. `publications` lists `SIR_WF Rota Week` rows by `Published At`. |
| `signoff` (requestedBy, at, signed[], waitingOn, final, decide, why) | | **Gap** | | 01 has no field for the Rota sign-off layers. Stored as `SIR_WF Rota Week."Sign-off"` (Blob JSON), added to 01 (§11). |
| `sentBack` (by, at, reason) | | `SIR_WF Rota Week."Sent Back By"`, `."Sent Back At"`, `."Sent Back Reason"` | Code[20], DateTime, Text[300] | direct. Added to 01 (§11). |

`CellInput` (personCode, day, code ≤ 4, why ≤ 200) writes one `SIR_WF Rota Cell` row and one `SIR_WF Rota Change` row. `AcceptPlan.items[]` uses the same path. `RepeatInput.weeks`, `WeekTransition.to` and `WeekSignOff` (to, reason ≤ 300) are command parameters. `WeekPlan`, `PlanItem`, `CellSuggestions`, `Suggestion`, `RuledOut`, `HoursFlag` and `Counts` are derived in proxy and are not stored.

### 7.3 Rota change → `SIR_WF Rota Change`

| Contract field | Type | BC field | BC type | Rule |
|---|---|---|---|---|
| `at` | date-time | `.At` | DateTime | direct. |
| `by.personCode` | string | `."By Employee No."` | Code[20] | direct. The name is derived. |
| `personCode` | string | `."Employee No."` | Code[20] | direct. |
| `name` | string | — | | derived in BC. |
| `date` | IsoDate | `.Date` | Date | direct. |
| `from`, `to` | string | `."From Value"`, `."To Value"` | Code[4] | direct. |
| `why` | string ≤ 200 | `.Why` | Text[200] | direct. |
| `afterPublish` | boolean | `."After Publish"` | Boolean | direct. |
| `version` | int | `."Week Version"` | Integer | direct. |

### 7.4 Pattern → `SIR_WF Rota Pattern` + `SIR_WF Rota Pattern Person`

| Contract field | Type / limit | BC field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `."Public Id"` | Text[50] | lookup. |
| `code` | string | `.Code` | Code[20] | direct. Immutable. |
| `name` | string ≤ 80 | `.Name` | Text[100] | direct. |
| `cycle` | int | `."Cycle (Days)"` | Integer | direct. |
| `locations[]` | string[] ≤ 20 | `."Work Site Codes"` | Text[250] | join with ",". **Risk**: 20 codes × 20 characters is more than 250 (§11). |
| `jobProfiles[]` | string[] ≤ 20 | `."Job Profile Codes"` | Text[250] | join with ",". Same risk. |
| `costCentre` | string ≤ 20 | `."Cost Centre Code"` | Code[20] | direct. |
| `starts` | string | `.Starts` | Text[20] | direct. |
| `horizon` | int | `.Horizon` | Integer | direct. |
| `gen` | string | `.Generate` | Text[20] | direct. |
| `genFrom`, `genTo` | string | `."Generate From"`, `."Generate To"` | Date | direct ('' is 0D). |
| `active` | boolean | `.Active` | Boolean | direct. |
| `days[]` | CellCode[] ≤ 28 | `.Days` | Blob JSON | Blob JSON. |
| `people[]` (personCode, offset) ≤ 200 | | `SIR_WF Rota Pattern Person."Employee No."`, `.Offset` | Code[20], Integer | one row per person. |
| `PatternList.people[]`, `canCover`, `today`, `elsewhere` | | — | | derived in BC. |
| `AddPatternPeople` (personCodes, start, mode), `GeneratePattern` (gen, genFrom, genTo), `CreatePattern.base` | | — | | Command parameters. |

### 7.5 Cover, filled shift and IT request

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `CoverRecord.id` | string | `SIR_WF Cover Request."Public Id"` | Text[50] | lookup. |
| `location` | string | `."Work Site Code"` | Code[20] | direct. |
| `date` | IsoDate | `.Date` | Date | direct. |
| `shift` | string ≤ 4 | `."Shift Code"` | Code[4] | direct. |
| `reason` | string ≤ 40 | `.Reason` | Text[40] | direct. |
| `stage` | int | `.Stage` | Integer | direct. |
| `open`, `urgent` | boolean | `.Open`, `.Urgent` | Boolean | direct. |
| `openedAt` | date-time | `."Opened At"` | DateTime | direct. |
| `asked` | string | `.Asked` | Text[100] | direct. |
| `log[]` (stage, at, audience, channel, sent) | | `.Log` | Blob JSON | Blob JSON. |
| `CoverView.locationName`, `shiftName`, `time`, `next`, `suggestions`, `eligible` | | — | | derived in proxy. |
| `FilledShift.id` | string | `SIR_WF Filled Shift."Public Id"` | Text[50] | lookup. |
| `coverId` | string | `."Cover Entry No."` → the cover's `Public Id` | Integer | lookup. |
| `location`, `date`, `shift` | | `."Work Site Code"`, `.Date`, `."Shift Code"` | Code[20], Date, Code[4] | direct. |
| `personCode` | string | `."Employee No."` | Code[20] | direct. The name is derived. |
| `confirmed` | boolean | `.Confirmed` | Boolean | direct. |
| `itRequest` | string | `."IT Request Ref"` | Code[20] | direct. |
| `ItRequest.id` | string | `SIR_WF IT Request."Public Id"` | Text[50] | lookup. |
| `ref` | string | `.Ref` | Code[20] | direct (ITR-1007). |
| `personCode`, `location`, `shift`, `date` | | `."Employee No."`, `."Work Site Code"`, `."Shift Code"`, `.Date` | | direct. The name is derived. |
| `worker`, `status`, `raisedAt`, `system` | | `.Worker`, `.Status`, `."Raised At"`, `.System` | Text[100], Text[30], DateTime, Text[50] | direct. |
| `OpenCover`, `CoverReason`, `CoverAssign` | | | | Command parameters onto the fields above. |
| `CoverBoard.*`, `OpenShift.*`, `MyShifts.*`, `MyShiftDay.*`, `RotaHome.*` | | — | | derived in proxy. |

### 7.6 Rota config → `SIR_WF Rota Config`

| Contract field | Type | BC field | BC type | Rule |
|---|---|---|---|---|
| `minDefault` | number | `."Min Default"` | Integer | direct. |
| `maxHours` | number | `."Max Hours"` | Decimal | direct. |
| `capTolerance` | number | `."Cap Tolerance"` | Decimal | direct. |
| `restHours` | number | `."Rest Hours"` | Decimal | direct. |
| `restWarn` | boolean | `."Rest Warn"` | Boolean | direct. |
| `maxConsec` | number | `."Max Consecutive"` | Integer | direct. |
| `horizon` | number | `.Horizon` | Integer | direct. Follows `SIR_WF Setup."Rota Horizon (Months)"`. |
| `favHeadStart` | number | `."Favourite Head Start"` | Integer | direct. |
| `flexMilestones[]` | number[] ≤ 12 | `."Flex Milestones"` | Text[100] | join with ",". |
| `flexNotifyTo` | string ≤ 80 | `."Flex Notify To"` | Text[80] | direct. |
| `itAccess`, `agencyManual`, `bhEnhanced`, `outlook`, `publishBlockOnGap` | boolean | `."IT Access"`, `."Agency Manual"`, `."Bank Holiday Enhanced"`, `.Outlook`, `."Publish Block On Gap"` | Boolean | direct. |
| `rotaBuiltBy` | string | `."Rota Built By"` | Text[30] | direct. |
| `safeRules` (clearance, quals, night, availability, conflicts, maxHours, rest, consec) | | `."Safe Rules"` | Blob JSON | Blob JSON. |
| `fulfilStages[]` (n, audience, wait, channel, next) | | `."Fulfil Stages"` | Blob JSON | Blob JSON. |
| `types` | record<string, TypeRota> | `."Type Rota"` | Blob JSON | Blob JSON. |

### 7.7 Rota profile and set-aside

| Workforce data | BC table.field | Rule |
|---|---|---|
| cleared | `SIR_WF Rota Profile.Cleared` | direct. Not in the contract's records. Read by eligibility rules. |
| favourite | `.Favourite` | direct. |
| preferred days | `."Preferred Days"` | join. |
| DBS expiry | `Employee Qualification."Expiration Date"` where `"Qualification Code" = 'DBS'` | lookup. |
| qualifications | `Employee Qualification` rows (`"Qualification Code"`, `Description`, `"Expiration Date"`) | lookup. |
| set-aside shifts | `SIR_WF Rota Set Aside.Lines` | Blob JSON. |

## 8. Leave (`leave.ts`)

### 8.1 Leave request → `SIR_WF Leave Request`

| Contract field | Type / limit | BC field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `."Public Id"` | Text[50] | lookup. |
| `personCode` | string | `."Employee No."` | Code[20] | direct. |
| `type` | string ≤ 10 | `."Leave Code"` | Code[20] | lookup to `SIR Leave Code.Code`. |
| `from`, `to` | IsoDate | `."Date From"`, `."Date To"` | Date | direct. |
| `part` | full, am, pm, hours | `.Part` | Enum `SIR_WF Leave Part` | enum map. |
| `qty` | number | `.Quantity` | Decimal | direct. Computed by BC on request. |
| `unit` | days, hours | `.Unit` | Enum `SIR_WF Balance Unit` | enum map. |
| `state` | pending, approved, declined, cancelled | `.State` | Enum `SIR_WF Leave State` | enum map. |
| `raisedAt` | date-time | `."Raised At"` | DateTime | direct. |
| `note` | string ≤ 200 | `.Note` | Text[200] | direct. |
| `impact` | string | `.Impact` | Text[250] | direct. |
| `short`, `escalated` | boolean | `.Short`, `.Escalated` | Boolean | direct. |
| `decidedAt` | date-time or '' | `."Decided At"` | DateTime | direct. |
| `decidedBy` | Actor or null | `."Decided By"` | Code[20] | lookup. The name is derived. |
| `reason` | string ≤ 300 | `."Decline Reason"` | Text[300] | direct. |
| `history[]` (from, to, by, at, reason, layer) | | `SIR_WF Leave Request Log` rows | | `."From State"`, `."To State"`, `."By Employee No."`, `.At`, `.Reason`, `.Layer`. |
| `LeaveRequestView.typeName`, `range`, `qtyText`, `stateLabel`, `tone`, `glyph` | | — | | derived in proxy. |
| `TeamRequestView.name`, `location`, `balance`, `sla`, `stage`, `layer`, `advisories` | | — | | derived in proxy. `layer` uses `."Current Layer"`. |
| `RequestLeave` (type ≤ 10, from, to, part, note ≤ 200) | | the fields above | | Command parameters. |
| `DeclineLeave.reason` | string ≤ 300 | `."Decline Reason"` | Text[300] | direct. |

### 8.2 Leave types → `SIR Leave Code` + `SIR_WF Leave Code` extension

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `code` | string 1–10 | `.Code` | Code[20] | direct. Immutable. |
| `name` | string ≤ 60 | `."SIR_WF Name"` + `.Description` | Text[60] + Text[50] | split. The first 50 characters go to `Description` for payroll pages. |
| `icon` | string ≤ 4 | `."SIR_WF Icon"` | Text[4] | direct. |
| `short` | string ≤ 20 | `."SIR_WF Short Name"` | Text[20] | direct. |
| `policy` | string ≤ 10 | `."SIR_WF Policy Code"` | Code[10] | lookup to `SIR_WF Leave Policy`. |
| `paid` | boolean | `."SIR_WF Paid"` | Boolean | direct. A paid type should have `."Pay Element"` set; that is payroll's setup and is not written by Workforce. |
| `evidence` | boolean | `."SIR_WF Evidence"` | Boolean | direct. |
| `unit` | days, hours, weeks | `."SIR_WF Unit"` | Enum `SIR_WF Leave Unit` | enum map. It also sets `."Default Unit of Measure"` (W1): days → Per Day, hours → Per Hour, weeks → Per Week. |
| `active` | boolean | `."SIR_WF Active"` | Boolean | direct. |
| `LeaveTypeOption.hint`, `MyLeave.types[]` | | — | | derived in proxy. |

### 8.3 Leave policy → `SIR_WF Leave Policy` + `SIR_WF Leave Service Rule`

| Contract field | Type / limit | BC field | BC type | Rule |
|---|---|---|---|---|
| `code` | string 1–10 | `.Code` | Code[10] | direct. |
| `name` | string ≤ 60 | `.Name` | Text[60] | direct. |
| `method` | accrual, fixed, none, external, sickness | `.Method` | Enum `SIR_WF Leave Method` | enum map. |
| `unit` | days, hours, weeks | `.Unit` | Enum `SIR_WF Leave Unit` | enum map. |
| `base` | number | `.Base` | Decimal | direct. |
| `serviceRules[]` (afterYears, add, cap) | | `SIR_WF Leave Service Rule."After Years"`, `.Add`, `.Cap` | Decimal | one row per rule. |
| `prorata` | boolean | `."Pro Rata"` | Boolean | direct. |
| `carry` | number | `.Carry` | Decimal | direct. |
| `approval` | boolean | `.Approval` | Boolean | direct. |
| `sla` | int or null | `."SLA Days"` | Integer | direct. null is 0. **Gap**: 0 is also a real value. Store −1 for null (§11). |
| `bankHolidayHandling` | working-days, included, not-applicable | `."Bank Holiday Handling"` | Enum `SIR_WF BH Handling` | enum map. |

### 8.4 Leave config → `SIR_WF Leave Config`

| Contract field | Type / limit | BC field | BC type | Rule |
|---|---|---|---|---|
| `slaDays` | number | `."SLA Days"` | Integer | direct. |
| `toilMax` | number | `."TOIL Max"` | Decimal | direct. |
| `toilWindow` | number | `."TOIL Window"` | Integer | direct. |
| `bhPaid` | boolean | `."Bank Holiday Paid"` | Boolean | direct. |
| `absenceTrigger` | number | `."Absence Trigger"` | Integer | direct. |
| `autoEntitlement` | boolean | `."Auto Entitlement"` | Boolean | direct. |
| `blocksTimesheet` | boolean | `."Blocks Timesheet"` | Boolean | direct. |
| `affectsRota` | boolean | `."Affects Rota"` | Boolean | direct. |
| `minNotice` | number | `."Min Notice"` | Integer | direct. |
| `cancelWindow` | number | `."Cancel Window"` | Integer | direct. |
| `sicknessReasons[]` | string ≤ 40, ≤ 30 items | `."Sickness Reasons"` | Blob JSON | Blob JSON. |
| `types[]` | LeaveTypeRecord[] ≤ 30 | `SIR Leave Code` rows | | §8.2. Replaced whole on save, but a code in use is never deleted (it becomes inactive). |
| `policies[]` | LeavePolicy[] ≤ 20 | `SIR_WF Leave Policy` rows | | §8.3. |
| `stages[]` (n, who ≤ 60, action ≤ 120, wait, channel ≤ 40) ≤ 10 | | `.Stages` | Blob JSON | Blob JSON. Renumbered by position. |
| `typeLeave` | record<type code, {policy ≤ 10, unit}> | `."Type Leave"` | Blob JSON | Blob JSON, merged by type code. |
| `finYearStart` | string ≤ 5 | `."Fin. Year Start"` | Text[5] | direct. |
| `LeaveSetup.employeeTypes`, `flags`, `rotaOn`, `requestCounts`, `leavers` | | — | | derived in BC. |

### 8.5 Ledger → `SIR Leave Ledger Entry` + `SIR_WF Leave Ledger Entry` extension

| Contract field | Type | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `."Entry No."` | Integer | lookup (as text). |
| `date` | IsoDate | `."Posting Date"` | Date | direct. |
| `type` | string | `."Leave Code"` | Code[20] | direct. |
| `qty` | number | `."No. of Unit"` | Decimal | direct. Signed: positive adds to the balance. |
| `unit` | days, hours | `."Pay Unit of Measure"` | Enum `SIR Pay Unit of Measure` | enum map: days ↔ Per Day, hours ↔ Per Hour. |
| `why` | string | `."SIR_WF Why"` | Text[250] | direct. |
| `counts` | boolean | `."SIR_WF Counts"` | Boolean | direct. |
| `dates[]` | IsoDate[], optional | `."SIR_WF Dates"` | Blob JSON | Blob JSON. |
| `qtyText` | string | — | | derived in proxy. |
| (by) | | `."SIR_WF By Employee No."` | Code[20] | Not in the contract. Audit. |
| (entry type) | | `."Leave Entry Type"` | Enum `SIR Leave Entry Type` (extended) | `Adjustment` for a Workforce adjustment, `Opening` for the opening position, `TOIL` for TOIL earned. |
| (amount) | | `.Amount` | Decimal | **Never written or read by Workforce.** |

**Opening position (design doc `leave_base`)**: one `SIR Leave Ledger Entry` per person, year and kind, with `Leave Entry Type = Opening`, `"SIR_WF Leave Year"` set, and `"No. of Unit"` = the taken or accrued opening quantity. `toil` and `toil_by` are a `TOIL` entry and its expiry, which goes in `"End Date"`.

**Balances**: `EntitlementView`, `BalanceView`, `LeaveFacts`, `LeaveYear`, `MyLeave`, `TeamBalanceRow`, `EntitlementDetail` and `CalcLine` are all derived in proxy. They come from the policy (§8.3), the person (`SIR Contracted Hours`, `Employment Date`), the requests (§8.1) and the ledger (§8.5). Balances are never stored (design doc D3).

### 8.6 Sickness → `SIR_WF Sick Episode`

| Contract field | Type / limit | BC field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `."Public Id"` | Text[50] | lookup. |
| `personCode` | string | `."Employee No."` | Code[20] | direct. |
| `from` | IsoDate | `."Date From"` | Date | direct. |
| `to` | IsoDate or '' | `."Date To"` | Date | direct. '' while still off. |
| `reason` | string ≤ 40 | `.Reason` | Text[40] | direct. |
| `note` | string ≤ 200 | `.Note` | Text[200] | direct. |
| `rtw.requestedAt` | date-time | `."RTW Requested At"` | DateTime | direct. null when blank. |
| `rtw.by` | Actor | `."RTW Requested By"` | Code[20] | lookup. The name is derived. |
| `SicknessRow.*`, `SicknessBoard.*`, `SickOnLeaveDay.*` | | — | | derived in proxy (Bradford score, triggers). |
| `GiveDaysBack` (personCode, dates[] ≤ 60) | | one `SIR Leave Ledger Entry` (§8.5) | | Command. It also cancels the matching `SIR Leave Register Detail` rows (§10.2). |

### 8.7 Leavers

| Contract field | BC table.field | Rule |
|---|---|---|
| `LeaverRow.personCode` | `Employee."No."` where `"SIR_WF State" = Leaver` | lookup. |
| `name` | — | derived in BC. |
| `leaveDate` | `Employee."Termination Date"` | direct. |
| `note` | `Employee."SIR_WF Leaver Note"` | direct. |
| `months`, `full`, `prorata`, `taken`, `diff`, `hours`, `verdict`, `tone`, `action` | — | derived in proxy. The money settlement is payroll's. |
| `Leavers.settled` | — | derived in proxy. |

## 9. Onboarding (`onboarding.ts`)

### 9.1 Config → `SIR_WF Onboarding Config` + `SIR_WF Onboarding Doc. Type`

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `OnboardingConfigRecord.id`, `version` | | `SIR_WF Onboarding Config."Public Id"`, `."Version"` | | direct. |
| `steps[]` (id, label ≤ 60, on, fixed, desc ≤ 200) ≤ 10 | | `SIR_WF Onboarding Config.Steps` | Blob JSON | Blob JSON. Steps are switched, never added or reordered. |
| `documents[].id` | string ≤ 20 | `SIR_WF Onboarding Doc. Type.Code` | Code[20] | direct. |
| `documents[].label` | string ≤ 60 | `.Label` | Text[60] | direct. |
| `documents[].req` | boolean | `.Required` | Boolean | direct. |
| `documents[].verify` | hr, mgr, either, none | `.Verifier` | Enum `SIR_WF Verifier` | enum map. |
| `documents[].blocks` | boolean | `."Blocks Start"` | Boolean | direct. |
| `documents[].expiry` | boolean | `."Has Expiry"` | Boolean | direct. |
| `documents[].hint` | string ≤ 200 | `.Hint` | Text[200] | direct. |
| (order) | | `."Sort Order"` | Integer | Position in the array. |
| `OnboardingSetup.features`, `steps[]` (available, needs), `verifiers`, `inProgress` | | — | | derived in BC from the flags and the cases. |

### 9.2 Policy → `SIR_WF Onboarding Policy`

| Contract field | Type / limit | BC field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `.Code` | Code[20] | lookup. **Mismatch**: the template's policy id is `^[a-z0-9_]{1,80}$`, longer than Code[20] (§11). |
| `version` | int | `."Version"` | Integer | direct. |
| `label` | string ≤ 80 | `.Label` | Text[80] | direct. |
| `ver` | string ≤ 20 | `.Ver` | Text[20] | direct. |
| `sum` | string ≤ 300 | `.Summary` | Text[300] | direct. |
| `body[]` | string[] | `.Body` | Blob JSON | Blob JSON. |
| `order` | int | `."Sort Order"` | Integer | direct. |
| `file.name` | string ≤ 255 | `."File Name"` | Text[255] | direct. |
| `file.size` | int | `."File Size"` | Integer | direct. |
| `file.type` | string ≤ 120 | `."File Type"` | Text[120] | direct. |
| `file.at` | date-time | `."File At"` | DateTime | direct. |
| `file.kind` | image, pdf, file | — | | derived from the type. |
| `file.preview` | data URL | **Gap** | | Not stored for policies (01 has no field). The contract makes it optional. |
| `ackCount`, `removeText` | | — | | derived in BC / in proxy. |

### 9.3 Case → `SIR_WF Onboarding Case` + `SIR_WF Onboarding Document`

| Contract field | Type / limit | BC table.field | BC type | Rule |
|---|---|---|---|---|
| `id` | string | `SIR_WF Onboarding Case."Public Id"` | Text[50] | lookup. |
| `personCode` | string | `."Employee No."` | Code[20] | direct. |
| `steps` | record<step, TaskState> | `.Steps` | Blob JSON | Blob JSON. |
| `docs` | record<doc, TaskState> | `SIR_WF Onboarding Document.State` per `"Doc. Type Code"` | Enum `SIR_WF Task State` | join (one row per document). |
| `files` | record<doc, OnbFileRecord> | `SIR_WF Onboarding Document."File Name"`, `."File Size"`, `."File Type"`, `."File Kind"`, `."File At"`, `.Preview` | | join. |
| `rejections` | record<doc, string> | `SIR_WF Onboarding Document."Rejection Reason"` | Text[300] | join. |
| `acks` | record<policy, version> | `."Policy Acks"` | Blob JSON | Blob JSON. |
| `read` | record<policy, boolean> | `."Policies Read"` | Blob JSON | Blob JSON. |
| `data.personal` (dob ≤ 10, gender ≤ 40, nat ≤ 60, ni ≤ 20) | | `.Data` | Blob JSON | Encrypted at rest (`EndUserIdentifiableInformation`). Never in the tracker view or the audit. |
| `data.contact` (mob ≤ 30, alt ≤ 30, a1 ≤ 200, a2 ≤ 200, city ≤ 80, post ≤ 12) | | `.Data` | Blob JSON | as above. |
| `data.emergency[]` (nm ≤ 120, rel ≤ 40, ph ≤ 30) ≤ 5 | | `.Data` | Blob JSON | as above. |
| `data.additional` (conv ≤ 10, convDetail ≤ 1000, wtd ≤ 60, quals[] (nm, by, exp) ≤ 10) | | `.Data` | Blob JSON | as above. |
| `data.documents.rtwType` | ≤ 60 | `.Data` | Blob JSON | as above. |
| `signature` | string ≤ 120 | `.Signature` | Text[120] | direct. |
| `consent` | boolean | `.Consent` | Boolean | direct. |
| `submittedAt`, `invitedAt`, `startedAt` | date-time or '' | `."Submitted At"`, `."Invited At"`, `."Started At"` | DateTime | direct. |
| `ref` | string | `.Ref` | Code[20] | direct (ONB-1001). |
| `asked` (steps[], documents[] {id, req, blocks}) | optional | `.Asked` | Blob JSON | Blob JSON. |
| (verified by) | | `SIR_WF Onboarding Document."Verified By"` | Code[20] | Not in the contract. Must not be the starter. |
| `OnbPerson.*`, `OnbStepView.*`, `OnbDocumentView.*`, `OnbPolicyView.*`, `Blocker`, `OnbProgress`, `OnboardingDetail.*`, `StarterOnboarding.*`, `TrackerRow.*`, `OnbQueueRow.*`, `TeamOnboarding.*` | | — | | derived in proxy (state labels, tones, progress) and in BC (blockers, scope). |
| `SaveStep`, `UploadFile`, `AckPolicy`, `SubmitOnboarding`, `RejectDocument` | | | | Command parameters onto the fields above. `SaveStep.mode` is not stored. |

### 9.4 Write-back when a starter becomes active

The `onboardingStarts` command (or the person transition to active) copies `.Data` into the person:

| Case data | BC table.field | Rule |
|---|---|---|
| `personal.dob` | `Employee."Birth Date"` | Text "YYYY-MM-DD" → Date. |
| `personal.gender` | `Employee.Gender` | enum map: Female, Male, Other; anything else is blank. |
| `personal.nat` | **Gap** | No base field. It stays in the case (§11). |
| `personal.ni` | `Employee."Social Security No."` (Text[30]); in NZ also `Employee."SIR_NZ IRD Number"` through `OnApplyOnboardingTaxNumber` | direct. The country subscriber validates the format. |
| `contact.mob` | `Employee."Mobile Phone No."` | direct. |
| `contact.alt` | `Employee."Phone No."` | direct. |
| `contact.a1`, `.a2`, `.city`, `.post` | `Employee.Address`, `"Address 2"`, `City`, `"Post Code"` | direct. **Mismatch**: a1 and a2 allow 200, Address is 100 and Address 2 is 50 (§11). |
| `emergency[].nm`, `.rel`, `.ph` | `Employee Relative."First Name"`, `."SIR Relationship"` (W1), `."Phone No."`, with `"SIR_WF Emergency Contact" = true` | One row per contact. **Mismatch**: nm allows 120, First Name is 30 (§11). |
| `additional.quals[].nm`, `.by`, `.exp` | `Employee Qualification.Description`, `."Institution/Company"`, `."Expiration Date"` | One row per qualification. `"Qualification Code"` is `SIR_WF Setup`'s default code (§11). |
| `additional.conv`, `.convDetail`, `.wtd` | — | Stay in the case only. Convictions are special-category data and are never copied. |
| `documents.rtwType` | — | Stays in the case. |
| verified documents | `Document Attachment` (Table 5200) | Only when a document store exists (design doc D8). Today the metadata stays in the case. |

## 10. Posting outbound

### 10.1 `SIR_WF Posting Line` → `SIR Timesheet Interface`

The dispatcher inserts one row per posting line with `Source = timesheet`. Fields are set in this order, because some validations depend on earlier fields.

| No. | Interface field | Type | Value | Rule and triggers |
|---|---|---|---|---|
| 15 | `Entry No.` | Integer | 0 | AutoIncrement assigns it. Stored back into `SIR_WF Posting Line."Target Entry No."`. |
| 2 | `Payroll No.` | Code[20] | `Posting Line."Employee No."` | Validate. `OnValidate` fills `Employee Name` from `Employee.FullName()`. `ValidateTableRelation = false`, so the dispatcher first checks that the employee exists and is not terminated before the date (`EMPLOYEE_TERMINATED`, data error). |
| 3 | `Employee Name` | Text[100] | set by the validate above | Not editable. |
| 20 | `Pay Frequency` | Code[20] | `Employee."SIR Pay Cycle Code"` | direct (validate). Blank means a data error `NO_PAY_CYCLE`. |
| 21 | `Fiscal Year` | Code[20] | `SIR Pay Period."Fiscal Year"` where `"Pay Frequency"` = the above and `"Start Date" <= Date <= "End Date"` | lookup. None means `NO_PAY_PERIOD`. |
| 22 | `Pay Cycle Period` | Integer | `SIR Pay Period.Period` (same row) | lookup. `SIR Pay Period.Posted = true` means `PERIOD_POSTED`. |
| 23 | `Entry Type` | Enum | Daily | constant. |
| 4 | `Interface Code` | Code[20] | `Posting Line."Pay Code"` | Validate. `OnValidate` clears `Pay Element`, then sets it from `SIR TIme Sheet Elements` where `"External Field Mapping"` = the code. A blank result means `UNKNOWN_PAY_CODE` (data error). |
| 18 | `Pay Element` | Code[50] | set by the validate above | Not written directly. |
| 5 | `Classification` | Text[100] | `Posting Line.Description` (the pay code label and the day) | direct. Information only. |
| 6 | `No. Of Units` | Decimal | `Posting Line.Quantity` | direct. Hours, or days when the employee type's `Pay Basis` is day. |
| 7 | `Rate` | Decimal | 0 (not set) | **Never validated.** Validating `Rate` sets `Gross Pay`. Payroll pulls the rate (`SIR Pull Rate From Emp Site P`, from `SIR Employee Site Pay Elements`). |
| 8 | `Gross Pay` | Decimal | 0 (not set) | **Never written.** |
| 9 | `Site Code` | Code[20] | `Posting Line."Work Site Code"` | Validate. `OnValidate` checks the site's dimension value, work site and employee site, and **can create them** when `SIR Timesheet Setup."Create Dim. From TS Interface"` is on. Workforce only posts sites that already exist (checked on approval), so the validate finds them and creates nothing. A missing employee site row is a data error, `SITE_NOT_ASSIGNED`. |
| 10 | `Site Name` | Text[100] | `SIR Work Sites.Description` | direct. |
| 1 | `Branch Name` | Text[50] | `SIR Work Sites.Description`, first 50 characters | direct. Information only. |
| 11 | `User` | Code[50] | `'WORKFORCE'` | direct. **Note**: `TableRelation = User."User Name"`. The dispatcher runs as the job queue user, so set `User` to `UserId()` and keep `'WORKFORCE'` in `Classification` instead, unless a `WORKFORCE` user exists. Decided in the implementation plan (§11). |
| 12 | `DateTime Of Changes` | DateTime | `CurrentDateTime` | direct. |
| 13 | `Start Date` | DateTime | `Posting Line."Start DateTime"` (day + first entry start) | direct. |
| 14 | `End Date` | DateTime | `Posting Line."End DateTime"` (day + last entry finish) | direct. For hours-only capture: the date at 00:00 and the date plus the hours. |
| 16 | `Is Timesheet Created` | Boolean | false | constant. `SIR Timesheet Create Mgt` sets it. |
| 17 | `Irregular` | Boolean | false | constant. |
| WF+n | `SIR_WF Posting Line Id` | Guid | `Posting Line."Idempotency Key"` | direct. Unique key: a second insert fails, so the line is never posted twice. |

Dimensions: the interface row has no dimension fields. `SIR Timesheet Create Mgt` takes dimensions from the work site and the employee site. Project and job task do not reach payroll (`01` §7.1).

### 10.2 `SIR_WF Leave Request` → `SIR Leave Register` and `SIR Leave Register Detail`

Written synchronously by the last approval. `OnInsert` of both tables assigns `Entry No.` (`FindLast` + 1, after `LockTable`) and checks for a duplicate `External ID` and `External Request ID` (the Register also checks the external code). This gives idempotency without a new field. Workforce sets the external ids from the request, so a repeat insert is refused by W1's own check.

**`SIR Leave Register`**

| No. | Field | Type | Value | Rule |
|---|---|---|---|---|
| 1 | `Entry No.` | Integer | assigned in `OnInsert` | Stored in `SIR_WF Leave Request."Register Entry No."`. |
| 5 | `Employee Code` | Code[20] | `."Employee No."` | direct. |
| 6 | `Employee Name` | Text[100] | `Employee.FullName()` | direct. |
| 10 | `Leave Code` | Code[20] | `."Leave Code"` | direct. |
| 20 | `Requested Date` | Date | `DT2Date(."Raised At")` | direct. |
| 21 | `Start Date` | Date | `."Date From"` | direct. |
| 22 | `End Date` | Date | `."Date To"` | direct. |
| 30 | `Approval Status` | Enum `SIR Approval Status` | Approved | constant on approval. Cancelled on a later cancel. |
| 50 | `Approved By` | Code[50] | the approver's `Employee."SIR Associated User ID"`, else the Employee No. | lookup. |
| 51 | `Approved Date` | Date | `Today` | direct. |
| 52 | `Approved Time` | Time | `Time` | direct. |
| 60 | `Imported` | Boolean | true | constant: the row came from outside payroll. |
| 100 | `External Request ID` | Guid | `SIR_WF Leave Request.SystemId` | direct. Duplicate refused by W1. |
| 102 | `External ID` | Code[35] | `SIR_WF Leave Request."Public Id"` | direct. **Mismatch**: Public Id is Text[50] and External ID is Code[35]. Public Ids for leave requests must stay at 35 characters or fewer (§11). |

**`SIR Leave Register Detail`**, one row per leave day:

| No. | Field | Type | Value | Rule |
|---|---|---|---|---|
| 1 | `Entry No.` | Integer | assigned in `OnInsert` | |
| 2 | `Leave Register Entry No.` | Integer | the Register row above | direct. |
| 5 | `Employee Code` | Code[20] | `."Employee No."` | direct. |
| 10 | `Leave Code` | Code[20] | `."Leave Code"` | direct. |
| 21 | `Leave Date` | Date | each day from `Date From` to `Date To` that the policy counts (working days, bank holiday handling) | derived in BC with the leave domain rules. |
| 30 | `Approval Status` | Enum | Approved | as the Register. |
| 31 | `Leave Qty.` | Decimal | 1 for a full day, 0.5 for am or pm, the hours for `part = hours` | derived in BC. |
| 60 | `Imported` | Boolean | true | constant. |
| 86 | `Unit of Measure` | Enum `SIR Pay Unit of Measure` | Per Day, or Per Hour when the unit is hours | enum map. |
| 100 | `External Request ID` | Guid | `SIR_WF Leave Request.SystemId` | direct. |
| 101 | `External Request Dtl ID` | Guid | `CreateGuid()`, also kept in the posting line for the day | direct. |
| 102 | `External ID` | Code[35] | `<Public Id>-<yyyymmdd>` | direct. Must fit 35 characters (§11). |

A matching `SIR_WF Posting Line` (`Source = leave`, `State = posted`, `Target Entry No.` = the Register entry) is written in the same transaction, so the integration dashboard shows leave beside hours.

## 11. Gaps and mismatches

### 11.1 Length mismatches

| # | Contract | BC field | Contract limit | BC limit | Resolution |
|---|---|---|---|---|---|
| G1 | Leave type `name` | `SIR Leave Code.Description` | 60 | 50 | `SIR_WF Name` holds the full name; `Description` holds the first 50 characters. |
| G2 | Location `area` (template) | `SIR Work Sites."SIR_WF Area"` | 80 | 60 | Widen `SIR_WF Area` to Text[80]. **01 changed.** |
| G3 | Location `level` (template) | `."SIR_WF Support Level"` | 40 | 30 | Widen to Text[40]. **01 changed.** |
| G4 | Location `address` | `SIR Work Sites.Address` | 200 | 100 | The proxy refuses an address over 100 characters with `TS_INVALID`-style field error `TOO_LONG`. Or add `SIR_WF Address 2`. Decide in the plan. |
| G5 | Department and cost centre `name` (template) | `Dimension Value.Name` | 80 | 50 | Refuse over 50 (`TOO_LONG`). Base field, not extended. |
| G6 | Project `name` and `client`, task `name` | `Job.Description`, `Job Task.Description` | 120 | 100 | Refuse over 100. `SIR_WF Client Name` is widened to Text[120]. **01 changed.** |
| G7 | Task `group` | `Job Task."SIR_WF Task Group"` | 60 | 50 | Widen to Text[60]. **01 changed.** |
| G8 | Bank holiday `name` | `Base Calendar Change.Description` | 80 | 30 | Refuse over 30, or add a `SIR_WF` extension field. Decide in the plan. |
| G9 | Onboarding `contact.a1`, `.a2` | `Employee.Address` (100), `"Address 2"` (50) | 200 | 100 / 50 | Write-back cuts to length and keeps the full text in the case. |
| G10 | Emergency contact `nm` | `Employee Relative."First Name"` | 120 | 30 | Write the first word to `First Name` and the rest to `Last Name` (30). Anything longer stays in the case. |
| G11 | Onboarding policy id (template) | `SIR_WF Onboarding Policy.Code` | 80, lower case | Code[20] | Template import refuses an id over 20 characters. Code fields are upper case, so the read lower-cases. |
| G12 | Employee type `code` | `SIR_WF Employee Type.Code` | lower case | Code[32] (upper case) | Stored upper case, returned lower case. |
| G13 | Leave request `Public Id` | `SIR Leave Register."External ID"` | Text[50] | Code[35] | Leave request Public Ids are generated at 20 characters or fewer, so the Detail's `<id>-<yyyymmdd>` fits 35. |
| G14 | Pattern `locations[]`, `jobProfiles[]` | Text[250] comma lists | 20 × 20 | 250 | Change to Blob JSON in 01. **01 changed.** |

### 11.2 Fields with no home in 01, now added

| # | Contract | Added to 01 |
|---|---|---|
| A1 | `id` and `version` on reused tables the API writes | `SIR_WF Public Id` and `SIR_WF Version` on the extensions of `Employee`, `SIR Work Sites`, `Dimension Value`, `Job`, `Job Task`, `SIR Employee Work Shift`, `SIR Leave Code`, `SIR TIme Sheet Elements`, `Document Attachment`. |
| A2 | `RotaWeekView.signoff` | `SIR_WF Rota Week."Sign-off"` (Blob JSON). |
| A3 | `RotaWeekView.sentBack` | `SIR_WF Rota Week."Sent Back By"`, `."Sent Back At"`, `."Sent Back Reason"`. |
| A4 | `NotificationMatrix.version` | The matrix is versioned by `SIR_WF Setup."Version"`. A matrix save increments it. No new field. |

### 11.3 Values with no Business Central home

| # | Contract | Note |
|---|---|---|
| H1 | Onboarding `personal.nat` (nationality), `additional.conv`, `.convDetail`, `.wtd`, `documents.rtwType` | Stay in `SIR_WF Onboarding Case.Data` only. Right-to-work evidence and convictions are special-category data. |
| H2 | Onboarding policy `file.preview` | Not stored. The contract field is optional. |
| H3 | Project `status` values other than Active, Planned or Planning, Quote, Closed or Completed | Refused with `INVALID_STATUS`. Today's seed uses only `Active`. |
| H4 | Leave policy `sla` null | Stored as −1, because 0 is a valid SLA. |
| H5 | `Employee Qualification."Qualification Code"` | Needs a default code for onboarding qualifications and one for DBS. Add `SIR_WF Setup."Default Qualification Code"` and `."DBS Qualification Code"` in the plan. |
| H6 | `SIR Timesheet Interface.User` | Has a `TableRelation` to `User."User Name"`. Use the job queue user, not the literal `WORKFORCE`. |
| H7 | `IntegrationAttempt.state` and `TimesheetDay.posting` | The contract has no `reconciled` value. Business Central returns `posted` for it until the contract adds the value. |
| H8 | Person `address` and tenant `company.address` | One contract string against four Business Central fields. The comma split is lossy for unusual addresses. A later contract change to a structured address would remove the problem. |

### 11.4 Money

No contract field maps to a Business Central amount, rate or currency field. The Business Central fields that hold money and sit next to mapped fields are never written or read by Workforce: `SIR Timesheet Interface.Rate` and `."Gross Pay"`, `SIR Leave Ledger Entry.Amount`, `SIR Approval Entry.Amount`, `SIR Emp. Payroll Element.*`, and `SIR Stat. Leave Entitlement.*`.
