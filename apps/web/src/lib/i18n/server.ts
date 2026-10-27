import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import { cookies, headers } from "next/headers";
import {
  DEFAULT_LOCALE,
  LOCALE_COOKIE,
  LOCALE_HEADER,
  catalogueCoverage,
  createTranslator,
  isLocale,
  mergeCatalogue,
  normaliseLocale,
  resolveLocale,
  type Coverage,
  type Locale,
  type LocaleStatus,
  type Messages,
  type Translator,
} from "@im/core";
import { createPublicClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { fromTable } from "@/server/phase3-tables";
import { log } from "@/server/log";

/**
 * Server side of the translation layer.
 *
 * NEXT16 rule (docs/NEXT16_NOTES.md §2.4): `cookies()` / `headers()` may not run inside
 * `'use cache'`. So the locale is resolved here, at request time, and passed INTO the cached
 * catalogue loader as an argument (the cache key). Pages that render static shells keep using
 * the client `<T>` (English in the shell, the visitor's locale after hydration).
 */

/** Cookie → signed-in profile.locale → Accept-Language → English. Request-time (call inside Suspense). */
export async function getLocale(opts: { includeProfile?: boolean } = {}): Promise<Locale> {
  const [jar, hdrs] = await Promise.all([cookies(), headers()]);
  const explicit = jar.get(LOCALE_COOKIE)?.value ?? hdrs.get(LOCALE_HEADER);
  if (normaliseLocale(explicit)) return normaliseLocale(explicit)!;
  let profile: string | null = null;
  if (opts.includeProfile !== false) {
    try {
      profile = (await getProfile())?.locale ?? null;
    } catch {
      profile = null;
    }
  }
  return resolveLocale({ profile, acceptLanguage: hdrs.get("accept-language") });
}

/** Locale for an API request (mobile): `X-Covva-Locale` → `Accept-Language` → English. */
export function localeFromRequest(req: Request, profileLocale?: string | null): Locale {
  return resolveLocale({ explicit: req.headers.get(LOCALE_HEADER), profile: profileLocale, acceptLanguage: req.headers.get("accept-language") });
}

/**
 * Approved runtime strings for `locale`, merged over the code catalogue. Cached per locale and
 * invalidated by `revalidateTag('translations')` when a translator's string is approved.
 */
export async function getMessages(locale: Locale): Promise<Messages> {
  "use cache";
  cacheLife("hours");
  cacheTag("translations", `translations:${locale}`);
  if (locale === DEFAULT_LOCALE) return {};
  try {
    const { data, error } = await fromTable(createPublicClient(), "translations").select("key, value, status").eq("locale", locale).eq("status", "approved").limit(5000);
    if (error) throw error;
    return mergeCatalogue(locale, (data ?? []) as { key: string; value: string; status: string }[]);
  } catch (err) {
    // The table may not exist yet in an environment; fall back to the code catalogue.
    log.warn("i18n.messages_unavailable", { locale, err });
    return mergeCatalogue(locale, []);
  }
}

export interface CatalogueResponse {
  locale: Locale;
  status: LocaleStatus;
  coverage: Pick<Coverage, "total" | "translated" | "pct">;
  messages: Messages;
}

/** What `GET /api/v1/i18n/{locale}` and the client loader return. */
export async function getCatalogue(locale: Locale): Promise<CatalogueResponse> {
  const messages = await getMessages(locale);
  const cov = catalogueCoverage(locale, messages);
  return { locale, status: cov.status, coverage: { total: cov.total, translated: cov.translated, pct: cov.pct }, messages };
}

/** A bound translator. Pass a locale you already resolved, or omit it to resolve from the request. */
export async function getT(locale?: Locale | string | null): Promise<Translator & { locale: Locale }> {
  const loc: Locale = isLocale(locale) ? locale : await getLocale();
  return createTranslator(loc, await getMessages(loc));
}

/** Translator for contexts with no request (cron, USSD, SMS) — locale from a profile or session row. */
export async function translatorFor(locale: string | null | undefined): Promise<Translator & { locale: Locale }> {
  const loc = normaliseLocale(locale) ?? DEFAULT_LOCALE;
  return createTranslator(loc, await getMessages(loc));
}
