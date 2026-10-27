# Covva — codebase audit, phased roadmap and master checklist

Status: v1, 26 October 2026. Source briefs: `docs/requirements/` (the build prompt and Addenda 1–6; later addenda
take precedence). Tick boxes are the working checklist; `[x]` = built and tested, `[~]` = partly built, `[ ]` = to do.

---

## Part 1 — Audit of what exists today

### 1.1 Architecture
| Layer | What is there | Assessment |
|---|---|---|
| Monorepo | pnpm + Turborepo. `apps/web` (marketing site, customer app, partner workspace, `/api/v1`), `apps/admin` (platform console), `packages/core` (domain logic + zod API contracts), `packages/db` (generated Supabase types), `packages/ui` (design system), `packages/tokens` (brand tokens + logo files). `apps/mobile` is owned by a separate agent. | Sound. API-first is partly true: the web app's own screens use Server Actions, while mobile uses `/api/v1` (37 paths). Keep both; move shared business logic into `apps/web/src/server/*` services (already the pattern). |
| Framework | Next.js 16.4 (Cache Components, Partial Prefetching), React 19, Tailwind v4, Vercel. Two Vercel projects (web, admin). | Modern; Lighthouse-friendly (static shells, streamed data). |
| Data | Supabase Postgres 17 in London. 40 tables, Row Level Security on every table, business rules enforced by triggers, hash-chained append-only audit log, Storage buckets (`documents` private, `org-assets` public), Realtime on requests/quotes/messages/notifications. | Strong foundation. Multi-tenant via `organizations` + `memberships` (org types: platform, broker, insurer, enterprise). |
| Auth | Supabase Auth: email+password, magic link, phone OTP; TOTP MFA enforced in the admin console only. Roles live on `memberships.role` (12 roles across org types). | Needs: MFA for broker/insurer users, device/session management, insurer-blocked-on-mobile rule, "switch workspace" for dual-role users (Addendum 4). |
| Payments | Paystack adapter (`server/payments.ts`): initialise, direct MoMo charge, webhook (HMAC verified), verify, refund. **Premiums settle to the insurer's subaccount with `bearer: subaccount`** — the platform never holds funds (also enforced by a DB trigger: `payee_org_id` must be an insurer). Simulator for sandbox. | Split payment exists in a two-party form (insurer subaccount + Paystack fees). Needs a three-party split (insurer / broker / Covva fee) and a ledger. |
| Notifications | `server/notify.ts`: in-app + email (Resend) + SMS (Arkesel/Hubtel/log) + Expo push; preferences per user; deep-link mapping for mobile. | Abstraction exists. WhatsApp is missing. |
| AI | Vercel AI SDK v7 via AI Gateway: customer assistant (tools, RLS-scoped), broker copilot, document extraction, claim-completeness check, quote summary; guardrails + PII stripping; usage logged to `ai_usage`. | Good base for the "policy explainer" (Addendum 6.3) — needs grounding on the customer's actual wording. |
| Integrations | Insurer connector framework: `organizations.integration_level` (portal / quote_api / policy_api), `connector_configs`; partner API keys (hashed, scoped); outbound webhooks (signed, retried by cron). | Only Level 1 (portal) is live; the quote/policy API levels are modelled but have no adapter. |
| Jobs | 7 Vercel crons: renewal reminders, SLA monitor, quote expiry, policy lifecycle, usage metering, complaint SLA, webhook retry. | Fine; needs instalment collection + SLA escalation jobs later. |
| Tests/CI | 60 unit tests (rating, comparison, needs, routing, risk schema, statuses), 18 database-rule tests run as real users, 63 + 33 Playwright browser tests, GitHub Actions workflow. | Good coverage of the rules that matter; payment-split and routing-claim tests to add with those features. |
| Brand | Canopy C logo files, Outfit/Inter, palette tokens; applied across web, admin and emails. | Done. Addendum 5's colour/font suggestions are overridden (see correction). |

### 1.2 Data model (today)
`organizations`, `memberships`, `invitations`, `profiles`, `consents`, `kyc_verifications` ·
`product_categories` (with `risk_schema`, `availability`, launch checklist), `products`, `product_versions` (coverage, limits,
excesses, exclusions, waiting period, optional benefits, `rating` JSON rules, approval fields), `insurer_broker_appointments`,
`broker_routing_rules` · `needs_assessments`, `recommendation_runs` · `requests` (the core operational object: owner, SLA,
status machine, broker of record), `broker_disclosures`, `request_events`, `request_tasks`, `request_messages`,
`insurer_submissions` (dedupe registry), `quotes` (estimate / awaiting_underwriting / ready_to_accept, validity),
`applications`, `payments`, `policies`, `documents` · `claims`, `claim_events`, `complaints`, `complaint_events` ·
`notifications`, `device_tokens` · `plans`, `subscriptions`, `usage_events`, `invoices`, `api_keys`, `webhook_endpoints`,
`webhook_deliveries`, `connector_configs` · `ai_threads`, `ai_usage` · `leads`, `feature_flags`, `platform_settings`,
`audit_events`.

### 1.3 What is built and verified
- [x] Marketing site (≈20 pages), SEO routes, enquiry forms → `leads`.
- [x] Customer app: sign-in/up, onboarding + consents, needs assessment, dynamic quote request forms with device drafts, request tracker (live), quote comparison with explained labels, checkout (broker disclosure → declarations → payment), policy wallet, renewal review, external policies, messaging, documents, claims, complaints, profile, AI assistant, notifications.
- [x] Partner workspace: broker request queue (SLA, owners, buckets), request workspace (tasks, submissions, quotes, messages, uploads on behalf, hand-over), customers, quotes, policies + renewal pipeline, service & claims, reports + CSV, settings (team, invites, billing, API keys, webhooks); insurer portal (submissions, issuance, claims decisions, products with test pricing, connector settings).
- [x] Admin console: KPIs, organisations (licence verification, due diligence), users, KYC review, categories with launch gate + risk-schema editor, product version approval with diff + test pricing, routing rules + simulator, appointments matrix, requests oversight, payments reconciliation, policies, claims, complaints, plans/subscriptions/usage/invoices, leads, AI usage + insights, feature flags, settings, audit log + chain verification, system health, MFA.
- [x] API v1 (customer + partner), OpenAPI 3.1, mobile integration guide, deep links, `.well-known` app links.
- [x] Database invariants proven end-to-end: disclosure before application, premiums to insurer only, insurer-only issuance (needs policy number), insurer-only claim decisions, no duplicate insurer submissions, customers limited to renaming policies.

### 1.4 Where the new briefs change the model (decisions)
| Topic | Today | Required (precedence: Addendum 2/3/4) | Decision |
|---|---|---|---|
| Who fulfils an order | Always a broker of record, assigned by routing rules at request time. | Direct-to-insurer when the insurer is connected (L2/L3 or L1 direct); broker "claim" model with acceptance timeout otherwise; broker always for advice/complex risks; insurer-nominated brokers; broker-sourced clients stay with their broker. | Replace the assign-at-creation routing with a **routing engine** producing an `order_routing` record (mode: `insurer_direct` / `broker_pool` / `broker_fixed`), a claimable **offer** to eligible brokers with timeout + re-route, and full decision logs. Keep `requests.broker_org_id` as the *current* broker of record once claimed. The "one broker of record per transaction" rule from the strategy doc still holds for broker-fulfilled orders; insurer-direct orders have none and the disclosure says so. |
| Catalogue ownership | Products belong to insurers; brokers can't edit. | Same, plus broker-submitted pending rate tables, CSV/Excel import, rules editor, document templates, scheduled price changes, compliance review workflow. | Extend `product_versions` (rate tables, underwriting rules, templates, issuance type/SLA) rather than replace. |
| Insurer integration levels | One level per insurer org. | Level per insurer **per product line**; L2 delegated issuance with number blocks, templates, review window, NIC motor database registration; L3 adapters. | New `insurer_line_integrations` table; `policy_number_blocks`; `issuance_jobs`; adapter interface in `packages/connectors`. |
| Partner onboarding | Admin creates organisations; invites exist. | Open self-service registration for insurers and brokers, document uploads, e-signature, admin verification, appointment requests approved by insurers, partnerships CRM. | New `partner_applications`, `appointment_requests`, `crm_*` tables; public registration routes; feature-flagged. |
| Access model | Partner workspace for brokers+insurers in one app; insurer features reachable from mobile API in principle. | Brokers: mobile + web; insurers: web only (mobile sign-in blocked with message); internal: web; customers: both. MFA for all non-customers; device management. | Enforce in `/api/v1` auth (insurer memberships rejected on mobile clients), add MFA gate to partner workspace, add `sessions/devices` UI via Supabase Auth sessions. |
| Revenue | Platform fee via subscription + usage; premiums to insurer only. | Per-broker model (revenue share vs subscription); Covva-sourced vs broker-sourced; three-way split at checkout; statements per period. | Add `policies.source` (`covva` / `broker`), `org_commercial_terms`, `payment_splits`, `ledger_entries`, `settlement_statements`. Paystack supports a single subaccount per transaction, so a three-way split needs Paystack **split groups** (multi-subaccount) or Hubtel; see dependencies. |
| Diaspora | Not modelled. | Sponsor–beneficiary, multi-currency card/Apple/Google Pay, FX display, recurring sponsor payments, gifts, proxy claims, bundles, property cover with inspections, groups. | New `households`/`beneficiaries`/`sponsorships` model; a second PSP for GBP/USD/EUR/CAD cards that can still settle in GHS to the insurer (Paystack international cards settle in GHS; Apple/Google Pay via Paystack where enabled). |

---

## Part 2 — Phased roadmap and master checklist

Phases follow the build prompt's order, with Phase 0 for the model changes everything else depends on. Every item from the
briefs is listed once, under the phase where it is delivered. Items already built are ticked.

### Phase 0 — Model changes and platform guardrails (prerequisite, ~1 sprint)
**Routing engine (Addendum 2 D)**
- [x] `insurer_line_integrations` (insurer × category → level L1/L2/L3, `direct_sales` flag, SLA hours, issuance type, nominated broker ids), admin + insurer UI.
- [x] `order_routing` + `order_offers`: routing decision per request (mode, candidates, reasons, timeout), offer records per eligible broker, accept/decline, re-route on expiry (cron), audit of every decision.
- [x] Broker eligibility = verified appointment for insurer × line (Addendum 2 C4, 3 C2).
- [x] "Talk to an expert" flag and complexity thresholds (fleet size, commercial property, marine, group size) → broker route regardless of insurer.
- [x] Insurer-nominated brokers; broker-sourced clients stay with their broker (`customer_broker_assignments`).
- [x] Lightweight accept: signed one-tap accept links in SMS/WhatsApp/push (Addendum 2 E, 4.2).
- [x] Unit tests for routing decisions and timeout re-routing.

**Catalogue extensions (Addendum 2 B, 3 B3)**
- [x] Rate tables as first-class data (`rate_tables`, `rate_rows`) with CSV import + validation templates (Excel: export to CSV first); the existing `rating` JSON stays as one rule type and a `rate_table` model delegates to the table.
- [x] Underwriting rules editor (accept / refer-to-L1 / decline) and the "fits delegated issuance rules" check.
- [x] Document templates (schedule, certificate, sticker, receipt) per product version; template approval in admin.
- [x] Issuance type + SLA per product ("Instant" / "Issued within X hours") shown before payment (Addendum 2 G).
- [x] Scheduled price changes with effective dates (`price-schedule` cron promotes them); existing quotes/policies keep their version.
- [x] Broker-submitted pending rate tables for insurers not yet on Covva (creates a partnerships lead). Attaching an approved proposal to the insurer's product once they join still needs an admin action.
- [ ] Launch insurer seed: load one real insurer's catalogue (needs their product data — see dependencies).

**Commercial terms and ledger (Addendum 2 F)**
- [x] `org_commercial_terms` (broker: revenue share % or subscription; insurer: fee/commission %), `policies.source`, `payment_splits`, append-only `ledger_entries`, fee transparency on quotes and at checkout.
- [x] Three-party split at checkout via a Paystack split group when configured (`PAYSTACK_SPLIT_GROUP_CODE` or `organizations.paystack_split_code`); otherwise the single insurer subaccount with broker/Covva shares settled by statement. Refund ledger entries post on `refundPayment()`; Hubtel is the second provider (Phase 1).
- [x] Settlement statements per broker/insurer per period (monthly cron, admin issue/mark paid, CSV export). Statement PDFs and subscription-invoice linkage still to do.
- [x] Tests for split calculations.

**Access, auth and transparency (Addendum 4, 2 G)**
- [x] MFA enforced for broker and insurer users (partner workspace gate like the admin console).
- [x] Session/device list and remote sign-out for broker/insurer accounts.
- [x] Insurer users blocked from the mobile API with a clear message; broker/customer workspace switch for dual-role users (API + mobile guide).
- [x] Every quote/policy shows insurer, broker (if any), issuance type, expected time, and complaints contacts.
- [x] Covva never described as broker/insurer; mandatory disclosure on every transaction.

### Phase 1 — Catalogue, quote, routing, MoMo + split payments, wallet, renewals
**Fast onboarding and quoting**
- [x] Needs assessment, dynamic risk forms, estimates from approved rates, explained comparison.
- [x] Vehicle lookup by registration (DVLA/partner API) to prefill motor quotes; "motor quote in under 2 minutes" flow with a 3-field start (`vehicle_lookups` cache + DVLA stub behind `DVLA_API_URL`; "Talk to an expert" checkbox on the form).
- [~] Ghana Card (NIA) verification via a provider (manual admin review stays as fallback) — provider hook (`IDENTITY_PROVIDER=nia`, NIA stub) wired into the profile KYC flow; live credentials pending.
- [x] Save and share quotes (link, WhatsApp, email); resume later (`quote_shares`, public `/q/<token>`, `POST /requests/{id}/share`).
- [x] Honest copy when only one insurer is quoting ("1 insurer compared").

**Insurer Level 1 and Level 2**
- [x] Level 1 insurer portal (queue, approve/decline, upload documents, customer receives them).
- [x] Level 2 delegated issuance: policy-number blocks, approved templates, instant PDF generation (schedule, certificate, sticker), insurer review window with endorse/cancel, auto-refer outside rules. (`20261028100200_issuance.sql`, `server/issuance.ts`, `server/pdf.ts`, partner Issuance → Delegated issuance + number blocks.)
- [x] NIC motor insurance database registration (API or hand-off) with status tracking. (`NIC_MOTOR_DB_MODE`, `packages/core/src/connectors.ts`, `issuance_jobs.nic_registration`; only the simulator adapter exists.)
- [x] SLA timers per insurer/product with escalation (insurer contacts → Covva ops) and the customer's choice of refund or re-route on final breach. (`sla_timers`, `server/sla.ts`, `sla-monitor` cron, request page choice.)
- [x] Stage + expected time always shown (no open-ended "processing"). (Request tracker shows "Expected by …" from the open SLA timer.)

**Payments**
- [x] MTN MoMo, Telecel Cash, AirtelTigo Money, cards via Paystack; webhook; refunds; premiums settle to the insurer.
- [x] Bank transfer channel (insurer account or Paystack dedicated virtual account; admin reconciliation confirms); Hubtel as a swappable second provider behind the payment abstraction (`PAYMENT_PROVIDER` / per-insurer).
- [~] Three-way split live (from Phase 0) and payment ledger exports (partner ledger CSV at `/partner/settlements/export`; split group still needs Paystack configuration per insurer).

**Policy wallet**
- [x] All policies, documents, renewal dates, external policies, nickname, broker contact.
- [x] Generated PDFs (schedule, receipt, certificate) with QR; motor sticker in wallet.
- [x] Public **verify a policy** page (QR / policy number) and verification API. (`verify_policy` RPC, `/verify`, `GET /api/v1/verify`.)
- [ ] Family/household view (ties into diaspora model).

**Renewals**
- [x] Reminder schedule (45/30/14/7/1), renewal review, broker renewal pipeline.
- [x] One-tap renewal with refreshed quotes and switch-insurer option (broker of record kept); WhatsApp reminders (opt-in, SMS fallback).
- [x] Underinsurance nudges on value changes (`policy-lifecycle` cron, `policies.underinsurance_flag`, policy page nudge).

**Partner self-service (Addendum 3) — needed for the launch partner**
- [x] Public "Partner with Covva" pages for insurers and brokers with register / request-a-call CTAs (callback → CRM lead via the `leads` trigger).
- [x] Insurer registration (company, NIC licence + class, address, contacts, settlement account, documents, in-app e-signature of the partner agreement, integration level per line) → admin verification (manual NIC register confirmation) → live. External e-signature provider still to add.
- [x] Broker registration (same pattern + commercial model choice) → verification; licence expiry tracking and auto-suspend (`licence-status` cron).
- [x] Appointment requests broker → insurer approval per line; appointment-letter upload for insurers not on Covva; revoke removes eligibility immediately.
- [~] Insurer roles (Admin, Product Manager, Underwriter, Claims, Finance, Read-only) and broker roles (Admin, Account Executive, Claims, Finance, Read-only); MFA; audit. (Roles + MFA done — `packages/core/src/roles.ts`, `/partner/mfa`; audit coverage of role changes pending.)
- [~] Insurer self-service product management: create products by line, rate-table builder/import, rules editor, templates, quote simulator, approval workflow (Draft → Submitted → Compliance review → Published) done in Phase 0; pause/withdraw exists; bulk updates and a change-history view still to do.
- [x] Insurer dashboard (sales, conversions, issued, renewals, lapses, claims, SLA, settlements) + broker dashboard, reports CSV, activity tab.
- [x] Partnerships CRM in admin: leads/accounts, pipeline stages, notes/meetings/tasks/reminders, attachments, owner; auto-leads from forms and "suggest an insurer"; assisted onboarding (rep pre-fills, partner confirms via the in-app agreement signature); onboarding checklist; mobile-friendly rep view; dashboards.
- [x] Broker bulk import of existing clients and policies; account-manager assignment; "assisted service" flag.
- [x] Feature flags gating self-service registration (`partner_self_service_insurer` / `partner_self_service_broker`).

**Tests:** quote calculations per rating model, split calculations, routing (direct / pool / fixed / advice), SLA escalation.

### Phase 2 — Claims, diaspora core, WhatsApp
**Claims**
- [x] In-app claim with photos, location, police report; routed to broker/insurer; status timeline; insurer-only decisions.
- [x] Video upload (≤ 90 s); in-claim messaging thread with internal partner notes; information requests the customer fulfils; notifications at every stage (report, messages, info requests, evidence, jobs); customer timeline with expected times.
- [x] Fraud checks: duplicate claim, document reuse, identity mismatch, policy inactive at incident, late report, repeat claimant — `claim_fraud_flags` + `run_claim_fraud_checks`, insurer/staff review (web claims desk, admin `/claims/fraud`).
- [x] Claims page on the marketing site (steps, timelines) plus a public partner network directory at `/claims/network` (approved garages, towing, hospitals; direct-billing insurers).

**Diaspora core (priority)**
- [x] Sponsor accounts (country, currency, timezone at sign-up/profile); beneficiaries with consent captured by SMS/WhatsApp OTP or a signed `/consent/<token>` link (5-attempt lock); `sponsorships` linking payer ↔ policy ↔ beneficiary; auto-link when the beneficiary signs up with the same phone.
- [x] Multi-currency checkout (GBP, USD, EUR, CAD) with transparent FX disclosure; the contract and settlement stay in GHS to the insurer. FX rates are manual until a provider key is set; the Stripe path is off pending legal review.
- [x] Family dashboard (web `/account/family` + `/api/v1/family/*`): members and consent, policies paid for, renewals, payment schedule, claims.
- [x] Dual notifications (sponsor + beneficiary) for issuance, renewal reminders and claims (`notifyPolicyParties`); unrevealed gifts stay silent.
- [x] Recurring sponsor payments (monthly/quarterly/annual) on a saved card with retries, past-due handling and grace days (`sponsor-collections` cron).
- [x] Gift a policy with a personal message and reveal page; claims by proxy with the beneficiary's `proxy_claims` consent.
- [x] Diaspora page on the marketing site with currency switcher and stories; Parents' Care Pack bundle page; property cover with photo updates and partner inspections.

**WhatsApp**
- [x] WhatsApp Business channel: notifications (renewals, documents, claims), quote links, payment links; one-tap broker accept; chat button on every page with AI FAQ handoff to a human/broker (`wa_*` tables, `server/whatsapp/*`, admin `/whatsapp`, partner `/partner/whatsapp`, `/api/webhooks/whatsapp`, `/api/ai/faq`; Twi/Ga/Ewe replies still to come).

### Phase 3 — Instalments, USSD, embedded partners, SME
- [x] Instalment premiums (monthly/quarterly): schedules from the insurer's plan, automated collections (saved card, MoMo prompt or pay link) twice daily, retries (day 0, +2, +5), grace, lapse and reinstatement (insurer review where the plan requires it); every instalment is a premium payment to the insurer with ledger entries.
- [x] USSD flow: basic quote, renew, pay (aggregator-dependent) — provider-agnostic engine (`server/ussd/*`, Africa's Talking / Hubtel / Arkesel adapters, `/api/ussd/{provider}`), quote / renew / pay instalment / check policy / claim callback / talk to us, ≤ 160-char screens; admin `/ussd` simulator + session log. Go-live needs an aggregator account and the NCA short code.
- [x] Embedded distribution: partner API (`/api/v1/distribution/*`, `distribution:*` scopes) + embeddable quote widget (`/embed/quote`, `widget.js`, per-partner `frame-ancestors`); distributor workspace with referral tracking and revenue share (from Covva's fee only); customer referral page. Customer referral rewards are seeded **off** pending NIC/insurer approval.
- [x] SME & group: business accounts (owner/admin/finance/viewer), bulk member and fleet CSV upload, group schemes, fleet, property and liability quotes (always broker-routed; census counts only in risk data), consolidated monthly statements paid per insurer, business dashboard, broker "Business clients" view.
- [x] Micro and on-demand insurance: day/week/month periods on product versions, period pricing, 3-tap purchase, one-tap renew and auto-renew, public `/micro` page; insurer-direct sale for instant products.
- [~] Local language UI (English, Twi, Ga, Ewe) with a translation layer; language switcher on the site; voice-note capture with transcription for quote help and claims — layer (`@im/core` i18n, `translations` table, admin `/translations`, `GET /api/v1/i18n/{locale}`), header switcher and voice notes done; Twi/Ga/Ewe strings still need human translators (nothing is machine-translated).
- [x] Post-claim partner network: directory, direct billing per insurer, job tracking, public self-onboarding (`/claims/network/join` → admin review) and customer ratings (shown from 3 reviews, staff moderation).
- [x] Endorsement workflows: structured changes per category (vehicle, drivers, address, sum insured, members, use, cancel), pro-rata premium adjustments, insurer-only accept/apply, regenerated documents, additional premium settles to the insurer.
- [x] Accounting exports: insurer statements, commission and tax reports, Xero / QuickBooks / Sage CSV (monthly cron + on demand). Tax and levy rules are seeded with **no rates** (`needs_confirmation`) until finance confirms them.

### Phase 4 — Scorecards, analytics, advanced diaspora, retention
- [x] Broker scorecards (response, fulfilment, claims support, ratings/reviews) feeding routing priority and shown to customers. Measures (`broker_scorecard_inputs`), reviews with moderation and one broker reply (`broker_reviews`), nightly snapshots (`broker_scorecards`, cron `scorecard-refresh`) in migration `20261031100400_scorecards_analytics.sql` (not applied yet); formulas, bands and the bounded routing factor (`routing.scorecard_weight`, new brokers neutral) in `@im/core` `scorecards.ts` / `routing.ts`; server `server/scorecards.ts`; customers rate on `/account/requests/[id]` and `/account/claims/[id]` and see the anonymised summary on the broker picker, `/partners` and `/partners/how-we-score`; brokers `/partner/scorecard`; staff `/scorecards`, `/scorecards/reviews`. Docs: `docs/SCORECARDS_ANALYTICS.md`.
- [x] Analytics warehouse (quotes, conversions, pricing, renewals, claims), internal dashboards, anonymised insurer insight reports. In-database layer: schema `analytics` (`daily_facts`, `rollup_runs`), idempotent `analytics_rollup` with backfill and dry run (cron `analytics-rollup`), staff `analytics_facts`, insurer `insurer_insight_report` with small-cell suppression (same migration); server `server/analytics.ts`, `insight-pdf.ts`; admin `/analytics`; insurer `/partner/insights` with CSV/PDF export. Docs: `docs/SCORECARDS_ANALYTICS.md`.
- [ ] Advanced diaspora: bundles ("Parents' Care Pack"), property cover for homes being built with partner inspections and photo updates, group plans for associations/churches/alumni, remittance/diaspora-bank partner APIs.
- [ ] Funeral cover and welfare groups: group admin, member enrolment, contribution collection, beneficiary records, claims support; linked to sponsors abroad.
- [ ] Loyalty and rewards: no-claims rewards, bundle discounts, referral credits, renewal perks; per-insurer rules engine.
- [ ] Motor telematics: consented phone-based driving score; safe-driver discounts at renewal where supported.
- [x] Policy explainer AI grounded in the customer's own wording and schedule, citing clauses, handing off advisory questions to the broker. Grounding, clause ids, citation checks and advice heuristics are in `@im/core` `policy-explainer.ts`; the server is `server/ai/policy-explainer.ts`; the API is `POST /api/v1/me/policies/{id}/explain`; the UI is the "Explain my policy" panel on `/account/policies/[id]`. Cached summaries and the Q&A log are in migration `20261031100200_policy_explainer.sql` (not applied yet). It works without an AI key: clause browser, keyword matches and broker hand-off. Docs: `docs/POLICY_EXPLAINER.md`.
- [ ] Insurer Level 3 adapters (one per insurer behind the common interface) as partners expose APIs.

### Marketing site (Addendum 5, brand correction applied) — runs alongside Phases 1–2
- [x] Home, product pages, how it works, brokers/insurers pages, trust, support, legal, partner directory; SEO routes; JSON-LD; forms → leads.
- [x] Hero instant-quote widget (type → registration/few details → quotes) on home and every product page; price-range teaser.
- [x] Trust bar (partner logos, "Licensed partners only", MoMo/Telecel/AirtelTigo/Visa/Mastercard, security badges); stats counter (placeholder values); illustrative testimonials; app badges + QR; smart app banners (env-gated).
- [x] Diaspora page; Business/SME page refresh; Claims page; Verify-a-policy page (+ public verify API); Embedded-partner page; Learn hub (English now, Twi/Ga/Ewe switcher shows "coming soon"); referral page; waitlist + "launch partner" forms; press kit.
- [x] Renewal-reminder sign-up (pre-purchase lead capture); WhatsApp button (env-gated); language and currency switchers.
- [ ] Headless CMS (pages, articles, FAQs, testimonials, partner logos) — proposal: Sanity or Payload; decision needed.
- [x] Act 843 consent banner with separate analytics / marketing choices and "change your choices" on the cookie notice; consent-gated GA4 (Consent Mode v2), Meta and TikTok pixels (`NEXT_PUBLIC_META_PIXEL_ID`, `NEXT_PUBLIC_TIKTOK_PIXEL_ID`); conversion events (`quote_start`, `generate_lead`, `app_store_click`, `whatsapp_click`) through one `track()` helper. (`components/marketing/analytics.ts`, docs: `docs/MARKETING_SITE.md`.)
- [x] A/B testing hooks: experiment registry, sticky `covva_exp` assignment, `NEXT_PUBLIC_EXPERIMENTS` switch, `?exp=` QA override, exposure events; first experiment `home_hero_headline` registered (off by default). (`components/marketing/experiments.ts`, `experiment.tsx`.)
- [x] Lighthouse run on the production build (mobile): results and follow-ups in `docs/MARKETING_SITE.md`.
- [ ] Imagery: real Ghanaian photography + custom "how it works" illustrations (assets needed from you).

### Cross-cutting (every phase)
- [x] RBAC, audit log, encryption, secure document storage, rate limiting, feature flags, consent capture.
- [ ] Data-subject requests (export/delete) workflow; retention jobs (Act 843).
- [~] Notification abstraction gains WhatsApp (done); payment abstraction gains Hubtel (done) and a diaspora card PSP (to do).
- [ ] Tests added with every feature; CI gates merges.

---

## Part 3 — Assumptions, regulatory dependencies and credentials needed

| Item | Why it blocks | Needed from you / third party |
|---|---|---|
| **Launch insurer** | Phase 0/1 seed and L2 rules need real products, rates, wording, templates, number blocks. | Name the partner; their product/rate data (CSV/Excel), approved document templates, settlement account, integration level per line. |
| **NIC classification** | Direct-to-insurer sales and delegated issuance (Covva issuing on the insurer's behalf) may need NIC clearance (technical service provider / innovative intermediary). Self-service registration is flag-gated for this reason. | Written NIC guidance; until then, keep broker-fulfilled routing as default. |
| **NIC register / motor database** | Licence verification and motor policy registration. | Confirm whether an API exists; otherwise manual verification stays and motor registration is a hand-off to the insurer. |
| **Paystack** | Live MoMo/cards; three-way split needs split groups enabled on your account; refunds; international cards for diaspora. | Live secret key, subaccounts per insurer/broker, split-group feature, webhook secret. |
| **Hubtel (optional)** | Second provider, USSD + SMS. | Client id/secret, USSD short code. |
| **Diaspora card PSP** | Apple Pay / Google Pay in GBP/USD/EUR/CAD. Paystack supports international cards (settles GHS); Apple/Google Pay availability to confirm, else Stripe for sponsors with payout to Covva's GHS collection account — which would breach "never hold premiums" unless structured as a collection-on-behalf arrangement. **Needs a legal view.** | Decision + credentials. |
| **FX source** | Transparent GBP/USD/EUR/CAD → GHS display. | Rate provider (e.g. Open Exchange Rates) key, or the PSP's rate. |
| **WhatsApp Business** | Notifications, links, chat. | Meta WhatsApp Cloud API (or Twilio) credentials, approved message templates, verified business. |
| **SMS** | OTP, alerts. | Arkesel/Hubtel key; Supabase Auth SMS provider for phone OTP. |
| **Ghana Card (NIA)** | Identity verification. | NIA-accredited verification partner credentials. |
| **DVLA vehicle lookup** | Registration-number prefill. | Confirm availability/partner; otherwise manual entry stays. |
| **E-signature** | Partner agreements. | Provider (e.g. DocuSign/Dropbox Sign) or a built-in click-to-sign with audit trail (recommended for cost). |
| **Email** | Resend key + domain DNS for covva.com.gh. |
| **AI Gateway** | All AI features. | Vercel AI Gateway enabled; model ids confirmed. |
| **CMS** | Marketing editing without developers. | Choice of Sanity/Payload + account. |
| **App stores** | Badges, smart banners, app links. | Apple team id, bundle id, Android package + signing fingerprints (mobile agent). |
| **Analytics** | GA4 property, Meta/TikTok pixel ids. |

Assumptions made: Paystack remains the primary PSP; split settlement uses PSP subaccounts so Covva never holds premiums;
customers in Ghana pay in GHS; diaspora prices are displayed in foreign currency with the GHS amount shown as the legal
premium; "Covva-sourced" means the customer's first contact with the broker was through Covva; broker acceptance timeout
defaults to 30 minutes in office hours; SLA defaults: Instant (L2) / 4 h (L1 direct) / 24 h (broker).

---

## Part 4 — Delivery approach
Phase 0 first (it changes routing, catalogue and money flows that every later feature depends on), then Phase 1 in
three parallel streams (insurer/catalogue, payments/wallet, partner self-service + CRM), each with tests and a summary.
Nothing working is rewritten: new tables and services are added beside the existing ones and the UI is extended.
