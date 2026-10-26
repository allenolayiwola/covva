"use server";
import { BusinessRuleError } from "@/server/requests";
import { decideConsentViaLink } from "@/server/diaspora";

/** Accept / decline from the signed consent link. No session needed: the token is the credential. */
export async function decideConsent(token: string, granted: boolean): Promise<{ ok: true; status: "granted" | "declined" } | { ok: false; error: string }> {
  try {
    const r = await decideConsentViaLink(decodeURIComponent(token), granted);
    return { ok: true, status: r.status };
  } catch (err) {
    return { ok: false, error: err instanceof BusinessRuleError ? err.message : "We couldn't record your decision. Please try again." };
  }
}
