/**
 * Canonical site origin for every absolute URL we emit (metadataBase, Open Graph, JSON-LD,
 * sitemap, robots, emails, deep links). Read at call time so runtime env is used.
 *
 * Order: NEXT_PUBLIC_SITE_URL → Vercel's production domain → the launch domain in production.
 * Only non-production builds ever fall back to localhost. Trailing slash is trimmed.
 */
export function siteUrl(): string {
  const configured =
    process.env.NEXT_PUBLIC_SITE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined) ||
    (process.env.NODE_ENV === "production" ? "https://covva.com.gh" : "http://localhost:3000");
  return configured.replace(/\/+$/, "");
}
