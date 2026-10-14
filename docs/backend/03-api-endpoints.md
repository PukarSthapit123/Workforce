# Qnipay Workforce on Business Central: API endpoints

2026-10-12 · Status: draft for review · Companion to [`01-bc-backend-design.md`](01-bc-backend-design.md) and [`02-field-mapping.md`](02-field-mapping.md)

This document maps every operation in the Workforce contract to the Business Central API that serves it. The contract is `C:\dev\qnipay-workforce-app\contract\openapi.json`, generated from the zod contract in `src\contract\*.ts`. The React app keeps calling the contract paths (`/api/v1/...`). The Azure Functions proxy turns each call into one or more Business Central calls, as listed in §4.

**Count check.** `openapi.json` holds **172 operations on 138 paths**. §4 maps **172**: Foundation and access 15, People and dimensions 36, Configuration and communication 36, Timesheet 11, Clocking 6, Rota 34, Leave 15, Onboarding 19. The five development-only endpoints and the `/api/_dev/*` helpers are not in `openapi.json`. §4.9 lists them, and none of them is built.

## 1. Conventions

### 1.1 Base URL and naming

```
https://api.businesscentral.dynamics.com/v2.0/{tenantId}/{environment}/api/qnipay/workforce/v1.0/companies({companyId})/{entitySet}
```

| Item | Value |
|---|---|
| `APIPublisher` | `qnipay` |
| `APIGroup` | `workforce` |
| `APIVersion` | `v1.0` |
| `EntitySetName` | camelCase plural (`timesheetDays`) |
| `EntityName` | camelCase singular (`timesheetDay`) |
| `ODataKeyFields` | `SystemId`, exposed as `id` |
| Every writable entity also exposes | `publicId` (the contract's string id), `version` (Integer), `updatedAt` (`SystemModifiedAt`), and a read-only `auditId`, filled by the write that returned the record |

Business Central API pages use the `SystemId` key. The contract addresses records by `publicId` or by code, for example `per_EMP001`, `WH` or `NTC-0002`. The proxy finds the record with `$filter=publicId eq '...'` or `$filter=code eq '...'`, then uses its `id`.

### 1.2 Concurrency

- **Entity writes** (PATCH and DELETE) send `If-Match: <@odata.etag>`. The proxy also checks the contract's integer `If-Match` against the record's `version` before the call. A mismatch refuses with 412 `stale` without calling Business Central. If the etag no longer matches inside Business Central, it answers 412, and the proxy returns `stale`.
- **Commands** carry `version` in the body. The command codeunit compares it with the stored `Version` inside the same transaction. A record that does not exist yet is created at version 1 from `version = 0`.
- A missing `If-Match` on a versioned contract operation returns 428 `version-required` from the proxy. A value that is not a whole number returns 412 `version-unreadable`.

### 1.3 Command entity sets

API page bound actions can neither take parameters nor return a body. Every state change and every write that needs a reason, a list of items, or a result beyond the record is therefore a **command entity set**:

- The API page has `SourceTableTemporary = true` over a command table that is never stored. It has an input part, an output part and a standard header.
- `OnInsertRecord` calls the command's codeunit (`SIR_WF Cmd <Name>`) and fills the output fields. The page returns the inserted record.
- The client POSTs one command. The response (201) holds the outputs. On a refusal the codeunit raises an error, so the whole command rolls back.
- A GET on a command entity set returns nothing.

Standard command header (input):

| Property | Type | Notes |
|---|---|---|
| `sessionToken` | Guid | Required. Resolves the acting and viewing-as person (01 §4.4). |
| `correlationId` | Guid | Required. Copied to the audit row and to any posting line. |
| `idempotencyKey` | Text[100] | Optional. Required on commands that create a record (marked **IK** in §3). |
| `version` | Integer | The If-Match of the record acted on, on versioned commands. |

Standard command outputs:

| Property | Type | Notes |
|---|---|---|
| `result` | Text[20] | `ok`, or `noop` when nothing changed. |
| `recordId` | Guid | The `SystemId` of the main record written. |
| `recordIds` | Text (JSON array) | When several records were written (week submit, bulk approve). |
| `auditId` | Text[50] | The `SIR_WF Audit Event` entry, or blank for a no-op. |
| `warnings` | Text (JSON) | Domain warnings, for example the day save's. |
| `summary` | Text (JSON) | Operation-specific result: held days, rota effect, module effect, counts. Each command in §3 names its shape. |
| `message` | Text[500] | A message in the server's words, where the contract returns one. |

After a command, the proxy reads the records named in `recordId` or `recordIds`, with the `$expand` the contract response needs. It then builds the contract response (`{ record, auditId, ... }`). Both calls go in one `$batch` when the proxy can predict the record id.

### 1.4 Header fields on entity writes

Entity POST, PATCH and DELETE cannot carry the command header in a body field on DELETE. So every writable entity page also exposes three write-only page variables: `sessionToken`, `correlationId` and `idempotencyKey`.

- On POST and PATCH the proxy sends them in the body.
- On DELETE, which has no body, the proxy first PATCHes `sessionToken` and `correlationId`, then DELETEs, both in one `$batch` changeset (atomic).
- The page's `OnModifyRecord`, `OnInsertRecord` and `OnDeleteRecord` triggers resolve the session and check the capability before the table trigger runs.

### 1.5 Paging, filtering and `$batch`

- Lists that can grow (`timesheetDays` for the approval queue, `auditEvents`, `notifications`, `people`) use `$top` and the server-driven `@odata.nextLink` (`$skiptoken`). The contract's `cursor` is opaque to the client. The proxy stores the Business Central `$skiptoken` in it (base64) and returns `nextCursor: null` when there is no `nextLink`.
- The contract caps the audit `limit` at 1000, and the proxy sends it as `$top`.
- Every aggregated view in §5 is one `$batch` request of independent GETs.
- Business Central limits a `$batch` to 100 operations. The proxy splits larger batches, for example bulk approve over 100 days uses one command with a JSON array, not 100 calls.

### 1.6 Refusals

AL raises `Error('<code>: <message>')`, or `Error('<code>: <message>|<json>')` when the refusal carries `usedBy`, `field` or an extra detail object. The proxy:

1. reads `error.message` from the Business Central OData error;
2. splits off the code before the first `: ` and the JSON after the first `|`;
3. maps the code to an HTTP status (table below) and to the contract's `next` text (a lookup table in the proxy, keyed by code);
4. returns `{ code, message, next, field?, usedBy? }`.

A Business Central error without a known code prefix is a defect. It becomes 500 `server-defect` with the original message logged, never shown.

| Code (exact contract string) | HTTP | Raised by |
|---|---|---|
| `signed-out` | 401 | Session resolve: unknown, expired or revoked token, or unknown Entra Object ID. |
| `credentials` | 401 | Not used. It belongs to the simulated sign-in only. |
| `capability` | 403 | Capability check. |
| `scope` | 403 | Location scope check on a write. |
| `viewing-as` | 403 | Any write while viewing as another person, except `viewAsEnds` and `sessionRevokes`. |
| `not-started` | 403 | A candidate or preboarding person writing outside their own onboarding case, notifications and sign-out. |
| `module-off` | 403 | A handler for a module that is off. |
| `feature-off` | 403 | A feature switched off (Documents, Profile self-edit, TOIL and so on). |
| `rota-policy` | 403 | Rota setup reserves building patterns or shift types to administrators. |
| `SELF_APPROVAL`, `ALREADY_SIGNED`, `WRONG_LAYER`, `NOT_YOUR_REQUEST`, `SELF_CHECK` | 403 | Approval chain walk (`SIR_WF Chain Walk`). |
| `not-found` | 404 | Record missing or outside the caller's own records. |
| `in-use` (with `usedBy`) | 409 | `SIR_WF Usage Check`. |
| `IN_USE`, `LAST_SHIFT_TYPE`, `last-type` | 409 | Shift type and employee type removal. |
| `locked`, `LOCKED` | 409 | Self-lockout guards (access) and locked modules (CORE). |
| `MODULE_OFF`, `FLAG_OFF` | 409 | Module and feature switches, clock gates, onboarding steps. |
| `TRANSITION_NOT_ALLOWED` | 409 | Person, timesheet, leave and rota state machines. |
| `ALREADY_SUBMITTED`, `PERIOD_LOCKED`, `ABSENCE_BLOCKED`, `CLOCK_RUNNING`, `QUEUE_CHANGED`, `RETRY_NOT_ALLOWED` | 409 | Timesheet. |
| `CLOCK_MOVE`, `CLOCK_OPEN`, `BREAK_LIMIT`, `NOT_CLOCK_TYPE` | 409 | Clocking. |
| `OVER_BALANCE`, `OVERLAPS`, `ALREADY_REQUESTED`, `ALREADY_RECORDED`, `NOT_SICK_ON_LEAVE`, `NO_ABSENCE`, `REASON_REQUIRED` | 409 | Leave. |
| `LEAVE_IN_PAYROLL` | 409 | **New in Business Central.** Cancelling approved leave whose days a posted payroll run already used (01 §7.2). |
| `MISSING_PAY_SETUP` | 409 | **New in Business Central.** Approving a day for a person with no `SIR Pay Cycle Code`, or with an entry that has no work site (01 §7.1 step 8). |
| `COVERAGE_GAPS`, `WEEK_LIVE`, `ON_LEAVE`, `UNCHANGED`, `UNKNOWN_SHIFT`, `ALREADY_PUBLISHED`, `ALREADY_CONFIRMED`, `NOT_WORKED_YET`, `COVER_OPEN`, `COVER_CLOSED`, `NOTHING_TO_CLEAR`, `NOTHING_TO_COPY`, `AWAITING_SIGNOFF`, `NOT_AWAITING_SIGNOFF`, `NOBODY_ELIGIBLE`, `NOT_OFFERED`, `ALREADY_ON_PATTERN`, `NOTHING_SET_ASIDE` | 409 | Rota. |
| `ALREADY_ACKNOWLEDGED`, `ALREADY_POSTED`, `AUDIENCE_FIXED`, `CHANGED`, `CLOSED`, `NOT_DRAFT`, `NOT_LIVE`, `WITHDRAWN` | 409 | Notices. |
| `NOT_ONBOARDING`, `NOT_READY`, `OUTSTANDING`, `SUBMITTED`, `NOTHING_OUTSTANDING`, `FIXED` | 409 | Onboarding. |
| `LOOP`, `OVERLAP`, `FIXED` | 409 | Approval chains and delegations. |
| `NAME_TAKEN`, `SHIPPED`, `IN_USE`, `NOT_A_TEMPLATE`, `UNREADABLE` | 409 | Templates. |
| `own-change`, `pending`, `decided`, `changed-since` | 409 | Profile changes. |
| `stale`, `version-unreadable` | 412 | Version check. |
| `version-required` | 428 | Proxy only. |
| `invalid` (with `field`), `VALIDATION`, `TS_INVALID`, `ROTA_INELIGIBLE`, `ACTIVATE_EMPTY`, `NO_LANDING` | 422 | Validation. The proxy validates with zod first. Business Central repeats each rule that protects an invariant. |
| `server-defect` | 500 | Unparsed Business Central error. |

A `CODE_IMMUTABLE` refusal does not exist in the contract. A rename of a code refuses with `invalid` and `field: code`, as the contract's `z.never()` does (01 §4.1).

## 2. Entity set catalogue

Page IDs are offsets in the Workforce range (01 §3). Pages are their own object type in AL, so these IDs do not collide with the table IDs WF+1 to WF+56. R = read (GET); C = POST; U = PATCH; D = DELETE.

### 2.1 Foundation and access

| Page | Entity set | Entity | Source table | Ops | Notable properties |
|---|---|---|---|---|---|
| WF+100 | `workforceSetup` | `workforceSetup` | `SIR_WF Setup` | R U | Singleton. Time zone, formats, week start, full-time hours, horizon, dimension codes, flag extras. The tenant's `version` lives here. |
| WF+101 | `companyDetails` | `companyDetail` | `Company Information` | R U | Name, registration, address, country. Writes only through `tenantSettingsUpdates`. |
| WF+102 | `modules` | `module` | `SIR_WF Module` | R | code, name, enabled, locked, parentModuleCode, restore (JSON). Written by `moduleSwitches`. |
| WF+103 | `featureFlags` | `featureFlag` | `SIR_WF Feature Flag` | R | code, moduleCode, enabled. Written by `featureFlagSwitches`. |
| WF+104 | `fiscalYears` | `fiscalYear` | `SIR Fiscal Year` | R | The financial year. |
| WF+105 | `bankHolidays` | `bankHoliday` | `Base Calendar Change` | R | Filtered to the calendar in `SIR Timesheet Setup."Base Calender"`, non-working dates only. |
| WF+106 | `payFrequencies` | `payFrequency` | `SIR Pay Frequency` | R | code, description, frequency. |
| WF+107 | `payPeriods` | `payPeriod` | `SIR Pay Period` | R | payFrequency, fiscalYear, period, startDate, endDate, posted. Used for the timesheet lock and posting. |
| WF+108 | `accounts` | `account` | `SIR_WF Account` | R C U | email, entraObjectId, employeeNo, userTypeCode, blocked. `$expand=capabilityExceptions`. |
| WF+109 | `userTypes` | `userType` | `SIR_WF User Type` | R U | code, name (unique ignoring case, at most 24), description. `$expand=userTypeCapabilities`. |
| WF+110 | `userTypeCapabilities` | `userTypeCapability` | `SIR_WF User Type Capability` | R | userTypeCode, capabilityCode, default, granted. Written by `userTypeCapabilitySets`. |
| WF+111 | `capabilities` | `capability` | `SIR_WF Capability` | R | Reference data. |
| WF+112 | `capabilityGroups` | `capabilityGroup` | `SIR_WF Capability Group` | R | Reference data. |
| WF+113 | `capabilityExceptions` | `capabilityException` | `SIR_WF Capability Exception` | R | Written by `capabilityExceptionAdds` and `capabilityExceptionRemoves`. |
| WF+114 | `auditEvents` | `auditEvent` | `SIR_WF Audit Event` | R | Newest first (`$orderby=at desc`). before and after as JSON text. |
| WF+115 | `templates` | `template` | `SIR_WF Template` | R D | key, name, description, scope, source, savedAt, savedBy, fromKey, body (JSON). |
| WF+116 | `approvalChains` | `approvalChain` | `SIR_WF Approval Chain` | R | module, saved. `$expand=steps`. Written by `approvalChainSaves`. |
| WF+117 | `approvalChainSteps` | `approvalChainStep` | `SIR_WF Approval Chain Step` | R | module, stepNo, role, scope, when, sla, fixed, capabilityCode. |
| WF+118 | `delegations` | `delegation` | `SIR_WF Delegation` | R C D | fromEmployeeNo, toEmployeeNo, dateFrom, dateUntil, timesheet, profile, leave, rota. Insert refuses `LOOP` and `OVERLAP`. |
| WF+119 | `notificationEvents` | `notificationEvent` | `SIR_WF Notification Event` | R | The matrix rows. Written by `notificationMatrixUpdates`. |
| WF+120 | `notificationEvidence` | `notificationEvidence` | `SIR_WF Notification Evidence` | R | Read while FLEXMON is on. |
| WF+121 | `notifications` | `notification` | `SIR Notification Entry` | R | employeeNo, area, title, body, at, read (`Seen`), linkView, linkPath, linkLabel, channel. Payslip notices included. |
| WF+122 | `notices` | `notice` | `SIR_WF Notice` | R D | All notice fields. DELETE only while draft (`NOT_DRAFT`). `$expand=textVersions,acks`. |
| WF+123 | `noticeTextVersions` | `noticeTextVersion` | `SIR_WF Notice Text Version` | R | |
| WF+124 | `noticeAcks` | `noticeAck` | `SIR_WF Notice Ack` | R | Written by `noticeAcknowledgements`. |
| WF+125 | `documents` | `document` | `Document Attachment` (Table ID 5200) | R | employeeNo, name, category, documentDate, owner, source. No file content. |
| WF+126 | `payslips` | `payslip` | `SIR Posted Payroll Header` | R | documentNo, employeeNo, payPeriod, postingDate only. No amount field is exposed. |

### 2.2 People and dimensions

| Page | Entity set | Entity | Source table | Ops | Notable properties |
|---|---|---|---|---|---|
| WF+127 | `people` | `person` | `Employee` (+ `SIR Employee`, `SIR_WF Employee`) | R C U | The person fields of 02 §2. state is read-only (it changes through `personTransitions`). Bank fields are masked. `inUse` is not a field: the proxy counts it. |
| WF+128 | `personHistory` | `personHistoryEntry` | `SIR_WF Person History` | R | |
| WF+129 | `employeeRelatives` | `employeeRelative` | `Employee Relative` | R | emergencyContact flag, name, phone. |
| WF+130 | `employeeQualifications` | `employeeQualification` | `Employee Qualification` | R | qualificationCode, description, expirationDate. Rota eligibility. |
| WF+131 | `employeeBankAccounts` | `employeeBankAccount` | `SIR Employee Bank Account` | R | Masked: last 4 characters of the account number and branch only. |
| WF+132 | `employeeSites` | `employeeSite` | `SIR Employee Sites` | R | employeeCode, siteCode, isDefaultSite. |
| WF+133 | `workSites` | `workSite` | `SIR Work Sites` (+ `SIR_WF Work Sites`) | R C U D | The contract's location. code, name (`Description`), area, departmentCode, costCentreCode, supportLevel, minPerShift, managerNo (`Site Manager`), address, active. |
| WF+134 | `departments` | `department` | `Dimension Value` where `Dimension Code` = Setup's Department Dimension | R C U D | code, name, managerNo. The page sets `Dimension Code` on insert. |
| WF+135 | `costCentres` | `costCentre` | `Dimension Value` where `Dimension Code` = Setup's Cost Centre Dimension | R C U D | code, name. |
| WF+136 | `jobProfiles` | `jobProfile` | `SIR_WF Job Profile` | R C U D | |
| WF+137 | `projects` | `project` | `Job` (+ `SIR_WF Job`) | R C U D | code (`No.`), name, clientName, costCentreCode, managerEmployeeNo, status, startDate, endDate, budgetHours, billable, workSiteCode. `$expand=tasks`. |
| WF+138 | `projectTasks` | `projectTask` | `Job Task` (+ `SIR_WF Job Task`) | R | jobNo, code (`Job Task No.`), name, taskGroup, billable. Posting-type tasks only. |
| WF+139 | `employeeTypes` | `employeeType` | `SIR_WF Employee Type` | R C U D | Delete refuses `in-use` and `last-type`. |
| WF+140 | `profileChanges` | `profileChange` | `SIR_WF Profile Change` | R | toValue is never exposed. The masked form is a page variable. |
| WF+141 | `payCodes` | `payCode` | `SIR TIme Sheet Elements` (+ `SIR_WF TS Elements`) | R | code (`External Field Mapping`), basis, multiplier, element (`Pay Element`), label, workType. |

### 2.3 Timesheet and clocking

| Page | Entity set | Entity | Source table | Ops | Notable properties |
|---|---|---|---|---|---|
| WF+142 | `timesheetConfig` | `timesheetConfig` | `SIR_WF Timesheet Config` | R U | Rules as fields; fieldDefaults, allowances and typeCapture as JSON. PATCH merges rules and types (the page's `OnModifyRecord` merges JSON). |
| WF+143 | `timesheetDays` | `timesheetDay` | `SIR_WF Timesheet Day` | R | All day fields. `$expand=entries($expand=breaks),log`. Written only by commands. |
| WF+144 | `timesheetEntries` | `timesheetEntry` | `SIR_WF Timesheet Entry` | R | |
| WF+145 | `timesheetBreaks` | `timesheetBreak` | `SIR_WF Timesheet Break` | R | |
| WF+146 | `timesheetDayLogs` | `timesheetDayLog` | `SIR_WF Timesheet Day Log` | R | |
| WF+147 | `clockRecords` | `clockRecord` | `SIR_WF Clock Record` | R | `$expand=events`. |
| WF+148 | `clockEvents` | `clockEvent` | `SIR_WF Clock Event` | R | |

### 2.4 Rota

| Page | Entity set | Entity | Source table | Ops | Notable properties |
|---|---|---|---|---|---|
| WF+149 | `rotaConfig` | `rotaConfig` | `SIR_WF Rota Config` | R U | PATCH merges type rota by type code and renumbers stages. |
| WF+150 | `shiftTypes` | `shiftType` | `SIR Employee Work Shift` (+ its one `SIR Emp. Work Shift Line`, + `SIR_WF Work Shift`) | R C U D | code, name, from, to, breakMinutes, night, tone. The page writes header and line together. Delete refuses `IN_USE` and `LAST_SHIFT_TYPE`. |
| WF+151 | `rotaPatterns` | `rotaPattern` | `SIR_WF Rota Pattern` | R D | `$expand=people`. Created and changed by `rotaPatternSaves`. |
| WF+152 | `rotaPatternPeople` | `rotaPatternPerson` | `SIR_WF Rota Pattern Person` | R | |
| WF+153 | `rotaWeeks` | `rotaWeek` | `SIR_WF Rota Week` | R | `$expand=cells,changes`. |
| WF+154 | `rotaCells` | `rotaCell` | `SIR_WF Rota Cell` | R | Filter by `employeeNo` and `date` for My shifts and the timesheet rota line. |
| WF+155 | `rotaChanges` | `rotaChange` | `SIR_WF Rota Change` | R | |
| WF+156 | `rotaProfiles` | `rotaProfile` | `SIR_WF Rota Profile` | R | |
| WF+157 | `coverRequests` | `coverRequest` | `SIR_WF Cover Request` | R | |
| WF+158 | `filledShifts` | `filledShift` | `SIR_WF Filled Shift` | R | |
| WF+159 | `itRequests` | `itRequest` | `SIR_WF IT Request` | R | |
| WF+160 | `rotaSetAsides` | `rotaSetAside` | `SIR_WF Rota Set Aside` | R | |

### 2.5 Leave

| Page | Entity set | Entity | Source table | Ops | Notable properties |
|---|---|---|---|---|---|
| WF+161 | `leaveConfig` | `leaveConfig` | `SIR_WF Leave Config` | R | Written by `leaveConfigUpdates`, because one save touches leave codes, policies and the config. |
| WF+162 | `leaveCodes` | `leaveCode` | `SIR Leave Code` (+ `SIR_WF Leave Code`) | R | code, name, icon, shortName, policyCode, paid, evidence, unit, active. |
| WF+163 | `leavePolicies` | `leavePolicy` | `SIR_WF Leave Policy` | R | `$expand=serviceRules`. |
| WF+164 | `leaveServiceRules` | `leaveServiceRule` | `SIR_WF Leave Service Rule` | R | |
| WF+165 | `leaveRequests` | `leaveRequest` | `SIR_WF Leave Request` | R | `$expand=log`. |
| WF+166 | `leaveRequestLogs` | `leaveRequestLog` | `SIR_WF Leave Request Log` | R | |
| WF+167 | `leaveLedgerEntries` | `leaveLedgerEntry` | `SIR Leave Ledger Entry` (+ `SIR_WF Leave Ledger Entry`) | R | No `Amount`. Opening, TOIL and adjustment entries included. |
| WF+168 | `sickEpisodes` | `sickEpisode` | `SIR_WF Sick Episode` | R | |

### 2.6 Onboarding

| Page | Entity set | Entity | Source table | Ops | Notable properties |
|---|---|---|---|---|---|
| WF+169 | `onboardingConfig` | `onboardingConfig` | `SIR_WF Onboarding Config` | R | steps (JSON). Written by `onboardingConfigSaves`. |
| WF+170 | `onboardingDocTypes` | `onboardingDocType` | `SIR_WF Onboarding Doc. Type` | R | |
| WF+171 | `onboardingPolicies` | `onboardingPolicy` | `SIR_WF Onboarding Policy` | R D | |
| WF+172 | `onboardingCases` | `onboardingCase` | `SIR_WF Onboarding Case` | R | **Never exposes `Data`.** `$expand=documents`. |
| WF+173 | `onboardingDocuments` | `onboardingDocument` | `SIR_WF Onboarding Document` | R | The preview is exposed only as a separate property, read for one document at a time. |
| WF+174 | `myOnboardingData` | `myOnboardingData` | `SIR_WF Onboarding Case` (temporary view) | R | Returns `Data` only when `$filter=sessionToken eq ...` resolves to the case's own employee. Otherwise empty. The one read that needs a session. |

### 2.7 Posting and scope

| Page | Entity set | Entity | Source table | Ops | Notable properties |
|---|---|---|---|---|---|
| WF+175 | `postingBatches` | `postingBatch` | `SIR_WF Posting Batch` | R | `$expand=lines`. |
| WF+176 | `postingLines` | `postingLine` | `SIR_WF Posting Line` | R | The contract's IntegrationAttempt: state, attempt, lastError, errorKind, targetEntryNo, queuedAt, postedAt. |
| WF+177 | `postingAttempts` | `postingAttempt` | `SIR_WF Posting Attempt` | R | |
| WF+178 | `myScope` | `scope` | temporary, filled by `SIR_WF Scope` | R | `$filter=sessionToken eq ...`. Returns allLocations (master_data) or the caller's work site codes, the capabilities after exceptions, the viewing-as person and the onboarding flag. The proxy uses it to build `GET /session` and to apply read scope. |

**79 entity sets**, WF+100 to WF+178. `myScope` and `myOnboardingData` are the only reads that take a session.

## 3. Command catalogue

Command pages start at **WF+200**, which leaves room after the entity pages. Each command page has a codeunit `SIR_WF Cmd <Name>`, numbered in the codeunit range. Every command carries the standard header from §1.3. **IK** means an `idempotencyKey` is required. **V** means a `version` is required.

### 3.1 Session and access

| Page | Command | Input | Output (`summary`) | Capability checked in Business Central | Refusals |
|---|---|---|---|---|---|
| WF+200 | `sessionOpens` | entraObjectId (no sessionToken) | recordId = session token; summary: employeeNo, expiresAt | Called only by the proxy's app identity after it validates the Entra token. | `signed-out` |
| WF+201 | `sessionRevokes` | (header only) | | none (allowed while viewing as and while onboarding) | `signed-out` |
| WF+202 | `viewAsStarts` | personCode | summary: viewingAs | `perm_cfg` | `not-found`, `invalid` |
| WF+203 | `viewAsEnds` | (header only) | | none (allowed while viewing as) | |
| WF+204 | `userTypeCapabilitySets` V | userTypeCode, capabilityCode, granted | recordId (user type) | `perm_cfg` | `not-found`, `locked`, `stale` |
| WF+205 | `capabilityExceptionAdds` V | email, capabilityCode, mode, reason | recordId (account) | `perm_cfg` | `not-found`, `locked`, `invalid`, `stale` |
| WF+206 | `capabilityExceptionRemoves` V | email, capabilityCode | recordId (account) | `perm_cfg` | `not-found`, `locked`, `stale` |

### 3.2 People

| Page | Command | Input | Output (`summary`) | Capability | Refusals |
|---|---|---|---|---|---|
| WF+207 | `personTransitions` V | personId, to, reason | recordId; summary: nextStates or outstanding blockers on a refusal | `emp_crud` | `not-found`, `TRANSITION_NOT_ALLOWED`, `locked`, `stale` |
| WF+208 | `profileChangeProposals` IK | changes (JSON: field, to), note | recordIds | `own_home` and `SELF_EDIT` | `feature-off`, `pending`, `own-change`, `invalid` |
| WF+209 | `profileChangeDecisions` V | changeId, decision, reason | recordId; summary: personWritten (Boolean) | `profile_appr` at manager stage, `bank_verify` at payroll stage | `not-found`, `scope`, `decided`, `changed-since`, `own-change`, `stale` |

People create, edit and dimension CRUD use the entity sets in §2.2 directly.

### 3.3 Configuration and communication

| Page | Command | Input | Output (`summary`) | Capability | Refusals |
|---|---|---|---|---|---|
| WF+210 | `moduleSwitches` V | code, on | summary: ModuleEffect (kept, shiftsSetAside, shiftsRestored, shiftsNotRestored, capturesRestored, capturesRemembered, siteRemovedFrom), message | `mod_cfg` | `not-found`, `LOCKED`, `MODULE_OFF`, `stale` |
| WF+211 | `featureFlagSwitches` V | code, on?, weekGrid?, weekLayout?, breaksMax?, vehiclesMax? | message | `mod_cfg` | `not-found`, `MODULE_OFF`, `FLAG_OFF`, `stale` |
| WF+212 | `tenantSettingsUpdates` V | patch (JSON: UpdateTenantSettings) | | `master_data` | `invalid`, `stale` |
| WF+213 | `templateSaves` IK | name, description, scope | recordId | `mod_cfg`; `master_data` for scope with structure | `NAME_TAKEN`, `invalid` |
| WF+214 | `templateImports` IK | text (the file, up to 2,000,000 characters) | recordId; summary: keys left out | `mod_cfg` | `NAME_TAKEN`, `NOT_A_TEMPLATE`, `UNREADABLE` |
| WF+215 | `templateApplies` V (tenant) | key, body (JSON, for a shipped template held by the proxy) | summary: TemplatePlan, message | `mod_cfg` | `not-found`, `stale`, `MODULE_OFF` |
| WF+216 | `approvalChainSaves` V | module, steps (JSON, at most 12) | message | `framework` | `not-found`, `FIXED`, `invalid`, `stale` |
| WF+217 | `notificationMatrixUpdates` V | events (JSON map) | message | `framework` | `MODULE_OFF`, `invalid`, `stale` |
| WF+218 | `notificationReads` | notificationId, or all = true | summary: unread, marked | own only | `not-found` |
| WF+219 | `noticeSaves` (V on edit; IK on create) | noticeCode (blank = new), title, body, from, until, mustAck, pinned, urgent, scope (JSON), post | recordId, message | `notice_post` | `scope`, `AUDIENCE_FIXED`, `WITHDRAWN`, `invalid`, `stale` |
| WF+220 | `noticePosts` V | noticeCode | message | `notice_post` | `ALREADY_POSTED`, `NOT_DRAFT`, `stale` |
| WF+221 | `noticePins` V | noticeCode, pinned | message | `notice_post` | `NOT_LIVE`, `stale` |
| WF+222 | `noticeWithdrawals` V | noticeCode, reason | message | `notice_post` | `NOT_LIVE`, `REASON_REQUIRED`, `stale` |
| WF+223 | `noticeAcknowledgements` | noticeCode, textVersion | message | `own_notices` | `CLOSED`, `CHANGED`, `ALREADY_ACKNOWLEDGED`, `not-found` |

### 3.4 Timesheet and clocking

| Page | Command | Input | Output (`summary`) | Capability | Refusals |
|---|---|---|---|---|---|
| WF+224 | `timesheetDaySaves` V | personCode, date, submit (Boolean), day (JSON: DayInput) | recordId, warnings | `own_ts` (own), or `team_ts` + scope (+ `proxy` for a proxy write) | `TS_INVALID`, `PERIOD_LOCKED`, `ABSENCE_BLOCKED`, `CLOCK_RUNNING`, `ALREADY_SUBMITTED`, `scope`, `capability`, `stale` |
| WF+225 | `timesheetWeekSubmits` | personCode, weekStart, days (JSON: WeekSubmitDay[], each with its version) | recordIds; summary: held, flagged, warnings, weekMinutes | as above | `TS_INVALID`, `PERIOD_LOCKED`, `ABSENCE_BLOCKED`, `ALREADY_SUBMITTED`, `stale` (whole week refused) |
| WF+226 | `timesheetMultiweekSubmits` | personCode, weeks (JSON, 1 to 8 dates) | summary: per week outcome, reason, submitted, held | as above (and `MULTIWEEK`) | `invalid`, `FLAG_OFF` |
| WF+227 | `timesheetDayTransitions` V | dayId, to (ok, back), reason | recordId; summary: postingLine (or null) | the layer's capability (`team_ts` line manager, `pay_appr` payroll) or a delegate | `SELF_APPROVAL`, `scope`, `WRONG_LAYER`, `capability`, `TRANSITION_NOT_ALLOWED`, `REASON_REQUIRED`, `MISSING_PAY_SETUP` (new: no pay cycle or no work site, 01 §7.1 step 8), `stale` |
| WF+228 | `timesheetBulkApprovals` | items (JSON: [{id, version}], 1 to 500) | recordIds; summary: held (id, code, reason), people, minutes | per day, as above | `QUEUE_CHANGED` (any version differs: nothing approved) |
| WF+229 | `postingRetries` V | postingLineId | recordId | `integration` | `RETRY_NOT_ALLOWED`, `not-found`, `stale` |
| WF+230 | `clockMoves` V | kind (in, breakStart, breakEnd, out) | recordId (clock record); summary: dayId, warnings, toast | `own_ts` | `MODULE_OFF`, `FLAG_OFF`, `NOT_CLOCK_TYPE`, `CLOCK_MOVE`, `CLOCK_OPEN`, `BREAK_LIMIT`, and the day save's refusals on `out`, `stale` |
| WF+231 | `clockCloses` V | date, finish | recordId; summary: dayId, warnings, toast | `own_ts` | `not-found`, `CLOCK_MOVE`, `TS_INVALID`, `stale` |

The clock commands never take a time from the client. Each event is stamped with `CurrentDateTime`.

### 3.5 Rota

| Page | Command | Input | Output (`summary`) | Capability | Refusals |
|---|---|---|---|---|---|
| WF+232 | `rotaCellWrites` V (week) | workSiteCode, weekStart, cells (JSON: CellInput[]; one for a cell write, several for a plan acceptance) | recordId (week); summary: advisories, cover | `team_rota` + scope | `ROTA_INELIGIBLE`, `WEEK_LIVE`, `UNKNOWN_SHIFT`, `ON_LEAVE`, `UNCHANGED`, `AWAITING_SIGNOFF`, `scope`, `stale` |
| WF+233 | `rotaWeekActions` V (week) | workSiteCode, weekStart, action (clear, copy, repeat), weeks (repeat) | recordId; summary: cleared, copied, written, skipped | `team_rota` + scope | `NOTHING_TO_CLEAR`, `NOTHING_TO_COPY`, `WEEK_LIVE`, `stale` |
| WF+234 | `rotaWeekTransitions` V | workSiteCode, weekStart, to (review, draft, published) | recordId; summary: published, notified | `team_rota` + scope | `TRANSITION_NOT_ALLOWED`, `COVERAGE_GAPS`, `AWAITING_SIGNOFF`, `stale` |
| WF+235 | `rotaWeekSignOffs` V | workSiteCode, weekStart, to (published, draft), reason | recordId | the Rota chain layer's capability | `NOT_AWAITING_SIGNOFF`, `SELF_APPROVAL`, `WRONG_LAYER`, `REASON_REQUIRED`, `stale` |
| WF+236 | `rotaPatternSaves` (V on edit; IK on create) | code, pattern (JSON: CreatePattern or UpdatePattern), base | recordId | `rota_pattern` (+ `rota-policy`) | `scope`, `ACTIVATE_EMPTY`, `invalid`, `stale` |
| WF+237 | `rotaPatternPeopleAdds` V | code, personCodes, start, mode | recordId | `rota_pattern` | `scope`, `ALREADY_ON_PATTERN`, `stale` |
| WF+238 | `rotaPatternGenerations` V | code, gen, genFrom, genTo | summary: written, skipped (filled, leave, sickness, published) | `rota_pattern` | `NO_LANDING`, `stale` |
| WF+239 | `coverRequestOpens` IK | workSiteCode, date, shiftCode, reason, urgent | recordId | `team_cover` + scope | `COVER_OPEN`, `UNKNOWN_SHIFT`, `not-found` |
| WF+240 | `coverRequestActions` V | coverId, action (askAll, assign, claim, escalate, fill, reason), personCode (assign), reason (reason) | recordId; summary: filledShiftId, message | `team_cover`; `claim` needs only own eligibility | `COVER_CLOSED`, `NOBODY_ELIGIBLE`, `NOT_OFFERED`, `ROTA_INELIGIBLE`, `stale` |
| WF+241 | `filledShiftConfirmations` V | filledShiftId | recordId; summary: itRequestRef | `team_cover` | `ALREADY_CONFIRMED`, `NOT_WORKED_YET`, `stale` |

Shift types and rota config use the entity sets in §2.4 directly.

### 3.6 Leave

| Page | Command | Input | Output (`summary`) | Capability | Refusals |
|---|---|---|---|---|---|
| WF+242 | `leaveRequestRaises` IK | leaveCode, from, to, part, note | recordId; summary: hint | `own_leave` | `module-off`, `OVER_BALANCE`, `OVERLAPS`, `VALIDATION` |
| WF+243 | `leaveRequestDecisions` V | requestId, action (approve, decline, cancel), reason | recordId; summary: RotaEffect (written, weeks, amended, covers) on a final approval | approve and decline: the layer's capability (`team_leave`) or a delegate; cancel: `own_leave`, own request | `SELF_APPROVAL`, `ALREADY_SIGNED`, `WRONG_LAYER`, `scope`, `NOT_YOUR_REQUEST`, `TRANSITION_NOT_ALLOWED`, `REASON_REQUIRED`, `LEAVE_IN_PAYROLL`, `stale` |
| WF+244 | `sicknessRecords` IK | personCode, from, to, reason, note | recordId; summary: extended, RotaEffect | `team_sick` + scope | `ALREADY_RECORDED`, `VALIDATION`, `not-found` |
| WF+245 | `rtwRequests` V | episodeId | recordId | `team_sick` + scope | `ALREADY_REQUESTED`, `NO_ABSENCE`, `stale` |
| WF+246 | `leaveGiveBacks` | personCode, dates (JSON, at most 60) | recordId (ledger entry); summary: RotaEffect | `team_sick` + scope | `NOT_SICK_ON_LEAVE`, `not-found` |
| WF+247 | `leaveConfigUpdates` V | patch (JSON: UpdateLeaveConfig) | | `mod_cfg` | `in-use` (a type requests still name), `invalid`, `stale` |

### 3.7 Onboarding

| Page | Command | Input | Output (`summary`) | Capability | Refusals |
|---|---|---|---|---|---|
| WF+248 | `onboardingConfigSaves` V | steps (JSON), documents (JSON) | message | `onb_cfg` | `FIXED`, `invalid`, `stale` |
| WF+249 | `onboardingPolicySaves` (V on edit; IK on create) | policyCode (blank = new), label, ver, summary | recordId, message | `onb_cfg` | `NAME_TAKEN`, `invalid`, `stale` |
| WF+250 | `onboardingPolicyFiles` V | policyCode, name, size, type | recordId; summary: asked (how many asked again) | `onb_cfg` | `stale` |
| WF+251 | `onboardingStepSaves` V (case) | step, mode (check, quiet), data (JSON: SaveStep) | recordId, message | `own_onb` (own case) | `NOT_ONBOARDING`, `VALIDATION`, `FLAG_OFF`, `SUBMITTED`, `stale` |
| WF+252 | `onboardingDocumentUploads` V | docTypeCode, name, size, type, preview | recordId | `own_onb` | `NOT_ONBOARDING`, `SUBMITTED`, `invalid`, `stale` |
| WF+253 | `onboardingPolicyAcks` V | policyCode, action (ack, unack, read) | recordId | `own_onb` | `NOT_ONBOARDING`, `not-found`, `stale` |
| WF+254 | `onboardingSubmits` V | consent, signature | recordId, message | `own_onb` | `NOT_READY`, `OUTSTANDING`, `SUBMITTED`, `stale` |
| WF+255 | `onboardingCaseActions` (V except chase) | personCode, action (chase, invite, start) | recordId, message | `onb_track` + scope | `NOT_ONBOARDING`, `NOTHING_OUTSTANDING`, `OUTSTANDING` (start blockers), `TRANSITION_NOT_ALLOWED`, `stale` |
| WF+256 | `onboardingDocumentChecks` V | personCode, docTypeCode, action (verify, reject), reason | recordId, message | `onb_verify` + scope | `SELF_CHECK`, `not-found`, `REASON_REQUIRED`, `stale` |

**57 command entity sets**, WF+200 to WF+256.

## 4. Operation map

Columns:

- **Capability (BC)**: the capability Business Central checks on a write, or the proxy on a read. "handler" means the rule depends on the record, as the contract says, and Business Central applies it.
- **BC call(s)**: the Business Central requests the proxy makes. `GET x` is a GET on the entity set. Several GETs are one `$batch`.
- **V**: the operation needs If-Match in the contract.
- **Refusals**: the codes Business Central or the proxy can return, besides `signed-out`, `viewing-as`, `not-started` and `invalid`, which apply to every operation.
- **Proxy derives**: what the proxy computes from the data with `src/domain`.

### 4.1 Foundation and access (15)

| # | Operation | Capability (BC) | BC call(s) | V | Refusals | Proxy derives |
|---|---|---|---|---|---|---|
| 1 | `POST /api/v1/session` | public | Replaced by Entra sign-in. The React app signs in with MSAL. On the first call the proxy validates the token, then POST `sessionOpens {entraObjectId}`. | | `signed-out` | Session shape; `simulated: false` |
| 2 | `GET /api/v1/session` | session | GET `myScope?$filter=sessionToken eq …`; GET `people(id)`; GET `userTypes` | | `signed-out` | roleName, locationName, onboarding |
| 3 | `DELETE /api/v1/session` | session | POST `sessionRevokes` | | | |
| 4 | `POST /api/v1/session/view-as` | `perm_cfg` | POST `viewAsStarts {personCode}`; then as #2 | | `not-found`, `capability` | Session with viewingAs |
| 5 | `GET /api/v1/session/view-as/people` | `perm_cfg` | GET `people?$filter=state eq 'active'`; GET `accounts`; GET `employeeTypes` | | `capability` | One person per role and per employee type, at most five |
| 6 | `DELETE /api/v1/session/view-as` | session | POST `viewAsEnds` | | | Session |
| 7 | `GET /api/v1/capabilities` | `perm_cfg` | GET `capabilities` | | `capability` | |
| 8 | `GET /api/v1/capability-groups` | `perm_cfg` | GET `capabilityGroups?$orderby=sortOrder` | | `capability` | |
| 9 | `GET /api/v1/user-types` | `perm_cfg` | GET `userTypes?$expand=userTypeCapabilities` | | `capability` | capabilities, defaults arrays |
| 10 | `PATCH /api/v1/user-types/{id}` | `perm_cfg` | PATCH `userTypes(id) {name}` | V | `not-found`, `invalid`, `stale` | |
| 11 | `PUT /api/v1/user-types/{id}/capabilities/{capability}` | `perm_cfg` | POST `userTypeCapabilitySets` | V | `not-found`, `locked`, `stale` | |
| 12 | `GET /api/v1/users` | `perm_cfg` | GET `accounts?$expand=capabilityExceptions`; GET `people?$select=code,name` | | `capability` | grants, revocations arrays |
| 13 | `POST /api/v1/users/{email}/exceptions` | `perm_cfg` | POST `capabilityExceptionAdds` | V | `not-found`, `locked`, `stale` | |
| 14 | `DELETE /api/v1/users/{email}/exceptions/{capability}` | `perm_cfg` | POST `capabilityExceptionRemoves` | V | `not-found`, `locked`, `stale` | |
| 15 | `GET /api/v1/audit` | `integration` | GET `auditEvents?$filter=entity eq … and whoEmployeeNo eq …&$orderby=at desc&$top=limit&$count=true` (q: `contains(reason,…)`) | | `capability`, `invalid` | who name, viewingAs name, total (`@odata.count`) |

### 4.2 People and dimensions (36)

| # | Operation | Capability (BC) | BC call(s) | V | Refusals | Proxy derives |
|---|---|---|---|---|---|---|
| 16 | `GET /api/v1/people` | handler: `master_data` all; `team_people` own location | GET `people?$filter=…` (state; work site from `myScope`) | | `scope`, `invalid` | name join, masked bank, userType |
| 17 | `GET /api/v1/people/next-code` | `emp_crud` | GET `people?$select=code` | | `capability` | Next code in the tenant's scheme (`domain/codes.ts`) |
| 18 | `GET /api/v1/people/{id}` | handler: own, or in scope | GET `people?$filter=publicId eq …&$expand=employeeSites,employeeRelatives` | | `not-found`, `scope` | |
| 19 | `POST /api/v1/people` | `emp_crud`; `perm_cfg` for a non-employee user type | POST `people` (with userType and email; `OnInsertRecord` also creates the `SIR_WF Account` and the default `SIR Employee Sites` row) | | `capability`, `invalid` | |
| 20 | `PATCH /api/v1/people/{id}` | `emp_crud` | PATCH `people(id)` | V | `not-found`, `locked`, `invalid`, `stale` | changed (diff of before and after) |
| 21 | `GET /api/v1/people/{id}/history` | handler: own, or in scope | GET `personHistory?$filter=employeeNo eq …&$orderby=at desc` | | `not-found`, `scope` | by name |
| 22 | `POST /api/v1/people/{id}/transitions` | `emp_crud` | POST `personTransitions` | V | `not-found`, `TRANSITION_NOT_ALLOWED`, `stale` | |
| 23 | `GET /api/v1/locations` | session | GET `workSites`; GET `people?$select=code,…` | | | inUse (`domain/usage.ts`) |
| 24 | `POST /api/v1/locations` | `master_data` | POST `workSites` | | `capability`, `invalid` | |
| 25 | `PATCH /api/v1/locations/{id}` | `master_data` | PATCH `workSites(id)` | V | `not-found`, `invalid`, `stale` | changed |
| 26 | `DELETE /api/v1/locations/{id}` | `master_data` | DELETE `workSites(id)` | V | `not-found`, `in-use`, `stale` | |
| 27 | `GET /api/v1/departments` | session | GET `departments` | | | inUse |
| 28 | `POST /api/v1/departments` | `master_data` | POST `departments` | | `capability`, `invalid` | |
| 29 | `PATCH /api/v1/departments/{id}` | `master_data` | PATCH `departments(id)` | V | `not-found`, `invalid`, `stale` | changed |
| 30 | `DELETE /api/v1/departments/{id}` | `master_data` | DELETE `departments(id)` | V | `not-found`, `in-use`, `stale` | |
| 31 | `GET /api/v1/cost-centres` | session | GET `costCentres` | | | inUse |
| 32 | `POST /api/v1/cost-centres` | `master_data` | POST `costCentres` | | `capability`, `invalid` | |
| 33 | `PATCH /api/v1/cost-centres/{id}` | `master_data` | PATCH `costCentres(id)` | V | `not-found`, `invalid`, `stale` | changed |
| 34 | `DELETE /api/v1/cost-centres/{id}` | `master_data` | DELETE `costCentres(id)` | V | `not-found`, `in-use`, `stale` | |
| 35 | `GET /api/v1/job-profiles` | session | GET `jobProfiles` | | | inUse |
| 36 | `POST /api/v1/job-profiles` | `master_data` | POST `jobProfiles` | | `capability`, `invalid` | |
| 37 | `PATCH /api/v1/job-profiles/{id}` | `master_data` | PATCH `jobProfiles(id)` | V | `not-found`, `invalid`, `stale` | changed |
| 38 | `DELETE /api/v1/job-profiles/{id}` | `master_data` | DELETE `jobProfiles(id)` | V | `not-found`, `in-use`, `stale` | |
| 39 | `GET /api/v1/projects` | session | GET `projects?$expand=tasks` | | | inUse; budgetHours as text |
| 40 | `POST /api/v1/projects` | `master_data` | POST `projects` | | `capability`, `invalid` | |
| 41 | `PATCH /api/v1/projects/{id}` | `master_data` | PATCH `projects(id)` | V | `not-found`, `invalid`, `stale` | changed |
| 42 | `DELETE /api/v1/projects/{id}` | `master_data` | DELETE `projects(id)` | V | `not-found`, `in-use`, `stale` | |
| 43 | `GET /api/v1/employee-types` | session | GET `employeeTypes`; GET `people?$select=employeeTypeCode` | | | inUse |
| 44 | `GET /api/v1/employee-types/library` | `type_cfg` | none (archetypes are shipped in the proxy) | | `capability` | Whole response |
| 45 | `POST /api/v1/employee-types` | `type_cfg` | POST `employeeTypes` | | `capability`, `invalid` | |
| 46 | `PATCH /api/v1/employee-types/{id}` | `type_cfg` | PATCH `employeeTypes(id)` | V | `not-found`, `invalid`, `stale` | changed |
| 47 | `DELETE /api/v1/employee-types/{id}` | `type_cfg` | DELETE `employeeTypes(id)` | V | `not-found`, `in-use`, `last-type`, `stale` | |
| 48 | `GET /api/v1/profile` | `own_home` | GET `people(own)`; GET `profileChanges?$filter=employeeNo eq own and status eq 'pending'`; GET `featureFlags('SELF_EDIT')` | | `capability` | fields (SelfField list), selfEdit |
| 49 | `POST /api/v1/profile-changes` | `own_home` | POST `profileChangeProposals` | | `feature-off`, `pending`, `invalid` | |
| 50 | `GET /api/v1/profile-changes` | handler: `profile_appr` (manager stage, own people), `bank_verify` (payroll stage) | GET `profileChanges?$filter=status eq 'pending' and stage eq …` | | `capability` | personName |
| 51 | `POST /api/v1/profile-changes/{id}/decision` | handler: `profile_appr` or `bank_verify` | POST `profileChangeDecisions` | V | `not-found`, `scope`, `decided`, `changed-since`, `own-change`, `stale` | person (re-read when written) |

### 4.3 Configuration and communication (36)

| # | Operation | Capability (BC) | BC call(s) | V | Refusals | Proxy derives |
|---|---|---|---|---|---|---|
| 52 | `GET /api/v1/tenant` | session | `$batch`: GET `workforceSetup`, `companyDetails`, `modules`, `featureFlags`, `fiscalYears`, `bankHolidays`, `rotaConfig`, `rotaSetAsides?$count=true` | | `not-found` | modules and flags maps, restore, rotaSetAside count |
| 53 | `PATCH /api/v1/tenant/modules/{code}` | `mod_cfg` | POST `moduleSwitches` | V | `not-found`, `LOCKED`, `MODULE_OFF`, `stale` | effect message |
| 54 | `PATCH /api/v1/tenant/flags/{code}` | `mod_cfg` | POST `featureFlagSwitches` | V | `not-found`, `MODULE_OFF`, `FLAG_OFF`, `stale` | |
| 55 | `PATCH /api/v1/tenant/settings` | `master_data` | POST `tenantSettingsUpdates` | V | `invalid`, `stale` | |
| 56 | `GET /api/v1/templates` | `mod_cfg` | GET `templates`; GET `workforceSetup` (templateCode) | | `capability` | Shipped templates merged in, inUse |
| 57 | `POST /api/v1/templates` | `mod_cfg` | POST `templateSaves` (the proxy builds the body from the tenant's configuration, never its people) | | `NAME_TAKEN`, `invalid` | Template body (`domain/templates.ts`) |
| 58 | `DELETE /api/v1/templates/{key}` | `mod_cfg` | DELETE `templates(id)` | V | `not-found`, `SHIPPED`, `IN_USE`, `stale` | |
| 59 | `POST /api/v1/templates/{key}/apply` | `mod_cfg` | POST `templateApplies` | V | `not-found`, `stale` | plan, message |
| 60 | `GET /api/v1/templates/{key}/export` | `mod_cfg` | GET `templates?$filter=key eq …` | | `not-found` | TemplateFile |
| 61 | `GET /api/v1/templates/{key}/plan` | `mod_cfg` | GET the template; `$batch` of the current configuration as #52 plus `employeeTypes`, `approvalChains`, `leaveConfig` | | `not-found` | TemplatePlan (changes, added, leftAlone) |
| 62 | `POST /api/v1/templates/import` | `mod_cfg` | POST `templateImports` | | `NAME_TAKEN`, `NOT_A_TEMPLATE`, `UNREADABLE` | keys left out (money among them) |
| 63 | `GET /api/v1/notifications/me` | session | GET `notifications?$filter=employeeNo eq own and channel has in-app&$orderby=at desc`; GET `modules` | | | ago, link only when openable, unread count |
| 64 | `POST /api/v1/notifications/{id}/read` | own | POST `notificationReads {notificationId}` | | `not-found` | |
| 65 | `POST /api/v1/notifications/read-all` | own | POST `notificationReads {all: true}` | | | |
| 66 | `GET /api/v1/notifications/matrix` | `framework` | GET `notificationEvents`; GET `notificationEvidence` (while FLEXMON is on); GET `modules` | | `capability` | events the tenant can raise |
| 67 | `PATCH /api/v1/notifications/matrix` | `framework` | POST `notificationMatrixUpdates` | V | `MODULE_OFF`, `invalid`, `stale` | |
| 68 | `GET /api/v1/approvals/chains` | `framework` | GET `approvalChains?$expand=steps`; GET `timesheetConfig`; GET `featureFlags('EMAIL_APPROVAL')`; GET `payPeriods` (current and previous) | | `capability` | Defaults at version 0 for unsaved chains, SignOff |
| 69 | `PUT /api/v1/approvals/chains/{module}` | `framework` | POST `approvalChainSaves` | V | `not-found`, `FIXED`, `stale` | message |
| 70 | `GET /api/v1/approvals/delegations` | `framework` | GET `delegations?$orderby=dateFrom`; GET `people` (approvers) | | `capability` | names, active |
| 71 | `POST /api/v1/approvals/delegations` | `framework` | POST `delegations` | | `LOOP`, `OVERLAP`, `invalid` | message |
| 72 | `DELETE /api/v1/approvals/delegations/{id}` | `framework` | DELETE `delegations(id)` | V | `not-found`, `stale` | message |
| 73 | `GET /api/v1/approvals/delegations/mine` | `team_leave` | GET `delegations?$filter=fromEmployeeNo eq own or toEmployeeNo eq own` | | `capability` | names, active |
| 74 | `GET /api/v1/notices` | `notice_post` | GET `notices?$expand=acks`; GET `myScope`; GET `people` (audience) | | `capability` | status, counts, scopes, audience, acknowledged |
| 75 | `POST /api/v1/notices` | `notice_post` | POST `noticeSaves` | | `scope`, `invalid` | |
| 76 | `PATCH /api/v1/notices/{id}` | `notice_post` | POST `noticeSaves` | V | `not-found`, `AUDIENCE_FIXED`, `WITHDRAWN`, `stale` | |
| 77 | `DELETE /api/v1/notices/{id}` | `notice_post` | DELETE `notices(id)` | V | `not-found`, `NOT_DRAFT`, `stale` | message |
| 78 | `POST /api/v1/notices/{id}/post` | `notice_post` | POST `noticePosts` | V | `not-found`, `ALREADY_POSTED`, `stale` | |
| 79 | `PUT /api/v1/notices/{id}/pin` | `notice_post` | POST `noticePins` | V | `not-found`, `NOT_LIVE`, `stale` | |
| 80 | `POST /api/v1/notices/{id}/withdraw` | `notice_post` | POST `noticeWithdrawals` | V | `not-found`, `NOT_LIVE`, `REASON_REQUIRED`, `stale` | |
| 81 | `GET /api/v1/notices/{id}/track` | `notice_post` | GET `notices(id)?$expand=textVersions,acks`; GET `auditEvents?$filter=entity eq 'notice' and entityId eq …` | | `not-found`, `scope` | TrackRow per person, trail |
| 82 | `GET /api/v1/notices/mine` | `own_notices` | GET `notices?$filter=state ne 'draft'&$expand=acks($filter=employeeNo eq own)`; GET `people(own)` | | `capability` | Aimed at me (`domain/notices.ts` audienceOf), readerState, owed, order |
| 83 | `GET /api/v1/notices/mine/{id}` | `own_notices` | as #82, one notice | | `not-found` | |
| 84 | `POST /api/v1/notices/{id}/acknowledge` | `own_notices` | POST `noticeAcknowledgements` | | `CLOSED`, `CHANGED`, `ALREADY_ACKNOWLEDGED`, `not-found` | |
| 85 | `GET /api/v1/home` | `own_home` | View, §5.6 | | `invalid` | Month model |
| 86 | `GET /api/v1/documents/mine` | `own_home` | GET `documents?$filter=employeeNo eq own`; GET `payslips?$filter=employeeNo eq own`; GET `featureFlags('DOCS')` | | `feature-off` | payroll list |
| 87 | `GET /api/v1/documents/{id}` | `own_home` | GET `documents(id)` (own only) | | `not-found` | |

### 4.4 Timesheet (11)

| # | Operation | Capability (BC) | BC call(s) | V | Refusals | Proxy derives |
|---|---|---|---|---|---|---|
| 88 | `GET /api/v1/timesheets/{personId}/weeks/{weekStart}` | handler: `own_ts` own; `team_ts` + scope | View, §5.1 | | `not-found`, `scope`, `capability` | Whole TimesheetWeek |
| 89 | `PUT /api/v1/timesheets/{personId}/days/{date}` | handler (+ `proxy` for another's day) | POST `timesheetDaySaves {submit: false}`; GET `timesheetDays(id)?$expand=entries($expand=breaks),log` | V | `TS_INVALID`, `PERIOD_LOCKED`, `ABSENCE_BLOCKED`, `CLOCK_RUNNING`, `ALREADY_SUBMITTED`, `scope`, `stale` | minutes, posting |
| 90 | `POST /api/v1/timesheets/{personId}/days/{date}/submit` | handler | POST `timesheetDaySaves {submit: true}`; then as #89 | V | as #89 | |
| 91 | `POST /api/v1/timesheets/{personId}/weeks/{weekStart}/submit` | handler | POST `timesheetWeekSubmits` | (per-day versions) | `TS_INVALID`, `PERIOD_LOCKED`, `ABSENCE_BLOCKED`, `ALREADY_SUBMITTED`, `stale` | |
| 92 | `POST /api/v1/timesheets/{personId}/multiweek/submit` | handler | POST `timesheetMultiweekSubmits` | | `FLAG_OFF`, `invalid` | week labels |
| 93 | `POST /api/v1/timesheet-days/{id}/transition` | handler: the chain layer | POST `timesheetDayTransitions`; GET `postingLines(id)` when one was queued | V | `SELF_APPROVAL`, `scope`, `WRONG_LAYER`, `capability`, `TRANSITION_NOT_ALLOWED`, `MISSING_PAY_SETUP`, `stale` | attempt (IntegrationAttempt) |
| 94 | `GET /api/v1/approvals/timesheets` | handler: any chain layer the reader holds or covers | View, §5.2 | | `capability`, `invalid` | Whole ApprovalQueue, bulk checksum |
| 95 | `POST /api/v1/approvals/timesheets/bulk` | handler: per day | Proxy re-reads the queue and recomputes the checksum (`QUEUE_CHANGED` if it differs), then POST `timesheetBulkApprovals {items: [{id, version}]}` | | `QUEUE_CHANGED`, `capability` | people, minutes |
| 96 | `GET /api/v1/timesheet-config` | `mod_cfg` | GET `timesheetConfig`; GET `payCodes` | | `capability` | fields catalogue (shipped in the proxy) |
| 97 | `PATCH /api/v1/timesheet-config` | `mod_cfg` | PATCH `timesheetConfig` | V | `invalid`, `stale` | |
| 98 | `POST /api/v1/integration/attempts/{id}/retry` | `integration` | POST `postingRetries` | V | `not-found`, `RETRY_NOT_ALLOWED`, `stale` | |

### 4.5 Clocking (6)

| # | Operation | Capability (BC) | BC call(s) | V | Refusals | Proxy derives |
|---|---|---|---|---|---|---|
| 99 | `GET /api/v1/clock/me` | `own_ts` | View, §5.7 | | `capability` | MyClock (state, elapsedSeconds, gates, status) |
| 100 | `POST /api/v1/clock/in` | `own_ts` | POST `clockMoves {kind: in}`; GET `clockRecords(id)?$expand=events` | V | `MODULE_OFF`, `FLAG_OFF`, `NOT_CLOCK_TYPE`, `CLOCK_MOVE`, `CLOCK_OPEN`, `stale` | late, toast |
| 101 | `POST /api/v1/clock/break/start` | `own_ts` | POST `clockMoves {kind: breakStart}` | V | `FLAG_OFF`, `CLOCK_MOVE`, `BREAK_LIMIT`, `stale` | |
| 102 | `POST /api/v1/clock/break/end` | `own_ts` | POST `clockMoves {kind: breakEnd}` | V | `CLOCK_MOVE`, `stale` | |
| 103 | `POST /api/v1/clock/out` | `own_ts` | POST `clockMoves {kind: out}`; GET the clock record and the draft day | V | `CLOCK_MOVE`, the day save's refusals, `stale` | day, warnings |
| 104 | `POST /api/v1/clock/{date}/close` | `own_ts` | POST `clockCloses` | V | `not-found`, `CLOCK_MOVE`, `TS_INVALID`, `stale` | |

### 4.6 Rota (34)

| # | Operation | Capability (BC) | BC call(s) | V | Refusals | Proxy derives |
|---|---|---|---|---|---|---|
| 105 | `GET /api/v1/rota/config` | `mod_cfg` | GET `rotaConfig` | | `module-off` | |
| 106 | `PATCH /api/v1/rota/config` | `mod_cfg` | PATCH `rotaConfig` | V | `invalid`, `stale` | |
| 107 | `GET /api/v1/rota/home` | `team_rota` | GET `myScope`; GET `workSites` | | `module-off` | start location, today's week |
| 108 | `GET /api/v1/rota/weeks/{location}/{weekStart}` | `team_rota` + scope | View, §5.5 | | `not-found`, `scope` | Whole RotaWeekView |
| 109 | `PUT /api/v1/rota/weeks/{location}/{weekStart}/cells` | `team_rota` + scope | POST `rotaCellWrites` (one cell) | V | `ROTA_INELIGIBLE`, `WEEK_LIVE`, `UNKNOWN_SHIFT`, `ON_LEAVE`, `UNCHANGED`, `AWAITING_SIGNOFF`, `stale` | week view, advisories |
| 110 | `POST /api/v1/rota/weeks/{location}/{weekStart}/clear` | `team_rota` + scope | POST `rotaWeekActions {action: clear}` | V | `NOTHING_TO_CLEAR`, `WEEK_LIVE`, `stale` | |
| 111 | `POST /api/v1/rota/weeks/{location}/{weekStart}/copy` | `team_rota` + scope | POST `rotaWeekActions {action: copy}` | V | `NOTHING_TO_COPY`, `WEEK_LIVE`, `stale` | |
| 112 | `POST /api/v1/rota/weeks/{location}/{weekStart}/repeat` | `team_rota` + scope | POST `rotaWeekActions {action: repeat, weeks}` | V | `stale` | summary |
| 113 | `GET /api/v1/rota/weeks/{location}/{weekStart}/plan` | `team_rota` + scope | `$batch` as §5.5 | | `not-found`, `scope` | WeekPlan (nothing written) |
| 114 | `POST /api/v1/rota/weeks/{location}/{weekStart}/plan/accept` | `team_rota` + scope | POST `rotaCellWrites` (several cells; one refusal writes none) | V | as #109 | |
| 115 | `GET /api/v1/rota/weeks/{location}/{weekStart}/suggestions` | `team_rota` + scope | `$batch` as §5.5 plus `employeeQualifications`, `rotaProfiles`, `leaveRequests`, `sickEpisodes` | | `not-found`, `scope` | CellSuggestions (ok, no with the rule) |
| 116 | `POST /api/v1/rota/weeks/{location}/{weekStart}/transition` | `team_rota` + scope | POST `rotaWeekTransitions` | V | `TRANSITION_NOT_ALLOWED`, `COVERAGE_GAPS`, `stale` | |
| 117 | `POST /api/v1/rota/weeks/{location}/{weekStart}/sign-off` | handler: the Rota chain layer | POST `rotaWeekSignOffs` | V | `NOT_AWAITING_SIGNOFF`, `SELF_APPROVAL`, `WRONG_LAYER`, `stale` | |
| 118 | `GET /api/v1/rota/shift-types` | session (Rota on) | GET `shiftTypes`; GET `rotaCells?$apply=groupby((value))` (usage); GET `rotaPatterns` | | `module-off` | ShiftCatalogue order, hours, cross, usage |
| 119 | `POST /api/v1/rota/shift-types` | `rota_shift` (+ `rota-policy`) | POST `shiftTypes` | | `rota-policy`, `invalid` | |
| 120 | `PATCH /api/v1/rota/shift-types/{code}` | `rota_shift` | PATCH `shiftTypes(id)` (a night change also updates type rota: done in `OnModifyRecord`) | V | `not-found`, `stale` | |
| 121 | `DELETE /api/v1/rota/shift-types/{code}` | `rota_shift` | DELETE `shiftTypes(id)` | V | `IN_USE`, `LAST_SHIFT_TYPE`, `stale` | |
| 122 | `GET /api/v1/rota/patterns` | `rota_pattern` | GET `rotaPatterns?$expand=people`; GET `people` in scope | | `module-off` | PatternList |
| 123 | `POST /api/v1/rota/patterns` | `rota_pattern` | POST `rotaPatternSaves` | | `scope`, `not-found`, `invalid` | |
| 124 | `PATCH /api/v1/rota/patterns/{code}` | `rota_pattern` | POST `rotaPatternSaves` | V | `scope`, `ACTIVATE_EMPTY`, `stale` | |
| 125 | `DELETE /api/v1/rota/patterns/{code}` | `rota_pattern` | DELETE `rotaPatterns(id)` | V | `not-found`, `stale` | |
| 126 | `POST /api/v1/rota/patterns/{code}/generate` | `rota_pattern` | POST `rotaPatternGenerations` | V | `NO_LANDING`, `stale` | |
| 127 | `POST /api/v1/rota/patterns/{code}/people` | `rota_pattern` | POST `rotaPatternPeopleAdds` | V | `scope`, `ALREADY_ON_PATTERN`, `stale` | |
| 128 | `GET /api/v1/rota/cover` | `team_cover` | GET `coverRequests?$filter=open eq true`; GET `filledShifts?$filter=confirmed eq false`; GET `rotaConfig` | | `module-off` | CoverBoard, suggestions |
| 129 | `POST /api/v1/rota/cover` | `team_cover` + scope | POST `coverRequestOpens` | | `COVER_OPEN`, `UNKNOWN_SHIFT`, `not-found` | |
| 130 | `POST /api/v1/rota/cover/{id}/ask-all` | `team_cover` | POST `coverRequestActions {action: askAll}` | V | `COVER_CLOSED`, `stale` | |
| 131 | `POST /api/v1/rota/cover/{id}/assign` | `team_cover` | POST `coverRequestActions {action: assign, personCode}` | V | `COVER_CLOSED`, `ROTA_INELIGIBLE`, `stale` | |
| 132 | `POST /api/v1/rota/cover/{id}/claim` | handler: own eligibility | POST `coverRequestActions {action: claim}` | V | `NOT_OFFERED`, `ROTA_INELIGIBLE`, `COVER_CLOSED`, `stale` | |
| 133 | `POST /api/v1/rota/cover/{id}/escalate` | `team_cover` | POST `coverRequestActions {action: escalate}` | V | `COVER_CLOSED`, `stale` | |
| 134 | `POST /api/v1/rota/cover/{id}/fill` | `team_cover` | POST `coverRequestActions {action: fill}` | V | `NOBODY_ELIGIBLE`, `COVER_CLOSED`, `stale` | |
| 135 | `POST /api/v1/rota/cover/{id}/reason` | `team_cover` | POST `coverRequestActions {action: reason, reason}` | V | `COVER_CLOSED`, `stale` | |
| 136 | `POST /api/v1/rota/filled/{id}/confirm` | `team_cover` | POST `filledShiftConfirmations` | V | `ALREADY_CONFIRMED`, `NOT_WORKED_YET`, `stale` | |
| 137 | `GET /api/v1/rota/it-requests` | `integration` | GET `itRequests?$orderby=raisedAt desc` | | `feature-off` | |
| 138 | `GET /api/v1/rota/my-shifts` | `own_shifts` | View, §5.8 | | `invalid` | Whole MyShifts |

### 4.7 Leave (15)

| # | Operation | Capability (BC) | BC call(s) | V | Refusals | Proxy derives |
|---|---|---|---|---|---|---|
| 139 | `GET /api/v1/leave/me` | `own_leave` | View, §5.3 | | `module-off` | Whole MyLeave |
| 140 | `POST /api/v1/leave/requests` | `own_leave` | POST `leaveRequestRaises` | | `OVER_BALANCE`, `OVERLAPS`, `VALIDATION` | hint, summary |
| 141 | `POST /api/v1/leave/requests/{id}/cancel` | `own_leave` | POST `leaveRequestDecisions {action: cancel}` | V | `NOT_YOUR_REQUEST`, `TRANSITION_NOT_ALLOWED`, `LEAVE_IN_PAYROLL`, `stale` | |
| 142 | `GET /api/v1/leave/team/requests` | handler: the Leave chain layer | View, §5.4 | | `capability`, `invalid` | Whole TeamRequests |
| 143 | `POST /api/v1/leave/requests/{id}/approve` | handler: the Leave chain layer | POST `leaveRequestDecisions {action: approve}` | V | `SELF_APPROVAL`, `ALREADY_SIGNED`, `WRONG_LAYER`, `scope`, `capability`, `stale` | rota effect summary |
| 144 | `POST /api/v1/leave/requests/{id}/decline` | handler: the Leave chain layer | POST `leaveRequestDecisions {action: decline, reason}` | V | as #143, `REASON_REQUIRED` | |
| 145 | `GET /api/v1/leave/team/balances` | `team_leave` | `$batch`: GET `people` in scope, `leaveRequests`, `leaveLedgerEntries`, `leavePolicies`, `leaveConfig` | | `capability` | Entitlement and balance per person (`domain/leave.ts` entitlement, balance) |
| 146 | `GET /api/v1/leave/entitlement/{personCode}` | handler: `own_leave` own; `team_leave` + scope | `$batch` as #145 for one person | | `not-found`, `scope` | EntitlementDetail with calculation lines |
| 147 | `GET /api/v1/leave/leavers` | `team_leave` (and `LV_LEAVER`) | GET `people?$filter=terminationDate ne 0D`; leave data as #145 | | `feature-off` | Leaver reconciliation rows |
| 148 | `GET /api/v1/leave/sickness` | `team_sick` | GET `sickEpisodes`; GET `people` in scope; GET `leaveRequests?$filter=state eq 'approved'`; GET `leaveConfig` | | `capability` | Bradford scores, triggers, sickOnLeave |
| 149 | `POST /api/v1/leave/sickness` | `team_sick` + scope | POST `sicknessRecords` | | `ALREADY_RECORDED`, `VALIDATION`, `not-found` | summary |
| 150 | `POST /api/v1/leave/sickness/{id}/rtw` | `team_sick` + scope | POST `rtwRequests` | V | `ALREADY_REQUESTED`, `stale` | summary |
| 151 | `POST /api/v1/leave/give-back` | `team_sick` + scope | POST `leaveGiveBacks` | | `NOT_SICK_ON_LEAVE`, `not-found` | ledger view, summary |
| 152 | `GET /api/v1/leave/config` | `mod_cfg` | `$batch`: GET `leaveConfig`, `leaveCodes`, `leavePolicies?$expand=serviceRules`, `employeeTypes`, `featureFlags`, `modules`, `leaveRequests?$apply=groupby((leaveCode),aggregate($count as n))` | | `capability` | requestCounts, leavers |
| 153 | `PATCH /api/v1/leave/config` | `mod_cfg` | POST `leaveConfigUpdates` | V | `in-use`, `invalid`, `stale` | |


### 4.8 Onboarding (19)

| # | Operation | Capability (BC) | BC call(s) | V | Refusals | Proxy derives |
|---|---|---|---|---|---|---|
| 154 | `GET /api/v1/onboarding/me` | `own_onb` | GET `onboardingCases(own)?$expand=documents`; GET `myOnboardingData?$filter=sessionToken eq …`; GET `onboardingConfig`, `onboardingDocTypes`, `onboardingPolicies` | | `NOT_ONBOARDING`, `module-off` | steps asked, progress, to-do |
| 155 | `PUT /api/v1/onboarding/me/steps/{step}` | `own_onb` | POST `onboardingStepSaves` | V | `VALIDATION`, `FLAG_OFF`, `SUBMITTED`, `stale` | |
| 156 | `POST /api/v1/onboarding/me/documents/{doc}` | `own_onb` | POST `onboardingDocumentUploads` | V | `SUBMITTED`, `invalid`, `stale` | |
| 157 | `POST /api/v1/onboarding/me/policies/{id}/ack` | `own_onb` | POST `onboardingPolicyAcks {action: ack or unack}` | V | `not-found`, `stale` | |
| 158 | `POST /api/v1/onboarding/me/policies/{id}/read` | `own_onb` | POST `onboardingPolicyAcks {action: read}` | V | `not-found`, `stale` | |
| 159 | `POST /api/v1/onboarding/me/submit` | `own_onb` | POST `onboardingSubmits` | V | `NOT_READY`, `OUTSTANDING`, `SUBMITTED`, `stale` | |
| 160 | `GET /api/v1/onboarding/team` | handler: `onb_track` or `onb_verify`, own location (all with `onb_cfg`) | GET `onboardingCases?$expand=documents`; GET `people?$filter=state in ('candidate','preboard')` in scope | | `capability` | progress, blockers, waiting checks |
| 161 | `GET /api/v1/onboarding/team/{personCode}` | handler as #160 | GET `onboardingCases(id)?$expand=documents` (never `Data`) | | `not-found`, `scope`, `NOT_ONBOARDING` | tracker view |
| 162 | `POST /api/v1/onboarding/team/{personCode}/chase` | `onb_track` | POST `onboardingCaseActions {action: chase}` | | `NOTHING_OUTSTANDING`, `scope` | |
| 163 | `POST /api/v1/onboarding/team/{personCode}/invite` | `onb_track` | POST `onboardingCaseActions {action: invite}` | V | `TRANSITION_NOT_ALLOWED`, `stale` | |
| 164 | `POST /api/v1/onboarding/team/{personCode}/start` | `onb_track` | POST `onboardingCaseActions {action: start}` (writes Employee, Employee Relative, Employee Qualification and raises `OnApplyOnboardingTaxNumber`) | V | `OUTSTANDING`, `stale` | |
| 165 | `POST /api/v1/onboarding/team/{personCode}/documents/{doc}/verify` | `onb_verify` | POST `onboardingDocumentChecks {action: verify}` | V | `SELF_CHECK`, `not-found`, `stale` | |
| 166 | `POST /api/v1/onboarding/team/{personCode}/documents/{doc}/reject` | `onb_verify` | POST `onboardingDocumentChecks {action: reject, reason}` | V | `SELF_CHECK`, `REASON_REQUIRED`, `stale` | |
| 167 | `GET /api/v1/onboarding/config` | `onb_cfg` | GET `onboardingConfig`, `onboardingDocTypes`, `onboardingPolicies`; GET `featureFlags` | | `capability` | ackCount per policy, step availability |
| 168 | `PUT /api/v1/onboarding/config` | `onb_cfg` | POST `onboardingConfigSaves` | V | `FIXED`, `stale` | |
| 169 | `POST /api/v1/onboarding/policies` | `onb_cfg` | POST `onboardingPolicySaves` | | `NAME_TAKEN`, `invalid` | |
| 170 | `PATCH /api/v1/onboarding/policies/{id}` | `onb_cfg` | POST `onboardingPolicySaves` | V | `not-found`, `stale` | |
| 171 | `DELETE /api/v1/onboarding/policies/{id}` | `onb_cfg` | DELETE `onboardingPolicies(id)` | V | `not-found`, `stale` | |
| 172 | `POST /api/v1/onboarding/policies/{id}/file` | `onb_cfg` | POST `onboardingPolicyFiles` | V | `not-found`, `stale` | |

### 4.9 Development-only endpoints (not built)

These are served by the fake server only. They are not in `openapi.json` and are not part of the 172.

| Endpoint | Why not built |
|---|---|
| `GET /api/v1/session/accounts` | Demo account shortcuts. Entra ID sign-in replaces them. |
| `GET /api/v1/saved-data` | The fake server's own store. |
| `GET /api/v1/saved-data/export` | As above. |
| `POST /api/v1/saved-data/reset` | As above. |
| `POST /api/v1/saved-data/restore` | As above. |
| `/api/_dev/clock`, `/api/_dev/faults`, `/api/_dev/reset`, `/api/_dev/seed/:tenant` | Test helpers. A sandbox company and a seed codeunit (`SIR_WF Demo Seed`, test app only) replace them. |

### 4.10 Count by module

| Module | Rows | Operations |
|---|---|---|
| Foundation and access | #1 to #15 | 15 |
| People and dimensions | #16 to #51 | 36 |
| Configuration and communication | #52 to #87 | 36 |
| Timesheet | #88 to #98 | 11 |
| Clocking | #99 to #104 | 6 |
| Rota | #105 to #138 | 34 |
| Leave | #139 to #153 | 15 |
| Onboarding | #154 to #172 | 19 |
| **Total** | #1 to #172 | **172** |

Check: 15 + 36 + 36 + 11 + 6 + 34 + 15 + 19 = 172, equal to the operation count of `openapi.json`. (The design doc lists Rota as 33 operations and 171 in total. The figures above are counted from `openapi.json`.)

## 5. Views assembled by the proxy

Each view is one `$batch` of independent GETs. The proxy then runs the existing `src/domain` functions on the results, so the response is the contract's shape exactly. Business Central stores and enforces; it does not format.

### 5.1 Timesheet week (`GET /timesheets/{personId}/weeks/{weekStart}`)

Batch:

1. `people?$filter=code eq '{personId}'&$expand=employeeSites`
2. `timesheetDays?$filter=employeeNo eq … and date ge {weekStart} and date le {weekStart+6}&$expand=entries($expand=breaks),log`
3. `timesheetDays?$filter=employeeNo eq … and date lt {weekStart} and state eq 'draft'&$select=date,state` (earlier weeks)
4. `rotaCells?$filter=employeeNo eq … and date ge … and date le …` and `rotaWeeks` for the person's site (published states only)
5. `clockRecords?$filter=employeeNo eq … and date ge … and date le …`
6. `leaveRequests?$filter=employeeNo eq … and state eq 'approved' and dateTo ge … and dateFrom le …` and `sickEpisodes` for the same range
7. `timesheetConfig`, `employeeTypes('{type}')`, `payCodes`, `shiftTypes`, `projects?$filter=status eq 'Open'&$expand=tasks`, `modules`, `featureFlags`, `payPeriods` (for the lock)

Derived with `domain/timesheet.ts`: `weekModel`, `weekTotals`, `dayMinutes`, `periodLocked`, `lockNote`, `rotaFor`, `fieldVisible`, `missingMandatory`, `payCodeList`, `deriveWorkType`; advisory flags (long, variance, rest, proxy, resub, locked); `domain/clock.ts` `isLate` for the clock mark.

### 5.2 Approval queue (`GET /approvals/timesheets`)

Batch:

1. `myScope?$filter=sessionToken eq …` (sites, capabilities, delegations covered)
2. `timesheetDays?$filter=workSiteCode in (…) and state in ('pend','resub','mgrok',…)&$orderby=date&$top=50&$expand=entries($expand=breaks),log`, paged with `$skiptoken`
3. `approvalChains('Timesheet')?$expand=steps`, `delegations?$filter=dateFrom le today and dateUntil ge today`
4. `people` for the rows' names and locations; `clockRecords` for the rows' days
5. `timesheetDays?$filter=…&$apply=groupby((state),aggregate($count as n))` for the counts
6. With `weekStart` and Rota on: `rotaCells` and `rotaWeeks` for the scope's sites

Derived with `domain/approvals.ts` `walkChain`, `whoDecides`, `decisionBlock` (the `decide` flag) and `slaText`. The bulk set: `ids` are every row the reader may decide at its current layer. `checksum` is SHA-256 over the sorted `id:version` pairs. `flagged` and `outside` come from `domain/timesheet.ts`. The bulk command (#95) sends the `{id, version}` pairs, and Business Central refuses the whole batch with `QUEUE_CHANGED` if any version moved.

### 5.3 My leave (`GET /leave/me`)

Batch: `people(own)`; `leaveRequests?$filter=employeeNo eq own&$expand=log&$orderby=raisedAt desc`; `leaveLedgerEntries?$filter=employeeNo eq own`; `leaveCodes`; `leavePolicies?$expand=serviceRules`; `leaveConfig`; `fiscalYears`; `bankHolidays`.

Derived with `domain/leave.ts`: `leaveYear`, `entitlement`, `yearsService`, `serviceBonus`, balance (taken, pending, left, TOIL), `typeBalanceText`, `wouldRemain`, `cancelTip`. Balances are never stored (contract D3).

### 5.4 Team leave (`GET /leave/team/requests`)

Batch: `myScope`; `leaveRequests?$filter=state eq 'pending' and workSiteCode in (…)&$expand=log`; `approvalChains('Leave')?$expand=steps`; `delegations`; `people` in scope; the leave data from §5.3 for those people; `rotaCells` for the requested days (impact).

Derived: `walkChain` layer, SLA days left and escalation, stage, balance text, advisories (min notice, cancel window).

### 5.5 Rota week (`GET /rota/weeks/{location}/{weekStart}`, also used by plan and suggestions)

Batch: `rotaWeeks?$filter=workSiteCode eq … and weekStart eq …&$expand=cells,changes`; `workSites`; `people?$filter=…site…`; `shiftTypes`; `rotaConfig`; `employeeTypes`; `leaveRequests` and `sickEpisodes` overlapping the week; `rotaProfiles`; `employeeQualifications`; `coverRequests` for the week; the previous and next week's states.

Derived with `domain/rota.ts`: lines, coverage per day, gaps, hours position, `rotaVisible`, `rotaCan`. Plan and suggestions use the eligibility rules in `domain/rota.ts` and write nothing.

### 5.6 Home (`GET /home`)

Batch: `people(own)`; `rotaCells?$filter=employeeNo eq own and date ge … and date le …` with published `rotaWeeks`; `leaveRequests` (approved) and `sickEpisodes`; `timesheetDays?$select=date,state`; `bankHolidays`; `workforceSetup` (horizon).

Derived with `domain/home.ts`: `monthOf`, `monthDates`, `dayGlyph`, `monthTotals`, `monthSummary`, `greeting`.

### 5.7 My clock (`GET /clock/me`)

Batch: `clockRecords?$filter=employeeNo eq own and date ge {yesterday}&$expand=events`; `rotaCells` for today; `timesheetDays` for today and an open day; `employeeTypes('{type}')`; `featureFlags`; `modules`; `leaveRequests` and `sickEpisodes` for today. `serverNow` is the `Date` response header of the batch, so the time is Business Central's clock.

Derived with `domain/clock.ts`: `clockState`, `elapsedSeconds`, `isForgotten`, gates.

### 5.8 My shifts (`GET /rota/my-shifts`)

Batch: `rotaCells?$filter=employeeNo eq own and date ge … and date le …`; `rotaWeeks` for the person's site; `shiftTypes`; `coverRequests?$filter=open eq true and workSiteCode eq own site`; `rotaCells` of the same site and day (who is on with me); `rotaConfig`.

### 5.9 Onboarding tracker (`GET /onboarding/team`)

Batch: `onboardingCases?$expand=documents`; `people?$filter=state in ('candidate','preboard')`; `onboardingConfig`; `onboardingDocTypes`; `onboardingPolicies`. Never `myOnboardingData`.

Derived with `domain/onboarding.ts`: `progress`, `blockers`, `readyToStart`, `outstandingText`.

## 6. Background jobs

Each job is a Job Queue Entry per company, created by the install codeunit and switched on in `SIR_WF Setup`.

| Codeunit | Schedule | What it does |
|---|---|---|
| `SIR_WF Posting Dispatcher` | Every 1 minute | Picks `SIR_WF Posting Line` rows with `State = queued` and `Queued At` older than the delay. Inserts the `SIR Timesheet Interface` row (01 §7.1). Commits per line. Retries transient errors at 1, 5, 15 and 60 minutes, then sets `failed`. Writes a `SIR_WF Posting Attempt` row per try. |
| `SIR_WF Posting Reconcile` | Nightly | Marks posted lines `reconciled` when their `Posting Line Id` is in `SIR Posted Timesheet Interface`. Raises a Workforce notification to the `integration` holders for a posted line whose interface row is gone. |
| `SIR_WF Idempotency Cleanup` | Hourly | Deletes `SIR_WF Idempotency Key` rows past `Expires At`. |
| `SIR_WF Session Cleanup` | Hourly | Revokes `SIR Approval Session` rows past `Expires-At`, and deletes revoked rows older than 30 days. |
| `SIR_WF Notice Expiry` | Daily, 00:05 in the tenant time zone | Nothing is stored for expiry (the status is derived). The job notifies posters of notices that expired that day and clears `Pinned` on them. |
| `SIR_WF Leave SLA Escalation` | Hourly | Sets `Escalated` on pending leave requests past their layer's SLA and notifies the escalation target. |
| `SIR_WF Audit Archive` | Yearly, 1 January | Applies the retention policy to `SIR_WF Audit Event` (archive by year). |

## 7. Permission set `SIR_WF Connector`

This is the only permission set the proxy's Entra app registration holds (registered on the Business Central "Microsoft Entra Applications" page).

| Object | Permission |
|---|---|
| Every `SIR_WF` API page (entity and command, WF+100 to WF+256) | Execute |
| Every `SIR_WF` table | RIMD on tables written by commands; R on reference data (`SIR_WF Capability`, `SIR_WF Capability Group`) and on append-only tables except insert (`SIR_WF Audit Event`, `SIR_WF Person History`, `SIR_WF Rota Change`, `SIR_WF Timesheet Day Log`, `SIR_WF Leave Request Log`, `SIR_WF Notification Evidence`, `SIR_WF Posting Attempt`: RI) |
| `Employee`, `Employee Relative`, `Employee Qualification`, `Default Dimension`, `Dimension Value`, `Job`, `Job Task`, `Document Attachment`, `Company Information` | RIM (no delete on Employee) |
| `SIR Work Sites`, `SIR Employee Sites`, `SIR Employee Work Shift`, `SIR Emp. Work Shift Line`, `SIR TIme Sheet Elements`, `SIR Leave Code` | RIMD |
| `SIR Employee Bank Account` | RIM (written only by an approved profile change) |
| `SIR Timesheet Interface` | RI (the dispatcher only inserts) |
| `SIR Posted Timesheet Interface`, `SIR Leave Register`, `SIR Leave Register Detail` | R, plus IM on the two leave tables (approval writes, cancel sets `Cancelled`) |
| `SIR Leave Ledger Entry` | RI |
| `SIR Notification Entry` | RIM |
| `SIR Approval Session` | RIM |
| `SIR Fiscal Year`, `SIR Pay Frequency`, `SIR Pay Period`, `SIR Payroll Setup`, `SIR Timesheet Setup`, `Base Calendar Change`, `SIR Posted Payroll Header` | R |
| `Job Queue Entry` | R (the jobs run under the job queue's own user) |

No permission is granted on any payroll amount table (`SIR Payroll Line`, `SIR Payroll Ledger Entry`, `SIR Emp. Payroll Element` and so on). The connector can never read or write money.
