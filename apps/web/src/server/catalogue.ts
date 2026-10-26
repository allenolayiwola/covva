import "server-only";
import {
  evaluateRules,
  issuanceLabel,
  rateFromTable,
  ratePremium,
  type IssuanceType,
  type RateRow,
  type RateTableDef,
  type RatingResult,
  type RatingRule,
  type RiskData,
  type RuleCondition,
  type UnderwritingResult,
  type UnderwritingRule,
} from "@im/core";
import type { Row } from "@im/db";
import type { createClient, createServiceClient } from "@/lib/supabase/server";

/**
 * Catalogue extensions (Roadmap Phase 0): rate tables, underwriting rules and
 * issuance type/SLA resolved from the database for quoting. Pure maths lives in
 * @im/core; this module only loads rows and hands them to the core functions, so
 * the insurer simulator, the admin test panel and live quoting price identically.
 */
type Client = ReturnType<typeof createServiceClient> | Awaited<ReturnType<typeof createClient>>;

export interface LoadedRateTable { table: Row<"rate_tables">; def: RateTableDef; rows: RateRow[] }

export function toRateRow(r: Pick<Row<"rate_rows">, "id" | "factors" | "rate" | "rate_kind" | "min_premium" | "loadings">): RateRow {
  return {
    id: r.id,
    factors: (r.factors ?? {}) as Record<string, unknown>,
    rate: Number(r.rate),
    rate_kind: r.rate_kind as RateRow["rate_kind"],
    min_premium: r.min_premium == null ? null : Number(r.min_premium),
    loadings: (Array.isArray(r.loadings) ? r.loadings : []) as unknown as RateRow["loadings"],
  };
}

export function toUnderwritingRule(r: Row<"underwriting_rules">): UnderwritingRule {
  return { id: r.id, name: r.name, condition: r.condition as unknown as RuleCondition, outcome: r.outcome as UnderwritingRule["outcome"], message: r.message, priority: r.priority, active: r.active };
}

/** Loads a rate table and its rows (RLS applies for user clients; the service client sees everything). */
export async function loadRateTable(svc: Client, id: string): Promise<LoadedRateTable | null> {
  const { data: table } = await svc.from("rate_tables").select("*").eq("id", id).maybeSingle();
  if (!table) return null;
  const { data: rows } = await svc.from("rate_rows").select("id, factors, rate, rate_kind, min_premium, loadings").eq("rate_table_id", id).order("created_at");
  return { table, def: { id: table.id, name: table.name, factor_keys: table.factor_keys ?? [], base_currency: table.base_currency }, rows: (rows ?? []).map(toRateRow) };
}

/**
 * Prices a risk with a `rate_table` rating rule: resolves the referenced table
 * (approved tables only for live quoting unless `allowDraft`) and defers to the
 * core `rateFromTable`. Falls back to `ratePremium`'s "not loaded" result when the
 * table is missing so a misconfigured product never produces a wrong price.
 */
export async function quoteWithRateTable(svc: Client, rule: Extract<RatingRule, { model: "rate_table" }>, risk: RiskData, opts: { allowDraft?: boolean } = {}): Promise<RatingResult> {
  const loaded = rule.rate_table_id ? await loadRateTable(svc, rule.rate_table_id) : null;
  if (!loaded || (!opts.allowDraft && loaded.table.status !== "approved")) return ratePremium({ ...rule, rows: undefined }, risk);
  const def: RateTableDef = {
    ...loaded.def,
    factor_keys: rule.factor_keys?.length ? rule.factor_keys : loaded.def.factor_keys,
    value_fields: rule.value_fields,
    units_field: rule.units_field,
    min_premium: rule.min_premium,
  };
  return rateFromTable(def, loaded.rows, risk);
}

/** Prices any rating rule, resolving rate tables when needed. */
export async function quoteVersion(svc: Client, rating: RatingRule, risk: RiskData, opts: { allowDraft?: boolean } = {}): Promise<RatingResult> {
  if (rating?.model === "rate_table") return quoteWithRateTable(svc, rating, risk, opts);
  return ratePremium(rating, risk);
}

/** Runs the version's active underwriting rules: accept / refer (insurer L1 review) / decline. */
export async function evaluateUnderwriting(svc: Client, productVersionId: string, risk: RiskData): Promise<UnderwritingResult & { rules: number }> {
  const { data } = await svc.from("underwriting_rules").select("*").eq("product_version_id", productVersionId).eq("active", true).order("priority");
  const rules = (data ?? []).map(toUnderwritingRule);
  return { ...evaluateRules(rules, risk), rules: rules.length };
}

export interface IssuanceSummary { issuanceType: IssuanceType; slaHours: number | null; label: string }

/** "Instant" / "Issued within 24 hours" — shown on quote cards before payment (Addendum 2 G). */
export function issuanceSummary(version: Pick<Row<"product_versions">, "issuance_type" | "sla_hours"> | null | undefined): IssuanceSummary {
  const issuanceType = (version?.issuance_type === "instant" || version?.issuance_type === "within_hours" ? version.issuance_type : "manual") as IssuanceType;
  const slaHours = version?.sla_hours ?? null;
  return { issuanceType, slaHours, label: issuanceLabel(issuanceType, slaHours) };
}
