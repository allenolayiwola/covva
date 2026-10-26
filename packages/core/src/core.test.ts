import { test } from "node:test";
import assert from "node:assert/strict";
import { ratePremium } from "./rating.ts";
import { compareQuotes } from "./comparison.ts";
import { assessNeeds } from "./needs.ts";
import { routeRequest } from "./routing.ts";
import { buildDisclosure } from "./disclosure.ts";
import { canTransitionRequest } from "./status.ts";

test("motor rate on value with loadings and minimum", () => {
  const rule = { model: "rate_on_value" as const, value_fields: ["vehicle_value"], rate: 0.04, min_premium: 800,
    variants: { field: "cover_type", factors: { comprehensive: 1, third_party: 0.22 } },
    loadings: [{ field: "use", equals: "commercial", factor: 1.3, label: "Commercial use" }, { field: "driver_age", lt: 25, factor: 1.2, label: "Young driver" }] };
  const r = ratePremium(rule, { vehicle_value: 80000, cover_type: "comprehensive", use: "private", driver_age: 40 });
  assert.equal(r.premium, 3200);
  const y = ratePremium(rule, { vehicle_value: 80000, cover_type: "comprehensive", use: "commercial", driver_age: 22 });
  assert.equal(y.premium, Math.round(3200 * 1.3 * 1.2));
  assert.deepEqual(y.appliedLoadings, ["Commercial use", "Young driver"]);
  const tp = ratePremium(rule, { vehicle_value: 10000, cover_type: "third_party" });
  assert.equal(tp.premium, 800);
});

test("comparison keeps paid placements out of ranking and labels quotes", () => {
  const base = { coverage: [{ key: "a", label: "A", included: true }], exclusions: [], waitingPeriodDays: 0, optionalBenefits: [], sumInsured: 80000 };
  const r = compareQuotes([
    { ...base, id: "1", insurerId: "i1", insurerName: "One", status: "ready_to_accept", premium: 2400, excess: 1000 },
    { ...base, id: "2", insurerId: "i2", insurerName: "Two", status: "ready_to_accept", premium: 2650, excess: 750 },
    { ...base, id: "3", insurerId: "i3", insurerName: "Three", status: "awaiting_underwriting", premium: 1000, excess: 500, paidPlacement: true },
    { ...base, id: "4", insurerId: "i4", insurerName: "Four", status: "declined", premium: 100, excess: 0 },
  ]);
  assert.equal(r.productsCompared, 2);
  assert.equal(r.paidPlacements.length, 1);
  assert.ok(r.ranked.find((s) => s.quote.id === "1")!.labels.includes("lowest_premium"));
  assert.ok(r.ranked.find((s) => s.quote.id === "2")!.labels.includes("lowest_excess"));
  assert.equal(r.ranked.filter((s) => s.labels.includes("recommended")).length, 1);
});

test("needs assessment suggests compulsory motor first", () => {
  const n = assessNeeds({ assets: ["vehicle"], dependants: true });
  assert.equal(n.suggestions[0]!.slug, "motor");
  assert.ok(n.suggestions.some((s) => s.slug === "life-funeral"));
});

test("routing skips unlicensed brokers and prefers primary", () => {
  const d = routeRequest([
    { brokerOrgId: "a", brokerName: "A", priority: 10, isSecondary: false, regions: [], segments: [], dailyCapacity: null, openToday: 0, insurerAccess: 3, licenceValid: false },
    { brokerOrgId: "b", brokerName: "B", priority: 100, isSecondary: true, regions: [], segments: [], dailyCapacity: null, openToday: 0, insurerAccess: 3, licenceValid: true },
    { brokerOrgId: "c", brokerName: "C", priority: 10, isSecondary: false, regions: [], segments: [], dailyCapacity: 5, openToday: 1, insurerAccess: 3, licenceValid: true },
  ], {});
  assert.equal(d.brokerOrgId, "c");
});

test("disclosure names all three parties", () => {
  const t = buildDisclosure({ broker: { name: "Demo Broker", licence: "NIC/1" }, insurer: { name: "Coastline" } });
  assert.match(t, /Technology provided by Insurance Marketplace\. Insurance broking services provided by Demo Broker, NIC licence NIC\/1\. This policy is underwritten and issued by Coastline\./);
});

test("customers cannot jump requests to completed", () => {
  assert.equal(canTransitionRequest("policy_documents", "completed", "customer"), false);
  assert.equal(canTransitionRequest("policy_documents", "completed", "insurer"), true);
});
