import { randomUUID } from "node:crypto";
import { applyPaymentResult, applyRefundFailed, verifyPaystackSignature } from "@/server/payments";
import { log } from "@/server/log";

interface PaystackEvent {
  event: string;
  data: {
    reference?: string;
    status?: string;
    amount?: number;
    currency?: string;
    paid_at?: string | null;
    channel?: string | null;
    gateway_response?: string;
    subaccount?: { subaccount_code?: string } | null;
    transaction_reference?: string;
  };
}

/**
 * POST /api/webhooks/paystack — Paystack events. Verifies `x-paystack-signature`
 * (HMAC-SHA512 of the raw body with the secret key). Idempotent: results are applied
 * through `applyPaymentResult`, which never applies a success twice.
 */
export async function POST(req: Request) {
  const requestId = randomUUID();
  const raw = await req.text();
  if (!verifyPaystackSignature(raw, req.headers.get("x-paystack-signature"))) {
    log.warn("paystack.webhook_bad_signature", { requestId });
    return Response.json({ ok: false, error: { code: "unauthorised", message: "Invalid signature" } }, { status: 401 });
  }
  let evt: PaystackEvent;
  try {
    evt = JSON.parse(raw) as PaystackEvent;
  } catch {
    return Response.json({ ok: false, error: { code: "invalid_input", message: "Invalid JSON" } }, { status: 400 });
  }
  const ref = evt.data?.reference ?? evt.data?.transaction_reference;
  log.info("paystack.webhook", { requestId, event: evt.event, reference: ref });
  try {
    if (ref) {
      switch (evt.event) {
        case "charge.success":
          await applyPaymentResult(ref, {
            status: "succeeded",
            amountMinor: evt.data.amount,
            currency: evt.data.currency,
            paidAt: evt.data.paid_at ?? null,
            channel: evt.data.channel ?? null,
            subaccountCode: evt.data.subaccount?.subaccount_code ?? null,
            event: evt as unknown,
            source: "webhook",
          });
          break;
        case "charge.failed":
          await applyPaymentResult(ref, { status: "failed", failureReason: evt.data.gateway_response ?? "Declined", event: evt as unknown, source: "webhook" });
          break;
        case "refund.processed":
          await applyPaymentResult(ref, { status: "refunded", paidAt: evt.data.paid_at ?? null, event: evt as unknown, source: "webhook" });
          break;
        case "refund.failed":
          await applyRefundFailed(ref, evt as unknown);
          break;
        case "refund.pending":
          break;
        case "charge.dispute.create":
          log.warn("paystack.dispute", { requestId, reference: ref });
          break;
        default:
          break;
      }
    }
  } catch (err) {
    // Non-2xx makes Paystack retry; safe because processing is idempotent.
    log.error("paystack.webhook_failed", { requestId, reference: ref, err });
    return Response.json({ ok: false, error: { code: "internal_error", message: "Processing failed" } }, { status: 500 });
  }
  return Response.json({ ok: true, data: { received: true } });
}
