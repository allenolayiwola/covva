import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMBED_DISCLOSURE,
  REFERRAL_CODE_RE,
  attributionWindowDays,
  contrastOk,
  contrastRatio,
  creditBalance,
  decodeReferralCookie,
  encodeReferralCookie,
  frameAncestors,
  maskPhone,
  firstNameOnly,
  normaliseWidgetDomain,
  parseReferralParam,
  partnerRevenueShare,
  referralCode,
  referralUrl,
  rewardFor,
  normaliseRewardConditions,
  widgetSnippet,
  type RewardAttribution,
  type RewardPolicy,
  type RewardRule,
} from "./referrals.ts";

const DAY = 86_400_000;

test("referralCode is 8 base32 characters and uses the given randomness", () => {
  for (let i = 0; i < 50; i++) assert.match(referralCode(), REFERRAL_CODE_RE);
  assert.equal(referralCode(() => new Uint8Array([0, 1, 25, 26, 31, 32, 63, 255])), "ABZ27A77");
});

test("parseReferralParam normalises and rejects junk", () => {
  assert.equal(parseReferralParam(" abcd-efgh "), "ABCDEFGH");
  assert.equal(parseReferralParam(["ABCD2345", "x"]), "ABCD2345");
  assert.equal(parseReferralParam("ABCD0123"), null); // 0 and 1 are not base32
  assert.equal(parseReferralParam("SHORT"), null);
  assert.equal(parseReferralParam(undefined), null);
  assert.equal(parseReferralParam("<script>"), null);
});

test("referral cookie round-trips and expires after the attribution window", () => {
  const now = Date.UTC(2026, 9, 26);
  const lead = "8f14e45f-ceea-4e7a-9b0f-1d2c3b4a5f60";
  const raw = encodeReferralCookie({ code: "ABCDEFGH", source: "widget", firstTouchAt: now - 2 * DAY, leadId: lead });
  assert.equal(raw.split(".").length, 4);
  const back = decodeReferralCookie(raw, now);
  assert.equal(back?.code, "ABCDEFGH");
  assert.equal(back?.source, "widget");
  assert.equal(back?.leadId, lead);
  assert.equal(attributionWindowDays, 30);
  assert.equal(decodeReferralCookie(encodeReferralCookie({ code: "ABCDEFGH", source: "link", firstTouchAt: now - 31 * DAY }), now), null);
  assert.equal(decodeReferralCookie("ABCDEFGH.evil.123", now), null);
  assert.equal(decodeReferralCookie("", now), null);
  assert.equal(encodeReferralCookie({ code: "ABCDEFGH", source: "link", firstTouchAt: now, leadId: "not-a-uuid" }).split(".").length, 3);
});

const customerRule: RewardRule = {
  key: "customer_referral",
  kind: "referral_credit",
  amount: 20,
  active: true,
  conditions: { min_premium: 0, categories: [], first_policy_only: true, holding_days: 14, friend_amount: 20, owner_kinds: ["customer"], expiry_days: 365 },
};
const partnerRule: RewardRule = { key: "partner_revenue_share", kind: "partner_revenue_share", amount: 0, active: true, conditions: { holding_days: 14, owner_kinds: ["distributor"] } };
const activated = new Date("2026-10-01T10:00:00Z");
const policy: RewardPolicy = { status: "active", premium: 1500, categorySlug: "motor", insurerOrgId: "ins-1", activatedAt: activated, isFirstPolicy: true };
const customerAttr: RewardAttribution = { ownerKind: "customer", convertedAt: activated };

test("rewardFor: customer referral pays referrer and friend only after the holding period", () => {
  const early = rewardFor(customerRule, policy, customerAttr, new Date("2026-10-10T00:00:00Z"));
  assert.equal(early.status, "pending");
  if (early.status === "pending") assert.equal(early.until.toISOString().slice(0, 10), "2026-10-15");
  const later = rewardFor(customerRule, policy, customerAttr, new Date("2026-10-16T00:00:00Z"));
  assert.equal(later.status, "eligible");
  if (later.status === "eligible") {
    assert.deepEqual(later.entries, [
      { recipient: "referrer", kind: "referral_credit", amount: 20 },
      { recipient: "friend", kind: "referral_bonus", amount: 20 },
    ]);
    assert.ok(later.expiresAt && later.expiresAt > new Date("2027-10-01"));
  }
});

test("rewardFor: inactive rules, cancelled cover, repeat customers and other categories do not qualify", () => {
  const at = new Date("2026-11-01T00:00:00Z");
  assert.equal(rewardFor({ ...customerRule, active: false }, policy, customerAttr, at).status, "ineligible");
  assert.equal(rewardFor(customerRule, { ...policy, status: "cancelled" }, customerAttr, at).status, "ineligible");
  assert.equal(rewardFor(customerRule, { ...policy, status: "cancelled" }, customerAttr, new Date("2026-10-02")).status, "ineligible");
  assert.equal(rewardFor(customerRule, { ...policy, isFirstPolicy: false }, customerAttr, at).status, "ineligible");
  assert.equal(rewardFor({ ...customerRule, conditions: { ...customerRule.conditions, categories: ["travel"] } }, policy, customerAttr, at).status, "ineligible");
  assert.equal(rewardFor({ ...customerRule, conditions: { ...customerRule.conditions, min_premium: 2000 } }, policy, customerAttr, at).status, "ineligible");
  assert.equal(rewardFor({ ...customerRule, insurerOrgId: "ins-2" }, policy, customerAttr, at).status, "ineligible");
  assert.equal(rewardFor(customerRule, policy, { ...customerAttr, convertedAt: null }, at).status, "ineligible");
  // A distributor link never earns customer credits; a customer link never earns revenue share.
  assert.equal(rewardFor(customerRule, policy, { ownerKind: "distributor", convertedAt: activated }, at).status, "ineligible");
  assert.equal(rewardFor(partnerRule, policy, customerAttr, at).status, "ineligible");
});

test("rewardFor: partner revenue share comes from the platform fee only", () => {
  const at = new Date("2026-11-01T00:00:00Z");
  const attr: RewardAttribution = { ownerKind: "distributor", convertedAt: activated, revenueSharePct: 25, platformFee: 75 };
  const d = rewardFor(partnerRule, policy, attr, at);
  assert.equal(d.status, "eligible");
  if (d.status === "eligible") assert.deepEqual(d.entries, [{ recipient: "partner", kind: "partner_revenue_share", amount: 18.75 }]);
  assert.equal(rewardFor(partnerRule, policy, { ...attr, platformFee: 0 }, at).status, "ineligible");
  assert.equal(rewardFor(partnerRule, policy, attr, new Date("2026-10-05")).status, "pending");
});

test("partnerRevenueShare clamps the percentage and never goes negative", () => {
  assert.equal(partnerRevenueShare(100, 10), 10);
  assert.equal(partnerRevenueShare(33.33, 33.33), 11.11);
  assert.equal(partnerRevenueShare(-50, 10), 0);
  assert.equal(partnerRevenueShare(100, 150), 100);
  assert.equal(partnerRevenueShare(100, Number.NaN), 0);
});

test("normaliseRewardConditions tolerates strings and junk", () => {
  assert.deepEqual(normaliseRewardConditions({ holding_days: "7", categories: ["motor", 3], first_policy_only: true }), {
    min_premium: undefined, categories: ["motor"], first_policy_only: true, holding_days: 7, friend_amount: undefined, owner_kinds: undefined, expiry_days: undefined,
  });
  assert.deepEqual(normaliseRewardConditions(null).categories, undefined);
});

test("creditBalance ignores expired credits and floors at zero", () => {
  const now = new Date("2026-10-26");
  assert.equal(creditBalance([{ kind: "referral_credit", amount: 20, expires_at: "2027-01-01" }, { kind: "referral_bonus", amount: 20, expires_at: "2026-01-01" }, { kind: "redemption", amount: -5 }], now), 15);
  assert.equal(creditBalance([{ kind: "redemption", amount: -5 }], now), 0);
});

test("contrastOk: WCAG AA against white", () => {
  assert.equal(contrastRatio("#000000"), 21);
  assert.equal(contrastRatio("#fff"), 1);
  assert.equal(contrastOk("#00796E"), true); // Covva teal ≈ 5.3:1
  assert.equal(contrastOk("#0B6E4F"), true);
  assert.equal(contrastOk("#FFCC00"), false); // yellow ≈ 1.5:1
  assert.equal(contrastOk("#777777"), false); // 4.48:1 — just under AA
  assert.equal(contrastOk("#767676"), true); // 4.54:1
  assert.equal(contrastOk("teal"), false);
});

test("widget domains, frame-ancestors and the snippet", () => {
  assert.equal(normaliseWidgetDomain("Shop.Example.com/"), "https://shop.example.com");
  assert.equal(normaliseWidgetDomain("https://*.bank.example"), "https://*.bank.example");
  assert.equal(normaliseWidgetDomain("http://evil.example"), null);
  assert.equal(normaliseWidgetDomain("javascript:alert(1)"), null);
  assert.equal(normaliseWidgetDomain("http://localhost:3000"), "http://localhost:3000");
  assert.equal(frameAncestors([]), "frame-ancestors 'none'");
  assert.equal(frameAncestors(["https://a.example", "bad value"]), "frame-ancestors https://a.example");
  assert.equal(widgetSnippet("ABCDEFGH", "motor", "https://covva.com.gh/"), '<script src="https://covva.com.gh/embed/widget.js" data-partner="ABCDEFGH" data-category="motor" async></script>');
  assert.match(EMBED_DISCLOSURE, /^Technology provided by Covva\. Insurance provided by licensed insurers and brokers\.$/);
});

test("referralUrl keeps the landing path relative", () => {
  assert.equal(referralUrl("ABCDEFGH", "/insurance/motor", "https://covva.com.gh"), "https://covva.com.gh/insurance/motor?ref=ABCDEFGH");
  assert.equal(referralUrl("ABCDEFGH", "//evil.example/x", "https://covva.com.gh"), "https://covva.com.gh/?ref=ABCDEFGH");
});

test("partner report masking helpers match the database", () => {
  assert.equal(maskPhone("+233 24 123 4567"), "+233*******67");
  assert.equal(maskPhone("123"), null);
  assert.equal(firstNameOnly("  Ama  Mensah "), "Ama");
  assert.equal(firstNameOnly(null), null);
});
