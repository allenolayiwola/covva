import { test } from "node:test";
import assert from "node:assert/strict";
import { bucketByDay, commissionSummary, conversionRate, percentChange, slaOnTimeRate, sumBuckets } from "./analytics.ts";

test("conversionRate: ratio clamped to 0–1, null without a denominator", () => {
  assert.equal(conversionRate(3, 12), 0.25);
  assert.equal(conversionRate(0, 5), 0);
  assert.equal(conversionRate(7, 5), 1);
  assert.equal(conversionRate(1, 0), null);
  assert.equal(conversionRate(Number.NaN, 4), null);
});

test("slaOnTimeRate: measures completed and overdue-open items only", () => {
  const now = Date.parse("2026-10-26T12:00:00Z");
  const stats = slaOnTimeRate(
    [
      { dueAt: "2026-10-25T10:00:00Z", completedAt: "2026-10-25T09:00:00Z" }, // on time
      { dueAt: "2026-10-25T10:00:00Z", completedAt: "2026-10-25T11:00:00Z" }, // late
      { dueAt: "2026-10-25T10:00:00Z", completedAt: "2026-10-25T09:00:00Z", breachedAt: "2026-10-25T09:30:00Z" }, // breach stamp wins
      { dueAt: "2026-10-25T10:00:00Z", completedAt: null }, // open and overdue
      { dueAt: "2026-10-27T10:00:00Z", completedAt: null }, // open, not yet due → not measured
      { dueAt: null, completedAt: "2026-10-25T09:00:00Z" }, // no target → ignored
    ],
    now,
  );
  assert.deepEqual(stats, { measured: 4, onTime: 1, late: 2, openOverdue: 1, rate: 0.25 });
  assert.equal(slaOnTimeRate([], now).rate, null);
});

test("bucketByDay: continuous axis with zero-filled days and custom values", () => {
  const rows = [
    { at: "2026-10-01T08:00:00Z", premium: 100 },
    { at: "2026-10-01T23:59:00Z", premium: 50 },
    { at: "2026-10-03T00:00:00Z", premium: 20 },
    { at: "2026-09-30T00:00:00Z", premium: 999 }, // outside the window
    { at: null, premium: 5 },
  ];
  const counts = bucketByDay(rows, (r) => r.at, "2026-10-01", "2026-10-03");
  assert.deepEqual(counts, [
    { day: "2026-10-01", value: 2 },
    { day: "2026-10-02", value: 0 },
    { day: "2026-10-03", value: 1 },
  ]);
  const premiums = bucketByDay(rows, (r) => r.at, new Date("2026-10-01"), new Date("2026-10-03"), (r) => r.premium);
  assert.deepEqual(premiums.map((b) => b.value), [150, 0, 20]);
  assert.equal(sumBuckets(premiums), 170);
});

test("commissionSummary: earned from ledger credits, paid from paid statements, outstanding never negative", () => {
  const broker = "b1";
  const insurer = "i1";
  const entries = [
    { entry_type: "broker_commission", amount: "125.50", org_id: broker, counterparty_org_id: insurer },
    { entry_type: "broker_commission", amount: 74.5, org_id: broker, counterparty_org_id: insurer },
    { entry_type: "revenue_share", amount: -40, org_id: "platform", counterparty_org_id: broker },
    { entry_type: "premium_received", amount: 1000, org_id: insurer }, // premiums never count as commission
    { entry_type: "broker_commission", amount: 500, org_id: "other-broker", counterparty_org_id: insurer },
  ];
  const statements = [
    { status: "paid", commission: 100 },
    { status: "issued", commission: 100 },
  ];
  assert.deepEqual(commissionSummary(entries, statements, broker), { earned: 200, paid: 100, outstanding: 100, platformDue: 40, entries: 3 });
  // Insurer side: both brokers' commission is payable.
  assert.equal(commissionSummary(entries, [], insurer).earned, 700);
  // Overpaid statements never produce a negative outstanding balance.
  assert.equal(commissionSummary(entries, [{ status: "paid", commission: 999 }], broker).outstanding, 0);
});

test("percentChange", () => {
  assert.equal(percentChange(120, 100), 20);
  assert.equal(percentChange(80, 100), -20);
  assert.equal(percentChange(5, 0), null);
  assert.equal(percentChange(4, 3), 33.3);
});
