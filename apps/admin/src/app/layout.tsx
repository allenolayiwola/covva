import type { Metadata, Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import "./globals.css";

const inter = Inter({ subsets: ["latin"], weight: ["300", "400", "500"], display: "swap", variable: "--font-inter" });
const outfit = Outfit({ subsets: ["latin"], weight: ["300", "400"], display: "swap", variable: "--font-outfit" });

export const metadata: Metadata = {
  title: { default: "Admin · Covva", template: "%s · Admin · Covva" },
  description: "Platform administration portal for Covva staff.",
  applicationName: "Covva Admin",
  icons: { icon: [{ url: "/favicon.ico", sizes: "any" }, { url: "/favicon.png", type: "image/png" }], apple: "/apple-touch-icon.png" },
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export const viewport: Viewport = {
  themeColor: "#0F514D",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-GB" className={`${inter.variable} ${outfit.variable}`}>
      <body className="min-h-dvh bg-[#F7FAF9]">
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-float"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
