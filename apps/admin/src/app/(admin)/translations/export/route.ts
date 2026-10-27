import { MESSAGE_KEYS, en, normaliseLocale } from "@im/core";
import { resolveStaff } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { fromTable, type TranslationRow } from "@/lib/phase3-tables";

function cell(v: string) {
  return /[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** GET /translations/export?locale=tw[&only=missing] — key,english,value,status CSV for translators (staff only). */
export async function GET(req: Request) {
  const r = await resolveStaff();
  if (r.status !== "ok") return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const locale = normaliseLocale(url.searchParams.get("locale"));
  if (!locale || locale === "en") return new Response("Choose a locale (tw, gaa, ee).", { status: 400 });
  const supabase = await createClient();
  const { data } = await fromTable(supabase, "translations").select("key, value, status").eq("locale", locale).limit(20000);
  const byKey = new Map(((data ?? []) as Pick<TranslationRow, "key" | "value" | "status">[]).map((t) => [t.key, t]));
  const onlyMissing = url.searchParams.get("only") === "missing";
  const lines = ["key,english,value,status"];
  for (const k of MESSAGE_KEYS) {
    const t = byKey.get(k);
    if (onlyMissing && t?.status === "approved") continue;
    lines.push([k, en[k], t?.value ?? "", t?.status ?? "missing"].map(cell).join(","));
  }
  return new Response(lines.join("\n") + "\n", {
    headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="covva-${locale}-${onlyMissing ? "missing" : "all"}.csv"`, "cache-control": "private, no-store" },
  });
}
