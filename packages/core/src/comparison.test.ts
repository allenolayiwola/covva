import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_PRIORITIES, ENGINE_VERSION, LABELS, compareQuotes, comparisonSummary, type ComparableQuote } from "./comparison.ts";

const base = {
  coverage: [
    { key: "a", label: "A", included: true },
    { key: "b", label: "B", included: true },
  ],
  exclusions: [],
  waitingPeriodDays: 0,
  optionalBenefits: [],
  sumInsured: 80000,
};
const quote = (over: Partial<ComparableQuote> & Pick<ComparableQuote, "id">): ComparableQuote => ({
  ...base,
  insurerId: `ins-${over.id}`,
  insurerName: `Insurer ${over.id}`,
  status: "ready_to_accept",
  premium: 1000,
  excess: 500,
  ...over,
});

test("single quote: ranked alone, recommended, no comparative labels", () => {
  const r = compareQuotes([quote({ id: "only", keyExclusion: "Wear and tear" })]);
  assert.equal(r.productsCompared, 1);
  assert.equal(r.insurersCompared, 1);
  assert.equal(r.ranked.length, 1);
  assert.deepEqual(r.ranked[0]!.labels, ["recommended"]);
  assert.equal(r.ranked[0]!.score, 1, "a lone quote scores full marks on every criterion");
  assert.deepEqual(r.materialExclusions, [{ quoteId: "only", exclusion: "Wear and tear" }]);
  assert.ok(r.ranked[0]!.reasons.includes("Check the key exclusion: Wear and tear."));
  assert.equal(comparisonSummary(r), "1 quote from 1 participating insurer compared.");
  assert.equal(r.engineVersion, ENGINE_VERSION);
});

test("all expired/declined/withdrawn/accepted: nothing to rank", () => {
  const r = compareQuotes([
    quote({ id: "1", status: "expired" }),
    quote({ id: "2", status: "declined" }),
    quote({ id: "3", status: "withdrawn" }),
    quote({ id: "4", status: "accepted" }),
    quote({ id: "5", status: "expired", paidPlacement: true }),
  ]);
  assert.equal(r.ranked.length, 0);
  assert.equal(r.productsCompared, 0);
  assert.equal(r.insurersCompared, 0);
  assert.equal(r.paidPlacements.length, 0, "a paid placement that is not live is not shown either");
  assert.deepEqual(r.materialExclusions, []);
  assert.equal(comparisonSummary(r), "0 quotes from 0 participating insurers compared.");
});

test("empty input is safe", () => {
  const r = compareQuotes([]);
  assert.deepEqual(r.ranked, []);
  assert.deepEqual(r.criteria, DEFAULT_PRIORITIES);
});

test("ties: identical quotes get no excess/coverage/benefit labels and only one recommendation", () => {
  const r = compareQuotes([quote({ id: "a" }), quote({ id: "b" }), quote({ id: "c" })]);
  assert.equal(r.ranked.length, 3);
  const recommended = r.ranked.filter((s) => s.labels.includes("recommended"));
  assert.equal(recommended.length, 1);
  assert.equal(r.ranked.filter((s) => s.labels.includes("lowest_premium")).length, 1, "lowest premium is still awarded once");
  for (const s of r.ranked) {
    assert.ok(!s.labels.includes("lowest_excess"), "equal excesses: no lowest_excess label");
    assert.ok(!s.labels.includes("broadest_coverage"), "equal coverage: no broadest_coverage label");
    assert.ok(!s.labels.includes("highest_benefit"), "equal benefit: no highest_benefit label");
    assert.equal(s.score, 1);
  }
});

test("two insurers, same insurer twice: insurersCompared counts distinct insurers", () => {
  const r = compareQuotes([quote({ id: "1", insurerId: "x" }), quote({ id: "2", insurerId: "x", premium: 900 }), quote({ id: "3", insurerId: "y", premium: 950 })]);
  assert.equal(r.productsCompared, 3);
  assert.equal(r.insurersCompared, 2);
  assert.equal(r.ranked[0]!.quote.id, "2");
});

test("priorities are normalised and change the winner", () => {
  const cheapThinCover = quote({ id: "cheap", premium: 500, excess: 2000, coverage: [{ key: "a", label: "A", included: true }], waitingPeriodDays: 90 });
  const richCover = quote({ id: "rich", premium: 1500, excess: 200, coverage: [...base.coverage, { key: "c", label: "C", included: true }] });
  const priceFirst = compareQuotes([cheapThinCover, richCover], { price: 10, excess: 0, coverage: 0, benefit: 0, waiting: 0 });
  assert.equal(priceFirst.ranked[0]!.quote.id, "cheap");
  assert.equal(Math.round(Object.values(priceFirst.criteria).reduce((s, x) => s + x, 0) * 1000) / 1000, 1);
  assert.equal(priceFirst.criteria.price, 1);

  const coverFirst = compareQuotes([cheapThinCover, richCover], { price: 0, excess: 1, coverage: 1, benefit: 0, waiting: 1 });
  assert.equal(coverFirst.ranked[0]!.quote.id, "rich");
  assert.ok(coverFirst.ranked[0]!.labels.includes("lowest_excess"));
  assert.ok(coverFirst.ranked[0]!.labels.includes("broadest_coverage"));
  assert.ok(coverFirst.ranked[1]!.labels.includes("lowest_premium"));
  assert.ok(coverFirst.ranked[0]!.reasons.includes("No waiting period."));
  assert.ok(coverFirst.ranked[0]!.reasons.includes("Includes 3 of the listed cover items."));
});

test("estimates and underwriting quotes are compared; paid placements never ranked", () => {
  const r = compareQuotes([
    quote({ id: "est", status: "estimate", premium: 700 }),
    quote({ id: "uw", status: "awaiting_underwriting", premium: 800 }),
    quote({ id: "paid", premium: 100, paidPlacement: true }),
  ]);
  assert.deepEqual(r.ranked.map((s) => s.quote.id), ["est", "uw"]);
  assert.deepEqual(r.paidPlacements.map((q) => q.id), ["paid"]);
  assert.equal(r.productsCompared, 2);
  assert.match(r.disclaimer, /participating insurers only/);
  assert.match(r.disclaimer, /Paid placements are labelled/);
});

test("every label key has human copy and none says a bare 'best'", () => {
  for (const [k, v] of Object.entries(LABELS)) {
    assert.ok(v.length > 3, k);
    assert.doesNotMatch(v, /\bbest\b/i, `${k} must not claim "best"`);
  }
});
