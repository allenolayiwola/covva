import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseRegistration, prefillFromLookup, quickQuoteFields, registrationYear, vehicleAgeBand } from "./vehicle.ts";

test("normaliseRegistration canonicalises Ghana plates", () => {
  assert.equal(normaliseRegistration("GR 1234-23"), "GR 1234-23");
  assert.equal(normaliseRegistration("gr123423"), "GR 1234-23");
  assert.equal(normaliseRegistration(" gr-1234-23 "), "GR 1234-23");
  assert.equal(normaliseRegistration("GR 1234 23"), "GR 1234-23");
  assert.equal(normaliseRegistration("AS 12-19"), "AS 12-19");
  assert.equal(normaliseRegistration("DV 9-24"), "DV 9-24");
  assert.equal(normaliseRegistration(""), "");
  assert.equal(normaliseRegistration(null), "");
  // Unknown shapes are upper-cased and tidied, not rejected.
  assert.equal(normaliseRegistration("abc  def"), "ABC DEF");
});

test("registrationYear reads the plate year suffix", () => {
  const now = new Date(2026, 9, 26);
  assert.equal(registrationYear("GR 1234-23", now), 2023);
  assert.equal(registrationYear("GT 10-99", now), 1999);
  assert.equal(registrationYear("ABC DEF", now), null);
});

test("vehicleAgeBand bands by age", () => {
  const now = new Date(2026, 0, 1);
  assert.equal(vehicleAgeBand(2026, now), "new");
  assert.equal(vehicleAgeBand(2025, now), "new");
  assert.equal(vehicleAgeBand(2023, now), "recent");
  assert.equal(vehicleAgeBand(2019, now), "mid");
  assert.equal(vehicleAgeBand(2012, now), "old");
  assert.equal(vehicleAgeBand(2005, now), "vintage");
  assert.equal(vehicleAgeBand(null, now), null);
});

test("quickQuoteFields splits the motor schema into a 3-field start and the rest", () => {
  const motor = ["cover_type", "vehicle_make", "vehicle_model", "vehicle_year", "vehicle_value", "registration_number", "use", "driver_age", "region"].map((key) => ({ key }));
  const { quick, rest } = quickQuoteFields(motor);
  assert.deepEqual(quick.map((f) => f.key), ["vehicle_value", "registration_number", "use"]);
  assert.deepEqual(rest.map((f) => f.key), ["cover_type", "vehicle_make", "vehicle_model", "vehicle_year", "driver_age", "region"]);
  const travel = ["destination_region", "trip_days"].map((key) => ({ key }));
  assert.deepEqual(quickQuoteFields(travel), { quick: [], rest: travel });
});

test("prefillFromLookup fills gaps only", () => {
  const out = prefillFromLookup({ vehicle_make: "", vehicle_model: "Corolla", use: "" }, { make: "Toyota", model: "Camry", year: 2020, use: "private" });
  assert.deepEqual(out, { vehicle_make: "Toyota", vehicle_model: "Corolla", use: "private", vehicle_year: "2020" });
});
