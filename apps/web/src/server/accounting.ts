import "server-only";
import {
  ACCOUNTING_EXPORT_KINDS,
  ACCOUNTING_EXPORT_LABEL,
  buildExportCsv,
  exportStoragePath,
  type AccountingExportKind,
  type LedgerEntryLike,
  type TaxRuleLike,
} from "@im/core";
import type { Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { platformOrgId } from "@/server/commercial";
import { previousMonth } from "@/server/ledger";
import { log } from "@/server/log";

/**
 * Accounting exports (Roadmap Phase 3; Addendum 2 F): insurer statements, commission reports, tax reports,
 * platform revenue and journal CSVs for Xero / QuickBooks / Sage, built from the append-only ledger.
 * Files are written to the private `documents` bucket at `exports/<org|platform>/<kind>-<period>.csv`
 * and handed out as short-lived signed URLs. Tax lines use ACTIVE tax rules only (seeded rules need
 * confirmation by finance — see docs/OPERATIONS.md); computed lines are recorded in `tax_entries`.
 *
 * Everything runs with the service client; callers MUST authorise the actor for `orgId` first
 * (owners / admins / finance of that organisation, or platform staff for platform exports).
 */
type Svc = ReturnType<typeof createServiceClient>;
export type AccountingExport = Row<"accounting_exports">;
export interface Period { start: string; end: string }

export const EXPORTS_FOR: Record<"insurer" | "broker" | "platform", AccountingExportKind[]> = {
  insurer: ["insurer_statement", "commission_report", "tax_report", "xero_csv", "quickbooks_csv", "sage_csv"],
  broker: ["commission_report", "tax_report", "xero_csv", "quickbooks_csv", "sage_csv"],
  platform: [...ACCOUNTING_EXPORT_KINDS],
};

export function isExportKind(v: unknown): v is AccountingExportKind {
  return typeof v === "string" && (ACCOUNTING_EXPORT_KINDS as readonly string[]).includes(v);
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

export function exportPath(kind: AccountingExportKind, orgId: string | null, p: Period): string {
  return exportStoragePath(kind, orgId, p);
}

async function ledgerFor(svc: Svc, orgId: string | null, p: Period): Promise<LedgerEntryLike[]> {
  const out: LedgerEntryLike[] = [];
  const pageSize = 1000;
  for (let from = 0; from < 50_000; from += pageSize) {
    let q = svc
      .from("ledger_entries")
      .select("id, created_at, entry_type, org_id, counterparty_org_id, amount, currency, memo, reference, payment_id, policy_id")
      .gte("created_at", `${p.start}T00:00:00Z`)
      .lt("created_at", `${nextDay(p.end)}T00:00:00Z`)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (orgId) q = q.or(`org_id.eq.${orgId},counterparty_org_id.eq.${orgId}`);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    out.push(...((data ?? []) as LedgerEntryLike[]));
    if (!data || data.length < pageSize) break;
  }
  return out;
}

async function orgNames(svc: Svc, ids: (string | null | undefined)[]): Promise<Record<string, string>> {
  const unique = [...new Set(ids.filter((x): x is string => !!x))];
  if (!unique.length) return {};
  const { data } = await svc.from("organizations").select("id, name").in("id", unique);
  return Object.fromEntries((data ?? []).map((o) => [o.id, o.name]));
}

async function taxRules(svc: Svc): Promise<TaxRuleLike[]> {
  const { data } = await svc.from("tax_rules").select("id, code, name, applies_to, rate, inclusive, effective_from, effective_to, status").order("code");
  return (data ?? []) as TaxRuleLike[];
}

/** Load the ledger and build the CSV; tax lines (active rules only) are recorded idempotently in `tax_entries`. */
async function buildCsv(svc: Svc, kind: AccountingExportKind, orgId: string | null, p: Period): Promise<{ csv: string; rows: number }> {
  const entries = await ledgerFor(svc, orgId, p);
  const [platformId, names, rules, org] = await Promise.all([
    platformOrgId(svc),
    orgNames(svc, entries.flatMap((e) => [e.org_id, e.counterparty_org_id]).concat(orgId)),
    kind === "tax_report" ? taxRules(svc) : Promise.resolve([] as TaxRuleLike[]),
    orgId ? svc.from("organizations").select("type").eq("id", orgId).maybeSingle().then((r) => r.data) : Promise.resolve(null),
  ]);
  const built = buildExportCsv(kind, { entries, orgId, orgType: org?.type ?? (orgId ? null : "platform"), platformOrgId: platformId, names, taxRules: rules, period: p });
  if (built.taxLines.length) {
    const { error } = await svc.from("tax_entries").upsert(
      built.taxLines.map((t) => ({ ledger_entry_id: t.ledgerEntryId, tax_rule_id: t.ruleId, tax_code: t.code, org_id: t.orgId, base_amount: t.base, rate: t.rate, inclusive: t.inclusive, amount: t.amount, currency: t.currency })),
      { onConflict: "ledger_entry_id,tax_code", ignoreDuplicates: true },
    );
    if (error) log.warn("accounting.tax_entries_failed", { err: error });
  }
  return { csv: built.csv, rows: built.rows };
}

export interface ExportResult { id: string | null; kind: AccountingExportKind; storagePath: string | null; rowCount: number; url: string | null; status: "ready" | "failed"; error?: string }

/**
 * Generate an export for `orgId` (null = platform) over `period` and store it. Re-running the same
 * kind and period overwrites the file and records a new `accounting_exports` row (history is kept).
 */
export async function runExport(kind: AccountingExportKind, orgId: string | null, period: Period, opts: { createdBy?: string | null; svc?: Svc; signedUrlSeconds?: number } = {}): Promise<ExportResult> {
  if (!isExportKind(kind)) throw new Error("Unknown export");
  if (!DATE.test(period.start) || !DATE.test(period.end) || period.end < period.start) throw new Error("Choose a valid period");
  const svc = opts.svc ?? createServiceClient();
  const path = exportPath(kind, orgId, period);
  try {
    const { csv, rows } = await buildCsv(svc, kind, orgId, period);
    const { error: upErr } = await svc.storage.from("documents").upload(path, new TextEncoder().encode(csv), { contentType: "text/csv", upsert: true });
    if (upErr) throw new Error(upErr.message);
    const { data: row } = await svc.from("accounting_exports").insert({ org_id: orgId, kind, period_start: period.start, period_end: period.end, status: "ready", storage_path: path, row_count: rows, created_by: opts.createdBy ?? null }).select("id").single();
    const url = await signedExportUrl(path, opts.signedUrlSeconds ?? 600, svc);
    return { id: row?.id ?? null, kind, storagePath: path, rowCount: rows, url, status: "ready" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Export failed";
    log.error("accounting.export_failed", { kind, orgId, period, err });
    const { data: row } = await svc.from("accounting_exports").insert({ org_id: orgId, kind, period_start: period.start, period_end: period.end, status: "failed", error: message.slice(0, 500), created_by: opts.createdBy ?? null }).select("id").single();
    return { id: row?.id ?? null, kind, storagePath: null, rowCount: 0, url: null, status: "failed", error: message };
  }
}

/** Short-lived download link for a stored export (the bucket is private). */
export async function signedExportUrl(path: string, seconds = 600, svc: Svc = createServiceClient()): Promise<string | null> {
  if (!path.startsWith("exports/")) return null;
  const { data } = await svc.storage.from("documents").createSignedUrl(path, seconds, { download: path.split("/").pop() });
  return data?.signedUrl ?? null;
}

/** Signed URL for an export row the caller may see (RLS: org owners/admins/finance or staff). */
export async function exportDownloadUrl(id: string, allowed: (row: Pick<AccountingExport, "org_id">) => boolean): Promise<string | null> {
  const svc = createServiceClient();
  const { data } = await svc.from("accounting_exports").select("org_id, storage_path, status").eq("id", id).maybeSingle();
  if (!data || data.status !== "ready" || !data.storage_path || !allowed(data)) return null;
  return signedExportUrl(data.storage_path, 600, svc);
}

/**
 * Cron `accounting-exports` (monthly, 2nd at 04:00): last month's insurer statements and commission
 * reports for every organisation with ledger activity, plus the platform's commission report, revenue
 * and tax report.
 */
export async function monthlyAccountingExports(svc: Svc): Promise<Record<string, unknown>> {
  const period = previousMonth();
  const { data: rows } = await svc.from("ledger_entries").select("org_id, counterparty_org_id").gte("created_at", `${period.start}T00:00:00Z`).lt("created_at", `${nextDay(period.end)}T00:00:00Z`).limit(50_000);
  const ids = [...new Set((rows ?? []).flatMap((r) => [r.org_id, r.counterparty_org_id]).filter((x): x is string => !!x))];
  const { data: orgs } = ids.length ? await svc.from("organizations").select("id, type").in("id", ids) : { data: [] as { id: string; type: string }[] };
  let ready = 0;
  let failed = 0;
  const tally = (r: ExportResult) => (r.status === "ready" ? ready++ : failed++);
  for (const o of orgs ?? []) {
    if (o.type === "insurer") {
      tally(await runExport("insurer_statement", o.id, period, { svc }));
      tally(await runExport("commission_report", o.id, period, { svc }));
    } else if (o.type === "broker") {
      tally(await runExport("commission_report", o.id, period, { svc }));
    }
  }
  for (const k of ["commission_report", "platform_revenue", "tax_report"] as const) tally(await runExport(k, null, period, { svc }));
  return { period, organisations: (orgs ?? []).length, ready, failed };
}

export { ACCOUNTING_EXPORT_LABEL };
