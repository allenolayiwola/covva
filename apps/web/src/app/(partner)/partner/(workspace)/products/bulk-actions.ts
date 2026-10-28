"use server";
import { refresh } from "next/cache";
import { z } from "zod";
import { bulkActionMeta, parseBulkRateImport, pickImportTargetVersion, type BulkProductAction } from "@im/core";
import type { Json } from "@im/db";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";

/**
 * Bulk product updates for the insurer workspace (Roadmap Phase 1):
 *  - pause / withdraw / republish several products through `bulk_set_product_status` (one RPC, per-product
 *    skips reported, every status change audited by the products trigger plus one bulk row with the reason);
 *  - one CSV → a draft rate table per product (`product_code` column), attached to the newest draft version
 *    (else the current one). Tables then follow the normal path: submit for Covva review, link to pricing.
 * RLS and the database guard remain the real boundary; these actions re-check the session and role.
 */

const BulkStatus = z.object({
  action: z.enum(["pause", "withdraw", "republish"]),
  reason: z.string().trim().min(5, "Give a reason of at least 5 characters — it is kept in the change history.").max(500),
  ids: z.string().min(1, "Choose at least one product."),
});

export async function bulkSetProductStatus(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = BulkStatus.safeParse({ action: formData.get("action"), reason: formData.get("reason"), ids: formData.getAll("ids").map(String).filter(Boolean).join(",") });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
    const ids = [...new Set(parsed.data.ids.split(",").filter((id) => /^[0-9a-f-]{36}$/i.test(id)))];
    if (!ids.length) return { ok: false, error: "Choose at least one product." };
    if (ids.length > 200) return { ok: false, error: "Update at most 200 products at a time." };
    const { data: own } = await ctx.supabase.from("products").select("id").eq("insurer_org_id", ctx.orgId).in("id", ids);
    if ((own ?? []).length !== ids.length) return { ok: false, error: "Some of the chosen products are not yours. Reload the page and try again." };
    const meta = bulkActionMeta(parsed.data.action as BulkProductAction)!;
    const { data, error } = await ctx.supabase.rpc("bulk_set_product_status", { p_product_ids: ids, p_action: parsed.data.action, p_reason: parsed.data.reason });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't update those products.") };
    const result = (data ?? {}) as { updated?: number; skipped?: { id: string; name: string; reason: string }[] };
    const updated = Number(result.updated ?? 0);
    const skipped = result.skipped ?? [];
    refresh();
    const verb = updated === 1 ? "1 product" : `${updated} products`;
    return {
      ok: true,
      message: `${meta.label}d ${verb}.${skipped.length ? ` Skipped ${skipped.length}: ${skipped.slice(0, 3).map((s) => `${s.name} (${s.reason})`).join("; ")}${skipped.length > 3 ? "…" : ""}.` : ""} Every change is in each product's history.`,
      data: { updated, skipped: skipped.length },
    };
  });
}

const BulkImport = z.object({
  name: z.string().trim().min(2, "Name the tables (e.g. “2027 rates”).").max(100),
  factorKeys: z.string().trim().min(1, "List at least one factor key."),
  csv: z.string().min(1, "Choose a CSV file."),
  submit: z.string().optional(),
});

const factorKey = /^[a-z0-9_]+$/i;

export async function importBulkRateTables(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "insurer", roles: ROLES.underwrite });
    const parsed = BulkImport.safeParse({ name: formData.get("name"), factorKeys: formData.get("factorKeys"), csv: formData.get("csv"), submit: formData.get("submit") ?? undefined });
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Check the form" };
    const keys = [...new Set(parsed.data.factorKeys.split(/[,\s]+/).map((k) => k.trim()).filter(Boolean))];
    const bad = keys.find((k) => !factorKey.test(k) || k.length > 60);
    if (bad) return { ok: false, error: `"${bad}": factor keys use letters, numbers and _ only.` };
    const { data: products } = await ctx.supabase
      .from("products")
      .select("id, code, name, current_version_id, versions:product_versions!product_versions_product_id_fkey(id, version, status)")
      .eq("insurer_org_id", ctx.orgId);
    const catalogue = (products ?? []).map((p) => ({ id: p.id, code: p.code, name: p.name }));
    const result = parseBulkRateImport(parsed.data.csv, keys, catalogue);
    if (!result.ok) {
      const first = result.errors[0] ?? result.groups.flatMap((g) => g.errors)[0];
      return { ok: false, error: first ? `Fix the CSV first: row ${first.row}: ${first.message}` : result.unknownCodes.length ? `No rows match your products. Unknown product codes: ${result.unknownCodes.map((u) => u.code).join(", ")}.` : "The file has no rows to import." };
    }
    const created: string[] = [];
    for (const g of result.groups) {
      if (!g.rows.length) continue;
      const product = (products ?? []).find((p) => p.id === g.productId);
      const versions = ((product?.versions ?? []) as { id: string; version: number; status: string }[]);
      const target = pickImportTargetVersion(versions, product?.current_version_id);
      if (!target) {
        created.push(`${g.name}: skipped (no version yet — create one first)`);
        continue;
      }
      const submit = parsed.data.submit === "on";
      const { data: table, error } = await ctx.supabase
        .from("rate_tables")
        .insert({ product_version_id: target.version.id, name: parsed.data.name, factor_keys: keys, status: "draft", source: "csv", submitted_by: ctx.userId, submitted_by_org_id: ctx.orgId })
        .select("id")
        .single();
      if (error || !table) return { ok: false, error: `${g.name}: ${dbMessage(error, "the rate table could not be created.")} ${created.length ? `Already created: ${created.join("; ")}.` : ""}` };
      const { error: rowsErr } = await ctx.supabase.from("rate_rows").insert(g.rows.map((r) => ({ rate_table_id: table.id, factors: r.factors as Json, rate: r.rate, rate_kind: r.rate_kind, min_premium: r.min_premium ?? null })));
      if (rowsErr) return { ok: false, error: `${g.name}: rows could not be saved — ${dbMessage(rowsErr)}` };
      if (submit) {
        const { error: subErr } = await ctx.supabase.from("rate_tables").update({ status: "pending_review" }).eq("id", table.id);
        if (subErr) return { ok: false, error: `${g.name}: imported, but could not be submitted for review — ${dbMessage(subErr)}` };
      }
      created.push(`${g.name} → v${target.version.version} (${g.rows.length} row${g.rows.length === 1 ? "" : "s"}${target.why === "draft" ? ", draft version" : target.why === "current" ? ", current version" : ""})`);
    }
    refresh();
    return {
      ok: true,
      message: `Imported ${created.length} rate table${created.length === 1 ? "" : "s"}: ${created.join("; ")}.${parsed.data.submit === "on" ? " Submitted for Covva review." : " Each table is a draft: open the version to review it, submit it for Covva review and link it to pricing."}${result.unknownCodes.length ? ` Ignored unknown product codes: ${result.unknownCodes.map((u) => u.code).join(", ")}.` : ""}`,
      data: { created: created.length },
    };
  });
}
