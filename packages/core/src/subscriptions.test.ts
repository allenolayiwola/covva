import { test } from "node:test";
import assert from "node:assert/strict";
import { graceEnd, instalmentAmount, nextChargeDate, retrySchedule, subscriptionSummary } from "./subscriptions.ts";

test("nextChargeDate keeps the day of month and clamps short months (UTC)", () => {
  assert.equal(nextChargeDate("monthly", "2026-01-31T09:00:00Z").toISOString(), "2026-02-28T09:00:00.000Z");
  assert.equal(nextChargeDate("monthly", "2026-03-15T00:00:00Z").toISOString(), "2026-04-15T00:00:00.000Z");
  assert.equal(nextChargeDate("quarterly", "2026-11-30T00:00:00Z").toISOString(), "2027-02-28T00:00:00.000Z");
  assert.equal(nextChargeDate("annual", "2028-02-29T00:00:00Z").toISOString(), "2029-02-28T00:00:00.000Z");
  assert.equal(nextChargeDate("monthly", new Date("2026-12-05T10:30:00Z")).toISOString(), "2027-01-05T10:30:00.000Z");
  assert.throws(() => nextChargeDate("monthly", "nope"), RangeError);
});

test("retrySchedule: 1d, 3d, 7d then past due", () => {
  assert.deepEqual(retrySchedule(0), { retryInDays: 1, pastDue: false });
  assert.deepEqual(retrySchedule(1), { retryInDays: 1, pastDue: false });
  assert.deepEqual(retrySchedule(2), { retryInDays: 3, pastDue: false });
  assert.deepEqual(retrySchedule(3), { retryInDays: 7, pastDue: false });
  assert.deepEqual(retrySchedule(4), { retryInDays: null, pastDue: true });
  assert.deepEqual(retrySchedule(9), { retryInDays: null, pastDue: true });
});

test("instalmentAmount and graceEnd", () => {
  assert.equal(instalmentAmount(720, "monthly"), 60);
  assert.equal(instalmentAmount(1000, "monthly"), 83.33);
  assert.equal(instalmentAmount(1000, "quarterly"), 250);
  assert.equal(instalmentAmount(1000, "annual"), 1000);
  assert.equal(graceEnd("2026-10-01T00:00:00Z", 14).toISOString(), "2026-10-15T00:00:00.000Z");
});

test("subscriptionSummary presents amounts, status and the next collection", () => {
  const now = new Date("2026-10-26T00:00:00Z");
  const s = subscriptionSummary({ cadence: "monthly", status: "active", display_currency: "GBP", display_amount: "61.25", ghs_amount: "1255.63", next_charge_at: "2026-11-05T00:00:00Z", failures: 0 }, now);
  assert.equal(s.cadenceLabel, "Monthly");
  assert.equal(s.statusLabel, "Active");
  assert.equal(s.amountLabel, "≈ GBP 61.25 monthly (GH₵ 1,255.63 to the insurer)");
  assert.equal(s.nextChargeLabel, "Next collection 5 Nov 2026");
  assert.equal(s.daysToNext, 10);
  const ghs = subscriptionSummary({ cadence: "annual", status: "past_due", display_currency: "GHS", display_amount: 720, ghs_amount: 720, next_charge_at: "2026-10-20T00:00:00Z", failures: 4 }, now);
  assert.equal(ghs.amountLabel, "GH₵ 720.00 yearly");
  assert.equal(ghs.tone, "danger");
  assert.match(ghs.nextChargeLabel, /Overdue since 20 Oct 2026/);
  assert.equal(subscriptionSummary({ cadence: "monthly", status: "cancelled", display_currency: "USD", display_amount: 1, ghs_amount: 15, next_charge_at: null }, now).nextChargeLabel, "Cancelled");
});
