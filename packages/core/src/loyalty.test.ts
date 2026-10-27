import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_LOYALTY_RULES,
  DEFAULT_STACKING_ORDER,
  claimHistory,
  evaluateLoyalty,
  formatTierList,
  howToEarnMore,
  loyaltyFormValues,
  loyaltyRulesFromForm,
  loyaltyTierStatus,
  normaliseLoyaltyRuleSet,
  parseTierList,
  renewalPerks,
  validateLoyaltyRuleSet,
  type HistoryClaim,
  type HistoryPolicy,
  type LoyaltyContext,
  type LoyaltyRule,
  type LoyaltyRuleSet,
} from "./loyalty.ts";

const NOW = new Date("2026-10-27T12:00:00Z");

function ruleSet(rules: LoyaltyRule[], extra: Partial<LoyaltyRuleSet> = {}): LoyaltyRuleSet {
  return { id: "set-1", insurerOrgId: "ins-1", version: 3, maxCombinedPct: 25, stackingOrder: [...DEFAULT_STACKING_ORDER], rules, ...extra };
}

const ALL_ON: LoyaltyRule[] = DEFAULT_LOYALTY_RULES.map((r) => ({ ...r, active: true }));

function ctx(over: Partial<LoyaltyContext> = {}): LoyaltyContext {
  return {
    now: NOW,
    premium: 1000,
    currency: "GHS",
    categorySlug: "motor",
    insurerOrgId: "ins-1",
    isRenewal: false,
    daysBeforeExpiry: null,
    history: { hasHistory: true, claimFreeYears: 0, yearsWithInsurer: 0, yearsOnCovva: 0, externalOnly: false },
    bundleCategories: ["motor"],
    creditBalance: 0,
    telematics: null,
    ...over,
  };
}

test("no history, no bundle, new customer: nothing applies and every rule says why", () => {
  const r = evaluateLoyalty(ruleSet(ALL_ON), ctx({ history: { hasHistory: false, claimFreeYears: 0, yearsWithInsurer: 0, yearsOnCovva: 0, externalOnly: false } }));
  assert.equal(r.lines.length, 0);
  assert.equal(r.totalDiscount, 0);
  assert.equal(r.netPremium, 1000);
  assert.equal(r.skipped.length, ALL_ON.length);
  assert.match(r.skipped.find((s) => s.ruleType === "no_claims")!.reason, /No claims history/);
  assert.match(r.skipped.find((s) => s.ruleType === "early_renewal")!.reason, /renewal only/);
  assert.match(r.skipped.find((s) => s.ruleType === "safe_driver")!.reason, /renewal only/);
  assert.match(r.skipped.find((s) => s.ruleType === "referral_credit")!.reason, /No referral credit/);
  assert.equal(r.summary, "No discounts apply to this quote.");
});

test("external-only history never earns a no-claims discount", () => {
  const r = evaluateLoyalty(ruleSet(ALL_ON), ctx({ history: { hasHistory: false, claimFreeYears: 0, yearsWithInsurer: 0, yearsOnCovva: 0, externalOnly: true } }));
  assert.match(r.skipped.find((s) => s.ruleType === "no_claims")!.reason, /added yourself/);
});

test("no-claims tiers: the highest tier at or below the claim-free years wins; the base premium is untouched", () => {
  const r = evaluateLoyalty(ruleSet(ALL_ON), ctx({ history: { hasHistory: true, claimFreeYears: 4, yearsWithInsurer: 0, yearsOnCovva: 4, externalOnly: false } }));
  const line = r.lines.find((l) => l.ruleType === "no_claims")!;
  assert.equal(line.pct, 20);
  assert.equal(line.amount, 200);
  assert.equal(line.basis, "premium");
  assert.match(line.explanation, /4 claim-free years/);
  assert.equal(r.premium, 1000);
  assert.equal(r.netPremium, 800);
  assert.match(r.summary, /You save GHS 200.00 \(20%\)/);
});

test("stacking: percentages apply to the base premium (never compounded) in stacking order", () => {
  const set = ruleSet(ALL_ON, { maxCombinedPct: 100 });
  const r = evaluateLoyalty(set, ctx({ history: { hasHistory: true, claimFreeYears: 1, yearsWithInsurer: 2, yearsOnCovva: 2, externalOnly: false }, bundleCategories: ["motor", "home"] }));
  assert.deepEqual(r.lines.map((l) => [l.ruleType, l.amount]), [["no_claims", 100], ["loyalty_tier", 20], ["bundle", 50]]);
  assert.equal(r.totalDiscount, 170);
  assert.equal(r.combinedPct, 17);
  assert.equal(r.cappedByMaxCombined, false);
  assert.match(r.lines[1]!.label, /Silver/);
});

test("maximum combined discount: the rule that crosses the cap is cut to it and later rules are skipped", () => {
  const set = ruleSet(ALL_ON, { maxCombinedPct: 12 });
  const r = evaluateLoyalty(set, ctx({ history: { hasHistory: true, claimFreeYears: 1, yearsWithInsurer: 4, yearsOnCovva: 4, externalOnly: false }, bundleCategories: ["motor", "home", "travel"] }));
  assert.deepEqual(r.lines.map((l) => [l.ruleType, l.amount, l.capped]), [["no_claims", 100, false], ["loyalty_tier", 20, true]]);
  assert.match(r.lines[1]!.capNote ?? "", /12%/);
  assert.equal(r.totalDiscount, 120);
  assert.equal(r.cappedByMaxCombined, true);
  assert.match(r.skipped.find((s) => s.ruleType === "bundle")!.reason, /already reached/);
});

test("per-rule caps: max_pct and max_amount reduce a line and say so", () => {
  const rules: LoyaltyRule[] = [
    { key: "nc", type: "no_claims", active: true, tiers: [{ years: 1, pct: 30 }], max_pct: 10 },
    { key: "b", type: "bundle", active: true, pct: 10, max_amount: 25 },
  ];
  const r = evaluateLoyalty(ruleSet(rules, { maxCombinedPct: 50 }), ctx({ history: { hasHistory: true, claimFreeYears: 2, yearsWithInsurer: 0, yearsOnCovva: 2, externalOnly: false }, bundleCategories: ["motor", "home"] }));
  assert.equal(r.lines[0]!.pct, 10);
  assert.equal(r.lines[0]!.amount, 100);
  assert.match(r.lines[0]!.capNote ?? "", /Capped at 10%/);
  assert.equal(r.lines[1]!.amount, 25);
  assert.match(r.lines[1]!.capNote ?? "", /GHS 25.00/);
});

test("overlapping rules of the same type: the first in stacking order wins, the other is skipped", () => {
  const rules: LoyaltyRule[] = [
    { key: "b_old", type: "bundle", active: true, pct: 5, min_categories: 2 },
    { key: "b_new", type: "bundle", active: true, pct: 8, min_categories: 2 },
  ];
  const r = evaluateLoyalty(ruleSet(rules), ctx({ bundleCategories: ["motor", "home"] }));
  assert.equal(r.lines.length, 1);
  assert.equal(r.lines[0]!.ruleKey, "b_new"); // keys sort within a type
  assert.match(r.skipped.find((s) => s.ruleKey === "b_old")!.reason, /already applied/);
});

test("expired and not-yet-effective rules and rule sets are skipped with the dates", () => {
  const rules: LoyaltyRule[] = [
    { key: "ended", type: "bundle", active: true, pct: 5, effective_to: "2026-09-30" },
    { key: "future", type: "early_renewal", active: true, pct: 3, effective_from: "2027-01-01" },
    { key: "off", type: "bundle", active: false, pct: 5 },
  ];
  const r = evaluateLoyalty(ruleSet(rules), ctx({ bundleCategories: ["motor", "home"], isRenewal: true, daysBeforeExpiry: 30 }));
  assert.equal(r.lines.length, 0);
  assert.match(r.skipped.find((s) => s.ruleKey === "ended")!.reason, /ended on 2026-09-30/);
  assert.match(r.skipped.find((s) => s.ruleKey === "future")!.reason, /starts on 2027-01-01/);
  assert.match(r.skipped.find((s) => s.ruleKey === "off")!.reason, /switched off/);
  const expiredSet = evaluateLoyalty(ruleSet(ALL_ON, { effectiveTo: "2026-01-01" }), ctx({ bundleCategories: ["motor", "home"] }));
  assert.equal(expiredSet.lines.length, 0);
  assert.ok(expiredSet.skipped.every((s) => s.reason === "Rule set is not in effect"));
});

test("early renewal needs the window; safe driver needs motor, a renewal, enough months and the score", () => {
  const base = ctx({ isRenewal: true, daysBeforeExpiry: 10 });
  const late = evaluateLoyalty(ruleSet(ALL_ON), base);
  assert.match(late.skipped.find((s) => s.ruleType === "early_renewal")!.reason, /at least 14 days/);
  const early = evaluateLoyalty(ruleSet(ALL_ON), { ...base, daysBeforeExpiry: 21 });
  assert.equal(early.lines.find((l) => l.ruleType === "early_renewal")!.amount, 30);

  const noData = evaluateLoyalty(ruleSet(ALL_ON), { ...base, telematics: { averageScore: 95, monthsOfData: 2 } });
  assert.match(noData.skipped.find((s) => s.ruleType === "safe_driver")!.reason, /2 scored months so far; 3 needed/);
  const lowScore = evaluateLoyalty(ruleSet(ALL_ON), { ...base, telematics: { averageScore: 60, monthsOfData: 6 } });
  assert.match(lowScore.skipped.find((s) => s.ruleType === "safe_driver")!.reason, /below the threshold/);
  const good = evaluateLoyalty(ruleSet(ALL_ON), { ...base, telematics: { averageScore: 92, monthsOfData: 6 } });
  const line = good.lines.find((l) => l.ruleType === "safe_driver")!;
  assert.equal(line.pct, 10);
  assert.equal(line.amount, 100);
  assert.match(line.explanation, /Average driving score 92 over 6 months/);
  const home = evaluateLoyalty(ruleSet(ALL_ON), { ...base, categorySlug: "home", telematics: { averageScore: 92, monthsOfData: 6 } });
  assert.match(home.skipped.find((s) => s.ruleType === "safe_driver")!.reason, /motor cover only/);
});

test("referral credits: fixed amount, bounded by balance, the rule cap and what is left to pay; outside the % cap", () => {
  const set = ruleSet(ALL_ON, { maxCombinedPct: 10 });
  const r = evaluateLoyalty(set, ctx({ history: { hasHistory: true, claimFreeYears: 1, yearsWithInsurer: 0, yearsOnCovva: 1, externalOnly: false }, creditBalance: 500 }));
  const credit = r.lines.find((l) => l.ruleType === "referral_credit")!;
  assert.equal(credit.basis, "credit");
  assert.equal(credit.pct, null);
  assert.equal(credit.amount, 100); // 10% of the premium cap
  assert.equal(credit.capped, true);
  assert.match(credit.capNote ?? "", /10% of the premium/);
  assert.equal(r.totalDiscount, 200); // 100 no-claims (combined cap 10%) + 100 credit
  assert.equal(r.combinedPct, 10);

  const tiny = evaluateLoyalty(ruleSet([{ key: "rc", type: "referral_credit", active: true, max_pct: 100 }]), ctx({ premium: 40, creditBalance: 75.5 }));
  assert.equal(tiny.lines[0]!.amount, 40);
  assert.equal(tiny.netPremium, 0);
  assert.match(tiny.lines[0]!.capNote ?? "", /amount left to pay/);

  const none = evaluateLoyalty(ruleSet([{ key: "rc", type: "referral_credit", active: true, max_pct: 100 }]), ctx({ creditBalance: 0 }));
  assert.equal(none.lines.length, 0);
});

test("zero premium: nothing to discount", () => {
  const r = evaluateLoyalty(ruleSet(ALL_ON), ctx({ premium: 0, bundleCategories: ["motor", "home"] }));
  assert.equal(r.lines.length, 0);
  assert.ok(r.skipped.every((s) => s.reason === "No premium to discount"));
});

test("evaluation is deterministic and rounds to the pesewa", () => {
  const c = ctx({ premium: 333.33, history: { hasHistory: true, claimFreeYears: 3, yearsWithInsurer: 0, yearsOnCovva: 3, externalOnly: false } });
  const a = evaluateLoyalty(ruleSet(ALL_ON), c);
  const b = evaluateLoyalty(ruleSet(ALL_ON), c);
  assert.deepEqual(a, b);
  assert.equal(a.lines[0]!.amount, 66.67);
  assert.equal(a.netPremium, 266.66);
});

test("claim history: consecutive claim-free years, tenure, external policies ignored", () => {
  const policies: HistoryPolicy[] = [
    { id: "p1", status: "renewed", coverStart: "2022-10-01", coverEnd: "2023-09-30", externalSource: false, insurerOrgId: "ins-1" },
    { id: "p2", status: "renewed", coverStart: "2023-10-01", coverEnd: "2024-09-30", externalSource: false, insurerOrgId: "ins-1" },
    { id: "p3", status: "renewed", coverStart: "2024-10-01", coverEnd: "2025-09-30", externalSource: false, insurerOrgId: "ins-2" },
    { id: "p4", status: "active", coverStart: "2025-10-01", coverEnd: "2026-09-30", externalSource: false, insurerOrgId: "ins-2" },
    { id: "x", status: "active", coverStart: "2015-01-01", coverEnd: "2027-01-01", externalSource: true, insurerOrgId: null },
  ];
  const noClaims = claimHistory(policies, [], "ins-1", NOW);
  assert.equal(noClaims.hasHistory, true);
  assert.equal(noClaims.claimFreeYears, 4, "the fifth year back has only 26 days of cover");
  assert.equal(noClaims.yearsWithInsurer, 4);
  assert.equal(noClaims.yearsOnCovva, 4);
  assert.equal(noClaims.externalOnly, false);

  const claims: HistoryClaim[] = [
    { policyId: "p3", status: "paid", incidentAt: "2025-03-10T08:00:00Z", createdAt: "2025-03-11T08:00:00Z" },
    { policyId: "p4", status: "withdrawn", incidentAt: "2026-05-01T08:00:00Z", createdAt: "2026-05-01T08:00:00Z" },
    { policyId: "x", status: "paid", incidentAt: "2026-06-01T08:00:00Z", createdAt: "2026-06-01T08:00:00Z" },
  ];
  const withClaim = claimHistory(policies, claims, "ins-2", NOW);
  assert.equal(withClaim.claimFreeYears, 1, "the paid claim in March 2025 ends the streak; withdrawn and external-policy claims are ignored");
  assert.equal(withClaim.yearsWithInsurer, 2);

  const gap = claimHistory([policies[0]!, policies[3]!], [], "ins-1", NOW);
  assert.equal(gap.claimFreeYears, 1, "a year without cover stops the count");
  const capped = claimHistory([{ id: "long", status: "active", coverStart: "2015-01-01", coverEnd: "2027-01-01", externalSource: false, insurerOrgId: "ins-1" }], [], "ins-1", NOW);
  assert.equal(capped.claimFreeYears, 5, "capped at MAX_CLAIM_FREE_YEARS");
  const overlap = claimHistory(
    [
      { id: "m", status: "active", coverStart: "2026-01-01", coverEnd: "2026-04-10", externalSource: false, insurerOrgId: "ins-1" },
      { id: "h", status: "active", coverStart: "2026-01-01", coverEnd: "2026-04-10", externalSource: false, insurerOrgId: "ins-1" },
    ],
    [],
    "ins-1",
    NOW,
  );
  assert.equal(overlap.claimFreeYears, 0, "two policies over the same 100 days are not 200 days of cover");

  const externalOnly = claimHistory([policies[4]!], [], null, NOW);
  assert.deepEqual(externalOnly, { hasHistory: false, claimFreeYears: 0, yearsWithInsurer: 0, yearsOnCovva: 0, externalOnly: true });
  assert.equal(claimHistory([], [], null, NOW).hasHistory, false);
  const pending = claimHistory([{ id: "n", status: "pending_issuance", coverStart: "2026-10-01", coverEnd: "2027-09-30", externalSource: false, insurerOrgId: "ins-1" }], [], "ins-1", NOW);
  assert.equal(pending.hasHistory, false, "cover that never started is not history");
});

test("validation mirrors the database guard", () => {
  assert.deepEqual(validateLoyaltyRuleSet(ruleSet(ALL_ON)), []);
  assert.deepEqual(validateLoyaltyRuleSet(ruleSet(DEFAULT_LOYALTY_RULES)), []);
  const bad = validateLoyaltyRuleSet(
    ruleSet(
      [
        { key: "Bad Key", type: "bundle", active: true, pct: 150 },
        { key: "nc", type: "no_claims", active: true, tiers: [] },
        { key: "nc", type: "loyalty_tier", active: false, effective_from: "2026-12-01", effective_to: "2026-01-01" },
        { key: "er", type: "early_renewal", active: true, pct: 3, days_before_expiry: 500 },
        { key: "rc", type: "referral_credit", active: true },
      ],
      { maxCombinedPct: 120, stackingOrder: ["bundle", "bundle"] },
    ),
  );
  assert.ok(bad.some((e) => e.includes("maximum combined")));
  assert.ok(bad.some((e) => e.includes("twice")));
  assert.ok(bad.some((e) => e.includes("2–40 lower-case")));
  assert.ok(bad.some((e) => e.includes("between 0 and 100")));
  assert.ok(bad.some((e) => e.includes("duplicate key")));
  assert.ok(bad.some((e) => e.includes("at least one tier")));
  assert.ok(bad.some((e) => e.includes("end date is before")));
  assert.ok(bad.some((e) => e.includes("1–120 days")));
  assert.ok(bad.some((e) => e.includes("credit redemption")));
});

test("normalisation from a database row and tier list parsing round-trip", () => {
  const set = normaliseLoyaltyRuleSet({
    id: "abc",
    insurer_org_id: null,
    version: "4",
    max_combined_pct: "30",
    stacking_order: ["bundle", "nonsense", "no_claims"],
    rules: [{ key: " NC ", type: "no_claims", active: true, tiers: [{ years: "1", pct: "10" }, { pct: 5 }], effective_from: "2026-01-01T00:00:00Z" }, { key: "x", type: "unknown" }],
    effective_from: "2026-01-01",
  });
  assert.equal(set.insurerOrgId, null);
  assert.equal(set.version, 4);
  assert.equal(set.maxCombinedPct, 30);
  assert.deepEqual(set.stackingOrder, ["bundle", "no_claims"]);
  assert.equal(set.rules[0]!.key, "nc");
  assert.deepEqual(set.rules[0]!.tiers, [{ years: 1, score: undefined, pct: 10, name: undefined }]);
  assert.equal(set.rules[0]!.effective_from, "2026-01-01");
  assert.equal(set.rules[1]!.active, false);
  assert.deepEqual(normaliseLoyaltyRuleSet({ rules: [] }).stackingOrder, [...DEFAULT_STACKING_ORDER]);

  const tiers = parseTierList("1:10, 3:20 (Gold), nonsense, 2:15", "years");
  assert.deepEqual(tiers, [{ years: 1, pct: 10 }, { years: 2, pct: 15 }, { years: 3, pct: 20, name: "Gold" }]);
  assert.equal(formatTierList(tiers, "years"), "1:10, 2:15, 3:20 (Gold)");
  assert.deepEqual(parseTierList("75=5; 90=10", "score"), [{ score: 75, pct: 5 }, { score: 90, pct: 10 }]);
});

test("customer page helpers: tier status, renewal perks and plain tips", () => {
  const set = ruleSet(ALL_ON);
  assert.deepEqual(loyaltyTierStatus(set, 1), { name: "Starter", pct: 0, years: 1, next: { name: "Silver", years: 2, pct: 2, yearsToGo: 1 } });
  assert.deepEqual(loyaltyTierStatus(set, 5), { name: "Gold", pct: 4, years: 5, next: null });
  assert.equal(loyaltyTierStatus(ruleSet([]), 5), null);

  const perks = renewalPerks(set, { ...ctx({ history: { hasHistory: true, claimFreeYears: 2, yearsWithInsurer: 0, yearsOnCovva: 2, externalOnly: false } }), daysBeforeExpiry: 40 });
  assert.ok(perks.find((p) => p.ruleType === "no_claims")!.qualifies);
  assert.ok(perks.find((p) => p.ruleType === "early_renewal")!.qualifies);
  assert.equal(perks.find((p) => p.ruleType === "safe_driver")!.qualifies, false);
  assert.match(perks.find((p) => p.ruleType === "safe_driver")!.text, /Not enrolled/);
  assert.equal(perks.find((p) => p.ruleType === "referral_credit")!.qualifies, false);

  const tips = howToEarnMore(set);
  assert.equal(tips.length, 6);
  assert.ok(tips.some((t) => t.includes("claim-free year")));
  assert.deepEqual(howToEarnMore(ruleSet(DEFAULT_LOYALTY_RULES)), [], "nothing to promise while every rule is off");
});

test("rule editor form round-trips through the flat field names", () => {
  const values = loyaltyFormValues(ruleSet(ALL_ON, { maxCombinedPct: 30, effectiveFrom: "2026-11-01" }));
  assert.equal(values.max_combined_pct, "30");
  assert.equal(values.no_claims_active, "on");
  assert.equal(values.no_claims_tiers, "1:10, 2:15, 3:20, 5:25");
  assert.equal(values.loyalty_tier_tiers, "2:2 (Silver), 4:4 (Gold)");
  assert.equal(values.safe_driver_tiers, "75:5, 90:10");
  const parsed = loyaltyRulesFromForm({ ...values, bundle_active: "", early_renewal_pct: "4", note: " Q4 rules " });
  assert.equal(parsed.maxCombinedPct, 30);
  assert.equal(parsed.effectiveFrom, "2026-11-01");
  assert.equal(parsed.note, "Q4 rules");
  assert.equal(parsed.rules.find((r) => r.type === "bundle")!.active, false);
  assert.equal(parsed.rules.find((r) => r.type === "early_renewal")!.pct, 4);
  assert.deepEqual(parsed.rules.find((r) => r.type === "safe_driver")!.categories, ["motor"]);
  assert.deepEqual(validateLoyaltyRuleSet({ maxCombinedPct: parsed.maxCombinedPct, stackingOrder: [...DEFAULT_STACKING_ORDER], rules: parsed.rules }), []);
  const empty = loyaltyRulesFromForm({});
  assert.equal(empty.rules.length, 6);
  assert.ok(empty.rules.every((r) => !r.active));
  assert.equal(empty.maxCombinedPct, 25);
});
