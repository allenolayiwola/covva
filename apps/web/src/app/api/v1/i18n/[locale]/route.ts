import { LOCALES, localeDef, normaliseLocale } from "@im/core";
import { getCatalogue } from "@/lib/i18n/server";

/**
 * GET /api/v1/i18n/{locale} — the merged, APPROVED catalogue for a locale (public, cached).
 * English returns an empty `messages` map: clients bundle the English source catalogue and fall
 * back to it for every missing key. Aliases (`ga`, `twi`, `en-GH`) are accepted.
 */
export async function GET(_req: Request, ctx: RouteContext<"/api/v1/i18n/[locale]">) {
  const { locale: raw } = await ctx.params;
  const locale = normaliseLocale(raw);
  if (!locale) {
    return Response.json(
      { ok: false, error: { code: "not_found", message: `Unknown locale. Supported: ${LOCALES.map((l) => l.code).join(", ")}.` } },
      { status: 404, headers: { "cache-control": "public, max-age=300" } },
    );
  }
  const data = await getCatalogue(locale);
  return Response.json(
    { ok: true, data: { ...data, label: localeDef(locale).label, native: localeDef(locale).native, htmlLang: localeDef(locale).htmlLang, fallback: "en" } },
    { headers: { "cache-control": "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400", "content-language": localeDef(locale).htmlLang } },
  );
}
