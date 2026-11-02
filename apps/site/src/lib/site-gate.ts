/**
 * Pre-launch gate (docs/MARKETING_SITE.md §"Pre-launch gate"). While it is on, every page on a gated host shows the
 * waitlist (GATE_PATH) instead, apart from the legal pages, API routes and the files a page needs. The team can see
 * the full site with a secret preview link that sets a cookie.
 *
 * Server-only environment variables, read on every request (no rebuild needed to switch):
 * - SITE_GATE=waitlist          turns the gate on. Anything else (or unset) leaves the site as normal.
 * - SITE_GATE_HOSTS=a.com,b.com optional: gate only these hostnames. Unset = gate every hostname.
 * - SITE_GATE_BYPASS_TOKEN=…    optional: the secret for `?preview=<token>`. At least 16 characters, else no bypass.
 *
 * Pure apart from `gateDigest` (Web Crypto, available in the proxy and in Node), so it is unit-tested.
 */

export const GATE_PATH = "/coming-soon";
export const GATE_BYPASS_PARAM = "preview";
export const GATE_BYPASS_COOKIE = "covva_preview";
export const GATE_BYPASS_MAX_AGE = 60 * 60 * 24 * 30;
export const GATE_MIN_TOKEN_LENGTH = 16;

export interface GateConfig {
  on: boolean;
  /** Lower-case hostnames to gate; null = all. */
  hosts: string[] | null;
  /** Bypass secret, or null when unset or too short to be safe. */
  bypassToken: string | null;
}

export function readGateConfig(env: Record<string, string | undefined>): GateConfig {
  const on = (env.SITE_GATE ?? "").trim().toLowerCase() === "waitlist";
  const hosts = (env.SITE_GATE_HOSTS ?? "")
    .split(",")
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
  const token = (env.SITE_GATE_BYPASS_TOKEN ?? "").trim();
  return { on, hosts: hosts.length ? hosts : null, bypassToken: token.length >= GATE_MIN_TOKEN_LENGTH ? token : null };
}

/** Paths that stay reachable while gated: the waitlist itself, legal pages, APIs, crawler files and share images. */
export function isGateOpenPath(path: string): boolean {
  if (path === GATE_PATH || path.startsWith(`${GATE_PATH}/`)) return true;
  if (path.startsWith("/legal/") || path.startsWith("/api/") || path.startsWith("/_next/")) return true;
  if (path === "/robots.txt" || path === "/sitemap.xml" || path === "/manifest.webmanifest") return true;
  // Social share cards (app/opengraph-image.tsx and per-route ones), so a shared link still previews nicely.
  return /(^|\/)opengraph-image(-[\w-]+)?$/.test(path);
}

export type GateDecision =
  /** Gate does not apply: the site behaves as normal. */
  | { kind: "off" }
  /** Gated host, but this path stays open (legal pages, APIs…). */
  | { kind: "open" }
  /** Gated host, team member with a valid preview cookie: the full site. */
  | { kind: "bypass" }
  /** Show the waitlist. */
  | { kind: "gate" }
  /** Valid `?preview=<token>`: set the cookie (to `cookie`) and return to the same URL without the secret. */
  | { kind: "set-bypass"; location: string; cookie: string }
  /** `?preview=off`: clear the cookie and return to the same URL. */
  | { kind: "clear-bypass"; location: string };

export function decideGate(input: {
  config: GateConfig;
  /** Host header (may include a port). */
  host: string | null;
  /** Full request URL. */
  url: string;
  /** Value of the preview cookie, if any. */
  bypassCookie: string | null;
  /** gateDigest(config.bypassToken), when a token is configured. */
  tokenDigest: string | null;
  /** gateDigest(?preview value), when the parameter is present. */
  paramDigest: string | null;
}): GateDecision {
  const { config } = input;
  if (!config.on) return { kind: "off" };
  const hostname = (input.host ?? "").trim().toLowerCase().replace(/:\d+$/, "");
  if (config.hosts && !config.hosts.includes(hostname)) return { kind: "off" };

  const url = new URL(input.url);
  const param = url.searchParams.get(GATE_BYPASS_PARAM);
  if (param !== null) {
    url.searchParams.delete(GATE_BYPASS_PARAM);
    const location = `${url.pathname}${url.search}`;
    if (param === "off") return { kind: "clear-bypass", location };
    if (input.tokenDigest && input.paramDigest === input.tokenDigest) return { kind: "set-bypass", location, cookie: input.tokenDigest };
    // A wrong secret is ignored: the visitor sees what they would have seen without it.
  }

  if (isGateOpenPath(url.pathname)) return { kind: "open" };
  if (input.tokenDigest && input.bypassCookie === input.tokenDigest) return { kind: "bypass" };
  return { kind: "gate" };
}

/**
 * SHA-256 hex of the secret (salted with a fixed label). The cookie stores this digest, never the secret itself, and
 * comparisons are between digests.
 */
export async function gateDigest(secret: string): Promise<string> {
  const bytes = new TextEncoder().encode(`covva-site-gate:${secret}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("");
}
