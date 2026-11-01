import type { MetadataRoute } from "next";
import { isProductionDeployment } from "@/lib/deployment";
import { siteUrl } from "@/lib/site-url";

export default function robots(): MetadataRoute.Robots {
  if (!isProductionDeployment()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }

  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // "/partner/" (not "/partner") so the public /partners directory stays crawlable.
        // "/api/" stays blocked (the public verify endpoint is a POST, nothing to index); "/verify" page itself is crawlable.
        disallow: ["/account", "/partner$", "/partner/", "/api/", "/sign-in", "/sign-up"],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
    host: siteUrl(),
  };
}
