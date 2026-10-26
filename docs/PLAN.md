# Ghana Insurance Marketplace — Build Plan

Sources:
1. *Ghana Insurance Marketplace — Strategy & Operating Model* (Aug 2026)
2. *Insurance Marketplace — Partnership Proposal* (PDF, 20 Oct 2026)
3. *Insurance Marketplace — Presentation* (21 slides, 20 Oct 2026)

Design references: `docs/design/mockups/` (web home, compare, account, request
tracking, broker request queue, and the mobile screens).

Scope of this repo: marketing site, SaaS backend, customer web app, broker
"Partner workspace", insurer portal, platform administration portal, AI layer.
**Mobile app (iOS + Android) is built by a separate agent**; this repo provides
everything it needs (shared types, API, auth, push hooks, design tokens).

---

## 0. Design system (from the proposal mockups)

| Token | Value | Use |
|---|---|---|
| `brand` | `#00796E` | primary buttons, accents, "Move forward." headline, active nav |
| `brand-deep` | `#0F514D` / `#10665E` | policy hero cards, hover |
| `ink` | `#15343E` | headings |
| `ink-2` | `#26434C` | body strong |
| `muted` | `#486068` / `#6F858C` | body, captions |
| `line` | `#DCE3E1` | borders |
| `mint` | `#DCEEE4` / `#E7F3ED` / `#F1F7F3` | chips, secondary buttons, section backgrounds |
| `amber-bg` / `amber` | `#FFF0D6` / `#966E28` (`#D9B36A` accent) | "Awaiting document", "Renewal approaching", "At risk" |

* Type: clean grotesk sans (mockups render in an SF/Inter-like face) → **Inter** for UI,
  tight letter-spacing on large headlines.
* Logo: rounded-square teal tile with white "i" (shield variant in web nav).
* Shapes: 12–16px radii cards, 1px `line` borders, soft shadows only on floating cards.
* Status pills: mint = ok/active/ready, amber = waiting/at risk, grey = planned.
* Every demo surface carries "Illustrative only · Demo data" until live insurer agreements exist.

## 0.1 Product rules added by the proposal

* **Request is the core object.** Every request has an owner, category, required info, due date
  and visible status: `awaiting_customer_info → adviser_action → insurer_response →
  payment_confirmation → policy_documents → complete`. Overdue items escalate to named supervisors.
* **Quote states** shown to customers: `estimate`, `awaiting_underwriting`, `ready_to_accept`.
* **Category availability:** `integrated` (pilot, can compare & pay), `broker_assisted`
  (structured request + named adviser, no instant purchase), `planned` (labelled, not sold).
  A category goes live only when insurer panel, product-data owner, approved wording,
  quote method, payment route, issuance process and claims procedure are all recorded.
* **Fulfilment checkpoints:** confirm choice → verify payment → insurer issue → deliver documents.
  Payment confirmation alone never marks a policy active.
* **Uploads ≠ insurer notification** until delivery is confirmed; claim reporting ≠ approval.
* **Switch requests** start a review; existing cover is never cancelled before replacement
  acceptance, effective date and payment are confirmed.
* **Renewal review**: confirm what changed; renewal price range always labelled as estimate.
* **Broker messaging** is threaded per request, with documents in context.
* Health products need a separate product/regulatory assessment before being offered.

---

## 1. Guiding rules taken from the spec (these shape the code, not just the copy)

| Spec rule | How the platform enforces it |
|---|---|
| Platform is the technology provider, never insurer or broker | Every quote, checkout and policy screen renders a mandatory disclosure block built from the broker of record + insurer records. Copy never says "we insure". |
| One broker of record per transaction | `broker_of_record_id` is NOT NULL on quote requests once routed; changes require a consent record. |
| Broker disclosed before advice/application | `broker_disclosures` table stores when/how the broker was shown; application step is blocked until a disclosure row exists. |
| No duplicate submissions of the same risk to the same insurer | Unique `risk_fingerprint + insurer_id` submission registry. |
| Claims never shown as approved until the insurer confirms | Claim status transitions to `approved/paid` only from insurer-role users or insurer connector events (DB trigger enforced). |
| Platform never holds premium money | Payments are created as direct-to-insurer (provider sub-accounts / payment links). No platform wallet table exists. |
| Comparison integrity | Results show # of insurers and products compared, quote timestamp, binding vs estimate, paid placement shown separately, commission disclosure. Rates revalidated at checkout. |
| Auditable recommendations | Every recommendation stores inputs, products considered, scoring criteria, exclusions and explanation (`recommendation_runs`). |
| Broker data isolation | Postgres Row Level Security scoped by organisation; brokers see only their routed customers/quotes/commissions. |
| Tamper-evident audit trail | Append-only `audit_events` with hash chaining (each row stores hash of previous row). |
| Complex AI advice deferred | AI explains, summarises, extracts documents and drafts; it does not make suitability decisions. Broker review queue for complex cases. |

## 2. Architecture

```
apps/
  web/        Next.js (App Router) on Vercel
              ├─ (marketing)   public site: home, categories, how it works, brokers,
              │                insurers, about, regulatory/disclosures, help, blog
              ├─ (customer)    account, help-me-choose, compare, checkout,
              │                policy wallet, claims, complaints, renewals
              ├─ (partner)     broker console + insurer partner portal (Level-1 integration)
              └─ api/v1/*      versioned REST API (used by mobile + connectors + webhooks)
  admin/      Next.js platform administration portal (separate Vercel project,
              admin subdomain, MFA required)
packages/
  core/       domain types, zod schemas, status machines, comparison & routing
              logic, disclosure builders — shared with the mobile app
  db/         Supabase migrations, seed data, generated TS types
  ui/         shared design system (Tailwind + shadcn-style components)
  ai/         Vercel AI SDK + AI Gateway wrappers, prompts, tools, guardrails
  connectors/ insurer connector framework (portal / quote API / full policy API)
supabase/     config, migrations (symlink of packages/db), edge functions
docs/         plan, architecture, API reference, mobile integration guide
```

* **Database/Auth/Storage/Realtime:** Supabase (Postgres 17, RLS everywhere, Storage for
  policy docs & claim evidence, Realtime for status updates).
* **Hosting:** Vercel (two projects: `web`, `admin`), Turborepo, pnpm.
* **AI:** Vercel AI SDK through **Vercel AI Gateway** (single key, model fallback,
  usage tracked per organisation for billing).
* **Payments:** pluggable provider adapter (Paystack / Hubtel / Flutterwave), mobile money + card,
  settlement direct to insurer.
* **Messaging:** email (Resend), SMS (Ghana provider adapter), WhatsApp later.
* **Background jobs:** Vercel Cron + Supabase queues (pgmq) for quote expiry, renewal reminders,
  connector retries, SLA timers.

## 3. Data model (first cut)

Tenancy & identity: `organizations` (type: platform | broker | insurer | enterprise),
`memberships` (role per org), `profiles`, `kyc_verifications` (Ghana Card), `consents`.

Catalogue: `product_categories`, `products`, `product_versions` (approved wording,
rates, limits, excesses, exclusions, waiting periods — versioned, approval required),
`broker_routing_rules`, `insurer_broker_appointments`.

Transaction flow: `needs_assessments`, `recommendation_runs`, `requests` (owner, status,
due_at, SLA), `request_messages`, `request_tasks` (e.g. "vehicle document needed"),
`switch_requests`, `quote_requests`
(risk data in common internal format), `broker_disclosures`, `insurer_submissions`
(dedupe registry), `quotes` (binding/estimate, valid_until), `applications`
(declarations, acceptance), `payments` (provider refs, status, reconciliation),
`policies`, `policy_documents`, `renewals`.

After-sale: `claims`, `claim_documents`, `claim_events`, `complaints`
(SLA deadlines, escalation), `notifications`.

SaaS: `plans`, `subscriptions`, `usage_events` (per-transaction technology fees,
AI usage), `invoices`, `api_keys`, `webhooks`, `connector_configs`.

Governance: `audit_events` (hash-chained), `feature_flags`, `platform_settings`.

## 4. Portals and who uses them

| Portal | Users | Key screens |
|---|---|---|
| Marketing site | public | home, per-category landing pages, how it works, compare-entry, brokers & insurers partner pages, regulatory disclosures, help centre, contact |
| Customer app | individuals, SMEs | onboarding+consent, help-me-choose wizard, compare results, checkout, policy wallet, claims, complaints, renewals, AI assistant |
| Broker console | broker staff | routed request queue, adviser review, quote building, insurer submissions, customers, renewals, claims assistance, complaints, commission reports, billing |
| Insurer portal | insurer staff | incoming submissions, return quotes, accept risk, upload/issue policies, claim status updates, product data management, API keys |
| Admin portal | platform staff | orgs & licence verification, product approval, routing rules, users, KYC review, payments reconciliation, complaints oversight, audit log viewer, plans & billing, AI usage, feature flags, system health |

## 5. Stages

| Stage | Deliverable |
|---|---|
| **0. Foundations** | Monorepo, tooling, CI, Supabase project, Vercel projects, env layout, design system |
| **1. Data & security** | Full schema, RLS, audit chain, seed data (categories, demo brokers/insurers/products) |
| **2. Marketing site** | All public pages, SEO, category landing pages, partner lead forms |
| **3. Customer journeys** | Auth (phone OTP + email), consent, help-me-choose, compare, checkout, wallet, claims, complaints |
| **4. Partner portals** | Broker console + insurer portal (Level-1 integration) |
| **5. Admin portal** | Platform administration as above |
| **6. AI layer** | AI Gateway, assistant, document extraction, product summaries, claim completeness checks, admin insights |
| **7. SaaS & billing** | Plans, subscriptions, usage metering, invoices |
| **8. Integrations** | Payment adapter, SMS/email, Quote API connector contract, webhooks |
| **9. Mobile enablement** | `/api/v1` OpenAPI spec, shared `@gim/core` package, push token registration, deep links, mobile guide |
| **10. Hardening** | Tests, advisors, rate limits, observability, deployment |

## 6. Mobile app hand-off (what this repo guarantees)

* Supabase Auth works identically from mobile (phone OTP, email) — same project, same RLS.
* `packages/core` publishes types, zod schemas, status enums and disclosure builders.
* `/api/v1` REST endpoints for anything requiring server logic (quoting, checkout, AI),
  documented in `docs/api/openapi.yaml`.
* `device_tokens` table + notification fan-out for push (Expo push supported).
* Universal-link config (`/.well-known/apple-app-site-association`, `assetlinks.json`).
* `docs/MOBILE_INTEGRATION.md` describing env vars, auth flow, endpoints and realtime channels.
