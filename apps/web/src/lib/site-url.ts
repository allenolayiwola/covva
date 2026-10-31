/** Canonical public origin. Resolve at call time; Vercel hostnames may omit the scheme. */
export function siteUrl(): string {
  const configured = process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL || "https://covva.com.gh";
  return new URL(/^https?:\/\//.test(configured) ? configured : `https://${configured}`).origin;
}

export function sitePath(path: string): string {
  return new URL(path, `${siteUrl()}/`).toString();
}
