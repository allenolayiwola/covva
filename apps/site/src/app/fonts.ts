import { Inter, Outfit } from "next/font/google";
import localFont from "next/font/local";

// `subsets` only picks which files are preloaded: the generated CSS declares every subset with its unicode-range, so
// the browser still fetches extended-Latin glyphs (Ghanaian letters such as ɛ and ɔ) the moment a page uses them.
// Preloading only `latin` keeps ~85 KB of fonts off the first paint on phones.

// Variable Outfit: Light (300) for headings, Bold (700) for the home hero headline.
export const outfit = Outfit({ subsets: ["latin"], display: "swap", variable: "--font-outfit" });
// Inter supplies body/UI text and the extended Latin letters used in Ghanaian languages (loaded on demand, see above).
export const inter = Inter({ subsets: ["latin"], display: "swap", variable: "--font-inter" });

/**
 * Inter's cedi sign (₵, U+20B5) on its own: 1.3 KB, cut with fonttools from the same Inter 4 variable latin-ext file
 * next/font serves (SIL Open Font License 1.1, https://github.com/rsms/inter). Prices ("GH₵ 45") are on most pages,
 * often in the first screen; without this the whole 84 KB latin-ext file would download for that one glyph.
 * `--font-sans` lists it before Inter (globals.css). No fallback face: it must only ever match U+20B5.
 */
export const interCedi = localFont({
  src: "../fonts/inter-cedi.woff2",
  weight: "100 900",
  display: "swap",
  variable: "--font-inter-cedi",
  adjustFontFallback: false,
  declarations: [{ prop: "unicode-range", value: "U+20B5" }],
});

/** Class names for <html>: the CSS variables of every site font. */
export const fontVariables = `${outfit.variable} ${inter.variable} ${interCedi.variable}`;
