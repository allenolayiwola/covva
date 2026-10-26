/**
 * Comparison & recommendation engine.
 * Spec rules: coverage-first comparison; explained labels (never an unexplained
 * "best"); paid placement kept separate from suitability ranking; disclose the
 * number of insurers/products compared; auditable record of inputs and criteria.
 */
export const ENGINE_VERSION = "cmp-2026.10";

export interface ComparableQuote {
  id: string;
  insurerId: string;
  insurerName: string;
  productName?: string;
  status: "estimate" | "awaiting_underwriting" | "ready_to_accept" | "accepted" | "expired" | "declined" | "withdrawn";
  premium: number;
  excess: number | null;
  sumInsured: number | null;
  coverage: { key: string; label: string; included: boolean }[];
  exclusions: string[];
  keyExclusion?: string | null;
  waitingPeriodDays: number;
  optionalBenefits: { key: string; label: string; premium?: number }[];
  validUntil?: string | null;
  paidPlacement?: boolean;
}

export type LabelKey = "lowest_premium" | "lowest_excess" | "broadest_coverage" | "highest_benefit" | "recommended";

export const LABELS: Record<LabelKey, string> = {
  lowest_premium: "Lowest premium",
  lowest_excess: "Lowest excess",
  broadest_coverage: "Broadest coverage",
  highest_benefit: "Highest stated benefit",
  recommended: "Recommended based on your answers",
};

export interface Priorities {
  /** 0–1 weights; normalised internally. */
  price?: number;
  excess?: number;
  coverage?: number;
  benefit?: number;
  waiting?: number;
}

export const DEFAULT_PRIORITIES: Required<Priorities> = { price: 0.35, excess: 0.2, coverage: 0.3, benefit: 0.1, waiting: 0.05 };

export interface ScoredQuote {
  quote: ComparableQuote;
  score: number;
  breakdown: Record<keyof Required<Priorities>, number>;
  labels: LabelKey[];
  coverageCount: number;
  reasons: string[];
}

export interface ComparisonResult {
  engineVersion: string;
  insurersCompared: number;
  productsCompared: number;
  criteria: Required<Priorities>;
  ranked: ScoredQuote[];
  paidPlacements: ComparableQuote[];
  materialExclusions: { quoteId: string; exclusion: string }[];
  disclaimer: string;
}

const LIVE: ComparableQuote["status"][] = ["estimate", "awaiting_underwriting", "ready_to_accept"];

function norm(values: number[], v: number, lowerIsBetter: boolean): number {
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (max === min) return 1;
  const x = (v - min) / (max - min);
  return lowerIsBetter ? 1 - x : x;
}

export function compareQuotes(quotes: ComparableQuote[], priorities: Priorities = {}): ComparisonResult {
  const live = quotes.filter((q) => LIVE.includes(q.status));
  // Paid placements never enter the suitability ranking.
  const organic = live.filter((q) => !q.paidPlacement);
  const paid = live.filter((q) => q.paidPlacement);

  const w = { ...DEFAULT_PRIORITIES, ...priorities };
  const total = Object.values(w).reduce((s, x) => s + x, 0) || 1;
  const weights = Object.fromEntries(Object.entries(w).map(([k, v]) => [k, v / total])) as Required<Priorities>;

  const premiums = organic.map((q) => q.premium);
  const excesses = organic.map((q) => q.excess ?? 0);
  const covCounts = organic.map((q) => q.coverage.filter((c) => c.included).length);
  const benefits = organic.map((q) => q.sumInsured ?? 0);
  const waits = organic.map((q) => q.waitingPeriodDays);

  const scored: ScoredQuote[] = organic.map((q, i) => {
    const breakdown = {
      price: norm(premiums, q.premium, true),
      excess: norm(excesses, q.excess ?? 0, true),
      coverage: norm(covCounts, covCounts[i]!, false),
      benefit: norm(benefits, q.sumInsured ?? 0, false),
      waiting: norm(waits, q.waitingPeriodDays, true),
    };
    const score = (Object.keys(breakdown) as (keyof typeof breakdown)[]).reduce((s, k) => s + breakdown[k] * weights[k], 0);
    return { quote: q, score: Math.round(score * 1000) / 1000, breakdown, labels: [], coverageCount: covCounts[i]!, reasons: [] };
  });

  const best = <T>(arr: ScoredQuote[], pick: (s: ScoredQuote) => T, cmp: (a: T, b: T) => number) =>
    arr.length ? arr.reduce((a, b) => (cmp(pick(a), pick(b)) <= 0 ? a : b)) : undefined;

  if (scored.length > 1) {
    best(scored, (s) => s.quote.premium, (a, b) => a - b)?.labels.push("lowest_premium");
    if (excesses.some((e) => e !== excesses[0])) best(scored, (s) => s.quote.excess ?? 0, (a, b) => a - b)?.labels.push("lowest_excess");
    if (covCounts.some((c) => c !== covCounts[0])) best(scored, (s) => s.coverageCount, (a, b) => b - a)?.labels.push("broadest_coverage");
    if (benefits.some((b) => b !== benefits[0])) best(scored, (s) => s.quote.sumInsured ?? 0, (a, b) => b - a)?.labels.push("highest_benefit");
  }

  scored.sort((a, b) => b.score - a.score);
  if (scored[0]) scored[0].labels.push("recommended");

  for (const s of scored) {
    const r: string[] = [];
    if (s.labels.includes("lowest_premium")) r.push("Lowest premium of the quotes compared.");
    if (s.labels.includes("lowest_excess")) r.push(`Lowest excess (GH₵ ${(s.quote.excess ?? 0).toLocaleString("en-GH")}).`);
    if (s.labels.includes("broadest_coverage")) r.push(`Includes ${s.coverageCount} of the listed cover items.`);
    if (s.quote.waitingPeriodDays === 0) r.push("No waiting period.");
    if (s.quote.keyExclusion) r.push(`Check the key exclusion: ${s.quote.keyExclusion}.`);
    s.reasons = r;
  }

  return {
    engineVersion: ENGINE_VERSION,
    insurersCompared: new Set(organic.map((q) => q.insurerId)).size,
    productsCompared: organic.length,
    criteria: weights,
    ranked: scored,
    paidPlacements: paid,
    materialExclusions: organic.flatMap((q) => (q.keyExclusion ? [{ quoteId: q.id, exclusion: q.keyExclusion }] : [])),
    disclaimer:
      "Comparison covers participating insurers only, not the whole market. Rankings follow the disclosed criteria and are not influenced by commission. Paid placements are labelled and shown separately.",
  };
}

/** Plain-language summary of the comparison for disclosure banners. */
export function comparisonSummary(r: ComparisonResult): string {
  return `${r.productsCompared} quote${r.productsCompared === 1 ? "" : "s"} from ${r.insurersCompared} participating insurer${r.insurersCompared === 1 ? "" : "s"} compared.`;
}
