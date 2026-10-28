import { test } from "node:test";
import assert from "node:assert/strict";
import { decideIssuanceMode, isVerificationCode, maskPolicyNumber, reviewWindowEnd, slaEscalationLevel, slaMilestones, verifyUrl } from "./issuance.ts";
import { fitsDelegatedIssuance } from "./underwriting.ts";

const accept = { fits: true, outcome: "accept" as const, reason: "All underwriting rules accept this risk." };
const refer = { fits: false, outcome: "refer" as const, reason: "Referred to the insurer for review: young driver" };
const decline = { fits: false, outcome: "decline" as const, reason: "Declined: vehicle too old" };

test("L2 + accepting rules → delegated issuance with the line's review window", () => {
  const d = decideIssuanceMode({ level: "L2", slaHours: 12, issuanceType: "instant", active: true }, accept);
  assert.equal(d.mode, "delegated");
  assert.equal(d.status, "generating");
  assert.equal(d.slaHours, 12);
});

test("L2 + refer/decline → referred to the insurer's L1 queue with the outcome shown", () => {
  for (const o of [refer, decline]) {
    const d = decideIssuanceMode({ level: "L2", slaHours: 24 }, o);
    assert.equal(d.mode, "insurer_portal");
    assert.equal(d.status, "referred");
    assert.equal(d.reason, o.reason);
  }
  const noOutcome = decideIssuanceMode({ level: "L2" }, null);
  assert.equal(noOutcome.status, "referred");
});

test("L1 / missing / inactive integrations → insurer portal; L3 → API queue; SLA defaults to 24h", () => {
  assert.deepEqual(decideIssuanceMode({ level: "L1", slaHours: 48 }, accept), { mode: "insurer_portal", status: "queued", slaHours: 48, reason: "Insurer issues through its portal." });
  assert.equal(decideIssuanceMode(null, accept).mode, "insurer_portal");
  assert.equal(decideIssuanceMode(undefined).slaHours, 24);
  assert.equal(decideIssuanceMode({ level: "L2", active: false }, accept).mode, "insurer_portal", "an inactive L2 line behaves as L1");
  assert.equal(decideIssuanceMode({ level: "L3", slaHours: 0 }, accept).mode, "api");
  assert.equal(decideIssuanceMode({ level: "L3", slaHours: 0 }).status, "queued");
  assert.equal(decideIssuanceMode({ level: "L2", slaHours: 10_000 }, accept).slaHours, 720, "capped at 30 days");
});

test("works end to end with fitsDelegatedIssuance", () => {
  const rules = [{ name: "Young driver", condition: { field: "driver_age", op: "lt" as const, value: 25 }, outcome: "refer" as const }];
  const fits = fitsDelegatedIssuance(rules, { driver_age: 40 }, "instant");
  assert.equal(decideIssuanceMode({ level: "L2" }, fits).mode, "delegated");
  const young = fitsDelegatedIssuance(rules, { driver_age: 21 }, "instant");
  const d = decideIssuanceMode({ level: "L2" }, young);
  assert.equal(d.status, "referred");
  assert.match(d.reason, /Young driver/);
  const manual = fitsDelegatedIssuance(rules, { driver_age: 40 }, "manual");
  assert.equal(decideIssuanceMode({ level: "L2" }, manual).status, "referred", "manual products are never delegated");
});

test("review window and SLA escalation ladder", () => {
  const issued = new Date("2026-10-26T10:00:00Z");
  assert.equal(reviewWindowEnd(issued, 24).toISOString(), "2026-10-27T10:00:00.000Z");
  assert.equal(reviewWindowEnd(issued, 0).toISOString(), "2026-10-27T10:00:00.000Z", "invalid hours default to 24");

  const started = new Date("2026-10-26T00:00:00Z");
  const due = new Date("2026-10-27T00:00:00Z"); // 24h
  assert.equal(slaEscalationLevel(started, due, new Date("2026-10-26T23:59:00Z")), 0);
  assert.equal(slaEscalationLevel(started, due, due), 1);
  assert.equal(slaEscalationLevel(started, due, new Date("2026-10-27T11:59:00Z")), 1);
  assert.equal(slaEscalationLevel(started, due, new Date("2026-10-27T12:00:00Z")), 2, "due + 50% → Covva ops");
  assert.equal(slaEscalationLevel(started, due, new Date("2026-10-28T00:00:00Z")), 3, "2× due → final breach");
  const m = slaMilestones(started, due);
  assert.equal(m.opsAt.toISOString(), "2026-10-27T12:00:00.000Z");
  assert.equal(m.finalAt.toISOString(), "2026-10-28T00:00:00.000Z");
});

test("verification helpers", () => {
  assert.equal(isVerificationCode("ABCDEFGH23"), true);
  assert.equal(isVerificationCode("abcdefgh23"), true);
  assert.equal(isVerificationCode("ABCDEFGHI2"), false, "I is not in the alphabet");
  assert.equal(isVerificationCode("ABC"), false);
  assert.equal(maskPolicyNumber("CG/MTR/2026/001234"), "••••••••1234");
  assert.equal(maskPolicyNumber("AB12"), "AB12");
  assert.equal(maskPolicyNumber(null), null);
  assert.equal(verifyUrl("https://covva.com.gh/", "ABCDEFGH23"), "https://covva.com.gh/verify?q=ABCDEFGH23");
});
