import { test } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateRatings,
  computeScorecard,
  factKey,
  factKeyLabel,
  funnelRates,
  maskReviewerName,
  median,
  mergeFactRows,
  parseScorecardInputs,
  premiumBand,
  pricePosition,
  rateScore,
  responseBand,
  scoreBand,
  scorecardRoutingAdjustment,
  scorecardRow,
  shareOf,
  sumFacts,
  suppressSmallCell,
  suppressSmallCells,
  timeScore,
  type ScorecardInputs,
} from "./scorecards.ts";
import { routeRequest, type RoutingCandidate } from "./routing.ts";
import { decideRouting, type EngineCandidate } from "./routing-engine.ts";

const strong: ScorecardInputs = {
  requests_received: 40,
  requests_completed: 30,
  first_response_median_minutes: 35,
  first_response_samples: 38,
  quote_fulfilment_rate: 0.95,
  quote_fulfilment_samples: 30,
  quote_median_hours: 10,
  issuance_median_hours: 12,
  issuance_samples: 20,
  claims_ack_median_hours: 6,
  claims_settle_median_days: 9,
  claims_samples: 8,
  sla_measured: 36,
  sla_breached: 1,
  rating_avg: 4.8,
  rating_count: 12,
};

const empty: ScorecardInputs = {
  requests_received: 0,
  requests_completed: 0,
  first_response_median_minutes: null,
  first_response_samples: 0,
  quote_fulfilment_rate: null,
  quote_fulfilment_samples: 0,
  quote_median_hours: null,
  issuance_median_hours: null,
  issuance_samples: 0,
  claims_ack_median_hours: null,
  claims_settle_median_days: null,
  claims_samples: 0,
  sla_measured: 0,
  sla_breached: 0,
  rating_avg: null,
  rating_count: 0,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
test("median: odd, even, empty, non-numeric ignored", () => {
  assert.equal(median([5, 1, 3]), 3);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
  assert.equal(median([Number.NaN, 2]), 2);
});

test("timeScore: 100 at or under best, 0 at or over worst, linear between", () => {
  assert.equal(timeScore(30, 60, 2880), 100);
  assert.equal(timeScore(2880, 60, 2880), 0);
  assert.equal(timeScore(1470, 60, 2880), 50);
  assert.equal(timeScore(null, 60, 2880), null);
});

test("rateScore and scoreBand thresholds", () => {
  assert.equal(rateScore(0.925), 92.5);
  assert.equal(rateScore(1.4), 100);
  assert.equal(rateScore(null), null);
  assert.equal(scoreBand(null), "new");
  assert.equal(scoreBand(49.9), "needs_attention");
  assert.equal(scoreBand(50), "fair");
  assert.equal(scoreBand(70), "good");
  assert.equal(scoreBand(85), "excellent");
});

test("responseBand: needs the minimum sample, then bands by the median minutes", () => {
  assert.equal(responseBand(30, 4), null, "4 samples is below the minimum of 5");
  assert.equal(responseBand(30, 5), "within_hour");
  assert.equal(responseBand(300, 9), "same_day");
  assert.equal(responseBand(1000, 9), "next_day");
  assert.equal(responseBand(3000, 9), "slower");
  assert.equal(responseBand(null, 50), null);
});

// ---------------------------------------------------------------------------
// Ratings
// ---------------------------------------------------------------------------
test("aggregateRatings: average only from the minimum number of reviews, distribution counts stars", () => {
  const two = aggregateRatings([5, 4]);
  assert.equal(two.count, 2);
  assert.equal(two.average, null, "two reviews is below the minimum of 3");
  const three = aggregateRatings([5, 4, 3, 9, 0]);
  assert.equal(three.count, 3, "out-of-range ratings are ignored");
  assert.equal(three.average, 4);
  assert.deepEqual(three.distribution, { 1: 0, 2: 0, 3: 1, 4: 1, 5: 1 });
  assert.equal(aggregateRatings([5, 5], 2).average, 5, "the minimum is configurable");
});

test("maskReviewerName: first name and initial, otherwise Verified customer", () => {
  assert.equal(maskReviewerName("Ama Kumi"), "Ama K.");
  assert.equal(maskReviewerName("Kofi Owusu Mensah"), "Kofi M.");
  assert.equal(maskReviewerName("Ama"), "Verified customer");
  assert.equal(maskReviewerName(""), "Verified customer");
  assert.equal(maskReviewerName(null), "Verified customer");
  assert.equal(maskReviewerName("Accra Traders Ltd", "business"), "Verified customer");
});

// ---------------------------------------------------------------------------
// Scorecard
// ---------------------------------------------------------------------------
test("computeScorecard: a strong broker scores excellent with every component counted", () => {
  const card = computeScorecard(strong);
  assert.ok(card.score !== null && card.score >= 85, `expected an excellent score, got ${card.score}`);
  assert.equal(card.band, "excellent");
  assert.equal(card.coverage, 1);
  assert.ok(card.components.every((c) => c.counted));
  assert.equal(card.responseBand, "within_hour");
  assert.equal(card.slaBreachRate, Math.round((1 / 36) * 1000) / 1000);
  const weights = card.components.reduce((s, c) => s + c.weight, 0);
  assert.equal(weights, 100);
});

test("computeScorecard: a new broker with no history has no score and the band is new (neutral)", () => {
  const card = computeScorecard(empty);
  assert.equal(card.score, null);
  assert.equal(card.band, "new");
  assert.equal(card.coverage, 0);
  assert.ok(card.components.every((c) => !c.counted && c.points === null));
  assert.ok(card.suggestions.length > 0 && card.suggestions.every((s) => s.upside === 0), "suggestions explain what is missing without penalising");
  assert.equal(scorecardRoutingAdjustment(card.score), 0, "no score → no routing adjustment");
});

test("computeScorecard: components below the minimum sample are left out and the weight is redistributed", () => {
  const partial: ScorecardInputs = { ...empty, first_response_median_minutes: 20, first_response_samples: 12, quote_fulfilment_rate: 1, quote_fulfilment_samples: 10, quote_median_hours: 5, sla_measured: 10, sla_breached: 0, rating_avg: 5, rating_count: 2 };
  const card = computeScorecard(partial);
  const counted = card.components.filter((c) => c.counted).map((c) => c.key);
  assert.deepEqual(counted, ["response", "fulfilment", "sla"]);
  assert.equal(card.coverage, 0.6, "25 + 25 + 10 of 100");
  assert.equal(card.score, 100, "perfect on the measured components");
  assert.equal(card.components.find((c) => c.key === "ratings")!.display, "2 of 3 reviews needed");
  // Below half the weight → no score yet.
  const thin = computeScorecard({ ...empty, first_response_median_minutes: 20, first_response_samples: 12 });
  assert.equal(thin.score, null);
  assert.equal(thin.coverage, 0.25);
});

test("computeScorecard: slow response and breached service levels pull the score down with suggestions ordered by upside", () => {
  const weak: ScorecardInputs = { ...strong, first_response_median_minutes: 2000, quote_fulfilment_rate: 0.5, quote_median_hours: 100, sla_measured: 20, sla_breached: 10, rating_avg: 2.5 };
  const card = computeScorecard(weak);
  assert.ok(card.score !== null && card.score < 50, `expected needs_attention, got ${card.score}`);
  assert.equal(card.band, "needs_attention");
  assert.equal(card.components.find((c) => c.key === "sla")!.points, 0, "50 % breaches → 0 points");
  assert.equal(card.suggestions.length, 3);
  assert.ok(card.suggestions[0]!.upside >= card.suggestions[1]!.upside && card.suggestions[1]!.upside >= card.suggestions[2]!.upside);
  assert.ok(card.suggestions.some((s) => s.key === "response"));
});

test("scorecardRow and parseScorecardInputs round-trip the raw measures", () => {
  const raw = { ...strong, broker_org_id: "b1", window_days: 90, computed_at: "x", first_response_median_minutes: "35.0", quote_fulfilment_rate: "0.9500" };
  const parsed = parseScorecardInputs(raw);
  assert.equal(parsed.first_response_median_minutes, 35);
  assert.equal(parsed.quote_fulfilment_rate, 0.95);
  assert.equal(parsed.rating_count, 12);
  const row = scorecardRow({ ...parsed, broker_org_id: "b1", window_days: 90 }, computeScorecard(parsed), new Date("2026-10-27T00:00:00Z"));
  assert.equal(row.broker_org_id, "b1");
  assert.equal(row.window_days, 90);
  assert.equal(row.score_band, "excellent");
  assert.equal(row.computed_at, "2026-10-27T00:00:00.000Z");
  assert.equal(row.components.length, 6);
  assert.equal(parseScorecardInputs(null).requests_received, 0);
});

// ---------------------------------------------------------------------------
// Routing adjustment
// ---------------------------------------------------------------------------
test("scorecardRoutingAdjustment: bounded by the weight, symmetric around 50, neutral without a score", () => {
  assert.equal(scorecardRoutingAdjustment(100, 10), 10);
  assert.equal(scorecardRoutingAdjustment(0, 10), -10);
  assert.equal(scorecardRoutingAdjustment(50, 10), 0);
  assert.equal(scorecardRoutingAdjustment(75, 10), 5);
  assert.equal(scorecardRoutingAdjustment(75, 4), 2);
  assert.equal(scorecardRoutingAdjustment(null, 10), 0);
  assert.equal(scorecardRoutingAdjustment(90, 0), 0, "weight 0 disables the factor");
  assert.equal(scorecardRoutingAdjustment(90, -3), 0);
  assert.equal(scorecardRoutingAdjustment(100, 500), 100, "weight is capped at 100 points");
});

const cand = (over: Partial<RoutingCandidate> & Pick<RoutingCandidate, "brokerOrgId">): RoutingCandidate => ({
  brokerName: over.brokerOrgId.toUpperCase(),
  priority: 10,
  isSecondary: false,
  regions: [],
  segments: [],
  dailyCapacity: null,
  openToday: 0,
  insurerAccess: 3,
  licenceValid: true,
  ...over,
});

test("routeRequest: the scorecard factor re-orders brokers of equal priority but never beats priority or the secondary rule", () => {
  const a = cand({ brokerOrgId: "a", scorecardScore: 90 });
  const b = cand({ brokerOrgId: "b", scorecardScore: 40 });
  const fresh = cand({ brokerOrgId: "fresh", scorecardScore: null });
  const d = routeRequest([b, fresh, a], { scorecardWeight: 10 });
  assert.equal(d.brokerOrgId, "a");
  const scores = Object.fromEntries(d.considered.map((c) => [c.brokerOrgId, c.score!]));
  assert.ok(scores["a"]! < scores["fresh"]! && scores["fresh"]! < scores["b"]!, "excellent < new (neutral) < needs attention");
  assert.equal(scores["fresh"], 10 - 3, "a broker without a score has exactly the base score");
  // Priority still dominates: a priority-1 broker with a poor score beats a priority-10 broker with a great one (bounded ±10).
  const prio = routeRequest([cand({ brokerOrgId: "top", priority: 1, scorecardScore: 0 }), cand({ brokerOrgId: "great", priority: 30, scorecardScore: 100 })], { scorecardWeight: 10 });
  assert.equal(prio.brokerOrgId, "top");
  // Secondary brokers stay last whatever their score.
  const sec = routeRequest([cand({ brokerOrgId: "sec", isSecondary: true, scorecardScore: 100 }), cand({ brokerOrgId: "pri", priority: 500, scorecardScore: 0 })], { scorecardWeight: 10 });
  assert.equal(sec.brokerOrgId, "pri");
  // Weight 0 (or omitted) → identical to the old scoring.
  const off = routeRequest([a, b], { scorecardWeight: 0 });
  assert.equal(off.considered[0]!.score, off.considered[1]!.score);
  const legacy = routeRequest([a, b], {});
  assert.equal(legacy.considered[0]!.score, legacy.considered[1]!.score, "no weight in the context → factor is off");
});

test("decideRouting: the pool offer order follows the scorecard-adjusted ranking", () => {
  const brokers: EngineCandidate[] = [
    { ...cand({ brokerOrgId: "slow", scorecardScore: 30 }), appointedInsurerOrgIds: ["ins"] },
    { ...cand({ brokerOrgId: "fast", scorecardScore: 95 }), appointedInsurerOrgIds: ["ins"] },
    { ...cand({ brokerOrgId: "new", scorecardScore: null }), appointedInsurerOrgIds: ["ins"] },
  ];
  const d = decideRouting({ request: { categorySlug: "motor", risk: {} }, integrations: [], brokers, scorecardWeight: 10, offerBatchSize: 2 });
  assert.equal(d.mode, "broker_pool");
  assert.deepEqual(d.candidates.filter((c) => c.eligible).map((c) => c.brokerOrgId), ["fast", "new", "slow"]);
  assert.match(d.reason, /Offered first to FAST, NEW/);
});

// ---------------------------------------------------------------------------
// Analytics helpers
// ---------------------------------------------------------------------------
test("suppressSmallCell: 1–4 suppressed, 0 and 5+ kept, null passes through", () => {
  assert.equal(suppressSmallCell(0), 0);
  assert.equal(suppressSmallCell(1), null);
  assert.equal(suppressSmallCell(4), null);
  assert.equal(suppressSmallCell(5), 5);
  assert.equal(suppressSmallCell(null), null);
  assert.equal(suppressSmallCell(2, 2), 2, "threshold is configurable");
  const row = suppressSmallCells({ mine: 3, market: 40, name: "x" }, ["mine", "market"]);
  assert.deepEqual(row, { mine: null, market: 40, name: "x" });
});

test("shareOf and pricePosition tolerate suppressed inputs", () => {
  assert.equal(shareOf(20, 80), 0.25);
  assert.equal(shareOf(null, 80), null);
  assert.equal(shareOf(5, 0), null);
  assert.equal(pricePosition(850, 1000), "below");
  assert.equal(pricePosition(1000, 1000), "in_line");
  assert.equal(pricePosition(1100, 1000), "in_line", "+10 % is still in line");
  assert.equal(pricePosition(1101, 1000), "above");
  assert.equal(pricePosition(null, 1000), null);
});

test("premiumBand boundaries", () => {
  assert.equal(premiumBand(499.99), "under_500");
  assert.equal(premiumBand(500), "from_500_to_2k");
  assert.equal(premiumBand(1999), "from_500_to_2k");
  assert.equal(premiumBand(2000), "from_2k_to_10k");
  assert.equal(premiumBand(10000), "over_10k");
  assert.equal(premiumBand(null), null);
});

test("mergeFactRows: partial rows per entity collapse into one row per dimension tuple, idempotently", () => {
  const partials = [
    { day: "2026-10-01", category_id: "motor", region: "Greater Accra", broker_org_id: "b1", insurer_org_id: null, requests: 3 },
    { day: "2026-10-01", category_id: "motor", region: "Greater Accra", broker_org_id: "b1", insurer_org_id: "i1", quotes: 4, binding_quotes: 2 },
    { day: "2026-10-01", category_id: "motor", region: "Greater Accra", broker_org_id: "b1", insurer_org_id: "i1", policies_issued: 1, premium_sum: 1200, premium_500_to_2k: 1 },
    { day: "2026-10-01", category_id: "motor", region: "Greater Accra", broker_org_id: "b1", insurer_org_id: null, requests: 2 },
  ];
  const once = mergeFactRows(partials);
  assert.equal(once.length, 2);
  const noInsurer = once.find((r) => r.insurer_org_id === null)!;
  assert.equal(noInsurer.requests, 5);
  assert.equal(noInsurer.quotes, 0);
  const withInsurer = once.find((r) => r.insurer_org_id === "i1")!;
  assert.equal(withInsurer.quotes, 4);
  assert.equal(withInsurer.binding_quotes, 2);
  assert.equal(withInsurer.policies_issued, 1);
  assert.equal(withInsurer.premium_sum, 1200);
  assert.deepEqual(mergeFactRows(partials), once, "same input → same output");
  assert.equal(factKey(noInsurer), "2026-10-01|motor|Greater Accra|b1|");
  const totals = sumFacts(once);
  assert.equal(totals.requests, 5);
  assert.equal(totals.quotes, 4);
  assert.equal(totals.premium_sum, 1200);
});

test("funnelRates: step conversions from totals", () => {
  const r = funnelRates({ requests: 40, quotes: 100, binding_quotes: 60, conversions: 20, policies_issued: 18 });
  assert.deepEqual(r, { quotesPerRequest: 2.5, bindingShare: 0.6, requestToConversion: 0.5, conversionToPolicy: 0.9, requestToPolicy: 0.45 });
  assert.equal(funnelRates({ requests: 0, quotes: 0, binding_quotes: 0, conversions: 0, policies_issued: 0 }).requestToPolicy, null);
});

test("factKeyLabel: null / empty / \"null\" keys read as Not recorded, ids are named or shortened", () => {
  assert.equal(factKeyLabel(null), "Not recorded");
  assert.equal(factKeyLabel(undefined), "Not recorded");
  assert.equal(factKeyLabel(""), "Not recorded");
  assert.equal(factKeyLabel("null"), "Not recorded");
  assert.equal(factKeyLabel("  "), "Not recorded");
  assert.equal(factKeyLabel("Greater Accra", (k) => k), "Greater Accra");
  assert.equal(factKeyLabel("4f2c1d9e-0000-4000-8000-000000000000", () => "Coastline Assurance"), "Coastline Assurance");
  assert.equal(factKeyLabel("4f2c1d9e-0000-4000-8000-000000000000", () => undefined), "4f2c1d9e");
  assert.equal(factKeyLabel("4f2c1d9e-0000-4000-8000-000000000000"), "4f2c1d9e");
});
