import { siteUrl } from "./site-url";

export function isProductionDeployment(): boolean {
  // Preview builds also use NODE_ENV=production; Vercel takes precedence.
  return (process.env.VERCEL_ENV ?? process.env.NODE_ENV) === "production";
}

/**
 * Search engines may index this build only when it is a production deployment on a real domain.
 * A canonical *.vercel.app hostname (before the switch to covva.com.gh) stays out of search results.
 */
export function isIndexable(): boolean {
  return isProductionDeployment() && !new URL(siteUrl()).hostname.endsWith(".vercel.app");
}
