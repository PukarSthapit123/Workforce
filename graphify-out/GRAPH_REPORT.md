# Graph Report - qnipay-workforce-app  (2026-10-01)

## Corpus Check
- 284 files · ~429,641 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 2 file(s) not represented in the graph (top: (none) 1, .css 1)

## Summary
- 1349 nodes · 4150 edges · 69 communities (61 shown, 8 thin omitted)
- Extraction: 99% EXTRACTED · 1% INFERRED · 0% AMBIGUOUS · INFERRED: 41 edges (avg confidence: 0.86)
- Token cost: 92,370 input · 0 output

## Community Hubs (Navigation)
- Shell Navigation and View-As
- End-to-End Specs
- People Page Component Tests
- Audit and Contracts Pages
- Session and Sign-In
- UI Primitives (Radix)
- Person Record and Queries
- Fake Server Faults and Dev Tests
- Mock Contract Tests
- Sessions and Capabilities
- Seed Extraction
- Codes and Lifecycle Rules
- HTTP Helpers and Versioning
- People Handlers and Scope
- Buttons, Tips and Pages
- Reference Data Queries
- Access Contract
- Permissions Page
- Profile Self-Service Rules
- ESLint Config
- People Contract
- Dev Dependencies
- Build Check Scripts
- Employee Types Page
- In-Use Refusals
- TypeScript Config
- Record Mutations
- Fake Server Store
- npm Scripts
- Employee Types Contract
- shadcn Config
- Dimensions Contract
- Fake Server Handlers
- Modals and Dialogs
- Typed API Client Tests
- Access Contract Tests
- Person Form
- Profile Contract
- Audit Writes and serve()
- Code Validation
- Foundation Design Docs
- Runtime Dependencies
- Person Validation
- Review Priorities
- Permissions Page Tests
- Capability Contract Test
- MSW Service Worker
- Vite and Vitest Config
- Audit Contract
- Porting Patterns
- Fake Server Design
- OpenAPI Generation
- Trace Generator
- App Entry Point
- Trace Check
- Node TypeScript Config
- Prototype Trace Workflow
- Porting Agents
- Token Lifting
- Field History
- No-Money Contract Check
- Lint Rule Tests

## God Nodes (most connected - your core abstractions)
1. `cn()` - 88 edges
2. `tid` - 58 edges
3. `react` - 56 edges
4. `api()` - 50 edges
5. `store` - 43 edges
6. `Button` - 40 edges
7. `Modal()` - 32 edges
8. `PermissionsPage()` - 31 edges
9. `refuse()` - 31 edges
10. `PageHead()` - 25 edges

## Surprising Connections (you probably didn't know these)
- `Module review priorities` --semantically_similar_to--> `Plan 1a Review Focus (five risks)`  [INFERRED] [semantically similar]
  .claude/agents/module-reviewer.md → docs/plans/2026-09-25-plan-1a-foundation-and-access.md
- `Mockup slices (.superpowers/sdd/<module>/slices/<screen>.md)` --references--> `--qp design tokens (ui/tokens.css)`  [INFERRED]
  .claude/agents/mockup-slicer.md → docs/specs/2026-09-25-react-app-foundation-core-design.md
- `Module review priorities` --references--> `No monetary fields / money lint`  [INFERRED]
  .claude/agents/module-reviewer.md → docs/specs/2026-09-25-react-app-foundation-core-design.md
- `1a porting patterns` --conceptually_related_to--> `Plan 1a: Foundation and Access`  [INFERRED]
  .claude/agents/porter.md → docs/plans/2026-09-25-plan-1a-foundation-and-access.md
- `Rules carried from the product` --rationale_for--> `Audit log (iaudit)`  [INFERRED]
  README.md → docs/specs/2026-09-25-react-app-foundation-core-design.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Port-mode agent pipeline (slice, port, review, trace)** — _claude_agents_mockup_slicer_mockup_slicer, _claude_agents_porter_porter, _claude_agents_module_reviewer_module_reviewer, _claude_agents_trace_filler_trace_filler, _claude_agents_mockup_slicer_mockup_slices, _claude_agents_porter_module_brief, _claude_agents_porter_module_report [INFERRED 0.85]
- **Server-side mutation path (session, capability, If-Match, bump, audit, refusal)** — docs_plans_2026_09_25_plan_1a_foundation_and_access_server_helpers, docs_plans_2026_09_25_plan_1a_foundation_and_access_write_audit, docs_specs_2026_09_25_react_app_foundation_core_design_optimistic_concurrency, docs_specs_2026_09_25_react_app_foundation_core_design_refusal_shape, docs_specs_2026_09_25_react_app_foundation_core_design_rules_server_side [INFERRED 0.85]
- **Prototype traceability (suite to trace.json to trace:check)** — docs_specs_2026_09_25_react_app_foundation_core_design_regression_suite, docs_specs_2026_09_25_react_app_foundation_core_design_trace_json, docs_plans_2026_09_25_plan_1a_foundation_and_access_trace_script, _claude_agents_trace_filler_completed_areas, _claude_agents_trace_filler_trace_filler [EXTRACTED 1.00]

## Communities (69 total, 8 thin omitted)

### Community 0 - "Shell Navigation and View-As"
Cohesion: 0.06
Nodes (58): react-router, useViewAsPeople(), buildNav(), LATER, NavGroup, NavInput, NavTab, setupSections() (+50 more)

### Community 1 - "End-to-End Specs"
Cohesion: 0.09
Nodes (30): DIALOGS_1B, PAGES_1B, READY, Profile, Change, call(), control(), FROZEN (+22 more)

### Community 2 - "People Page Component Tests"
Cohesion: 0.12
Nodes (32): @testing-library/react, @testing-library/user-event, openEdit(), f(), openAdd(), openEdit(), openKind(), set() (+24 more)

### Community 3 - "Audit and Contracts Pages"
Cohesion: 0.13
Nodes (44): useAudit(), usePeople(), Person, AuditPage(), detail(), ENTITY_LABEL, ENTITY_OPTIONS, recordLabel() (+36 more)

### Community 4 - "Session and Sign-In"
Cohesion: 0.10
Nodes (31): @tanstack/react-query, ApiError, Args, LooseOpts, NETWORK, Opts, UNREADABLE, RecordMutationOptions (+23 more)

### Community 5 - "UI Primitives (Radix)"
Cohesion: 0.10
Nodes (33): class-variance-authority, radix-ui, react, cn(), CheckboxField(), SelectBox(), SelectBoxProps, SelectOption (+25 more)

### Community 6 - "Person Record and Queries"
Cohesion: 0.15
Nodes (36): lucide-react, useHistory(), usePerson(), useProfile(), useProfileQueue(), useNames(), LIFECYCLE, ContractForm() (+28 more)

### Community 7 - "Fake Server Faults and Dev Tests"
Cohesion: 0.09
Nodes (22): msw, sonner, mount(), SeedAccount, checkedRequests, decoded(), Fault, FAULT_BODY (+14 more)

### Community 8 - "Mock Contract Tests"
Cohesion: 0.09
Nodes (33): DIMENSION_KINDS, me(), as(), COLLECTION, IN_USE, LABEL, SAMPLE, as() (+25 more)

### Community 9 - "Sessions and Capabilities"
Cohesion: 0.10
Nodes (34): createSession, deleteSession, DemoAccount, endViewAs, getSession, listAccounts, listViewAsPeople, Session (+26 more)

### Community 10 - "Seed Extraction"
Cohesion: 0.07
Nodes (25): jsdom, BANK_VERIFY, boot(), byId(), FROZEN, here, html, iso() (+17 more)

### Community 11 - "Codes and Lifecycle Rules"
Cohesion: 0.10
Nodes (24): DIMENSION_CODE, EMPLOYEE_CODE, TYPE_CODE, article(), canMove(), describeStates(), isHere(), isPersonState() (+16 more)

### Community 12 - "HTTP Helpers and Versioning"
Cohesion: 0.19
Nodes (22): RecordMeta, AuthedSession, handlersFor(), bump(), checkVersion(), EXPECTED, handle(), parseOr422() (+14 more)

### Community 13 - "People Handlers and Scope"
Cohesion: 0.15
Nodes (25): requireCapability(), accountKey(), addAccount(), EDITABLE, requireList(), requireSight(), requireUserTypeRight(), userTypeChangeProblem() (+17 more)

### Community 14 - "Buttons, Tips and Pages"
Cohesion: 0.14
Nodes (21): HelpButton(), Tip(), ButtonKind, ButtonProps, KIND, AdminCard(), IconTile(), ChoiceList() (+13 more)

### Community 15 - "Reference Data Queries"
Cohesion: 0.13
Nodes (20): AFTER, Body, Saved, peopleKeys, dimensionKey(), InUseRow, useDimension(), DimensionKind (+12 more)

### Community 16 - "Access Contract"
Cohesion: 0.17
Nodes (21): ExceptionWrite, addException, Capability, CapabilityGroup, listCapabilities, listCapabilityGroups, listUsers, listUserTypes (+13 more)

### Community 17 - "Permissions Page"
Cohesion: 0.13
Nodes (16): Self, useCapabilities(), useCapabilityGroups(), useUsers(), useUserTypes(), exceptionsSummary(), EXTRA_ACTIONS, HEAD (+8 more)

### Community 18 - "Profile Self-Service Rules"
Cohesion: 0.16
Nodes (19): afterDecision(), maskBank(), routeFor(), SELF_FIELD_KEYS, SELF_FIELDS, selfField(), SelfFieldDef, SelfFieldKey (+11 more)

### Community 19 - "ESLint Config"
Cohesion: 0.10
Nodes (21): engines, node, msw, workerDirectory, name, private, type, clsx (+13 more)

### Community 20 - "People Contract"
Cohesion: 0.11
Nodes (21): AFTER_PERSON, StateFilter, IsoDateTime, createPerson, editable, getNextCode, getPerson, HistoryEntry (+13 more)

### Community 21 - "Dev Dependencies"
Cohesion: 0.09
Nodes (22): devDependencies, @axe-core/playwright, eslint, @eslint/js, eslint-plugin-react-hooks, globals, jsdom, @playwright/test (+14 more)

### Community 22 - "Build Check Scripts"
Cohesion: 0.13
Nodes (10): dist, findMarkers(), MARKERS, root, r, lifted, proto, root (+2 more)

### Community 23 - "Employee Types Page"
Cohesion: 0.18
Nodes (19): useRemoveType(), useTypeLibrary(), useUpdateType(), useEmployeeTypes(), EmployeeTypesPage(), TypeDetail(), Cap, Cat (+11 more)

### Community 24 - "In-Use Refusals"
Cohesion: 0.14
Nodes (18): group(), inUseRefusal(), J, L, NOUN, P, phrase(), world (+10 more)

### Community 25 - "TypeScript Config"
Cohesion: 0.10
Nodes (19): compilerOptions, baseUrl, ignoreDeprecations, isolatedModules, jsx, lib, module, moduleResolution (+11 more)

### Community 26 - "Record Mutations"
Cohesion: 0.18
Nodes (19): useExceptionWrite(), useSetTemplateCapability(), api(), useCreateDimension(), useRemoveDimension(), useUpdateDimension(), useCreateType(), setup() (+11 more)

### Community 27 - "Fake Server Store"
Cohesion: 0.15
Nodes (13): Collections, contentHash(), createStore(), DEFAULT_TENANT, isTenant(), PersistedState, Seed, SEED_VERSION (+5 more)

### Community 28 - "npm Scripts"
Cohesion: 0.11
Nodes (18): scripts, build, build:check, build:demo, dev, e2e, lint, openapi (+10 more)

### Community 29 - "Employee Types Contract"
Cohesion: 0.14
Nodes (16): AFTER, typesKey, Archetype, createEmployeeType, EmployeeType, EmployeeTypeRow, EntryMode, getTypeLibrary (+8 more)

### Community 30 - "shadcn Config"
Cohesion: 0.12
Nodes (16): aliases, components, hooks, lib, ui, utils, iconLibrary, rsc (+8 more)

### Community 31 - "Dimensions Contract"
Cohesion: 0.12
Nodes (16): Mutation, CostCentre, CostCentreBody, crud(), Department, DepartmentBody, DimensionParams, InUse (+8 more)

### Community 32 - "Fake Server Handlers"
Cohesion: 0.14
Nodes (13): getTenant, Tenant, accessHandlers, devHandlers, dimensionHandlers, employeeTypeHandlers, handlers, peopleHandlers (+5 more)

### Community 33 - "Modals and Dialogs"
Cohesion: 0.25
Nodes (13): ConfirmModal(), Modal(), Dialog(), DialogBody(), DialogContent(), DialogDescription(), DialogFooter(), DialogHeader() (+5 more)

### Community 34 - "Typed API Client Tests"
Cohesion: 0.16
Nodes (10): zod, getThing, listThings, putThing, server, Thing, ThingParams, Endpoint (+2 more)

### Community 35 - "Access Contract Tests"
Cohesion: 0.19
Nodes (14): acc(), accountByEmail(), accounts(), auditRows(), audits(), findAudit(), grantPermCfgTo(), otherAccountOfSameType() (+6 more)

### Community 36 - "Person Form"
Cohesion: 0.21
Nodes (14): useNextCode(), CATEGORIES, close(), Draft, fromPerson(), hours(), isStart(), isUserType() (+6 more)

### Community 37 - "Profile Contract"
Cohesion: 0.18
Nodes (13): AFTER, profileKeys, ApprovalStage, ChangeParams, decideProfileChange, Decision, getProfile, listProfileChanges (+5 more)

### Community 38 - "Audit Writes and serve()"
Cohesion: 0.16
Nodes (10): nextAuditId(), writeAudit(), adminThing, getThing, listThings, publicThing, putThing, t1() (+2 more)

### Community 39 - "Code Validation"
Cohesion: 0.28
Nodes (12): codeChangeProblem(), dimensionCodeProblem(), employeeCodeProblem(), nextEmployeeCode(), normaliseCode(), Problem, taken(), typeCodeProblem() (+4 more)

### Community 40 - "Foundation Design Docs"
Cohesion: 0.19
Nodes (14): buildNav(NavInput): NavGroup[], NotBuilt page, Plan 1a: Foundation and Access, Delivery plans 1a / 1b / 1c, --qp design tokens (ui/tokens.css), Seed extraction from the prototype, shadcn/ui on Radix, Sub-project 1 design: Foundation and Workforce core (+6 more)

### Community 41 - "Runtime Dependencies"
Cohesion: 0.14
Nodes (14): dependencies, class-variance-authority, clsx, @fontsource/inter, lucide-react, msw, radix-ui, react (+6 more)

### Community 42 - "Person Validation"
Cohesion: 0.28
Nodes (10): EMAIL, emailProblem(), hoursProblem(), newPersonProblem(), PersonContext, PersonDraft, personEditProblem(), REFS (+2 more)

### Community 43 - "Review Priorities"
Cohesion: 0.27
Nodes (9): AuditPage, formatDateTime, describeChange, Permissions endpoints (user-types, users exceptions; perm_cfg), resolveCapabilities(templateCaps, grants, revocations), Server helpers: refuse, readJson, requireSession, requireCapability, checkVersion, bump, Session endpoints, useSession and view-as, writeAudit(), Audit log (iaudit), Optimistic concurrency (version, If-Match, 412) (+1 more)

### Community 44 - "Permissions Page Tests"
Cohesion: 0.24
Nodes (8): accountRecord(), accountsById(), anyAccount(), FAULT_BODY, mount(), SeedAccount, Toaster(), useAppTheme()

### Community 45 - "Capability Contract Test"
Cohesion: 0.22
Nodes (7): buildUrl(), Account, call(), employeeHolding(), everyCapability(), gated, pathParamNames()

### Community 46 - "MSW Service Worker"
Cohesion: 0.36
Nodes (8): activeClientIds, getResponse(), handleRequest(), IS_MOCKED_RESPONSE, resolveMainClient(), respondWithMock(), sendToClient(), serializeRequest()

### Community 47 - "Vite and Vitest Config"
Cohesion: 0.31
Nodes (6): @tailwindcss/vite, vite, @vitejs/plugin-react, vitest, fakeServerOn(), fakeServerFlag()

### Community 48 - "Audit Contract"
Cohesion: 0.33
Nodes (6): AuditEntry, AuditPage, AuditQuery, listAudit, defineEndpoint(), auditHandlers

### Community 49 - "Porting Patterns"
Cohesion: 0.39
Nodes (6): defineEndpoint / ENDPOINTS registry, Wrapped UI components with required testId, toastRefusal, expectTestIdCoverage, No monetary fields / money lint, Refusal shape {code, message, next, usedBy?, field?}, Test ID registry (src/testids.ts, data-testid), Zod contract and OpenAPI output

### Community 50 - "Fake Server Design"
Cohesion: 0.25
Nodes (5): api<T>() typed client and ApiError, Fake server store singleton (SEED_VERSION, STORE_KEY), /api/_dev endpoints (reset, seed, clock, faults), MSW fake server with in-memory store, Testing layers (domain, contract, component, e2e)

### Community 51 - "OpenAPI Generation"
Cohesion: 0.39
Nodes (6): buildOpenApi(), DESCRIPTION, json(), parameters(), REFUSAL_REF, refusalStatuses()

### Community 52 - "Trace Generator"
Cohesion: 0.25
Nodes (7): defaulted, here, map, OUT, perSection, rows, src

### Community 53 - "App Entry Point"
Cohesion: 0.33
Nodes (3): react-dom, start(), syncFromOtherTabs

### Community 54 - "Trace Check"
Cohesion: 0.29
Nodes (5): areas, NA_PREFIXES, rows, trace, TraceRow

### Community 55 - "Node TypeScript Config"
Cohesion: 0.29
Nodes (6): compilerOptions, module, moduleResolution, skipLibCheck, types, include

### Community 56 - "Prototype Trace Workflow"
Cohesion: 0.47
Nodes (6): mockup-slicer agent, completedAreas (e2e/trace-areas.json), trace-filler agent, scripts/trace.mjs (npm run trace, trace:check), Prototype regression suite (qnipay-regression-suite.js, 965 assertions), Prototype trace (e2e/trace.json)

### Community 57 - "Porting Agents"
Cohesion: 0.47
Nodes (6): Mockup slices (.superpowers/sdd/<module>/slices/<screen>.md), module-reviewer agent, Module review file (review.md), Module condensed brief (brief.md), Module report (report.md), porter agent

### Community 58 - "Token Lifting"
Cohesion: 0.40
Nodes (5): allBlocks(), block(), here, html, out

### Community 59 - "Field History"
Cohesion: 0.60
Nodes (4): diffFields(), FIELD_LABELS, fieldLabel(), historyValue()

### Community 60 - "No-Money Contract Check"
Cohesion: 0.60
Nodes (4): allow, hasCurrency(), walk(), words()

## Knowledge Gaps
- **348 isolated node(s):** `$schema`, `style`, `rsc`, `tsx`, `config` (+343 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 439 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **8 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `jsdom` connect `Seed Extraction` to `ESLint Config`?**
  _High betweenness centrality (0.095) - this node is a cross-community bridge._
- **Why does `react` connect `UI Primitives (Radix)` to `Shell Navigation and View-As`, `Modals and Dialogs`, `People Page Component Tests`, `Audit and Contracts Pages`, `Session and Sign-In`, `Person Form`, `Person Record and Queries`, `Buttons, Tips and Pages`, `Reference Data Queries`, `Permissions Page`, `ESLint Config`, `App Entry Point`, `Employee Types Page`?**
  _High betweenness centrality (0.088) - this node is a cross-community bridge._
- **Why does `zod` connect `Typed API Client Tests` to `Session and Sign-In`, `Profile Contract`, `Audit Writes and serve()`, `Sessions and Capabilities`, `HTTP Helpers and Versioning`, `Access Contract`, `Audit Contract`, `OpenAPI Generation`, `ESLint Config`, `People Contract`, `No-Money Contract Check`, `Employee Types Contract`, `Dimensions Contract`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `api()` (e.g. with `admin-1b.spec.ts` and `faults-1b.spec.ts`) actually correct?**
  _`api()` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `$schema`, `style`, `rsc` to the rest of the system?**
  _348 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Shell Navigation and View-As` be split into smaller, more focused modules?**
  _Cohesion score 0.05617283950617284 - nodes in this community are weakly interconnected._
- **Should `End-to-End Specs` be split into smaller, more focused modules?**
  _Cohesion score 0.08883693746347165 - nodes in this community are weakly interconnected._