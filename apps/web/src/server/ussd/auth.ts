import "server-only";
import { isUssdProvider, type UssdProvider } from "@im/core";
import { secretMatches } from "@/server/env";
import { clientIp } from "@/server/api-auth";

/**
 * Who may call `/api/ussd/{provider}`.
 *
 *  - `USSD_PROVIDER` names the live aggregator (africastalking | hubtel | arkesel). Other real
 *    providers are refused (404). The `simulator` adapter is always routable but needs the secret.
 *  - `USSD_SHARED_SECRET` must be presented as `X-USSD-Secret: …`, `Authorization: Bearer …` or
 *    `?key=…` in the callback URL (aggregators that can't send headers — Africa's Talking — use
 *    the query form). Without a secret configured, only non-production environments accept calls.
 *  - Optional IP allowlist: `USSD_IP_ALLOWLIST` (comma-separated exact IPs) or a provider-specific
 *    `USSD_IP_ALLOWLIST_AFRICASTALKING` / `_HUBTEL` / `_ARKESEL`. Use the aggregator's published
 *    egress IPs (they change — check their docs) in addition to the secret.
 */
export type UssdAuthResult = { ok: true } | { ok: false; status: 401 | 403 | 404 | 503; message: string };

export function activeProviders(): UssdProvider[] {
  const configured = (process.env.USSD_PROVIDER ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(isUssdProvider);
  return [...new Set<UssdProvider>([...configured, "simulator"])];
}

export function authorizeUssd(req: Request, provider: UssdProvider): UssdAuthResult {
  const prod = process.env.NODE_ENV === "production";
  if (provider !== "simulator" && !activeProviders().includes(provider) && (prod || process.env.USSD_PROVIDER)) {
    return { ok: false, status: 404, message: "USSD provider not enabled" };
  }
  const allow = (process.env[`USSD_IP_ALLOWLIST_${provider.toUpperCase()}`] ?? process.env.USSD_IP_ALLOWLIST ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (allow.length && provider !== "simulator" && !allow.includes(clientIp(req))) {
    return { ok: false, status: 403, message: "Source IP not allowed" };
  }
  const secret = process.env.USSD_SHARED_SECRET;
  if (!secret) {
    return prod ? { ok: false, status: 503, message: "USSD is not configured (USSD_SHARED_SECRET)" } : { ok: true };
  }
  const url = new URL(req.url);
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.get("authorization") ?? "")?.[1]?.trim();
  const provided = req.headers.get("x-ussd-secret") ?? bearer ?? url.searchParams.get("key");
  return secretMatches(provided, secret) ? { ok: true } : { ok: false, status: 401, message: "Invalid USSD secret" };
}
