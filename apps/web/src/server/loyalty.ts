import "server-only";
import {
  claimHistory,
  creditBalance,
  evaluateLoyalty,
  howToEarnMore,
  loyaltyTierStatus,
  normaliseLoyaltyRuleSet,
  renewalPerks,
  safeDriverSummary,
  type DiscountLine,
  type HistoryClaim,
  type HistoryPolicy,
  type LoyaltyContext,
  type LoyaltyEvaluation,
  type LoyaltyRuleSet,
  type RenewalPerk,
  type TelematicsSummary,
} from "@im/core";
import type { Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import type { UserClient } from "@/server/api-auth";
import { log } from "@/server/log";

/**
 * Loyalty & rewards (Phase 4): applies the insurer's published rule set (or the platform fallback) to a quote
 * and records the result as explicit `quote_discounts` line items. The base premium is never changed; the
 * engine (`@im/core` evaluateLoyalty) is pure, so the same inputs always give the same lines.
 *
 *   applyLoyaltyToQuote()   after a quote is created or re-priced (estimates, broker / insurer quotes)
 *   quoteDiscountLines()    what the customer / broker / insurer see ("What you saved and why"; RLS-scoped)
 *   redeemCreditsForPolicy() posts the referral-credit redemption once the policy is active (idempotent)
 *   loyaltySummaryForUser()  the customer loyalty page and GET /api/v1/me/loyalty
 *
 * Nothing here throws into the quote or payment flows: failures are logged and the quote stays undiscounted.
 */
type Svc = ReturnType<typeof createServiceClient>;
type AnyClient = Svc | UserClient;

const DAY_MS = 86_400_000;

export type DiscountRow = Row<"quote_discounts">;

/** The rule set in force for an insurer today (its own published set, else the platform fallback). */
export async function effectiveRuleSet(db: AnyClient, insurerOrgId: string): Promise<LoyaltyRuleSet | null> {
  const { data, error } = await db.rpc("effective_loyalty_rule_set", { p_insurer_org_id: insurerOrgId });
  if (error || !data || !(data as { id?: string | null }).id) return null;
  return normaliseLoyaltyRuleSet(data);
}

interface HistoryRows {
  policies: HistoryPolicy[];
  claims: HistoryClaim[];
}

/** The customer's policy and claim history as the engine reads it (RLS-scoped when a user client is used). */
export async function loadHistory(db: AnyClient, customerId: string): Promise<HistoryRows> {
  const [{ data: policies }, { data: claims }] = await Promise.all([
    db.from("policies").select("id, status, cover_start, cover_end, issued_at, external_source, insurer_org_id").eq("customer_id", customerId).limit(500),
    db.from("claims").select("policy_id, status, incident_at, created_at").eq("customer_id", customerId).limit(1000),
  ]);
  return {
    policies: (policies ?? []).map((p) => ({ id: p.id, status: p.status, coverStart: p.cover_start, coverEnd: p.cover_end, issuedAt: p.issued_at, externalSource: p.external_source, insurerOrgId: p.insurer_org_id })),
    claims: (claims ?? []).map((c) => ({ policyId: c.policy_id, status: c.status, incidentAt: c.incident_at, createdAt: c.created_at })),
  };
}

/** Spendable referral credit balance (reward_ledger). */
export async function loadCreditBalance(db: AnyClient, userId: string): Promise<number> {
  const { data } = await db.from("reward_ledger").select("kind, amount, expires_at").eq("user_id", userId).limit(500);
  return creditBalance((data ?? []).map((l) => ({ kind: l.kind, amount: Number(l.amount), expires_at: l.expires_at })));
}

/** Telematics summary for the policy being renewed (final monthly scores in the look-back window). */
export async function loadTelematicsSummary(db: AnyClient, policyId: string, now = new Date()): Promise<TelematicsSummary | null> {
  const { data } = await db.from("telematics_scores").select("period, score, final").eq("policy_id", policyId).order("period", { ascending: false }).limit(24);
  const summary = safeDriverSummary((data ?? []).map((s) => ({ period: s.period, score: s.score, final: s.final })), now);
  return summary ? { averageScore: summary.averageScore, monthsOfData: summary.monthsOfData } : null;
}

const daysBetween = (fromMs: number, toIso: string | null) => (toIso ? Math.round((Date.parse(`${toIso}T00:00:00Z`) - fromMs) / DAY_MS) : null);

export interface QuoteForLoyalty {
  id: string;
  premium: number;
  currency: string;
  insurer_org_id: string;
  request: { customer_id: string; type: string; related_policy_id: string | null; bundle_id: string | null; category_slug: string | null };
}

/** Everything the engine needs for one quote (history, bundle, renewal window, credits, telematics). */
export async function buildLoyaltyContext(svc: Svc, q: QuoteForLoyalty, now = new Date()): Promise<LoyaltyContext> {
  const { customer_id: customerId, related_policy_id: relatedPolicyId, bundle_id: bundleId } = q.request;
  const isRenewal = q.request.type === "renewal" && !!relatedPolicyId;
  const [history, credit, bundleRows, related] = await Promise.all([
    loadHistory(svc, customerId),
    loadCreditBalance(svc, customerId),
    bundleId
      ? svc.from("requests").select("id, status, category:product_categories!requests_category_id_fkey(slug)").eq("customer_id", customerId).eq("bundle_id", bundleId).not("status", "in", "(cancelled,closed_no_cover)").limit(20)
      : Promise.resolve({ data: null }),
    isRenewal ? svc.from("policies").select("id, cover_end, category:product_categories!policies_category_id_fkey(slug)").eq("id", relatedPolicyId!).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  const bundleCategories = new Set<string>(q.request.category_slug ? [q.request.category_slug] : []);
  for (const r of bundleRows.data ?? []) {
    const slug = (r.category as unknown as { slug?: string } | null)?.slug;
    if (slug) bundleCategories.add(slug);
  }
  const relatedSlug = (related.data?.category as unknown as { slug?: string } | null)?.slug ?? null;
  const telematics = isRenewal && (relatedSlug === "motor" || q.request.category_slug === "motor") ? await loadTelematicsSummary(svc, relatedPolicyId!, now) : null;
  return {
    now,
    premium: Number(q.premium),
    currency: q.currency,
    categorySlug: q.request.category_slug,
    insurerOrgId: q.insurer_org_id,
    isRenewal,
    daysBeforeExpiry: isRenewal ? daysBetween(now.getTime(), related.data?.cover_end ?? null) : null,
    history: claimHistory(history.policies, history.claims, q.insurer_org_id, now),
    bundleCategories: [...bundleCategories],
    creditBalance: credit,
    telematics,
  };
}

function snapshot(ctx: LoyaltyContext): Json {
  return {
    claim_free_years: ctx.history.claimFreeYears,
    has_history: ctx.history.hasHistory,
    external_only: ctx.history.externalOnly,
    years_with_insurer: ctx.history.yearsWithInsurer,
    years_on_covva: ctx.history.yearsOnCovva,
    is_renewal: ctx.isRenewal,
    days_before_expiry: ctx.daysBeforeExpiry,
    bundle_categories: ctx.bundleCategories,
    credit_balance: ctx.creditBalance,
    telematics: ctx.telematics ? { average_score: ctx.telematics.averageScore, months_of_data: ctx.telematics.monthsOfData } : null,
    evaluated_at: ctx.now.toISOString(),
  } as unknown as Json;
}

/**
 * Evaluate the rule set for a quote and replace its discount lines. Returns the evaluation (null when there
 * is no rule set or the quote cannot be found). Never throws.
 */
export async function applyLoyaltyToQuote(quoteId: string, opts: { svc?: Svc; now?: Date } = {}): Promise<LoyaltyEvaluation | null> {
  try {
    const svc = opts.svc ?? createServiceClient();
    const { data: quote } = await svc
      .from("quotes")
      .select("id, premium, currency, insurer_org_id, request:requests!quotes_request_id_fkey(customer_id, type, related_policy_id, bundle_id, category:product_categories!requests_category_id_fkey(slug))")
      .eq("id", quoteId)
      .maybeSingle();
    if (!quote) return null;
    const req = quote.request as unknown as { customer_id: string; type: string; related_policy_id: string | null; bundle_id: string | null; category: { slug: string } | null } | null;
    if (!req) return null;
    const set = await effectiveRuleSet(svc, quote.insurer_org_id);
    if (!set) {
      await svc.from("quote_discounts").delete().eq("quote_id", quote.id);
      return null;
    }
    const ctx = await buildLoyaltyContext(svc, { id: quote.id, premium: Number(quote.premium), currency: quote.currency, insurer_org_id: quote.insurer_org_id, request: { ...req, category_slug: req.category?.slug ?? null } }, opts.now);
    const evaluation = evaluateLoyalty(set, ctx);
    const { error: delErr } = await svc.from("quote_discounts").delete().eq("quote_id", quote.id);
    if (delErr) throw delErr;
    if (evaluation.lines.length) {
      const { error } = await svc.from("quote_discounts").insert(
        evaluation.lines.map((l) => ({
          quote_id: quote.id,
          rule_set_id: set.id ?? null,
          rule_set_version: set.version,
          rule_key: l.ruleKey,
          rule_type: l.ruleType,
          label: l.label,
          explanation: l.explanation,
          basis: l.basis,
          pct: l.pct,
          amount: l.amount,
          capped: l.capped,
          cap_note: l.capNote ?? null,
          evaluation: snapshot(ctx),
        })),
      );
      if (error) throw error;
    }
    return evaluation;
  } catch (err) {
    log.warn("loyalty.apply_failed", { quoteId, err });
    return null;
  }
}

/** Discount lines for one or more quotes (RLS applies with a user client). Map quote id → lines (stacking order). */
export async function quoteDiscountLines(db: AnyClient, quoteIds: string[]): Promise<Map<string, DiscountRow[]>> {
  const out = new Map<string, DiscountRow[]>();
  const ids = [...new Set(quoteIds.filter(Boolean))];
  if (!ids.length) return out;
  const { data } = await db.from("quote_discounts").select("*").in("quote_id", ids).order("created_at", { ascending: true });
  for (const row of data ?? []) out.set(row.quote_id, [...(out.get(row.quote_id) ?? []), row]);
  return out;
}

export const discountTotal = (lines: Pick<DiscountRow, "amount">[] | undefined | null): number => Math.round((lines ?? []).reduce((s, l) => s + Number(l.amount), 0) * 100) / 100;

/** Compact shape for API responses and client components. */
export function toDiscountLine(row: DiscountRow): DiscountLine & { id: string; currency: string } {
  return {
    id: row.id,
    ruleKey: row.rule_key,
    ruleType: row.rule_type as DiscountLine["ruleType"],
    label: row.label,
    explanation: row.explanation,
    basis: row.basis as DiscountLine["basis"],
    pct: row.pct === null ? null : Number(row.pct),
    amount: Number(row.amount),
    capped: row.capped,
    capNote: row.cap_note ?? undefined,
    currency: row.currency,
  };
}

/** Total discount recorded on a quote (service role; used when the payment amount is computed). */
export async function discountTotalForQuote(svc: Svc, quoteId: string): Promise<number> {
  const { data } = await svc.from("quote_discounts").select("amount").eq("quote_id", quoteId);
  return discountTotal(data);
}

/**
 * Once a policy is active, a referral-credit line on its quote becomes a `redemption` row in the reward
 * ledger (negative amount). Idempotent through the unique reference `loyalty:redeem:<quote>`.
 */
export async function redeemCreditsForPolicy(svc: Svc, policyId: string): Promise<void> {
  try {
    const { data: policy } = await svc.from("policies").select("id, quote_id, customer_id, status").eq("id", policyId).maybeSingle();
    if (!policy?.quote_id || policy.status !== "active") return;
    const { data: lines } = await svc.from("quote_discounts").select("amount, label").eq("quote_id", policy.quote_id).eq("rule_type", "referral_credit");
    const amount = discountTotal(lines);
    if (!(amount > 0)) return;
    const { error } = await svc.from("reward_ledger").insert({
      user_id: policy.customer_id,
      kind: "redemption",
      amount: -amount,
      reference: `loyalty:redeem:${policy.quote_id}`,
      rule_key: "referral_credit",
      related_policy_id: policy.id,
      memo: "Referral credit redeemed against a premium (insurer-funded discount)",
    });
    if (error && error.code !== "23505") log.error("loyalty.redeem_failed", { policyId, err: error });
  } catch (err) {
    log.warn("loyalty.redeem_failed", { policyId, err });
  }
}

// ---------------------------------------------------------------------------
// Customer loyalty page / GET /api/v1/me/loyalty
// ---------------------------------------------------------------------------
export interface LoyaltySummary {
  history: ReturnType<typeof claimHistory>;
  creditBalance: number;
  currency: "GHS";
  /** Tier with each insurer the customer currently holds cover with. */
  insurers: { insurerOrgId: string; insurerName: string; yearsWithInsurer: number; tier: ReturnType<typeof loyaltyTierStatus>; rulesVersion: number | null; rulesUpdated: string | null; isPlatformFallback: boolean }[];
  /** Active policies ending within 120 days, with the perks the insurer's rules would give at renewal. */
  upcomingRenewals: { policyId: string; policyNumber: string | null; categoryName: string; insurerName: string; coverEnd: string | null; daysLeft: number | null; perks: RenewalPerk[] }[];
  /** Discount lines recorded on the customer's quotes in the last year ("what you saved"). */
  recentSavings: { quoteId: string; requestId: string | null; label: string; amount: number; explanation: string; createdAt: string }[];
  telematics: { activeEnrolments: number; latestScore: number | null };
  howToEarnMore: string[];
  note: string;
}

export async function loyaltySummaryForUser(db: UserClient, userId: string, now = new Date()): Promise<LoyaltySummary> {
  const yearAgo = new Date(now.getTime() - 365 * DAY_MS).toISOString();
  const [history, credit, { data: policies }, { data: discounts }, { data: enrolments }] = await Promise.all([
    loadHistory(db, userId),
    loadCreditBalance(db, userId),
    db
      .from("policies")
      .select("id, policy_number, internal_reference, status, cover_end, premium, currency, insurer_org_id, external_source, category:product_categories!policies_category_id_fkey(slug, name), insurer:organizations!policies_insurer_org_id_fkey(id, name)")
      .eq("customer_id", userId)
      .eq("status", "active")
      .eq("external_source", false)
      .order("cover_end", { ascending: true })
      .limit(50),
    db.from("quote_discounts").select("quote_id, request_id, label, amount, explanation, created_at").gte("created_at", yearAgo).order("created_at", { ascending: false }).limit(50),
    db.from("telematics_enrolments").select("id, status, latest_score").eq("user_id", userId).eq("status", "active").limit(10),
  ]);
  const active = policies ?? [];
  const insurerIds = [...new Set(active.map((p) => p.insurer_org_id).filter((x): x is string => !!x))];
  const sets = new Map<string, LoyaltyRuleSet | null>();
  await Promise.all(insurerIds.map(async (id) => sets.set(id, await effectiveRuleSet(db, id))));
  const insurers = insurerIds.map((id) => {
    const set = sets.get(id) ?? null;
    const h = claimHistory(history.policies, history.claims, id, now);
    const p = active.find((x) => x.insurer_org_id === id);
    return {
      insurerOrgId: id,
      insurerName: (p?.insurer as unknown as { name?: string } | null)?.name ?? "Insurer",
      yearsWithInsurer: h.yearsWithInsurer,
      tier: set ? loyaltyTierStatus(set, h.yearsWithInsurer) : null,
      rulesVersion: set?.version ?? null,
      rulesUpdated: set?.effectiveFrom ?? null,
      isPlatformFallback: !!set && set.insurerOrgId === null,
    };
  });
  const upcomingRenewals: LoyaltySummary["upcomingRenewals"] = [];
  for (const p of active) {
    const daysLeft = daysBetween(now.getTime(), p.cover_end);
    if (daysLeft === null || daysLeft > 120 || !p.insurer_org_id) continue;
    const set = sets.get(p.insurer_org_id);
    if (!set) continue;
    const category = p.category as unknown as { slug: string; name: string } | null;
    const telematics = category?.slug === "motor" ? await loadTelematicsSummary(db, p.id, now) : null;
    const perks = renewalPerks(set, {
      now,
      premium: Number(p.premium) || 0,
      currency: p.currency,
      categorySlug: category?.slug ?? null,
      insurerOrgId: p.insurer_org_id,
      daysBeforeExpiry: daysLeft,
      history: claimHistory(history.policies, history.claims, p.insurer_org_id, now),
      bundleCategories: category?.slug ? [category.slug] : [],
      creditBalance: credit,
      telematics,
    });
    upcomingRenewals.push({
      policyId: p.id,
      policyNumber: p.policy_number ?? p.internal_reference,
      categoryName: category?.name ?? "Policy",
      insurerName: (p.insurer as unknown as { name?: string } | null)?.name ?? "Insurer",
      coverEnd: p.cover_end,
      daysLeft,
      perks,
    });
  }
  const tips = new Set<string>();
  for (const set of sets.values()) if (set) for (const t of howToEarnMore(set)) tips.add(t);
  const scores = (enrolments ?? []).map((e) => e.latest_score).filter((s): s is number => typeof s === "number");
  return {
    history: claimHistory(history.policies, history.claims, null, now),
    creditBalance: credit,
    currency: "GHS",
    insurers,
    upcomingRenewals,
    recentSavings: (discounts ?? []).map((d) => ({ quoteId: d.quote_id, requestId: d.request_id, label: d.label, amount: Number(d.amount), explanation: d.explanation, createdAt: d.created_at })),
    telematics: { activeEnrolments: (enrolments ?? []).length, latestScore: scores.length ? Math.max(...scores) : null },
    howToEarnMore: [...tips],
    note: "Discounts are set and funded by the insurer, never by Covva, and never change which insurers or products you see or the order they appear in. Credits are not cash.",
  };
}
