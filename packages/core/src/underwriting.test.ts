import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateCondition, evaluateRules, fitsDelegatedIssuance, issuanceLabel, type UnderwritingRule } from "./underwriting.ts";

const rules: UnderwritingRule[] = [
  { id: "age", name: "Vehicle over 15 years", condition: { field: "vehicle_age", op: "gt", value: 15 }, outcome: "decline", message: "Vehicles older than 15 years are not covered.", priority: 10 },
  { id: "value", name: "High value", condition: { field: "vehicle_value", op: "gte", value: 500000 }, outcome: "refer", message: "Vehicles over GH₵ 500,000 need underwriter review.", priority: 20 },
  { id: "use", name: "Commercial in Northern regions", condition: { and: [{ field: "vehicle_use", op: "eq", value: "commercial" }, { field: "region", op: "in", value: ["Northern", "Upper East", "Upper West"] }] }, outcome: "refer", message: "Commercial use in the north is referred.", priority: 30 },
  { id: "claims", name: "Clean record", condition: { field: "claims_last_3_years", op: "eq", value: 0 }, outcome: "accept", priority: 40 },
  { id: "off", name: "Disabled rule", condition: { field: "vehicle_use", op: "exists" }, outcome: "decline", active: false },
];

test("evaluateCondition: operators, nesting and loose typing", () => {
  assert.equal(evaluateCondition({ field: "a", op: "eq", value: 5 }, { a: "5" }), true);
  assert.equal(evaluateCondition({ field: "a", op: "eq", value: "Private" }, { a: "private" }), true);
  assert.equal(evaluateCondition({ field: "a", op: "neq", value: 5 }, { a: 6 }), true);
  assert.equal(evaluateCondition({ field: "a", op: "gt", value: 5 }, { a: "abc" }), false, "non-numeric never compares");
  assert.equal(evaluateCondition({ field: "a", op: "lte", value: 5 }, { a: 5 }), true);
  assert.equal(evaluateCondition({ field: "a", op: "in", value: "x, y" }, { a: "y" }), true, "comma lists work");
  assert.equal(evaluateCondition({ field: "a", op: "not_in", value: ["x"] }, { a: "z" }), true);
  assert.equal(evaluateCondition({ field: "a", op: "not_in", value: ["x"] }, {}), false, "missing value is not 'not in'");
  assert.equal(evaluateCondition({ field: "tags", op: "contains", value: "fleet" }, { tags: ["taxi", "fleet"] }), true);
  assert.equal(evaluateCondition({ field: "notes", op: "contains", value: "modif" }, { notes: "Engine modified" }), true);
  assert.equal(evaluateCondition({ field: "a", op: "exists" }, { a: "" }), false);
  assert.equal(evaluateCondition({ field: "a", op: "missing" }, {}), true);
  assert.equal(evaluateCondition({ field: "driver.age", op: "lt", value: 25 }, { driver: { age: 20 } }), true, "dotted paths");
  assert.equal(evaluateCondition({ or: [{ field: "a", op: "eq", value: 1 }, { not: { field: "b", op: "exists" } }] }, { a: 2 }), true);
  assert.equal(evaluateCondition({ and: [] }, {}), false, "empty AND never matches");
  assert.equal(evaluateCondition(null, {}), false);
  assert.equal(evaluateCondition({ field: "", op: "eq", value: 1 } as never, {}), false);
});

test("evaluateRules: worst outcome wins, inactive rules skipped, matched sorted by priority", () => {
  const clean = evaluateRules(rules, { vehicle_age: 3, vehicle_value: 80000, vehicle_use: "private", region: "Greater Accra", claims_last_3_years: 0 });
  assert.equal(clean.outcome, "accept");
  assert.deepEqual(clean.matched.map((m) => m.id), ["claims"]);
  assert.deepEqual(clean.reasons, []);

  const referred = evaluateRules(rules, { vehicle_age: 3, vehicle_value: 900000, vehicle_use: "commercial", region: "Northern", claims_last_3_years: 0 });
  assert.equal(referred.outcome, "refer");
  assert.deepEqual(referred.matched.map((m) => m.id), ["value", "use", "claims"]);
  assert.deepEqual(referred.reasons, ["Vehicles over GH₵ 500,000 need underwriter review.", "Commercial use in the north is referred."]);

  const declined = evaluateRules(rules, { vehicle_age: "20", vehicle_value: 900000 });
  assert.equal(declined.outcome, "decline");
  assert.deepEqual(declined.reasons, ["Vehicles older than 15 years are not covered."]);

  assert.equal(evaluateRules([], { anything: true }).outcome, "accept", "no rules → accept");
  assert.equal(evaluateRules(rules, { vehicle_use: "private" }).matched.some((m) => m.id === "off"), false);
});

test("fitsDelegatedIssuance: needs an instant/within-hours product and an accept outcome", () => {
  const risk = { vehicle_age: 3, vehicle_value: 80000, vehicle_use: "private", region: "Ashanti" };
  assert.equal(fitsDelegatedIssuance(rules, risk, "instant").fits, true);
  assert.equal(fitsDelegatedIssuance(rules, risk, "within_hours").fits, true);
  const manual = fitsDelegatedIssuance(rules, risk, "manual");
  assert.equal(manual.fits, false);
  assert.match(manual.reason, /issued manually/);
  const refer = fitsDelegatedIssuance(rules, { ...risk, vehicle_value: 600000 }, "instant");
  assert.equal(refer.fits, false);
  assert.equal(refer.outcome, "refer");
  assert.match(refer.reason, /Referred to the insurer/);
  const decline = fitsDelegatedIssuance(rules, { ...risk, vehicle_age: 30 }, "instant");
  assert.equal(decline.outcome, "decline");
  assert.match(decline.reason, /^Declined/);
});

test("issuanceLabel: customer-facing wording", () => {
  assert.equal(issuanceLabel("instant"), "Instant");
  assert.equal(issuanceLabel("within_hours", 24), "Issued within 24 hours");
  assert.equal(issuanceLabel("within_hours", 1), "Issued within 1 hour");
  assert.equal(issuanceLabel("within_hours", 48), "Issued within 2 days");
  assert.equal(issuanceLabel("within_hours", null), "Issued within 24 hours");
  assert.equal(issuanceLabel("manual"), "Issued by the insurer after review");
  assert.equal(issuanceLabel("manual", 72), "Issued by the insurer within 72 hours");
});
