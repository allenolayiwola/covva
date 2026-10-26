/**
 * Supported UI locales. English is the source of truth and the only complete locale today.
 * Twi, Ga and Ewe are listed so customers can choose them, but their catalogues contain ONLY
 * strings a human translator has supplied (in code or approved in the admin `translations`
 * table) — nothing is machine-translated. Untranslated keys fall back to English.
 *
 * To add a locale: append it here (status 'planned'), add an empty catalogue file next to
 * `tw.ts`, register it in `catalogues.ts`, and translators fill it in from the admin app.
 */
export type LocaleStatus = "complete" | "partial" | "planned";

export interface LocaleDef {
  /** Catalogue / cookie / API code (ISO 639-1 where one exists, else 639-3: Ga = `gaa`). */
  code: string;
  /** English name. */
  label: string;
  /** Endonym shown in the switcher. */
  native: string;
  /** Value for `<html lang>` and `Content-Language`. */
  htmlLang: string;
  /** Declared status. `partial` once some approved strings exist; `complete` after a full review. */
  status: LocaleStatus;
  /** Older spellings we accept from cookies, headers and the mobile app. */
  aliases: readonly string[];
}

export const LOCALES = [
  { code: "en", label: "English", native: "English", htmlLang: "en-GH", status: "complete", aliases: ["en-gh", "en-gb", "en-us", "eng"] },
  { code: "tw", label: "Twi", native: "Twi", htmlLang: "tw", status: "planned", aliases: ["twi", "ak", "aka", "tw-gh", "ak-gh"] },
  { code: "gaa", label: "Ga", native: "Gã", htmlLang: "gaa", status: "planned", aliases: ["ga", "gaa-gh"] },
  { code: "ee", label: "Ewe", native: "Eʋegbe", htmlLang: "ee", status: "planned", aliases: ["ewe", "ee-gh", "ee-tg"] },
] as const satisfies readonly LocaleDef[];

export type Locale = (typeof LOCALES)[number]["code"];
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_CODES = LOCALES.map((l) => l.code) as readonly Locale[];
/** Cookie that stores the visitor's choice (web) — also read by the server. */
export const LOCALE_COOKIE = "covva_lang";
/** Header the mobile app may send instead of / in addition to `Accept-Language`. */
export const LOCALE_HEADER = "x-covva-locale";

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALE_CODES as readonly string[]).includes(value);
}

export function localeDef(code: Locale): LocaleDef {
  return LOCALES.find((l) => l.code === code) ?? LOCALES[0];
}

/**
 * Map any spelling (`en-GH`, `ga`, `Twi`, `ak`, `ee_TG`) to a supported locale, or null.
 * Region subtags are ignored; unknown languages return null (caller falls back to English).
 */
export function normaliseLocale(value: string | null | undefined): Locale | null {
  if (!value) return null;
  const v = String(value).trim().toLowerCase().replace(/_/g, "-");
  if (!v) return null;
  for (const l of LOCALES) {
    if (v === l.code || (l.aliases as readonly string[]).includes(v)) return l.code;
  }
  const base = v.split("-")[0] ?? v;
  for (const l of LOCALES) {
    if (base === l.code || (l.aliases as readonly string[]).includes(base)) return l.code;
  }
  return null;
}

/**
 * Pick the best supported locale from an `Accept-Language` header (q-values respected).
 * Returns null when nothing matches, so callers can apply their own default.
 */
export function matchAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const ranges = header
    .split(",")
    .map((part, i) => {
      const [tag, ...params] = part.trim().split(";");
      const q = params.map((p) => p.trim()).find((p) => p.startsWith("q="));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: (tag ?? "").trim(), q: Number.isFinite(weight) ? weight : 0, i };
    })
    .filter((r) => r.tag && r.tag !== "*" && r.q > 0)
    .sort((a, b) => b.q - a.q || a.i - b.i);
  for (const r of ranges) {
    const l = normaliseLocale(r.tag);
    if (l) return l;
  }
  return null;
}

/**
 * Resolution order used by the web app and the API: explicit choice (cookie / `X-Covva-Locale`)
 * → the signed-in profile's `locale` → `Accept-Language` → English.
 */
export function resolveLocale(sources: { explicit?: string | null; profile?: string | null; acceptLanguage?: string | null }): Locale {
  return normaliseLocale(sources.explicit) ?? normaliseLocale(sources.profile) ?? matchAcceptLanguage(sources.acceptLanguage) ?? DEFAULT_LOCALE;
}

/** Status from coverage: 100% approved → complete, any → partial, none → planned. */
export function statusFromCoverage(translated: number, total: number): LocaleStatus {
  if (total > 0 && translated >= total) return "complete";
  if (translated > 0) return "partial";
  return "planned";
}

/**
 * The honest notice shown when a visitor picks a locale that is not complete. Always English:
 * we never imply a translation exists when it does not.
 */
export function localeNotice(code: Locale, status: LocaleStatus = localeDef(code).status): string | null {
  if (code === DEFAULT_LOCALE || status === "complete") return null;
  return `${localeDef(code).label} translations are in progress — untranslated text is shown in English.`;
}
