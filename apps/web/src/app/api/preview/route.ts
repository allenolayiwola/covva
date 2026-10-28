import { cookies, draftMode } from "next/headers";
import { redirect } from "next/navigation";
import { isCmsLocale } from "@im/core";
import { cmsConfigured } from "@/cms/env";
import { PREVIEW_COOKIE } from "@/components/marketing/preview-banner";

/**
 * GET /api/preview?path=/learn/<slug>[&locale=tw] — editor preview of unpublished CMS content.
 *
 * The caller must be signed in to the CMS (Payload's `covva-cms-token` cookie is checked through
 * the Local API), then Next draft mode is switched on for this browser and the request is sent to
 * the page, which renders the latest draft. `/api/preview/exit` switches it off again. A second,
 * readable cookie lets the client-side banner show without making the pages dynamic.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawPath = url.searchParams.get("path") ?? "/";
  // Same-site paths only: no protocol-relative or absolute URLs.
  const path = /^\/(?!\/)[\w\-./]*$/.test(rawPath) ? rawPath : "/";
  const locale = url.searchParams.get("locale");

  if (!cmsConfigured()) return Response.json({ ok: false, error: { code: "cms_disabled", message: "The CMS is not configured on this deployment." } }, { status: 404 });

  const { getPayloadClient } = await import("@/cms/client");
  const payload = await getPayloadClient();
  const { user } = await payload.auth({ headers: req.headers });
  if (!user) {
    return Response.json({ ok: false, error: { code: "unauthorised", message: "Sign in to the CMS at /cms, then use the Preview button." } }, { status: 401, headers: { "cache-control": "no-store" } });
  }

  (await draftMode()).enable();
  (await cookies()).set(PREVIEW_COOKIE, "1", { path: "/", sameSite: "lax", httpOnly: false, secure: process.env.NODE_ENV === "production" });
  const target = locale && isCmsLocale(locale) && locale !== "en" && path.startsWith("/learn/") ? `${path.replace(/\/$/, "")}/${locale}` : path;
  redirect(target);
}
