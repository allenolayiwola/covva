import type { MetadataRoute } from "next";

/**
 * The app (covva-app) is sign-in, account and partner workspace pages: nothing to index. Search engines
 * index the marketing site (covva-site) instead; marketing paths that reach the app redirect there.
 */
export default function robots(): MetadataRoute.Robots {
  return { rules: [{ userAgent: "*", disallow: "/" }] };
}
