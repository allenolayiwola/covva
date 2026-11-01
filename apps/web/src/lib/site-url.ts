/**
 * Covva runs as two public apps (docs/APPS.md):
 * - the marketing site (covva-site, NEXT_PUBLIC_SITE_URL, e.g. https://covva.com.gh), and
 * - this app (covva-app, NEXT_PUBLIC_APP_URL, e.g. https://app.covva.com.gh): sign-in, account, partner
 *   workspace, quote flow, embeds, APIs and webhooks.
 * Links into the other app must be absolute. Resolve at call time; Vercel hostnames may omit the scheme.
 */
function origin(configured: string): string {
  return new URL(/^https?:\/\//.test(configured) ? configured : `https://${configured}`).origin;
}

const isDev = () => process.env.NODE_ENV === "development";

/** Public origin of the marketing site (a different Vercel project). */
export function siteUrl(): string {
  return origin(process.env.NEXT_PUBLIC_SITE_URL || (isDev() ? "http://localhost:3100" : "https://covva.com.gh"));
}

export function sitePath(path: string): string {
  return new URL(path, `${siteUrl()}/`).toString();
}

/** Public origin of this app. */
export function appUrl(): string {
  return origin(
    process.env.NEXT_PUBLIC_APP_URL ||
      process.env.VERCEL_PROJECT_PRODUCTION_URL ||
      process.env.VERCEL_URL ||
      (isDev() ? "http://localhost:3102" : "https://app.covva.com.gh"),
  );
}

export function appPath(path: string): string {
  return new URL(path, `${appUrl()}/`).toString();
}
