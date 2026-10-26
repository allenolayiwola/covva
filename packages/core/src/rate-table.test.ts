import { test } from "node:test";
import assert from "node:assert/strict";
import { lookupRate, parseRateTableCsv, rateFromTable, rateTableCsvTemplate, rateTableToCsv, type RateRow, type RateTableDef } from "./rate-table.ts";

const KEYS = ["vehicle_use", "vehicle_age_band", "region"];
const rows: RateRow[] = [
  { id: "any", factors: { vehicle_use: "*", vehicle_age_band: "*", region: "*" }, rate: 0.06, rate_kind: "rate_on_value", min_premium: 500 },
  { id: "private", factors: { vehicle_use: "private", vehicle_age_band: "*", region: "*" }, rate: 0.045, rate_kind: "rate_on_value", min_premium: 400 },
  { id: "private-old", factors: { vehicle_use: "private", vehicle_age_band: "over_10", region: "*" }, rate: 0.055, rate_kind: "rate_on_value" },
  { id: "private-accra", factors: { vehicle_use: "private", vehicle_age_band: "*", region: "Greater Accra" }, rate: 0.05, rate_kind: "rate_on_value" },
  {
    id: "commercial",
    factors: { vehicle_use: "commercial" },
    rate: 0.08,
    rate_kind: "rate_on_value",
    loadings: [{ field: "driver_age", lt: 25, factor: 1.3, label: "Young driver" }],
  },
];
const table: RateTableDef = { factor_keys: KEYS, value_fields: ["vehicle_value"] };

test("lookupRate: exact match beats wildcards; most specific row wins deterministically", () => {
  assert.equal(lookupRate(rows, { vehicle_use: "private", vehicle_age_band: "over_10", region: "Ashanti" }, KEYS)?.id, "private-old");
  assert.equal(lookupRate(rows, { vehicle_use: "private", vehicle_age_band: "under_5", region: "Ashanti" }, KEYS)?.id, "private");
  assert.equal(lookupRate(rows, { vehicle_use: "taxi", vehicle_age_band: "under_5", region: "Ashanti" }, KEYS)?.id, "any");
  // Two rows with the same specificity (private-old vs private-accra): the earlier row wins.
  assert.equal(lookupRate(rows, { vehicle_use: "private", vehicle_age_band: "over_10", region: "Greater Accra" }, KEYS)?.id, "private-old");
  // Matching is case/whitespace-insensitive and a row missing a key treats it as a wildcard.
  assert.equal(lookupRate(rows, { vehicle_use: " Commercial ", vehicle_age_band: "x", region: "y" }, KEYS)?.id, "commercial");
  assert.equal(lookupRate([], { vehicle_use: "private" }, KEYS), null);
  assert.equal(lookupRate([rows[2]!], { vehicle_use: "private", vehicle_age_band: "under_5" }, KEYS), null, "a specific row does not match a different value");
});

test("rateFromTable: produces the ratePremium shape with lines, loadings and minimum premium", () => {
  const r = rateFromTable(table, rows, { vehicle_use: "private", vehicle_age_band: "under_5", region: "Ashanti", vehicle_value: 100_000 });
  assert.equal(r.ok, true);
  assert.equal(r.sumInsured, 100_000);
  assert.equal(r.basePremium, 4500);
  assert.equal(r.premium, 4500);
  assert.deepEqual(r.missingFields, []);
  assert.ok(r.lines[0]!.label.startsWith("4.50% of GH₵ 100,000"));

  const young = rateFromTable(table, rows, { vehicle_use: "commercial", vehicle_age_band: "under_5", region: "Volta", vehicle_value: 50_000, driver_age: 22 });
  assert.equal(young.basePremium, 4000);
  assert.equal(young.premium, 5200);
  assert.deepEqual(young.appliedLoadings, ["Young driver"]);

  const tiny = rateFromTable(table, rows, { vehicle_use: "private", vehicle_age_band: "under_5", region: "Volta", vehicle_value: 1000 });
  assert.equal(tiny.premium, 400, "row minimum premium applies");
  assert.ok(tiny.lines.some((l) => l.label === "Minimum premium applies"));

  const missing = rateFromTable(table, rows, { vehicle_use: "private", vehicle_value: 20_000 });
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.missingFields, ["vehicle_age_band", "region"]);
  assert.equal(missing.premium, 900, "still prices from the wildcard row so the simulator can show the number");
});

test("rateFromTable: flat and per-unit rows, and no matching row", () => {
  const flat: RateRow[] = [{ factors: { plan: "basic" }, rate: 300, rate_kind: "flat" }, { factors: { plan: "family" }, rate: 90, rate_kind: "per_unit", min_premium: 400 }];
  const def: RateTableDef = { factor_keys: ["plan"], units_field: "members" };
  assert.equal(rateFromTable(def, flat, { plan: "basic" }).premium, 300);
  const fam = rateFromTable(def, flat, { plan: "family", members: 6 });
  assert.equal(fam.premium, 540);
  assert.equal(rateFromTable(def, flat, { plan: "family", members: 2 }).premium, 400);
  const none = rateFromTable(def, flat, { plan: "gold" });
  assert.equal(none.ok, false);
  assert.equal(none.premium, 0);
  assert.ok(none.missingFields.includes("rate_table_row"));
});

test("CSV: template round-trips through the parser; errors carry row numbers", () => {
  const tpl = rateTableCsvTemplate(KEYS);
  assert.equal(tpl.split("\n")[0], "vehicle_use,vehicle_age_band,region,rate,rate_kind,min_premium");
  const parsed = parseRateTableCsv(tpl, KEYS);
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.rows.length, 1);
  assert.deepEqual(parsed.rows[0]!.factors, { vehicle_use: "*", vehicle_age_band: "*", region: "*" });
  assert.equal(parsed.rows[0]!.rate, 0.045);
  assert.equal(parsed.rows[0]!.min_premium, 200);

  const csv = [
    "vehicle_use,vehicle_age_band,region,rate,rate_kind,min_premium,notes",
    'private,*,"Greater Accra",4.5%,rate_on_value,400,ok',
    "private,,Ashanti,0.05,,,",
    "commercial,*,*,abc,rate_on_value,,",
    "taxi,*,*,0.07,weird,,",
    "private,*,Greater Accra,0.06,rate_on_value,,",
    "fleet,*,*,0.09,rate_on_value,-5,",
  ].join("\r\n");
  const p2 = parseRateTableCsv(csv, KEYS);
  assert.equal(p2.rows.length, 1, "only the valid row survives");
  assert.deepEqual(p2.rows[0]!.factors, { vehicle_use: "private", vehicle_age_band: "*", region: "Greater Accra" });
  assert.equal(p2.rows[0]!.rate, 0.045, "percent rates are converted");
  const byRow = Object.fromEntries(p2.errors.map((e) => [e.row, e.message]));
  assert.match(byRow[1]!, /Unknown column.*notes/);
  assert.match(byRow[3]!, /vehicle_age_band is empty/);
  assert.match(byRow[4]!, /rate "abc"/);
  assert.match(byRow[5]!, /rate_kind "weird"/);
  assert.match(byRow[6]!, /Duplicate of row 2/);
  assert.match(byRow[7]!, /min_premium "-5"/);

  const missingCols = parseRateTableCsv("vehicle_use,rate\nprivate,0.1\n", KEYS);
  assert.equal(missingCols.rows.length, 0);
  assert.match(missingCols.errors[0]!.message, /Missing columns: vehicle_age_band, region/);
  assert.match(parseRateTableCsv("", KEYS).errors[0]!.message, /empty/);

  const back = rateTableToCsv(KEYS, p2.rows);
  assert.equal(parseRateTableCsv(back, KEYS).rows[0]!.rate, 0.045);
});
