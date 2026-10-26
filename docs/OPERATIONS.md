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
| `WHATSAPP_PROVIDER`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_TEMPLATE_*` | **yes** (token) | no | WhatsApp Cloud API (`meta`) for opted-in customers; `log` (default) only logs. Renewal reminders go WhatsApp first, SMS as fallback |
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
