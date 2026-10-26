import { test } from "node:test";
import assert from "node:assert/strict";
import { declaredValue, renewalOptions, underinsuranceCheck, type RenewalEstimate } from "./renewal.ts";

const est = (o: Partial<RenewalEstimate> & { quoteId: string; insurerOrgId: string; premium: number }): RenewalEstimate => ({
  insurerName: `Insurer ${o.insurerOrgId}`,
  status: "ready_to_accept",
  ...o,
});

test("renewalOptions: same-insurer offer, alternatives and savings", () => {
  const r = renewalOptions({ insurerOrgId: "A", premium: 1000, brokerOrgId: "B" }, [
    est({ quoteId: "q1", insurerOrgId: "A", premium: 1050 }),
    est({ quoteId: "q2", insurerOrgId: "C", premium: 900 }),
    est({ quoteId: "q3", insurerOrgId: "D", premium: 1200, status: "estimate" }),
    est({ quoteId: "q4", insurerOrgId: "E", premium: 500, status: "expired" }),
  ]);
  assert.equal(r.sameInsurer?.quoteId, "q1");
  assert.equal(r.sameInsurer?.deltaFromLastYear, 50);
  assert.equal(r.sameInsurer?.deltaPct, 5);
  assert.equal(r.sameInsurer?.oneTap, true);
  assert.deepEqual(r.alternatives.map((a) => a.quoteId), ["q2", "q3"]);
  assert.equal(r.alternatives[1]?.oneTap, false);
  assert.deepEqual(r.savings, { quoteId: "q2", insurerName: "Insurer C", amount: 150, pct: 14.3 });
  assert.equal(r.insurersCompared, 3);
  assert.equal(r.brokerOrgId, "B");
});

test("renewalOptions: insurer did not quote → savings against last year's premium; no premium → no deltas", () => {
  const r = renewalOptions({ insurerOrgId: "A", premium: 1000 }, [est({ quoteId: "q2", insurerOrgId: "C", premium: 800 })]);
  assert.equal(r.sameInsurer, null);
  assert.equal(r.savings?.amount, 200);
  const r2 = renewalOptions({ insurerOrgId: "A", premium: null }, [est({ quoteId: "q1", insurerOrgId: "A", premium: 700 })]);
  assert.equal(r2.sameInsurer?.deltaFromLastYear, null);
  assert.equal(r2.savings, null);
  assert.equal(renewalOptions({ insurerOrgId: "A", premium: 1000 }, []).insurersCompared, 0);
});

test("underinsuranceCheck flags below 85% and suggests a rounded-up value", () => {
  const u = underinsuranceCheck(60_000, 100_000);
  assert.equal(u.underinsured, true);
  assert.equal(u.ratio, 0.6);
  assert.equal(u.suggestedSumInsured, 100_000);
  assert.match(u.reason ?? "", /60%/);
  assert.equal(underinsuranceCheck(90_000, 100_000).underinsured, false);
  assert.equal(underinsuranceCheck(85_000, 100_000).underinsured, false);
  assert.equal(underinsuranceCheck(null, 100_000).ratio, null);
  assert.equal(underinsuranceCheck(50_000, 0).underinsured, false);
  assert.equal(underinsuranceCheck(50_000, 80_250).suggestedSumInsured, 80_500);
});

test("declaredValue reads the category's value fields", () => {
  assert.equal(declaredValue("motor", { vehicle_value: "80000" }), 80000);
  assert.equal(declaredValue("home", { building_value: 300000, contents_value: 50000 }), 350000);
  assert.equal(declaredValue("sme-property", { premises_value: 100000, stock_value: 20000 }), 120000);
  assert.equal(declaredValue("motor", {}), null);
  assert.equal(declaredValue("health", { sum_insured: 5000 }), null);
});
