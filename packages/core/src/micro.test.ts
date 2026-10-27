import { test } from "node:test";
import assert from "node:assert/strict";
import { autoRenewDue, coverWindow, microProducts, microQuoteText, renewalStart, supportedPeriods, SMS_MAX } from "./micro.ts";
import { ratePremium, type RatingRule } from "./rating.ts";

test("ratePremium adds byPeriod only when the version supports short periods", () => {
  const rule = { model: "flat", amount: 730 } as RatingRule;
  const plain = ratePremium(rule, {});
  assert.equal(plain.byPeriod, undefined);
  assert.deepEqual(ratePremium(rule, {}, { periods: ["year"] }), plain, "a yearly-only version is priced exactly as before");
  const r = ratePremium(rule, {}, { periods: ["day", "week", "month", "year"] });
  assert.equal(r.premium, plain.premium);
  assert.deepEqual(r.lines, plain.lines);
  assert.equal(r.byPeriod?.day, 2); // 730 / 365
  assert.equal(r.byPeriod?.week, 14);
  assert.equal(r.byPeriod?.month, 60.83);
  assert.equal(r.byPeriod?.year, 730);
  assert.equal(r.byPeriod?.quarter, undefined);
});

test("period_factors and period minimums from the rating JSON win over pro rata", () => {
  const rule = { model: "flat", amount: 100, period_factors: { day: 0.01, week: 0.05 }, period_min_premium: { week: 6 } } as unknown as RatingRule;
  const r = ratePremium(rule, {}, { periods: ["day", "week", "month"] });
  assert.equal(r.byPeriod?.day, 1); // 100 × 0.01 = 1.00 (default day minimum 1)
  assert.equal(r.byPeriod?.week, 6); // 5.00 floored at the insurer's 6.00 minimum
  assert.equal(r.byPeriod?.month, 8.33);
  const tiny = ratePremium({ model: "flat", amount: 36.5 } as RatingRule, {}, { periods: ["day"] });
  assert.equal(tiny.byPeriod?.day, 1, "default daily minimum premium applies");
  // The annual minimum does not inflate the short periods; loadings do apply.
  const loaded = ratePremium({ model: "flat", amount: 365, loadings: [{ field: "night", equals: true, factor: 2 }] } as RatingRule, { night: true }, { periods: ["day"] });
  assert.equal(loaded.byPeriod?.day, 2);
  const missing = ratePremium({ model: "rate_on_value", value_fields: ["value"], rate: 0.05 } as RatingRule, {}, { periods: ["day"] });
  assert.equal(missing.ok, false);
  assert.equal(missing.byPeriod?.day, 0);
});

test("coverWindow and renewalStart", () => {
  assert.deepEqual(coverWindow("day", "2026-10-26T15:00:00Z"), { startsAt: "2026-10-26T15:00:00.000Z", endsAt: "2026-10-27T15:00:00.000Z" });
  assert.equal(coverWindow("week", "2026-10-26T15:00:00Z").endsAt, "2026-11-02T15:00:00.000Z");
  assert.equal(coverWindow("month", "2026-01-31T00:00:00Z").endsAt, "2026-02-28T00:00:00.000Z");
  assert.equal(coverWindow("quarter", "2026-11-30T00:00:00Z").endsAt, "2027-02-28T00:00:00.000Z");
  assert.equal(coverWindow("year", "2026-01-01T00:00:00Z").endsAt, "2027-01-01T00:00:00.000Z");
  assert.throws(() => coverWindow("day", "nope"), RangeError);
  const now = new Date("2026-10-26T12:00:00Z");
  assert.equal(renewalStart("2026-10-27T15:00:00Z", now).toISOString(), "2026-10-27T15:00:00.000Z");
  assert.equal(renewalStart("2026-10-20T15:00:00Z", now).toISOString(), now.toISOString());
  assert.equal(renewalStart(null, now).toISOString(), now.toISOString());
});

test("autoRenewDue uses a lead time per period", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  assert.equal(autoRenewDue("day", "2026-10-26T14:00:00Z", now), true);
  assert.equal(autoRenewDue("day", "2026-10-26T20:00:00Z", now), false);
  assert.equal(autoRenewDue("week", "2026-10-26T23:00:00Z", now), true);
  assert.equal(autoRenewDue("month", "2026-10-29T12:00:00Z", now), false);
  assert.equal(autoRenewDue("day", "2026-10-20T12:00:00Z", now), false, "long-ended windows are not auto-renewed");
});

test("microProducts filters by audience and sorts by the cheapest daily price", () => {
  const base = { insurerName: "Coastline", micro: true, periods: ["day", "week"], summary: null };
  const cards = microProducts(
    [
      { ...base, versionId: "a", productName: "Trader Stock Cover", audienceTags: ["trader"], byPeriod: { day: 3, week: 18 } },
      { ...base, versionId: "b", productName: "Okada Rider Cover", audienceTags: ["okada", "ride_hailing"], byPeriod: { day: 2.5, week: 15 } },
      { ...base, versionId: "c", productName: "Weekly Artisan", audienceTags: ["artisan"], periods: ["week"], byPeriod: { week: 9 } },
      { ...base, versionId: "d", productName: "Not micro", micro: false, audienceTags: ["okada"], byPeriod: { day: 1 } },
      { ...base, versionId: "e", productName: "Unpriced", audienceTags: ["okada"], byPeriod: {} },
    ],
    null,
  );
  assert.deepEqual(cards.map((c) => c.versionId), ["b", "a", "c"]);
  assert.equal(cards[0]!.fromLabel, "from GH₵ 2.50/day");
  assert.equal(cards[2]!.fromLabel, "from GH₵ 9.00/week");
  assert.deepEqual(cards[0]!.audiences.map((a) => a.label), ["Okada riders", "Ride-hailing drivers"]);
  assert.deepEqual(microProducts(cards, "trader").map((c) => c.versionId), ["a"]);
  assert.equal(microProducts(cards, "unknown-tag").length, 3, "an unknown audience shows everything");
  assert.deepEqual(supportedPeriods(["year", "day", "bogus", "week"]), ["day", "week", "year"]);
});

test("microQuoteText fits an SMS / USSD screen", () => {
  const t = microQuoteText({ productName: "Okada Day Cover", insurerName: "Coastline General", period: "day", amount: 2.5 });
  assert.equal(t, "Okada Day Cover by Coastline General: GHS 2.50 for 1 day. Reply 1 to pay by MoMo. Cover is from the insurer.");
  assert.ok(t.length <= SMS_MAX);
  const long = microQuoteText({ productName: "Comprehensive Personal Accident and Third-Party Liability Cover for Commercial Motorbike Riders ".repeat(2), insurerName: "A Very Long Insurer Name Limited (Ghana) ₵", period: "week", amount: 15, action: "Dial *920*44# to pay." });
  assert.ok(long.length <= SMS_MAX, `${long.length}`);
  assert.match(long, /GHS 15\.00 for 1 week\. Dial \*920\*44# to pay\.$/);
  assert.match(long, /^[\x20-\x7E]+$/);
});
