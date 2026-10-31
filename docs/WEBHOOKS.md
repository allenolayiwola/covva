# Partner webhooks

Brokers and insurers can receive signed HTTP callbacks when things happen on the platform.
Endpoints are managed in the partner workspace (**Team settings → Developer → Webhooks**) by
organisation owners/admins, or through `webhook_endpoints` for platform staff.

Webhooks are **notifications, not the record**: always confirm the current state with the
API (`GET /api/v1/partner/requests`, `/policies/{id}`, `/claims/{id}` …) before acting on
one. Payment confirmation never activates cover; `policy.issued` is the only event that
means a policy is active.

## Delivery

* `POST` to your HTTPS endpoint, `Content-Type: application/json`, user agent `Covva-Webhooks/1.0`.
* Headers:

  | Header | Value |
  |---|---|
  | `x-covva-event` | event name, e.g. `policy.issued` |
  | `x-covva-delivery` | delivery id (unique per attempt series; retries reuse it — use it to de-duplicate) |
  | `x-covva-timestamp` | Unix seconds when the request was signed |
  | `x-covva-signature` | `HMAC-SHA256(secret, "{timestamp}.{raw body}")` as lower-case hex |

* Respond with any `2xx` within 10 seconds. Anything else (or a timeout) is a failure.
* Retries: 1 min, 5 min, 30 min, 2 h, 12 h after each failure — five attempts in total, run by the
  `webhook-retry` cron (every 10 minutes). After the last attempt the delivery is marked as given up;
  the delivery log in settings shows status, attempts, last error and next retry. Pausing an endpoint
  stops its retries.
* Order is not guaranteed and a delivery can arrive more than once — handlers must be idempotent.

### Verifying the signature (Node)

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

export function verify(secret: string, headers: Headers, rawBody: string): boolean {
  const ts = headers.get("x-covva-timestamp") ?? "";
  const sig = headers.get("x-covva-signature") ?? "";
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false; // 5-minute replay window
  const expected = createHmac("sha256", secret).update(`${ts}.${rawBody}`).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(sig, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

Compute the HMAC over the **raw** request body exactly as received, not over re-serialised JSON.

## Envelope

```json
{
  "id": "1042",
  "event": "policy.issued",
  "created_at": "2026-10-26T14:03:11.512Z",
  "attempt": 1,
  "org_id": "7f1e…",
  "data": { "policy_id": "…", "internal_reference": "POL-10021", "policy_number": "CG/MTR/2026/001234", "request_id": "…", "status": "active", "cover_start": "2026-11-01", "cover_end": "2027-10-31" }
}
```

`org_id` is the organisation the endpoint belongs to. **Payloads contain ids, references,
statuses, amounts and dates only — never customer names, contact details, documents or risk
data.** Fetch anything else through the API with your key, which applies your organisation's
access rights.

## Events

Subscribe per endpoint to any of these (or `*` via the database for everything).

| Event | Sent to | `data` |
|---|---|---|
| `request.created` | Broker of record | `request_id, reference, status, type, category, source` (also sent to the new broker after a hand-over, with `handed_over_from`) |
| `request.status_changed` | Broker of record | `request_id, reference, from_status, status` |
| `quote.ready` | Broker of record | `request_id, reference, quotes, binding` (or `quote_id, insurer_org_id, status` for a single binding quote posted by API) |
| `application.submitted` | Broker of record | `request_id, reference, application_id, quote_id, status` |
| `payment.succeeded` | Broker + insurer | `payment_id, request_id, reference, provider_reference, quote_id, policy_id, amount, currency, status` — policy is `pending_issuance`, not active |
| `policy.issued` | Broker + insurer | `policy_id, internal_reference, policy_number, request_id, status, cover_start, cover_end` |
| `claim.reported` | Broker + insurer | `claim_id, reference, policy_id, status, incident_type` |
| `claim.status_changed` | Broker + insurer | `claim_id, reference, from_status, status` |
| `complaint.filed` | Owning organisation | `complaint_id, reference, status, category, against_party, request_id, policy_id, claim_id` |
| `referral.converted` | Distribution partner (or broker) that owns the referral code | `attribution_id, code, source, request_id, reference, policy_id, category, converted_at` — the referred customer's policy is now active |
| `referral.rewarded` | Distribution partner | `attribution_id, code, policy_id, kind, amount, currency` — revenue share accrued from **Covva's platform fee** (never the premium) after the 14-day holding period; paid by statement |
| `test.ping` | The endpoint you test from settings | `message, org_id, sent_at` |

The canonical list lives in `apps/web/src/server/webhook-events.ts`; the dispatcher is
`apps/web/src/server/webhooks.ts` (`emitEvent(orgId, event, payload)`).

## Operations

* Deliveries are stored in `webhook_deliveries` (`status`, `attempts`, `next_attempt_at`,
  `delivered_at`, `last_error`, `response_ms`); endpoints keep `last_delivery_at` / `last_status`.
* Endpoint URLs must be public `https://` addresses (private/loopback hosts are refused; `http://localhost`
  is allowed only outside production).
* Rotate a secret by deleting and re-creating the endpoint (a new secret is generated per endpoint).
* Logs: `webhooks.delivered`, `webhooks.delivery_failed`, `webhooks.queue_failed`, `webhooks.unconfigured`
  (service key missing — nothing is queued).

## Inbound webhooks (providers → Covva)

Besides the partner webhooks above, the web app receives provider callbacks. All are idempotent and
verify the caller before touching data:

| Route | Provider | Verification | Idempotency |
|---|---|---|---|
| `POST /api/webhooks/paystack` | Paystack | `x-paystack-signature` (HMAC-SHA512 of the raw body with the secret key) | payment reference; a success is never applied twice |
| `POST /api/webhooks/hubtel` | Hubtel | unsigned → `?secret=HUBTEL_WEBHOOK_SECRET` / `x-hubtel-secret`, then re-verified with the status API | payment reference |
| `GET /api/webhooks/whatsapp` | Meta (WhatsApp Cloud API) | `hub.verify_token` must equal `WHATSAPP_VERIFY_TOKEN`; echoes `hub.challenge` | — |
| `POST /api/webhooks/whatsapp` | Meta (WhatsApp Cloud API) | `X-Hub-Signature-256: sha256=<HMAC-SHA256 of the raw body with WHATSAPP_APP_SECRET>` (constant-time compare); per-IP rate limit | `wa_messages.wa_message_id` is unique: a replayed message is a no-op; delivery statuses only move forward |

**WhatsApp payload.** Meta posts `{ object: "whatsapp_business_account", entry: [{ changes: [{ field: "messages",
value: { metadata, contacts, messages?, statuses? } }] }] }`. `parseWebhookPayload()` (`@im/core`) turns it into
`WaInboundMessage[]` (text, template quick-reply `button`, `interactive` button/list replies, image/document/
audio by media id, location; stickers/video are `unsupported`) and `WaStatusUpdate[]` (`sent`, `delivered`,
`read`, `failed` + error code). The route answers `200 { ok: true, data: { received, messages, statuses,
duplicates, actions } }` once the signature is valid; a processing error on one message is logged
(`whatsapp.route_failed`) and does not make Meta retry the whole batch. Events for a different
`phone_number_id` than `WHATSAPP_PHONE_NUMBER_ID` are ignored. See `docs/OPERATIONS.md` → "WhatsApp Business".


## Payment and identity test-mode gates (W1c)

`PAYMENT_PROVIDER` selects `simulator` (default), `paystack`, `hubtel`, or `stripe`.
No selected credentials means simulator, including production. `PAYMENTS_MODE` defaults to
`test`. Real Paystack test calls require `PAYMENT_PROVIDER` plus `PAYSTACK_SECRET_KEY` with
a test prefix; tests in this repo mock transport and never call Paystack.
Startup and runtime reject a live-prefixed key without explicit live mode, a test-prefixed key
with live mode, unknown selectors, and unrecognised prefixes. Errors contain variable names only.
`PAYMENTS_SIMULATOR=false` disables simulation; `true` cannot override live mode.
Insurer preferences cannot bypass the deployment gate.

All inbound payment routes reject inactive providers before processing:

- Paystack verifies exact HMAC-SHA512 over the raw body with `PAYSTACK_SECRET_KEY`.
  Paystack uses that API secret for webhook signing; there is **no separate Paystack webhook-secret variable**.
- Hubtel requires `HUBTEL_WEBHOOK_SECRET` (header or callback query) and re-verifies **all**
  outcomes against the status API, including failures and refunds. Unconfirmed outcomes return
  503 for retry. Success requires a verified amount. Hubtel has no documented prefix contract in
  this integration: unprefixed credentials fail closed and must not be relabelled to bypass it.
- Stripe verifies `STRIPE_WEBHOOK_SECRET`, strict hexadecimal HMAC-SHA256 and a finite timestamp
  within five minutes; key rotation may supply multiple signatures. The Stripe insurer settlement
  adapter remains unsupported and checkout cannot be enabled merely by providing credentials.
- Simulator GET/POST links use reference-bound HMAC authentication and are rejected in live mode,
  even if `PAYMENTS_SIMULATOR` is enabled. The result service repeats this guard.

Payment references bind callbacks to the recorded provider. Conditional updates claim eligible
payments once (including a verified late success after failure/abandonment); duplicate success cannot reissue a policy or resurrect a refunded/reversed payment.
Removing provider credentials cannot turn a real Paystack refund into a simulated refund.
Payment confirmation still creates pending issuance and invokes the existing insurer issuance flow.
The no-network unit journey exercises checkout, signed simulator HTTP completion, persistence,
issuance handoff, replay and live-mode rejection. It does not replace a database-backed Playwright run.

`IDENTITY_PROVIDER` defaults to `manual` (`stub` is an alias). The shared `IdentityProvider`
contract exposes Ghana Card verification and DVLA lookup. NIA and DVLA are **placeholder test
contracts**, not validated live integrations: only labelled test fixture keys are accepted, and
missing configuration returns pending manual review / manual vehicle entry. DVLA additionally
requires explicit `VEHICLE_LOOKUP_PROVIDER`. There is no identity inbound webhook route today;
do not configure one until its provider contract and authentication have been implemented.

### Allen / Overwatch live checklist (names only; no credentials in the repository)

For **Paystack P1**, after provider onboarding and staging validation:

- Web deployment: `PAYMENT_PROVIDER`, `PAYMENTS_MODE`, `PAYSTACK_SECRET_KEY`,
  `PAYSTACK_SPLIT_GROUP_CODE`, `NEXT_PUBLIC_SITE_URL`, `SUPABASE_SECRET_KEY`.
  Select Paystack and live mode together with a live-prefixed secret, using the secure deployment
  configuration process. Existing test/no-key deployments need no changes.
- Configure the Paystack dashboard callback at `/api/webhooks/paystack`. Its signing secret is
  `PAYSTACK_SECRET_KEY`; do not invent or set `PAYSTACK_WEBHOOK_SECRET`.
- Provision each insurer's `organizations.paystack_subaccount_code`, and its approved three-party
  split (`organizations.paystack_split_code` or `PAYSTACK_SPLIT_GROUP_CODE`). Keys cannot provision
  settlement accounts. Validate insurer/broker/platform allocations and a refund in staging.
- Admin visibility: set `NEXT_PUBLIC_SITE_URL` on admin, and the same `REVALIDATE_SECRET` on web and
  admin. The staff-only reconciliation page reads web's authenticated `GET /api/payments/mode`,
  displaying Simulator/Test/Live read-only. Missing configuration or a failed request displays
  Unavailable rather than guessing from the admin deployment's environment. Do not copy PSP keys to admin.
- Optional existing channels: `PAYSTACK_DVA_ENABLED`, `PAYSTACK_DVA_BANK`, `PAYSTACK_APPLE_PAY`,
  `PAYSTACK_MANAGED_SUBSCRIPTIONS`, `DIASPORA_PSP`. These remain opt-in.

**Not turnkey / retained for Overwatch:** P3 needs the actual NIA and DVLA contracts and a reviewed
live-mode credential discriminator before setting `IDENTITY_PROVIDER`, `NIA_API_URL`, `NIA_API_KEY`,
`VEHICLE_LOOKUP_PROVIDER`, `DVLA_API_URL`, `DVLA_API_KEY`. No NIA webhook secret is consumed today.
Hubtel likewise needs a verified sandbox/live credential scheme before using `HUBTEL_CLIENT_ID`,
`HUBTEL_CLIENT_SECRET`, `HUBTEL_MERCHANT_ACCOUNT`, `HUBTEL_WEBHOOK_SECRET`. Stripe still needs legal
and settlement implementation before `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`,
`STRIPE_SETTLEMENT_APPROVED` can enable a collection flow. Never rename or wrap a real key to
make it pass a prefix check. W1c changes no hosted variables, provider settings or databases.
