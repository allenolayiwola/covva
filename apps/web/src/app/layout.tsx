import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Insurance Marketplace — Find cover. Understand it. Move forward.",
    template: "%s · Insurance Marketplace",
  },
  description:
    "Compare cover from participating licensed insurers in Ghana, with a named broker by your side from first question to policy delivery. Keep every policy in one wallet and get help with renewals and claims.",
  applicationName: "Insurance Marketplace",
  openGraph: {
    type: "website",
    siteName: "Insurance Marketplace",
    locale: "en_GH",
  },
  twitter: { card: "summary_large_image" },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: "#00796E",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GH" className={inter.variable}>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-float">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
