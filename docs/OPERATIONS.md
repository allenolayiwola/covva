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
| `LOG_LEVEL` | no | no | `debug` for verbose logs |

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

## 3. Supabase Auth settings

* **Site URL**: `https://<web-host>`.
* **Redirect URLs**: `https://<web-host>/auth/callback`, `https://<web-host>/**` (previews:
  `https://*-<team>.vercel.app/**`), `covva://auth/callback`, `exp://**` (Expo Go dev only),
  admin host `https://<admin-host>/auth/callback`.
* **Providers**: Email (confirm email on; OTP length 6), Phone with an SMS provider (Twilio/MessageBird/Vonage
  or a Send-SMS hook to Arkesel/Hubtel) for phone OTP; set OTP expiry ≤ 10 minutes.
* **MFA**: enable TOTP. The admin portal requires AAL2 for platform staff.
* **JWT signing keys**: asymmetric keys recommended (`getClaims()` verifies locally via JWKS).
* **Rate limits**: tighten OTP/sign-up limits; enable CAPTCHA (hCaptcha/Turnstile) for sign-up if abused.
* Custom SMTP (Resend) for auth emails with the brand sender.

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
