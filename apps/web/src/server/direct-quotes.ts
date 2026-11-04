import "server-only";
import { complexityFlags, ENGINE_VERSION, isDirectSales, type RatingRule } from "@im/core";
import type { Json, Row } from "@im/db";
import { createServiceClient } from "@/lib/supabase/server";
import { evaluateUnderwriting, issuanceSummary, quoteVersion, type IssuanceSummary } from "@/server/catalogue";
import { applyLoyaltyToQuote } from "@/server/loyalty";
import { log } from "@/server/log";

/**
 * Instant direct quotes. When a customer buys straight from an insurer whose line sells directly
 * (insurer_line_integrations.direct_sales, or L2/L3) and whose product issues without manual review
 * (issuance "instant" or "within_hours"), Covva prices the order from the insurer's approved rating
 * (rate table or rule) at once and the customer can pay with no wait. Anything else (manual products,
 * complex risks, underwriting refer/decline, no rate) still goes to the insurer's portal to quote.
 */

type Svc = ReturnType<typeof createServiceClient>;

export const DIRECT_QUOTE_DISCLOSURE =
  "Sold directly by the insurer. Covva is a technology platform, not an insurer or a broker, and is paid a platform fee by the insurer.";

export interface DirectOffer {
  insurerOrgId: string;
  insurerName: string;
  productId: string;
  productName: string;
  versionId: string;
  premium: number;
  sumInsured: number | null;
  issuance: IssuanceSummary;
}

interface Candidate {
  insurer: { id: string; name: string; status: string };
  product: { id: string; name: string };
  version: Row<"product_versions">;
}

function instantIssuance(version: Pick<Row<"product_versions">, "issuance_type">, lineIssuance: string | null | undefined): boolean {
  const t = version.issuance_type !== "manual" ? version.issuance_type : lineIssuance;
  return t === "instant" || t === "within_hours";
}

/** Insurers that sell this category directly with instant issuance, with their current approved product. */
async function instantCandidates(svc: Svc, categoryId: string, insurerOrgId?: string): Promise<Candidate[]> {
  let q = svc
    .from("insurer_line_integrations")
    .select("insurer_org_id, level, direct_sales, active, issuance_type, insurer:organizations!insurer_line_integrations_insurer_org_id_fkey(id, name, status)")
    .eq("category_id", categoryId)
    .eq("active", true);
  if (insurerOrgId) q = q.eq("insurer_org_id", insurerOrgId);
  const { data: lines } = await q;
  const out: Candidate[] = [];
  for (const line of lines ?? []) {
    const insurer = line.insurer as unknown as Candidate["insurer"] | null;
    if (!insurer || insurer.status !== "active") continue;
    if (!isDirectSales({ insurerOrgId: line.insurer_org_id, level: line.level as "L1" | "L2" | "L3", directSales: line.direct_sales, nominatedBrokerOrgIds: [], active: line.active })) continue;
    const { data: products } = await svc
      .from("products")
      .select("id, name, version:product_versions!products_current_version_fk(*)")
      .eq("insurer_org_id", line.insurer_org_id)
      .eq("category_id", categoryId)
      .eq("status", "approved");
    for (const p of products ?? []) {
      const version = p.version as unknown as Row<"product_versions"> | null;
      if (!version || version.status !== "approved" || version.micro) continue;
      if (!instantIssuance(version, line.issuance_type)) continue;
      out.push({ insurer, product: { id: p.id, name: p.name }, version });
    }
  }
  return out;
}

async function priceCandidate(svc: Svc, c: Candidate, risk: Record<string, unknown>) {
  const result = await quoteVersion(svc, c.version.rating as unknown as RatingRule, risk);
  if (!result.ok || !(result.premium > 0)) return null;
  // Only a clean accept is instant; refer/decline goes to the insurer (or nowhere) as today.
  const underwriting = await evaluateUnderwriting(svc, c.version.id, risk);
  if (underwriting.outcome !== "accept") return null;
  return { result, underwriting };
}

/**
 * Prices the instant direct offers for a risk (used by the quote form before anything is saved).
 * Complex risks never get instant offers: they always go to a broker. Neither does a customer with a standing
 * broker (customer_broker_assignments): routing keeps them with that broker, so a direct offer could not be honoured.
 */
export async function directOffers(categorySlug: string, risk: Record<string, unknown>, opts: { customerId?: string | null } = {}): Promise<DirectOffer[]> {
  const svc = createServiceClient();
  if (opts.customerId) {
    const { data: assignment } = await svc.from("customer_broker_assignments").select("id").eq("customer_id", opts.customerId).eq("active", true).limit(1).maybeSingle();
    if (assignment) return [];
  }
  const { data: category } = await svc.from("product_categories").select("id, slug, segment").eq("slug", categorySlug).maybeSingle();
  if (!category || category.segment !== "personal") return [];
  if (complexityFlags({ categorySlug: category.slug, risk }).length) return [];
  const offers: DirectOffer[] = [];
  for (const c of await instantCandidates(svc, category.id)) {
    try {
      const priced = await priceCandidate(svc, c, risk);
      if (!priced) continue;
      offers.push({
        insurerOrgId: c.insurer.id,
        insurerName: c.insurer.name,
        productId: c.product.id,
        productName: c.product.name,
        versionId: c.version.id,
        premium: priced.result.premium,
        sumInsured: priced.result.sumInsured ?? null,
        issuance: issuanceSummary(c.version),
      });
    } catch (err) {
      log.warn("direct_quotes.offer_failed", { insurerOrgId: c.insurer.id, productId: c.product.id, err });
    }
  }
  return offers.sort((a, b) => a.premium - b.premium);
}

/**
 * Called after routing sends a request `insurer_direct`: if the insurer's line and product allow it,
 * create a binding (ready_to_accept) quote straight away and mark the direct submission as quoted.
 * Returns the quote id, or null when the insurer must quote by hand.
 */
export async function instantDirectQuote(
  svc: Svc,
  request: Pick<Row<"requests">, "id" | "category_id" | "risk_data">,
  insurerOrgId: string,
  validityDays = 14,
): Promise<{ quoteId: string; insurerName: string } | null> {
  const risk = (request.risk_data ?? {}) as Record<string, unknown>;
  const wantedProduct = typeof risk.preferred_product_id === "string" ? risk.preferred_product_id : null;
  const candidates = (await instantCandidates(svc, request.category_id, insurerOrgId)).filter((c) => !wantedProduct || c.product.id === wantedProduct);
  let best: { c: Candidate; priced: NonNullable<Awaited<ReturnType<typeof priceCandidate>>> } | null = null;
  for (const c of candidates) {
    const priced = await priceCandidate(svc, c, risk);
    if (priced && (!best || priced.result.premium < best.priced.result.premium)) best = { c, priced };
  }
  if (!best) return null;
  const { c, priced } = best;
  const v = c.version;
  const now = new Date();

  const { data: sub } = await svc
    .from("insurer_submissions")
    .update({ status: "quoted", responded_at: now.toISOString() })
    .eq("request_id", request.id)
    .eq("insurer_org_id", insurerOrgId)
    .select("id")
    .maybeSingle();

  const excesses = (v.excesses ?? {}) as Record<string, unknown>;
  const mainExcess = Object.values(excesses).find((x) => typeof x === "number") as number | undefined;
  const { data: q, error } = await svc
    .from("quotes")
    .insert({
      request_id: request.id,
      submission_id: sub?.id ?? null,
      insurer_org_id: insurerOrgId,
      broker_org_id: null,
      product_id: c.product.id,
      product_version_id: v.id,
      status: "ready_to_accept",
      premium: priced.result.premium,
      sum_insured: priced.result.sumInsured,
      excess: mainExcess ?? null,
      limits: v.limits,
      excesses: v.excesses,
      coverage: v.coverage,
      exclusions: v.exclusions,
      key_exclusion: v.key_exclusion,
      waiting_period_days: v.waiting_period_days,
      optional_benefits: v.optional_benefits,
      conditions: v.conditions,
      assumptions: {
        rating_lines: priced.result.lines,
        loadings: priced.result.appliedLoadings,
        engine: ENGINE_VERSION,
        issuance: issuanceSummary(v),
        underwriting: { outcome: priced.underwriting.outcome, matched: priced.underwriting.matched.map((m) => m.name), reasons: priced.underwriting.reasons },
        direct: true,
      } as unknown as Json,
      valid_until: new Date(now.getTime() + validityDays * 86_400_000).toISOString(),
      commission_disclosure: DIRECT_QUOTE_DISCLOSURE,
    })
    .select("id")
    .single();
  if (error || !q) {
    log.error("direct_quotes.insert_failed", { requestId: request.id, insurerOrgId, err: error });
    return null;
  }
  await applyLoyaltyToQuote(q.id, { svc });
  return { quoteId: q.id, insurerName: c.insurer.name };
}
