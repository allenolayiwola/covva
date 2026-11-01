import { NextResponse, type NextRequest } from "next/server";
import { findProductLine } from "@/components/marketing/products-content";
import { ARTICLES } from "@/components/marketing/articles";
import { appUrl } from "@/lib/site-url";
import { REFERRAL_COOKIE, attributionWindowDays, decodeReferralCookie, encodeReferralCookie, parseReferralParam, type ReferralSource } from "@im/core";

/**
 * Marketing site proxy (covva-site, docs/APPS.md):
 * - captures `?ref=` into the first-party referral cookie (first touch wins);
 * - forwards app paths (sign-in, account, partner workspace, quote flow…) to the app (covva-app), adding the
 *   visitor's referral code so the app can attribute the request. The site's links to those paths stay
 *   relative, so the referral survives the hop even on prerendered pages;
 * - answers unknown product and Learn slugs with a real 404.
 */
const APP_PATHS = [
  "/account", "/partner", "/onboarding", "/sign-in", "/sign-up", "/sign-out", "/auth", "/forgot-password", "/reset-password",
  "/invite", "/quote", "/q", "/consent", "/embed",
];
const isAppPath = (path: string) => APP_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

export async function proxy(request: NextRequest) {
  const response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;

  if (path.startsWith("/api/")) return response;

  if (isAppPath(path)) {
    const target = toApp(request);
    if (target) return NextResponse.redirect(target, 307);
  }

  captureReferral(request, response);

  // Unknown product and Learn slugs answer with a real 404 (the page alone can only stream a soft one).
  const cover = /^\/cover\/([^/]+)\/?$/.exec(path);
  if ((cover && !findProductLine(cover[1]!)) || learnSlugMissing(path)) {
    const url = request.nextUrl.clone();
    url.pathname = NOT_FOUND_PATH;
    const notFound = NextResponse.rewrite(url, { status: 404 });
    response.cookies.getAll().forEach((c) => notFound.cookies.set(c));
    return notFound;
  }
  return response;
}

/**
 * The same path on the app, with the referral (from the URL, else from this site's cookie) carried as
 * `ref` / `src` / `lead` so the app's proxy records it. Null when the app URL points back at this site.
 */
function toApp(request: NextRequest): URL | null {
  const app = appUrl();
  if (app === request.nextUrl.origin) return null;
  const target = new URL(request.nextUrl.pathname + request.nextUrl.search, `${app}/`);
  if (!parseReferralParam(target.searchParams.get("ref"))) {
    const touch = decodeReferralCookie(request.cookies.get(REFERRAL_COOKIE)?.value);
    if (touch) {
      target.searchParams.set("ref", touch.code);
      if (touch.source !== "link") target.searchParams.set("src", touch.source);
      if (touch.leadId) target.searchParams.set("lead", touch.leadId);
    }
  }
  return target;
}

/**
 * `?ref=CODE` on any page → first-party `covva_ref` cookie (30 days, first touch wins). A partner-API
 * continue link (`&lead=<id>&src=api`) replaces an older touch so the hand-off completes its attribution.
 */
function captureReferral(request: NextRequest, response: NextResponse) {
  const sp = request.nextUrl.searchParams;
  const code = parseReferralParam(sp.get("ref"));
  if (!code) return;
  const lead = sp.get("lead");
  const existing = decodeReferralCookie(request.cookies.get(REFERRAL_COOKIE)?.value);
  if (existing && !lead) return;
  const src = sp.get("src");
  const source: ReferralSource = src === "widget" || src === "api" ? src : "link";
  response.cookies.set(REFERRAL_COOKIE, encodeReferralCookie({ code, source, firstTouchAt: Date.now(), leadId: lead }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: attributionWindowDays * 86_400,
  });
}

/**
 * `/learn/<slug>` is partially prerendered: its shell streams before the page can call `notFound()`, so an
 * unknown slug would otherwise answer 200 (a "soft 404"). The slug is checked here against the articles in code,
 * and a missing one is rewritten to a route that renders the not-found page with a 404 status.
 */
const NOT_FOUND_PATH = "/__not-found";
function learnSlugMissing(path: string): boolean {
  const m = /^\/learn\/([^/]+)\/?$/.exec(path);
  if (!m) return /^\/learn\/[^/]+\/./.test(path); // nothing lives below /learn/<slug>
  let slug: string;
  try {
    slug = decodeURIComponent(m[1]!);
  } catch {
    return true;
  }
  return !ARTICLES.some((a) => a.slug === slug);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
