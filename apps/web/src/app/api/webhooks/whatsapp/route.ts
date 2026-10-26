import { randomUUID } from "node:crypto";
import type { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { clientIp, takeToken } from "@/server/api-auth";
import { log } from "@/server/log";
import { handleWebhook, verifyChallenge, verifySignature } from "@/server/whatsapp/webhook";

export const maxDuration = 60;

const LIMIT = { capacity: 600, refillPerSecond: 20, name: "whatsapp-webhook" };

/** GET /api/webhooks/whatsapp — Meta's subscription verification (hub.challenge). */
export async function GET(req: NextRequest) {
  const r = verifyChallenge(req.nextUrl.searchParams);
  if (!r.ok) return new Response(r.status === 503 ? "WHATSAPP_VERIFY_TOKEN not set" : "Forbidden", { status: r.status });
  return new Response(r.challenge, { status: 200, headers: { "content-type": "text/plain" } });
}

/**
 * POST /api/webhooks/whatsapp — inbound messages and delivery statuses. Verifies
 * `X-Hub-Signature-256` (HMAC-SHA256 of the raw body with WHATSAPP_APP_SECRET) and
 * processes idempotently (unique wa_message_id). Always answers 200 once the signature
 * checks out so Meta does not retry a batch we already applied; processing errors are
 * logged per message.
 */
export async function POST(req: NextRequest) {
  const requestId = randomUUID();
  const rl = takeToken(`${LIMIT.name}|${clientIp(req)}`, LIMIT);
  if (!rl.ok) return Response.json({ ok: false, error: { code: "rate_limited", message: "Too many requests" } }, { status: 429, headers: { "retry-after": String(rl.retryAfter) } });
  const raw = await req.text();
  if (!verifySignature(raw, req.headers.get("x-hub-signature-256"))) {
    log.warn("whatsapp.webhook_bad_signature", { requestId });
    return Response.json({ ok: false, error: { code: "unauthorised", message: "Invalid signature" } }, { status: 401 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return Response.json({ ok: false, error: { code: "invalid_input", message: "Invalid JSON" } }, { status: 400 });
  }
  let svc: ReturnType<typeof createServiceClient>;
  try {
    svc = createServiceClient();
  } catch {
    log.error("whatsapp.webhook_unconfigured", { requestId });
    return Response.json({ ok: false, error: { code: "unavailable", message: "Not configured" } }, { status: 503 });
  }
  const outcome = await handleWebhook(svc, body);
  log.info("whatsapp.webhook", { requestId, ...outcome });
  return Response.json({ ok: true, data: { received: true, ...outcome } });
}
