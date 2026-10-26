import { test } from "node:test";
import assert from "node:assert/strict";
import { FRAUD_KIND_LABELS, FRAUD_KIND_WEIGHTS, canSeeFraudFlags, fraudKindWeight, scoreFraudFlags } from "./claims-fraud.ts";

test("every fraud kind has a weight and a label", () => {
  for (const kind of Object.keys(FRAUD_KIND_WEIGHTS)) {
    assert.ok(FRAUD_KIND_LABELS[kind as keyof typeof FRAUD_KIND_LABELS]?.label, `${kind} labelled`);
    assert.ok(fraudKindWeight(kind) > 0);
  }
  assert.equal(fraudKindWeight("unknown_kind"), 10);
});

test("no flags → clear with score 0", () => {
  assert.deepEqual(scoreFraudFlags([]), { score: 0, status: "clear", open: 0 });
});

test("a duplicate claim alone reaches the review threshold; a late report alone does not", () => {
  assert.equal(scoreFraudFlags([{ kind: "duplicate_claim" }]).status, "review");
  const late = scoreFraudFlags([{ kind: "late_report" }]);
  assert.equal(late.status, "clear");
  assert.equal(late.score, 15);
});

test("cleared flags stop counting; confirmed flags force the confirmed status; score caps at 100", () => {
  assert.equal(scoreFraudFlags([{ kind: "duplicate_claim", status: "cleared" }]).status, "clear");
  const confirmed = scoreFraudFlags([{ kind: "late_report", status: "confirmed" }]);
  assert.equal(confirmed.status, "confirmed");
  assert.equal(confirmed.open, 0);
  const all = scoreFraudFlags([
    { kind: "duplicate_claim" }, { kind: "document_reuse" }, { kind: "identity_mismatch" }, { kind: "policy_inactive_at_incident" }, { kind: "late_report" }, { kind: "repeat_claimant" },
  ]);
  assert.equal(all.score, 100);
  assert.equal(all.open, 6);
});

test("a stored score overrides the default weight (string numerics from PostgREST too)", () => {
  assert.equal(scoreFraudFlags([{ kind: "late_report", score: "55.5" }]).score, 55.5);
  assert.equal(scoreFraudFlags([{ kind: "late_report", score: null }]).score, 15);
});

test("only the insurer and platform staff see flags", () => {
  assert.equal(canSeeFraudFlags("insurer"), true);
  assert.equal(canSeeFraudFlags("platform"), true);
  assert.equal(canSeeFraudFlags("broker"), false);
  assert.equal(canSeeFraudFlags("customer"), false);
});
