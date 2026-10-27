import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ageBand,
  ageOn,
  businessCan,
  censusSummary,
  consolidateInvoice,
  fleetCsvTemplate,
  ghanaCardLast4,
  groupComplexity,
  memberCsvTemplate,
  parseFleetCsv,
  parseMemberCsv,
  previousMonthPeriod,
} from "./sme.ts";
import { complexityFlags } from "./routing-engine.ts";

const TODAY = new Date("2026-10-27T00:00:00Z");

test("member template parses cleanly with dependants linked to principals", () => {
  const r = parseMemberCsv(memberCsvTemplate, { today: TODAY });
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows.length, 4);
  const ama = r.rows[0]!;
  assert.equal(ama.phone, "+233241234567");
  assert.equal(ama.ghana_card_last4, "7890");
  assert.equal(ama.relationship, "employee");
  assert.equal(r.rows[1]!.relationship, "spouse");
  assert.equal(r.rows[1]!.principal_ref, "EMP001");
});

test("member CSV reports row-numbered errors and duplicates", () => {
  const csv = [
    "Staff ID,Name,DOB,Sex,Mobile,Relationship,Principal",
    "E1,Kofi Ansah,1990-01-01,m,0244000001,employee,",
    "E1,Akua Ansah,1991-02-02,f,0244000002,employee,", // duplicate ref
    "E3,Yaa Asantewaa,2091-01-01,f,12345,employee,", // future dob + bad phone
    "E4,Kojo,1985-05-05,male,0244000001,employee,", // duplicate phone of row 2
    ",Ama Kid,2018-03-03,f,,child,", // dependant without principal
    ",Esi Kid,2019-03-03,f,,child,E99", // unknown principal
    ",Kwame Kid,2020-03-03,m,,nephew,E1", // bad relationship
    "",
    "E8,Kofi Ansah,1990-01-01,m,,employee,", // duplicate person (name + dob) of row 2
    "E9,Abena Mensah,12/06/1980,female,+233 20 111 2222,staff,",
  ].join("\n");
  const r = parseMemberCsv(csv, { today: TODAY });
  const byRow = new Map(r.errors.map((e) => [e.row, e.message]));
  assert.match(byRow.get(3)!, /duplicate employee_ref \(same as row 2\)/);
  assert.match(byRow.get(4)!, /in the future/);
  assert.match(byRow.get(4)!, /not a Ghana number/);
  assert.match(byRow.get(5)!, /duplicate phone \(same as row 2\)/);
  assert.match(byRow.get(6)!, /principal_ref is required/);
  assert.match(byRow.get(7)!, /does not match an employee/);
  assert.match(byRow.get(8)!, /relationship "nephew"/);
  assert.match(byRow.get(10)!, /duplicate member/);
  assert.ok(!byRow.has(9), "blank lines are skipped, not errors");
  const ok = r.rows.map((x) => x.row);
  assert.deepEqual(ok, [2, 11]);
  assert.equal(r.rows[1]!.date_of_birth, "1980-06-12");
  assert.equal(r.rows[1]!.phone, "+233201112222");
});

test("member CSV needs a name column; known principals satisfy dependants", () => {
  assert.match(parseMemberCsv("phone\n0241234567").errors[0]!.message, /full_name/);
  assert.equal(parseMemberCsv("").errors[0]!.message, "The file is empty");
  const r = parseMemberCsv("full_name,relationship,principal_ref\nAma Kid,child,EMP100", { knownPrincipalRefs: ["emp100"] });
  assert.deepEqual(r.errors, []);
  assert.equal(r.rows[0]!.principal_ref, "EMP100");
});

test("ghanaCardLast4 keeps only four digits", () => {
  assert.equal(ghanaCardLast4("GHA-123456789-0"), "7890");
  assert.equal(ghanaCardLast4("1234"), "1234");
  assert.equal(ghanaCardLast4("GHA-12"), null);
});

test("fleet template parses; registrations normalised; duplicates and bad values reported", () => {
  const t = parseFleetCsv(fleetCsvTemplate, { now: TODAY });
  assert.deepEqual(t.errors, []);
  assert.equal(t.rows.length, 3);
  assert.equal(t.rows[0]!.registration, "GR 1234-23");
  assert.equal(t.rows[2]!.use, "hire");

  const csv = ["Reg No,Make,Model,Year,Value,Use", "gr1234-23,Toyota,Hilux,2021,\"320,000\",commercial", "GR 1234 23,Toyota,Hilux,2021,1,taxi", "GT 1-24,Kia,Rio,1901,-5,boat", ",Kia,Rio,2020,10,private", "AS 77-25,Kia,Rio,2025,GHS 90000,"].join("\n");
  const r = parseFleetCsv(csv, { now: TODAY, existingRegistrations: ["as77-25"] });
  const byRow = new Map(r.errors.map((e) => [e.row, e.message]));
  assert.equal(r.rows.length, 1);
  assert.equal(r.rows[0]!.value, 320000);
  assert.match(byRow.get(3)!, /duplicate registration \(same as row 2\)/);
  assert.match(byRow.get(4)!, /year "1901"/);
  assert.match(byRow.get(4)!, /positive amount/);
  assert.match(byRow.get(4)!, /use "boat"/);
  assert.match(byRow.get(5)!, /registration is missing/);
  assert.match(byRow.get(6)!, /already on your fleet/);
  assert.match(parseFleetCsv("make\nToyota").errors[0]!.message, /registration/);
});

test("groupComplexity feeds the routing engine's thresholds", () => {
  const members = Array.from({ length: 20 }, (_, i) => ({ relationship: i < 12 ? "employee" : "child" }));
  const g = groupComplexity(members, [{}, {}, {}, {}, { status: "removed" }]);
  assert.equal(g.lives, 20);
  assert.equal(g.employees, 12);
  assert.equal(g.dependants, 8);
  assert.equal(g.fleetSize, 4);
  assert.deepEqual(g.flags, ["group_scheme"]);
  // Same answer as the engine reading the risk keys we put in risk_data.
  assert.deepEqual(complexityFlags({ categorySlug: "health", risk: g.riskKeys }), ["group_scheme"]);
  const fleet = groupComplexity([], Array.from({ length: 5 }, () => ({})));
  assert.deepEqual(fleet.flags, ["fleet"]);
  assert.deepEqual(complexityFlags({ categorySlug: "motor", risk: fleet.riskKeys }), ["fleet"]);
  assert.deepEqual(groupComplexity([{ relationship: "employee" }]).flags, []);
});

test("censusSummary counts bands, tiers and relationships without PII", () => {
  const s = censusSummary(
    [
      { relationship: "employee", date_of_birth: "1990-10-28", gender: "female", cover_tier: "standard", salary_band: "b" }, // 35 (birthday tomorrow)
      { relationship: "employee", date_of_birth: "1960-01-01", gender: "male", cover_tier: "premium", salary_band: "c" }, // 66
      { relationship: "spouse", date_of_birth: "1992-05-05", gender: "male", cover_tier: "standard" }, // 34
      { relationship: "child", date_of_birth: "2015-05-05", cover_tier: "standard" }, // 11
      { relationship: "child" },
      { relationship: "employee", date_of_birth: "1970-01-01", status: "removed" },
    ],
    "2026-10-27",
  );
  assert.equal(s.lives, 5);
  assert.equal(s.employees, 2);
  assert.equal(s.dependants, 3);
  assert.deepEqual(s.byRelationship, { employee: 2, spouse: 1, child: 2, parent: 0 });
  assert.equal(s.byAgeBand["30-39"], 2);
  assert.equal(s.byAgeBand["65+"], 1);
  assert.equal(s.byAgeBand["0-17"], 1);
  assert.equal(s.byAgeBand.unknown, 1);
  assert.equal(s.byTier.standard, 3);
  assert.equal(s.byTier.unspecified, 1);
  assert.deepEqual(s.bySalaryBand, { b: 1, c: 1 });
  assert.equal(s.oldestAge, 66);
  assert.equal(s.youngestAge, 11);
  assert.equal(s.averageEmployeeAge, 50.5);
  assert.equal(s.missingDateOfBirth, 1);
  assert.ok(!JSON.stringify(s).includes("1990-10-28"), "no dates of birth leak into the summary");
});

test("ageOn / ageBand", () => {
  assert.equal(ageOn("2000-10-28", "2026-10-27"), 25);
  assert.equal(ageOn("2000-10-27", "2026-10-27"), 26);
  assert.equal(ageBand(17), "0-17");
  assert.equal(ageBand(64), "60-64");
  assert.equal(ageBand(null), "unknown");
});

test("consolidateInvoice groups lines per insurer and picks what is due", () => {
  const period = { start: "2026-10-01", end: "2026-10-31" };
  const inv = consolidateInvoice(
    [
      { policy_id: "p1", scheme_id: "s1", insurer_org_id: "A", insurer_name: "Alpha", description: "Staff health", premium: 1000, billing_period: "month", cover_start: "2026-03-01", status: "active" },
      { policy_id: "p2", insurer_org_id: "B", insurer_name: "Beta", description: "Fleet motor", premium: 12000, billing_period: "year", cover_start: "2025-10-15", status: "active" }, // anniversary in Oct
      { policy_id: "p3", insurer_org_id: "B", insurer_name: "Beta", description: "Property", premium: 5000, billing_period: "year", cover_start: "2026-02-01", status: "active" }, // not due
      { policy_id: "p4", insurer_org_id: "A", insurer_name: "Alpha", description: "Group life", premium: 900, billing_period: "quarter", cover_start: "2026-07-01", status: "active" }, // Jul, Oct
      { policy_id: "p5", insurer_org_id: "A", description: "Lapsed", premium: 50, billing_period: "month", cover_start: "2026-01-01", status: "lapsed" },
      { application_id: "a1", insurer_org_id: "C", insurer_name: "Gamma", description: "New liability cover", premium: 2500.5 },
      { policy_id: "p6", insurer_org_id: "A", description: "Ended", premium: 70, billing_period: "month", cover_start: "2025-01-01", cover_end: "2026-09-30", status: "active" },
      { policy_id: "p7", insurer_org_id: "A", description: "Future", premium: 70, billing_period: "month", cover_start: "2026-11-01", status: "active" },
    ],
    period,
  );
  assert.deepEqual(inv.lines.map((l) => [l.policy_id ?? l.application_id, l.basis]), [["p1", "monthly"], ["p2", "renewal"], ["p4", "quarterly"], ["a1", "new_business"]]);
  assert.equal(inv.total, 16400.5);
  assert.deepEqual(inv.byInsurer.map((b) => [b.insurer_org_id, b.amount, b.lines]), [["B", 12000, 1], ["C", 2500.5, 1], ["A", 1900, 2]]);
});

test("previousMonthPeriod and businessCan", () => {
  assert.deepEqual(previousMonthPeriod(new Date("2026-11-01T05:00:00Z")), { start: "2026-10-01", end: "2026-10-31" });
  assert.deepEqual(previousMonthPeriod(new Date("2026-03-01T05:00:00Z")), { start: "2026-02-01", end: "2026-02-28" });
  assert.ok(businessCan("owner", "members"));
  assert.ok(businessCan("finance", "billing"));
  assert.ok(!businessCan("finance", "members"));
  assert.ok(!businessCan("viewer", "billing"));
  assert.ok(!businessCan("adviser", "view"));
});
