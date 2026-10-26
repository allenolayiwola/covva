import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { CLAIM_STATUS, percentChange, type ClaimStatus } from "@im/core";
import type { Database, Enum } from "@im/db";
import { ApiError, dbError } from "@/server/api-auth";

/**
 * Partner analytics (insurer dashboard, broker web dashboard, broker mobile `/partner/dashboard`).
 *
 * Every number comes from the SECURITY DEFINER functions in
 * `supabase/migrations/20261028100400_partner_analytics.sql`, which check that the caller is an
 * active member of `orgId` (or platform staff / the service role) before aggregating. The client
 * passed in may be the user's RLS client (web, bearer) or the service client (API keys, which
 * scope `orgId` in code).
 */
export type AnalyticsClient = SupabaseClient<Database>;
type Fns = Database["public"]["Functions"];

export type SalesDay = Fns["partner_sales_summary"]["Returns"][number];
export type RenewalRow = Fns["partner_renewals"]["Returns"][number];
export type SlaRow = Fns["partner_sla_performance"]["Returns"][number];
export type CommissionRow = Fns["partner_commission_summary"]["Returns"][number];
export type LapsesRow = Fns["partner_lapses"]["Returns"][number];

export interface ClaimsSummary {
  byStatus: Partial<Record<ClaimStatus, number>>;
  total: number;
  open: number;
  decided: number;
  avgDaysToDecision: number | null;
  staleOpen: number;
  /** Null until the SLA stream's `sla_timers` table exists. */
  openSlaBreaches: number | null;
}

export const DASHBOARD_RANGES = [7, 30, 90] as const;
export type DashboardRange = (typeof DASHBOARD_RANGES)[number];

export function parseRange(value: string | string[] | undefined | null, fallback: DashboardRange = 30): DashboardRange {
  const n = Number(Array.isArray(value) ? value[0] : value);
  return (DASHBOARD_RANGES as readonly number[]).includes(n) ? (n as DashboardRange) : fallback;
}

export const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** `[from, to]` ISO dates for the last `days` days ending today (inclusive). */
export function rangeDates(days: number, now = new Date()): { from: string; to: string; prevFrom: string; prevTo: string } {
  const to = isoDate(now);
  const from = isoDate(new Date(now.getTime() - (days - 1) * 86_400_000));
  const prevTo = isoDate(new Date(now.getTime() - days * 86_400_000));
  const prevFrom = isoDate(new Date(now.getTime() - (2 * days - 1) * 86_400_000));
  return { from, to, prevFrom, prevTo };
}

function unwrap<T>(res: { data: T | null; error: { code?: string; message?: string } | null }): T {
  if (res.error) throw dbError(res.error);
  return res.data as T;
}

export async function salesSummary(db: AnalyticsClient, orgId: string, from: string, to: string): Promise<SalesDay[]> {
  return unwrap(await db.rpc("partner_sales_summary", { p_org_id: orgId, p_from: from, p_to: to })) ?? [];
}

export async function renewals(db: AnalyticsClient, orgId: string, days = 30): Promise<RenewalRow[]> {
  return unwrap(await db.rpc("partner_renewals", { p_org_id: orgId, p_days: days })) ?? [];
}

export async function claimsSummary(db: AnalyticsClient, orgId: string): Promise<ClaimsSummary> {
  const raw = unwrap(await db.rpc("partner_claims_summary", { p_org_id: orgId })) as Record<string, unknown> | null;
  const byStatusRaw = (raw?.by_status ?? {}) as Record<string, number>;
  const byStatus: Partial<Record<ClaimStatus, number>> = {};
  for (const [k, v] of Object.entries(byStatusRaw)) if (k in CLAIM_STATUS) byStatus[k as ClaimStatus] = Number(v) || 0;
  const num = (v: unknown) => (v == null || v === "" ? null : Number(v));
  return {
    byStatus,
    total: num(raw?.total) ?? 0,
    open: num(raw?.open) ?? 0,
    decided: num(raw?.decided) ?? 0,
    avgDaysToDecision: num(raw?.avg_days_to_decision),
    staleOpen: num(raw?.stale_open) ?? 0,
    openSlaBreaches: num(raw?.open_sla_breaches),
  };
}

export async function slaPerformance(db: AnalyticsClient, orgId: string, days = 90): Promise<SlaRow> {
  const rows = unwrap(await db.rpc("partner_sla_performance", { p_org_id: orgId, p_days: days })) ?? [];
  return rows[0] ?? { requests_measured: 0, requests_on_time: 0, requests_breached: 0, requests_open_overdue: 0, submissions_measured: 0, submissions_on_time: 0, submissions_late: 0, submissions_open_overdue: 0, on_time_rate: null as unknown as number };
}

/**
 * Commission for a month. Returns null when the caller's role may not see money (owner, admin
 * and finance only — the same rule as the ledger RLS), so dashboards can hide the tile instead of failing.
 */
export async function commissionSummary(db: AnalyticsClient, orgId: string, period?: string): Promise<CommissionRow | null> {
  const res = await db.rpc("partner_commission_summary", period ? { p_org_id: orgId, p_period: period } : { p_org_id: orgId });
  if (res.error) {
    if (res.error.code === "42501") return null;
    throw dbError(res.error);
  }
  return res.data?.[0] ?? null;
}

export async function lapses(db: AnalyticsClient, orgId: string, days = 90): Promise<LapsesRow> {
  const rows = unwrap(await db.rpc("partner_lapses", { p_org_id: orgId, p_days: days })) ?? [];
  return rows[0] ?? { lapsed: 0, cancelled: 0, expired: 0, renewed: 0, active: 0, ended: 0, lapse_rate: null as unknown as number };
}

export interface SalesTotals {
  requests: number;
  quotes: number;
  conversions: number;
  policiesIssued: number;
  premium: number;
  platformFee: number;
  brokerCommission: number;
}

export function totals(series: SalesDay[]): SalesTotals {
  const t: SalesTotals = { requests: 0, quotes: 0, conversions: 0, policiesIssued: 0, premium: 0, platformFee: 0, brokerCommission: 0 };
  for (const d of series) {
    t.requests += d.requests ?? 0;
    t.quotes += d.quotes ?? 0;
    t.conversions += d.conversions ?? 0;
    t.policiesIssued += d.policies_issued ?? 0;
    t.premium += Number(d.premium ?? 0);
    t.platformFee += Number(d.platform_fee ?? 0);
    t.brokerCommission += Number(d.broker_commission ?? 0);
  }
  return t;
}

export interface PartnerDashboard {
  days: number;
  from: string;
  to: string;
  series: SalesDay[];
  totals: SalesTotals;
  previous: SalesTotals;
  change: Record<keyof SalesTotals, number | null>;
  renewals: { count: number; next: RenewalRow[]; windowDays: number };
  claims: ClaimsSummary;
  sla: SlaRow;
  lapses: LapsesRow;
  /** Null when the caller may not see money. */
  commission: CommissionRow | null;
  period: string;
}

export function currentPeriod(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** Everything the overview pages and `GET /partner/dashboard` show, in one round of parallel RPCs. */
export async function loadDashboard(db: AnalyticsClient, orgId: string, opts: { days?: number; renewalDays?: number; includeCommission?: boolean; period?: string } = {}): Promise<PartnerDashboard> {
  const days = opts.days ?? 30;
  const renewalDays = opts.renewalDays ?? 30;
  const period = opts.period ?? currentPeriod();
  const { from, to, prevFrom, prevTo } = rangeDates(days);
  const [series, prevSeries, due, claims, sla, lap, commission] = await Promise.all([
    salesSummary(db, orgId, from, to),
    salesSummary(db, orgId, prevFrom, prevTo),
    renewals(db, orgId, renewalDays),
    claimsSummary(db, orgId),
    slaPerformance(db, orgId, Math.max(days, 30)),
    lapses(db, orgId, 90),
    opts.includeCommission === false ? Promise.resolve(null) : commissionSummary(db, orgId, period),
  ]);
  const cur = totals(series);
  const prev = totals(prevSeries);
  const change = Object.fromEntries((Object.keys(cur) as (keyof SalesTotals)[]).map((k) => [k, percentChange(cur[k], prev[k])])) as PartnerDashboard["change"];
  return { days, from, to, series, totals: cur, previous: prev, change, renewals: { count: due.length, next: due.slice(0, 10), windowDays: renewalDays }, claims, sla, lapses: lap, commission, period };
}

// ---------------------------------------------------------------------------
// CSV datasets (reports page export, `type=` param)
// ---------------------------------------------------------------------------
export const EXPORT_TYPES = ["sales", "renewals", "claims", "commission"] as const;
export type ExportType = (typeof EXPORT_TYPES)[number];

export interface Dataset { header: string[]; rows: (string | number | null)[][] }

const money = (v: number | string | null | undefined) => (v == null ? null : Math.round(Number(v) * 100) / 100);

export async function exportDataset(db: AnalyticsClient, orgId: string, kind: Enum<"org_type">, type: ExportType, days: number, period = currentPeriod()): Promise<Dataset> {
  switch (type) {
    case "sales": {
      const { from, to } = rangeDates(days);
      const series = await salesSummary(db, orgId, from, to);
      return {
        header: ["day", "requests", "quotes", "conversions", "policies_issued", "premium", "platform_fee", "broker_commission"],
        rows: series.map((d) => [d.day, d.requests, d.quotes, d.conversions, d.policies_issued, money(d.premium), money(d.platform_fee), money(d.broker_commission)]),
      };
    }
    case "renewals": {
      const due = await renewals(db, orgId, Math.max(days, 30));
      const insurer = kind === "insurer";
      return {
        header: ["policy_reference", "policy_number", "category", "cover_end", "days_left", "premium", "currency", "customer", ...(insurer ? [] : ["email", "phone"]), "contact_allowed", "marketing_allowed", "renewal_request", "renewal_status", "reminders_sent"],
        rows: due.map((r) => [r.internal_reference, r.policy_number, r.category_name, r.cover_end, r.days_left, money(r.premium), r.currency, r.customer_name, ...(insurer ? [] : [r.customer_email, r.customer_phone]), r.contact_allowed ? "yes" : "no", r.marketing_allowed ? "yes" : "no", r.renewal_request_id, r.renewal_status, r.reminders_sent]),
      };
    }
    case "claims": {
      const since = new Date(Date.now() - days * 86_400_000).toISOString();
      const res = await db
        .from("claims")
        .select("id, reference, status, incident_type, incident_at, amount_claimed, decision_amount, reported_at, delivered_to_insurer_at, acknowledged_at, decision_at, paid_at, created_at, policy:policies!claims_policy_id_fkey(internal_reference, policy_number)")
        .or(`broker_org_id.eq.${orgId},insurer_org_id.eq.${orgId}`)
        .gte("created_at", since)
        .order("created_at", { ascending: false })
        .limit(5000);
      if (res.error) throw dbError(res.error);
      return {
        header: ["reference", "status", "policy", "incident_type", "incident_at", "amount_claimed", "decision_amount", "reported_at", "delivered_to_insurer_at", "acknowledged_at", "decision_at", "paid_at"],
        rows: (res.data ?? []).map((c) => {
          const p = c.policy as unknown as { internal_reference: string; policy_number: string | null } | null;
          return [c.reference, c.status, p?.policy_number ?? p?.internal_reference ?? "", c.incident_type, c.incident_at, money(c.amount_claimed), money(c.decision_amount), c.reported_at, c.delivered_to_insurer_at, c.acknowledged_at, c.decision_at, c.paid_at];
        }),
      };
    }
    case "commission": {
      const summary = await commissionSummary(db, orgId, period);
      if (!summary) throw new ApiError("forbidden", "Commission reports are available to owners, admins and finance.");
      const res = await db
        .from("ledger_entries")
        .select("id, entry_type, amount, currency, memo, reference, policy_id, payment_id, created_at")
        .or(`org_id.eq.${orgId},counterparty_org_id.eq.${orgId}`)
        .in("entry_type", ["broker_commission", "revenue_share", "platform_fee"])
        .gte("created_at", `${summary.period_start}T00:00:00Z`)
        .lte("created_at", `${summary.period_end}T23:59:59Z`)
        .order("created_at")
        .limit(10000);
      if (res.error) throw dbError(res.error);
      const rows: (string | number | null)[][] = (res.data ?? []).map((e) => [e.created_at, e.entry_type, money(e.amount), e.currency, e.reference, e.policy_id, e.payment_id, e.memo]);
      rows.push(["", "TOTAL earned", money(summary.earned), summary.currency, `period ${summary.period}`, null, null, `paid ${money(summary.paid)} · outstanding ${money(summary.outstanding)} · statement ${summary.statement_status ?? "none"}`]);
      return { header: ["created_at", "entry_type", "amount", "currency", "reference", "policy_id", "payment_id", "memo"], rows };
    }
  }
}
