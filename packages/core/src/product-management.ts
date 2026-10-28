/**
 * Insurer product management (Roadmap Phase 1): bulk pause / withdraw / republish with a preview, bulk
 * rate-table import for several products from one CSV, and plain-language change-history lines built
 * from the audit rows `product_change_history` returns. Pure: the server applies the plan through
 * `bulk_set_product_status` (whose rules this mirrors so the preview is honest) and creates the rate
 * tables from the parsed groups.
 */
import { parseCsv, parseRateTableCsv, type CsvError, type RateRow } from "./rate-table";

// ---------------------------------------------------------------------------
// Product status
// ---------------------------------------------------------------------------
export type ProductStatus = "draft" | "pending_approval" | "approved" | "suspended" | "retired";

/** Labels as insurers know them: "approved" is a published product, "suspended" a paused one, "retired" a withdrawn one. */
export const PRODUCT_STATUS_LABEL: Record<ProductStatus, string> = {
  draft: "Draft",
  pending_approval: "Awaiting approval",
  approved: "Published",
  suspended: "Paused",
  retired: "Withdrawn",
};

export function productStatusLabel(status: string | null | undefined): string {
  return PRODUCT_STATUS_LABEL[(status ?? "") as ProductStatus] ?? (status ? status.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—");
}

export type BulkProductAction = "pause" | "withdraw" | "republish";

export interface BulkProductActionMeta {
  value: BulkProductAction;
  label: string;
  /** Status the products move to. */
  target: ProductStatus;
  /** One line for the confirmation step. */
  description: string;
  tone: "wait" | "danger" | "ok";
}

export const BULK_PRODUCT_ACTIONS: readonly BulkProductActionMeta[] = [
  { value: "pause", label: "Pause", target: "suspended", tone: "wait", description: "Customers stop seeing these products and brokers cannot quote them. Existing policies are not affected. You can republish at any time." },
  { value: "republish", label: "Republish", target: "approved", tone: "ok", description: "Paused products go back on sale with their approved current version." },
  { value: "withdraw", label: "Withdraw", target: "retired", tone: "danger", description: "Products are taken off sale for good. Existing policies run to their end date. Only Covva compliance can bring a withdrawn product back." },
];

export function bulkActionMeta(action: string | null | undefined): BulkProductActionMeta | null {
  return BULK_PRODUCT_ACTIONS.find((a) => a.value === action) ?? null;
}

export interface BulkStatusProduct {
  id: string;
  name: string;
  status: string;
  /** Status of the product's current version (null when it has none). */
  currentVersionStatus?: string | null;
}

export interface BulkStatusPlan {
  action: BulkProductAction;
  target: ProductStatus;
  eligible: BulkStatusProduct[];
  skipped: { id: string; name: string; reason: string }[];
}

/**
 * Preview of a bulk status change for an insurer user — the same rules `bulk_set_product_status`
 * applies, so what the confirmation shows is what happens. `isStaff` lets platform staff republish
 * withdrawn products.
 */
export function planBulkStatus(products: BulkStatusProduct[], action: BulkProductAction, opts: { isStaff?: boolean } = {}): BulkStatusPlan {
  const meta = bulkActionMeta(action);
  if (!meta) throw new Error(`Unknown bulk action: ${action}`);
  const plan: BulkStatusPlan = { action, target: meta.target, eligible: [], skipped: [] };
  for (const p of products) {
    let reason: string | null = null;
    if (p.status === meta.target) reason = meta.target === "suspended" ? "already paused" : meta.target === "retired" ? "already withdrawn" : "already published";
    else if (action === "pause" && p.status !== "approved") reason = "only published products can be paused";
    else if (action === "withdraw" && p.status !== "approved" && p.status !== "suspended") reason = "only published or paused products can be withdrawn";
    else if (action === "republish" && p.status === "retired" && !opts.isStaff) reason = "withdrawn products are brought back by Covva compliance";
    else if (action === "republish" && p.status !== "suspended" && p.status !== "retired") reason = "only paused products can be republished";
    else if (action === "republish" && p.currentVersionStatus !== "approved") reason = "no approved version to republish";
    if (reason) plan.skipped.push({ id: p.id, name: p.name, reason });
    else plan.eligible.push(p);
  }
  return plan;
}

/** "Pause 3 products (2 skipped)" for the confirm button. */
export function bulkPlanSummary(plan: BulkStatusPlan): string {
  const meta = bulkActionMeta(plan.action)!;
  const n = plan.eligible.length;
  const base = `${meta.label} ${n === 1 ? "1 product" : `${n} products`}`;
  return plan.skipped.length ? `${base} (${plan.skipped.length} skipped)` : base;
}

// ---------------------------------------------------------------------------
// Bulk rate-table import: one CSV, a `product_code` column, a table per product
// ---------------------------------------------------------------------------
export const BULK_IMPORT_PRODUCT_COLUMN = "product_code";

export interface BulkImportProduct { id: string; code: string; name: string }

export interface BulkImportGroup {
  productId: string;
  code: string;
  name: string;
  rows: RateRow[];
  /** Errors with the line number in the uploaded file. */
  errors: CsvError[];
}

export interface BulkRateImport {
  groups: BulkImportGroup[];
  /** Product codes in the file that are not the insurer's products (with their line count). */
  unknownCodes: { code: string; lines: number }[];
  /** File-level problems (missing columns, empty file). */
  errors: CsvError[];
  totalRows: number;
  /** True when at least one group has rows and nothing blocks the import. */
  ok: boolean;
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Header + one example row per product for the bulk template. */
export function bulkRateImportTemplate(factorKeys: string[], products: Pick<BulkImportProduct, "code">[]): string {
  const header = [BULK_IMPORT_PRODUCT_COLUMN, ...factorKeys, "rate", "rate_kind", "min_premium"];
  const lines = (products.length ? products : [{ code: "PRODUCT_CODE" }]).map((p) => [p.code, ...factorKeys.map(() => "*"), "0.045", "rate_on_value", "200"].map(csvCell).join(","));
  return `${header.map(csvCell).join(",")}\n${lines.join("\n")}\n`;
}

/**
 * Splits one CSV into a rate table per product (matched on `product_code`, case-insensitive) and
 * validates each with the single-table parser. Line numbers refer to the uploaded file.
 */
export function parseBulkRateImport(text: string, factorKeys: string[], products: BulkImportProduct[]): BulkRateImport {
  const result: BulkRateImport = { groups: [], unknownCodes: [], errors: [], totalRows: 0, ok: false };
  const records = parseCsv(text);
  if (!records.length) {
    result.errors.push({ row: 1, message: "The file is empty." });
    return result;
  }
  const headers = records[0]!.map((h) => h.trim().toLowerCase());
  const codeCol = headers.indexOf(BULK_IMPORT_PRODUCT_COLUMN);
  if (codeCol < 0) {
    result.errors.push({ row: 1, message: `Missing column: ${BULK_IMPORT_PRODUCT_COLUMN}. Download the bulk template for the expected layout.` });
    return result;
  }
  const missing = [...factorKeys, "rate"].filter((k) => !headers.includes(k));
  if (missing.length) {
    result.errors.push({ row: 1, message: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the bulk template for the expected layout.` });
    return result;
  }
  const byCode = new Map(products.map((p) => [p.code.trim().toUpperCase(), p]));
  const header = records[0]!.filter((_, i) => i !== codeCol);
  const grouped = new Map<string, { lines: number[]; records: string[][] }>();
  const unknown = new Map<string, number>();
  for (let i = 1; i < records.length; i++) {
    const r = records[i]!;
    const code = (r[codeCol] ?? "").trim().toUpperCase();
    result.totalRows++;
    if (!code) {
      result.errors.push({ row: i + 1, message: `${BULK_IMPORT_PRODUCT_COLUMN} is empty.` });
      continue;
    }
    if (!byCode.has(code)) {
      unknown.set(code, (unknown.get(code) ?? 0) + 1);
      continue;
    }
    const g = grouped.get(code) ?? { lines: [], records: [] };
    g.lines.push(i + 1);
    g.records.push(r.filter((_, c) => c !== codeCol));
    grouped.set(code, g);
  }
  result.unknownCodes = [...unknown.entries()].map(([code, lines]) => ({ code, lines })).sort((a, b) => a.code.localeCompare(b.code));
  for (const [code, g] of grouped) {
    const product = byCode.get(code)!;
    const csv = [header, ...g.records].map((r) => r.map(csvCell).join(",")).join("\n");
    const parsed = parseRateTableCsv(csv, factorKeys);
    const errors = parsed.errors
      .filter((e) => !/Unknown column/.test(e.message)) // product_code was already removed; other unknown columns are reported once below
      .map((e) => ({ row: e.row > 1 ? g.lines[e.row - 2] ?? e.row : 1, message: e.message.replace(/Duplicate of row (\d+)/, (_, n: string) => `Duplicate of row ${g.lines[Number(n) - 2] ?? n}`) }))
      .sort((a, b) => a.row - b.row);
    result.groups.push({ productId: product.id, code: product.code, name: product.name, rows: parsed.rows, errors });
  }
  result.groups.sort((a, b) => a.name.localeCompare(b.name));
  const extra = headers.filter((h) => h && h !== BULK_IMPORT_PRODUCT_COLUMN && !factorKeys.includes(h) && !["rate", "rate_kind", "min_premium"].includes(h));
  if (extra.length) result.errors.push({ row: 1, message: `Unknown column${extra.length > 1 ? "s" : ""} ignored: ${extra.join(", ")}.` });
  const blocking = result.errors.some((e) => /Missing column|empty/.test(e.message)) || result.groups.some((g) => g.errors.some((e) => e.row > 1 || /Missing column|empty/.test(e.message)));
  result.ok = !blocking && result.groups.some((g) => g.rows.length > 0);
  return result;
}

export interface ImportTargetVersion { id: string; version: number; status: string }

/**
 * Which version of a product receives an imported rate table: the newest draft (its pricing can still
 * be pointed at the table), else the current approved version, else the newest version.
 */
export function pickImportTargetVersion<T extends ImportTargetVersion>(versions: T[], currentVersionId?: string | null): { version: T; why: "draft" | "current" | "latest" } | null {
  if (!versions.length) return null;
  const sorted = [...versions].sort((a, b) => b.version - a.version);
  const draft = sorted.find((v) => v.status === "draft");
  if (draft) return { version: draft, why: "draft" };
  const current = currentVersionId ? sorted.find((v) => v.id === currentVersionId) : undefined;
  if (current) return { version: current, why: "current" };
  return { version: sorted[0]!, why: "latest" };
}

// ---------------------------------------------------------------------------
// Change history lines
// ---------------------------------------------------------------------------
export interface ProductHistoryRow {
  event_id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  version_no: number | null;
  entity_label: string | null;
  changes: unknown;
  note: string | null;
}

export interface ProductHistoryLine {
  id: number;
  at: string;
  /** "Ama Owusu", "Covva compliance", "Platform (automated)". */
  actor: string;
  /** Short headline: "v3 published", "Paused", "Rate table “Motor 2027” submitted for review". */
  title: string;
  /** Field-level details, already in words ("Effective from: 2026-01-01 → 2027-01-01"). */
  details: string[];
  tone: "ok" | "info" | "danger" | "neutral" | "wait";
  /** Where to look: "Product", "Version 3", "Rate table". */
  scope: string;
  versionNo: number | null;
}

type Change = { from?: unknown; to?: unknown; changed?: boolean };
const asRecord = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
const isChange = (v: unknown): v is Change => !!v && typeof v === "object" && !Array.isArray(v) && ("from" in (v as object) || "to" in (v as object) || "changed" in (v as object));
const show = (v: unknown): string => (v === null || v === undefined || v === "" ? "—" : typeof v === "string" ? (/^\d{4}-\d{2}-\d{2}T/.test(v) ? v.slice(0, 16).replace("T", " ") : v) : Array.isArray(v) ? v.join(", ") : typeof v === "object" ? "…" : String(v));
const fieldLabel = (k: string) => k.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const COMPLIANCE_LABEL: Record<string, string> = { draft: "Draft", submitted: "Submitted for compliance review", in_review: "In compliance review", returned: "Returned by compliance", published: "Published" };
const TABLE_STATUS_LABEL: Record<string, string> = { draft: "Draft", pending_review: "Submitted for Covva review", approved: "Approved by Covva", rejected: "Rejected by Covva" };

function actorLabel(row: ProductHistoryRow): string {
  if (row.actor_name) return row.actor_name;
  if (row.actor_role === "service_role") return "Platform (automated)";
  if (row.actor_id) return "Covva compliance";
  return "System";
}

/** One readable line per audit row of a product's history. */
export function describeProductChange(row: ProductHistoryRow): ProductHistoryLine {
  const changes = asRecord(row.changes);
  const v = row.version_no;
  const vLabel = v !== null && v !== undefined ? `v${v}` : null;
  const scope = row.entity_type === "products" ? "Product" : row.entity_type === "product_versions" ? (vLabel ? `Version ${v}` : "Version") : row.entity_type === "rate_tables" ? "Rate table" : row.entity_type === "underwriting_rules" ? "Underwriting rule" : row.entity_type === "document_templates" ? "Document template" : "Product";
  const base: ProductHistoryLine = { id: row.event_id, at: row.occurred_at, actor: actorLabel(row), title: "", details: [], tone: "neutral", scope, versionNo: v ?? null };
  const label = row.entity_label ? `“${row.entity_label}”` : "";
  const detailLines = (skip: string[] = []) =>
    Object.entries(changes)
      .filter(([k]) => !skip.includes(k))
      .map(([k, c]) => (isChange(c) ? (c.changed && c.from === undefined ? `${fieldLabel(k)} changed` : `${fieldLabel(k)}: ${show(c.from)} → ${show(c.to)}`) : `${fieldLabel(k)}: ${show(c)}`));

  if (row.action.startsWith("products.bulk_")) {
    const verb = row.action === "products.bulk_pause" ? "Paused" : row.action === "products.bulk_withdraw" ? "Withdrawn" : "Republished";
    return { ...base, title: `${verb} (bulk update)`, details: row.note ? [`Reason: ${row.note}`] : [], tone: row.action === "products.bulk_republish" ? "ok" : row.action === "products.bulk_pause" ? "wait" : "danger" };
  }

  if (row.entity_type === "products") {
    if (row.action === "insert") return { ...base, title: "Product created", details: detailLines(["name"]), tone: "ok" };
    const status = isChange(changes.status) ? changes.status : null;
    if (status) {
      const to = String(status.to ?? "");
      const title = to === "approved" ? "Published" : to === "suspended" ? "Paused" : to === "retired" ? "Withdrawn" : `Status: ${productStatusLabel(to)}`;
      return { ...base, title, details: [`${productStatusLabel(String(status.from ?? ""))} → ${productStatusLabel(to)}`, ...detailLines(["status"])], tone: to === "approved" ? "ok" : to === "suspended" ? "wait" : to === "retired" ? "danger" : "info" };
    }
    if (isChange(changes.current_version_id)) return { ...base, title: "Current version changed", details: detailLines(["current_version_id"]), tone: "info" };
    return { ...base, title: "Product details updated", details: detailLines(), tone: "info" };
  }

  if (row.entity_type === "product_versions") {
    if (row.action === "insert") {
      const st = typeof changes.status === "string" ? changes.status : "draft";
      return { ...base, title: cap(`${vLabel ?? "Version"} created${st === "pending_approval" ? " and submitted for approval" : ""}`), details: detailLines(["version", "status", "compliance_status"]), tone: "ok" };
    }
    const cs = isChange(changes.compliance_status) ? changes.compliance_status : null;
    const st = isChange(changes.status) ? changes.status : null;
    if (cs || st) {
      const to = String((cs?.to ?? st?.to) ?? "");
      const title = cs ? `${vLabel ?? "Version"} ${(COMPLIANCE_LABEL[to] ?? fieldLabel(to)).toLowerCase()}` : `${vLabel ?? "Version"} ${productStatusLabel(to).toLowerCase()}`;
      const tone = to === "published" || to === "approved" ? "ok" : to === "returned" ? "danger" : to === "submitted" || to === "in_review" || to === "pending_approval" ? "wait" : "info";
      const notes = typeof (changes.compliance_notes as Change | undefined)?.to === "string" && (changes.compliance_notes as Change).to ? [`Compliance note: ${String((changes.compliance_notes as Change).to)}`] : [];
      return { ...base, title: cap(title), details: [...notes, ...detailLines(["status", "compliance_status", "compliance_notes", "approved_at", "insurer_approved_at"])], tone };
    }
    if (changes.rating) return { ...base, title: cap(`${vLabel ?? "Version"} pricing rule changed`), details: detailLines(["rating"]), tone: "info" };
    if (changes.scheduled_effective_from || changes.effective_from || changes.effective_to) return { ...base, title: cap(`${vLabel ?? "Version"} effective dates changed`), details: detailLines(), tone: "info" };
    if (changes.issuance_type || changes.sla_hours) return { ...base, title: cap(`${vLabel ?? "Version"} issuance settings changed`), details: detailLines(), tone: "info" };
    return { ...base, title: cap(`${vLabel ?? "Version"} updated`), details: detailLines(), tone: "info" };
  }

  if (row.entity_type === "rate_tables") {
    if (row.action === "insert") return { ...base, title: `Rate table ${label} added${vLabel ? ` to ${vLabel}` : ""}`, details: detailLines(["name", "status"]), tone: "ok" };
    if (row.action === "delete") return { ...base, title: `Rate table ${label} removed`, details: [], tone: "danger" };
    const st = isChange(changes.status) ? changes.status : null;
    if (st) {
      const to = String(st.to ?? "");
      const notes = typeof (changes.review_notes as Change | undefined)?.to === "string" && (changes.review_notes as Change).to ? [`Review note: ${String((changes.review_notes as Change).to)}`] : [];
      return { ...base, title: `Rate table ${label}: ${(TABLE_STATUS_LABEL[to] ?? fieldLabel(to)).toLowerCase()}`, details: [...notes, ...detailLines(["status", "review_notes", "reviewed_at"])], tone: to === "approved" ? "ok" : to === "rejected" ? "danger" : to === "pending_review" ? "wait" : "info" };
    }
    return { ...base, title: `Rate table ${label} updated`, details: detailLines(), tone: "info" };
  }

  if (row.entity_type === "underwriting_rules" || row.entity_type === "document_templates") {
    const noun = row.entity_type === "underwriting_rules" ? "Rule" : "Template";
    if (row.action === "insert") return { ...base, title: `${noun} ${label} added${vLabel ? ` to ${vLabel}` : ""}`, details: detailLines(["name"]), tone: "ok" };
    if (row.action === "delete") return { ...base, title: `${noun} ${label} removed`, details: [], tone: "danger" };
    const active = isChange(changes.active) ? changes.active : null;
    if (active && Object.keys(changes).length === 1) return { ...base, title: `${noun} ${label} ${active.to === true ? "enabled" : "disabled"}`, details: [], tone: active.to === true ? "ok" : "wait" };
    const st = isChange(changes.status) ? changes.status : null;
    if (st) return { ...base, title: `${noun} ${label}: ${(TABLE_STATUS_LABEL[String(st.to)] ?? fieldLabel(String(st.to))).toLowerCase()}`, details: detailLines(["status"]), tone: st.to === "approved" ? "ok" : st.to === "rejected" ? "danger" : "info" };
    return { ...base, title: `${noun} ${label} updated`, details: detailLines(), tone: "info" };
  }

  return { ...base, title: `${fieldLabel(row.action)} ${scope.toLowerCase()}`, details: detailLines(), tone: "neutral" };
}

/** Groups history lines by calendar day (ISO date) for the timeline, newest first. */
export function groupHistoryByDay(lines: ProductHistoryLine[]): { day: string; lines: ProductHistoryLine[] }[] {
  const out: { day: string; lines: ProductHistoryLine[] }[] = [];
  for (const line of [...lines].sort((a, b) => b.id - a.id)) {
    const day = line.at.slice(0, 10);
    const last = out.at(-1);
    if (last && last.day === day) last.lines.push(line);
    else out.push({ day, lines: [line] });
  }
  return out;
}
