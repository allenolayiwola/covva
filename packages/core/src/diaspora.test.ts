import { test } from "node:test";
import assert from "node:assert/strict";
import {
  COUNTRY_OPTIONS,
  SPONSOR_COUNTRIES,
  beneficiarySchema,
  canFileProxyClaim,
  consentCode,
  consentGranted,
  consentMessage,
  currencyForCountry,
  familyDashboardSummary,
  giftMessageSchema,
  isSponsorCountry,
  maskGhanaCard,
  normaliseBeneficiaryPhone,
  relationshipLabel,
  sponsorLine,
  timezoneForCountry,
} from "./diaspora.ts";

test("sponsor countries carry a currency and Ghana is the home country", () => {
  assert.equal(SPONSOR_COUNTRIES.length, 9);
  for (const c of SPONSOR_COUNTRIES) assert.match(c.currency, /^[A-Z]{3}$/);
  assert.equal(COUNTRY_OPTIONS[0]!.code, "GH");
  assert.equal(currencyForCountry("GB"), "GBP");
  assert.equal(currencyForCountry("de"), "EUR");
  assert.equal(currencyForCountry("GH"), "GHS");
  assert.equal(currencyForCountry("ZZ"), "GHS");
  assert.equal(timezoneForCountry("GB"), "Europe/London");
  assert.equal(timezoneForCountry(null), "Africa/Accra");
  assert.equal(isSponsorCountry("US"), true);
  assert.equal(isSponsorCountry("GH"), false);
  assert.equal(isSponsorCountry(undefined), false);
});

test("beneficiary phone normalisation accepts Ghana numbers only", () => {
  assert.equal(normaliseBeneficiaryPhone("024 123 4567"), "+233241234567");
  assert.equal(normaliseBeneficiaryPhone("+233 24 123 4567"), "+233241234567");
  assert.equal(normaliseBeneficiaryPhone("233241234567"), "+233241234567");
  assert.equal(normaliseBeneficiaryPhone("+44 7700 900123"), null);
  assert.equal(normaliseBeneficiaryPhone(""), null);
});

test("beneficiarySchema validates and normalises", () => {
  const ok = beneficiarySchema.safeParse({ fullName: "Akua Mensah", relationship: "parent", phone: "0241234567", ghanaCardNumber: "gha123456789-0", email: "" });
  assert.ok(ok.success, JSON.stringify(ok.error?.issues));
  assert.equal(ok.data.phone, "+233241234567");
  assert.equal(ok.data.ghanaCardNumber, "GHA-123456789-0");
  assert.equal(ok.data.email, undefined);

  const bad = beneficiarySchema.safeParse({ fullName: "A", relationship: "cousin", phone: "+447700900123", ghanaCardNumber: "12345" });
  assert.equal(bad.success, false);
  const paths = bad.error!.issues.map((i) => String(i.path[0]));
  assert.ok(paths.includes("fullName"));
  assert.ok(paths.includes("relationship"));
  assert.ok(paths.includes("phone"));
  assert.ok(paths.includes("ghanaCardNumber"));
});

test("Ghana Card masking and relationship labels", () => {
  assert.equal(maskGhanaCard("GHA-123456789-0"), "GHA-•••••6789-0");
  assert.equal(maskGhanaCard(null), null);
  assert.equal(relationshipLabel("sibling"), "Sibling");
  assert.equal(relationshipLabel("x"), "Relative");
});

test("consent code is 6 digits and the message carries it", () => {
  for (let i = 0; i < 20; i++) assert.match(consentCode(), /^\d{6}$/);
  const msg = consentMessage({ sponsorName: "Kofi", beneficiaryName: "Akua Mensah", kind: "data_sharing", code: "123456", link: "https://covva.com.gh/consent/x" });
  assert.match(msg, /Hi Akua, Kofi wants to arrange insurance cover for you/);
  assert.match(msg, /123456/);
  assert.match(msg, /https:\/\/covva\.com\.gh\/consent\/x/);
  assert.ok(msg.length < 320);
});

test("consentGranted and canFileProxyClaim enforce beneficiary consent", () => {
  const consents = [
    { kind: "data_sharing", granted: true, granted_at: "2026-10-01T00:00:00Z" },
    { kind: "proxy_claims", granted: false },
  ];
  assert.equal(consentGranted(consents, "data_sharing"), true);
  assert.equal(consentGranted(consents, "proxy_claims"), false);

  assert.equal(canFileProxyClaim(null, consents).ok, false);
  const draft = canFileProxyClaim({ status: "draft", policy_id: null }, consents);
  assert.equal(draft.ok, false);
  assert.equal(!draft.ok && draft.reason, "not_active");
  const noProxy = canFileProxyClaim({ status: "active", policy_id: "p1" }, consents);
  assert.equal(!noProxy.ok && noProxy.reason, "no_proxy_consent");
  const noData = canFileProxyClaim({ status: "active", policy_id: "p1" }, [{ kind: "proxy_claims", granted: true, granted_at: "2026-10-01T00:00:00Z" }]);
  assert.equal(!noData.ok && noData.reason, "no_data_consent");
  const ok = canFileProxyClaim({ status: "active", policy_id: "p1" }, [
    { kind: "data_sharing", granted: true, granted_at: "2026-10-01T00:00:00Z" },
    { kind: "proxy_claims", granted: true, granted_at: "2026-10-02T00:00:00Z" },
  ]);
  assert.equal(ok.ok, true);
});

test("giftMessageSchema", () => {
  const r = giftMessageSchema.safeParse({ gift: true, giftMessage: "  Happy birthday Mum  ", notifyBeneficiary: false });
  assert.ok(r.success);
  assert.equal(r.data.giftMessage, "Happy birthday Mum");
  assert.equal(r.data.notifyBeneficiary, false);
  assert.equal(giftMessageSchema.parse({}).gift, false);
  assert.equal(giftMessageSchema.safeParse({ gift: true, giftMessage: "x".repeat(501) }).success, false);
  assert.equal(sponsorLine("Kofi", true), "A gift from Kofi");
  assert.equal(sponsorLine("Kofi", false), "Paid for by Kofi");
  assert.equal(sponsorLine(null, false), null);
});

test("familyDashboardSummary: renewals, payments, open claims and cover gaps", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const policies = [
    { id: "p1", status: "active", cover_end: "2026-11-20", premium: 120, currency: "GHS", billing_period: "month", beneficiary_id: "b1" },
    { id: "p2", status: "active", cover_end: "2027-03-01", premium: 900, currency: "GHS", billing_period: "year", beneficiary_id: "b2" },
    { id: "p3", status: "expired", cover_end: "2026-01-01", premium: 500, currency: "GHS", billing_period: "year", beneficiary_id: "b3" },
    { id: "p4", status: "pending_issuance", cover_end: null, premium: 300, currency: "GHS", billing_period: "year", beneficiary_id: "b4" },
  ];
  const claims = [
    { id: "c1", status: "reported", policy_id: "p1" },
    { id: "c2", status: "paid", policy_id: "p2" },
  ];
  const payments = [
    { id: "pay1", status: "succeeded", amount: 120, currency: "GHS", paid_at: "2026-10-01T00:00:00Z", due_at: "2026-10-01" },
    { id: "pay2", status: "scheduled", amount: 120, currency: "GHS", due_at: "2026-11-01T00:00:00Z" },
    { id: "pay3", status: "scheduled", amount: 900, currency: "GHS", due_at: "2027-03-01T00:00:00Z" },
  ];
  const beneficiaries = [
    { id: "b1", full_name: "Akua", consent_status: "granted" },
    { id: "b2", full_name: "Kwame", consent_status: "granted" },
    { id: "b3", full_name: "Ama", consent_status: "granted" },
    { id: "b4", full_name: "Yaw", consent_status: "pending" },
    { id: "b5", full_name: "Efua", consent_status: "declined" },
  ];
  const s = familyDashboardSummary(policies, claims, payments, beneficiaries, now);
  assert.equal(s.activePolicies, 2);
  assert.equal(s.pendingPolicies, 1);
  assert.deepEqual(s.nextRenewal, { policyId: "p1", coverEnd: "2026-11-20", days: 25 });
  assert.equal(s.nextPaymentDue?.paymentId, "pay2");
  assert.equal(s.openClaims, 1);
  assert.equal(s.annualPremiumGHS, 120 * 12 + 900);
  assert.deepEqual(
    s.coverGaps.map((g) => `${g.name}:${g.reason}`),
    ["Ama:no_cover", "Yaw:consent_pending", "Efua:consent_declined"],
  );
  const empty = familyDashboardSummary([], [], [], [], now);
  assert.equal(empty.nextRenewal, null);
  assert.equal(empty.nextPaymentDue, null);
});
