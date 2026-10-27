# Loyalty & rewards rules engine, and motor telematics

Roadmap Phase 4, Addendum 6 items 4 and 6. Covva is a technology platform: every discount described here is set
and funded by the insurer, recorded by Covva as an explicit line on the quote, and never changes which insurers or
products a customer sees or the order they appear in.

> **Status:** built and proven on a throwaway local Postgres 16. The migration
> `supabase/migrations/20261031100500_loyalty_telematics.sql` **has not been applied** to the Supabase project yet;
> apply it with the normal migration process. Until then the loyalty and driving-score pages, the partner editor and
> the new `/api/v1/me/*` endpoints have no tables to read.

## Main files

| Area | Files |
|---|---|
| Database | `supabase/migrations/20261031100500_loyalty_telematics.sql` — `loyalty_rule_sets`, `quote_discounts`, `telematics_enrolments`, `telematics_trips`, `telematics_scores`, consent type `telematics`, guards, RPCs, RLS, audit, retention + deletion hooks, platform-fallback seed |
| Engine (pure) | `packages/core/src/loyalty.ts` + `loyalty.test.ts` — rule types, validation, `claimHistory()`, `evaluateLoyalty()` (stacking, caps, explanations), customer-page helpers, editor form helpers |
| Scoring (pure) | `packages/core/src/telematics.ts` + `telematics.test.ts` — `TELEMATICS_SCORING` (weights in one place), `scoreTrips()`, `safeDriverSummary()`, consent wording |
| Privacy | `packages/core/src/privacy.ts` (retention class `telematics_trips`, deletion scope, export sections), `apps/admin/src/server/privacy.ts` (export rows) |
| Server | `apps/web/src/server/loyalty.ts` (apply lines to a quote, read lines, redeem credits, customer summary), `apps/web/src/server/telematics.ts` (overview, ingestion, monthly scoring cron), hooks in `server/requests.ts` (estimates), `server/payments.ts` (amount net of discounts), `server/policies.ts` (credit redemption), `server/cron.ts` + `vercel.json` (`telematics-scoring`) |
| API | `apps/web/src/app/api/v1/me/loyalty`, `me/telematics`, `me/telematics/enrol`, `me/telematics/withdraw`, `me/telematics/trips`; `docs/api/openapi.yaml` (tags Loyalty, Telematics) |
| Customer | `/account/loyalty`, `/account/telematics` (+ `forms.tsx`, `actions.ts`), `components/customer/discount-lines.tsx` ("What you saved and why") on the quote comparison, quote detail, checkout and renewal pages; "Driving score" card on motor policies |
| Partner | `/partner/rewards` (insurer: structured editor + version history; broker: lines on their quotes), `components/partner/loyalty-rules-form.tsx`, `quote-discounts.tsx` under each quote on the request and submission pages |
| Staff | `apps/admin/src/app/(admin)/loyalty` — platform-fallback editor, every insurer's versions, discount lines, telematics counts (`PERMS.loyalty`: platform admin, compliance) |
| Tests | `packages/core/src/loyalty.test.ts`, `telematics.test.ts` (unit); `apps/web/tests/loyalty-rules.test.mjs` (database rules against Supabase as each role, tag `E2E-LOYAL`; not run in CI) |

## Rules engine

### Rule sets

One **published** rule set per insurer (`loyalty_rule_sets.insurer_org_id`), plus one with `insurer_org_id = null`
— the **platform fallback** used for insurers that have not published their own. Rule sets are immutable: every
change is a new version through `public.publish_loyalty_rule_set()` (insurer owners/admins for their insurer in
`/partner/rewards`; platform admin / compliance for the fallback in the admin console, and for any insurer when
asked). The previous version becomes `superseded` and stays in the history; `write_audit` records who published
what. `public.effective_loyalty_rule_set(insurer)` returns the set in force today (own, else fallback, honouring
`effective_from` / `effective_to`).

The seeded fallback has **every rule switched off**: discounts are insurer money and need each insurer's sign-off
(and the NIC position on inducements) before anything is turned on.

### Rule types

| Type | Inputs | Params | Gives |
|---|---|---|---|
| `no_claims` | consecutive claim-free years with cover through Covva (external policies never count) | `tiers[{years, pct}]`, `max_pct` | highest tier at or below the years |
| `loyalty_tier` | whole years since the first policy with this insurer | `tiers[{years, pct, name}]` | highest tier; `name` ("Silver", "Gold") shown to the customer |
| `bundle` | distinct cover types in the same bundle (`requests.bundle_id`) | `pct`, `min_categories` (default 2) | flat `pct` |
| `early_renewal` | days between the renewal quote and the expiring policy's `cover_end` | `pct`, `days_before_expiry` (default 14); renewal only | flat `pct` |
| `safe_driver` | mean of FINAL monthly driving scores in the last 12 months, months of data | `tiers[{score, pct}]`, `min_months` (default 3); motor renewals only, needs an enrolment | highest tier at or below the score |
| `referral_credit` | the customer's spendable `reward_ledger` balance | `max_pct`, `max_amount` | a fixed amount: min(balance, caps, amount left to pay) |

Every rule has `active`, optional `effective_from` / `effective_to`, optional `categories[]` (safe_driver defaults
to `motor`) and `renewal_only`. Keys are `[a-z0-9_]{2,40}`, unique in the set. Validation runs twice with the same
rules: `validateLoyaltyRuleSet()` in `@im/core` (friendly messages in the editors) and
`private.validate_loyalty_rules()` in the database (`P0001`, so a set can never be published in a shape the engine
cannot evaluate).

### Stacking and caps (`evaluateLoyalty`)

1. The set must be in effect today and the premium above 0; otherwise every rule is skipped with the reason.
2. Rules run in the set's **stacking order** (default `no_claims, loyalty_tier, bundle, early_renewal, safe_driver,
   referral_credit`), then by key. One line per rule type: an overlapping rule of the same type is skipped.
3. Percentage rules apply to the **base premium** — never compounded. A rule's `max_pct` caps its percentage and
   `max_amount` its cedi amount (the line says "Capped … by the insurer").
4. **Maximum combined discount** (`max_combined_pct`, default 25%): the rule that would cross it is cut to the cap,
   later percentage rules are skipped ("already reached"), and the evaluation is flagged `cappedByMaxCombined`.
5. `referral_credit` is a fixed amount applied last, outside the percentage cap, bounded by the balance, its own
   caps and what is left to pay. When the policy becomes active the amount is posted to `reward_ledger` as a
   `redemption` (reference `loyalty:redeem:<quote>`, idempotent) — the existing credit system, no second ledger.
6. Amounts are rounded to the pesewa; the same inputs always give the same lines (unit tests cover overlapping rules,
   caps hit, expired rules, no history, external-only history, zero premium, determinism).

Each line carries `label`, a plain-language `explanation`, `pct`, `amount`, `capped` / `capNote`. The engine writes
them to `quote_discounts` (one row per rule, with the evaluation inputs as a snapshot) whenever a quote is produced
or re-priced: `generateEstimates()` (automatic estimates), the broker's "Prepare quote" and the insurer's "Respond
with quote". `server/payments.ts` subtracts the recorded lines from the amount charged (and computes the commission
and platform-fee split on the net premium); the base premium on the quote is untouched.

**Claim-free years** (`claimHistory`): counted back from today in one-year windows; a window counts when Covva
policies covered at least 180 days of it and no claim (other than draft / withdrawn / rejected) falls in it;
counting stops at the first window that fails, capped at 5. "Years with the insurer" is whole years since the
customer's first policy with that insurer. Policies the customer added themselves are excluded (`externalOnly`).

### Who sees what

| Who | Sees |
|---|---|
| Customer | lines on the comparison ("Saves GHS … · you pay …"), quote detail, checkout and renewal pages; `/account/loyalty` (tier, claim-free years, credits, upcoming renewal perks with "You qualify / Not yet", recent savings, how to earn more) |
| Broker | the same lines under each quote on the request page and `/partner/rewards`; no telematics data |
| Insurer | lines on its submissions, its own versions and editor on `/partner/rewards`; monthly driving scores for the policies it insures, never trips or enrolments |
| Staff | everything; the platform fallback editor |

## Telematics

### Consent first

Consent type `telematics` (append-only `consents` rows). The wording lives in `TELEMATICS_CONSENT` (`@im/core`)
and is shown in-app (web `/account/telematics`, `GET /api/v1/me/telematics` → `consent.wording`): what is
collected (trip start/end, distance, highest speed band, harsh brake/acceleration counts, night share, phone-use
flag), what is not (no GPS route, no call or app data), use (monthly score; the insurer sees scores only), retention
(13 months of trip summaries; scores stay with the policy) and withdrawal (any time; collection stops at once).
`enrol_telematics()` refuses without a current granted consent; `withdraw_telematics()` records a `granted = false`
row when no other enrolment stays active.

### Data model

* `telematics_enrolments` — policy (motor, not external, current), user, device id/label, the consent row relied on,
  status `active | withdrawn`, `months_of_data`, `latest_score`. One active enrolment per policy. A withdrawn
  enrolment cannot be reactivated (enrol again with a fresh consent); the device id is cleared on withdrawal.
* `telematics_trips` — summary rows only, unique per (enrolment, trip id). The guard refuses rows once the enrolment
  is withdrawn or the consent is no longer granted — also for the service role. No audit trigger (volume, and the
  audit log must not keep a second copy of behavioural data that retention deletes).
* `telematics_scores` — one row per enrolment and month: score 0–100 or null, factor breakdown, trips, distance,
  `final`. Upserted by the cron, so a re-run changes nothing.

### Scoring (`TELEMATICS_SCORING`, version 1)

| Factor | Weight | Input | 0 at |
|---|---|---|---|
| speed | 0.35 | distance-weighted penalty of each trip's highest band (80–100: 0.3, 100–120: 0.7, over 120: 1) | full penalty on every km |
| harsh | 0.30 | harsh brakes + accelerations per 100 km | 8 per 100 km |
| night | 0.20 | distance-weighted share between 22:00 and 05:00 | 50% |
| phone | 0.15 | share of trips with phone handling | 40% of trips |

Score = round(Σ weight × factor), factors 0–100. A month needs ≥ 5 trips and ≥ 50 km for a score (otherwise
null, factors still shown). `safeDriverSummary()` averages FINAL months in the last 12 — that average and the number
of months are what the `safe_driver` rule reads at renewal.

### Flow

1. App records trips and calls `POST /api/v1/me/telematics/trips` (batch ≤ 200, idempotent by `tripId`, rate-limited,
   enrolment and consent re-checked with the caller's RLS client before the server writes).
2. `telematics-scoring` cron (1st of the month, 02:20 UTC): FINAL score for last month, provisional for this month,
   `months_of_data` / `latest_score` refreshed. The customer page also computes the current month live from trips.
3. At renewal the engine's `safe_driver` rule (enabled per insurer) adds an explicit line when the average score meets
   the insurer's tier and enough months of data exist.

### Retention and deletion (Act 843)

* Retention class `telematics_trips` (default **395 days**; override in `platform_settings.privacy_retention.periods`):
  deletes trip summaries older than the cutoff and every trip of an enrolment withdrawn more than 30 days ago. Scores
  stay with the policy as the record of any discount. `private.apply_retention` / `private.anonymise_subject` were
  renamed to `*_base` and wrapped so the migration stays additive.
* Deletion requests: trips deleted, enrolments withdrawn with device details removed, scores kept with the policy.
* Export: sections `loyalty_discounts`, `telematics` (enrolments + monthly scores) and `telematics_trips`.

## Open questions

1. **Insurer sign-off on the defaults** — the seeded tiers (no-claims 10/15/20/25%, Silver 2% / Gold 4%, bundle 5%,
   early renewal 3% at 14 days, safe driver 5% at 75 / 10% at 90 over 3 months, credit redemption ≤ 10%) are
   placeholders; every rule is OFF until an insurer publishes its own or signs the fallback off.
2. **NIC position** on no-claims and loyalty discounts and on referral-credit redemption as inducements.
3. **Consent wording review** (counsel): the Act 843 notice text in `TELEMATICS_CONSENT`, and whether the 13-month
   trip retention and the 30-day post-withdrawal deletion are acceptable.
4. **Commission on discounted premiums** — the split is now computed on the net premium (insurer-funded discount
   reduces commission and platform fee pro rata). Confirm with finance and the partner agreements.
5. **Claim-free years definition** (180 covered days per year, claims other than draft/withdrawn/rejected break the
   run) — align with each insurer's own NCD rules before go-live.
6. Mobile app: device identity, trip detection and the upload cadence are the app's; the API contract is in
   `docs/api/openapi.yaml` (`Telematics` tag).

## Testing

* Unit: `pnpm --filter @im/core test` (`loyalty.test.ts`, `telematics.test.ts`).
* Database rules: `apps/web/tests/loyalty-rules.test.mjs` against the shared Supabase project as each role (tag
  `E2E-LOYAL`; written, not yet run; not in CI).
* The migration was replayed on a throwaway local Postgres 16 after every earlier migration and checked per role:
  insurer admins publish only their own versions (validation, immutability, supersession, effective-set resolution);
  customers / brokers / insurers / outsiders / staff see exactly the discount lines and telematics rows described
  above; enrolment needs consent; withdrawal stops ingestion even for the service role; the scoring upsert and the
  retention job are idempotent; rule-set publications, discount lines and withdrawals are audited; trips are not.
