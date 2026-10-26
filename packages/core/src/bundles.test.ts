import { test } from "node:test";
import assert from "node:assert/strict";
import { bundleQuote, parseBundleItems } from "./bundles.ts";

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
