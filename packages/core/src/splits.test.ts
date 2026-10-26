import { test } from "node:test";
import assert from "node:assert/strict";
import { computeSplit, feeBreakdownForQuote, pctOfMinor, roundMoney } from "./splits.ts";

const sums = (s: ReturnType<typeof computeSplit>) => roundMoney(s.insurer + s.broker + s.platform);

test("pctOfMinor rounds half up on exact pesewas", () => {
  assert.equal(pctOfMinor(100_000, 12.5), 12_500); // 1,000.00 × 12.5% = 125.00
  assert.equal(pctOfMinor(1, 50), 1); // 0.5 pesewa → rounds up
  assert.equal(pctOfMinor(3, 33.33), 1); // 0.9999 → 1
  assert.equal(pctOfMinor(12_345, 7.5), 926); // 925.875 → 926
  assert.equal(pctOfMinor(12_345, 0), 0);
  assert.equal(pctOfMinor(0, 10), 0);
  assert.equal(pctOfMinor(123_456_789_00, 12.34), 1_523_456_776); // 123,456,789.00 × 12.34% = 15,234,567.7626 → 1523456776 pesewas (large amounts stay exact)
});

test("Covva-sourced + revenue-share broker: Covva takes a share of the commission plus the insurer fee", () => {
  const s = computeSplit({ premium: 1000, taxes: 50, fees: 10, source: "covva", terms: { brokerModel: "revenue_share", revenueSharePct: 20, platformFeePct: 5, brokerCommissionPct: 12.5 } });
  assert.equal(s.total, 1060);
  assert.equal(s.brokerCommission, 125); // 12.5% of the net premium only
  assert.equal(s.revenueShare, 25); // 20% of 125
  assert.equal(s.platformFee, 50); // 5% of 1000
  assert.equal(s.broker, 100);
  assert.equal(s.platform, 75);
  assert.equal(s.insurer, 885);
  assert.equal(sums(s), s.total);
});

test("broker-sourced business: broker keeps its full commission, no revenue share", () => {
  const s = computeSplit({ premium: 1000, source: "broker", terms: { brokerModel: "revenue_share", revenueSharePct: 20, platformFeePct: 5, brokerCommissionPct: 12.5 } });
  assert.equal(s.revenueShare, 0);
  assert.equal(s.broker, 125);
  assert.equal(s.platform, 50); // insurer-side fee only
  assert.equal(s.insurer, 825);
  assert.equal(sums(s), s.total);
});

test("subscription broker: full commission, no revenue share even on Covva-sourced business", () => {
  const s = computeSplit({ premium: 2400, taxes: 0, fees: 0, source: "covva", terms: { brokerModel: "subscription", revenueSharePct: 30, platformFeePct: 2, brokerCommissionPct: 10 } });
  assert.equal(s.broker, 240);
  assert.equal(s.revenueShare, 0);
  assert.equal(s.platform, 48);
  assert.equal(s.insurer, 2112);
  assert.equal(sums(s), s.total);
});

test("insurer-direct order (no broker): no broker share at all", () => {
  const s = computeSplit({ premium: 500, taxes: 25, source: "covva", terms: { brokerModel: null, revenueSharePct: 20, platformFeePct: 4, brokerCommissionPct: 15 } });
  assert.equal(s.broker, 0);
  assert.equal(s.brokerCommission, 0);
  assert.equal(s.platform, 20);
  assert.equal(s.insurer, 505);
  assert.equal(s.total, 525);
});

test("no terms configured: everything settles to the insurer", () => {
  const s = computeSplit({ premium: 999.99, taxes: 0.01, source: "covva", terms: { brokerModel: "revenue_share", revenueSharePct: 0, platformFeePct: 0, brokerCommissionPct: 0 } });
  assert.deepEqual([s.insurer, s.broker, s.platform, s.total], [1000, 0, 0, 1000]);
});

test("rounding: parts always sum to the total and the remainder lands with the insurer", () => {
  const cases = [
    { premium: 333.33, taxes: 33.33, fees: 3.33, pct: [33.33, 7.77, 11.11] },
    { premium: 0.03, taxes: 0, fees: 0, pct: [50, 10, 50] }, // 3 pesewas: commission 2, share 1, fee 0.3 → 0
    { premium: 1234567.89, taxes: 12.34, fees: 0.07, pct: [17.5, 3.3, 12.75] },
    { premium: 10.1, taxes: 0.2, fees: 0.3, pct: [10, 10, 10] }, // float inputs are normalised to pesewas
  ];
  for (const c of cases) {
    const s = computeSplit({ premium: c.premium, taxes: c.taxes, fees: c.fees, source: "covva", terms: { brokerModel: "revenue_share", revenueSharePct: c.pct[0]!, platformFeePct: c.pct[1]!, brokerCommissionPct: c.pct[2]! } });
    assert.equal(sums(s), s.total, JSON.stringify(c));
    assert.equal(roundMoney(s.total), roundMoney(c.premium + c.taxes + c.fees));
    assert.ok(s.insurer >= 0 && s.broker >= 0 && s.platform >= 0);
    // every amount is a whole number of pesewas
    for (const v of [s.insurer, s.broker, s.platform, s.total]) assert.equal(Math.round(v * 100) / 100, v);
    assert.equal(roundMoney(s.broker + s.revenueShare), s.brokerCommission);
    assert.equal(roundMoney(s.platformFee + s.revenueShare), s.platform);
  }
});

test("shares are capped at the amount paid; the insurer is never negative", () => {
  const s = computeSplit({ premium: 100, source: "covva", terms: { brokerModel: "revenue_share", revenueSharePct: 0, platformFeePct: 100, brokerCommissionPct: 100 } });
  assert.equal(s.insurer, 0);
  assert.equal(sums(s), 100);
  assert.throws(() => computeSplit({ premium: -1, source: "covva", terms: { brokerModel: null, revenueSharePct: 0, platformFeePct: 0, brokerCommissionPct: 0 } }), RangeError);
});

test("feeBreakdownForQuote: customer total is unchanged by fees paid by the insurer", () => {
  const b = feeBreakdownForQuote({ premium: 1000, taxes: 50, fees: 10, source: "covva", insurerName: "Coastline General", brokerName: "Demo Broker", terms: { brokerModel: "revenue_share", revenueSharePct: 20, platformFeePct: 5, brokerCommissionPct: 12.5 } });
  assert.equal(b.total, 1060);
  assert.equal(b.premium + b.taxes + b.fees, b.total);
  assert.equal(b.platform_fee, 50);
  assert.equal(b.broker_commission, 125);
  assert.equal(b.currency, "GHS");
  assert.equal(b.source, "covva");
  assert.ok(b.notes.some((n) => n.includes("Demo Broker") && n.includes("paid by Coastline General")));
  assert.ok(b.notes.some((n) => n.includes("platform fee")));
  assert.ok(b.notes.some((n) => n.includes("share of the broker")));

  const direct = feeBreakdownForQuote({ premium: 100, source: "broker", terms: { brokerModel: null, revenueSharePct: 0, platformFeePct: 0, brokerCommissionPct: 0 } });
  assert.equal(direct.broker_commission, 0);
  assert.equal(direct.platform_fee, 0);
  assert.equal(direct.notes.length, 1);
});
