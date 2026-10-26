import { randomUUID } from "node:crypto";
import { applyPaymentResult } from "@/server/payments";
import { verifyStripeSignature } from "@/server/providers/stripe";
import { log } from "@/server/log";

interface StripeEvent {
  id: string;
  type: string;
  data: { object: { id?: string; amount?: number; amount_total?: number; currency?: string; status?: string; payment_status?: string; metadata?: Record<string, string>; client_reference_id?: string; last_payment_error?: { message?: string } } };
}

/**
 * POST /api/webhooks/stripe — Stripe events for the (OFF by default) diaspora card PSP. Verifies
 * `Stripe-Signature` with `STRIPE_WEBHOOK_SECRET`. A completed Checkout Session / succeeded
 * PaymentIntent is applied through the same idempotent `applyPaymentResult` path by the Covva
 * reference carried in `metadata.reference`. See docs/OPERATIONS.md → Diaspora payments: this rail
 * needs a legal view before it is switched on because Stripe settles foreign currency to Covva
 * before the insurer is paid.
 */
export async function POST(req: Request) {
  const requestId = randomUUID();
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get("stripe-signature"))) {
    log.warn("stripe.webhook_bad_signature", { requestId });
    return Response.json({ ok: false, error: { code: "unauthorised", message: "Invalid signature" } }, { status: 401 });
  }
  let evt: StripeEvent;
  try {
    evt = JSON.parse(raw) as StripeEvent;
  } catch {
    return Response.json({ ok: false, error: { code: "invalid_input", message: "Invalid JSON" } }, { status: 400 });
  }
  const o = evt.data?.object ?? {};
  const ref = o.metadata?.reference ?? o.client_reference_id;
  log.info("stripe.webhook", { requestId, type: evt.type, reference: ref });
  try {
    if (ref) {
      switch (evt.type) {
        case "checkout.session.completed":
        case "payment_intent.succeeded":
          if (evt.type === "checkout.session.completed" && o.payment_status && o.payment_status !== "paid") break;
          // Stripe amounts are in the DISPLAY currency; the GHS contract amount is on the payment row,
          // so no minor-unit comparison is possible here — the currency check is skipped on purpose.
          await applyPaymentResult(ref, { status: "succeeded", paidAt: new Date().toISOString(), channel: "card", event: evt as unknown, source: "webhook" });
          break;
        case "payment_intent.payment_failed":
        case "checkout.session.expired":
          await applyPaymentResult(ref, { status: evt.type === "checkout.session.expired" ? "abandoned" : "failed", failureReason: o.last_payment_error?.message ?? "Declined", event: evt as unknown, source: "webhook" });
          break;
        case "charge.refunded":
          await applyPaymentResult(ref, { status: "refunded", event: evt as unknown, source: "webhook" });
          break;
        default:
          break;
      }
    }
  } catch (err) {
    log.error("stripe.webhook_failed", { requestId, reference: ref, err });
    return Response.json({ ok: false, error: { code: "internal_error", message: "Processing failed" } }, { status: 500 });
  }
  return Response.json({ ok: true, data: { received: true } });
}
