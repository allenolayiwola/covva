import { CONSENT_ANCHOR, CONSENT_COOKIE, CONSENT_MAX_AGE, PIXELS_CONFIGURED, type ConsentChoice } from "@/components/marketing/analytics";

/**
 * POST /api/consent — the cookie bar's no-JavaScript path (consent-banner.tsx). Before React hydrates (or with
 * JavaScript off) Reject / Accept submit a plain form here. Once hydrated, the buttons write the cookie in the
 * browser and this route is never called.
 *
 * Form field `choice`: essential | analytics | all. Sets the same first-party `covva_consent` cookie as
 * `writeConsent()` (180 days, Path=/, SameSite=Lax, readable by the page) and 303-redirects back to the
 * referring page on this site. "all" becomes "analytics" when no advertising pixel is configured, so the
 * "no advertising pixels" promise holds whatever is posted. Cross-site posts are refused, so another site
 * cannot record a choice on the visitor's behalf.
 */
export async function POST(req: Request) {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  if (!sameSite(req, host)) return new Response("Cross-site consent requests are not accepted", { status: 403 });

  let raw: FormDataEntryValue | null = null;
  try {
    raw = (await req.formData()).get("choice");
  } catch {
    // Not a form body: treated as an invalid choice below.
  }
  const choice = parseChoice(raw);
  if (!choice) return new Response("choice must be essential, analytics or all", { status: 400 });

  const back = backPath(req.headers.get("referer"), host);
  const secure = url.protocol === "https:" ? "; Secure" : "";
  return new Response(null, {
    status: 303,
    headers: {
      Location: `${back}#${CONSENT_ANCHOR}`,
      "Set-Cookie": `${CONSENT_COOKIE}=${choice}; Max-Age=${CONSENT_MAX_AGE}; Path=/; SameSite=Lax${secure}`,
      "Cache-Control": "no-store",
    },
  });
}

function parseChoice(raw: FormDataEntryValue | null): ConsentChoice | null {
  if (raw === "essential" || raw === "analytics") return raw;
  if (raw === "all") return PIXELS_CONFIGURED ? "all" : "analytics";
  return null;
}

/**
 * True for a post from one of this site's own pages. Browsers send `Origin` on form posts; when it is
 * missing, `Sec-Fetch-Site` or the referrer decides, and a request with none of them (old browsers) is let through.
 */
function sameSite(req: Request, host: string) {
  const origin = req.headers.get("origin");
  if (origin && origin !== "null") return hostOf(origin) === host;
  const fetchSite = req.headers.get("sec-fetch-site");
  if (fetchSite) return fetchSite === "same-origin" || fetchSite === "none";
  const referer = req.headers.get("referer");
  return referer ? hostOf(referer) === host : true;
}

/** Path + query of the referring page when it is on this site, else the home page. */
function backPath(referer: string | null, host: string) {
  if (!referer) return "/";
  try {
    const ref = new URL(referer);
    if (ref.host !== host) return "/";
    const path = ref.pathname.startsWith("/api/") ? "/" : ref.pathname;
    return path + ref.search;
  } catch {
    return "/";
  }
}

function hostOf(value: string) {
  try {
    return new URL(value).host;
  } catch {
    return "";
  }
}

