import { NextResponse, type NextRequest } from "next/server";
import { siteUrl } from "@/lib/site-url";
import { createServerClient } from "@supabase/ssr";
import { REFERRAL_COOKIE, attributionWindowDays, decodeReferralCookie, encodeReferralCookie, frameAncestors, parseReferralParam, type ReferralSource } from "@im/core";

/**
 * Refreshes the Supabase session cookie and does optimistic route protection.
 * Real authorisation happens in Server Components/Actions/Route Handlers and RLS.
 */
const PROTECTED = ["/account", "/partner", "/onboarding"];

/**
 * Marketing pages live on the marketing site (covva-site, docs/APPS.md). Old links and indexed URLs that reach
 * the app are sent there permanently, keeping the path and query.
 */
const MARKETING = [
  "/about", "/brokers", "/bundles", "/business", "/claims", "/contact", "/cover", "/diaspora", "/explore", "/get-started",
  "/how-it-works", "/insurance", "/insurers", "/learn", "/legal", "/micro", "/partners", "/press", "/referrals", "/support",
  "/trust", "/verify", "/waitlist",
];
const isMarketing = (path: string) => MARKETING.some((p) => path === p || path.startsWith(`${p}/`)) || path === "/sitemap.xml";

/** Absolute URL on the marketing site, or null when the site URL points back at this app (misconfigured env). */
function onSite(request: NextRequest, path: string): URL | null {
  const site = siteUrl();
  if (site === request.nextUrl.origin) return null;
  return new URL(path + request.nextUrl.search, `${site}/`);
}

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll(cookiesToSet, headers) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        Object.entries(headers ?? {}).forEach(([k, v]) => response.headers.set(k, v));
      },
    },
  });

  // Must run immediately after creating the client so refreshed tokens are written.
  const { data } = await supabase.auth.getClaims();
  const path = request.nextUrl.pathname;

  // API v1 uses bearer tokens (mobile) — never redirect API calls.
  if (path.startsWith("/api/")) return response;

  // Embedded widget: frame-ancestors from the partner's allowed domains (global X-Frame-Options skips /embed).
  if (path === "/embed" || path.startsWith("/embed/")) {
    response.headers.set("Content-Security-Policy", frameAncestors(await embedDomains(request.nextUrl.searchParams.get("partner")), { includeSelf: true }));
    return response;
  }

  captureReferral(request, response);

  // Marketing paths → the marketing site (308). The site captures ?ref itself.
  if (isMarketing(path)) {
    const target = onSite(request, path);
    if (target) return withCookies(NextResponse.redirect(target, 308), response);
  }

  // The app has no home page: signed-in people go to their account, everyone else to the site home.
  if (path === "/") {
    const target = data?.claims ? null : onSite(request, "/");
    if (target) return withCookies(NextResponse.redirect(target, 307), response);
    const url = request.nextUrl.clone();
    url.pathname = data?.claims ? "/account" : "/sign-in";
    return withCookies(NextResponse.redirect(url, 307), response);
  }

  if (!data?.claims && PROTECTED.some((p) => path === p || path.startsWith(`${p}/`))) {
    const url = request.nextUrl.clone();
    url.pathname = "/sign-in";
    url.search = `?next=${encodeURIComponent(path + request.nextUrl.search)}`;
    return withCookies(NextResponse.redirect(url), response);
  }
  return response;
}

/** Carry refreshed session and referral cookies over to a redirect. */
function withCookies(redirect: NextResponse, response: NextResponse): NextResponse {
  response.cookies.getAll().forEach((c) => redirect.cookies.set(c));
  return redirect;
}

/**
 * `?ref=CODE` on any page → first-party `covva_ref` cookie (30 days, first touch wins). A partner-API
 * continue link (`&lead=<id>&src=api`) replaces an older touch so the hand-off completes its attribution.
 * Read by `recordAttribution()` when the customer creates a request.
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

/** Allowed embedding origins for a partner code (public RPC), cached per instance for 5 minutes. */
const embedCache = new Map<string, { domains: string[]; at: number }>();
async function embedDomains(partner: string | null): Promise<string[]> {
  const code = parseReferralParam(partner);
  if (!code) return [];
  const hit = embedCache.get(code);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.domains;
  let domains: string[] = [];
  try {
    const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/embed_partner`, {
      method: "POST",
      headers: { apikey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, "content-type": "application/json" },
      body: JSON.stringify({ p_code: code }),
      signal: AbortSignal.timeout(3_000),
    });
    const rows = res.ok ? ((await res.json()) as { widget_domains?: string[] }[]) : [];
    domains = rows[0]?.widget_domains ?? [];
  } catch {
    domains = [];
  }
  if (embedCache.size > 500) embedCache.clear();
  embedCache.set(code, { domains, at: Date.now() });
  return domains;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.well-known|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml)$).*)"],
};
