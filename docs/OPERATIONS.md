# Operations

Runbook for the `web` (marketing, customer app, partner workspace, `/api/*`) and `admin`
Vercel projects on Supabase project `krmnyqaweawkpygjmdry` (eu-west-2).

---

## 1. Environment variables

### `web` project

| Variable | Secret | Required | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | no | yes | Supabase URL |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | no | yes | Publishable (anon) key |
| `SUPABASE_SECRET_KEY` | **yes** | yes | Service key for webhooks, cron, notifications, payments, API keys, AI usage logs. Never expose. |
| `NEXT_PUBLIC_SITE_URL` | no | yes | Absolute links in emails/SMS, payment callbacks, simulator links |
| `NEXT_PUBLIC_ADMIN_URL` | no | yes | Link to the admin portal |
| `PAYSTACK_SECRET_KEY` | **yes** | prod | Paystack API + webhook signature secret (`sk_live_…` / `sk_test_…`) |
| `NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY` | no | optional | Only if a client-side Paystack popup is added |
| `PAYMENTS_SIMULATOR` | no | no | `true` enables the sandbox simulator even in production builds (staging only!). `false` disables it in dev. |
| `PAYMENTS_SIMULATOR_SECRET` | yes | no | HMAC key for simulator links (defaults to `SUPABASE_SECRET_KEY`) |
| `RESEND_API_KEY` | **yes** | prod | Email delivery. Unset → emails are logged, not sent |
| `EMAIL_FROM` | no | prod | e.g. `Covva <no-reply@your-domain>` (verified Resend domain) |
| `SMS_PROVIDER` | no | prod | `log` (default) \| `arkesel` \| `hubtel` |
| `SMS_API_KEY` | **yes** | if SMS | Arkesel API key, or `clientId:clientSecret` for Hubtel |
| `HUBTEL_CLIENT_ID` / `HUBTEL_CLIENT_SECRET` | **yes** | if Hubtel | Preferred over `SMS_API_KEY` for Hubtel |
| `SMS_SENDER_ID` | no | if SMS | Registered sender id, ≤ 11 chars (default `Covva`) |
| `EXPO_ACCESS_TOKEN` | **yes** | optional | Required only if Expo push security is enabled for the project |
| `AI_GATEWAY_API_KEY` | **yes** | local | Vercel AI Gateway. On Vercel deployments OIDC is used automatically (a key, if set, wins) |
| `AI_DEFAULT_MODEL` / `AI_FAST_MODEL` / `AI_VISION_MODEL` | no | no | Gateway model ids; overridden by `platform_settings.ai_models` |
| `CRON_SECRET` | **yes** | yes | Vercel Cron sends `Authorization: Bearer $CRON_SECRET` |
| `REVALIDATE_SECRET` | **yes** | yes | Shared with the admin app for `POST /api/revalidate` |
| `APPLE_TEAM_ID`, `IOS_BUNDLE_ID` | no | mobile | Universal links (`/.well-known/apple-app-site-association`) |
| `ANDROID_PACKAGE_NAME`, `ANDROID_SHA256_CERT_FINGERPRINTS` | no | mobile | App links (`/.well-known/assetlinks.json`); comma-separated fingerprints (upload key + Play signing key) |
| `PAYMENT_PROVIDER` | no | no | `paystack` (default) \| `hubtel`. Per insurer: `organizations.settings.payment_provider`. Hubtel is used only when its credentials are set |
| `HUBTEL_MERCHANT_ACCOUNT`, `HUBTEL_WEBHOOK_SECRET` | **yes** | if Hubtel | Hubtel checkout merchant account (fallback; per insurer `organizations.settings.hubtel_merchant_account` wins) and the shared secret required on `/api/webhooks/hubtel` |
| `PAYSTACK_DVA_ENABLED`, `PAYSTACK_DVA_BANK` | no | no | `true` creates a Paystack dedicated virtual account per customer for bank transfers (auto-confirmed by `charge.success`) |
| `VEHICLE_LOOKUP_PROVIDER`, `DVLA_API_URL`, `DVLA_API_KEY` | **yes** (key) | no | Registration lookup for motor quotes: `cache` (default) \| `dvla` \| `manual`. Unset → the form asks for make/model/year |
| `IDENTITY_PROVIDER`, `NIA_API_URL`, `NIA_API_KEY` | **yes** (key) | no | Ghana Card verification: `manual` (default, admin review) \| `nia` (provider; manual review stays the fallback) |
| `WHATSAPP_PROVIDER`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_BUSINESS_ID`, `WHATSAPP_TEMPLATE_*` | **yes** (token) | **yes** (support console replies) | WhatsApp Cloud API (`meta`) for opted-in customers and the conversation channel; `log` (default) only logs. Renewal reminders go WhatsApp first, SMS as fallback. See "WhatsApp Business" below |
| `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN` | **yes** | no | Inbound webhook `/api/webhooks/whatsapp`: signature check and Meta's subscription verification |
| `LOG_LEVEL` | no | no | `debug` for verbose logs |
| `NIC_MOTOR_DB_MODE` | no | no | How delegated motor policies reach the NIC motor insurance database: `manual` (default — an insurer task "Register policy … on the NIC motor database" is created and the insurer records the reference in Issuance → Delegated issuance) or `api` (through the insurer's connector adapter; only the `simulator` adapter exists, selected by `organizations.settings.connector = "simulator"`; falls back to the manual hand-off when the insurer has none). Status is tracked in `issuance_jobs.nic_registration`. |
| `PARTNER_MFA_REQUIRED` | no | no | TOTP two-step verification for broker/insurer users in `/partner`. Defaults to `true` in production builds and `false` elsewhere. Set `false` only for local demos and e2e (`apps/web/playwright.config.js` does). Customers are never gated. |

The `.well-known` files are static at build — **redeploy after changing their env vars**.

### `admin` project

`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`,
`NEXT_PUBLIC_SITE_URL` (web host), `REVALIDATE_SECRET` (same value as web), `AI_GATEWAY_API_KEY`
if admin insights use AI. After changing catalogue/flags/settings the admin app calls:

```
POST https://<web>/api/revalidate
x-revalidate-secret: $REVALIDATE_SECRET
{ "tags": ["catalog", "categories", "category:motor", "products:<categoryId>", "partners", "flags", "settings", "plans"] }
```

### Secrets checklist (Vercel → Project → Settings → Environment Variables, Production + Preview)

`SUPABASE_SECRET_KEY`, `PAYSTACK_SECRET_KEY`, `RESEND_API_KEY`, `CRON_SECRET`, `REVALIDATE_SECRET`,
`AI_GATEWAY_API_KEY` (or rely on Vercel OIDC), `SMS_API_KEY` / `HUBTEL_CLIENT_*`, `EXPO_ACCESS_TOKEN`.
Use different Paystack keys (test vs live) for Preview and Production. Rotate any secret that has
been pasted into chat, logs or tickets.

## 2. Paystack

1. Create one **subaccount per insurer** (Dashboard → Subaccounts) with the insurer's settlement bank
   account. Store the code (`ACCT_…`) on `organizations.paystack_subaccount_code` (admin portal).
   Without it, live checkout is refused for that insurer — premiums must settle to the insurer.
2. Transactions are initialised with `subaccount = <insurer code>` and `bearer = "subaccount"`, so the
   insurer receives the premium and bears Paystack fees; the platform never holds the money.
3. **Webhook URL**: `https://<web-host>/api/webhooks/paystack` (Settings → API Keys & Webhooks), for
   both test and live modes. Signature: `x-paystack-signature` = HMAC-SHA512(raw body, secret key).
   Handled events: `charge.success`, `charge.failed`, `refund.processed`, `refund.failed` (`refund.pending`
   and others are acknowledged).
4. **Callback URL**: set per transaction (web: `/account/requests/{id}/confirmation`; mobile:
   `/api/payments/return`, which redirects to `covva://payments/return`).
5. Mobile money channels must be enabled on the Paystack business (GHS). Direct MoMo prompts use `POST /charge`.
6. Reconciliation: `payments.provider_reference` = Paystack reference; `raw_event` keeps the last
   provider event; `GET /api/v1/payments/{id}` re-verifies pending payments with `/transaction/verify`.

Payment success creates the policy as `pending_issuance` and moves the request to
`policy_documents`. **Only insurer issuance activates cover** (`POST /api/v1/partner/policies/{id}/issue`
or the partner UI, which should call `onPolicyIssued()` afterwards).

**Refunds (insurer declines after payment).** The insurer's "Decline risk" on a pending policy calls
`declinePendingPolicy()` → `refundPayment()` (`POST /refund` with the transaction reference and a
`merchant_note`). The payment is marked `refunded` as soon as Paystack accepts the request and
`raw_event.refund` tracks progress (`requested` → `processed` on `refund.processed`). A `refund.failed`
webhook reverts the payment to `succeeded` with `failure_reason = "Refund failed …"`, logs
`paystack.refund_processing_failed` and notifies the broker's owners/supervisors/finance to arrange the
refund manually (then set `status = refunded` from the admin payments page). The pending policy is
cancelled, the application rejected and the request closed (`closed_no_cover`). Simulator payments are
refunded immediately. Alert on `paystack.refund_failed` (provider refused) and
`paystack.refund_processing_failed`.

Sandbox: with no `PAYSTACK_SECRET_KEY` and `NODE_ENV !== "production"` (or `PAYMENTS_SIMULATOR=true`),
checkout opens `/api/payments/simulate?reference=…&sig=…` — a clearly labelled simulator that runs the
same `applyPaymentResult` code path. Never enable it on a production domain.

### Settlement and splits

Migration `20261027100200_commercial_ledger.sql` adds the commercial model (Addendum 2 §F):

* **Commercial terms** (`org_commercial_terms`, admin → Commercial terms): brokers are on
  `revenue_share` (Covva takes `revenue_share_pct` of the broker's commission on **Covva-sourced**
  business only) or `subscription` (monthly plan, full commission kept); insurers are on `insurer_fee`
  (`platform_fee_pct` of the net premium on Covva-sourced business, plus the standard
  `broker_commission_pct` they pay brokers). Setting terms closes the previous open row
  (`set_commercial_terms`, platform admins only, approval recorded in `approved_by`).
* **Source of business**: `requests.source_broker_org_id` marks a broker's own client; the policy is
  created with `policies.source = 'broker'` (no revenue share), otherwise `'covva'`.
* **Checkout split** (`payment_splits`, computed by `@im/core` `computeSplit` in pesewas, remainder to
  the insurer): Paystack settles a single subaccount per transaction, so a three-way split needs a
  **split group** (Dashboard → Transaction Splits; subaccounts for the insurer, broker and Covva). Set
  its `SPL_…` code on `organizations.paystack_split_code` (per insurer) or `PAYSTACK_SPLIT_GROUP_CODE`
  (global). With a split code, `/transaction/initialize` and `/charge` are called with `split_code`;
  without one they fall back to `subaccount = <insurer>` + `bearer = "subaccount"` and the broker /
  platform shares are settled by statement. Either way the premium never touches Covva.
* **Ledger** (`ledger_entries`, append-only — updates and deletes are rejected by trigger): on
  `charge.success` the server posts `premium_received` (insurer), `broker_commission` (broker ←
  insurer), `platform_fee` (Covva ← insurer) and `revenue_share` (Covva ← broker), one entry per
  payment and type (idempotent). Corrections are `adjustment` rows.
* **Statements** (`settlement_statements` + `settlement_lines`): cron `/api/cron/settlement-statements`
  (1st of the month, 02:00 UTC) drafts one statement per organisation for the previous month
  (`build_settlement_statement`, idempotent). Admin → Commercial terms can regenerate drafts for any
  period, issue them (draft → issued → paid) and export the ledger as CSV. Partners see their statements
  under Partner workspace → Settlements; `net_due` is positive when Covva/the insurer owes the
  organisation and negative when the organisation owes commission or fees.
* **Transparency**: `quotes.fee_breakdown` (set at payment initiation, or computed on the fly for the
  checkout page) shows the customer the premium, taxes, platform fee and broker commission, and states
  that the fee and commission are paid by the insurer out of the premium.

### Bank transfer, Hubtel, lookups and WhatsApp (Phase 1)

Migration `20261028100300_quoting_payments.sql` adds `vehicle_lookups`, `quote_shares`, `payment_accounts`,
`payments.channel_detail` (+ a provider check: `paystack | hubtel | simulator | bank_transfer`),
`policies.underinsurance_flag`, `profiles.whatsapp_opt_in` and `kyc_verifications.checked_at`.

* **Bank transfer** (`channel: bank_transfer`): the money must reach the insurer, never Covva. With
  `PAYSTACK_DVA_ENABLED=true` each customer gets a Paystack **dedicated virtual account** (stored in
  `payment_accounts`); Paystack confirms the credit with `charge.success` and the normal flow applies.
  Otherwise the instructions show the insurer's own account from `organizations.settings.bank_account`
  `{ bank, account_name, account_number }` with a unique reference (`platform_settings.payments.bank_transfer.reference_prefix`
  + payment reference). The payment stays `pending` (`payments.channel_detail` holds the instructions);
  when the insurer confirms the credit, admin → Payments → **Reconcile** on the pending transfer calls
  `POST /api/payments/confirm-transfer` (shared `REVALIDATE_SECRET`) on the web app, which applies the
  success through the same idempotent path as a webhook. An insurer without `bank_account` cannot take transfers.
* **Hubtel** (`server/providers/hubtel.ts`): hosted checkout via `POST /items/initiate`, status via the
  transaction-status API. Callbacks (`/api/webhooks/hubtel`) are **unsigned**, so register the callback URL with
  `?secret=<HUBTEL_WEBHOOK_SECRET>` (or send `x-hubtel-secret`); every success is re-verified with the status API
  before it is applied. Refunds for Hubtel and bank transfers are recorded as `requested` + `manual` — arrange
  them with the insurer/Hubtel and finish from the admin payments page.
* **Refund ledger**: `refundPayment()` posts a `refund` entry (insurer, −premium) and `adjustment` reversals of
  the commission / platform-fee / revenue-share entries (reference `<payment ref>:refund`, idempotent).
  Partners export their ledger from Partner workspace → Settlements → **Export CSV**
  (`/partner/settlements/export?from=&to=`; owners, admins and finance).
* **Vehicle lookup**: `POST /api/v1/lookups/vehicle` → cache (`vehicle_lookups`, 90 days) → DVLA stub
  (`DVLA_API_URL`, `GET /vehicles/{registration}` with a bearer key). Only vehicle facts are stored. Ops can seed the
  cache by inserting rows with the service key (normalised plates such as `GR 1234-23`).
* **Ghana Card**: `IDENTITY_PROVIDER=nia` calls `POST {NIA_API_URL}/verify` when a customer saves a card number;
  `verified` / `rejected` are applied to the profile, anything else stays in the admin KYC queue (manual review).
* **WhatsApp**: `WHATSAPP_PROVIDER=meta` sends approved Cloud API templates (`WHATSAPP_TEMPLATE_RENEWAL`,
  `WHATSAPP_TEMPLATE_GENERIC`; three body parameters: title, body, link) to customers who switched on WhatsApp
  in Profile → Notifications (`profiles.whatsapp_opt_in`). `notify()` sends WhatsApp first and skips SMS when
  the WhatsApp message was delivered by the live provider; with the `log` provider SMS still goes out.
* **Underinsurance nudges**: the `policy-lifecycle` cron compares `sum_insured` with the declared value
  (motor vehicle value; home buildings + contents; business premises + stock + equipment) and flags policies
  below 85% once (`policies.underinsurance_flag`, notification `policy.underinsured`), clearing the flag when fixed.
* **Share links**: `/q/<token>` (public, noindex) renders quote summaries only from `quote_shares` (14-day expiry,
  view count); no customer identity is exposed.

### WhatsApp Business: setup, webhook, templates, 24-hour window, opt-out (Phase 2)

Migration `20261029100300_whatsapp.sql` adds `wa_contacts`, `wa_conversations`, `wa_messages`, `wa_templates`
(seeded) and `wa_handoffs`. Code: `packages/core/src/whatsapp.ts` (pure helpers, classifier, template registry,
webhook parser), `apps/web/src/server/whatsapp/*` (webhook → router → assistant/sender → handoff),
`apps/web/src/server/providers/whatsapp.ts` (Cloud API adapter), admin console `/whatsapp` (+ `/templates`,
`/contacts`), partner workspace `/partner/whatsapp`, marketing "Chat with us" drawer (`/api/ai/faq`).

**Setup (Meta Business Manager → WhatsApp)**

1. Create (or claim) the WhatsApp Business Account; note `WHATSAPP_BUSINESS_ID` and the phone number's
   `WHATSAPP_PHONE_NUMBER_ID`. Create a system user with `whatsapp_business_messaging` +
   `whatsapp_business_management` and a permanent token → `WHATSAPP_ACCESS_TOKEN`.
2. App → Settings → Basic → App secret → `WHATSAPP_APP_SECRET`. Choose any random string for
   `WHATSAPP_VERIFY_TOKEN`.
3. App → WhatsApp → Configuration → Webhooks: callback URL `https://<web>/api/webhooks/whatsapp`, verify
   token = `WHATSAPP_VERIFY_TOKEN`, subscribe to the **messages** field. Meta GETs the URL with
   `hub.challenge`; the route echoes it when the token matches.
4. Set `WHATSAPP_PROVIDER=meta` on **both** Vercel projects (the admin console sends support replies with
   the same credentials). `NEXT_PUBLIC_WHATSAPP_NUMBER` (digits) keeps the marketing button and the
   "Talk to a human" link pointing at the business number.
5. Feature flag `ai_assistant` + the AI Gateway must be on for the bot to answer FAQs; otherwise it sends
   a safe canned reply and offers a human.

**Webhook.** `POST /api/webhooks/whatsapp` verifies `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with
the app secret; in non-production with the `log` provider and no secret, unsigned calls are accepted so the
flow can be exercised locally), rate-limits per IP, parses with `parseWebhookPayload()` and always answers
200 once the signature is valid. Every inbound message is stored with its Meta `wa_message_id` (unique) so
retries are no-ops; delivery statuses (`sent → delivered → read`, `failed`) update the outbound row. The
router then: honours STOP, confirms consent codes (6 digits → `confirm_beneficiary_consent`, guarded while
the diaspora function does not exist), redeems Accept/Decline buttons (`accept:<token>` →
`accept_order_offer(p_token)` as the service role), links quote / renewal / claim / documents / checkout
pages for the intents the keyword classifier recognises, and otherwise runs the FAQ assistant. After three
bot replies every answer offers "Talk to a human / My broker". Advice, suitability and claims help are
handed to the customer's **broker of record** (`wa_handoffs` + notification to the broker's advisers;
reply from Partner workspace → WhatsApp); complaints, payment problems and "human" go to **support**
(Admin → WhatsApp; a complaint row is opened for known customers, a callback lead for unknown numbers).
Contacts are linked to accounts by phone (`profiles.phone`, any spelling); staff can link by email.

**Templates.** `wa_templates` is the registry (seeded: `renewal_reminder`, `policy_documents_ready`,
`claim_status_update`, `quote_ready`, `payment_link`, `broker_new_offer` with Accept/Decline quick-reply
buttons, `consent_request`, `otp_code`, `info_request`). Each must be submitted in Business Manager →
Message templates (Admin → WhatsApp → Templates → **Copy for Meta submission** gives the body, variables and
sample values) and marked `approved` in the registry once Meta approves it; the live provider refuses
unapproved templates (the `log` provider only logs). `notify()` picks a template from the notification kind
(`offer.new` → `broker_new_offer`, `renewal.*` → `renewal_reminder`, `claim.*` → `claim_status_update`,
`quote.ready`, `policy.issued` → `policy_documents_ready`) or from `data.template` + `data.template_params`;
other kinds fall back to the Phase 1 generic template. Broker offers are sent on WhatsApp to opted-in
brokers whenever the SMS channel is requested, with SMS as the fallback.

**24-hour window.** Meta only delivers free-form text, interactive buttons and media within 24 hours of the
contact's last inbound message (`wa_contacts.last_inbound_at`, stamped by trigger). `canSend()` in
`@im/core` enforces it everywhere: outside the window only approved templates go out (the console and the
partner page switch to the template form automatically). Meta error 131047 on a send means the window had
closed on their side.

**Opt-out.** STOP / unsubscribe / opt out (`isOptOut()`) sets `opted_out_at`, closes the conversation and
sends one confirmation; **nothing** is sent to an opted-out contact afterwards, templates included, until the
contact messages again (which opts them back in). Staff can opt a contact out from Admin → WhatsApp →
Contacts (e.g. a request made by phone) but never opt anyone back in. `profiles.whatsapp_opt_in` still gates
the notification channel; the conversation channel is opt-in by the customer messaging us.

**Retention and privacy.** Inbound text is stored redacted of Ghana Card numbers, emails, phones and card
numbers (`redactPII`); media is referenced by Meta id only, never downloaded. The bot never quotes prices or
advises (`FAQ_SYSTEM_PROMPT`), and usage is logged to `ai_usage` (`whatsapp_faq`, `web_faq`).

### Diaspora payments: currencies, FX, sponsor subscriptions, bundles, property cover (Phase 2 / 4)

Migration `20261029100100_diaspora_payments.sql` adds `fx_rates`, `payment_methods`, `sponsor_subscriptions` +
`subscription_charges`, `product_bundles` (+ `requests.bundle_id`), `property_inspections`, `property_updates`,
`remittance_partners`, the `payments.display_*`, `fx_*` and `psp` columns, and the settings `fx` and
`payments.grace_days`. The money rule is unchanged: **`payments.amount` / `currency` stay the GHS contract amount
the insurer receives**; foreign-currency figures are a display only.

* **Pay in GBP / USD / EUR / CAD.** Checkout shows "You pay ≈ £X (indicative) · Insurer receives GH₵ Y" with the
  rate, its source and time (`@im/core` `fxQuote` / `fxDisclosure`). The payment row stores `display_currency`,
  `display_amount`, `fx_rate`, `fx_source`, `fx_quoted_at`; the ledger stays GHS with an `fx:` memo. Foreign currency
  is **card only** (mobile money and bank transfer are GHS rails).
* **PSP (`DIASPORA_PSP`, default `paystack_intl`).** Paystack international cards are charged the GHS amount
  (`currency: GHS`) and settle to the insurer's subaccount like any card; the issuer converts. Enable international
  cards on the Paystack business. `psp` on the payment records `paystack_intl`. **Apple Pay / Google Pay**: set
  `PAYSTACK_APPLE_PAY=true` once the channel is enabled on the Paystack business — checkout then passes
  `channels: ["card", "apple_pay"]`.
* **Stripe (`server/providers/stripe.ts`) is OFF and must stay off until a legal view exists.** A Stripe
  Checkout Session in the payer's currency settles to Covva's Stripe balance before the insurer is paid — a
  collection-on-behalf arrangement that conflicts with "Covva never holds client funds" unless structured and
  approved (roadmap Part 3 "Diaspora card PSP"). `DIASPORA_PSP=stripe` without `STRIPE_SECRET_KEY` **and**
  `STRIPE_SETTLEMENT_APPROVED=true` logs `stripe.not_used` and falls back to Paystack international. The webhook
  (`/api/webhooks/stripe`, `STRIPE_WEBHOOK_SECRET`) applies results by the Covva reference in `metadata`.
* **FX rates.** `fx_rates` is append-only (GHS per 1 unit). Seeded with the marketing site's October 2026 indicative
  table, `source = manual` — replace before launch. Cron `/api/cron/fx-rates` (hourly, :20) fetches from
  `FX_PROVIDER` / `platform_settings.fx.provider`: `openexchangerates` (`OPENEXCHANGERATES_APP_ID`, USD base → GHS per
  unit), `bog` (Bank of Ghana — stub, not integrated), `manual` (no-op). Admin → **FX rates** shows the history,
  appends manual overrides (audited, flagged "set by operations" to payers) and sets `fx.margin_pct` (display buffer
  for the PSP's spread, default 0, max 10 %; shown to the payer, never collected). Reads are cached for 60 s.
* **Sponsor subscriptions.** "Pay monthly / yearly as a sponsor" at checkout makes the first card payment with
  `saveMethod` (Paystack returns a reusable `authorization_code`; only the token, brand, last4, expiry and country are
  stored in `payment_methods`) and creates a `sponsor_subscriptions` row after `charge.success`. Monthly on a yearly
  quote needs `organizations.settings.instalments_allowed = true` on the insurer (the instalment is annual ÷ 12, taxes
  and fees pro rata). Cron `/api/cron/sponsor-collections` (daily 03:00) charges due rows through Paystack
  `charge_authorization` (GHS, insurer subaccount / split) or the simulator, creating a `payments` row per charge
  (`raw_event.subscription_id`, idempotency `sub:<id>:<n>:<attempt>`) with the normal ledger entries. Failures retry
  after 1, 3 and 7 days, then `past_due` with notifications to the sponsor (email/SMS/push) and the insurer/broker;
  `platform_settings.payments.grace_days` (default 14) is the grace period quoted — **the insurer decides on lapses**,
  Covva never cancels cover. `PAYSTACK_MANAGED_SUBSCRIPTIONS=true` creates a Paystack plan + subscription instead
  (`psp_subscription_ref`); the webhook handles `subscription.create`, `subscription.disable`, `invoice.payment_failed`
  and `charge.success` for charges Covva did not initiate. Sponsors manage everything under Account → Payments
  (pause / resume / cancel, saved cards — revoked, never deleted); Admin → **Sponsor subscriptions** lists past-due rows
  and can retry / pause / cancel.
* **Bundles.** `product_bundles` (Admin → Bundles; seed: Parents' Care Pack, published, items optional) get a marketing
  page `/bundles/<slug>` and `/get-started?bundle=<slug>` → `/account/requests/new?bundle=`: the first item is a normal
  request tagged `bundle_id`; the other items are saved as **draft** requests for the customer to complete. The bundle
  discount is indicative until the insurer confirms it on the binding quotes.
* **Property cover.** Home/property policies get a "Property updates" card: photo updates (`property_updates`, private
  documents bucket, uploaded by the customer or sponsor) and inspection requests (`property_inspections`). Admin →
  **Inspections** assigns an inspection partner — an organisation with `settings.inspection_partner = true` (set from
  Organisations); the partner sees **Inspections** in its workspace (`/partner/inspections`) to accept, schedule and
  file the report + photos. The insurer and broker are notified; **the insurer decides what a report means for cover.**
* **Remittance / diaspora-bank partners.** `remittance_partners` (kinds `remittance`, `diaspora_bank`,
  `embedded_partner`) is a placeholder: rows are created by engineering with the service key once an agreement exists
  (`api_key_hash` = sha256 of the issued key, never the key); Admin → Partnerships → Remittance partners lists them.
  No quoting/collection API is live yet.
* **Mobile:** `GET /api/v1/fx`, `displayCurrency` / `saveMethod` / `sponsorSubscription` on `POST /payments`,
  `GET|POST /subscriptions`, `POST /subscriptions/{id}/pause|cancel`, `GET /bundles`, `GET|POST /property/{policyId}/updates|inspections`
  (docs/MOBILE_INTEGRATION.md §16). Tests: `apps/web/tests/diaspora-payments-rules.test.mjs`.

## 3. Supabase Auth settings

* **Site URL**: `https://<web-host>`.
* **Redirect URLs**: `https://<web-host>/auth/callback`, `https://<web-host>/**` (previews:
  `https://*-<team>.vercel.app/**`), `covva://auth/callback`, `exp://**` (Expo Go dev only),
  admin host `https://<admin-host>/auth/callback`.
* **Providers**: Email (confirm email on; OTP length 6), Phone with an SMS provider (Twilio/MessageBird/Vonage
  or a Send-SMS hook to Arkesel/Hubtel) for phone OTP; set OTP expiry ≤ 10 minutes.
* **MFA**: enable TOTP. The admin portal requires AAL2 for platform staff; the partner workspace
  (`/partner`) requires AAL2 for broker and insurer users (`PARTNER_MFA_REQUIRED`, see §3a).
* **JWT signing keys**: asymmetric keys recommended (`getClaims()` verifies locally via JWKS).
* **Rate limits**: tighten OTP/sign-up limits; enable CAPTCHA (hCaptcha/Turnstile) for sign-up if abused.
* Custom SMTP (Resend) for auth emails with the brand sender.

### 3a. Partner MFA, sessions and devices (Addendum 4)

* **Gate**: `requirePartner()` in `apps/web/src/lib/auth.ts` checks the session's assurance level
  and sends AAL1 sessions to `/partner/mfa?next=…` (enrol a TOTP factor or verify an existing one;
  same flow as the admin console). The gate applies when `PARTNER_MFA_REQUIRED` resolves to true
  **and** the organisation's `organizations.require_mfa` is on (default on; org admins can switch it
  off from Settings → Security, platform staff can edit it in admin). Customers (`/account`, mobile)
  are never asked for MFA — they use phone OTP.
* **Local demo / e2e**: `PARTNER_MFA_REQUIRED=false`. Production deployments must not set it.
* **Lost authenticator**: an admin removes the user's factors in Supabase Auth → Users → MFA
  (`auth.mfa_factors`); the user enrols again at next sign-in. There is no self-service reset by design.
* **Sessions & devices**: Settings → Security lists the user's `auth.sessions`
  (`public.list_my_sessions()`, SECURITY DEFINER, own rows only) with "Sign out this device"
  (`public.revoke_my_session(uuid)` — deletes only that one row of the caller's own sessions) and
  "Sign out everywhere" (`supabase.auth.signOut({ scope: "others" })`). Mobile push registrations
  (`device_tokens`) are listed with "Remove". Nothing here needs the service key.
* **Mobile access rules**: `/api/v1` reads `X-Covva-Client: mobile | web | partner-web` (default
  `web`). Insurer-only (and staff-only) accounts calling with `mobile` get `403 forbidden` pointing to
  `${NEXT_PUBLIC_SITE_URL}/partner`; brokers use the same app as customers. `profiles.last_seen_platform`
  records the last client; `profiles.active_workspace` stores the workspace a dual-role user chose
  (`POST /api/v1/me/workspace`). See `docs/MOBILE_INTEGRATION.md` §14.
* **Complaints contacts** shown on every quote/policy come from `platform_settings.complaints`
  (`email`, `phone`, `nic_name`, `nic_phone`, `nic_url`); confirm the NIC complaints line before launch.

## 4. Scheduled jobs (Vercel Cron, `apps/web/vercel.json`)

| Job | Schedule (UTC) | What it does |
|---|---|---|
| `/api/cron/renewal-reminders` | daily 07:00 | Active policies ending within `platform_settings.renewal_reminder_days` → notify customer + broker once per threshold; records `policies.renewal_reminders_sent` |
| `/api/cron/sla-monitor` | every 15 min | Requests past `due_at` in `submitted / adviser_action / insurer_response / policy_documents` → `sla_breached_at`, internal timeline event, notify broker supervisors |
| `/api/cron/quote-expiry` | hourly :05 | `ready_to_accept` quotes past `valid_until` → `expired`; notify the customer when their top-ranked quote expired |
| `/api/cron/policy-lifecycle` | daily 00:15 | Active policies past `cover_end` → `expired`; notify customer |
| `/api/cron/usage-metering` | daily 01:30 | One `policy_active` usage event per active policy per month for the broker org (idempotent) |
| `/api/cron/complaint-sla` | daily 08:00 | Open complaints past `due_at` → timeline note, notify owner org + platform compliance (once) |
| `/api/cron/webhook-retry` | every 10 min | Re-sends partner webhook deliveries whose `next_attempt_at` has passed (backoff 1m, 5m, 30m, 2h, 12h; max 5 attempts). See `docs/WEBHOOKS.md` |
| `/api/cron/sla-monitor` (extended) | every 15 min | Also escalates `sla_timers` (level 1 at due → insurer contacts; level 2 at due + 50% → Covva ops; level 3 at 2× due → customer notified to choose refund or re-route) and closes delegated review windows that have passed (`issuance_jobs.review_window` → `issued`) |
| `/api/cron/issuance-retry` | every 30 min | Re-runs `startIssuance` for `issuance_jobs` left `queued` or `failed` (adapter outage, missing number block) whose policy is still `pending_issuance`; the admin "Retry" action re-queues a job for this run |
| `/api/cron/settlement-statements` | monthly, 1st 02:00 | Drafts a settlement statement per broker/insurer for the previous month from the ledger (idempotent; issued statements untouched). See "Settlement and splits" |
| `/api/cron/instalment-collections` | daily 06:30 and 18:30 | Collects due instalments (MoMo prompt / saved card / pay link), retries day 0, +2, +5, then moves schedules to grace → lapsed per the insurer's plan. See "Instalments and micro cover" |
| `/api/cron/micro-renewals` | hourly :40 | Marks ended micro windows expired; auto-renews micro policies with `auto_renew` before the window ends (saved card charged, else a pay link by WhatsApp/SMS) |

Each run writes `platform_settings['cron_last_run:<job>'] = { at, ok, ms, result }` (visible in admin
system health). Sub-daily schedules need a Vercel Pro plan. Manual run:
`curl -H "Authorization: Bearer $CRON_SECRET" https://<web>/api/cron/sla-monitor`. All jobs are idempotent.

## 5. Database migrations

Migrations live in `supabase/migrations/` and are applied with the Supabase MCP / CLI
(`supabase db push`). After applying, regenerate types into `packages/db/src/database.types.ts`.
`20261026130000_backend_support.sql` adds `usage_events.details`, a one-policy-per-quote index,
supporting indexes, KYC/request/claim column guards and the `ai_models` setting.
`20261026140000_flows.sql` adds the invitation RPCs (`invitation_preview`, `accept_invitation`), the
broker hand-over RPC (`complete_broker_change`), `policies.external_insurer_name` (with
`insurer_org_id` nullable only when `external_source`), and `webhook_deliveries.last_error` /
`response_ms` plus retry indexes.
`20261027100300_access_security.sql` (Addendum 4) adds `organizations.require_mfa`,
`profiles.active_workspace` / `last_seen_platform`, the own-session RPCs `list_my_sessions()` /
`revoke_my_session(uuid)` and the `complaints` platform setting.

`20261028100200_issuance.sql` (Addendum 2 A, Level 2) adds `policy_number_blocks` (+ `allocate_policy_number`
RPC, row-locked sequential allocation), `issuance_jobs`, `sla_timers`, `policies.verification_code` (random
10-char code generated by trigger; printed as a QR on generated documents) / `sticker_number`,
`requests.sla_choice`, the `sticker` document kind, makes `insurer_submissions.broker_org_id` nullable for
insurer-direct orders (guarded by trigger) and the anon-callable `verify_policy` RPC behind `/verify` and
`GET /api/v1/verify`. Generated PDFs are stored under `documents/policies/<policy_id>/<kind>.pdf`.

## 6. Observability

* Partner webhooks: `webhook_deliveries` rows per endpoint (status, attempts, `last_error`); the settings
  page shows the last 20 per endpoint. Alert on repeated `webhooks.delivery_failed` for one endpoint.
* Logs are one JSON object per line (`level`, `msg`, `requestId`, `path`, `status`, `ms`, `principal`).
  `src/instrumentation.ts` logs unhandled server errors (`request.unhandled_error`, with digest).
  Configure a Vercel log drain (Datadog/Axiom/Better Stack) and alert on `level=error`,
  `msg=payment.amount_mismatch`, `payment.subaccount_mismatch`, `paystack.webhook_bad_signature`, `cron.failed`.
* Every API response carries `x-request-id`; ask users/partners for it.
* AI calls: `ai_usage` (feature, model, tokens, latency, success); org-billable tokens in `usage_events` (`ai_tokens`).
* Notification delivery results: `notifications.delivered` (`email`, `sms`, `push` per row).
* Supabase advisors (security + performance) weekly; `select * from verify_audit_chain()` monthly.

## 7. Rate limiting

API v1 uses an in-memory token bucket per principal + IP (default 120 burst / 2 per s for reads,
30 / 0.5 per s for writes, 15 / 0.1 per s for AI, 300 / 5 per s for partner keys). It is **per serverless
instance** — at scale add Vercel WAF rate-limit rules on `/api/*` (especially `/api/ai/*`,
`/api/v1/payments`, auth endpoints) or a shared store (Upstash Redis / Postgres counter).

## 8. Partner API keys

Format `imk_<prefix>_<secret>`. Only `prefix` and `sha256(full key)` are stored (`api_keys.prefix`,
`api_keys.key_hash`). Generate with `generateApiKey()` from `apps/web/src/server/api-auth.ts`, show the key
once, set `scopes` (`requests:read`, `quotes:write`, `policies:issue`, `claims:write`, or `*`) and an
`expires_at`. Revoke by setting `revoked_at`. `last_used_at` updates at most every 5 minutes.

## 9. Incident runbook (basics)

1. **Triage**: check Vercel runtime errors/logs and Supabase logs; find the `x-request-id`; check
   `cron_last_run:*` settings.
2. **Payments failing**: Paystack status page; confirm `PAYSTACK_SECRET_KEY` and webhook URL; check
   `paystack.*` logs. If webhooks were missed, polling (`GET /payments/{id}`) or the return URL re-verifies;
   for bulk recovery call `verifyPayment(reference)` for `pending/processing` payments older than 10 minutes.
   Never mark a policy active manually — the insurer issues.
3. **Webhook signature failures**: key mismatch between test/live; rotate and update both Paystack and Vercel.
4. **Notifications not arriving**: inspect `notifications.delivered`; Resend dashboard (domain verification,
   bounces); SMS provider balance/sender id; Expo receipts. `DeviceNotRegistered` tokens are removed automatically.
5. **AI outage / cost spike**: switch off `feature_flags.ai_assistant` / `ai_document_extraction` in admin
   (takes effect within minutes via `revalidateTag('flags')`); change `platform_settings.ai_models` to a
   cheaper/fallback model; review `ai_usage`.
6. **Suspected data exposure**: revoke affected API keys, rotate `SUPABASE_SECRET_KEY`, review
   `audit_events` (hash-chained — run `verify_audit_chain()`), notify the Data Protection Commission
   within statutory timelines and inform affected partners/customers.
7. **Rollback**: Vercel "Instant Rollback" to the previous deployment; database changes are forward-only —
   write a corrective migration.
8. Record a post-incident note (timeline, impact, root cause, actions).

## 10. Data retention

| Data | Retention (proposal — confirm with legal/DPC registration) |
|---|---|
| Policies, payments, claims, complaints, audit events | Life of the policy + 7 years (insurance and tax records) |
| Requests that never became policies | 2 years after closure, then anonymise risk data |
| Uploaded documents (KYC, claim evidence) | With the related record; KYC images 12 months after verification unless still needed |
| Request messages | With the request |
| Notifications | 12 months |
| AI threads (`ai_threads`) | 90 days; `ai_usage` metrics 2 years (no prompt content stored) |
| Needs assessments (anonymous) | 12 months |
| Device tokens | Removed on sign-out or when Expo reports them unregistered; purge if `last_seen_at` > 180 days |
| Server logs | 30 days in the drain; never log tokens, secrets or full personal data (`mask()` helper) |

Implement purges as additional cron jobs once the policy is approved. Customers' data-subject requests
(access, correction, deletion) are handled by platform support with the broker of record; regulated
records under retention are restricted rather than deleted.

## 11. Instalments and micro cover (Phase 3)

Migration `20261030100000_instalments_micro.sql`; code in `apps/web/src/server/{instalments,micro}.ts`, pure rules in
`packages/core/src/{instalments,micro}.ts`. **Every instalment and every micro window is an ordinary premium payment** —
a `payments` row in GHS whose payee is the insurer, split pro rata (`splitForPayment` with the instalment amount) and
posted to the ledger. Covva never holds client funds.

**The rules are the insurer's.** Grace days, the lapse point, reinstatement (allowed, window, review) and any deposit /
surcharge come from the insurer's plan on the product version (`product_versions.instalment_plans`, edited by the
insurer under Products → version → "Periods, instalments and micro cover" on a draft version) and are snapshotted on
each `instalment_schedules.plan`. **NIC / insurer approval is needed per product** before short periods, instalments or
micro cover are sold: the insurer confirms the product (and its instalment terms) is approved and Covva compliance
publishes the version only then. Covva applies the rules; it never lapses or reinstates on its own judgement.

* **Checkout.** When the version has plans, checkout shows "Pay in full or in instalments?" with the schedule preview and
  the rules in plain words. The first instalment is paid through the normal checkout (`initiatePayment` with
  `plan.instalmentId`; the amount is read from the DB). Instalments are GHS only (MoMo or card), not with bank transfer
  or a sponsor plan. The policy records the full premium and `instalment_schedule_id`.
* **MoMo collection behaviour.** Mobile money "direct debit" is a prompt the payer must approve with their PIN, so a
  collection can stay `processing` until they do (or fail when they ignore / decline it). The cron prompts the payer's
  profile number when it matches the masked number chosen at checkout (`momo_phone`); otherwise — and for numbers we
  cannot prompt — it sends a pay link by in-app / push / WhatsApp / SMS (`/account/payments/instalments?pay=<id>`).
  Card plans are charged with the saved authorisation (`chargeStoredMethod`). The insurer's provider switch applies
  (Paystack mobile money charge, Hubtel checkout, or the sandbox simulator).
* **Retries:** on the due date, +2 days and +5 days (`instalments.next_attempt_at`); runs at 06:30 and 18:30. Admin →
  **Instalments** can schedule one more attempt ("Retry") or record a waiver the insurer agreed ("Waive").
* **Grace → lapse.** Past the due date the schedule is `grace` (cover in force; customer + payer notified with the
  grace end and lapse date). At `lapse_after_days` the schedule and the policy become `lapsed`; the customer, payer,
  insurer and broker are notified. Issuance hooks are not re-run.
* **Reinstatement.** Within the plan's window the customer pays all arrears (`/account/payments/instalments` or
  `POST /api/v1/instalments/schedules/{id}/reinstate`). Without review the schedule becomes `reinstated` and the policy
  `active` again (it keeps the insurer's number). With review an insurer task (`request_tasks`, kind `review`) is
  created and the insurer decides under Partner → **Instalments**; a decline refunds the arrears.
* **Micro cover.** Versions flagged `micro` with `periods` day / week / month are listed on `/micro` ("from GH₵ X/day";
  short-period prices from `rating.period_factors` / `period_min_premium`, else pro rata with a default minimum).
  Purchase is three taps (`/account/micro/buy`). Instant products — the insurer's line integration is **L2** (delegated)
  — are sold **insurer-direct** (no broker of record; `order_routing.mode = insurer_direct`, the applications guard
  allows this case only) and issued by delegated issuance; others are routed with `createRequest`. Each window is a
  `micro_sessions` row; renewal starts when the current window ends; `auto_renew` renews before the end. Cover is live
  only while the policy is active (only the insurer / delegated issuance activates it).
* **Channels.** USSD and WhatsApp call the same server functions (`buyMicroCover`, `renewMicro`, `payInstalment`,
  `reinstate`); `microQuoteText` produces an SMS / USSD-length (≤ 160 chars) quote.


## 12. USSD: aggregator setup, short code, menus, limits (Phase 3)

Migration `20261030100100_i18n_ussd_voice.sql` (`ussd_sessions`); engine `apps/web/src/server/ussd/engine.ts`, pure menu
and screen builders `packages/core/src/ussd.ts`, adapters `server/ussd/{africastalking,hubtel,arkesel,simulator}.ts`,
route `POST /api/ussd/{provider}`, staff simulator + session log in admin **USSD** (`/ussd`).

**Aggregator-dependent.** USSD needs a short code (e.g. `*920*44#`) routed by every network (MTN, Telecel,
AirtelTigo) to an aggregator, who calls our webhook on every hop. Steps:

1. **Choose an aggregator** — Africa's Talking (shared codes / dedicated codes), Hubtel (Programmable Services) or
   Arkesel. Ask for: shared vs. dedicated code, per-session pricing per network, session timeout (typically 20–180 s),
   max screen length (182 chars on most networks — we cap at **160**), and their callback egress IPs.
2. **Short code.** Dedicated codes are allocated by the **NCA (National Communications Authority)** — the aggregator
   usually files the application with the networks; allow several weeks. Start on the aggregator's shared code with an
   extension (`*920*44#`) and set `USSD_DIAL_EXTENSION=44` if they prepend it to the first input.
3. **Configure** on the web project: `USSD_PROVIDER`, `USSD_SERVICE_CODE`, `USSD_SHARED_SECRET` (random, ≥ 32 chars),
   optional `USSD_IP_ALLOWLIST[_<PROVIDER>]` with the aggregator's IPs, and the SMS provider (`SMS_PROVIDER` — links are
   sent by SMS). Set `USSD_SHARED_SECRET` + `USSD_SERVICE_CODE` on the admin project for the simulator.
4. **Callback URL** in the aggregator dashboard: `https://covva.com.gh/api/ussd/<provider>?key=<USSD_SHARED_SECRET>`.
   - *Africa's Talking*: form POST (`sessionId, serviceCode, phoneNumber, networkCode, text` — `text` is the whole
     history joined by `*`); we answer `text/plain` `CON …` / `END …`. AT does not sign callbacks → secret in the URL
     + IP allowlist.
   - *Hubtel*: JSON (`Type` Initiation/Response/Release/Timeout, `Message`, `SessionId`, `Mobile`, `Operator`); we answer
     `{ SessionId, Type: Response|Release, Message, … }`. One input per hop — the engine keeps the history.
     Hubtel can also send basic auth or a custom header: put the secret in `X-USSD-Secret` if the dashboard allows.
   - *Arkesel*: JSON (`sessionID, userID, newSession, msisdn, userData, network`); we answer
     `{ sessionID, userID, msisdn, message, continueSession }`.
   Field names vary between aggregator products — confirm against the account's docs before go-live and test with the
   aggregator's simulator plus our admin simulator.
5. **Test** with admin → USSD (the simulator runs the production engine; END actions are real: SMS, leads, MoMo prompts).

**Menus** (all copy from the i18n catalogue, `ussd.*` keys — English until approved translations exist; every screen
≤ 160 characters, enforced by `packages/core/src/ussd.test.ts`; `0` back, `00` main menu):

| Option | Flow | Ends with |
|---|---|---|
| 1 Get a quote | Motor third-party (registration → use) · Micro cover (day/week/month) · Funeral (people 1–10) | Indicative "from" price (approved products' rating rules; the insurer confirms before payment) → SMS link to buy / call me back; micro: buy now with a MoMo prompt (`buyMicroCover`) |
| 2 Renew a policy | Up to 4 policies of the number's profile | Micro: MoMo prompt (`renewMicro`); others: SMS renewal link or a callback for the broker |
| 3 Pay an instalment | Due instalments (next 7 days, `listSchedulesForUser`) | MoMo prompt (`payInstalment`) or an SMS pay link |
| 4 Check my policy | Policies on the number | Status, end date, insurer |
| 5 Make a claim | Policies (+ "not listed") | Callback booked with a `CL-XXXXX` reference (lead + broker notified). Reporting is not approval |
| 6 Talk to us | | Callback (`CB-XXXXX`) or SMS with WhatsApp/help links |

**Customer identity.** The MSISDN is normalised to E.164 and matched to `profiles.phone`. Unknown numbers can get
quotes and callbacks (a lightweight `leads` row, `source_page = ussd`) but not policy data. USSD never shows personal
data beyond the caller's own policy names, and never takes payment details — MoMo prompts are approved on the handset
with the PIN; money goes to the insurer through the PSP, never to Covva.

**Limits.** Sessions time out on the network side (often 20–60 s per screen); keep hops fast (each hop is one DB read +
write; the customer snapshot is loaded once per session). Re-sent final hops are answered with a neutral END and never
re-run an action. Screens over 160 characters are truncated with "…" (tests prevent this in the catalogue). Retention:
`ussd_sessions` hold MSISDNs and inputs — purge after 90 days once the retention policy is approved (§10).

## 13. Languages and voice notes (Phase 3)

* **Translation layer.** English source catalogue `packages/core/src/i18n/en.ts`; Twi (`tw`), Ga (`gaa`) and Ewe (`ee`)
  contain **only strings a human translator supplied** — in code (rare) or in admin → **Translations** (draft →
  reviewed → approved; CSV import/export; placeholders must match). Approving revalidates the web app's `translations`
  tag. Visitors choose a language in the header (`covva_lang` cookie; signed-in users also get `profiles.locale`);
  partial/planned locales show "<Language> translations are in progress — untranslated text is shown in English".
  The mobile app reads `GET /api/v1/i18n/{locale}`.
* **Voice notes** (claim description, request help): MediaRecorder ≤ 120 s or an audio file → `documents` bucket
  `voice/<owner>/…` → transcript in `after()` via `TRANSCRIPTION_PROVIDER` (gateway / openai / none). The customer
  edits the "Automatic transcript — please check" and adds it to the form; nothing is auto-submitted. Notes are linked
  to the request/claim on submit so the broker and insurer can listen. Twi/Ga/Ewe transcription is unreliable today —
  the UI says so.
