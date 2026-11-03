import { randomUUID } from "node:crypto";
import { log, mask } from "@/server/log";
import { sendSms } from "@/server/notify";
import { verifyStandardWebhook } from "@/server/providers/signatures";
import { hookError, otpMessage, parseSmsHook } from "@/server/providers/sms-hook";

/**
 * POST /api/auth/sms-hook — Supabase Auth "Send SMS" hook. Supabase signs each call (Standard Webhooks)
 * with SUPABASE_SMS_HOOK_SECRET; we verify it, then send the sign-in code through SMS_PROVIDER
 * (Arkesel). Configure in Supabase: Authentication → Hooks → Send SMS hook → HTTPS → this URL.
 */
export async function POST(req: Request) {
  const requestId = randomUUID();
  const raw = await req.text();
  const verified = verifyStandardWebhook(
    raw,
    { id: req.headers.get("webhook-id"), timestamp: req.headers.get("webhook-timestamp"), signature: req.headers.get("webhook-signature") },
    process.env.SUPABASE_SMS_HOOK_SECRET,
  );
  if (!verified) {
    log.warn("sms_hook.bad_signature", { requestId });
    return hookError(401, "Invalid signature");
  }
  const parsed = parseSmsHook(raw);
  if (!parsed.ok) {
    log.warn("sms_hook.bad_payload", { requestId, reason: parsed.message });
    return hookError(400, parsed.message);
  }
  const result = await sendSms(parsed.phone, otpMessage(parsed.otp));
  if (!result.ok) {
    log.error("sms_hook.send_failed", { requestId, to: mask(parsed.phone), provider: result.provider, status: result.status, error: result.error });
    return hookError(502, "We couldn't send your code by SMS. Try again shortly or sign in with email.");
  }
  log.info("sms_hook.sent", { requestId, to: mask(parsed.phone), provider: result.provider });
  return Response.json({});
}
