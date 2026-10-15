# Qnipay Workforce — React app

The React build of Qnipay Workforce, workforce management for Microsoft Dynamics
365 Business Central. Timesheet, rota, leave and onboarding all work from one
shared workforce record.

## State

These modules are built: foundation and access, people and dimensions,
configuration and communication, timesheet, clocking in and out, rota, leave,
onboarding, setup, and payroll and Business Central (My hours, Team hours,
Exceptions, Pay codes, Payroll readiness and Business Central).

The Business Central connection is simulated. Postings are queued and
dispatched by a stub inside the fake API, not sent to a real Business Central.
The design for the real backend is in `docs/backend/`.

The app runs against a fake API (Mock Service Worker) that sits inside the
browser. The fake API has the same shape as the planned real API, which will
replace it one endpoint at a time. There is no database or server to set up.

## Run it

You need [Node.js](https://nodejs.org) 22 or newer and Git.

```
git clone https://github.com/PukarSthapit123/Workforce.git
cd Workforce
npm install
npm run dev
```

Open the address that `npm run dev` prints, usually http://localhost:5173.

The `main` branch always has the latest complete work. To get later changes,
run `git pull` in the same folder, then `npm install` in case the dependencies
changed.

## Sign in

The sign-in screen has a shortcut for one employee, one manager and one admin.
Anybody on the demo roster can also sign in with their own email address. Every
account uses the password `Qnipay@123`.

If sign-in always fails, the fake API is not running. It only runs under
`npm run dev` or a build made with `npm run build:demo`; a plain `npm run build`
leaves it out on purpose. Open the app on `localhost` (or over HTTPS), not on a
network address such as `http://192.168.x.x:5173` and not from the file on disk,
because the browser only starts the fake API's service worker there.

Each role sees a different app:

- An **employee** sees their own timesheet, shifts, leave, profile, documents
  and notices.
- A **manager** sees approvals and their team, as well as their own work.
- An **admin** sees configuration, modules, permissions and the audit log under
  Qnipay setup.
- A **new starter** (a candidate or preboarding person) sees only their
  onboarding portal until they start.

Use the account menu, top right, to look at the app as somebody else or to sign
out.

## Demo data

Everything you do is saved in your browser, so it is still there after a reload.
Other people and other browsers do not see your changes.

To go back to the data the app ships with, open Qnipay setup → Calendar and
choose **Start again**. The cleared session is kept, so you can bring it back
once.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Runs the app locally with the fake API |
| `npm test` | Runs the unit and component tests |
| `npm run e2e` | Runs the browser tests (Playwright). The first run needs `npx playwright install chromium` |
| `npm run typecheck` | Checks the TypeScript types |
| `npm run lint` | Lints the code |
| `npm run build` | Builds the production bundle, without the fake API, into `dist/` |
| `npm run verify` | Runs every check above in turn. It takes a while |

## Where things are

| What | Where |
|---|---|
| The app code | `src/`: `features/` holds the screens, `domain/` the business rules, `contract/` the API shapes, `mocks/` the fake API and its seed data, `ui/` the shared components |
| Browser tests and screenshot baselines | `e2e/` |
| Design for sub-project 1 | `docs/specs/2026-09-25-react-app-foundation-core-design.md` |
| Implementation plans | `docs/plans/` |
| The reference prototype and its 965-assertion suite | `../Qnipay workforce cc/mockup/` (outside this repository) |
| Product requirements, handover, backlog and design system notes | `../Qnipay workforce cc/docs/` and `../Qnipay workforce cc/CLAUDE.md` (outside this repository) |

The prototype is the behavioural reference. This repository reads it and never
edits it. You do not need the prototype to run the app.

## Rules carried from the product

- Workforce never resolves money. It posts hours and a pay code; Business Central
  owns what the code is worth.
- Codes are identity: unique on create, immutable after.
- Nothing in use can be deleted. The refusal names what uses it.
- Every state change is audited: who, what, before → after, and why.
- Never claim an outcome the system has not observed. Queued is queued.
- Stubs are labelled as stubs.
