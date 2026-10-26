import { test } from "node:test";
import assert from "node:assert/strict";
import { daysUntil, formatDate, formatDateTime, formatGHS, humanize, initials, relativeDue } from "./format.ts";

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min, 0, 0);

test("formatGHS: whole cedis by default, two decimals on request, dash for nothing", () => {
  assert.equal(formatGHS(1234.5), "GH₵ 1,235");
  assert.equal(formatGHS(1234.5, { decimals: true }), "GH₵ 1,234.50");
  assert.equal(formatGHS(0), "GH₵ 0");
  assert.equal(formatGHS(null), "—");
  assert.equal(formatGHS(undefined), "—");
  assert.equal(formatGHS(Number.NaN), "—");
  assert.equal(formatGHS(2500000), "GH₵ 2,500,000");
});

test("formatDate/formatDateTime accept strings and Dates and use British order", () => {
  assert.equal(formatDate(at(2026, 10, 26)), "26 Oct 2026");
  assert.equal(formatDate(at(2026, 10, 26), "long"), "26 October 2026");
  assert.equal(formatDate(null), "—");
  assert.match(formatDateTime(at(2026, 10, 26, 9, 5)), /^26 Oct,? 09:05$/);
  assert.equal(formatDateTime(undefined), "—");
});

test("daysUntil rounds up and handles nothing", () => {
  const now = at(2026, 10, 26, 12);
  assert.equal(daysUntil(null, now), null);
  assert.equal(daysUntil(at(2026, 10, 26, 18), now), 1, "later today counts as one day");
  assert.equal(daysUntil(at(2026, 10, 28, 12), now), 2);
  assert.equal(daysUntil(at(2026, 10, 24, 12), now), -2);
  assert.equal(daysUntil(at(2026, 10, 26, 12).toISOString(), now), 0);
});

test("relativeDue: no date, overdue, today (at risk within 4h), tomorrow, later", () => {
  const now = at(2026, 10, 26, 8, 0);
  assert.deepEqual(relativeDue(null, now), { label: "No due date", atRisk: false, overdue: false });
  assert.deepEqual(relativeDue(at(2026, 10, 26, 7, 59), now), { label: "Overdue", atRisk: true, overdue: true });
  assert.deepEqual(relativeDue(at(2026, 10, 26, 10, 0), now), { label: "Today, 10:00", atRisk: true, overdue: false });
  assert.deepEqual(relativeDue(at(2026, 10, 26, 15, 30), now), { label: "Today, 15:30", atRisk: false, overdue: false });
  assert.deepEqual(relativeDue(at(2026, 10, 27, 9, 0), now), { label: "Tomorrow", atRisk: false, overdue: false });
  assert.deepEqual(relativeDue(at(2026, 11, 2, 9, 0), now), { label: "2 Nov 2026", atRisk: false, overdue: false });
  assert.equal(relativeDue(at(2026, 10, 27, 9, 0).toISOString(), now).label, "Tomorrow", "ISO strings work too");
});

test("initials and humanize", () => {
  assert.equal(initials("Ama Mensah"), "AM");
  assert.equal(initials("  kofi   owusu  boateng "), "KO");
  assert.equal(initials("Ama"), "A");
  assert.equal(initials(""), "?");
  assert.equal(initials(null), "?");
  assert.equal(humanize("third_party_fire_theft"), "Third party fire theft");
  assert.equal(humanize("motor"), "Motor");
});
