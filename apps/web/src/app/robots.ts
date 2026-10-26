import type { MetadataRoute } from "next";

const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL ?? (process.env.VERCEL_ENV === "production" ? "https://covva.com.gh" : "http://localhost:3000")).replace(/\/$/, "");

export default function robots(): MetadataRoute.Robots {
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
    sitemap: `${siteUrl}/sitemap.xml`,
    host: siteUrl,
  };
}
