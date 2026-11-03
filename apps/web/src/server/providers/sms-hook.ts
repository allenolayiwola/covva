/**
 * Supabase Auth "Send SMS" hook: Supabase generates the one-time code and POSTs it here; we send it
 * through our SMS provider (Arkesel/Hubtel via `sendSms`). Pure helpers only, so they are unit-testable.
 * Payload: { user: { phone, ... }, sms: { otp } }. Reply 200 `{}` on success; on failure, a 4xx/5xx with
 * `{ error: { http_code, message } }`, which Supabase shows to the user signing in.
 */
export interface SmsHookPayload {
  user?: { phone?: string | null } | null;
  sms?: { otp?: string | null } | null;
}

export type ParsedSmsHook = { ok: true; phone: string; otp: string } | { ok: false; message: string };

export function parseSmsHook(raw: string): ParsedSmsHook {
  let body: SmsHookPayload;
  try {
    body = JSON.parse(raw) as SmsHookPayload;
  } catch {
    return { ok: false, message: "Invalid JSON" };
  }
  const phone = body?.user?.phone?.trim();
  const otp = body?.sms?.otp?.trim();
  if (!phone) return { ok: false, message: "Missing phone number" };
  if (!otp || !/^\d{4,10}$/.test(otp)) return { ok: false, message: "Missing or invalid code" };
  return { ok: true, phone, otp };
}

/** The text the customer receives. Short (one SMS segment) and never includes a link. */
export function otpMessage(otp: string, minutes = 10): string {
  return `Your Covva code is ${otp}. It expires in ${minutes} minutes. Do not share it with anyone.`;
}

export function hookError(httpCode: number, message: string): Response {
  return Response.json({ error: { http_code: httpCode, message } }, { status: httpCode });
}
