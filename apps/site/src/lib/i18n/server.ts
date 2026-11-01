import "server-only";
import { cacheLife, cacheTag } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_LOCALE, catalogueCoverage, mergeCatalogue, type Coverage, type Locale, type LocaleStatus, type Messages } from "@im/core";
import { createPublicClient } from "@/lib/supabase/server";
import { log } from "@/server/log";

/**
 * Public translation catalogue for the marketing site (served at /api/v1/i18n/{locale} and read by the
 * header's client `<T>`). The app (apps/web/src/lib/i18n/server.ts) also resolves locales per request.
 */

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
    // `translations` is not in the generated types yet (see the app's server/phase3-tables.ts).
    const { data, error } = await (createPublicClient() as unknown as SupabaseClient)
      .from("translations")
      .select("key, value, status")
      .eq("locale", locale)
      .eq("status", "approved")
      .limit(5000);
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
