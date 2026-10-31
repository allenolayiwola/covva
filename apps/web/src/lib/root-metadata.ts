import type { Metadata } from "next";
import { siteUrl } from "./site-url";
import { isProductionDeployment } from "./deployment";

export function rootMetadata(): Metadata {
  return {
    robots: isProductionDeployment() ? undefined : { index: false, follow: false },
    metadataBase: new URL(siteUrl()),
    title: {
      default: "Covva — Find cover. Understand it. Move forward.",
      template: "%s | Covva",
    },
    description:
      "Compare cover from participating licensed insurers in Ghana, with a named broker by your side from first question to policy delivery. Keep every policy in one wallet and get help with renewals and claims.",
    applicationName: "Covva",
    openGraph: {
      type: "website",
      siteName: "Covva",
      locale: "en_GH",
      images: [`${siteUrl()}/opengraph-image`],
    },
    twitter: { card: "summary_large_image" },
    formatDetection: { telephone: false },
    icons: {
      icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/favicon.png", type: "image/png", sizes: "64x64" }, { url: "/icon-192.png", type: "image/png", sizes: "192x192" }],
      apple: "/apple-touch-icon.png",
    },
  };
}
