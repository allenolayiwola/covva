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

