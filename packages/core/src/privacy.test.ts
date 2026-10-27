import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_PRIVACY_DUE_DAYS,
  DELETION_RETAINED,
  DELETION_SCRUBBED,
  EXPORT_SECTIONS,
  MIN_RETENTION_DAYS,
  OPEN_PRIVACY_STATUSES,
  PRIVACY_EXPORT_FORMAT,
  PRIVACY_REQUEST_TYPES,
  PRIVACY_STATUS,
  PRIVACY_TRANSITIONS,
  RETENTION_RULES,
  buildPrivacyExport,
  canTransitionPrivacy,
  canWithdrawPrivacy,
  describeRetainedRecords,
  isTerminalPrivacyStatus,
  normalisePrivacyDueDays,
  normaliseRetentionConfig,
  privacyActionsFor,
  privacyDeadline,
  privacyDueDate,
  privacyExportFileName,
  privacyExportPath,
  redactExportRow,
  retentionDryRun,
  retentionPlan,
  type PrivacyRequestStatus,
  type PrivacyRequestType,
} from "./privacy.ts";

const NOW = new Date("2026-10-27T12:00:00Z");
const TYPES = Object.keys(PRIVACY_REQUEST_TYPES) as PrivacyRequestType[];
const STATUSES = Object.keys(PRIVACY_STATUS) as PrivacyRequestStatus[];

// Mirror of private.privacy_transition_allowed (SQL). If either side changes, this table must change with it.
function sqlTransition(type: PrivacyRequestType, from: PrivacyRequestStatus, to: PrivacyRequestStatus): boolean {
  switch (from) {
    case "submitted":
      return ["identity_verified", "refused", "withdrawn"].includes(to) || (to === "fulfilled" && type === "marketing_opt_out");
    case "identity_verified":
      return ["refused", "withdrawn"].includes(to) || (to === "approved" && type !== "marketing_opt_out") || (to === "export_ready" && type === "access");
    case "approved":
      return to === "withdrawn" || (to === "export_ready" && type === "access") || (to === "fulfilled" && ["correction", "deletion", "objection"].includes(type));
    case "export_ready":
    case "fulfilled":
    case "refused":
      return to === "closed";
    default:
      return false;
  }
}

test("transition table matches the database rule for every type × from × to", () => {
  for (const type of TYPES) for (const from of STATUSES) for (const to of STATUSES) {
    assert.equal(canTransitionPrivacy(type, from, to), sqlTransition(type, from, to), `${type}: ${from} → ${to}`);
  }
});

test("invalid transitions are refused", () => {
  assert.equal(canTransitionPrivacy("access", "submitted", "export_ready"), false, "identity must be verified first");
  assert.equal(canTransitionPrivacy("deletion", "identity_verified", "fulfilled"), false, "deletion needs approval");
  assert.equal(canTransitionPrivacy("access", "approved", "fulfilled"), false, "access ends with an export");
  assert.equal(canTransitionPrivacy("marketing_opt_out", "identity_verified", "approved"), false);
  assert.equal(canTransitionPrivacy("deletion", "fulfilled", "submitted"), false);
  assert.equal(canTransitionPrivacy("access", "export_ready", "approved"), false);
  assert.equal(canTransitionPrivacy("correction", "closed", "submitted"), false);
  assert.equal(canTransitionPrivacy("objection", "withdrawn", "approved"), false);
});

test("closed and withdrawn are terminal; every status has metadata", () => {
  assert.ok(isTerminalPrivacyStatus("closed"));
  assert.ok(isTerminalPrivacyStatus("withdrawn"));
  assert.ok(!isTerminalPrivacyStatus("export_ready"));
  for (const s of STATUSES) {
    assert.ok(PRIVACY_STATUS[s].label);
    assert.ok(s in PRIVACY_TRANSITIONS);
  }
  assert.deepEqual([...OPEN_PRIVACY_STATUSES], ["submitted", "identity_verified", "approved", "export_ready"]);
});

test("marketing opt-out is the only type that can be fulfilled straight from submitted", () => {
  for (const type of TYPES) assert.equal(canTransitionPrivacy(type, "submitted", "fulfilled"), type === "marketing_opt_out", type);
});

test("staff actions follow the workflow", () => {
  assert.deepEqual(privacyActionsFor("access", "submitted"), ["verify_identity", "refuse"]);
  assert.deepEqual(privacyActionsFor("access", "identity_verified"), ["generate_export", "refuse"]);
  assert.deepEqual(privacyActionsFor("access", "export_ready"), ["generate_export", "close"]);
  assert.deepEqual(privacyActionsFor("deletion", "identity_verified"), ["approve", "refuse"]);
  assert.deepEqual(privacyActionsFor("deletion", "approved"), ["fulfil_deletion"]);
  assert.deepEqual(privacyActionsFor("correction", "approved"), ["fulfil"]);
  assert.deepEqual(privacyActionsFor("marketing_opt_out", "fulfilled"), ["close"]);
  assert.deepEqual(privacyActionsFor("objection", "closed"), []);
  // Every action offered is backed by an allowed transition (or keeps the status, for re-generating an export).
  const target: Record<string, PrivacyRequestStatus | null> = {
    verify_identity: "identity_verified", approve: "approved", refuse: "refused", generate_export: "export_ready",
    fulfil: "fulfilled", fulfil_deletion: "fulfilled", close: "closed",
  };
  for (const type of TYPES) for (const s of STATUSES) for (const a of privacyActionsFor(type, s)) {
    const to = target[a]!;
    assert.ok(to === s || canTransitionPrivacy(type, s, to), `${type} ${s}: ${a}`);
  }
});

test("customers can withdraw only before the request is carried out", () => {
  assert.ok(canWithdrawPrivacy("submitted"));
  assert.ok(canWithdrawPrivacy("approved"));
  assert.ok(!canWithdrawPrivacy("export_ready"));
  assert.ok(!canWithdrawPrivacy("fulfilled"));
});

test("due date defaults to 30 days and is configurable within 1–90", () => {
  assert.equal(DEFAULT_PRIVACY_DUE_DAYS, 30);
  assert.equal(privacyDueDate("2026-10-01T09:00:00Z").toISOString(), "2026-10-31T09:00:00.000Z");
  assert.equal(privacyDueDate(new Date("2026-10-01T09:00:00Z"), 21).toISOString(), "2026-10-22T09:00:00.000Z");
  assert.equal(normalisePrivacyDueDays(14), 14);
  assert.equal(normalisePrivacyDueDays("45"), 45);
  assert.equal(normalisePrivacyDueDays(0), 1);
  assert.equal(normalisePrivacyDueDays(400), 90);
  assert.equal(normalisePrivacyDueDays("thirty"), 30);
  assert.equal(normalisePrivacyDueDays(null), 30);
  assert.equal(normalisePrivacyDueDays(7.5), 30);
});

test("deadline: only pending requests are overdue", () => {
  assert.deepEqual(privacyDeadline({ status: "submitted", due_at: "2026-11-06T12:00:00Z" }, NOW), { overdue: false, daysLeft: 10, label: "10 days left" });
  assert.equal(privacyDeadline({ status: "approved", due_at: "2026-10-27T20:00:00Z" }, NOW).label, "Due today");
  const late = privacyDeadline({ status: "identity_verified", due_at: "2026-10-24T11:00:00Z" }, NOW);
  assert.equal(late.overdue, true);
  assert.equal(late.label, "Overdue by 3 days");
  assert.equal(privacyDeadline({ status: "export_ready", due_at: "2026-10-01T00:00:00Z" }, NOW).overdue, false);
  assert.equal(privacyDeadline({ status: "fulfilled", due_at: "2026-10-01T00:00:00Z" }, NOW).daysLeft, null);
});

test("retention config: safe defaults, validated overrides", () => {
  const def = normaliseRetentionConfig(undefined);
  assert.equal(def.mode, "dry_run");
  for (const r of RETENTION_RULES) assert.equal(def.periods[r.class], r.days);
  const cfg = normaliseRetentionConfig({ mode: "enforce", periods: { ai_chat_logs: 180, unconverted_leads: "365", ussd_sessions: 5, nope: 10, abandoned_drafts: 99999 } });
  assert.equal(cfg.mode, "enforce");
  assert.equal(cfg.periods.ai_chat_logs, 180);
  assert.equal(cfg.periods.unconverted_leads, 365);
  assert.equal(cfg.periods.ussd_sessions, 90, "too short → default kept");
  assert.equal(cfg.periods.abandoned_drafts, 180, "too long → default kept");
  assert.equal(cfg.warnings.length, 3);
  assert.equal(normaliseRetentionConfig({ mode: "ENFORCE" }).mode, "dry_run", "anything but 'enforce' is a dry run");
  assert.equal(normaliseRetentionConfig([1, 2]).mode, "dry_run");
});

test("every default retention period respects the 30-day floor and has a unique class", () => {
  const classes = new Set<string>();
  for (const r of RETENTION_RULES) {
    assert.ok(r.days >= MIN_RETENTION_DAYS, r.class);
    assert.ok(!classes.has(r.class), `duplicate ${r.class}`);
    classes.add(r.class);
    assert.ok(r.description.length > 20);
  }
  assert.equal(RETENTION_RULES.find((r) => r.class === "policy_explainer_logs")?.days, 180, "explainer logs: proposal from the explainer migration");
  // Insurance records are never subject to a retention erase rule.
  for (const t of ["policies", "claims", "payments", "documents", "ledger_entries", "audit_events"]) {
    assert.ok(!RETENTION_RULES.some((r) => r.tables.includes(t)), t);
  }
});

test("retention plan: one cutoff per rule, from the configured periods", () => {
  const plan = retentionPlan(normaliseRetentionConfig({ periods: { ai_chat_logs: 100 } }), NOW);
  assert.equal(plan.length, RETENTION_RULES.length);
  const ai = plan.find((p) => p.class === "ai_chat_logs")!;
  assert.equal(ai.days, 100);
  assert.equal(ai.cutoff, "2026-07-19T12:00:00.000Z");
  assert.equal(plan.find((p) => p.class === "unconverted_leads")!.cutoff, "2024-10-27T12:00:00.000Z");
  for (const p of plan) assert.ok(Date.parse(p.cutoff) <= NOW.getTime() - MIN_RETENTION_DAYS * 86_400_000);
});

test("dry run unless enforced, and ?dry_run=1 always wins", () => {
  assert.equal(retentionDryRun({ mode: "dry_run" }), true);
  assert.equal(retentionDryRun({ mode: "enforce" }), false);
  assert.equal(retentionDryRun({ mode: "enforce" }, "1"), true);
  assert.equal(retentionDryRun({ mode: "enforce" }, "true"), true);
  assert.equal(retentionDryRun({ mode: "enforce" }, "0"), false);
});

test("deletion scope documents what is scrubbed and retained, with reasons", () => {
  for (const e of [...DELETION_SCRUBBED, ...DELETION_RETAINED]) {
    assert.ok(e.table && e.what && e.reason, JSON.stringify(e));
  }
  const retainedTables = DELETION_RETAINED.map((e) => e.table).join(" ");
  for (const t of ["policies", "claims", "payments", "documents", "ledger", "audit_events", "kyc_verifications"]) assert.ok(retainedTables.includes(t), t);
  const scrubbedTables = DELETION_SCRUBBED.map((e) => e.table).join(" ");
  for (const t of ["profiles", "leads", "ai_threads", "wa_messages", "consents", "drafts", "policy_explainer_logs"]) assert.ok(scrubbedTables.includes(t), t);
});

test("retained records are described in plain words", () => {
  assert.deepEqual(describeRetainedRecords({ policies: 2, claims: 1, payments: 3, documents: 0, messages: 1 }), [
    "2 policies", "1 claim", "3 payment records", "1 message with your broker or insurer",
  ]);
  assert.deepEqual(describeRetainedRecords(null), []);
});

test("export redaction drops secrets, internal notes and staff ids", () => {
  assert.equal(redactExportRow("messages", { id: "m1", body: "internal", internal: true }), null);
  assert.equal(redactExportRow("claim_events", { id: 1, note: "staff only", visible_to_customer: false }), null);
  assert.deepEqual(redactExportRow("messages", { id: "m2", body: "Hi", internal: false, sender_id: "broker-user", sender_party: "broker" }), { id: "m2", body: "Hi", sender_party: "broker" });
  const req = redactExportRow("requests", { id: "r1", risk_data: { reg: "GR 1" }, risk_fingerprint: "abc", assigned_to: "staff-1", title: "Motor" })!;
  assert.deepEqual(Object.keys(req).sort(), ["id", "risk_data", "title"]);
  const pay = redactExportRow("payments", { id: "p1", amount: 100, currency: "GHS", status: "succeeded", raw_event: { secret: 1 }, authorization_url: "https://x", idempotency_key: "k", settlement_subaccount: "ACCT" })!;
  assert.deepEqual(Object.keys(pay).sort(), ["amount", "currency", "id", "status"]);
  const card = redactExportRow("payment_methods", { id: "c1", brand: "visa", last4: "4242", provider_token_ref: "AUTH_x", provider_customer_ref: "CUS_x" })!;
  assert.deepEqual(Object.keys(card).sort(), ["brand", "id", "last4"]);
  const doc = redactExportRow("documents", { id: "d1", file_name: "schedule.pdf", storage_path: "u/policies/x.pdf", checksum: "c", ai_extraction: {} })!;
  assert.deepEqual(Object.keys(doc).sort(), ["file_name", "id"]);
});

test("export shape: fixed sections, counts and an explanation", () => {
  const out = buildPrivacyExport({
    subjectId: "u1",
    reference: "DSR-1001",
    requestId: "req-1",
    generatedAt: NOW,
    sections: {
      profile: { id: "u1", full_name: "Adwoa Owusu", email: "adwoa@test.gh" },
      messages: [{ id: "m1", body: "Hello", internal: false }, { id: "m2", body: "note", internal: true }],
      policies: [{ id: "p1", policy_number: "CG-1" }],
      ai_threads: null,
    },
  });
  assert.equal(out.format, PRIVACY_EXPORT_FORMAT);
  assert.equal(out.version, 1);
  assert.equal(out.generated_at, NOW.toISOString());
  assert.equal(out.reference, "DSR-1001");
  assert.deepEqual(Object.keys(out.sections), EXPORT_SECTIONS.map((s) => s.key));
  assert.equal(out.counts.profile, 1);
  assert.equal(out.counts.messages, 1, "internal message dropped");
  assert.equal(out.counts.policies, 1);
  assert.equal(out.counts.ai_threads, 0);
  assert.equal(out.sections.profile.records[0]!.email, "adwoa@test.gh");
  assert.match(out.about, /technology platform/);
  assert.doesNotMatch(out.about, /\bCovva is (a|an|the) (broker|insurer)\b/i);
  assert.ok(out.not_included.length >= 3);
  // Round-trips as JSON (what is uploaded).
  assert.deepEqual(JSON.parse(JSON.stringify(out)).counts, out.counts);
});

test("export file path and name match the database check", () => {
  const p = privacyExportPath("a0000000-0000-4000-8000-000000000001", "DSR-1001", NOW);
  assert.equal(p, "privacy-exports/a0000000-0000-4000-8000-000000000001/DSR-1001-20261027-120000.json");
  assert.match(p, /^privacy-exports\/[0-9a-f-]{36}\/[^/]+\.json$/);
  assert.equal(privacyExportFileName("DSR-1001"), "covva-my-data-DSR-1001.json");
  assert.equal(privacyExportFileName("../DSR 1"), "covva-my-data-DSR1.json");
});

test("customer copy for every type, and notes where the database requires them", () => {
  for (const t of TYPES) {
    const m = PRIVACY_REQUEST_TYPES[t];
    assert.ok(m.customerLabel && m.description && m.whatHappens && m.notePrompt, t);
    assert.doesNotMatch(`${m.description} ${m.whatHappens}`, /counsel|statutory|Act 843/i, "no legal caveats in customer copy");
  }
  assert.equal(PRIVACY_REQUEST_TYPES.correction.noteRequired, true);
  assert.equal(PRIVACY_REQUEST_TYPES.objection.noteRequired, true);
  assert.equal(PRIVACY_REQUEST_TYPES.access.noteRequired, false);
});
