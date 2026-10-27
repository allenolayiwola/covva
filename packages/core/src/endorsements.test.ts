import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENDORSEMENT_KINDS,
  ENDORSEMENT_KIND_VALUES,
  adjustmentLabel,
  beforeValues,
  describeChanges,
  endorsementKindsFor,
  endorsementSchemaFor,
  proRataAdjustment,
  riskAfterEndorsement,
} from "./endorsements.ts";

test("every kind has a label, fields and a schema", () => {
  for (const k of ENDORSEMENT_KIND_VALUES) {
    const d = ENDORSEMENT_KINDS[k];
    assert.equal(d.kind, k);
    assert.ok(d.label.length > 2);
    assert.ok(d.fields.length > 0);
    assert.ok(d.schema);
  }
});

test("kinds per category: motor gets vehicle and driver changes; health gets members; all get address/cancel/other", () => {
  const motor = endorsementKindsFor("motor").map((d) => d.kind);
  assert.ok(motor.includes("change_vehicle") && motor.includes("add_driver") && motor.includes("change_use"));
  assert.ok(!motor.includes("add_member"));
  const health = endorsementKindsFor("health").map((d) => d.kind);
  assert.ok(health.includes("add_member") && health.includes("remove_member"));
  assert.ok(!health.includes("change_vehicle"));
  for (const slug of ["travel", "liability", null]) {
    const kinds = endorsementKindsFor(slug).map((d) => d.kind);
    assert.ok(kinds.includes("change_address") && kinds.includes("cancel_policy") && kinds.includes("other"));
  }
});

test("endorsementSchemaFor validates per kind and rejects kinds outside the category", () => {
  assert.equal(endorsementSchemaFor("health", "change_vehicle"), null);
  assert.equal(endorsementSchemaFor("motor", "not_a_kind"), null);
  const s = endorsementSchemaFor("motor", "change_vehicle")!;
  const ok = s.safeParse({ registration_number: "GR 1234-24", vehicle_make: "Toyota", vehicle_model: "Corolla", vehicle_year: "2019", vehicle_value: "85000" });
  assert.ok(ok.success);
  assert.equal(ok.data.vehicle_year, 2019);
  assert.equal(ok.data.vehicle_value, 85000);
  assert.equal(s.safeParse({ registration_number: "", vehicle_make: "x", vehicle_model: "y", vehicle_year: 1800, vehicle_value: 0 }).success, false);
  const driver = endorsementSchemaFor("motor", "add_driver")!;
  assert.equal(driver.safeParse({ driver_name: "Kwame", date_of_birth: "02/03/2000", licence_number: "X", years_licensed: 1 }).success, false);
  assert.ok(driver.safeParse({ driver_name: "Kwame", date_of_birth: "2000-03-02", licence_number: "DL-1", years_licensed: 3 }).success);
});

test("riskAfterEndorsement: youngest driver, new vehicle value, sum insured field, members", () => {
  assert.equal(riskAfterEndorsement("motor", "add_driver", { driver_age: 45 }, { date_of_birth: "2006-01-01" }, "2026-10-27").driver_age, 20);
  assert.equal(riskAfterEndorsement("motor", "change_vehicle", { vehicle_value: 50000 }, { vehicle_value: 90000 }).vehicle_value, 90000);
  assert.equal(riskAfterEndorsement("home", "change_sum_insured", { building_value: 1 }, { sum_insured: 400000 }).building_value, 400000);
  assert.equal(riskAfterEndorsement("health", "add_member", { members: 2, oldest_member_age: 40 }, { date_of_birth: "1950-01-01" }, "2026-10-27").members, 3);
  assert.equal(riskAfterEndorsement("health", "add_member", { members: 2, oldest_member_age: 40 }, { date_of_birth: "1950-01-01" }, "2026-10-27").oldest_member_age, 76);
  assert.equal(riskAfterEndorsement("health", "remove_member", { members: 1 }, {}).members, 1);
});

test("beforeValues reads the current risk and the policy's sum insured", () => {
  assert.deepEqual(beforeValues("change_vehicle", "motor", { vehicle_make: "Kia", vehicle_value: 1 }), { vehicle_make: "Kia", vehicle_value: 1 });
  assert.deepEqual(beforeValues("change_sum_insured", "home", { building_value: 5 }, { sum_insured: "300000" }), { sum_insured: 300000 });
});

test("proRataAdjustment: half a year of a higher premium; refunds are negative; pesewa exact", () => {
  // 365-day term, 183 days remaining (2027-04-01 → 2027-09-30).
  const r = proRataAdjustment(1000, 1200, "2027-04-01", "2027-09-30");
  assert.equal(r.daysRemaining, 183);
  assert.equal(r.daysInTerm, 365);
  assert.equal(r.amount, 100.27); // 200 × 183/365 = 100.2739…
  const refund = proRataAdjustment(1000, 0, "2027-04-01", "2027-09-30");
  assert.equal(refund.amount, -501.37);
  // Using the actual term from cover start.
  const t = proRataAdjustment(1000.1, 1000.2, "2026-01-01", "2026-12-31", { coverStart: "2026-01-01" });
  assert.equal(t.daysInTerm, 365);
  assert.equal(t.amount, 0.1);
  // After cover ends → 0; before cover starts → full difference.
  assert.equal(proRataAdjustment(1000, 1500, "2027-01-01", "2026-12-31").amount, 0);
  assert.equal(proRataAdjustment(1000, 1500, "2025-06-01", "2026-12-31", { coverStart: "2026-01-01" }).amount, 500);
  assert.equal(proRataAdjustment(500, 500, "2026-06-01", "2026-12-31").amount, 0);
  assert.throws(() => proRataAdjustment(1, 2, "nope", "2026-12-31"));
});

test("describeChanges lists only changed fields with plain labels", () => {
  const lines = describeChanges({ vehicle_make: "Kia", vehicle_model: "Rio", vehicle_value: 50000 }, { vehicle_make: "Toyota", vehicle_model: "Rio", vehicle_value: 85000 });
  assert.deepEqual(lines, [
    { key: "vehicle_make", label: "Make", before: "Kia", after: "Toyota" },
    { key: "vehicle_value", label: "Value (GHS)", before: "50000", after: "85000" },
  ]);
  assert.deepEqual(describeChanges(null, { driver_name: "Ama" }), [{ key: "driver_name", label: "Full name", before: "—", after: "Ama" }]);
});

test("adjustmentLabel", () => {
  assert.equal(adjustmentLabel(null), "Your insurer will confirm any change in premium");
  assert.equal(adjustmentLabel(0), "No change in premium");
  assert.equal(adjustmentLabel(120), "Additional premium GHS 120.00");
  assert.equal(adjustmentLabel("-40.5"), "Refund GHS 40.50");
});
