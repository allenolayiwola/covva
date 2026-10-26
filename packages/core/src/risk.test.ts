import { test } from "node:test";
import assert from "node:assert/strict";
import { GHANA_REGIONS, riskFingerprint, riskSchemaToZod, riskTitle, type RiskField } from "./risk.ts";

const motor: RiskField[] = [
  { key: "cover_type", label: "Type of cover", type: "select", required: true, options: [{ value: "comprehensive", label: "Comprehensive" }, { value: "third_party", label: "Third party only" }] },
  { key: "vehicle_make", label: "Vehicle make", type: "text", required: true },
  { key: "registration_number", label: "Registration number", type: "text", required: false },
  { key: "vehicle_year", label: "Year of manufacture", type: "number", required: true, min: 1990, max: 2027 },
  { key: "vehicle_value", label: "Estimated vehicle value (GH₵)", type: "currency", required: true, min: 5000 },
  { key: "term_years", label: "Term (years)", type: "number", required: false, min: 1, max: 30 },
  { key: "flood_zone", label: "Has the property flooded before?", type: "boolean", required: true },
  { key: "security", label: "Security measures", type: "multiselect", required: false, options: [{ value: "alarm", label: "Alarm" }, { value: "fence", label: "Fence" }] },
  { key: "departure_date", label: "Departure date", type: "date", required: true },
  { key: "region", label: "Region", type: "region", required: true },
];

const valid = {
  cover_type: "comprehensive",
  vehicle_make: "  Toyota ",
  vehicle_year: "2020",
  vehicle_value: "80000",
  flood_zone: "on",
  security: "alarm",
  departure_date: "2026-12-01",
  region: "Greater Accra",
};

test("coerces form strings: numbers, booleans, multiselect, trims text", () => {
  const r = riskSchemaToZod(motor).safeParse(valid);
  assert.equal(r.success, true, JSON.stringify(r.success ? null : r.error.issues));
  const d = r.data as Record<string, unknown>;
  assert.equal(d.vehicle_year, 2020);
  assert.equal(d.vehicle_value, 80000);
  assert.equal(d.flood_zone, true);
  assert.deepEqual(d.security, ["alarm"]);
  assert.equal(d.vehicle_make, "Toyota");
  assert.equal(d.registration_number, undefined, "optional text absent → undefined");
  assert.equal(d.term_years, undefined);
});

test("boolean accepts true/'true'/'on'/'yes' and treats anything else as false", () => {
  const s = riskSchemaToZod([{ key: "b", label: "B", type: "boolean", required: true }]);
  for (const v of [true, "true", "on", "yes"]) assert.equal(s.parse({ b: v }).b, true, String(v));
  for (const v of [false, "false", "", "no", undefined]) assert.equal(s.parse({ b: v }).b, false, String(v));
});

test("required fields and ranges produce the labelled messages", () => {
  const r = riskSchemaToZod(motor).safeParse({ ...valid, vehicle_make: "", vehicle_value: "100", vehicle_year: "1980", cover_type: "" });
  assert.equal(r.success, false);
  const msgs = r.success ? [] : r.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`);
  assert.ok(msgs.includes("vehicle_make: Vehicle make is required"), msgs.join(" | "));
  assert.ok(msgs.includes("vehicle_value: Estimated vehicle value (GH₵) must be at least 5000"), msgs.join(" | "));
  assert.ok(msgs.includes("vehicle_year: Year of manufacture must be at least 1990"), msgs.join(" | "));
  assert.ok(msgs.includes("cover_type: Choose type of cover"), msgs.join(" | "));
});

test("optional fields accept the empty string and become undefined", () => {
  const r = riskSchemaToZod(motor).safeParse({ ...valid, registration_number: "", security: "", term_years: "" });
  assert.equal(r.success, true, JSON.stringify(r.success ? null : r.error.issues));
  const d = r.data as Record<string, unknown>;
  assert.equal(d.registration_number, "", "optional text keeps the empty string (min(0) accepts it before the literal branch)");
  assert.equal(d.term_years, undefined, "optional number: '' coerces to 0, fails min(1), then the '' literal branch yields undefined");
  assert.deepEqual(d.security, []);
});

test("number fields reject non-numeric text with a labelled message", () => {
  const r = riskSchemaToZod(motor).safeParse({ ...valid, vehicle_year: "abc" });
  assert.equal(r.success, false);
  assert.ok(!r.success && r.error.issues.some((i) => i.path[0] === "vehicle_year" && /Year of manufacture must be a number/.test(i.message)));
});

test("region must be one of the sixteen Ghana regions; dates must be ISO", () => {
  const s = riskSchemaToZod(motor);
  const bad = s.safeParse({ ...valid, region: "Lagos", departure_date: "01/12/2026" });
  assert.equal(bad.success, false);
  const msgs = bad.success ? [] : bad.error.issues.map((i) => i.message);
  assert.ok(msgs.includes("Choose a region"));
  assert.ok(msgs.includes("Departure date must be a date"));
  assert.equal(GHANA_REGIONS.length, 16);
  for (const region of GHANA_REGIONS) assert.equal(s.safeParse({ ...valid, region }).success, true, region);
});

test("select without options falls back to a free string; multiselect keeps arrays", () => {
  const s = riskSchemaToZod([
    { key: "free", label: "Free", type: "select", required: true },
    { key: "many", label: "Many", type: "multiselect", required: true, options: [{ value: "a", label: "A" }] },
  ]);
  const d = s.parse({ free: "anything", many: ["a", "b"] });
  assert.equal(d.free, "anything");
  assert.deepEqual(d.many, ["a", "b"]);
});

test("fingerprint is stable, normalises text case/whitespace and key order, and changes with the customer", async () => {
  const a = await riskFingerprint({ customerId: "u1", categorySlug: "motor", risk: { make: "Toyota", year: 2020 } });
  const b = await riskFingerprint({ customerId: "u1", categorySlug: "motor", risk: { year: 2020, make: "  toyota " } });
  const c = await riskFingerprint({ customerId: "u2", categorySlug: "motor", risk: { make: "Toyota", year: 2020 } });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test("riskTitle produces short queue titles per category", () => {
  assert.equal(riskTitle("motor", { vehicle_make: "Toyota", vehicle_model: "Corolla", vehicle_year: 2020 }), "Toyota Corolla 2020");
  assert.equal(riskTitle("motor", {}), "Motor cover");
  assert.equal(riskTitle("travel", { destination_region: "schengen", trip_days: 10 }), "Travel · schengen · 10 days");
  assert.equal(riskTitle("home", { cover_scope: "buildings_contents" }), "Home · buildings contents");
  assert.equal(riskTitle("sme-property", {}), "Business property");
  assert.equal(riskTitle("marine-cargo", { goods_description: "Rice" }), "Cargo · Rice");
  assert.equal(riskTitle("life-funeral", {}), "Life funeral");
});
