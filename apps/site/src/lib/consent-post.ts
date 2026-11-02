import { CONSENT_COOKIE, CONSENT_MAX_AGE, type ConsentChoice } from "@/components/marketing/analytics";

/** Fragment the no-JavaScript consent redirect adds, so CSS can hide the banner on the page it returns to. */
export const CONSENT_SAVED_HASH = "consent-saved";

export type ConsentPostResult =
  | { ok: true; choice: ConsentChoice; cookie: string; location: string }
  | { ok: false; status: 400 | 403 };

/**
 * Decides a consent choice posted by the cookie banner's form (used before the page has hydrated, or without
 * JavaScript; after hydration the banner writes the cookie itself). Pure, so it is unit-tested.
 *
 * - Only same-origin posts count: a cross-site form must not be able to opt a visitor in (Act 843 requires the
 *   visitor's own choice). Browsers send Sec-Fetch-Site; older ones fall back to the Origin header.
 * - Only the three known values are accepted; "all" becomes "analytics" when no advertising pixel is configured,
 *   matching what the banner's Accept button stores.
 * - The visitor returns to the page they were on (same-origin Referer only, else "/").
 */
export function decideConsentPost(input: {
  choice: unknown;
  requestUrl: string;
  origin: string | null;
  secFetchSite: string | null;
  referer: string | null;
  pixelsConfigured: boolean;
}): ConsentPostResult {
  const self = new URL(input.requestUrl);
  const sameOrigin = input.secFetchSite ? input.secFetchSite === "same-origin" : input.origin === self.origin;
  if (!sameOrigin) return { ok: false, status: 403 };

  const raw = input.choice;
  if (raw !== "essential" && raw !== "analytics" && raw !== "all") return { ok: false, status: 400 };
  const choice: ConsentChoice = raw === "all" && !input.pixelsConfigured ? "analytics" : raw;

  let back = "/";
  if (input.referer) {
    try {
      const ref = new URL(input.referer);
      if (ref.origin === self.origin) back = `${ref.pathname}${ref.search}`;
    } catch {
      // Malformed Referer: fall back to the home page.
    }
  }
  const secure = self.protocol === "https:" ? "; Secure" : "";
  return {
    ok: true,
    choice,
    cookie: `${CONSENT_COOKIE}=${choice}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure}`,
    location: `${back}#${CONSENT_SAVED_HASH}`,
  };
}
