# Qnipay Workforce

Workforce management for Microsoft Dynamics 365 Business Central. Timesheet,
rota, leave and onboarding all work from one shared employee record.

## What is in the app

- Access, roles and permissions, with an audit log of every change
- Employees, locations, departments, cost centres, job profiles and projects
- Organisation, calendar, notifications, notices, approval chains and delegation
- Timesheets, with clocking in and out
- Rota, shifts, patterns and cover
- Leave, sickness and return to work
- Onboarding for new starters
- Hours, exceptions, pay codes, payroll readiness and the Business Central posting log

The app currently runs against a mock API (Mock Service Worker) inside the
browser. It has the same shape as the production API, which will replace it
endpoint by endpoint. There is no database or server to set up. Postings to
Business Central are queued and dispatched by the mock API, not sent to a real
Business Central. The backend design is in `docs/backend/`.

## Run it

You need [Node.js](https://nodejs.org) 22 or newer and Git.

```
git clone https://github.com/PukarSthapit123/Workforce.git
cd Workforce
npm install
npm run dev
```

Open the address that `npm run dev` prints, usually http://localhost:5173.

To get later changes, run `git pull` in the same folder, then `npm install` in
case the dependencies changed.

## Sign in

The sign-in screen has a shortcut for one employee, one manager and one admin.
Anybody on the sample roster can also sign in with their own email address.
Every account uses the password `Qnipay@123`.

If sign-in always fails, the mock API is not running. It only runs under
`npm run dev` or a build made with `npm run build:demo`; a plain `npm run build`
leaves it out on purpose. Open the app on `localhost` (or over HTTPS), not on a
network address such as `http://192.168.x.x:5173` and not from the file on disk,
because the browser only starts the mock API's service worker there.

Each role sees a different app:

- An **employee** sees their own timesheet, shifts, leave, profile, documents
  and notices.
- A **manager** sees approvals and their team, as well as their own work.
- An **admin** sees configuration, modules, permissions and the audit log under
  Qnipay setup.
- A **new starter** (a candidate or preboarding employee) sees only their
  onboarding portal until they start.

Use the account menu, top right, to view the app as somebody else or to sign
out.

## Sample data

Everything you do is saved in your browser, so it is still there after a reload.
Other people and other browsers do not see your changes.

To go back to the data the app ships with, open Qnipay setup → Calendar and
choose **Start again**. The cleared session is kept, so you can bring it back
once.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app locally with the mock API |
| `npm test` | Runs the unit and component tests |
| `npm run e2e` | Runs the browser tests (Playwright). The first run needs `npx playwright install chromium` |
| `npm run typecheck` | Checks the TypeScript types |
| `npm run lint` | Lints the code |
| `npm run build` | Builds the production bundle, without the mock API, into `dist/` |
| `npm run build:demo` | Builds the bundle with the mock API, for a hosted demo |
| `npm run verify` | Runs every check above in turn. It takes a while |

## Where things are

| What | Where |
|---|---|
| Screens | `src/features/` |
| Business rules | `src/domain/` |
| API shapes (zod) | `src/contract/`, and the generated `contract/openapi.json` |
| Mock API and sample data | `src/mocks/` |
| Shared components and design tokens | `src/ui/` |
| Browser tests and screenshot baselines | `e2e/` |
| Backend and Business Central design | `docs/backend/` |

## Product rules

- Workforce never resolves money. It posts hours and a pay code; Business Central
  owns what the code is worth.
- Codes are identity: unique on create, never changed after.
- Nothing in use can be deleted. The refusal names what uses it.
- Every state change is audited: who, what, before and after, and why.
- The app never claims an outcome it has not observed. Queued stays queued until
  Business Central confirms it.
