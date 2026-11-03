import { NextResponse, type NextRequest } from "next/server";
import { findProductLine } from "@/components/marketing/products-content";
import { ARTICLES } from "@/components/marketing/articles";
import { appUrl } from "@/lib/site-url";
import { REFERRAL_COOKIE, attributionWindowDays, decodeReferralCookie, encodeReferralCookie, parseReferralParam, type ReferralSource } from "@im/core";
import { GATE_BYPASS_COOKIE, GATE_BYPASS_MAX_AGE, GATE_BYPASS_PARAM, GATE_PATH, decideGate, gateDigest, readGateConfig, type GateDecision } from "@/lib/site-gate";

/**
 * Marketing site proxy (covva-site, docs/APPS.md):
 * - captures `?ref=` into the first-party referral cookie (first touch wins);
 * - forwards app paths (sign-in, account, partner workspace, quote flow…) to the app (covva-app), adding the
 *   visitor's referral code so the app can attribute the request. The site's links to those paths stay
 *   relative, so the referral survives the hop even on prerendered pages;
 * - answers unknown product and Learn slugs with a real 404;
 * - while the pre-launch gate is on (SITE_GATE=waitlist, lib/site-gate.ts), shows the waitlist on every other page,
 *   app paths included, and marks every response noindex.
 */
const APP_PATHS = [
  "/account", "/partner", "/onboarding", "/sign-in", "/sign-up", "/sign-out", "/auth", "/forgot-password", "/reset-password",
  "/invite", "/quote", "/q", "/consent", "/embed",
];
const isAppPath = (path: string) => APP_PATHS.some((p) => path === p || path.startsWith(`${p}/`));

export async function proxy(request: NextRequest) {
  const gate = await gateFor(request);
  const response = route(request, gate);
  if (gate.kind !== "off") response.headers.set("X-Robots-Tag", "noindex, nofollow");
  return response;
}

function route(request: NextRequest, gate: GateDecision): NextResponse {
  const response = NextResponse.next({ request });
  const path = request.nextUrl.pathname;

  if (gate.kind === "set-bypass" || gate.kind === "clear-bypass") {
    const back = NextResponse.redirect(new URL(gate.location, request.url), 307);
    back.headers.set("Cache-Control", "private, no-store");
    if (gate.kind === "clear-bypass") back.cookies.delete(GATE_BYPASS_COOKIE);
    else back.cookies.set(GATE_BYPASS_COOKIE, gate.cookie, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: "/", maxAge: GATE_BYPASS_MAX_AGE });
    return back;
  }
  if (gate.kind !== "off") {
    // Gated host: no sitemap, and a robots.txt with nothing to list (pages carry X-Robots-Tag: noindex).
    if (path === "/robots.txt") return new NextResponse("User-agent: *\nAllow: /\n", { headers: { "Content-Type": "text/plain; charset=utf-8" } });
    if (path === "/sitemap.xml") return new NextResponse("Not found", { status: 404 });
  }
  if (gate.kind === "gate") {
    captureReferral(request, response);
    const url = request.nextUrl.clone();
    url.pathname = GATE_PATH;
    url.search = "";
    const waitlist = NextResponse.rewrite(url);
    response.cookies.getAll().forEach((c) => waitlist.cookies.set(c));
    return waitlist;
  }

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
    // No status override: the unmatched path renders app/global-not-found.tsx with a 404 itself. On Vercel a
    // rewrite that forces 404 is served Next's default /404 page instead of the branded one.
    const notFound = NextResponse.rewrite(url);
    response.cookies.getAll().forEach((c) => notFound.cookies.set(c));
    return notFound;
  }
  return response;
}

/** The gate's decision for this request (lib/site-gate.ts). Configuration is read per request, so no rebuild is needed. */
async function gateFor(request: NextRequest): Promise<GateDecision> {
  const config = readGateConfig(process.env);
  if (!config.on) return { kind: "off" };
  const tokenDigest = config.bypassToken ? await gateDigest(config.bypassToken) : null;
  const param = request.nextUrl.searchParams.get(GATE_BYPASS_PARAM);
  return decideGate({
    config,
    host: request.headers.get("host") ?? request.nextUrl.host,
    url: request.url,
    bypassCookie: request.cookies.get(GATE_BYPASS_COOKIE)?.value ?? null,
    tokenDigest,
    paramDigest: param && param !== "off" ? await gateDigest(param) : null,
  });
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
 * and a missing one is rewritten to an unmatched path, which renders the branded not-found page with a 404 status.
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
  // robots.txt and sitemap.xml pass through here so the pre-launch gate can answer them.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|avif|woff2?)$).*)"],
};
