import { z } from "zod";
import { LOCALES, localeDef, normaliseLocale } from "@im/core";
import { check, invalid, parseJson, withApi } from "@/server/api-auth";

const Body = z.object({ locale: z.string().trim().min(2).max(10) });

/** PUT /api/v1/me/locale — save the signed-in user's preferred UI language (`profiles.locale`). */
export const PUT = withApi(
  async ({ auth, req }) => {
    const { locale: raw } = await parseJson(req, Body);
    const locale = normaliseLocale(raw);
    if (!locale) throw invalid(`Unsupported locale. Use one of: ${LOCALES.map((l) => l.code).join(", ")}.`);
    check(await auth.supabase.from("profiles").update({ locale }).eq("id", auth.userId));
    const def = localeDef(locale);
    return { locale, status: def.status, htmlLang: def.htmlLang };
  },
  { auth: "user", clientGate: false },
);
