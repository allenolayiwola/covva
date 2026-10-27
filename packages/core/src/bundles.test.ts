import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleQuote, bundleSponsorPlan, parseBundleItems, parseBundleSettings } from "./bundles.ts";

const PACK = {
  items: [
    { category_slug: "life-funeral", required: true },
    { category_slug: "health", required: false },
    { category_slug: "home", required: false },
  ],
  discount_pct: 5,
};

test("parseBundleItems drops malformed entries", () => {
  assert.deepEqual(parseBundleItems([{ category_slug: "health", required: true }, { category_slug: "" }, "x", null, { category_slug: "home", product_code: "HOME-BASIC" }]), [
    { category_slug: "health", product_code: undefined, required: true },
    { category_slug: "home", product_code: "HOME-BASIC", required: false },
  ]);
  assert.deepEqual(parseBundleItems("nope"), []);
});

test("bundleQuote sums priced items, applies the discount and reports gaps", () => {
  const q = bundleQuote(PACK, { "life-funeral": 720, health: 4200, home: null });
  assert.equal(q.subtotal, 4920);
  assert.equal(q.discount, 246);
  assert.equal(q.total, 4674);
  assert.equal(q.complete, true);
  assert.deepEqual(q.missing, ["home"]);
  assert.equal(q.lines[2]!.included, false);
  assert.equal(q.currency, "GHS");
  assert.equal(q.indicative, true);
});

test("bundleQuote: a missing required item makes the quote incomplete; discount clamps", () => {
  const q = bundleQuote({ ...PACK, discount_pct: 250 }, { health: 100 });
  assert.equal(q.complete, false);
  assert.equal(q.discountPct, 100);
  assert.equal(q.total, 0);
  const none = bundleQuote({ items: [], discount_pct: 0 }, {});
  assert.equal(none.total, 0);
  assert.equal(none.complete, true);
});

const CARE_PACK = {
  items: [
    { category_slug: "life-funeral", required: true },
    { category_slug: "health", required: true },
    { category_slug: "personal-accident", required: false },
    { category_slug: "home", required: false },
  ],
  discount_pct: 10,
};
const SETTINGS = parseBundleSettings({ named_members: { role: "parent", min: 1, max: 2 }, cadence: "monthly", payer: "sponsor", per_member_items: ["life-funeral", "health", "personal-accident"] });

test("parseBundleSettings is defensive", () => {
  assert.deepEqual(parseBundleSettings(null), { named_members: null, cadence: "monthly", payer: "sponsor", per_member_items: [] });
  assert.deepEqual(parseBundleSettings({ named_members: { role: "parent", min: 2, max: 1 }, cadence: "weekly", per_member_items: ["x", 3] }).named_members, { role: "parent", min: 2, max: 2 });
  assert.equal(SETTINGS.cadence, "monthly");
});

test("bundleSponsorPlan prices the per-member items once per named parent and the home once, as one monthly amount", () => {
  const plan = bundleSponsorPlan(CARE_PACK, SETTINGS, [
    { name: "Mama", estimates: { "life-funeral": 720, health: 4200, "personal-accident": 300 } },
    { name: "Papa", estimates: { "life-funeral": 840, health: 4800, "personal-accident": null } },
  ], { home: 1500 });
  assert.equal(plan.lines.length, 7);
  assert.equal(plan.lines.filter((l) => l.member === "Papa").length, 3);
  assert.equal(plan.annualSubtotal, 12360);
  assert.equal(plan.annualDiscount, 1236);
  assert.equal(plan.annualTotal, 11124);
  assert.equal(plan.perPeriod, 927);
  assert.equal(plan.cadence, "monthly");
  assert.deepEqual(plan.missing, []);
  assert.equal(plan.complete, true);
  assert.equal(plan.currency, "GHS");
  assert.equal(plan.indicative, true);
});

test("bundleSponsorPlan reports missing required estimates and enforces the number of parents", () => {
  const one = bundleSponsorPlan(CARE_PACK, SETTINGS, [{ name: "Mama", estimates: { "life-funeral": 720 } }]);
  assert.deepEqual(one.missing, ["health"]);
  assert.equal(one.complete, false);
  assert.equal(one.perPeriod, 54);
  assert.throws(() => bundleSponsorPlan(CARE_PACK, SETTINGS, []), /1 to 2 parents/);
  assert.throws(() => bundleSponsorPlan(CARE_PACK, SETTINGS, [{ name: "a", estimates: {} }, { name: "b", estimates: {} }, { name: "c", estimates: {} }]), RangeError);
  const quarterly = bundleSponsorPlan(CARE_PACK, { ...SETTINGS, cadence: "quarterly" }, [{ name: "Mama", estimates: { "life-funeral": 1000, health: 2000 } }]);
  assert.equal(quarterly.perPeriod, 675);
});
