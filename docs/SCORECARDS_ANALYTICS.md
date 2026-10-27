# Broker scorecards, ratings and the analytics layer

Status: built on branch `feat/scorecards-analytics` (roadmap Phase 4). Migration
`supabase/migrations/20261031100400_scorecards_analytics.sql` is **not applied yet** — apply it with the
normal migration process, then run the `analytics-rollup` job once with a backfill (admin → Analytics →
Rollup) and let `scorecard-refresh` run (or trigger it manually) so the first snapshots exist.

Covva is a technology provider. Scores are indicators of service, never advice, and nothing here lets a
partner pay for a better position.

## 1. Where things live

| Layer | Files |
|---|---|
| Pure logic + tests | `packages/core/src/scorecards.ts`, `scorecards.test.ts`; routing factor in `routing.ts` / `routing-engine.ts` |
| Database | `supabase/migrations/20261031100400_scorecards_analytics.sql` (tables `broker_reviews`, `broker_scorecards`, schema `analytics`, functions below) |
| Server | `apps/web/src/server/scorecards.ts` (refresh job, reads, rating, reply), `analytics.ts` (rollup, facts, insight report), `insight-pdf.ts`; routing hook in `server/routing.ts`; cron jobs `scorecard-refresh`, `analytics-rollup` in `server/cron.ts` + `apps/web/vercel.json` |
| Customers | Rating card on a completed request (`/account/requests/[id]`) and a settled claim (`/account/claims/[id]`); summary on the broker picker (`components/marketing/quote-flow/broker-picker.tsx`) and the partner directory (`/partners`); explainer `/partners/how-we-score` |
| Brokers / insurers | `/partner/scorecard` (own card, trends, what would move it, reviews + one reply; insurers: appointed brokers' cards), `/partner/insights` (insurer monthly report, CSV + PDF at `/partner/insights/export`) |
| Staff | `/scorecards` (all brokers), `/scorecards/reviews` (moderation queue), `/analytics` (dashboards, rollup / backfill / dry run); setting `routing.scorecard_weight` in Settings |
| DB-rules test | `apps/web/tests/scorecards-rules.test.mjs` (tag `E2E-SCORE`; written, not run on the live project) |

## 2. Scorecard measures (per broker, rolling 30 and 90 days)

`public.broker_scorecard_inputs(broker, days)` (SECURITY DEFINER; broker members, insurers with an active
appointment, staff, service role) returns the raw measures; the server computes the card with
`computeScorecard` and stores it in `broker_scorecards` (one row per broker × window, refreshed nightly).

| Measure | Definition | Window filter |
|---|---|---|
| First response | Minutes from `requests.submitted_at` (customer's clock) to the broker's first visible message (`request_messages`, not internal), first broker timeline action (excluding offer accept/decline) or first quote; **median** | requests submitted in the window with the broker as broker of record |
| Quote fulfilment rate | Share of quote-flow requests (new cover, renewal, switch) that reached a binding quote (`ready_to_accept`, `accepted` or later `expired`); only requests that are closed or older than 3 days count | same |
| Time to a binding quote | Hours from submission to the first binding quote; median | requests with a binding quote |
| Issuance time | Hours from the last successful payment on the request to `policies.issued_at`; median | policies issued in the window, broker of record |
| Claims support | Hours from report to `acknowledged_at` and days from report to `paid_at`; medians | claims reported in the window with the broker as supporting broker |
| SLA breach rate | `sla_breached / sla_measured` with the same rule as `partner_sla_performance` (measured once completed or past due; breached when `sla_breached_at` is set or completed after `due_at`) | requests created in the window |
| Ratings | Average of **approved** reviews and their count | reviews created in the window |

Minimum samples: a component counts only with **5 measured items** (3 approved reviews for ratings).

## 3. Composite score (0–100)

Each component maps to 0–100 (piecewise linear, "lower is better" for times):

| Component | Weight | 100 points at | 0 points at |
|---|---|---|---|
| First response | 25 | ≤ 1 h median | ≥ 48 h |
| Quote fulfilment | 25 | 70 % × fulfilment rate + 30 % × time score (≤ 24 h → 100, ≥ 120 h → 0) | — |
| Policy issuance | 10 | ≤ 24 h | ≥ 7 days |
| Claims support | 15 | average of acknowledge (≤ 24 h → 100, ≥ 120 h → 0) and settle (≤ 14 d → 100, ≥ 60 d → 0) | — |
| Service levels | 10 | 0 % breached; `100 × (1 − 2 × breach rate)`, floor 0 (50 % breached = 0) | — |
| Customer ratings | 15 | 5.0 stars; `(avg − 1) / 4 × 100` | 1.0 stars |

Components without enough samples are left out and their weight is redistributed. The overall score is
**null until at least half of the total weight is backed by data** (band `new`). Bands: ≥ 85 excellent,
≥ 70 good, ≥ 50 fair, else needs attention. Suggestions ("what would move it") are the counted components
under 80 points, ordered by `(100 − points) × weight / counted weight`.

Trend on the broker page = 30-day score − 90-day score.

## 4. What customers see, and how

`public.broker_score_summary(uuid[])` and `public.broker_public_reviews(uuid, limit)` are callable by
anonymous visitors and return **only**:

* average rating (1 decimal) — only when there are **≥ 3 approved reviews** (all-time), else null + count;
* number of approved reviews;
* response-time band from the 90-day snapshot (`within_hour` ≤ 60 min, `same_day` ≤ 8 h, `next_day` ≤ 24 h,
  else `slower`; null under 5 measured requests);
* score band; and for reviews: stars, text, the broker's reply, dates, and the reviewer as
  "Ama K." (first name + last initial) or "Verified customer" (single names, business accounts, no name).

Never shown publicly: the numeric score, customer ids, contact details, request or claim references.
The summary is cached for an hour on the web app (`cacheTag("scorecards")`), invalidated by rating,
reply and moderation actions.

## 5. Ratings and reviews: rules

* One rating per **completed request** (status `completed`, broker of record set) or **settled claim**
  (status `paid` or `closed`, supporting broker set), by the customer on it (`broker_reviews` guard
  trigger). 1–5 stars, optional text ≤ 600 characters. The broker id is copied from the subject; a forged
  payload is overridden.
* New reviews are `pending`. Only platform staff (or the service role) move them to `approved` or
  `hidden`; hiding requires a reason (recorded on the row and in the audit log). Rating, text, subject
  and reviewer can never be edited; reviews are never deleted.
* Public = approved only. Customers see their own reviews in any state (with the state explained).
  Brokers see approved reviews of their own organisation. Insurers see none. Staff see all.
* The broker's team (owner, admin, supervisor, adviser) may post **one** reply (≤ 600 chars) per approved
  review. Replies are public.
* Hidden reviews still count toward the broker's private scorecard rating component (they were real
  experiences); they are simply not displayed. **Open question**: confirm with compliance whether hidden
  reviews should also be excluded from scoring.
* Audit: `broker_reviews` is audited through `private.write_audit_review`, which records changes but
  masks `customer_id`, `comment` and `reply` (broker admins can read audit rows for their organisation,
  and the reviewer must stay anonymous to them).

Moderation guidance for staff (proposal, to be signed off): hide reviews that name people, contain phone
numbers / emails / policy or claim numbers, are abusive, discriminatory, off-topic (about the insurer's
decision rather than the broker's service), or that we cannot tie to a real completed request. Approve
everything else, including negative ones.

## 6. Routing factor

`platform_settings.routing.scorecard_weight` (default **10**, 0 disables, capped at 100). In
`routeRequest` the candidate's 90-day score becomes `adjustment = (score − 50) / 50 × weight`, bounded to
± weight, and is **subtracted** from the routing score (lower is better). Priority still dominates
(default priorities differ by ≥ 10), secondary brokers stay last (+1000), and a broker **without a score
(new, or less than half the weight measured) gets 0: neutral, never penalised**. The decision's
`candidates` list keeps the adjusted score so a routing decision stays explainable. The weight needs a
business sign-off before launch.

## 7. Analytics layer (schema `analytics`)

`analytics.daily_facts`: one row per `day × category × region × broker × insurer` (null = not applicable)
with requests, quotes, binding quotes, conversions (applications accepted), policies issued, premium sum,
premium bands (`< 500`, `500–2k`, `2k–10k`, `> 10k` GHS), renewals due / renewed (by `cover_end`),
claims opened / settled (paid), payments succeeded / failed. Region is the Ghana region from the request
(`risk_data.region`) or the profile; nothing else about the customer is stored.

`public.analytics_rollup(from, to, dry_run)` (staff or service role) rebuilds each day in the range
(delete + insert; **idempotent**, verified by running it twice on local Postgres), logs a row in
`analytics.rollup_runs` (audited) and returns `{days, rows, ms}`. The cron `analytics-rollup` runs nightly
at 01:50 UTC for yesterday and today; backfill (≤ 400 days per call) and dry runs from admin → Analytics.
The schema is not exposed through PostgREST; staff read through `public.analytics_facts(...)` (group by
day / category / region / broker / insurer / total, optional filters).

`public.insurer_insight_report(insurer, 'YYYY-MM')` (members of the insurer via `partner_org_gate`, staff)
returns per category: quotes and policies won (mine / market / share), price position (median binding
quote vs market median; `below` / `in_line` / `above` with ±10 % tolerance), renewal retention (mine vs
market), claims opened / settled and median days to settle (mine vs market). **Every count under 5 is
suppressed (null, shown as "<5"); 0 stays 0; shares and medians built on suppressed counts are null.**
No broker or customer identity appears. Exported as CSV and PDF (`server/insight-pdf.ts`, pdf-lib, same
pattern as `pdf.ts`). "Market" means every participating insurer on Covva, never the whole Ghanaian market.

## 8. Access summary (proved on local Postgres per role)

| Role | broker_reviews | broker_scorecards | scorecard inputs | analytics_facts / rollup | insight report |
|---|---|---|---|---|---|
| anon | none (masked function only) | none (summary function only) | no | no | no |
| customer | own rows; insert on own completed subject | none | no | no | no |
| broker member | approved rows of own org; one reply | own org | own org | no | no |
| insurer member | none | appointed brokers | appointed brokers | no | own org, suppressed |
| staff | all; moderate | all | all | yes | any org |
| service role | all | write (refresh job) | all | yes | any org |

## 9. Open questions

1. Routing weight (`routing.scorecard_weight` = 10) and the component weights need business sign-off.
2. Moderation policy (section 5) needs compliance sign-off; decide whether hidden reviews count in scoring.
3. Minimum samples (5 / 3 reviews) are starting values; revisit after two months of data.
4. Review retention under Act 843: reviews are personal data of the reviewer; they should join the
   data-subject request workflow being built separately (export and delete on request).
5. Demo organisations: scores for demo brokers reflect demo data and are marked DEMO in the workspace;
   consider excluding demo organisations from the public summary before launch.
6. The explainer page should be reviewed by legal for the "not advice" wording.
