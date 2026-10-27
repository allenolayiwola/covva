import "server-only";
import {
  ACCOUNTING_EXPORT_KINDS,
  ACCOUNTING_EXPORT_LABEL,
  LEDGER_ENTRY_LABEL,
  applyTaxRules,
  commissionReport,
  csvString,
  insurerStatement,
  ledgerToJournal,
  taxBaseForEntry,
  toQuickBooksCsv,
  toSageCsv,
  toXeroCsv,
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

/** `2026-09` for a whole calendar month, else `2026-09-01_2026-09-15`. */
export function periodLabel(p: Period): string {
  const [y, m] = p.start.split("-");
  const lastDay = new Date(Date.UTC(Number(y), Number(m), 0)).toISOString().slice(0, 10);
  return p.start.endsWith("-01") && p.end === lastDay ? `${y}-${m}` : `${p.start}_${p.end}`;
}

export function exportPath(kind: AccountingExportKind, orgId: string | null, p: Period): string {
  return `exports/${orgId ?? "platform"}/${kind}-${periodLabel(p)}.csv`;
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

/** Tax lines for the period (active rules only), recorded idempotently in `tax_entries`. */
async function taxLines(svc: Svc, entries: LedgerEntryLike[], orgId: string | null, platformId: string | null) {
  const rules = await taxRules(svc);
  const active = rules.filter((r) => r.status === "active" && r.rate !== null);
  const rows: { entry: LedgerEntryLike; earner: string; base: number; code: string; rate: number; inclusive: boolean; amount: number; ruleId?: string }[] = [];
  if (active.length) {
    for (const e of entries) {
      const base = taxBaseForEntry(e.entry_type);
      if (!base) continue;
      // Only the earner's own income is taxed in its report (platform: Covva's fees).
      const earner = e.org_id;
      if (orgId ? earner !== orgId : earner !== platformId) continue;
      const res = applyTaxRules(Number(e.amount), active, e.created_at, { appliesTo: base });
      for (const l of res.lines) rows.push({ entry: e, earner, base: l.base, code: l.code, rate: l.rate, inclusive: l.inclusive, amount: l.amount, ruleId: l.ruleId });
    }
    if (rows.length) {
      const { error } = await svc.from("tax_entries").upsert(
        rows.map((r) => ({ ledger_entry_id: Number(r.entry.id), tax_rule_id: r.ruleId ?? null, tax_code: r.code, org_id: r.earner, base_amount: r.base, rate: r.rate, inclusive: r.inclusive, amount: r.amount, currency: r.entry.currency })),
        { onConflict: "ledger_entry_id,tax_code", ignoreDuplicates: true },
      );
      if (error) log.warn("accounting.tax_entries_failed", { err: error });
    }
  }
  return { rows, rules };
}

function n2(v: number) {
  return v.toFixed(2);
}

/** Build the CSV text for an export (pure given the loaded data). */
async function buildCsv(svc: Svc, kind: AccountingExportKind, orgId: string | null, p: Period): Promise<{ csv: string; rows: number }> {
  const entries = await ledgerFor(svc, orgId, p);
  const platformId = await platformOrgId(svc);
  const names = await orgNames(svc, entries.flatMap((e) => [e.org_id, e.counterparty_org_id]));
  const name = (id: string | null | undefined) => (id ? names[id] ?? id : "");

  switch (kind) {
    case "insurer_statement": {
      if (!orgId) throw new Error("An insurer statement needs an insurer organisation");
      const s = insurerStatement(entries, { orgId, periodStart: p.start, periodEnd: p.end });
      const body = s.lines.map((l) => [l.date, l.type, l.description, l.reference, l.policyId, n2(l.credit), n2(l.debit), n2(l.balance), s.currency]);
      const totals = [
        ["", "Total premiums received", "Paid by customers directly to the insurer", "", "", n2(s.totals.premiums), "", "", s.currency],
        ["", "Total refunds", "", "", "", "", n2(s.totals.refunds), "", s.currency],
        ["", "Broker commission payable", "", "", "", "", n2(s.totals.commissionPayable), "", s.currency],
        ["", "Platform fees payable", "", "", "", "", n2(s.totals.platformFeesPayable), "", s.currency],
        ["", "Net retained", `${name(orgId)} · ${p.start} to ${p.end}`, "", "", "", "", n2(s.totals.netRetained), s.currency],
      ];
      return { csv: csvString(["date", "type", "description", "reference", "policy_id", "credit", "debit", "balance", "currency"], [...body, ...totals]), rows: body.length };
    }
    case "commission_report": {
      const { data: org } = orgId ? await svc.from("organizations").select("type").eq("id", orgId).maybeSingle() : { data: null };
      const r = commissionReport(entries, org?.type === "broker" ? { brokerOrgId: orgId! } : org?.type === "insurer" ? { insurerOrgId: orgId! } : {});
      const body = r.rows.map((x) => [name(x.brokerOrgId), name(x.insurerOrgId) || "(revenue share)", x.entries, x.policies, n2(x.grossCommission), n2(x.reversals), n2(x.netCommission), n2(x.revenueShare), n2(x.brokerNet), x.currency]);
      body.push(["Total", "", r.totals.entries, r.totals.policies, n2(r.totals.grossCommission), n2(r.totals.reversals), n2(r.totals.netCommission), n2(r.totals.revenueShare), n2(r.totals.brokerNet), "GHS"]);
      return { csv: csvString(["broker", "insurer", "entries", "policies", "gross_commission", "reversals", "net_commission", "revenue_share_to_covva", "broker_net", "currency"], body), rows: r.rows.length };
    }
    case "tax_report": {
      const { rows, rules } = await taxLines(svc, entries, orgId, platformId);
      const body: (string | number | null)[][] = rows.map((r) => [r.entry.created_at.slice(0, 10), LEDGER_ENTRY_LABEL[r.entry.entry_type] ?? r.entry.entry_type, r.entry.reference ?? null, String(r.entry.id), r.code, r.rate, r.inclusive ? "inclusive" : "exclusive", n2(r.base), n2(r.amount), r.entry.currency]);
      for (const rule of rules.filter((x) => x.status !== "active" || x.rate === null)) {
        body.push(["", "Not applied", null, null, rule.code, null, "", "", "", rule.status === "needs_confirmation" ? "Rate needs confirmation by finance / tax adviser" : rule.status]);
      }
      return { csv: csvString(["date", "entry", "reference", "ledger_entry_id", "tax_code", "rate_pct", "basis", "base_amount", "tax_amount", "currency_or_note"], body), rows: rows.length };
    }
    case "platform_revenue": {
      const mine = entries.filter((e) => platformId && e.org_id === platformId && ["platform_fee", "revenue_share", "subscription_fee", "adjustment"].includes(e.entry_type));
      const groups = new Map<string, { month: string; type: string; payer: string; entries: number; minor: number; currency: string }>();
      for (const e of mine) {
        const month = e.created_at.slice(0, 7);
        const key = `${month}|${e.entry_type}|${e.counterparty_org_id ?? ""}|${e.currency}`;
        const g = groups.get(key) ?? { month, type: LEDGER_ENTRY_LABEL[e.entry_type] ?? e.entry_type, payer: name(e.counterparty_org_id), entries: 0, minor: 0, currency: e.currency };
        g.entries++;
        g.minor += Math.round(Number(e.amount) * 100);
        groups.set(key, g);
      }
      const list = [...groups.values()].sort((a, b) => a.month.localeCompare(b.month) || a.type.localeCompare(b.type) || a.payer.localeCompare(b.payer));
      const total = list.reduce((s, g) => s + g.minor, 0);
      const body = list.map((g) => [g.month, g.type, g.payer, g.entries, n2(g.minor / 100), g.currency]);
      body.push(["Total", "", "", mine.length, n2(total / 100), "GHS"]);
      return { csv: csvString(["month", "revenue_type", "paid_by", "entries", "amount", "currency"], body), rows: list.length };
    }
    case "xero_csv":
    case "quickbooks_csv":
    case "sage_csv": {
      const subject = orgId ?? platformId;
      if (!subject) throw new Error("No platform organisation configured");
      const journal = ledgerToJournal(entries, subject, { names });
      const csv = kind === "xero_csv" ? toXeroCsv(journal) : kind === "quickbooks_csv" ? toQuickBooksCsv(journal) : toSageCsv(journal);
      return { csv, rows: journal.length };
    }
  }
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
