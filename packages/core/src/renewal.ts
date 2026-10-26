/**
 * One-tap renewal: given the expiring policy and refreshed estimates for the same risk,
 * work out the "renew with the same insurer" offer, the alternatives and the savings.
 * Also the underinsurance check used by the policy-lifecycle nudge.
 */
export interface RenewalPolicy {
  insurerOrgId: string;
  insurerName?: string | null;
  premium: number | null;
  sumInsured?: number | null;
  brokerOrgId?: string | null;
}

export interface RenewalEstimate {
  quoteId: string;
  insurerOrgId: string;
  insurerName: string;
  productName?: string | null;
  premium: number;
  status: "estimate" | "awaiting_underwriting" | "ready_to_accept" | "accepted" | "expired" | "declined" | "withdrawn";
  sumInsured?: number | null;
}

export interface RenewalOffer extends RenewalEstimate {
  /** Change versus last year's premium in GHS (negative = cheaper). Null when last year's premium is unknown. */
  deltaFromLastYear: number | null;
  deltaPct: number | null;
  /** True when the quote is binding and can be paid for in one tap. */
  oneTap: boolean;
}

export interface RenewalOptions {
  /** Same insurer as the expiring policy (cheapest of their quotes), if they quoted. */
  sameInsurer: RenewalOffer | null;
  /** Other insurers, cheapest first. */
  alternatives: RenewalOffer[];
  /** The cheapest alternative versus the same-insurer offer (or versus last year's premium when the insurer did not quote). */
  savings: { quoteId: string; insurerName: string; amount: number; pct: number } | null;
  /** How many distinct insurers quoted — shown honestly ("1 insurer compared"). */
  insurersCompared: number;
  /** Broker of record stays with the renewal. */
  brokerOrgId: string | null;
}

const LIVE = new Set<RenewalEstimate["status"]>(["estimate", "awaiting_underwriting", "ready_to_accept"]);
const round2 = (n: number) => Math.round(n * 100) / 100;

function toOffer(e: RenewalEstimate, lastPremium: number | null): RenewalOffer {
  const delta = lastPremium && lastPremium > 0 ? round2(e.premium - lastPremium) : null;
  return {
    ...e,
    deltaFromLastYear: delta,
    deltaPct: delta === null ? null : Math.round((delta / lastPremium!) * 1000) / 10,
    oneTap: e.status === "ready_to_accept",
  };
}

export function renewalOptions(policy: RenewalPolicy, estimates: RenewalEstimate[]): RenewalOptions {
  const live = estimates.filter((e) => LIVE.has(e.status) && e.premium > 0).sort((a, b) => a.premium - b.premium);
  const last = policy.premium && policy.premium > 0 ? policy.premium : null;
  const same = live.find((e) => e.insurerOrgId === policy.insurerOrgId) ?? null;
  const others = live.filter((e) => e.insurerOrgId !== policy.insurerOrgId);
  const sameInsurer = same ? toOffer(same, last) : null;
  const alternatives = others.map((e) => toOffer(e, last));
  const cheapestAlt = alternatives[0] ?? null;
  const baseline = sameInsurer?.premium ?? last;
  let savings: RenewalOptions["savings"] = null;
  if (cheapestAlt && baseline && cheapestAlt.premium < baseline) {
    const amount = round2(baseline - cheapestAlt.premium);
    savings = { quoteId: cheapestAlt.quoteId, insurerName: cheapestAlt.insurerName, amount, pct: Math.round((amount / baseline) * 1000) / 10 };
  }
  return {
    sameInsurer,
    alternatives,
    savings,
    insurersCompared: new Set(live.map((e) => e.insurerOrgId)).size,
    brokerOrgId: policy.brokerOrgId ?? null,
  };
}

export interface UnderinsuranceResult {
  underinsured: boolean;
  /** Share of the current value that is insured (0–1). Null when there is nothing to compare. */
  ratio: number | null;
  /** Suggested sum insured: the current value rounded up to the nearest 500. */
  suggestedSumInsured: number | null;
  reason: string | null;
}

/**
 * Flags a policy whose sum insured is below `threshold` (default 85%) of the current value.
 * Insurers apply "average" on underinsured property and motor claims, so the nudge matters.
 */
export function underinsuranceCheck(sumInsured: number | null | undefined, currentValue: number | null | undefined, threshold = 0.85): UnderinsuranceResult {
  if (!currentValue || currentValue <= 0 || sumInsured === null || sumInsured === undefined || !Number.isFinite(sumInsured)) {
    return { underinsured: false, ratio: null, suggestedSumInsured: null, reason: null };
  }
  const ratio = Math.round((sumInsured / currentValue) * 1000) / 1000;
  if (ratio >= threshold) return { underinsured: false, ratio, suggestedSumInsured: null, reason: null };
  const suggested = Math.ceil(currentValue / 500) * 500;
  const pct = Math.round(ratio * 100);
  return {
    underinsured: true,
    ratio,
    suggestedSumInsured: suggested,
    reason: `Insured for ${pct}% of the current value. If you claim, the insurer may reduce the payout in proportion.`,
  };
}

/**
 * The value the customer declared for the insured thing, from the request's risk data:
 * motor → vehicle value; home → buildings + contents; business property → premises + stock +
 * equipment. Null when the category has no value to compare (health, travel, liability…).
 */
export function declaredValue(categorySlug: string | null | undefined, risk: Record<string, unknown> | null | undefined): number | null {
  const r = risk ?? {};
  const num = (k: string) => {
    const v = Number(r[k]);
    return Number.isFinite(v) && v > 0 ? v : 0;
  };
  switch (categorySlug) {
    case "motor":
      return num("vehicle_value") || null;
    case "home":
      return num("building_value") + num("contents_value") || null;
    case "sme-property":
      return num("premises_value") + num("stock_value") + num("equipment_value") || null;
    default:
      return null;
  }
}
