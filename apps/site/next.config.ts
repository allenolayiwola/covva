import type { NextConfig } from "next";

// Marketing site (covva-site). See docs/APPS.md.

const nextConfig: NextConfig = {
  cacheComponents: true,
  poweredByHeader: false,
  partialPrefetching: true,
  typedRoutes: false,
  transpilePackages: ["@im/core", "@im/db", "@im/tokens", "@im/ui"],
  images: {
    // 75 is the default; 85 is the home hero illustrations (components/marketing/home-hero.tsx).
    qualities: [75, 85],
    // Defaults plus 2560 so 1440p and 2× laptop screens get a sharp full-bleed hero without jumping to 3840.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920, 2048, 2560, 3840],
    // AVIF first (~20–40% smaller than WebP at the same quality, which matters for the full-bleed hero on mobile data),
    // WebP for browsers without AVIF. Each format is cached separately by the optimizer.
    formats: ["image/avif", "image/webp"],
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
        // The marketing site is never framed (the embeddable quote widget lives in the app, covva-app).
        source: "/:path*",
        headers: [{ key: "X-Frame-Options", value: "DENY" }],
      },
    ];
  },
};

export default nextConfig;
