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

/** Policy periods a product version can be sold for (`product_versions.periods`). */
export const POLICY_PERIODS = ["day", "week", "month", "quarter", "year"] as const;
export type PolicyPeriod = (typeof POLICY_PERIODS)[number];
export const SHORT_PERIODS: PolicyPeriod[] = ["day", "week", "month", "quarter"];

/** Pro-rata share of an annual premium when the rating JSON sets no `period_factors`. */
export const PRO_RATA_FACTORS: Record<PolicyPeriod, number> = { day: 1 / 365, week: 7 / 365, month: 1 / 12, quarter: 1 / 4, year: 1 };
/** Default minimum premium (GHS) per short period when the rating JSON sets no `period_min_premium`. */
export const DEFAULT_PERIOD_MIN_PREMIUM: Record<PolicyPeriod, number> = { day: 1, week: 3, month: 5, quarter: 10, year: 0 };

export function isPolicyPeriod(v: unknown): v is PolicyPeriod {
  return typeof v === "string" && (POLICY_PERIODS as readonly string[]).includes(v);
}

/**
 * Optional short-period pricing on any rating rule (insurer-approved):
 *   period_factors:     { day: 0.004, week: 0.025, month: 0.09 } — share of the annual premium
 *   period_min_premium: { day: 2, week: 10 }                      — GHS floor per period
 */
export interface PeriodPricing {
  period_factors?: Partial<Record<PolicyPeriod, number>>;
  period_min_premium?: Partial<Record<PolicyPeriod, number>>;
}

export interface RatingOptions {
  /** Periods the product version supports (`product_versions.periods`); `byPeriod` is added when any is shorter than a year. */
  periods?: readonly string[] | null;
}
export interface RatingResult {
  ok: boolean;
  premium: number;
  basePremium: number;
  lines: RatingLine[];
  appliedLoadings: string[];
  sumInsured: number | null;
  missingFields: string[];
  /** Premium per supported period (2 dp) — only when the version supports short periods. `year` equals `premium`. */
  byPeriod?: Partial<Record<PolicyPeriod, number>>;
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

export function ratePremium(rule: RatingRule, risk: RiskData, opts: RatingOptions = {}): RatingResult {
  const periods = (opts.periods ?? []).filter(isPolicyPeriod);
  if (!periods.some((p) => p !== "year")) return rateAnnual(rule, risk).result;
  const { result, annualBeforeMin } = rateAnnual(rule, risk);
  return { ...result, byPeriod: periodPremiums(rule as RatingRule & PeriodPricing, periods, result, annualBeforeMin) };
}

/**
 * Short-period premiums: the annual premium (loadings applied, before the annual minimum) times the
 * insurer's `period_factors` (or pro rata), floored at the period minimum, rounded half up to 2 dp.
 */
function periodPremiums(rule: PeriodPricing, periods: PolicyPeriod[], result: RatingResult, annualBeforeMin: number): Partial<Record<PolicyPeriod, number>> {
  const out: Partial<Record<PolicyPeriod, number>> = {};
  for (const p of POLICY_PERIODS) {
    if (!periods.includes(p)) continue;
    if (p === "year") {
      out.year = result.premium;
      continue;
    }
    const f = rule.period_factors?.[p];
    const factor = typeof f === "number" && f > 0 && Number.isFinite(f) ? f : PRO_RATA_FACTORS[p];
    const m = rule.period_min_premium?.[p];
    const min = typeof m === "number" && m >= 0 && Number.isFinite(m) ? m : DEFAULT_PERIOD_MIN_PREMIUM[p];
    const raw = Math.max(annualBeforeMin * factor, min);
    out[p] = result.ok ? Math.floor(raw * 100 + 0.5 + 1e-9) / 100 : 0;
  }
  return out;
}

function rateAnnual(rule: RatingRule, risk: RiskData): { result: RatingResult; annualBeforeMin: number } {
  if (rule.model === "rate_table") {
    if (!Array.isArray(rule.rows)) {
      return { result: { ok: false, premium: 0, basePremium: 0, lines: [{ label: "Rate table not loaded" }], appliedLoadings: [], sumInsured: null, missingFields: ["rate_table_rows"] }, annualBeforeMin: 0 };
    }
    const table = rateFromTable({ factor_keys: rule.factor_keys ?? [], value_fields: rule.value_fields, units_field: rule.units_field, min_premium: rule.min_premium }, rule.rows, risk);
    return { result: table, annualBeforeMin: table.premium };
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

  const annualBeforeMin = premium;
  const min = "min_premium" in rule ? rule.min_premium ?? 0 : 0;
  if (premium < min) {
    lines.push({ label: "Minimum premium applies", amount: min });
    premium = min;
  }

  return {
    result: {
      ok: missing.length === 0,
      premium: Math.round(premium),
      basePremium: Math.round(base),
      lines,
      appliedLoadings: applied,
      sumInsured,
      missingFields: missing,
    },
    annualBeforeMin,
  };
}
