import { PIXELS_CONFIGURED } from "@/components/marketing/analytics";
import { decideConsentPost } from "@/lib/consent-post";

/**
 * POST /api/consent — the cookie banner's form target when a choice is made before the page has hydrated (or
 * without JavaScript). Sets the same `covva_consent` cookie the banner writes client-side, then sends the visitor
 * back to the page they were on (303). Rules: src/lib/consent-post.ts.
 */
export async function POST(req: Request) {
  let choice: FormDataEntryValue | null = null;
  try {
    choice = (await req.formData()).get("choice");
  } catch {
    // Not a form post: decideConsentPost rejects the missing choice.
  }
  const result = decideConsentPost({
    choice,
    requestUrl: req.url,
    origin: req.headers.get("origin"),
    secFetchSite: req.headers.get("sec-fetch-site"),
    referer: req.headers.get("referer"),
    pixelsConfigured: PIXELS_CONFIGURED,
  });
  if (!result.ok) return new Response(null, { status: result.status });
  return new Response(null, { status: 303, headers: { Location: result.location, "Set-Cookie": result.cookie, "Cache-Control": "no-store" } });
}
