import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { FACT_METRICS, PREMIUM_BANDS, type FactMetric, type PricePosition } from "@im/core";
import type { Database } from "@im/db";
import type { createServiceClient } from "@/lib/supabase/server";
import { BusinessRuleError, ruleMessage } from "@/server/requests";

/**
 * In-database analytics layer (roadmap Phase 4 "analytics warehouse"). Daily facts live in
 * `analytics.daily_facts` (migration 20261031100400) and are rebuilt per day by the
 * `analytics_rollup` function (idempotent, dry-run aware) from the `analytics-rollup` cron.
 * Dashboards read `analytics_facts` (staff); insurers read `insurer_insight_report`
 * (anonymised, cells under 5 suppressed).
 */
type Db = SupabaseClient<Database>;
type Svc = ReturnType<typeof createServiceClient>;

export type FactsRow = Database["public"]["Functions"]["analytics_facts"]["Returns"][number];
export type FactsGroup = "day" | "category" | "region" | "broker" | "insurer" | "total";

export interface RollupResult {
  from: string;
  to: string;
  days: number;
  rows: number;
  dry_run: boolean;
  ms: number;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Runs the rollup for a date range (defaults: yesterday and today, so late events are picked up). */
export async function runAnalyticsRollup(db: Svc | Db, opts: { from?: string; to?: string; dryRun?: boolean } = {}): Promise<RollupResult> {
  const now = new Date();
  const to = opts.to ?? isoDate(now);
  const from = opts.from ?? isoDate(new Date(now.getTime() - 86_400_000));
  const { data, error } = await db.rpc("analytics_rollup", { p_from: from, p_to: to, p_dry_run: opts.dryRun ?? false });
  if (error) throw new BusinessRuleError(ruleMessage(error, "The analytics rollup failed."), error.code === "42501" ? "forbidden" : "business_rule");
  return data as unknown as RollupResult;
}

/** Cron: roll up yesterday and today (idempotent per day). */
export const analyticsRollupJob = async (svc: Svc): Promise<Record<string, unknown>> => {
  const r = await runAnalyticsRollup(svc);
  return { ...r };
};

export interface FactsQuery {
  from: string;
  to: string;
  group?: FactsGroup;
  categoryId?: string | null;
  region?: string | null;
  brokerOrgId?: string | null;
  insurerOrgId?: string | null;
}

export async function analyticsFacts(db: Db, q: FactsQuery): Promise<FactsRow[]> {
  const { data, error } = await db.rpc("analytics_facts", {
    p_from: q.from,
    p_to: q.to,
    p_group: q.group ?? "day",
    p_category_id: q.categoryId ?? undefined,
    p_region: q.region ?? undefined,
    p_broker_org_id: q.brokerOrgId ?? undefined,
    p_insurer_org_id: q.insurerOrgId ?? undefined,
  });
  if (error) throw new BusinessRuleError(ruleMessage(error, "We couldn't load the analytics."), error.code === "42501" ? "forbidden" : "business_rule");
  return (data ?? []).map((r) => {
    const out = { ...r } as FactsRow;
    for (const m of FACT_METRICS) (out as unknown as Record<FactMetric, number>)[m] = Number(r[m] ?? 0) || 0;
    return out;
  });
}

// ---------------------------------------------------------------------------
// Insurer insight report
// ---------------------------------------------------------------------------
export interface InsightCategory {
  category_id: string;
  category_name: string;
  category_slug: string;
  quotes: { mine: number | null; market: number | null; share: number | null };
  wins: { mine: number | null; market: number | null; share: number | null };
  price: { my_median: number | null; market_median: number | null; position: PricePosition | null };
  renewals: { due: number | null; renewed: number | null; retention: number | null; market_retention: number | null };
  claims: { opened: number | null; settled: number | null; market_opened: number | null; median_days_to_settle: number | null; market_median_days_to_settle: number | null };
}

export interface InsightReport {
  insurer_org_id: string;
  month: string;
  period_start: string;
  period_end: string;
  suppression_threshold: number;
  categories: InsightCategory[];
  generated_at: string;
}

export function currentMonth(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

export function previousMonthOf(month: string): string {
  const [y, m] = month.split("-").map(Number);
  const d = new Date(Date.UTC(y!, m! - 2, 1));
  return d.toISOString().slice(0, 7);
}

export function isMonth(v: string | null | undefined): v is string {
  return !!v && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

const num = (v: unknown): number | null => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export async function insurerInsightReport(db: Db, insurerOrgId: string, month: string): Promise<InsightReport> {
  const { data, error } = await db.rpc("insurer_insight_report", { p_insurer_org_id: insurerOrgId, p_month: month });
  if (error) throw new BusinessRuleError(ruleMessage(error, "We couldn't build the insight report."), error.code === "42501" ? "forbidden" : "business_rule");
  const raw = (data ?? {}) as Record<string, unknown>;
  const cats = (Array.isArray(raw.categories) ? raw.categories : []) as Record<string, Record<string, unknown>>[];
  return {
    insurer_org_id: String(raw.insurer_org_id ?? insurerOrgId),
    month: String(raw.month ?? month),
    period_start: String(raw.period_start ?? ""),
    period_end: String(raw.period_end ?? ""),
    suppression_threshold: Number(raw.suppression_threshold ?? 5),
    generated_at: String(raw.generated_at ?? new Date().toISOString()),
    categories: cats.map((c) => ({
      category_id: String(c.category_id),
      category_name: String(c.category_name),
      category_slug: String(c.category_slug),
      quotes: { mine: num(c.quotes?.mine), market: num(c.quotes?.market), share: num(c.quotes?.share) },
      wins: { mine: num(c.wins?.mine), market: num(c.wins?.market), share: num(c.wins?.share) },
      price: { my_median: num(c.price?.my_median), market_median: num(c.price?.market_median), position: (c.price?.position as PricePosition | null) ?? null },
      renewals: { due: num(c.renewals?.due), renewed: num(c.renewals?.renewed), retention: num(c.renewals?.retention), market_retention: num(c.renewals?.market_retention) },
      claims: {
        opened: num(c.claims?.opened),
        settled: num(c.claims?.settled),
        market_opened: num(c.claims?.market_opened),
        median_days_to_settle: num(c.claims?.median_days_to_settle),
        market_median_days_to_settle: num(c.claims?.market_median_days_to_settle),
      },
    })),
  };
}

export const PRICE_POSITION_LABEL: Record<PricePosition, string> = { below: "Below market", in_line: "In line with market", above: "Above market" };

/** "n" or "<5" for suppressed cells (never null in a human-facing table). */
export const cell = (v: number | null | undefined, fmt: (n: number) => string = (n) => String(n)) => (v == null ? "<5" : fmt(v));
export const pctCell = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v * 100)}%`);

/** CSV dataset of the insight report (same suppression as the screen). */
export function insightDataset(r: InsightReport): { header: string[]; rows: (string | number | null)[][] } {
  return {
    header: [
      "month", "category", "quotes_mine", "quotes_market", "quote_share", "wins_mine", "wins_market", "win_share",
      "price_my_median", "price_market_median", "price_position", "renewals_due", "renewals_renewed", "retention", "market_retention",
      "claims_opened", "claims_settled", "median_days_to_settle", "market_median_days_to_settle",
    ],
    rows: r.categories.map((c) => [
      r.month, c.category_name,
      cell(c.quotes.mine), cell(c.quotes.market), c.quotes.share, cell(c.wins.mine), cell(c.wins.market), c.wins.share,
      c.price.my_median, c.price.market_median, c.price.position,
      cell(c.renewals.due), cell(c.renewals.renewed), c.renewals.retention, c.renewals.market_retention,
      cell(c.claims.opened), cell(c.claims.settled), c.claims.median_days_to_settle, c.claims.market_median_days_to_settle,
    ]),
  };
}

export { PREMIUM_BANDS };
