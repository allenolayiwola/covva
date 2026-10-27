import "server-only";
import { buildExportCsv, exportStoragePath, type AccountingExportKind, type LedgerEntryLike, type TaxRuleLike } from "@im/core";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Admin-side accounting export (same builder as the web app's server/accounting.ts, from @im/core).
 * Runs with the service client AFTER the caller has authorised a staff member (commercial permission):
 * the ledger is read in full and the CSV stored in the private documents bucket.
 */
type Svc = ReturnType<typeof createServiceClient>;
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function ledger(svc: Svc, orgId: string | null, p: { start: string; end: string }): Promise<LedgerEntryLike[]> {
  const out: LedgerEntryLike[] = [];
  for (let from = 0; from < 50_000; from += 1000) {
    let q = svc.from("ledger_entries").select("id, created_at, entry_type, org_id, counterparty_org_id, amount, currency, memo, reference, payment_id, policy_id").gte("created_at", `${p.start}T00:00:00Z`).lt("created_at", `${nextDay(p.end)}T00:00:00Z`).order("id").range(from, from + 999);
    if (orgId) q = q.or(`org_id.eq.${orgId},counterparty_org_id.eq.${orgId}`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as LedgerEntryLike[]));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function runAdminExport(kind: AccountingExportKind, orgId: string | null, period: { start: string; end: string }, createdBy: string): Promise<{ id: string | null; status: "ready" | "failed"; rows: number; error?: string }> {
  const svc = createServiceClient();
  try {
    const entries = await ledger(svc, orgId, period);
    const ids = [...new Set(entries.flatMap((e) => [e.org_id, e.counterparty_org_id]).concat(orgId).filter((x): x is string => !!x))];
    const [{ data: orgs }, { data: platform }, { data: rules }] = await Promise.all([
      ids.length ? svc.from("organizations").select("id, name, type").in("id", ids) : Promise.resolve({ data: [] as { id: string; name: string; type: string }[] }),
      svc.from("organizations").select("id").eq("type", "platform").limit(1).maybeSingle(),
      svc.from("tax_rules").select("id, code, applies_to, rate, inclusive, effective_from, effective_to, status"),
    ]);
    const names = Object.fromEntries((orgs ?? []).map((o) => [o.id, o.name]));
    const orgType = orgId ? (orgs ?? []).find((o) => o.id === orgId)?.type ?? null : "platform";
    const built = buildExportCsv(kind, { entries, orgId, orgType, platformOrgId: platform?.id ?? null, names, taxRules: (rules ?? []) as TaxRuleLike[], period });
    if (built.taxLines.length) {
      await svc.from("tax_entries").upsert(
        built.taxLines.map((t) => ({ ledger_entry_id: t.ledgerEntryId, tax_rule_id: t.ruleId, tax_code: t.code, org_id: t.orgId, base_amount: t.base, rate: t.rate, inclusive: t.inclusive, amount: t.amount, currency: t.currency })),
        { onConflict: "ledger_entry_id,tax_code", ignoreDuplicates: true },
      );
    }
    const path = exportStoragePath(kind, orgId, period);
    const { error: upErr } = await svc.storage.from("documents").upload(path, new TextEncoder().encode(built.csv), { contentType: "text/csv", upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { data: row } = await svc.from("accounting_exports").insert({ org_id: orgId, kind, period_start: period.start, period_end: period.end, status: "ready", storage_path: path, row_count: built.rows, created_by: createdBy }).select("id").single();
    return { id: row?.id ?? null, status: "ready", rows: built.rows };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    const { data: row } = await svc.from("accounting_exports").insert({ org_id: orgId, kind, period_start: period.start, period_end: period.end, status: "failed", error: message.slice(0, 500), created_by: createdBy }).select("id").single();
    return { id: row?.id ?? null, status: "failed", rows: 0, error: message };
  }
}

export async function signedExportUrl(path: string): Promise<string | null> {
  if (!path.startsWith("exports/")) return null;
  const { data } = await createServiceClient().storage.from("documents").createSignedUrl(path, 600, { download: path.split("/").pop() });
  return data?.signedUrl ?? null;
}
