import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CATEGORY_AVAILABILITY,
  CLAIM_STATUS,
  COMPLAINT_STATUS,
  OPEN_REQUEST_STATUSES,
  PAYMENT_STATUS,
  POLICY_STATUS,
  QUEUE_BUCKETS,
  QUOTE_STATUS,
  REQUEST_STATUS,
  REQUEST_TRANSITIONS,
  canTransitionRequest,
  fulfilmentProgress,
  FULFILMENT_CHECKPOINTS,
  type Party,
  type RequestStatus,
} from "./status.ts";

// Enum values as declared in supabase/migrations/*_core_schema.sql.
const REQUEST = ["draft", "submitted", "awaiting_customer_info", "adviser_action", "insurer_response", "quotes_ready", "payment_confirmation", "policy_documents", "completed", "cancelled", "closed_no_cover"];
const QUOTE = ["estimate", "awaiting_underwriting", "ready_to_accept", "accepted", "expired", "declined", "withdrawn"];
const POLICY = ["pending_issuance", "active", "lapsed", "cancelled", "expired", "renewed"];
const CLAIM = ["draft", "reported", "delivered_to_insurer", "acknowledged", "under_assessment", "info_requested", "approved", "partially_approved", "rejected", "paid", "closed", "withdrawn"];
const COMPLAINT = ["open", "acknowledged", "investigating", "resolved", "escalated_nic", "closed"];
const PAYMENT = ["pending", "processing", "succeeded", "failed", "refunded", "reversed", "abandoned"];
const PARTIES: Party[] = ["customer", "broker", "insurer", "platform", "system", "ai"];

test("every database enum value has display metadata with a label and tone", () => {
  const check = (name: string, table: Record<string, { label: string; tone: string }>, values: string[]) => {
    assert.deepEqual(Object.keys(table).sort(), [...values].sort(), name);
    for (const v of values) {
      assert.ok(table[v]!.label.length > 0, `${name}.${v} label`);
      assert.ok(["ok", "wait", "neutral", "danger", "info"].includes(table[v]!.tone), `${name}.${v} tone`);
    }
  };
  check("REQUEST_STATUS", REQUEST_STATUS, REQUEST);
  check("QUOTE_STATUS", QUOTE_STATUS, QUOTE);
  check("POLICY_STATUS", POLICY_STATUS, POLICY);
  check("CLAIM_STATUS", CLAIM_STATUS, CLAIM);
  check("COMPLAINT_STATUS", COMPLAINT_STATUS, COMPLAINT);
  check("PAYMENT_STATUS", PAYMENT_STATUS, PAYMENT);
  assert.deepEqual(Object.keys(CATEGORY_AVAILABILITY).sort(), ["broker_assisted", "integrated", "planned"]);
});

test("transition table covers every status, terminal states have no exits, targets are valid", () => {
  assert.deepEqual(Object.keys(REQUEST_TRANSITIONS).sort(), [...REQUEST].sort());
  for (const terminal of ["completed", "cancelled", "closed_no_cover"] as RequestStatus[]) assert.deepEqual(REQUEST_TRANSITIONS[terminal], []);
  for (const [from, edges] of Object.entries(REQUEST_TRANSITIONS)) {
    for (const e of edges) {
      assert.ok(REQUEST.includes(e.to), `${from} → ${e.to}`);
      assert.notEqual(e.to, from, "no self transitions");
      assert.ok(e.by.length > 0);
      for (const p of e.by) assert.ok(PARTIES.includes(p), `${from} → ${e.to} by ${p}`);
    }
  }
});

test("customer moves match the database guard (requests_customer_guard)", () => {
  // Allowed by the trigger in 20261026130000_backend_support.sql.
  const allowed: [RequestStatus, RequestStatus][] = [
    ["draft", "submitted"], ["draft", "cancelled"],
    ["awaiting_customer_info", "adviser_action"], ["awaiting_customer_info", "cancelled"],
    ["quotes_ready", "adviser_action"], ["quotes_ready", "cancelled"],
  ];
  for (const [from, to] of allowed) assert.equal(canTransitionRequest(from, to, "customer"), true, `${from} → ${to}`);
  // Never for a customer.
  const denied: [RequestStatus, RequestStatus][] = [
    ["submitted", "quotes_ready"], ["adviser_action", "quotes_ready"], ["insurer_response", "quotes_ready"],
    ["payment_confirmation", "policy_documents"], ["policy_documents", "completed"], ["draft", "completed"], ["completed", "draft"],
  ];
  for (const [from, to] of denied) assert.equal(canTransitionRequest(from, to, "customer"), false, `${from} → ${to}`);
});

test("only the insurer, broker or system completes a request; payment confirmation is system-driven", () => {
  assert.equal(canTransitionRequest("policy_documents", "completed", "insurer"), true);
  assert.equal(canTransitionRequest("policy_documents", "completed", "broker"), true);
  assert.equal(canTransitionRequest("policy_documents", "completed", "system"), true);
  assert.equal(canTransitionRequest("policy_documents", "completed", "platform"), false);
  assert.equal(canTransitionRequest("payment_confirmation", "policy_documents", "system"), true);
  assert.equal(canTransitionRequest("payment_confirmation", "policy_documents", "platform"), true);
  assert.equal(canTransitionRequest("payment_confirmation", "policy_documents", "broker"), false);
  assert.equal(canTransitionRequest("quotes_ready", "payment_confirmation", "customer"), true);
  assert.equal(canTransitionRequest("quotes_ready", "payment_confirmation", "broker"), false);
  assert.equal(canTransitionRequest("adviser_action", "closed_no_cover", "broker"), true);
  assert.equal(canTransitionRequest("adviser_action", "closed_no_cover", "ai"), false);
});

test("queue buckets are open statuses and do not overlap", () => {
  const seen = new Set<string>();
  for (const b of QUEUE_BUCKETS) {
    for (const s of b.statuses) {
      assert.ok(OPEN_REQUEST_STATUSES.includes(s), `${b.key} contains closed status ${s}`);
      assert.ok(!seen.has(s), `${s} appears in two buckets`);
      seen.add(s);
    }
  }
  assert.ok(!OPEN_REQUEST_STATUSES.includes("draft"));
  assert.ok(!OPEN_REQUEST_STATUSES.includes("completed"));
});

test("customer-facing hints never promise approval or instant cover", () => {
  assert.match(CLAIM_STATUS.reported.customerHint!, /does not mean it is approved/);
  assert.match(POLICY_STATUS.pending_issuance.customerHint!, /Not yet active/);
  assert.match(REQUEST_STATUS.policy_documents.customerHint!, /once the insurer confirms/);
  assert.match(QUOTE_STATUS.estimate.customerHint!, /Not an offer/);
  assert.match(CATEGORY_AVAILABILITY.planned.promise, /Not yet available/);
  assert.doesNotMatch(CATEGORY_AVAILABILITY.integrated.promise, /instant/i);
});

test("fulfilment checkpoints map to four booleans in order", () => {
  assert.deepEqual(FULFILMENT_CHECKPOINTS.map((c) => c.key), ["choice", "payment", "issue", "documents"]);
  assert.deepEqual(fulfilmentProgress({ quoteAccepted: true, paymentConfirmed: true, policyActive: false, documentsDelivered: false }), [true, true, false, false]);
});
