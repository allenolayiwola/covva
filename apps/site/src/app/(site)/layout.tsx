import type { Viewport } from "next";
import { Inter, Outfit } from "next/font/google";
import "../globals.css";
import { rootMetadata } from "@/lib/root-metadata";
import { HTML_LANG_SCRIPT } from "@/lib/i18n/html-lang";

const outfit = Outfit({ subsets: ["latin"], weight: "300", display: "swap", variable: "--font-outfit" });
// Inter supplies body/UI text and the extended Latin letters used in Ghanaian languages.
const inter = Inter({ subsets: ["latin", "latin-ext"], display: "swap", variable: "--font-inter" });

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
    <html lang="en-GH" className={`${outfit.variable} ${inter.variable}`} suppressHydrationWarning>
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
