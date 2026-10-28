# Funeral cover & welfare groups, and the advanced diaspora pieces (Phase 4)

Status: built on branch `feat/welfare-groups-diaspora`; **the migration `supabase/migrations/20261031100300_welfare_groups_diaspora.sql` has not been applied to the live project** (verified only on a throwaway local Postgres 16 — see "Verification" below). Apply it with the Supabase CLI or the SQL editor before using the feature.

## 1. What it is

A **welfare group** is an association, church, alumni group, hometown union, trade union or family that enrols members, keeps beneficiary records per member and collects a **contribution** per member per period towards one **funeral / welfare cover** for the group. The cover is an ordinary Covva request: it is routed to a **licensed broker of record**, quoted by **insurers**, and the insurer issues one **master policy** on the group. Covva is the marketplace and record keeper; it is never the broker, never the insurer, and never holds the money.

The diaspora link: a **sponsor abroad** (a relative in the UK, US, EU, Canada…) can accept an invitation to pay the contributions of one or more members, in their own currency with the usual FX display, and sees only the members they pay for.

Main files:

| Layer | Files |
|---|---|
| Database | `supabase/migrations/20261031100300_welfare_groups_diaspora.sql` |
| Types | `packages/db/src/database.types.ts` (hand-edited in the generator's format: 5 tables, `requests.welfare_group_id`, `claims.welfare_group_id` / `welfare_member_id`, `product_bundles.settings`, 7 RPCs) |
| Pure logic | `packages/core/src/welfare.ts` (+ tests), `bundles.ts` (`bundleSponsorPlan`), `property.ts` (photo timeline), `remittance.ts` (adapter interface only) |
| Server | `apps/web/src/server/welfare.ts`; hooks in `payments.ts` (`initiatePolicyCollection.displayCurrency`, welfare outcome routing), `requests.ts` (`welfareGroup` arg), `property.ts` (inspection photos → documents), `cron.ts` (`welfare-reminders`) |
| Customer UI | `apps/web/src/app/(site)/(customer)/account/groups/**` (list, new, `[id]` with Overview / Members / Contributions / Claims tabs, `[id]/claims/new`, `join/[token]`, `sponsor/[token]`), nav entry "Groups" |
| Partner UI | `apps/web/src/app/(site)/(partner)/partner/(workspace)/groups/page.tsx` ("Welfare groups" in the broker and insurer navs) |
| Marketing | `/diaspora` "Group plans" card now links to `/account/groups/new`; Parents' Care Pack copy updated |
| Tests | `packages/core/src/welfare.test.ts`, `property.test.ts`, `bundles.test.ts`; `apps/web/tests/welfare-rules.test.mjs` (DB rules, `E2E-WELFARE` rows — written, not run) |

## 2. Data model

```
welfare_groups ──< welfare_members ──< welfare_beneficiaries
      │                 │        └──< welfare_sponsors (one row per sponsor × member)
      │                 └──< welfare_contributions ──> payments
      ├── request_id  → requests (requests.welfare_group_id, admin-only guard)
      ├── policy_id   → policies (the master policy; synced by trigger)
      └── broker_org_id / insurer_org_id (synced by placement triggers, never set by the group)
claims.welfare_group_id + welfare_member_id (claims raised on the master policy for one member)
```

* **welfare_groups** — name, kind, admin (`admin_user_id`), category (default `life-funeral`), status `draft → quoting → active / lapsed / cancelled`, contribution plan (`contribution_amount` GHS per member, `contribution_cadence` monthly / quarterly / annual, `contribution_day` 1–28, `plan_starts_on`), `rules` (plain-language benefits), invitation link (`invite_token`, `invite_enabled`), `consent_version`, `member_count`.
* **welfare_members** — name, phone, e-mail, DOB, gender, Ghana Card last 4 only, `role` member / admin, `status` invited / pending / active / suspended / left, `user_id` (linked by the member, never by the admin), consent (`consent_at`, `consent_channel`, `consent_version`) or `consent_attested_by` (the admin attests paper / meeting consent when activating a member without an account), `joined_via`.
* **welfare_beneficiaries** — who receives the benefit for a member (name, relationship, phone, share %), `user_id` linked by verified phone so a beneficiary can raise and follow a claim.
* **welfare_sponsors** — a sponsor abroad per member: contact, `display_currency`, `status` invited / active / ended, `invite_token`; `sponsor_user_id` set only by `accept_welfare_sponsorship` or a verified e-mail match.
* **welfare_contributions** — one row per member per period: `period_start`, `due_at`, `amount` (GHS), `status` due / paid / waived / failed / cancelled, **who paid for whom** (`paid_by_user_id`, `paid_via` member / sponsor / admin, `sponsor_id`), `payment_id`, display currency / amount / FX rate, reminder stamps.

Guards (all `P0001` with plain messages): placement fields are the platform's; the admin can only cancel the group; members link their own account; consent cannot be forged; one phone per member per group; a member who left must be re-enrolled; a sponsorship becomes active only when the sponsor accepts; a paid contribution always carries its `payments` row and is final; contributions never move member or period; a welfare claim names both the group and a member of that group and sits on the group's policy; a request can be attached to a group only by its admin. Every table has `set_updated_at` and the hash-chained `write_audit` triggers; rows are never deleted.

RPCs: `create_welfare_group`, `join_welfare_group` (consent captured), `consent_welfare_membership`, `accept_welfare_sponsorship`, `link_my_welfare_memberships` (verified phone → members and beneficiaries; verified e-mail → sponsor invitations; same shape as `link_my_scheme_memberships`), `generate_welfare_contributions` (admin / platform, idempotent), `waive_welfare_contribution` (admin).

## 3. Money flow

1. The admin asks for quotes → `requestWelfareCover` creates a broker-routed request tagged `welfare_group_id` carrying counts and ages only (no member PII). Broker acceptance sets the group's `broker_org_id` (status `quoting`); the issued policy sets `policy_id`, `insurer_org_id`, status `active` and the renewal date (same trigger pattern as SME group schemes).
2. `generate_welfare_contributions` creates the due rows per active member from the plan and each member's join date (`@im/core` `contributionPeriods` mirrors the SQL).
3. **Paying** (`payWelfareContributions`): the payer is the member, an active sponsor of every member included, or a group admin. The amount is the sum of the chosen due rows, oldest first (`allocateSponsorPayment`). The payment is `initiatePolicyCollection` on the **master policy**: a `payments` row in GHS with **payee = the insurer**, the broker's commission and Covva's fee recorded as splits exactly like an instalment, settled by Paystack / Hubtel / the sandbox straight to the insurer's subaccount. A sponsor abroad sees the amount in their currency (`display_*` / `fx_*` columns, FX disclosure) — the charge and the settlement stay the GHS amount. **No money ever lands in a Covva account and nothing is pooled.**
4. The PSP outcome lands in `applyPaymentResult` → `applyWelfareContributionOutcome` (`raw_event.welfare_contribution_ids`): marks the rows paid with the payment, posts the ledger entries, notifies the member, the payer and the admin ("X paid GH₵ … for Y").
5. Until the policy exists, contributions can be scheduled but **not paid through Covva** (the UI says so). Admins may *waive* a contribution; they cannot record cash — anything collected outside Covva is outside Covva.
6. Reminders: cron `welfare-reminders` (daily 07:30) sends one reminder 3 days before and one 3 days after the due date to the member (app / push / WhatsApp / SMS per preferences; plain SMS when they have no account) and to their sponsors; the admin can also remind a member in arrears on demand.

Claims: `fileWelfareClaim` → the existing `createClaim` on the master policy with the policyholder (the admin who requested cover) as `customer_id`, the actor as `reported_by_user_id`, the funeral document checklist (`funeralClaimChecklist`) as `required_evidence`, then stamps `welfare_group_id` / `welfare_member_id`. Who may raise it: a group admin, the member (welfare claims) or a linked beneficiary. The broker is notified; only the insurer decides.

## 4. Access rules (RLS)

| Who | Sees | Can |
|---|---|---|
| Group admin (creator or admin-role member) | the group, every member, beneficiaries, sponsors, contributions, claims | add / import / activate / suspend / remove members, record beneficiaries, invite sponsors, edit the plan and rules, open / close the join link, ask for quotes, generate and waive contributions, pay for a member, raise claims, cancel the group |
| Member (linked account) | the group, **own** row, own beneficiaries, own sponsors, own contributions, claims about themselves | edit own contact details, add own beneficiaries, invite own sponsor, pay own contributions, leave |
| Sponsor abroad (active) | the group header and **only the members they pay for** with their contributions | pay for those members, end the sponsorship |
| Broker of record / insurer | the group, members, beneficiaries, contributions, claims (via the policy) | broker: status / renewal date; nothing else (no member writes, no sponsor contact rows) |
| Platform staff | everything | everything (service paths) |
| Other customers, anonymous | nothing | nothing |

`welfare_contributions` is read-only for every API role (writes are the platform's and the RPCs'). Claims on a group get one extra read policy for the member concerned and their linked beneficiaries; documents on those claims still follow the policyholder / reporter rules.

## 5. Advanced diaspora pieces in this change

* **Parents' Care Pack** — seed updated: funeral + health + personal accident per named parent (1–2 parents), home optional; `product_bundles.settings` holds the composition rule (`named_members`, `cadence: monthly`, `payer: sponsor`, `per_member_items`). `bundleSponsorPlan` turns per-parent annual estimates into one indicative amount per period. Pricing remains the insurers'.
* **Property under construction** — `propertyTimeline` merges the family's photo uploads with partner inspections (requested → scheduled → report with photos) into one newest-first timeline on the policy page; `completeInspection` now registers the partner's photos as `documents` of the policy so the customer, the sponsor abroad, the broker and the insurer can sign and view them (storage reads go through `documents`).
* **Remittance / diaspora-bank APIs** — deferred; `RemittancePartnerAdapter` in `@im/core/remittance` documents the shape (quote → initiate → webhook → `applyPaymentResult`).

## 6. Verification

* `pnpm --filter @im/core test` — schedule, arrears, sponsor allocation, checklist, CSV, bundle plan, property timeline.
* Local Postgres 16 (never the live project): stubs + all 37 migrations replayed in order; then a role-by-role proof with `set local role authenticated` + `request.jwt.claims` — 100 checks: admin manages, member sees own group / own row only, sponsor sees sponsored member only, outsider sees nothing, broker / insurer see the group but cannot write members, staff see all, invalid transitions refused with the messages above, placement sync, contribution generation idempotent, paid-needs-payment, claims link guards. The throwaway databases were dropped afterwards.
* `apps/web/tests/welfare-rules.test.mjs` is written in the style of `sme-rules.test.mjs` and **has not been run** (it needs the migration on the project and the demo accounts).

## 7. Open questions (need a human)

1. **Regulatory** — a welfare group collecting contributions towards a group funeral policy: confirm with the NIC and the launch insurer that the "member contribution = share of the group premium, settled to the insurer per payment" structure is acceptable, whether the group needs its own registration (e.g. with the Department of Social Welfare), and whether a group of fewer than N lives can be written as group cover.
2. **Policyholder** — the master policy's `customer_id` is the admin who requested the cover. If the insurer wants the association itself (a legal person) as policyholder, the request should come from an enterprise organisation instead; the model supports both but the UI only does the former.
3. **Sponsor cards** — sponsors abroad pay by MoMo prompt (if they have a Ghana number), a hosted Paystack page (international cards settle GHS) or a saved card; Apple / Google Pay and the Stripe path remain off pending the legal view already noted in the roadmap.
4. **Consent attested by the admin** — members without a phone / account are activated on the admin's attestation (paper or meeting consent). Confirm this is acceptable under Act 843 for the data shared with the broker and insurer, or require a phone-OTP consent (the `beneficiary_consents` flow could be reused).
5. **Waivers** — the insurer's rules decide whether a waived contribution keeps a member covered; the group page says so, but the insurer should confirm the arrears / lapse rules to show in `rules`.
6. **Migration** — apply `20261031100300_welfare_groups_diaspora.sql` to the project (it is independent of the concurrent `20261031100100_data_subject_requests.sql` and `20261031100200_policy_explainer.sql`), then regenerate `database.types.ts` and run `pnpm --filter @im/web test:db`.
