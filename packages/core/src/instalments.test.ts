import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addMonthsUtc,
  buildSchedule,
  instalmentProgressLine,
  instalmentRetryAt,
  maskMomoNumber,
  nextDue,
  parseInstalmentPlan,
  parseInstalmentPlans,
  planRulesText,
  reinstatementAllowed,
  scheduleState,
  type InstalmentPlan,
} from "./instalments.ts";

const monthly: InstalmentPlan = { key: "monthly", count: 12, deposit_pct: 0, surcharge_pct: 0, grace_days: 14, lapse_after_days: 30, reinstatement: { allowed: true, within_days: 60, requires_review: true } };
const sumMinor = (xs: { amount: number }[]) => xs.reduce((s, x) => s + Math.round(x.amount * 100), 0);

test("buildSchedule splits equally, remainder on the last instalment, totals exact", () => {
  const s = buildSchedule(1000, monthly, "2026-01-31T09:00:00Z");
  assert.equal(s.count, 12);
  assert.equal(s.instalments.length, 12);
  assert.equal(s.instalments[0]!.amount, 83.33);
  assert.equal(s.instalments[11]!.amount, 83.37);
  assert.equal(sumMinor(s.instalments), 100_000);
  assert.equal(s.total, 1000);
  // Anchored on the start date and clamped to short months.
  assert.equal(s.instalments[1]!.dueAt, "2026-02-28T09:00:00.000Z");
  assert.equal(s.instalments[2]!.dueAt, "2026-03-31T09:00:00.000Z");
  assert.equal(s.instalments[0]!.dueAt, "2026-01-31T09:00:00.000Z");
});

test("buildSchedule applies deposit and surcharge in pesewas", () => {
  const plan: InstalmentPlan = { ...monthly, key: "quarterly", count: 4, deposit_pct: 40, surcharge_pct: 5 };
  const s = buildSchedule(1234.57, plan, "2026-11-30T00:00:00Z");
  assert.equal(s.surcharge, 61.73); // 5% of 123,457 pesewas = 6,172.85 → 6,173
  assert.equal(s.total, 1296.3);
  assert.equal(s.deposit, 518.52); // 40% of 129,630 = 51,852
  assert.deepEqual(s.instalments.map((i) => i.amount), [518.52, 259.26, 259.26, 259.26]);
  assert.equal(sumMinor(s.instalments), 129_630);
  assert.equal(s.instalments[1]!.dueAt, "2027-02-28T00:00:00.000Z");
  for (const total of [0.07, 1, 99.99, 333.33, 7_777.77, 1_000_000.01]) {
    for (const p of [monthly, { ...plan, deposit_pct: 0 }, { ...plan, count: 7, deposit_pct: 33.33, surcharge_pct: 2.5 }]) {
      if (Math.round(total * 100) < p.count) {
        assert.throws(() => buildSchedule(total, p, "2026-01-01T00:00:00Z"), RangeError);
        continue;
      }
      const b = buildSchedule(total, p, "2026-01-01T00:00:00Z");
      assert.equal(sumMinor(b.instalments), Math.round(b.total * 100), `total ${total} plan ${p.key}/${p.count}`);
      assert.ok(b.instalments.every((i) => i.amount > 0));
    }
  }
  assert.equal(buildSchedule(500, { ...monthly, count: 1 }, "2026-01-01T00:00:00Z").instalments[0]!.amount, 500);
  assert.throws(() => buildSchedule(0, monthly, "2026-01-01T00:00:00Z"), RangeError);
  assert.throws(() => buildSchedule(10, monthly, "nope"), RangeError);
});

test("parseInstalmentPlans validates and bounds the insurer's plans", () => {
  const plans = parseInstalmentPlans([{ key: "monthly", count: 99, grace_days: 10, lapse_after_days: 5 }, { key: "weekly" }, { key: "monthly" }, { key: "quarterly", reinstatement: { allowed: true, within_days: 30, requires_review: false } }]);
  assert.equal(plans.length, 2);
  assert.equal(plans[0]!.count, 24);
  assert.equal(plans[0]!.lapse_after_days, 10, "lapse is never before the end of grace");
  assert.equal(plans[0]!.reinstatement.allowed, false);
  assert.equal(plans[1]!.count, 4);
  assert.equal(plans[1]!.reinstatement.requires_review, false);
  assert.deepEqual(parseInstalmentPlans("x"), []);
  assert.equal(parseInstalmentPlan(null), null);
});

function inst(seq: number, due: string, status: string, amount = 100) {
  return { seq, due_at: due, amount, status };
}

test("scheduleState: current → due → grace → overdue → lapsed", () => {
  const sched = { status: "active", plan: monthly };
  const rows = [inst(1, "2026-01-01T00:00:00Z", "paid"), inst(2, "2026-02-01T00:00:00Z", "due"), inst(3, "2026-03-01T00:00:00Z", "due")];
  const at = (iso: string) => scheduleState(sched, rows, new Date(iso));
  let s = at("2026-01-20T00:00:00Z");
  assert.equal(s.state, "current");
  assert.equal(s.paidCount, 1);
  assert.equal(s.next?.seq, 2);
  assert.equal(s.arrears, 0);
  assert.equal(at("2026-02-01T10:00:00Z").state, "due");
  s = at("2026-02-05T00:00:00Z");
  assert.equal(s.state, "grace");
  assert.equal(s.status, "grace");
  assert.equal(s.daysOverdue, 4);
  assert.equal(s.graceUntil, "2026-02-15T00:00:00.000Z");
  assert.equal(s.lapseAt, "2026-03-03T00:00:00.000Z");
  assert.equal(at("2026-02-20T00:00:00Z").state, "overdue");
  s = at("2026-03-04T00:00:00Z");
  assert.equal(s.state, "lapsed");
  assert.equal(s.arrears, 200, "two instalments are due by then");
  assert.equal(scheduleState({ status: "lapsed", plan: monthly }, rows, new Date("2026-01-02T00:00:00Z")).state, "lapsed");
  assert.equal(scheduleState({ status: "cancelled", plan: monthly }, rows).state, "cancelled");
  const done = scheduleState(sched, [inst(1, "2026-01-01T00:00:00Z", "paid"), inst(2, "2026-02-01T00:00:00Z", "waived")]);
  assert.equal(done.state, "completed");
  assert.equal(done.outstanding, 0);
  // A reinstated schedule stays "reinstated" while current.
  assert.equal(scheduleState({ status: "reinstated", plan: monthly }, rows, new Date("2026-01-20T00:00:00Z")).status, "reinstated");
  // No grace: missed today is "due", tomorrow overdue, lapses at lapse_after_days.
  const strict = { status: "active", plan: { ...monthly, grace_days: 0, lapse_after_days: 0 } };
  assert.equal(scheduleState(strict, rows, new Date("2026-02-01T12:00:00Z")).state, "due");
  assert.equal(scheduleState(strict, rows, new Date("2026-02-02T01:00:00Z")).state, "lapsed");
});

test("nextDue, retries on day 0 / +2 / +5", () => {
  assert.equal(nextDue([inst(3, "2026-03-01T00:00:00Z", "due"), inst(2, "2026-02-01T00:00:00Z", "failed"), inst(1, "2026-01-01T00:00:00Z", "paid")])?.seq, 2);
  assert.equal(nextDue([inst(1, "2026-01-01T00:00:00Z", "paid")]), null);
  assert.equal(instalmentRetryAt("2026-02-01T06:30:00Z", 0)?.toISOString(), "2026-02-01T06:30:00.000Z");
  assert.equal(instalmentRetryAt("2026-02-01T06:30:00Z", 1)?.toISOString(), "2026-02-03T06:30:00.000Z");
  assert.equal(instalmentRetryAt("2026-02-01T06:30:00Z", 2)?.toISOString(), "2026-02-06T06:30:00.000Z");
  assert.equal(instalmentRetryAt("2026-02-01T06:30:00Z", 3), null);
});

test("reinstatementAllowed follows the plan's window and review rule", () => {
  const lapsed = { status: "lapsed", plan: monthly, lapsed_at: "2026-03-04T00:00:00Z" };
  const ok = reinstatementAllowed(lapsed, new Date("2026-04-01T00:00:00Z"));
  assert.equal(ok.allowed, true);
  assert.equal(ok.requiresReview, true);
  assert.equal(ok.deadline, "2026-05-03T00:00:00.000Z");
  const late = reinstatementAllowed(lapsed, new Date("2026-05-04T00:00:00Z"));
  assert.equal(late.allowed, false);
  assert.match(late.reason, /until 3 May 2026/);
  assert.equal(reinstatementAllowed({ ...lapsed, plan: { ...monthly, reinstatement: { allowed: false, within_days: 0, requires_review: false } } }).allowed, false);
  assert.equal(reinstatementAllowed({ status: "active", plan: monthly }).allowed, false);
  const noReview = reinstatementAllowed({ ...lapsed, plan: { ...monthly, reinstatement: { allowed: true, within_days: 60, requires_review: false } } }, new Date("2026-03-10T00:00:00Z"));
  assert.equal(noReview.allowed, true);
  assert.equal(noReview.requiresReview, false);
});

test("presentation helpers", () => {
  const rows = [inst(1, "2026-01-01T00:00:00Z", "paid", 85), inst(2, "2026-01-02T00:00:00Z", "paid", 85), inst(3, "2026-01-03T00:00:00Z", "paid", 85), inst(4, "2026-12-05T00:00:00Z", "due", 85)];
  const s = scheduleState({ status: "active", plan: monthly }, rows, new Date("2026-10-26T00:00:00Z"));
  assert.equal(instalmentProgressLine(s), "Instalments: 3 of 4 paid · next GH₵ 85.00 on 5 Dec 2026");
  const text = planRulesText({ ...monthly, surcharge_pct: 5 }).join(" ");
  assert.match(text, /14 days/);
  assert.match(text, /30 days after the due date/);
  assert.match(text, /reviews it first/);
  assert.equal(maskMomoNumber("+233241234567"), "024•••4567");
  assert.equal(maskMomoNumber("0241234567"), "024•••4567");
  assert.equal(maskMomoNumber("12"), null);
  assert.equal(addMonthsUtc("2028-02-29T00:00:00Z", 12).toISOString(), "2029-02-28T00:00:00.000Z");
});
