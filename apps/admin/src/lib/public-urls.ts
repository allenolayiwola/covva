/**
 * Public origins of the two customer-facing apps (docs/APPS.md):
 * - the marketing site (covva-site): NEXT_PUBLIC_SITE_URL;
 * - the app (covva-app: sign-in, account, partner workspace, APIs, webhooks): NEXT_PUBLIC_APP_URL.
 * Until NEXT_PUBLIC_APP_URL is set, the app is assumed to live at the site URL (the pre-split setup).
 */
const trim = (u: string) => u.replace(/\/$/, "");

export function publicSiteUrl(): string | null {
  return process.env.NEXT_PUBLIC_SITE_URL ? trim(process.env.NEXT_PUBLIC_SITE_URL) : null;
}

export function publicAppUrl(): string | null {
  const u = process.env.NEXT_PUBLIC_APP_URL || process.env.NEXT_PUBLIC_SITE_URL;
  return u ? trim(u) : null;
}

/** App origin with a local fallback, for links that must always render. */
export function appOrigin(): string {
  return publicAppUrl() ?? "http://localhost:3102";
}
