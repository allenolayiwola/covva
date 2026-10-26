import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { applyPaymentResult, hubtelChannel } from "@/server/payments";
import { hubtelVerify, parseHubtelCallback, verifyHubtelWebhook } from "@/server/providers/hubtel";
import { log } from "@/server/log";

/**
 * POST /api/webhooks/hubtel — Hubtel checkout callbacks. Hubtel does not sign callbacks, so the
 * request must carry the shared secret (`x-hubtel-secret` header or `?secret=` on the callback URL
 * we registered) AND every success is re-verified with Hubtel's transaction-status API before it is
 * applied. Idempotent through `applyPaymentResult`.
 */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const provided = req.headers.get("x-hubtel-secret") ?? req.nextUrl.searchParams.get("secret");
  if (!verifyHubtelWebhook(provided)) {
    log.warn("hubtel.webhook_bad_secret", { requestId });
    return Response.json({ ok: false, error: { code: "unauthorised", message: "Invalid secret" } }, { status: 401 });
  }
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: { code: "invalid_input", message: "Invalid JSON" } }, { status: 400 });
  }
  const cb = parseHubtelCallback(body);
  log.info("hubtel.webhook", { requestId, reference: cb.clientReference, status: cb.status });
  if (!cb.clientReference) return Response.json({ ok: true, data: { received: true } });

  try {
    const svc = createServiceClient();
    const { data: payment } = await svc.from("payments").select("id, provider, settlement_subaccount").eq("provider_reference", cb.clientReference).maybeSingle();
    if (!payment || payment.provider !== "hubtel") return Response.json({ ok: true, data: { received: true } });

    if (cb.status === "succeeded") {
      // Trust the status API, not the callback body.
      const v = await hubtelVerify(cb.clientReference, payment.settlement_subaccount);
      if (v.ok && v.status === "succeeded") {
        await applyPaymentResult(cb.clientReference, {
          status: "succeeded",
          amountMinor: v.amount !== undefined ? Math.round(v.amount * 100) : undefined,
          paidAt: v.paidAt,
          channel: hubtelChannel(v.paymentMethod ?? cb.paymentMethod),
          event: { source: "webhook", callback: body, verify: v.raw },
          source: "webhook",
        });
      } else {
        log.warn("hubtel.webhook_unverified_success", { requestId, reference: cb.clientReference, verified: v.status });
      }
    } else if (cb.status === "failed") {
      await applyPaymentResult(cb.clientReference, { status: "failed", failureReason: "Payment was not completed at Hubtel", event: { source: "webhook", callback: body }, source: "webhook" });
    } else if (cb.status === "refunded") {
      await applyPaymentResult(cb.clientReference, { status: "refunded", event: { source: "webhook", callback: body }, source: "webhook" });
    }
  } catch (err) {
    log.error("hubtel.webhook_failed", { requestId, reference: cb.clientReference, err });
    return Response.json({ ok: false, error: { code: "internal_error", message: "Processing failed" } }, { status: 500 });
  }
  return Response.json({ ok: true, data: { received: true } });
}
