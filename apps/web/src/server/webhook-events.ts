/**
 * Partner webhook event catalogue. Safe to import anywhere (no server-only code):
 * the partner settings UI lists these, `server/webhooks.ts` emits them and
 * `docs/WEBHOOKS.md` documents each payload.
 *
 * Payloads only ever carry ids, references and statuses — never personal data.
 */
export const WEBHOOK_EVENTS = [
  "request.created",
  "request.status_changed",
  "quote.ready",
  "application.submitted",
  "payment.succeeded",
  "policy.issued",
  "claim.reported",
  "claim.status_changed",
  "complaint.filed",
  "test.ping",
] as const;

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export const WEBHOOK_EVENT_DESCRIPTIONS: Record<WebhookEvent, string> = {
  "request.created": "A request has been routed to your organisation (brokers).",
  "request.status_changed": "A request you are party to changed status.",
  "quote.ready": "Binding quotes were sent to the customer for comparison.",
  "application.submitted": "The customer applied for one of the quotes.",
  "payment.succeeded": "The payment provider confirmed the premium (policy created as pending issuance).",
  "policy.issued": "The insurer issued the policy; cover is active.",
  "claim.reported": "A customer reported a claim on a policy you are party to.",
  "claim.status_changed": "A claim changed status (decisions are always the insurer's).",
  "complaint.filed": "A customer filed a complaint owned by your organisation.",
  "test.ping": "Sent from the settings page to check an endpoint.",
};

/** Retry schedule after a failed delivery (minutes). Five attempts in total. */
export const WEBHOOK_BACKOFF_MINUTES = [1, 5, 30, 120, 720] as const;
export const WEBHOOK_MAX_ATTEMPTS = WEBHOOK_BACKOFF_MINUTES.length;
