import { test } from "node:test";
import assert from "node:assert/strict";
import { buildHouseholdView, coverStateFor, daysFromDate, payerFor } from "./household.ts";

const NOW = new Date("2026-11-01T10:00:00Z");
const ME = "user-ama";
const KOFI = "user-kofi"; // sponsor abroad
const mother = { id: "ben-mother", full_name: "Adwoa Mensah", relationship: "parent", consent_status: "granted" };
const son = { id: "ben-son", full_name: "Yaw Mensah", relationship: "child", consent_status: "pending" };
const meAsBeneficiary = "ben-ama"; // Kofi registered Ama as his beneficiary

function view(policies: Parameters<typeof buildHouseholdView>[0]["policies"], extra: Partial<Parameters<typeof buildHouseholdView>[0]> = {}) {
  return buildHouseholdView({ userId: ME, userName: "Ama Mensah", beneficiaries: [mother, son], myBeneficiaryIds: [meAsBeneficiary], policies, sponsorNames: { "pol-health": "Kofi" }, now: NOW, ...extra });
}

test("groups policies by the person covered: me, my members, and what a relative pays for me", () => {
  const v = view([
    { id: "pol-motor", status: "active", cover_end: "2027-03-01", premium: 1200, currency: "GHS", billing_period: "year", customer_id: ME, category_name: "Motor" },
    { id: "pol-health", status: "active", cover_end: "2026-11-20", premium: 150, currency: "GHS", billing_period: "month", customer_id: KOFI, sponsor_user_id: KOFI, beneficiary_id: meAsBeneficiary, category_name: "Health" },
    { id: "pol-funeral", status: "active", cover_end: "2027-06-30", premium: 40, currency: "GHS", billing_period: "month", customer_id: ME, sponsor_user_id: ME, beneficiary_id: mother.id, category_name: "Funeral", nickname: "Mama's funeral plan" },
  ]);
  assert.deepEqual(v.people.map((p) => [p.key, p.policies.length]), [["you", 2], ["member:ben-mother", 1], ["member:ben-son", 0]]);
  const me = v.people[0]!;
  assert.equal(me.name, "Ama Mensah");
  assert.deepEqual(me.policies.map((p) => p.payerLabel), ["Paid for by Kofi", "You pay"], "sooner renewal first, sponsor named");
  assert.equal(v.people[1]!.policies[0]!.title, "Mama's funeral plan");
  assert.equal(v.people[1]!.policies[0]!.payerLabel, "You pay");
  assert.equal(v.summary.sponsoredForYou, 1);
  assert.equal(v.summary.people, 3);
  assert.equal(v.summary.covered, 2);
  assert.equal(v.summary.withoutCover, 1, "the son has no cover");
  assert.equal(v.summary.activePolicies, 3);
  assert.equal(v.summary.expiringSoon, 1);
  assert.deepEqual(v.summary.nextRenewal, { policyId: "pol-health", personName: "Ama Mensah", coverEnd: "2026-11-20", days: 19 });
  assert.equal(v.summary.annualPremiumGHS, 1200 + 150 * 12 + 40 * 12);
});

test("next steps are plain language and depend on consent and cover", () => {
  const v = view([{ id: "p1", status: "expired", cover_end: "2026-01-01", customer_id: ME, category_name: "Motor" }]);
  const [me, mum, kid] = v.people;
  assert.equal(me!.coverState, "lapsed");
  assert.match(me!.nextStep ?? "", /Your cover has ended/);
  assert.equal(mum!.coverState, "none");
  assert.match(mum!.nextStep ?? "", /Adwoa has no live cover/);
  assert.match(kid!.nextStep ?? "", /hasn't consented yet/);
  const declined = view([], { beneficiaries: [{ ...son, consent_status: "declined" }] });
  assert.match(declined.people[1]!.nextStep ?? "", /declined/);
  const covered = view([{ id: "p2", status: "active", cover_end: "2027-11-01", customer_id: ME }]);
  assert.equal(covered.people[0]!.nextStep, null);
  const expiring = view([{ id: "p3", status: "active", cover_end: "2026-11-10", customer_id: ME }]);
  assert.equal(expiring.people[0]!.coverState, "expiring");
  assert.match(expiring.people[0]!.nextStep ?? "", /ends soon/);
});

test("a policy for an unlisted person lands in the 'someone else' bucket and is not counted as a person", () => {
  const v = view([{ id: "p1", status: "active", cover_end: "2027-01-01", customer_id: "user-other", beneficiary_id: "ben-unknown", sponsor_user_id: ME }]);
  const other = v.people.find((p) => p.role === "other");
  assert.ok(other);
  assert.equal(other.policies[0]!.payerLabel, "You pay");
  assert.equal(v.summary.people, 3, "you + two members; the bucket is not a person");
  assert.equal(v.people.at(-1)!.role, "other", "listed last");
});

test("payer wording", () => {
  assert.deepEqual(payerFor({ id: "a", status: "active", customer_id: ME }, ME, null, null), { payer: "you", label: "You pay" });
  assert.deepEqual(payerFor({ id: "a", status: "active", sponsor_user_id: KOFI, gift: true }, ME, "Kofi", null), { payer: "sponsor", label: "A gift from Kofi" });
  assert.deepEqual(payerFor({ id: "a", status: "active", sponsor_user_id: KOFI }, ME, null, null), { payer: "sponsor", label: "Paid for by a family member" });
  assert.deepEqual(payerFor({ id: "a", status: "active", customer_id: "user-mother", beneficiary_id: mother.id }, ME, null, "Adwoa Mensah"), { payer: "them", label: "Paid by Adwoa" });
});

test("cover state: pending beats lapsed, active beyond 30 days is covered", () => {
  assert.equal(coverStateFor([]), "none");
  assert.equal(coverStateFor([{ status: "expired", daysLeft: -10 }]), "lapsed");
  assert.equal(coverStateFor([{ status: "expired", daysLeft: -10 }, { status: "pending_issuance", daysLeft: null }]), "pending");
  assert.equal(coverStateFor([{ status: "active", daysLeft: 5 }]), "expiring");
  assert.equal(coverStateFor([{ status: "active", daysLeft: 5 }, { status: "active", daysLeft: 200 }]), "covered");
  assert.equal(coverStateFor([{ status: "active", daysLeft: null }]), "covered");
  assert.equal(coverStateFor([{ status: "active", daysLeft: -1 }]), "lapsed", "an active policy past its end date is not live cover");
});

test("foreign-currency premiums are left out of the GHS yearly total and daysFromDate counts whole days", () => {
  const v = view([
    { id: "p1", status: "active", cover_end: "2027-01-01", premium: 20, currency: "GBP", billing_period: "month", customer_id: KOFI, sponsor_user_id: KOFI, beneficiary_id: meAsBeneficiary },
    { id: "p2", status: "active", cover_end: "2027-01-01", premium: 10, currency: "GHS", billing_period: "week", customer_id: ME },
  ]);
  assert.equal(v.summary.annualPremiumGHS, 520);
  assert.equal(daysFromDate(NOW, "2026-11-02"), 1);
  assert.equal(daysFromDate(NOW, "2026-10-31T23:00:00Z"), -1);
});

test("a beneficiary record that is about the viewer is folded into 'you'", () => {
  const v = buildHouseholdView({
    userId: ME,
    beneficiaries: [{ id: "ben-self", full_name: "Ama Mensah", relationship: "self", consent_status: "granted", linked_user_id: ME }],
    policies: [{ id: "p1", status: "active", cover_end: "2027-01-01", customer_id: KOFI, sponsor_user_id: KOFI, beneficiary_id: "ben-self" }],
    now: NOW,
  });
  assert.deepEqual(v.people.map((p) => p.key), ["you"]);
  assert.equal(v.people[0]!.name, "You");
  assert.equal(v.people[0]!.policies[0]!.payerLabel, "Paid for by a family member");
});
