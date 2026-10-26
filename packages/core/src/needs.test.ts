import { test } from "node:test";
import assert from "node:assert/strict";
import { NEEDS_QUESTIONS, assessNeeds } from "./needs.ts";

const slugs = (a: Parameters<typeof assessNeeds>[0]) => assessNeeds(a).suggestions.map((s) => s.slug);
const priority = (a: Parameters<typeof assessNeeds>[0], slug: string) => assessNeeds(a).suggestions.find((s) => s.slug === slug)?.priority;

test("no answers: a low-cost personal-accident starting point, no adviser needed", () => {
  const r = assessNeeds({});
  assert.deepEqual(r.suggestions.map((s) => s.slug), ["personal-accident"]);
  assert.equal(r.suggestions[0]!.priority, "consider");
  assert.equal(r.needsAdviser, false);
  assert.equal(r.adviserReason, undefined);
});

test("travel and vehicle are essential and sort before recommended/consider", () => {
  const r = assessNeeds({ assets: ["vehicle"], travel: true, dependants: true, health_cover: "none" });
  assert.deepEqual(r.suggestions.map((s) => `${s.slug}:${s.priority}`), ["motor:essential", "travel:essential", "life-funeral:recommended", "health:consider"]);
  assert.equal(r.needsAdviser, true, "four or more needs → adviser");
  assert.match(r.adviserReason!, /several needs/);
});

test("assets may arrive as a single string", () => {
  assert.deepEqual(slugs({ assets: "vehicle" }), ["motor"]);
});

test("work answers map to the right covers", () => {
  assert.equal(priority({ work: "informal" }, "personal-accident"), "recommended");
  assert.equal(priority({ work: "self_employed" }, "personal-accident"), "recommended");
  assert.equal(priority({ work: "professional" }, "liability"), "recommended");
  assert.ok(!slugs({ work: "employed" }).includes("liability"));
  assert.equal(priority({ advice_on_claims: true }, "liability"), "recommended");
});

test("home: owned is recommended, rented is 'consider', and the first wins when both apply", () => {
  assert.equal(priority({ assets: ["home_owned"] }, "home"), "recommended");
  assert.equal(priority({ assets: ["home_rented"] }, "home"), "consider");
  const both = assessNeeds({ assets: ["home_owned", "home_rented"] });
  assert.equal(both.suggestions.filter((s) => s.slug === "home").length, 1, "deduplicated");
  assert.equal(both.suggestions[0]!.priority, "recommended");
});

test("health: NHIS-only or nothing suggests private health; employer/private plans do not", () => {
  assert.ok(slugs({ health_cover: "nhis_only" }).includes("health"));
  assert.ok(slugs({ health_cover: "none" }).includes("health"));
  assert.ok(!slugs({ health_cover: "employer" }).includes("health"));
  assert.ok(!slugs({ health_cover: "private" }).includes("health"));
});

test("business answers add property cover and always route to an adviser", () => {
  const shop = assessNeeds({ assets: ["shop"] });
  assert.ok(shop.suggestions.some((s) => s.slug === "sme-property"));
  assert.equal(shop.needsAdviser, false, "a shop alone is not a business segment case");

  const owner = assessNeeds({ who: "business" });
  assert.ok(owner.suggestions.some((s) => s.slug === "sme-property"));
  assert.equal(owner.needsAdviser, true);
  assert.match(owner.adviserReason!, /business adviser/);

  assert.equal(assessNeeds({ work: "business_owner" }).needsAdviser, true);
  const cargo = assessNeeds({ assets: ["goods_transit"] });
  assert.ok(cargo.suggestions.some((s) => s.slug === "marine-cargo"));
  assert.equal(cargo.needsAdviser, true);
});

test("'none of these' and false booleans add nothing", () => {
  const r = assessNeeds({ assets: ["none"], travel: false, dependants: false, advice_on_claims: false });
  assert.deepEqual(r.suggestions.map((s) => s.slug), ["personal-accident"]);
});

test("question bank is well-formed", () => {
  const keys = NEEDS_QUESTIONS.map((q) => q.key);
  assert.equal(new Set(keys).size, keys.length, "unique keys");
  for (const q of NEEDS_QUESTIONS) {
    if (q.type === "boolean") assert.equal(q.options, undefined);
    else assert.ok(q.options && q.options.length >= 2, `${q.key} needs options`);
  }
});
