import { test } from "node:test";
import assert from "node:assert/strict";
import { ratePremium, type RatingRule } from "./rating.ts";

// Rules mirror the seeded product_versions.rating shapes in supabase/migrations/*_hardening_and_seed.sql.

test("rate_on_value: sums several value fields and reports missing ones", () => {
  const rule: RatingRule = { model: "rate_on_value", value_fields: ["building_value", "contents_value"], rate: 0.0035, min_premium: 400 };
  const r = ratePremium(rule, { building_value: "300000", contents_value: 50000 });
  assert.equal(r.ok, true);
  assert.equal(r.sumInsured, 350000);
  assert.equal(r.basePremium, Math.round(350000 * 0.0035));
  assert.equal(r.premium, 1225);
  assert.deepEqual(r.missingFields, []);

  const missing = ratePremium(rule, {});
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missingFields, ["building_value", "contents_value"]);
  assert.equal(missing.premium, 400, "minimum premium still applies");
  assert.ok(missing.lines.some((l) => l.label === "Minimum premium applies"));
});

test("rate_on_value: add-ons are charged per unit and appear as a line", () => {
  const rule: RatingRule = {
    model: "rate_on_value",
    value_fields: ["sum_insured"],
    rate: 0.006,
    min_premium: 120,
    addons: [{ field: "hospital_cash_daily", per_unit_annual: 1.4 }],
    loadings: [{ field: "occupation_class", equals: "manual", factor: 1.5, label: "Manual work" }],
  };
  const none = ratePremium(rule, { sum_insured: 50000, hospital_cash_daily: "0", occupation_class: "office" });
  assert.equal(none.premium, 300);
  assert.ok(!none.lines.some((l) => l.label.startsWith("Add-on")));

  const withCash = ratePremium(rule, { sum_insured: 50000, hospital_cash_daily: "100", occupation_class: "manual" });
  // (300 + 100 × 1.4) × 1.5
  assert.equal(withCash.basePremium, 440);
  assert.equal(withCash.premium, 660);
  assert.deepEqual(withCash.appliedLoadings, ["Manual work"]);
  assert.ok(withCash.lines.some((l) => l.label === "Add-on: hospital cash daily" && l.amount === 140));
});

test("per_day: days × travellers × daily rate, destination variant and age loading", () => {
  const rule: RatingRule = {
    model: "per_day",
    days_field: "trip_days",
    persons_field: "travellers",
    daily_rate: 9,
    min_premium: 120,
    variants: { field: "destination_region", factors: { africa: 0.8, schengen: 1, worldwide: 1.7 } },
    loadings: [{ field: "oldest_traveller_age", gt: 65, factor: 1.8, label: "Traveller over 65" }],
  };
  const base = ratePremium(rule, { trip_days: 10, travellers: 2, destination_region: "schengen", oldest_traveller_age: 40 });
  assert.equal(base.premium, 180);
  assert.equal(base.sumInsured, null);
  assert.ok(base.lines[0]!.label.includes("10 days × 2 traveller(s)"));

  const worldwideSenior = ratePremium(rule, { trip_days: "10", travellers: "2", destination_region: "worldwide", oldest_traveller_age: 70 });
  assert.equal(worldwideSenior.premium, Math.round(180 * 1.7 * 1.8));
  assert.deepEqual(worldwideSenior.appliedLoadings, ["Traveller over 65"]);

  const short = ratePremium(rule, { trip_days: 2, travellers: 1, destination_region: "africa" });
  assert.equal(short.premium, 120, "minimum premium");

  const missing = ratePremium(rule, { travellers: 3 });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missingFields, ["trip_days"]);

  const noPersons = ratePremium({ model: "per_day", days_field: "trip_days", daily_rate: 5 }, { trip_days: 3 });
  assert.equal(noPersons.premium, 15, "persons defaults to 1 when no persons_field");
});

test("per_person: at least one member, plan-level variant and age loading", () => {
  const rule: RatingRule = {
    model: "per_person",
    persons_field: "members",
    base: 2400,
    variants: { field: "plan_level", factors: { essential: 0.6, standard: 1, premium: 1.8 } },
    loadings: [{ field: "oldest_member_age", gt: 50, factor: 1.6, label: "Age over 50" }],
  };
  assert.equal(ratePremium(rule, { members: 0, plan_level: "standard", oldest_member_age: 30 }).premium, 2400, "members < 1 counts as 1");
  assert.equal(ratePremium(rule, { members: 3, plan_level: "essential", oldest_member_age: 30 }).premium, Math.round(7200 * 0.6));
  const senior = ratePremium(rule, { members: 2, plan_level: "premium", oldest_member_age: 55 });
  assert.equal(senior.premium, Math.round(4800 * 1.8 * 1.6));
  assert.deepEqual(senior.appliedLoadings, ["Age over 50"]);
  const unknownVariant = ratePremium(rule, { members: 1, plan_level: "platinum" });
  assert.equal(unknownVariant.premium, 2400, "unknown variant key leaves the premium unchanged");
});

test("age_banded: picks the band by age, falls back to the last band, applies smoker loading", () => {
  const rule: RatingRule = {
    model: "age_banded",
    value_field: "sum_insured",
    age_field: "age",
    min_premium: 60,
    bands: [
      { max_age: 30, rate: 0.004 },
      { max_age: 45, rate: 0.007 },
      { max_age: 60, rate: 0.014 },
      { max_age: 120, rate: 0.03 },
    ],
    loadings: [{ field: "smoker", equals: true, factor: 1.5, label: "Smoker" }],
  };
  assert.equal(ratePremium(rule, { sum_insured: 100000, age: 30, smoker: false }).premium, 400, "boundary age belongs to the lower band");
  assert.equal(ratePremium(rule, { sum_insured: 100000, age: 31, smoker: false }).premium, 700);
  assert.equal(ratePremium(rule, { sum_insured: 100000, age: 59, smoker: "false" }).premium, 1400);
  assert.equal(ratePremium(rule, { sum_insured: 100000, age: 130 }).premium, 3000, "beyond the last band uses the last band");
  const smoker = ratePremium(rule, { sum_insured: "100000", age: "40", smoker: "true" });
  assert.equal(smoker.premium, 1050);
  assert.deepEqual(smoker.appliedLoadings, ["Smoker"]);
  assert.equal(smoker.sumInsured, 100000);

  const missing = ratePremium(rule, { sum_insured: 0 });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missingFields, ["sum_insured", "age"]);
  assert.equal(missing.premium, 60);
});

test("flat: fixed amount with optional loadings", () => {
  assert.equal(ratePremium({ model: "flat", amount: 250 }, {}).premium, 250);
  const loaded = ratePremium({ model: "flat", amount: 250, loadings: [{ field: "prior_claims", equals: true, factor: 1.4, label: "Prior claims" }] }, { prior_claims: true });
  assert.equal(loaded.premium, 350);
  assert.equal(loaded.basePremium, 250);
  assert.deepEqual(loaded.lines.map((l) => l.label), ["Flat premium", "Prior claims"]);
});

test("loadings: lt ignores blank values, equals compares loosely, premium is rounded", () => {
  const rule: RatingRule = {
    model: "rate_on_value",
    value_fields: ["vehicle_value"],
    rate: 0.04,
    loadings: [
      { field: "driver_age", lt: 25, factor: 1.2, label: "Young driver" },
      { field: "claims_last_3_years", gt: 1, factor: 1.25, label: "Claims history" },
      { field: "use", equals: "commercial", factor: 1.3 },
    ],
  };
  const blankAge = ratePremium(rule, { vehicle_value: 10001, driver_age: "", claims_last_3_years: "2", use: "COMMERCIAL" });
  assert.deepEqual(blankAge.appliedLoadings, ["Claims history"], "blank age never counts as < 25; equals is case-sensitive");
  assert.equal(blankAge.premium, Math.round(10001 * 0.04 * 1.25));
  assert.equal(Number.isInteger(blankAge.premium), true);

  const unlabeled = ratePremium(rule, { vehicle_value: 10000, use: "commercial" });
  assert.deepEqual(unlabeled.appliedLoadings, ["use"], "loadings without a label fall back to the field name");
});
