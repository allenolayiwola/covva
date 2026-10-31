# Testing

Four suites, all runnable locally with no extra setup beyond `pnpm install` and a production build:

| Suite | What it covers | Command | Needs |
|---|---|---|---|
| Core unit tests | `@im/core` domain logic: rating models, comparison engine, needs assessment, broker routing, risk-schema validation, status tables, deep links, formatting | `pnpm --filter @im/core test` | nothing |
| Database rules | Supabase triggers + RLS exercised through PostgREST as customer, broker, insurer, anonymous | `pnpm --filter @im/web test:db` | network access to the demo Supabase project |
| Browser e2e (web) | Marketing site, customer account, broker + insurer workspace, accessibility smoke, 390×844 mobile run, sign-out | `pnpm --filter @im/web e2e` | production build of `apps/web`, Chromium |
| Browser e2e (admin) | Staff sign-in (MFA off), KPIs, organisations, category launch gate, settings validation, flag round-trip, audit chain, accessibility smoke | `pnpm --filter @im/admin e2e` | production build of `apps/admin`, Chromium |

`pnpm test` (turbo) runs only the unit tests; `pnpm test:db` and `pnpm e2e` at the root run the other suites.

## Core unit tests

`packages/core/src/*.test.ts`, Node's built-in runner (`node --test` with type stripping, no framework). One file per module, named after it (`household.ts` ↔ `household.test.ts`; CI checks the pairing)
(`rating`, `comparison`, `needs`, `routing`, `risk`, `status`, `format`, `api`) plus the original `core.test.ts`. They are pure and
run in under a second.

## Database rule tests

For the policy performance migrations, also run the transactional SQL regression against an **isolated local/test database**:

```bash
psql "$LOCAL_DATABASE_URL" -v ON_ERROR_STOP=1 -f supabase/tests/performance_policies.sql
```

It creates two test users, checks that merged profile policies retain self read/update access, deny access to the other user's
row and reject ownership reassignment, then rolls back every fixture. It also rejects overlapping permissive policies in `public`.
Run `supabase db advisors --db-url "$LOCAL_DATABASE_URL" --type performance --level info` after applying the migrations locally;
expect zero `auth_rls_initplan`, `multiple_permissive_policies`, and public `unindexed_foreign_keys` findings. Unused indexes are
deliberately retained. This SQL check supplements the Auth/PostgREST and browser suites below; it does not replace them.

`apps/web/tests/db-rules.test.mjs` (plain `node:test`, zero dependencies). It signs each demo account in through the Auth REST API
(`/auth/v1/token?grant_type=password`) and talks to PostgREST (`/rest/v1/...`) as that user, so the assertions are against the real
RLS policies and triggers in `supabase/migrations/`:

- anonymous: can read categories/plans/flags/settings, cannot read profiles/memberships/requests/policies/claims/payments/audit, cannot write the catalogue;
- customer: creates and cancels own draft request; cannot create for someone else; sees only own data (no audit log, no memberships, no other profiles);
  cannot forge an active policy, change a policy's status/premium, approve or assess own claim, set own `kyc_status`, insert a payment,
  acknowledge a broker that is not the request's broker of record, write quotes/submissions/audit events; can rename own policy
  (and revert) and report then withdraw a claim; premiums can never be routed to a broker (`payments_guard`);
- broker: cannot activate cover; cannot decide claims it does not service; audit log limited to own organisation;
- insurer: cannot activate without an insurer-issued policy number; cannot issue for another insurer;
- **privileged purchase journey** (only when `SUPABASE_SECRET_KEY` is set): request → broker submission (duplicate blocked by the
  unique registry) → binding quote → application blocked until disclosure, then accepted → payment to a broker rejected, to the insurer
  succeeds → policy `pending_issuance` → customer/broker cannot activate, insurer cannot without a number, insurer issues → `active` →
  customer reports a claim → broker delivers but cannot decide → claims officer acknowledges and approves; claim events audited.
  Everything is deleted afterwards with the service key, in dependency order.

Without the secret the privileged block is reported as `skipped: no SUPABASE_SECRET_KEY` and the suite still passes.

### Environment

| Variable | Default | Used by |
|---|---|---|
| `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` | `apps/web/.env.local`, then the demo project URL | db-rules, purge |
| `SUPABASE_PUBLISHABLE_KEY` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `apps/web/.env.local` | db-rules, purge |
| `SUPABASE_SECRET_KEY` | unset | privileged journey, purge, and the running web server (request creation, payments, cron) |
| `E2E_PASSWORD` | demo password | all suites |
| `E2E_CUSTOMER_EMAIL`, `E2E_BROKER_EMAIL`, `E2E_ADVISER_EMAIL`, `E2E_UNDERWRITER_EMAIL`, `E2E_CLAIMS_EMAIL`, `E2E_ADMIN_EMAIL` | the demo accounts | db-rules, e2e |
| `E2E_BASE_URL` / `E2E_ADMIN_BASE_URL` | unset → Playwright starts `next start` on 3100 / 3101 | e2e |
| `E2E_WEB_PORT` / `E2E_ADMIN_PORT` | 3100 / 3101 | e2e |
| `E2E_BUILD=1` | unset | make Playwright run `next build` before `next start` |
| `E2E_AXE_ALLOWLIST` | known issues (see below) | comma-separated axe rule ids that are reported but do not fail |
| `ADMIN_MFA_REQUIRED=false` | set by the admin Playwright config | lets the demo admin skip TOTP |

## Browser end-to-end tests (Playwright)

The runner is the one bundled in the `playwright` package (`import { test, expect } from "playwright/test"`), the same API as
`@playwright/test`. It is **not** a workspace dependency: adding it means a lockfile change, so the sandbox/CI use a global install
plus `NODE_PATH`. For that reason the Playwright files are JavaScript (`playwright.config.js`, `e2e/**/*.js`) — the apps' `tsconfig.json`
includes every `*.ts` file, and a TS config importing `playwright/test` would be type-checked by `next build` and `tsc` and fail.
Switch them to TypeScript once `@playwright/test` is added to `apps/*/package.json`.

Local run (Chromium must be installed — in the sandbox it already is; elsewhere `npx playwright@1.63.0 install --with-deps chromium`):

```bash
pnpm --filter @im/web build && pnpm --filter @im/admin build   # once, or E2E_BUILD=1 below
pnpm --filter @im/web e2e            # starts `next start -p 3100` unless something already listens there
pnpm --filter @im/admin e2e          # starts `next start -p 3101` with ADMIN_MFA_REQUIRED=false
pnpm --filter @im/web e2e:report     # open the HTML report (e2e/.report)
```

If a server from a previous build is still running it is reused (`reuseExistingServer: true`), so restart it after rebuilding or the
page will show "This page couldn't load" (stale chunk hashes).

### Layout

```
apps/web/playwright.config.js        projects: setup → chromium (desktop) + mobile (390×844) → signout (runs last)
apps/web/e2e/auth.setup.js           signs in customer / broker supervisor / insurer underwriter through /sign-in → e2e/.auth/*.json
apps/web/e2e/marketing.spec.js       home, /explore/motor, not-found, how-it-works, help-me-choose wizard, FAQ search, sitemap/robots, contact form
apps/web/e2e/customer.spec.js        sign-in errors/redirects, dashboard, request form validation, motor request (conditional), wallet, claims, profile round-trip
apps/web/e2e/partner.spec.js         broker overview/queue/settings tabs; insurer overview/submissions/issuance/claims/products
apps/web/e2e/a11y.spec.js            35 pages: one h1, labelled controls, alt text, axe (when available), no console errors
apps/web/e2e/mobile.spec.js          home, sign-in, /account at 390×844 (no horizontal scroll, mobile nav / tab bar)
apps/web/e2e/signout.spec.js         customer sign-out (revokes the demo session, hence last)
apps/web/e2e/support/{env,a11y}.js   accounts, storageState paths, sign-in helper, a11y helpers (shared with admin)
apps/admin/playwright.config.js      projects: setup → chromium (serial: tests mutate shared flags)
apps/admin/e2e/{auth.setup,admin,a11y}.spec.js
```

Role fixtures: specs opt in with `test.use({ storageState: STATE.customer | broker | insurer | admin })`. Selectors are role/label
based (`getByRole`, `getByLabel`); there are no `data-testid`s in the apps. Retries are 1 in CI, 0 locally; traces and screenshots are
kept on failure under `e2e/.results`.

Conditional test: "a complete motor form is sent" asserts the friendly "We couldn't send your request just now" error when the server
has no `SUPABASE_SECRET_KEY` (local), and the redirect to the new request when it has one (CI). The outcome is recorded as a test
annotation.

### Accessibility smoke

Every page in `a11y.spec.js` gets: exactly one `<h1>`, a `<main>` landmark, every `<img>` with `alt`, every form control labelled,
no console errors or uncaught exceptions, and — when `axe-core` can be found in the pnpm store (it is a transitive dependency of
`eslint-config-next`) — an axe run against WCAG 2.0/2.1 A+AA. Critical and serious violations fail the test except the rule ids in
the allowlist, which are still attached to every test as `axe-violations.json`.

## Test data: tagging and cleanup

The suites run against the shared demo database, so:

- every row a test creates is tagged with the prefix `E2E-` — `E2E-DBRULES <timestamp>` for the database suite (request titles, policy
  nicknames, claim descriptions, payment idempotency keys) and `E2E-PLAYWRIGHT` for browser tests (lead name/message, request title via
  the vehicle make, request note, profile preferred name while a test runs);
- tests restore what they change (policy nickname, preferred name, feature flag) in `finally` blocks;
- customers cannot delete rows, so the suite cancels requests and withdraws claims it created. With `SUPABASE_SECRET_KEY` set, the
  teardown runs `apps/web/tests/purge-e2e-data.mjs`, which deletes `claims`, `payments`, `policies`, `requests` (cascading to quotes,
  submissions, disclosures, applications, tasks, messages, events) and `leads` whose tag column starts with `E2E-`, in that order.
  Run it by hand with `pnpm --filter @im/web test:purge`.
- `audit_events` is append-only by design, so the audit trail of test writes remains (actor = the demo accounts).

Leftovers to expect after a local run without the secret: cancelled `requests` titled `E2E-DBRULES …`, withdrawn `claims` described
`E2E-DBRULES …`, and `leads` named `E2E-PLAYWRIGHT Tester`.

## CI (`.github/workflows/ci.yml`)

Two quick jobs, no database and no browser, so a pull request gets its answer in minutes:

- **`checks`** (every push to `main` and every PR): `pnpm install --frozen-lockfile` (pnpm store cached) →
  `turbo typecheck` → `turbo lint` → `turbo test` (the `@im/core` unit suite) → `next build` for web and admin
  (`.next/cache` cached). Only public Supabase values are needed at build time; the build never calls the database.
- **`core-test-coverage`** (PRs only): `scripts/check-core-tests.mjs` diffs base…head and fails when
  `packages/core/src/<name>.ts` changed without `packages/core/src/<name>.test.ts` changing too. `index.ts`, the
  `i18n/` catalogues and deleted modules are exempt. Escape hatch: `[skip-test-check]` in the PR title (the skip
  is printed in the job log). Run it locally with `node scripts/check-core-tests.mjs origin/main HEAD`.

Both jobs should be required checks on `main` (docs/OPERATIONS.md § "Branch protection").

The database-rules and browser suites run from `.github/workflows/integration.yml`, started by hand
(`workflow_dispatch`) against the shared Supabase project: `pnpm install` → build → `test:db` → web e2e → admin e2e
→ purge → `playwright-report-web` / `playwright-report-admin` artifacts. Repository secrets: `SUPABASE_URL`,
`SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `E2E_PASSWORD`; optional repository variables `E2E_*_EMAIL`
override the demo accounts. Without the secrets the workflow still runs: public values fall back to the demo
project, the privileged journeys are skipped, and the purge is skipped.

## Known limitations

- **Contrast:** `--color-subtle` (now `#5C737A`, 5.0:1 on white) and `--color-amber` (now `#85601F`, 5.1:1 on its background) were
  darkened to pass WCAG AA for small text. `color-contrast` stays allowlisted for the remaining findings: tiny labels inside the
  illustrative phone and broker-queue mock-ups on the marketing site and dense tables in the apps, still to be reviewed. Also allowlisted: `scrollable-region-focusable` (the sample `<pre>` on `/insurers`), `link-in-text-block` (admin overview
  inline link) and `aria-meter-name` (the admin `<Meter>` on `/categories`). Set `E2E_AXE_ALLOWLIST=""` to make them fail.
- Required text fields on the request form report zod's generic "Invalid input: expected string, received undefined" instead of the
  labelled "… is required" message, because empty values are omitted from the payload before validation.
- The customer `/explore/<unknown>` not-found page answers HTTP 200 + `noindex` (raised inside a streamed boundary; see NEXT16_NOTES §8).
- Sign-out uses Supabase's global scope, so the customer sign-out test runs in its own project after all others; do not run the web
  and admin suites with the same account concurrently.
- The e2e suites share the demo database: run one copy at a time per account. The admin suite is serial (`workers: 1`) because it
  toggles a feature flag (`ussd_channel`, restored afterwards).
- No `SUPABASE_SECRET_KEY` locally means the privileged journey, request creation, payments and cron paths are not exercised outside CI.
- Playwright's own `@playwright/test` package is not in the lockfile; the runner comes from a global install (see above).

## Local production-hardening rules

`supabase/tests/production_hardening.test.sql` is a transactional pgTAP suite for the RPC
execute grants, partner membership/finance boundaries, public policy verification, and
CMS schema/RLS protection. With a local Supabase database containing the repo migrations,
run `supabase test db`. All fixtures (including a CMS test page) roll back. The suite uses
both JWT claim settings to support local Auth fixtures and Supabase Auth helpers.
Do not run this suite or the REST database suites against production during hardening work.

`pnpm test` also runs the web unit tests in `apps/web/tests/unit`: the actual cron handler
with job side effects stubbed, plus the admin rollup action with authorization and database
clients stubbed. These verify fail-closed cron authentication and that service-role rollups
only follow successful platform authorization and input validation.
