import type { NextConfig } from "next";
import { withPayload } from "@payloadcms/next/withPayload";

const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false,
  partialPrefetching: true,
  typedRoutes: false,
  transpilePackages: ["@im/core", "@im/db", "@im/tokens", "@im/ui"],
  images: {
    remotePatterns: [new URL("https://krmnyqaweawkpygjmdry.supabase.co/storage/v1/object/public/**")],
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(self)" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        ],
      },
      {
        // Never framed — except the embeddable quote widget (/embed/*), whose CSP frame-ancestors is
        // set per partner from distribution_partners.widget_domains in src/proxy.ts.
        source: "/:path((?!embed(?:/|$)).*)",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
      {
        source: "/embed/widget.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=3600, stale-while-revalidate=86400" },
          { key: "Access-Control-Allow-Origin", value: "*" },
        ],
      },
    ];
  },
};

// Payload CMS (docs/CMS.md): admin at /cms, REST at /cms-api; marks server-only packages external.
export default withPayload(nextConfig, { devBundleServerPackages: false });
