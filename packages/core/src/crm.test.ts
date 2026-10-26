import { test } from "node:test";
import assert from "node:assert/strict";
import { CRM_STAGES, canMoveStage, leadKindToAccountKind, nextStages, pipelineSummary, taskDueState } from "./crm.ts";

test("stages are ordered Lead → Live with Lost last", () => {
  assert.deepEqual(
    CRM_STAGES.map((s) => s.key),
    ["lead", "contacted", "meeting", "proposal", "agreement_signed", "onboarding", "live", "lost"],
  );
  assert.deepEqual(CRM_STAGES.map((s) => s.order), [0, 1, 2, 3, 4, 5, 6, 7]);
});

test("canMoveStage allows one step forward or back", () => {
  assert.equal(canMoveStage("lead", "contacted").ok, true);
  assert.equal(canMoveStage("contacted", "lead").ok, true);
  assert.equal(canMoveStage("meeting", "proposal").ok, true);
  assert.equal(canMoveStage("lead", "meeting").ok, false);
  assert.equal(canMoveStage("proposal", "lead").ok, false);
  assert.equal(canMoveStage("lead", "lead").ok, false);
});

test("lost is reachable from any open stage, and only re-opened at lead", () => {
  for (const s of ["lead", "contacted", "meeting", "proposal", "agreement_signed", "onboarding"] as const) {
    assert.equal(canMoveStage(s, "lost").ok, true, s);
  }
  assert.equal(canMoveStage("live", "lost").ok, false);
  assert.equal(canMoveStage("lost", "lead").ok, true);
  assert.equal(canMoveStage("lost", "proposal").ok, false);
});

test("live requires a linked organisation", () => {
  assert.equal(canMoveStage("onboarding", "live").ok, false);
  assert.match(canMoveStage("onboarding", "live").reason ?? "", /organisation/);
  assert.equal(canMoveStage("onboarding", "live", { hasOrg: true }).ok, true);
  assert.equal(canMoveStage("live", "onboarding", { hasOrg: true }).ok, true);
});

test("nextStages lists the reachable moves", () => {
  assert.deepEqual(nextStages("lead"), ["contacted", "lost"]);
  assert.deepEqual(nextStages("meeting"), ["proposal", "contacted", "lost"]);
  assert.deepEqual(nextStages("live"), ["onboarding"]);
  assert.deepEqual(nextStages("lost"), ["lead"]);
});

test("pipelineSummary aggregates counts, value, owners and time to live", () => {
  const s = pipelineSummary([
    { stage: "lead", estimated_value: 1000, owner_user_id: "a" },
    { stage: "lead", estimated_value: "250.5", owner_user_id: null },
    { stage: "proposal", estimated_value: 5000, owner_user_id: "a" },
    { stage: "live", estimated_value: 9000, owner_user_id: "b", agreement_signed_at: "2026-01-01T00:00:00Z", live_at: "2026-01-11T00:00:00Z" },
    { stage: "live", estimated_value: null, owner_user_id: "b", agreement_signed_at: "2026-02-01T00:00:00Z", live_at: "2026-02-21T00:00:00Z" },
    { stage: "lost", estimated_value: 100, owner_user_id: "a" },
  ]);
  assert.equal(s.total, 6);
  assert.equal(s.open, 3);
  assert.equal(s.live, 2);
  assert.equal(s.lost, 1);
  assert.equal(s.byStage.length, 8);
  assert.deepEqual(s.byStage.find((x) => x.stage === "lead"), { stage: "lead", label: "Lead", count: 2, value: 1250.5 });
  assert.deepEqual(s.byStage.find((x) => x.stage === "contacted"), { stage: "contacted", label: "Contacted", count: 0, value: 0 });
  // Owners count open accounts only (live/lost excluded); sorted by count then value.
  assert.deepEqual(s.byOwner, [
    { ownerId: "a", count: 2, value: 6000 },
    { ownerId: null, count: 1, value: 250.5 },
  ]);
  assert.equal(s.avgDaysToLive, 15);
  assert.equal(s.winRate, 0.4); // 2 live of 5 non-lost
});

test("pipelineSummary on an empty list", () => {
  const s = pipelineSummary([]);
  assert.equal(s.total, 0);
  assert.equal(s.avgDaysToLive, null);
  assert.equal(s.winRate, null);
  assert.deepEqual(s.byOwner, []);
});

test("leadKindToAccountKind maps partner leads and skips the rest", () => {
  assert.equal(leadKindToAccountKind("insurer"), "insurer");
  assert.equal(leadKindToAccountKind("broker"), "broker");
  assert.equal(leadKindToAccountKind("enterprise"), "embedded_partner");
  assert.equal(leadKindToAccountKind("enterprise", ["Group"]), "group");
  assert.equal(leadKindToAccountKind("enterprise", ["group_scheme"]), "group");
  assert.equal(leadKindToAccountKind("customer"), null);
  assert.equal(leadKindToAccountKind("press"), null);
  assert.equal(leadKindToAccountKind("other"), null);
});

test("taskDueState classifies due dates relative to now", () => {
  const now = new Date("2026-10-26T10:00:00");
  assert.equal(taskDueState(null, now), "none");
  assert.equal(taskDueState("2026-10-25T09:00:00", now), "overdue");
  assert.equal(taskDueState("2026-10-26T23:00:00", now), "today");
  assert.equal(taskDueState("2026-10-27T00:00:00", now), "upcoming");
  assert.equal(taskDueState("not a date", now), "none");
});
