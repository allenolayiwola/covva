/**
 * Indicative rating engine. Produces ESTIMATES from insurer-approved rating rules
 * stored on product_versions.rating. Estimates are never binding: the insurer or
 * broker converts them to "awaiting_underwriting" or "ready_to_accept" quotes.
 */
import { rateFromTable, type RateRow, type RateTableDef } from "./rate-table";

export type RiskData = Record<string, unknown>;

interface Loading { field: string; equals?: unknown; lt?: number; gt?: number; factor: number; label?: string }
interface Variants { field: string; factors: Record<string, number> }
interface Addon { field: string; per_unit_annual: number }

export type RatingRule =
  | { model: "rate_on_value"; value_fields: string[]; rate: number; min_premium?: number; loadings?: Loading[]; variants?: Variants; addons?: Addon[] }
  | { model: "per_day"; days_field: string; persons_field?: string; daily_rate: number; min_premium?: number; loadings?: Loading[]; variants?: Variants }
  | { model: "per_person"; persons_field: string; base: number; min_premium?: number; loadings?: Loading[]; variants?: Variants }
  | { model: "age_banded"; value_field: string; age_field: string; bands: { max_age: number; rate: number }[]; min_premium?: number; loadings?: Loading[] }
  | { model: "flat"; amount: number; loadings?: Loading[] }
  /**
   * First-class rate table (Addendum 2 B). The stored rule only references the table;
   * the server resolves `rows` (and the table's factor keys) before pricing. When `rows`
   * is absent the result is not ok (missing "rate_table_rows") rather than a wrong price.
   */
  | ({ model: "rate_table"; rate_table_id: string; rows?: RateRow[] } & Partial<Omit<RateTableDef, "id" | "name">>);

export const RATING_MODELS = ["rate_on_value", "per_day", "per_person", "age_banded", "flat", "rate_table"] as const;

export interface RatingLine { label: string; amount?: number; factor?: number }
export interface RatingResult {
  ok: boolean;
  premium: number;
  basePremium: number;
  lines: RatingLine[];
  appliedLoadings: string[];
  sumInsured: number | null;
  missingFields: string[];
}

const num = (v: unknown): number => {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v))) return Number(v);
  return 0;
};

function matches(l: Loading, value: unknown): boolean {
  if (l.equals !== undefined) return value === l.equals || String(value) === String(l.equals);
  if (l.lt !== undefined) return value !== undefined && value !== null && value !== "" && num(value) < l.lt;
  if (l.gt !== undefined) return num(value) > l.gt;
  return false;
}

export function ratePremium(rule: RatingRule, risk: RiskData): RatingResult {
  if (rule.model === "rate_table") {
    if (!Array.isArray(rule.rows)) {
      return { ok: false, premium: 0, basePremium: 0, lines: [{ label: "Rate table not loaded" }], appliedLoadings: [], sumInsured: null, missingFields: ["rate_table_rows"] };
    }
    return rateFromTable({ factor_keys: rule.factor_keys ?? [], value_fields: rule.value_fields, units_field: rule.units_field, min_premium: rule.min_premium }, rule.rows, risk);
  }
  const lines: RatingLine[] = [];
  const missing: string[] = [];
  let base = 0;
  let sumInsured: number | null = null;

  switch (rule.model) {
    case "rate_on_value": {
      const total = rule.value_fields.reduce((s, f) => s + num(risk[f]), 0);
      if (total <= 0) missing.push(...rule.value_fields.filter((f) => !risk[f]));
      sumInsured = total;
      base = total * rule.rate;
      lines.push({ label: `${(rule.rate * 100).toFixed(2)}% of GH₵ ${total.toLocaleString("en-GH")}`, amount: base });
      for (const a of rule.addons ?? []) {
        const units = num(risk[a.field]);
        if (units > 0) {
          const add = units * a.per_unit_annual;
          base += add;
          lines.push({ label: `Add-on: ${a.field.replace(/_/g, " ")}`, amount: add });
        }
      }
      break;
    }
    case "per_day": {
      const days = num(risk[rule.days_field]);
      const persons = rule.persons_field ? Math.max(1, num(risk[rule.persons_field])) : 1;
      if (!days) missing.push(rule.days_field);
      base = days * persons * rule.daily_rate;
      lines.push({ label: `${days} days × ${persons} traveller(s) × GH₵ ${rule.daily_rate}`, amount: base });
      break;
    }
    case "per_person": {
      const persons = Math.max(1, num(risk[rule.persons_field]));
      base = persons * rule.base;
      lines.push({ label: `${persons} member(s) × GH₵ ${rule.base}`, amount: base });
      break;
    }
    case "age_banded": {
      const value = num(risk[rule.value_field]);
      const age = num(risk[rule.age_field]);
      if (!value) missing.push(rule.value_field);
      if (!age) missing.push(rule.age_field);
      sumInsured = value;
      const band = rule.bands.find((b) => age <= b.max_age) ?? rule.bands[rule.bands.length - 1];
      base = value * (band?.rate ?? 0);
      lines.push({ label: `Age band ≤ ${band?.max_age}: ${((band?.rate ?? 0) * 100).toFixed(2)}% of GH₵ ${value.toLocaleString("en-GH")}`, amount: base });
      break;
    }
    case "flat":
      base = rule.amount;
      lines.push({ label: "Flat premium", amount: base });
      break;
  }

  let premium = base;
  const applied: string[] = [];

  if ("variants" in rule && rule.variants) {
    const key = String(risk[rule.variants.field] ?? "");
    const f = rule.variants.factors[key];
    if (f !== undefined && f !== 1) {
      premium *= f;
      lines.push({ label: `${rule.variants.field.replace(/_/g, " ")}: ${key.replace(/_/g, " ")}`, factor: f });
    }
  }

  for (const l of rule.loadings ?? []) {
    if (matches(l, risk[l.field])) {
      premium *= l.factor;
      applied.push(l.label ?? l.field);
      lines.push({ label: l.label ?? l.field, factor: l.factor });
    }
  }

  const min = "min_premium" in rule ? rule.min_premium ?? 0 : 0;
  if (premium < min) {
    lines.push({ label: "Minimum premium applies", amount: min });
    premium = min;
  }

  return {
    ok: missing.length === 0,
    premium: Math.round(premium),
    basePremium: Math.round(base),
    lines,
    appliedLoadings: applied,
    sumInsured,
    missingFields: missing,
  };
}
