# Qnipay Workforce — React app

The React build of Qnipay Workforce: workforce management for Microsoft Dynamics
365 Business Central. Timesheet, rota, leave and payroll hand-off over one shared
workforce record.

**State:** sub-project 1 (Foundation and Workforce core) is designed and not yet
built. The app runs against a fake API (Mock Service Worker) shaped like the
future real one, which replaces it endpoint by endpoint.

## Where things are

| What | Where |
|---|---|
| Design for sub-project 1 | `docs/specs/2026-09-25-react-app-foundation-core-design.md` |
| Implementation plans | `docs/plans/` |
| The reference prototype and its 965-assertion suite | `../Qnipay workforce cc/mockup/` |
| Product requirements, handover, backlog, design system notes | `../Qnipay workforce cc/docs/` and `../Qnipay workforce cc/CLAUDE.md` |

The prototype is the behavioural reference. It is read, never edited, from here.

## Rules carried from the product

- Workforce never resolves money. It posts hours and a pay code; Business Central
  owns what the code is worth.
- Codes are identity: unique on create, immutable after.
- Nothing in use can be deleted. The refusal names what uses it.
- Every state change is audited: who, what, before → after, and why.
- Never claim an outcome the system has not observed. Queued is queued.
- Stubs are labelled as stubs.
