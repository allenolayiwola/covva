import type { Metadata, Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-jakarta" });
// Plus Jakarta Sans has no Ɛ ɛ Ɔ ɔ Ɖ ɖ (Twi, Ga, Ewe). Inter fills only those letters; it is not preloaded,
// and the browser fetches its file only on a page that uses one of them.
const inter = Inter({ subsets: ["latin-ext"], display: "swap", variable: "--font-inter", preload: false, adjustFontFallback: false });

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
    <html lang="en-GB" className={`${jakarta.variable} ${inter.variable}`}>
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
