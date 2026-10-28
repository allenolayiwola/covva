/**
 * Broker scorecards, ratings, routing adjustment and analytics shaping (roadmap Phase 4).
 * Pure functions only: the server gathers the raw measures (SQL `broker_scorecard_inputs`),
 * this module turns them into an explainable 0–100 score, bands and suggestions, and the
 * routing engine applies a bounded adjustment. Formulas are documented in
 * docs/SCORECARDS_ANALYTICS.md; the SQL helpers in the migration mirror `premiumBand`,
 * `responseBand` and `suppressSmallCell` — keep them in step.
 */

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------
export const SCORECARD_WINDOWS = [30, 90] as const;
export type ScorecardWindow = (typeof SCORECARD_WINDOWS)[number];

/** Measured requests / claims a component needs before it counts. */
export const SCORECARD_MIN_SAMPLES = 5;
/** Approved reviews needed before an average rating is shown or scored. */
export const SCORECARD_MIN_REVIEWS = 3;
/** Routing points (±) the 90-day score may move a broker in a pool, by default. */
export const DEFAULT_SCORECARD_ROUTING_WEIGHT = 10;
/** Counts below this are suppressed in anything an insurer can see. */
export const SMALL_CELL_THRESHOLD = 5;

export type ScoreBand = "new" | "needs_attention" | "fair" | "good" | "excellent";
export type ResponseBand = "within_hour" | "same_day" | "next_day" | "slower";
export type ScorecardComponentKey = "response" | "fulfilment" | "issuance" | "claims" | "sla" | "ratings";

export const SCORE_BAND_LABEL: Record<ScoreBand, string> = {
  new: "Building a track record",
  needs_attention: "Needs attention",
  fair: "Fair",
  good: "Good",
  excellent: "Excellent",
};

export const RESPONSE_BAND_LABEL: Record<ResponseBand, string> = {
  within_hour: "Usually replies within an hour",
  same_day: "Usually replies the same day",
  next_day: "Usually replies within a day",
  slower: "Replies can take more than a day",
};

export const COMPONENT_LABEL: Record<ScorecardComponentKey, string> = {
  response: "First response",
  fulfilment: "Quote fulfilment",
  issuance: "Policy issuance",
  claims: "Claims support",
  sla: "Service levels met",
  ratings: "Customer ratings",
};

/** Relative weights of the components (sum 100). Missing components redistribute their weight. */
export const COMPONENT_WEIGHTS: Record<ScorecardComponentKey, number> = {
  response: 25,
  fulfilment: 25,
  issuance: 10,
  claims: 15,
  sla: 10,
  ratings: 15,
};

// ---------------------------------------------------------------------------
// Inputs and outputs
// ---------------------------------------------------------------------------
/** Raw measures for one broker and window, as `broker_scorecard_inputs()` returns them. */
export interface ScorecardInputs {
  requests_received: number;
  requests_completed: number;
  first_response_median_minutes: number | null;
  first_response_samples: number;
  quote_fulfilment_rate: number | null;
  quote_fulfilment_samples: number;
  quote_median_hours: number | null;
  issuance_median_hours: number | null;
  issuance_samples: number;
  claims_ack_median_hours: number | null;
  claims_settle_median_days: number | null;
  claims_samples: number;
  sla_measured: number;
  sla_breached: number;
  rating_avg: number | null;
  rating_count: number;
}

export interface ScorecardComponent {
  key: ScorecardComponentKey;
  label: string;
  /** Sub-score 0–100, null when the sample is too small. */
  points: number | null;
  weight: number;
  samples: number;
  /** Human-readable value ("2.5 h median", "92 %"). */
  display: string;
  counted: boolean;
}

export interface ScorecardSuggestion {
  key: ScorecardComponentKey;
  text: string;
  /** Points the overall score would gain if this component reached 100 (rough, for prioritising). */
  upside: number;
}

export interface Scorecard {
  score: number | null;
  band: ScoreBand;
  components: ScorecardComponent[];
  suggestions: ScorecardSuggestion[];
  slaBreachRate: number | null;
  responseBand: ResponseBand | null;
  /** Share of the total weight backed by enough data (0–1). */
  coverage: number;
}

export interface ScorecardConfig {
  minSamples?: number;
  minReviews?: number;
}

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------
const clamp = (n: number, lo = 0, hi = 100) => Math.min(hi, Math.max(lo, n));
const round1 = (n: number) => Math.round(n * 10) / 10;
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** Median of a list (null when empty). */
export function median(values: number[]): number | null {
  const xs = values.filter(isNum).sort((a, b) => a - b);
  if (!xs.length) return null;
  const m = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[m]! : (xs[m - 1]! + xs[m]!) / 2;
}

/**
 * Piecewise-linear "lower is better" mapping: `best` or faster scores 100, `worst` or slower
 * scores 0, in between is linear. Used for every time-based component.
 */
export function timeScore(value: number | null | undefined, best: number, worst: number): number | null {
  if (!isNum(value)) return null;
  if (value <= best) return 100;
  if (value >= worst) return 0;
  return round1(100 * (1 - (value - best) / (worst - best)));
}

/** Rate 0–1 → 0–100. */
export function rateScore(rate: number | null | undefined): number | null {
  return isNum(rate) ? round1(clamp(rate, 0, 1) * 100) : null;
}

/** Response band from the median first response in minutes (null below the minimum sample). */
export function responseBand(medianMinutes: number | null | undefined, samples: number, minSamples = SCORECARD_MIN_SAMPLES): ResponseBand | null {
  if (!isNum(medianMinutes) || samples < minSamples) return null;
  if (medianMinutes <= 60) return "within_hour";
  if (medianMinutes <= 480) return "same_day";
  if (medianMinutes <= 1440) return "next_day";
  return "slower";
}

export function scoreBand(score: number | null): ScoreBand {
  if (!isNum(score)) return "new";
  if (score >= 85) return "excellent";
  if (score >= 70) return "good";
  if (score >= 50) return "fair";
  return "needs_attention";
}

export function formatDuration(hours: number | null | undefined): string {
  if (!isNum(hours)) return "—";
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))} min`;
  if (hours < 48) return `${round1(hours)} h`;
  return `${round1(hours / 24)} days`;
}

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------
export interface RatingAggregate {
  count: number;
  /** Null until `minReviews` approved reviews exist. */
  average: number | null;
  distribution: Record<1 | 2 | 3 | 4 | 5, number>;
}

/** Aggregates approved star ratings; the average is only published from `minReviews` reviews. */
export function aggregateRatings(ratings: number[], minReviews = SCORECARD_MIN_REVIEWS): RatingAggregate {
  const distribution: RatingAggregate["distribution"] = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let sum = 0;
  let count = 0;
  for (const r of ratings) {
    const n = Math.round(r);
    if (n < 1 || n > 5) continue;
    distribution[n as 1 | 2 | 3 | 4 | 5]++;
    sum += n;
    count++;
  }
  return { count, average: count >= minReviews ? round1(sum / count) : null, distribution };
}

/** Star rating 1–5 → 0–100. */
export function ratingScore(average: number | null | undefined): number | null {
  return isNum(average) ? round1(clamp(((average - 1) / 4) * 100)) : null;
}

/** Reviewer display name: "Ama Kumi" → "Ama K.", anything else "Verified customer". */
export function maskReviewerName(name: string | null | undefined, accountType?: string | null): string {
  if (accountType === "business") return "Verified customer";
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return "Verified customer";
  return `${parts[0]} ${parts[parts.length - 1]![0]!.toUpperCase()}.`;
}

// ---------------------------------------------------------------------------
// The scorecard
// ---------------------------------------------------------------------------
function component(key: ScorecardComponentKey, points: number | null, samples: number, display: string, minSamples: number): ScorecardComponent {
  const counted = points !== null && samples >= minSamples;
  return { key, label: COMPONENT_LABEL[key], points: counted ? points : null, weight: COMPONENT_WEIGHTS[key], samples, display, counted };
}

/**
 * Composite score for one broker and window. Each component maps its raw measure to 0–100;
 * components without enough samples are left out and their weight is redistributed. The
 * overall score is null (band "new") until at least half of the total weight is backed by
 * data, so a new broker is neutral rather than penalised.
 */
export function computeScorecard(input: ScorecardInputs, config: ScorecardConfig = {}): Scorecard {
  const minSamples = config.minSamples ?? SCORECARD_MIN_SAMPLES;
  const minReviews = config.minReviews ?? SCORECARD_MIN_REVIEWS;

  const responseMinutes = input.first_response_median_minutes;
  const response = component("response", timeScore(responseMinutes, 60, 48 * 60), input.first_response_samples, isNum(responseMinutes) ? `${formatDuration(responseMinutes / 60)} median` : "No measured requests yet", minSamples);

  // Fulfilment = 70 % share of requests that reached a binding quote + 30 % time to it.
  const rate = rateScore(input.quote_fulfilment_rate);
  const quoteTime = timeScore(input.quote_median_hours, 24, 120);
  const fulfilmentPoints = rate === null ? null : quoteTime === null ? rate : round1(rate * 0.7 + quoteTime * 0.3);
  const fulfilment = component(
    "fulfilment",
    fulfilmentPoints,
    input.quote_fulfilment_samples,
    isNum(input.quote_fulfilment_rate) ? `${Math.round(input.quote_fulfilment_rate * 100)} % quoted${isNum(input.quote_median_hours) ? ` · ${formatDuration(input.quote_median_hours)} to a binding quote` : ""}` : "No quote-flow requests yet",
    minSamples,
  );

  const issuance = component("issuance", timeScore(input.issuance_median_hours, 24, 168), input.issuance_samples, isNum(input.issuance_median_hours) ? `${formatDuration(input.issuance_median_hours)} from payment to policy` : "No policies issued yet", minSamples);

  const ack = timeScore(input.claims_ack_median_hours, 24, 120);
  const settle = timeScore(isNum(input.claims_settle_median_days) ? input.claims_settle_median_days * 24 : null, 14 * 24, 60 * 24);
  const claimsPoints = ack === null && settle === null ? null : ack === null ? settle : settle === null ? ack : round1((ack + settle) / 2);
  const claims = component(
    "claims",
    claimsPoints,
    input.claims_samples,
    input.claims_samples ? [isNum(input.claims_ack_median_hours) ? `${formatDuration(input.claims_ack_median_hours)} to acknowledge` : null, isNum(input.claims_settle_median_days) ? `${round1(input.claims_settle_median_days)} days to settle` : null].filter(Boolean).join(" · ") || "Claims in progress" : "No claims supported yet",
    minSamples,
  );

  const breachRate = input.sla_measured > 0 ? input.sla_breached / input.sla_measured : null;
  const sla = component("sla", breachRate === null ? null : round1(clamp(100 * (1 - breachRate * 2))), input.sla_measured, breachRate === null ? "No measured service levels yet" : `${Math.round((1 - breachRate) * 100)} % on time`, minSamples);

  const ratings = component("ratings", input.rating_count >= minReviews ? ratingScore(input.rating_avg) : null, input.rating_count, input.rating_count >= minReviews && isNum(input.rating_avg) ? `${round1(input.rating_avg)} / 5 from ${input.rating_count} reviews` : `${input.rating_count} of ${minReviews} reviews needed`, minReviews);

  const components = [response, fulfilment, issuance, claims, sla, ratings];
  const totalWeight = components.reduce((s, c) => s + c.weight, 0);
  const counted = components.filter((c) => c.counted);
  const countedWeight = counted.reduce((s, c) => s + c.weight, 0);
  const coverage = countedWeight / totalWeight;
  const score = coverage >= 0.5 ? round1(counted.reduce((s, c) => s + (c.points ?? 0) * c.weight, 0) / countedWeight) : null;

  const suggestions: ScorecardSuggestion[] = counted
    .filter((c) => (c.points ?? 100) < 80)
    .map((c) => ({ key: c.key, text: suggestionText(c.key, input), upside: round1(((100 - (c.points ?? 0)) * c.weight) / countedWeight) }))
    .sort((a, b) => b.upside - a.upside)
    .slice(0, 3);
  for (const c of components) {
    if (!c.counted && suggestions.length < 3) suggestions.push({ key: c.key, text: c.key === "ratings" ? `Ask customers to rate you after a completed request: ${c.display.toLowerCase()}.` : `Not enough history yet for ${c.label.toLowerCase()} (${c.samples} of ${minSamples} measured).`, upside: 0 });
  }

  return { score, band: scoreBand(score), components, suggestions, slaBreachRate: breachRate === null ? null : Math.round(breachRate * 1000) / 1000, responseBand: responseBand(responseMinutes, input.first_response_samples, minSamples), coverage: Math.round(coverage * 100) / 100 };
}

function suggestionText(key: ScorecardComponentKey, input: ScorecardInputs): string {
  switch (key) {
    case "response":
      return "Reply to new requests within an hour: a first message, task or estimate stops the clock.";
    case "fulfilment":
      return isNum(input.quote_fulfilment_rate) && input.quote_fulfilment_rate < 0.8 ? "Get a binding quote onto more requests: chase insurers or close requests you cannot place." : "Shorten the time to a binding quote: submit to insurers the same day.";
    case "issuance":
      return "Chase insurers that take more than a day to issue after payment.";
    case "claims":
      return "Acknowledge claims within a day and keep the customer informed until settlement.";
    case "sla":
      return "Fewer missed service levels: watch the response target on the request queue.";
    case "ratings":
      return "Low ratings pull the score down: read the comments and reply to them.";
  }
}

/** Payload for `broker_scorecards` from inputs + the computed card (keeps the server loops thin). */
export function scorecardRow(input: ScorecardInputs & { broker_org_id: string; window_days: number }, card: Scorecard, now = new Date()) {
  return {
    broker_org_id: input.broker_org_id,
    window_days: input.window_days,
    computed_at: now.toISOString(),
    requests_received: input.requests_received,
    requests_completed: input.requests_completed,
    first_response_median_minutes: input.first_response_median_minutes,
    first_response_samples: input.first_response_samples,
    quote_fulfilment_rate: input.quote_fulfilment_rate,
    quote_fulfilment_samples: input.quote_fulfilment_samples,
    quote_median_hours: input.quote_median_hours,
    issuance_median_hours: input.issuance_median_hours,
    issuance_samples: input.issuance_samples,
    claims_ack_median_hours: input.claims_ack_median_hours,
    claims_settle_median_days: input.claims_settle_median_days,
    claims_samples: input.claims_samples,
    sla_measured: input.sla_measured,
    sla_breached: input.sla_breached,
    sla_breach_rate: card.slaBreachRate,
    rating_avg: input.rating_avg,
    rating_count: input.rating_count,
    score: card.score,
    score_band: card.band,
    components: card.components.map((c) => ({ key: c.key, label: c.label, points: c.points, weight: c.weight, samples: c.samples, display: c.display, counted: c.counted })),
    suggestions: card.suggestions,
  };
}

/** Parses the JSON `broker_scorecard_inputs()` returns (numbers may arrive as strings). */
export function parseScorecardInputs(raw: unknown): ScorecardInputs {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const num = (k: string): number | null => {
    const v = o[k];
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const int = (k: string) => Math.max(0, Math.round(num(k) ?? 0));
  return {
    requests_received: int("requests_received"),
    requests_completed: int("requests_completed"),
    first_response_median_minutes: num("first_response_median_minutes"),
    first_response_samples: int("first_response_samples"),
    quote_fulfilment_rate: num("quote_fulfilment_rate"),
    quote_fulfilment_samples: int("quote_fulfilment_samples"),
    quote_median_hours: num("quote_median_hours"),
    issuance_median_hours: num("issuance_median_hours"),
    issuance_samples: int("issuance_samples"),
    claims_ack_median_hours: num("claims_ack_median_hours"),
    claims_settle_median_days: num("claims_settle_median_days"),
    claims_samples: int("claims_samples"),
    sla_measured: int("sla_measured"),
    sla_breached: int("sla_breached"),
    rating_avg: num("rating_avg"),
    rating_count: int("rating_count"),
  };
}

// ---------------------------------------------------------------------------
// Routing adjustment
// ---------------------------------------------------------------------------
/**
 * Bounded routing adjustment from a 0–100 score: `(score − 50) / 50 × weight`, so an excellent
 * broker gains at most `weight` points and a struggling one loses at most `weight`. A broker
 * with no score (new, not enough history) gets 0: neutral, never penalised. The routing score
 * is "lower is better", so callers subtract the adjustment.
 */
export function scorecardRoutingAdjustment(score: number | null | undefined, weight = DEFAULT_SCORECARD_ROUTING_WEIGHT): number {
  if (!isNum(score) || !isNum(weight) || weight <= 0) return 0;
  const w = Math.min(weight, 100);
  return Math.round(((clamp(score) - 50) / 50) * w * 100) / 100;
}

// ---------------------------------------------------------------------------
// Analytics: suppression, premium bands, rollup shaping, insight helpers
// ---------------------------------------------------------------------------
/** Counts of 1 to threshold−1 become null; 0 stays 0 (an empty cell identifies nobody). */
export function suppressSmallCell(count: number | null | undefined, threshold = SMALL_CELL_THRESHOLD): number | null {
  if (!isNum(count)) return null;
  if (count === 0) return 0;
  return count < threshold ? null : count;
}

/** Suppresses every listed count on an object (copy), leaving other keys untouched. */
export function suppressSmallCells<T extends Record<string, unknown>>(row: T, keys: (keyof T)[], threshold = SMALL_CELL_THRESHOLD): T {
  const out = { ...row };
  for (const k of keys) (out as Record<string, unknown>)[k as string] = suppressSmallCell(out[k] as number | null | undefined, threshold);
  return out;
}

/** Share of `part` in `total`, null when either is suppressed or the total is 0. */
export function shareOf(part: number | null | undefined, total: number | null | undefined): number | null {
  if (!isNum(part) || !isNum(total) || total <= 0) return null;
  return Math.round((part / total) * 1000) / 1000;
}

export type PremiumBand = "under_500" | "from_500_to_2k" | "from_2k_to_10k" | "over_10k";
export const PREMIUM_BANDS: { key: PremiumBand; label: string }[] = [
  { key: "under_500", label: "Under GHS 500" },
  { key: "from_500_to_2k", label: "GHS 500 – 2,000" },
  { key: "from_2k_to_10k", label: "GHS 2,000 – 10,000" },
  { key: "over_10k", label: "Over GHS 10,000" },
];

/** Annual premium band (GHS); mirrors `private.premium_band`. */
export function premiumBand(premium: number | null | undefined): PremiumBand | null {
  if (!isNum(premium)) return null;
  if (premium < 500) return "under_500";
  if (premium < 2000) return "from_500_to_2k";
  if (premium < 10000) return "from_2k_to_10k";
  return "over_10k";
}

export type PricePosition = "below" | "in_line" | "above";

/** Price position of an insurer's median against the market median (±10 % = in line). */
export function pricePosition(mine: number | null | undefined, market: number | null | undefined, tolerance = 0.1): PricePosition | null {
  if (!isNum(mine) || !isNum(market) || market <= 0) return null;
  if (mine < market * (1 - tolerance)) return "below";
  if (mine > market * (1 + tolerance)) return "above";
  return "in_line";
}

export interface FactDims {
  day: string;
  category_id: string | null;
  region: string | null;
  broker_org_id: string | null;
  insurer_org_id: string | null;
}

export const FACT_METRICS = [
  "requests", "quotes", "binding_quotes", "conversions", "policies_issued", "premium_sum",
  "premium_under_500", "premium_500_to_2k", "premium_2k_to_10k", "premium_over_10k",
  "renewals_due", "renewals_renewed", "claims_opened", "claims_settled", "payments_succeeded", "payments_failed",
] as const;
export type FactMetric = (typeof FACT_METRICS)[number];
export type FactRow = FactDims & Record<FactMetric, number>;

export function emptyFact(dims: FactDims): FactRow {
  const row = { ...dims } as FactRow;
  for (const m of FACT_METRICS) row[m] = 0;
  return row;
}

/** Stable key of a fact's dimensions (null = "not applicable"). */
export function factKey(d: FactDims): string {
  return [d.day, d.category_id ?? "", d.region ?? "", d.broker_org_id ?? "", d.insurer_org_id ?? ""].join("|");
}

/**
 * Display label for a fact row's grouping key as `analytics_facts` returns it. A fact with no region
 * or no partner comes back with a SQL NULL key (and some drivers stringify it to "null"), which must
 * read as "Not recorded" rather than crash a `.slice()`; otherwise `lookup` names the id, falling back
 * to its first 8 characters.
 */
export function factKeyLabel(key: unknown, lookup?: (id: string) => string | null | undefined): string {
  if (key === null || key === undefined) return "Not recorded";
  const k = String(key).trim();
  if (k === "" || k === "null") return "Not recorded";
  const named = lookup?.(k);
  return named ?? k.slice(0, 8);
}

/**
 * Sums partial fact rows (one metric each, as the per-entity aggregates produce them) into one
 * row per dimension tuple: the same shaping the SQL rollup does with its UNION ALL + GROUP BY.
 * Running it twice over the same input gives the same output (idempotent by construction).
 */
export function mergeFactRows(partials: (FactDims & Partial<Record<FactMetric, number>>)[]): FactRow[] {
  const out = new Map<string, FactRow>();
  for (const p of partials) {
    const key = factKey(p);
    const row = out.get(key) ?? emptyFact({ day: p.day, category_id: p.category_id ?? null, region: p.region ?? null, broker_org_id: p.broker_org_id ?? null, insurer_org_id: p.insurer_org_id ?? null });
    for (const m of FACT_METRICS) row[m] += Number(p[m] ?? 0) || 0;
    out.set(key, row);
  }
  return [...out.values()].sort((a, b) => factKey(a).localeCompare(factKey(b)));
}

/** Sums fact rows into one total (for KPI tiles). */
export function sumFacts<T extends Partial<Record<FactMetric, number | string | null>>>(rows: T[]): Record<FactMetric, number> {
  const t = {} as Record<FactMetric, number>;
  for (const m of FACT_METRICS) t[m] = 0;
  for (const r of rows) for (const m of FACT_METRICS) t[m] += Number(r[m] ?? 0) || 0;
  return t;
}

/** Funnel conversion rates from totals (null where the previous step is empty). */
export function funnelRates(t: Pick<Record<FactMetric, number>, "requests" | "quotes" | "binding_quotes" | "conversions" | "policies_issued">) {
  const rate = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 1000 : null);
  return {
    quotesPerRequest: t.requests > 0 ? Math.round((t.quotes / t.requests) * 10) / 10 : null,
    bindingShare: rate(t.binding_quotes, t.quotes),
    requestToConversion: rate(t.conversions, t.requests),
    conversionToPolicy: rate(t.policies_issued, t.conversions),
    requestToPolicy: rate(t.policies_issued, t.requests),
  };
}
