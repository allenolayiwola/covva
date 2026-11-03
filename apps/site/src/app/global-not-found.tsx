import type { Metadata, Viewport } from "next";
import "./globals.css";
import { inter, outfit } from "./fonts";
import { HTML_LANG_SCRIPT } from "@/lib/i18n/html-lang";
import NotFound from "./(site)/not-found";

export const metadata: Metadata = { title: "Page not found | Covva", robots: { index: false, follow: false } };

export const viewport: Viewport = { themeColor: "#00796E", width: "device-width", initialScale: 1 };

/**
 * Branded 404 for URLs that match no route (next.config.ts `experimental.globalNotFound`). It is prerendered as
 * complete HTML, so the first request for any unknown URL gets the full page, JavaScript or not. A not-found
 * raised inside a route (`notFound()`) still renders `(site)/not-found.tsx` inside the site layout.
 */
export default function GlobalNotFound() {
  return (
    <html lang="en-GH" className={`${outfit.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HTML_LANG_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-float">
          Skip to content
        </a>
        <NotFound />
      </body>
    </html>
  );
}
