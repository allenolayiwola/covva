/**
 * Covva runs as two public apps (docs/APPS.md):
 * - this marketing site (covva-site, NEXT_PUBLIC_SITE_URL, e.g. https://covva.com.gh), and
 * - the app (covva-app, NEXT_PUBLIC_APP_URL, e.g. https://app.covva.com.gh): sign-in, account, partner
 *   workspace, the quote flow, embeds, APIs and webhooks.
 * Links into the app must be absolute (use appPath). Resolve at call time; Vercel hostnames may omit the scheme.
 */
function origin(configured: string): string {
  return new URL(/^https?:\/\//.test(configured) ? configured : `https://${configured}`).origin;
}

/** Canonical public origin of this site. */
export function siteUrl(): string {
  return origin(process.env.NEXT_PUBLIC_SITE_URL || process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "https://covva.com.gh");
}

export function sitePath(path: string): string {
  return new URL(path, `${siteUrl()}/`).toString();
}

/** Public origin of the app (a different Vercel project). */
export function appUrl(): string {
  return origin(process.env.NEXT_PUBLIC_APP_URL || (process.env.NODE_ENV === "development" ? "http://localhost:3102" : "https://app.covva.com.gh"));
}

/** Absolute URL of an app path such as /account or /quote. */
export function appPath(path: string): string {
  return new URL(path, `${appUrl()}/`).toString();
}
