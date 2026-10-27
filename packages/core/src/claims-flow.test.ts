import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CLAIM_TIMELINE,
  MAX_VIDEO_BYTES,
  MAX_VIDEO_SECONDS,
  addWorkingDays,
  allowedUploadKinds,
  canMessage,
  claimStageIndex,
  nextExpectedStep,
  partnerKindsFor,
  validateClaimVideo,
} from "./claims-flow.ts";

test("timeline has five stages and every open status maps to one", () => {
  assert.deepEqual(CLAIM_TIMELINE.map((s) => s.key), ["reported", "acknowledged", "assessing", "decision", "payment"]);
  for (const st of ["reported", "delivered_to_insurer", "acknowledged", "under_assessment", "info_requested", "approved", "partially_approved", "rejected", "paid", "closed"] as const) {
    assert.ok(claimStageIndex(st) >= 0, `${st} mapped`);
  }
  assert.equal(claimStageIndex("draft"), -1);
  assert.equal(claimStageIndex("withdrawn"), -1);
});

test("working days skip weekends", () => {
  // Friday 2026-10-23 + 1 working day = Monday 2026-10-26
  const fri = new Date("2026-10-23T10:00:00Z");
  assert.equal(addWorkingDays(fri, 1).toISOString().slice(0, 10), "2026-10-26");
  assert.equal(addWorkingDays(fri, 5).toISOString().slice(0, 10), "2026-10-30");
});

test("a reported claim expects acknowledgement within 24 hours of the report", () => {
  const now = new Date("2026-10-20T12:00:00Z");
  const step = nextExpectedStep({ status: "reported", reported_at: "2026-10-20T09:00:00Z" }, [], now);
  assert.equal(step.stage?.key, "acknowledged");
  assert.equal(step.expectedBy?.toISOString(), "2026-10-21T09:00:00.000Z");
  assert.equal(step.overdue, false);
  assert.equal(step.done, false);
  assert.match(step.message, /within 24 hours/);
});

test("overdue acknowledgement is flagged; events win over claim timestamps", () => {
  const now = new Date("2026-10-23T12:00:00Z");
  const step = nextExpectedStep({ status: "reported", reported_at: "2026-10-20T09:00:00Z" }, [{ to_status: "reported", created_at: "2026-10-21T09:00:00Z" }], now);
  assert.equal(step.expectedBy?.toISOString(), "2026-10-22T09:00:00.000Z");
  assert.equal(step.overdue, true);
  assert.match(step.message, /longer than expected/);
});

test("acknowledged → assessment expected in 5 working days; assessment → decision never implies approval", () => {
  const ack = nextExpectedStep({ status: "acknowledged", acknowledged_at: "2026-10-19T09:00:00Z" }, [], new Date("2026-10-19T10:00:00Z"));
  assert.equal(ack.stage?.key, "assessing");
  assert.equal(ack.expectedBy?.toISOString().slice(0, 10), "2026-10-26");
  const assessing = nextExpectedStep({ status: "under_assessment" }, [], new Date());
  assert.equal(assessing.stage?.key, "decision");
  assert.match(assessing.message, /Only the insurer decides/);
  const info = nextExpectedStep({ status: "info_requested" }, [], new Date());
  assert.match(info.message, /more information/);
});

test("approved → payment within 10 working days; final states are done", () => {
  const approved = nextExpectedStep({ status: "approved", decision_at: "2026-10-19T09:00:00Z" }, [], new Date("2026-10-19T10:00:00Z"));
  assert.equal(approved.stage?.key, "payment");
  assert.equal(approved.expectedBy?.toISOString().slice(0, 10), "2026-11-02");
  for (const st of ["paid", "closed", "withdrawn", "rejected"] as const) {
    const s = nextExpectedStep({ status: st }, []);
    assert.equal(s.done, true);
    assert.equal(s.stage, null);
  }
  assert.equal(nextExpectedStep({ status: "draft" }, []).done, false);
});

test("messaging: everyone while open, partners only once closed, never system/ai", () => {
  assert.equal(canMessage("customer", { status: "under_assessment" }), true);
  assert.equal(canMessage("broker", { status: "closed" }), true);
  assert.equal(canMessage("customer", { status: "closed" }), false);
  assert.equal(canMessage("sponsor", { status: "reported" }), true);
  assert.equal(canMessage("system", { status: "reported" }), false);
  assert.equal(canMessage("customer", { status: "draft" }), true);
  assert.equal(canMessage("insurer", { status: "draft" }), false);
});

test("upload kinds narrow after a decision and vanish when paid/declined", () => {
  assert.ok(allowedUploadKinds("reported").includes("claim_video"));
  assert.ok(allowedUploadKinds("info_requested").includes("police_report"));
  assert.deepEqual(allowedUploadKinds("approved"), ["invoice", "receipt", "repair_estimate"]);
  assert.deepEqual(allowedUploadKinds("rejected"), []);
  assert.deepEqual(allowedUploadKinds("paid"), []);
});

test("video limits", () => {
  assert.equal(MAX_VIDEO_SECONDS, 90);
  assert.equal(MAX_VIDEO_BYTES, 50 * 1024 * 1024);
  assert.equal(validateClaimVideo({ mimeType: "video/mp4", sizeBytes: 1000, durationSeconds: 30 }).ok, true);
  assert.equal(validateClaimVideo({ mimeType: "video/mp4", sizeBytes: 1000, durationSeconds: 91 }).ok, false);
  assert.equal(validateClaimVideo({ mimeType: "image/png", sizeBytes: 1000 }).ok, false);
  assert.equal(validateClaimVideo({ mimeType: "video/webm", sizeBytes: MAX_VIDEO_BYTES + 1 }).ok, false);
});

test("partner kinds by category", () => {
  assert.deepEqual(partnerKindsFor("motor", "accident"), ["garage", "towing", "assessor"]);
  assert.deepEqual(partnerKindsFor("motor", "theft"), ["assessor"]);
  assert.deepEqual(partnerKindsFor("health"), ["hospital", "clinic", "pharmacy"]);
  assert.deepEqual(partnerKindsFor("liability"), []);
});

test("buildClaimTimeline marks reached, current and upcoming stages with expected dates", async () => {
  const { buildClaimTimeline } = await import("./claims-flow.ts");
  const rows = buildClaimTimeline({ status: "acknowledged", reported_at: "2026-10-19T09:00:00Z", acknowledged_at: "2026-10-19T15:00:00Z" }, [], new Date("2026-10-20T09:00:00Z"));
  assert.deepEqual(rows.map((r) => r.state), ["done", "current", "upcoming", "upcoming", "upcoming"]);
  assert.equal(rows[0]!.at, "2026-10-19T09:00:00.000Z");
  assert.equal(rows[2]!.expectedBy?.slice(0, 10), "2026-10-26");
  assert.equal(rows[3]!.expectedLabel, "after assessment");
  const declined = buildClaimTimeline({ status: "rejected" }, []);
  assert.equal(declined.length, 4);
  assert.equal(declined[3]!.label, "Decision: declined");
  assert.equal(declined[3]!.state, "done");
});
