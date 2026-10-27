"use server";
import { z } from "zod";
import { LOCALES, en, isMessageKey, messageArgs, parseTranslationCsv } from "@im/core";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";
import { can } from "@/lib/roles";
import { revalidateEverywhere, webCacheNote } from "@/lib/revalidate";
import { fromTable, type TranslationRow } from "@/lib/phase3-tables";

const TRANSLATABLE = LOCALES.filter((l) => l.code !== "en").map((l) => l.code) as [string, ...string[]];

const Save = z.object({
  locale: z.enum(TRANSLATABLE),
  key: z.string().refine(isMessageKey, "Unknown key"),
  value: z.string().trim().min(1, "Enter the translation").max(4000),
  status: z.enum(["draft", "reviewed", "approved"]).default("draft"),
  note: z.string().trim().max(1000).optional(),
});

/** Same placeholders as the English source, so `{name}` etc. still render. */
function argsProblem(key: string, value: string): string | null {
  const want = messageArgs(en[key as keyof typeof en]);
  const got = messageArgs(value);
  const missing = want.filter((a) => !got.includes(a));
  const extra = got.filter((a) => !want.includes(a));
  if (!missing.length && !extra.length) return null;
  return `Placeholders must match the English text${missing.length ? ` — missing {${missing.join("}, {")}}` : ""}${extra.length ? ` — unknown {${extra.join("}, {")}}` : ""}.`;
}

/**
 * Save one translation (draft / reviewed / approved). Approving needs `translationsApprove`
 * and refreshes the web app's `translations` cache tag. Editing an approved value sends it back
 * to draft (DB trigger) unless approved in the same save.
 */
export async function saveTranslation(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("translations");
  if (!auth.ok) return fail(auth.error);
  const parsed = Save.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  if (d.status === "approved" && !can(auth.staff.roles, "translationsApprove")) return fail("Your role can draft and review translations; approval needs platform admin, operations or compliance.");
  const problem = argsProblem(d.key, d.value);
  if (problem) return fail(problem);
  const { data: existing } = await fromTable(auth.supabase, "translations").select("id, status, value, translator_id").eq("locale", d.locale).eq("key", d.key).maybeSingle();
  const row = existing as Pick<TranslationRow, "id" | "status" | "value" | "translator_id"> | null;
  const { error } = row
    ? await fromTable(auth.supabase, "translations").update({ value: d.value, status: d.status, note: d.note || null }).eq("id", row.id)
    : await fromTable(auth.supabase, "translations").insert({ locale: d.locale, key: d.key, value: d.value, status: d.status, note: d.note || null });
  if (error) return fail(dbMessage(error));
  if (d.status === "approved" || row?.status === "approved") {
    const r = await revalidateEverywhere(["translations", `translations:${d.locale}`]);
    return done(`${d.key} ${d.status === "approved" ? "approved and live" : "saved (no longer live until re-approved)"}. ${webCacheNote(r)}`);
  }
  return done(`${d.key} saved as ${d.status}.`);
}

const Import = z.object({
  locale: z.enum(TRANSLATABLE),
  csv: z.string().max(2_000_000),
  status: z.enum(["draft", "reviewed"]).default("draft"),
  overwriteApproved: z.literal("on").optional(),
});

/** CSV import (`key,value`): upserts drafts (or reviewed). Approved rows are kept unless overwrite is ticked. */
export async function importTranslations(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("translations");
  if (!auth.ok) return fail(auth.error);
  const file = fd.get("file");
  const obj = formObject(fd);
  if (file instanceof File && file.size > 0) {
    if (file.size > 2_000_000) return fail("The CSV is larger than 2 MB.");
    obj.csv = await file.text();
  }
  const parsed = Import.safeParse(obj);
  if (!parsed.success) return zodError(parsed.error);
  const d = parsed.data;
  if (!d.csv.trim()) return fail("Paste CSV rows or choose a file.");
  const res = parseTranslationCsv(d.csv, isMessageKey);
  const rows = res.rows.filter((r) => {
    const p = argsProblem(r.key, r.value);
    if (p) res.errors.push({ line: 0, message: `${r.key}: ${p}` });
    return !p;
  });
  if (!rows.length) return fail(`Nothing to import. ${res.errors.slice(0, 5).map((e) => (e.line ? `Line ${e.line}: ${e.message}` : e.message)).join(" ")}`);

  const { data: current } = await fromTable(auth.supabase, "translations").select("id, key, status").eq("locale", d.locale).in("key", rows.map((r) => r.key));
  const byKey = new Map(((current ?? []) as Pick<TranslationRow, "id" | "key" | "status">[]).map((r) => [r.key, r]));
  let inserted = 0;
  let updated = 0;
  let skipped = 0;
  let touchedApproved = false;
  for (const r of rows) {
    const cur = byKey.get(r.key);
    if (cur?.status === "approved" && !d.overwriteApproved) {
      skipped++;
      continue;
    }
    const { error } = cur
      ? await fromTable(auth.supabase, "translations").update({ value: r.value, status: d.status }).eq("id", cur.id)
      : await fromTable(auth.supabase, "translations").insert({ locale: d.locale, key: r.key, value: r.value, status: d.status });
    if (error) return fail(`Stopped at ${r.key}: ${dbMessage(error)} (${inserted} added, ${updated} updated before that).`);
    if (cur) {
      updated++;
      if (cur.status === "approved") touchedApproved = true;
    } else inserted++;
  }
  if (touchedApproved) await revalidateEverywhere(["translations", `translations:${d.locale}`]);
  const errs = res.errors.length ? ` ${res.errors.length} row(s) rejected: ${res.errors.slice(0, 3).map((e) => (e.line ? `line ${e.line} ${e.message}` : e.message)).join("; ")}${res.errors.length > 3 ? "…" : ""}` : "";
  return done(`Imported ${inserted} new and ${updated} updated ${d.status} translation(s)${skipped ? `; ${skipped} approved row(s) kept` : ""}.${errs}`);
}

const Bulk = z.object({ locale: z.enum(TRANSLATABLE) });

/** Approve every `reviewed` translation for a locale (the second-speaker check is done). */
export async function approveReviewed(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("translationsApprove");
  if (!auth.ok) return fail(auth.error);
  const parsed = Bulk.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  const { data, error } = await fromTable(auth.supabase, "translations").update({ status: "approved" }).eq("locale", parsed.data.locale).eq("status", "reviewed").select("id");
  if (error) return fail(dbMessage(error));
  const n = (data ?? []).length;
  if (!n) return done("No reviewed translations to approve.");
  const r = await revalidateEverywhere(["translations", `translations:${parsed.data.locale}`]);
  return done(`Approved ${n} translation(s) — now live. ${webCacheNote(r)}`);
}
