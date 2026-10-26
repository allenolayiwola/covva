/**
 * Rate tables as first-class data (Addendum 2 B, Roadmap Phase 0).
 *
 * A rate table has `factor_keys` (e.g. vehicle_use, vehicle_age_band, region) and rows whose
 * `factors` give a value per key ('*' = any). `lookupRate` picks the most specific matching
 * row; `rateFromTable` turns it into the same premium shape as `ratePremium` so quotes,
 * comparison and the simulator do not care which rule model priced them.
 */
import type { RatingLine, RatingResult, RiskData } from "./rating";

export type RateKind = "rate_on_value" | "flat" | "per_unit";
export const RATE_KINDS: RateKind[] = ["rate_on_value", "flat", "per_unit"];

export interface RateLoading { field: string; equals?: unknown; lt?: number; gt?: number; factor: number; label?: string }

export interface RateRow {
  id?: string;
  /** Factor values keyed by factor key; '*' (or a missing key) matches anything. */
  factors: Record<string, unknown>;
  /** Rate on value (0.045 = 4.5%), flat amount, or amount per unit, by `rate_kind`. */
  rate: number;
  rate_kind: RateKind;
  min_premium?: number | null;
  loadings?: RateLoading[] | null;
}

export interface RateTableDef {
  id?: string;
  name?: string;
  factor_keys: string[];
  base_currency?: string | null;
  /** Fields summed to the insured value for `rate_on_value` rows (default: sum_insured). */
  value_fields?: string[];
  /** Field holding the unit count for `per_unit` rows (default: 1 unit). */
  units_field?: string;
  /** Table-level minimum premium, applied after row minimums and loadings. */
  min_premium?: number | null;
}

export const WILDCARD = "*";

const norm = (v: unknown): string => (v === undefined || v === null ? "" : String(v).trim().toLowerCase());
const num = (v: unknown): number => {
  if (typeof v === "number") return Number.isFinite(v) ? v : 0;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return 0;
};

/**
 * Finds the row matching `factors`. Every factor key must match exactly (case-insensitive,
 * trimmed) or be a wildcard. Most specific (fewest wildcards) wins; ties go to the row with
 * the most matching keys declared, then to the earliest row, so the result is deterministic.
 */
export function lookupRate(rows: RateRow[], factors: Record<string, unknown>, factorKeys?: string[]): RateRow | null {
  const keys = factorKeys?.length ? factorKeys : [...new Set(rows.flatMap((r) => Object.keys(r.factors ?? {})))];
  let best: { row: RateRow; specificity: number; declared: number; index: number } | null = null;
  rows.forEach((row, index) => {
    let specificity = 0;
    let declared = 0;
    for (const k of keys) {
      const want = row.factors?.[k];
      if (want === undefined || want === null || norm(want) === WILDCARD) continue;
      declared++;
      if (norm(want) !== norm(factors[k])) return;
      specificity++;
    }
    if (!best || specificity > best.specificity || (specificity === best.specificity && declared > best.declared)) {
      best = { row, specificity, declared, index };
    }
  });
  return best ? (best as { row: RateRow }).row : null;
}

function loadingMatches(l: RateLoading, value: unknown): boolean {
  if (l.equals !== undefined) return value === l.equals || String(value) === String(l.equals);
  if (l.lt !== undefined) return value !== undefined && value !== null && value !== "" && num(value) < l.lt;
  if (l.gt !== undefined) return num(value) > l.gt;
  return false;
}

/** Human label for the factors a row matched on (for the rating lines). */
function factorSummary(keys: string[], risk: RiskData): string {
  const parts = keys.map((k) => `${k.replace(/_/g, " ")}: ${risk[k] === undefined || risk[k] === "" ? "any" : String(risk[k]).replace(/_/g, " ")}`);
  return parts.length ? parts.join(", ") : "all risks";
}

/** Prices a risk from a rate table. Same result shape as `ratePremium`. */
export function rateFromTable(table: RateTableDef, rows: RateRow[], risk: RiskData): RatingResult {
  const lines: RatingLine[] = [];
  const missing: string[] = [];
  const factors: Record<string, unknown> = {};
  for (const k of table.factor_keys) {
    factors[k] = risk[k];
    if (risk[k] === undefined || risk[k] === null || risk[k] === "") missing.push(k);
  }
  const row = lookupRate(rows, factors, table.factor_keys);
  if (!row) {
    lines.push({ label: `No rate for ${factorSummary(table.factor_keys, risk)}` });
    return { ok: false, premium: 0, basePremium: 0, lines, appliedLoadings: [], sumInsured: null, missingFields: [...new Set([...missing, "rate_table_row"])] };
  }

  let base = 0;
  let sumInsured: number | null = null;
  const rate = num(row.rate);
  switch (row.rate_kind) {
    case "rate_on_value": {
      const fields = table.value_fields?.length ? table.value_fields : ["sum_insured"];
      const total = fields.reduce((s, f) => s + num(risk[f]), 0);
      if (total <= 0) missing.push(...fields.filter((f) => !risk[f]));
      sumInsured = total;
      base = total * rate;
      lines.push({ label: `${(rate * 100).toFixed(2)}% of GH₵ ${total.toLocaleString("en-GH")} (${factorSummary(table.factor_keys, risk)})`, amount: base });
      break;
    }
    case "per_unit": {
      const units = table.units_field ? num(risk[table.units_field]) : 1;
      if (table.units_field && !units) missing.push(table.units_field);
      base = units * rate;
      lines.push({ label: `${units} × GH₵ ${rate} (${factorSummary(table.factor_keys, risk)})`, amount: base });
      break;
    }
    case "flat":
    default:
      base = rate;
      lines.push({ label: `Flat premium (${factorSummary(table.factor_keys, risk)})`, amount: base });
      break;
  }

  let premium = base;
  const applied: string[] = [];
  for (const l of row.loadings ?? []) {
    if (loadingMatches(l, risk[l.field])) {
      premium *= l.factor;
      applied.push(l.label ?? l.field);
      lines.push({ label: l.label ?? l.field, factor: l.factor });
    }
  }
  const min = Math.max(num(row.min_premium), num(table.min_premium));
  if (premium < min) {
    lines.push({ label: "Minimum premium applies", amount: min });
    premium = min;
  }
  const uniqueMissing = [...new Set(missing)];
  return {
    ok: uniqueMissing.length === 0,
    premium: Math.round(premium),
    basePremium: Math.round(base),
    lines,
    appliedLoadings: applied,
    sumInsured,
    missingFields: uniqueMissing,
  };
}

// ---------------------------------------------------------------------------
// CSV import / export
// ---------------------------------------------------------------------------
export interface CsvError { row: number; message: string }
export interface ParsedRateTable { rows: RateRow[]; errors: CsvError[]; headers: string[] }

const FIXED_COLUMNS = ["rate", "rate_kind", "min_premium"] as const;

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF, BOM. */
export function parseCsv(text: string): string[][] {
  const out: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(field); field = "";
      out.push(row); row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); out.push(row); }
  return out.filter((r) => r.some((cell) => cell.trim() !== ""));
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Header + one example row for the given factor keys. */
export function rateTableCsvTemplate(factorKeys: string[]): string {
  const header = [...factorKeys, ...FIXED_COLUMNS];
  const example = [...factorKeys.map(() => WILDCARD), "0.045", "rate_on_value", "200"];
  return `${header.map(csvCell).join(",")}\n${example.map(csvCell).join(",")}\n`;
}

/**
 * Parses a CSV into rate rows. Columns: every factor key, then rate, rate_kind
 * (optional, default rate_on_value) and min_premium (optional). Errors carry the
 * 1-based line number of the offending row (line 1 is the header).
 */
export function parseRateTableCsv(text: string, factorKeys: string[]): ParsedRateTable {
  const errors: CsvError[] = [];
  const rows: RateRow[] = [];
  const records = parseCsv(text);
  if (!records.length) return { rows, errors: [{ row: 1, message: "The file is empty." }], headers: [] };
  const headers = records[0]!.map((h) => h.trim().toLowerCase());
  const col = (name: string) => headers.indexOf(name);

  const missingHeaders = [...factorKeys, "rate"].filter((k) => col(k) < 0);
  if (missingHeaders.length) {
    errors.push({ row: 1, message: `Missing column${missingHeaders.length > 1 ? "s" : ""}: ${missingHeaders.join(", ")}. Download the template for the expected layout.` });
    return { rows, errors, headers };
  }
  const unknown = headers.filter((h) => h && !factorKeys.includes(h) && !(FIXED_COLUMNS as readonly string[]).includes(h));
  if (unknown.length) errors.push({ row: 1, message: `Unknown column${unknown.length > 1 ? "s" : ""} ignored: ${unknown.join(", ")}.` });

  const seen = new Map<string, number>();
  for (let i = 1; i < records.length; i++) {
    const line = i + 1;
    const r = records[i]!;
    const cell = (name: string) => (col(name) >= 0 ? (r[col(name)] ?? "").trim() : "");
    const factors: Record<string, string> = {};
    let bad = false;
    for (const k of factorKeys) {
      const v = cell(k);
      if (v === "") { errors.push({ row: line, message: `${k} is empty (use * for any).` }); bad = true; }
      factors[k] = v;
    }
    const rateRaw = cell("rate");
    const rate = Number(rateRaw.replace(/%$/, ""));
    if (rateRaw === "" || Number.isNaN(rate) || rate < 0) { errors.push({ row: line, message: `rate "${rateRaw}" is not a number ≥ 0.` }); bad = true; }
    const kindRaw = cell("rate_kind") || "rate_on_value";
    if (!RATE_KINDS.includes(kindRaw as RateKind)) { errors.push({ row: line, message: `rate_kind "${kindRaw}" must be one of ${RATE_KINDS.join(", ")}.` }); bad = true; }
    const finalRate = rateRaw.endsWith("%") ? rate / 100 : rate;
    if (kindRaw === "rate_on_value" && finalRate > 1) errors.push({ row: line, message: `rate ${rateRaw} on value is over 100% — write 0.045 (or 4.5%) for 4.5%.` });
    const minRaw = cell("min_premium");
    const min = minRaw === "" ? null : Number(minRaw);
    if (min !== null && (Number.isNaN(min) || min < 0)) { errors.push({ row: line, message: `min_premium "${minRaw}" is not a number ≥ 0.` }); bad = true; }
    const key = factorKeys.map((k) => norm(factors[k])).join("|");
    const dup = seen.get(key);
    if (dup) { errors.push({ row: line, message: `Duplicate of row ${dup} (same factors).` }); bad = true; } else seen.set(key, line);
    if (bad) continue;
    rows.push({ factors, rate: finalRate, rate_kind: kindRaw as RateKind, min_premium: min, loadings: [] });
  }
  if (!rows.length && !errors.some((e) => e.row > 1)) errors.push({ row: 2, message: "No data rows found under the header." });
  return { rows, errors, headers };
}

/** Rows back to CSV (for download / round-trip). */
export function rateTableToCsv(factorKeys: string[], rows: RateRow[]): string {
  const header = [...factorKeys, ...FIXED_COLUMNS];
  const body = rows.map((r) => [...factorKeys.map((k) => r.factors[k] ?? WILDCARD), r.rate, r.rate_kind, r.min_premium ?? ""].map(csvCell).join(","));
  return `${header.join(",")}\n${body.join("\n")}${body.length ? "\n" : ""}`;
}
