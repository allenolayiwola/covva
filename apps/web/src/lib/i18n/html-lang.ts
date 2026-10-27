import { LOCALES, LOCALE_COOKIE } from "@im/core";

/**
 * Inline `<head>` script that sets `<html lang>` from the `covva_lang` cookie before paint.
 * The root layout stays static (NEXT16_NOTES §2.5: a cookie-driven `lang` attribute in the root
 * layout would make the whole tree request-bound), and English visitors keep `lang="en-GH"`.
 */
const map: Record<string, string> = {};
for (const l of LOCALES) {
  map[l.code] = l.htmlLang;
  for (const a of l.aliases) if (!a.includes("-")) map[a] = l.htmlLang;
}

export const HTML_LANG_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)/);var map=${JSON.stringify(map)};var l=m&&map[decodeURIComponent(m[1]).toLowerCase()];if(l)document.documentElement.lang=l;}catch(e){}})();`;
