import type { Viewport } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import "../globals.css";
import { rootMetadata } from "@/lib/root-metadata";
import { HTML_LANG_SCRIPT } from "@/lib/i18n/html-lang";

const jakarta = Plus_Jakarta_Sans({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-jakarta" });
// Plus Jakarta Sans has no Ɛ ɛ Ɔ ɔ Ɖ ɖ (Twi, Ga, Ewe). Inter fills only those letters; it is not preloaded,
// and the browser fetches its file only on a page that uses one of them.
const inter = Inter({ subsets: ["latin-ext"], display: "swap", variable: "--font-inter", preload: false, adjustFontFallback: false });

export const metadata = rootMetadata();

export const viewport: Viewport = {
  themeColor: "#00796E",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    // `lang` is set from the covva_lang cookie by the inline script (the layout stays static;
    // English visitors keep en-GH). suppressHydrationWarning covers that one attribute.
    <html lang="en-GH" className={`${jakarta.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: HTML_LANG_SCRIPT }} />
      </head>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-white focus:px-4 focus:py-2 focus:shadow-float">
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
