import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";
import { siteUrl } from "@/lib/site-url";

const inter = Inter({ subsets: ["latin"], weight: ["300", "400", "500"], display: "swap", variable: "--font-inter" });
const outfit = Outfit({ subsets: ["latin"], weight: ["300", "400"], display: "swap", variable: "--font-outfit" });

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl()),
  title: {
    default: "Covva — Find cover. Understand it. Move forward.",
    template: "%s · Covva",
  },
  description:
    "Compare cover from participating licensed insurers in Ghana, with a named broker by your side from first question to policy delivery. Keep every policy in one wallet and get help with renewals and claims.",
  applicationName: "Covva",
  openGraph: {
    type: "website",
    siteName: "Covva",
    locale: "en_GH",
  },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false },
  icons: {
    icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/favicon.png", type: "image/png", sizes: "64x64" }, { url: "/icon-192.png", type: "image/png", sizes: "192x192" }],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  themeColor: "#00796E",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GH" className={`${inter.variable} ${outfit.variable}`}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-float">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
