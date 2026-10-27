import { test } from "node:test";
import assert from "node:assert/strict";
import {
  allocateSponsorPayment,
  contributionDueDate,
  contributionPeriods,
  contributionPlanLabel,
  contributionSchedule,
  funeralClaimChecklist,
  groupContributionSummary,
  memberStanding,
  parseWelfareMemberCsv,
  welfareDisclaimer,
  welfareIncidentType,
  welfareJoinPath,
  welfareMemberCsvTemplate,
  type ContributionLike,
} from "./welfare.ts";

const NOW = new Date("2026-10-27T09:00:00Z");

test("contribution periods start at the later of plan start and join date, one per cadence step", () => {
  const monthly = contributionPeriods({ cadence: "monthly", day: 5, startsOn: "2026-07-15" }, "2026-08-20", "2026-10-31");
  assert.deepEqual(monthly.map((p) => p.periodStart), ["2026-08-01", "2026-09-01", "2026-10-01"]);
  assert.deepEqual(monthly.map((p) => p.dueAt), ["2026-08-05", "2026-09-05", "2026-10-05"]);
  const quarterly = contributionPeriods({ cadence: "quarterly", day: 28, startsOn: "2026-01-01" }, null, "2026-12-31");
  assert.deepEqual(quarterly.map((p) => p.periodStart), ["2026-01-01", "2026-04-01", "2026-07-01", "2026-10-01"]);
  const annual = contributionPeriods({ cadence: "annual", day: 1, startsOn: "2025-03-01" }, null, "2026-10-27");
  assert.deepEqual(annual.map((p) => p.periodStart), ["2025-03-01", "2026-03-01"]);
  assert.deepEqual(contributionPeriods({ cadence: "monthly", day: 1, startsOn: "2027-01-01" }, null, "2026-10-27"), []);
});

test("due date clamps to the month and the schedule skips periods that already exist", () => {
  assert.equal(contributionDueDate("2026-02-01", 28), "2026-02-28");
  assert.equal(contributionDueDate("2026-02-01", 31), "2026-02-28");
  assert.equal(contributionDueDate("2026-04-01", 0), "2026-04-01");
  const plan = { amount: 60, cadence: "monthly", day: 5, startsOn: "2026-08-01" };
  const existing: ContributionLike[] = [{ member_id: "m1", period_start: "2026-08-01", due_at: "2026-08-05", amount: 60, status: "paid" }];
  const due = contributionSchedule(plan, { id: "m1", joined_at: "2026-08-01" }, "2026-10-01", existing);
  assert.deepEqual(due.map((d) => [d.periodStart, d.amount, d.memberId]), [["2026-09-01", 60, "m1"], ["2026-10-01", 60, "m1"]]);
});

const ROWS: ContributionLike[] = [
  { id: "a1", member_id: "ama", period_start: "2026-08-01", due_at: "2026-08-05", amount: 60, status: "paid", paid_at: "2026-08-03T10:00:00Z" },
  { id: "a2", member_id: "ama", period_start: "2026-09-01", due_at: "2026-09-05", amount: 60, status: "paid", paid_at: "2026-10-02T10:00:00Z" },
  { id: "a3", member_id: "ama", period_start: "2026-10-01", due_at: "2026-10-05", amount: 60, status: "paid", paid_at: "2026-10-04T10:00:00Z" },
  { id: "y1", member_id: "yaw", period_start: "2026-08-01", due_at: "2026-08-05", amount: 60, status: "failed" },
  { id: "y2", member_id: "yaw", period_start: "2026-09-01", due_at: "2026-09-05", amount: 60, status: "due" },
  { id: "y3", member_id: "yaw", period_start: "2026-10-01", due_at: "2026-10-05", amount: 60, status: "due" },
  { id: "y4", member_id: "yaw", period_start: "2026-11-01", due_at: "2026-11-05", amount: 60, status: "due" },
  { id: "k1", member_id: "kwame", period_start: "2026-10-01", due_at: "2026-10-05", amount: 60, status: "waived" },
  { id: "k2", member_id: "kwame", period_start: "2026-11-01", due_at: "2026-11-05", amount: 60, status: "due" },
];

test("memberStanding: paid up, in arrears (oldest first) and due soon", () => {
  const ama = memberStanding("ama", ROWS, NOW);
  assert.equal(ama.state, "paid_up");
  assert.equal(ama.paidCount, 3);
  assert.equal(ama.arrears, 0);
  assert.equal(ama.lastPaidAt, "2026-10-04T10:00:00Z");
  const yaw = memberStanding("yaw", ROWS, NOW);
  assert.equal(yaw.state, "arrears");
  assert.equal(yaw.overdueCount, 3);
  assert.equal(yaw.arrears, 180);
  assert.equal(yaw.upcomingCount, 1);
  assert.equal(yaw.next?.id, "y1");
  assert.equal(yaw.daysOverdue, 83);
  assert.equal(yaw.label, "3 overdue");
  const kwame = memberStanding("kwame", ROWS, NOW);
  assert.equal(kwame.state, "due");
  assert.equal(kwame.next?.id, "k2");
  assert.equal(memberStanding("nobody", ROWS, NOW).state, "none");
});

test("groupContributionSummary counts standings, arrears, this month's collections and what is coming", () => {
  const s = groupContributionSummary(["ama", "yaw", "kwame", "new"], ROWS, NOW, 14);
  assert.equal(s.members, 4);
  assert.equal(s.paidUp, 1);
  assert.equal(s.inArrears, 1);
  assert.equal(s.dueSoon, 1);
  assert.equal(s.noSchedule, 1);
  assert.equal(s.arrears, 180);
  assert.equal(s.collectedThisPeriod, 120); // Sept paid in Oct + Oct
  assert.deepEqual(s.upcoming, { count: 2, amount: 120, dueBy: "2026-11-05" });
});

test("allocateSponsorPayment settles the sponsored members' oldest debts first, within a budget, never partially", () => {
  const all = allocateSponsorPayment(ROWS, ["yaw"]);
  assert.deepEqual(all.contributions.map((c) => c.id), ["y1", "y2", "y3", "y4"]);
  assert.equal(all.totalGhs, 240);
  assert.deepEqual(all.byMember, [{ memberId: "yaw", count: 4, amount: 240 }]);
  assert.equal(all.leftOut.length, 1); // kwame's due row (not sponsored)

  const capped = allocateSponsorPayment(ROWS, ["yaw", "kwame"], { maxGhs: 150 });
  assert.deepEqual(capped.contributions.map((c) => c.id), ["y1", "y2"]);
  assert.equal(capped.totalGhs, 120);
  assert.ok(capped.leftOut.some((c) => c.id === "y3"));

  const two = allocateSponsorPayment(ROWS, ["yaw", "kwame"], { periodsPerMember: 1 });
  assert.deepEqual(two.contributions.map((c) => c.id), ["y1", "k2"]);
  assert.deepEqual(two.byMember, [{ memberId: "yaw", count: 1, amount: 60 }, { memberId: "kwame", count: 1, amount: 60 }]);
  assert.deepEqual(allocateSponsorPayment(ROWS, ["ama"]).contributions, []);
});

test("labels and disclaimers name the insurer and the broker and never Covva as either", () => {
  assert.equal(contributionPlanLabel({ amount: 60, cadence: "monthly" }), "GH₵ 60.00 monthly per member");
  assert.equal(contributionPlanLabel({ amount: 500, cadence: "annual" }), "GH₵ 500.00 yearly per member");
  const d = welfareDisclaimer("Coastline General", "Demo Broker");
  assert.match(d, /provided by Coastline General/);
  assert.match(d, /arranged by Demo Broker, a licensed broker/);
  assert.match(d, /never holds your money/);
  assert.match(welfareDisclaimer(null, null), /the insurer that issues/);
  assert.equal(welfareJoinPath("ab c"), "/account/groups/join/ab%20c");
});

test("funeral claim checklist by kind, with the police report for accidents", () => {
  const death = funeralClaimChecklist("death");
  assert.ok(death.some((i) => i.key === "death_certificate"));
  assert.ok(death.some((i) => i.key === "membership_confirmation"));
  assert.ok(!death.some((i) => i.key === "police_report"));
  const accident = funeralClaimChecklist("death", { accidental: true });
  assert.equal(accident.at(-1)?.key, "police_report");
  assert.ok(funeralClaimChecklist("hospitalisation").some((i) => i.key === "medical_report"));
  assert.ok(funeralClaimChecklist("death_of_dependant").some((i) => i.key === "dependant_record"));
  assert.ok(funeralClaimChecklist("something-else").some((i) => i.key === "supporting"));
  assert.equal(welfareIncidentType("death", true), "death_accident");
  assert.equal(welfareIncidentType("hospitalisation", true), "hospitalisation");
  assert.equal(welfareIncidentType("nope"), "other_welfare");
});

test("member CSV template parses; errors are row-numbered and duplicates caught", () => {
  const ok = parseWelfareMemberCsv(welfareMemberCsvTemplate, { today: NOW });
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.rows.length, 2);
  assert.equal(ok.rows[0]!.phone, "+233241234567");
  assert.equal(ok.rows[0]!.ghana_card_last4, "7890");
  assert.equal(ok.rows[0]!.beneficiary_relationship, "spouse");
  assert.equal(ok.rows[0]!.beneficiary_phone, "+233201234567");
  assert.equal(ok.rows[1]!.gender, "male");

  const bad = parseWelfareMemberCsv(
    ["Name,Mobile,DOB,Next of kin,NOK relationship", "Kofi Ansah,0244000001,1970-01-01,Akua,wife", "Akua Ansah,0244000001,1980-02-02,,", "Yaa,12345,1985-03-03,,", "X,,2090-01-01,,", ",0244000009,,,"].join("\n"),
    { today: NOW },
  );
  assert.equal(bad.rows.length, 1);
  assert.equal(bad.rows[0]!.beneficiary_relationship, "spouse");
  assert.deepEqual(bad.errors.map((e) => e.row), [3, 4, 5, 6]);
  assert.match(bad.errors[0]!.message, /already used on row 2/);
  assert.match(bad.errors[1]!.message, /not a Ghana number/);
  assert.match(bad.errors[2]!.message, /Full name is missing|past date/);
  assert.deepEqual(parseWelfareMemberCsv("").errors.map((e) => e.message), ["The file is empty."]);
  assert.match(parseWelfareMemberCsv("a,b\n1,2").errors[0]!.message, /full name column/);
});
