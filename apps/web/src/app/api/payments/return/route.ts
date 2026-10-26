import type { NextRequest } from "next/server";
import { DEEP_LINK_SCHEME } from "@im/core";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyPayment } from "@/server/payments";
import { log } from "@/server/log";

/**
 * GET /api/payments/return?reference=… — use as `callbackUrl` from the mobile app.
 * Verifies the payment, then redirects to `covva://payments/return?…`
 * so an in-app auth session (expo-web-browser openAuthSessionAsync) can close.
 */
export async function GET(req: NextRequest) {
  const reference = req.nextUrl.searchParams.get("reference") ?? req.nextUrl.searchParams.get("trxref") ?? "";
  let status = "unknown";
  let requestId = "";
  let paymentId = "";
  if (/^[A-Za-z0-9-]{6,64}$/.test(reference)) {
    try {
      status = (await verifyPayment(reference)).status;
      const { data } = await createServiceClient().from("payments").select("id, request_id").eq("provider_reference", reference).maybeSingle();
      requestId = data?.request_id ?? "";
      paymentId = data?.id ?? "";
    } catch (err) {
      log.warn("payment.return_verify_failed", { reference, err });
    }
  }
  const target = new URL(`${DEEP_LINK_SCHEME}://payments/return`);
  target.search = new URLSearchParams({ reference, status, requestId, paymentId }).toString();
  return new Response(null, { status: 302, headers: { location: target.toString(), "cache-control": "no-store" } });
}
