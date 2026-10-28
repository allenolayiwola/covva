import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bulkPlanSummary,
  bulkRateImportTemplate,
  describeProductChange,
  groupHistoryByDay,
  parseBulkRateImport,
  pickImportTargetVersion,
  planBulkStatus,
  productStatusLabel,
  type ProductHistoryRow,
} from "./product-management.ts";

const products = [
  { id: "p1", name: "Motor Standard", status: "approved", currentVersionStatus: "approved" },
  { id: "p2", name: "Travel", status: "suspended", currentVersionStatus: "approved" },
  { id: "p3", name: "Draft Home", status: "draft", currentVersionStatus: null },
  { id: "p4", name: "Old Life", status: "retired", currentVersionStatus: "approved" },
  { id: "p5", name: "Paused no version", status: "suspended", currentVersionStatus: null },
];

test("bulk plan mirrors the database rules and explains every skip", () => {
  const pause = planBulkStatus(products, "pause");
  assert.deepEqual(pause.eligible.map((p) => p.id), ["p1"]);
  assert.deepEqual(pause.skipped.map((s) => [s.id, s.reason]), [
    ["p2", "already paused"],
    ["p3", "only published products can be paused"],
    ["p4", "only published products can be paused"],
    ["p5", "already paused"],
  ]);
  assert.equal(pause.target, "suspended");
  assert.equal(bulkPlanSummary(pause), "Pause 1 product (4 skipped)");

  const republish = planBulkStatus(products, "republish");
  assert.deepEqual(republish.eligible.map((p) => p.id), ["p2"]);
  assert.deepEqual(republish.skipped.map((s) => s.reason), ["already published", "only paused products can be republished", "withdrawn products are brought back by Covva compliance", "no approved version to republish"]);
  assert.deepEqual(planBulkStatus(products, "republish", { isStaff: true }).eligible.map((p) => p.id), ["p2", "p4"], "staff may bring withdrawn products back");

  const withdraw = planBulkStatus(products, "withdraw");
  assert.deepEqual(withdraw.eligible.map((p) => p.id), ["p1", "p2", "p5"]);
  assert.equal(bulkPlanSummary(withdraw), "Withdraw 3 products (2 skipped)");
  assert.throws(() => planBulkStatus(products, "delete" as never), /Unknown bulk action/);
});

test("status labels speak the insurer's language", () => {
  assert.equal(productStatusLabel("approved"), "Published");
  assert.equal(productStatusLabel("suspended"), "Paused");
  assert.equal(productStatusLabel("retired"), "Withdrawn");
  assert.equal(productStatusLabel("pending_approval"), "Awaiting approval");
  assert.equal(productStatusLabel(null), "—");
});

const catalogue = [
  { id: "p1", code: "MOTOR_STD", name: "Motor Standard" },
  { id: "p2", code: "MOTOR_PLUS", name: "Motor Plus" },
];

test("bulk CSV import splits rows per product and keeps file line numbers in errors", () => {
  const csv = [
    "product_code,vehicle_use,region,rate,rate_kind,min_premium",
    "MOTOR_STD,private,*,0.045,rate_on_value,200",
    "motor_std,commercial,*,0.06,rate_on_value,350",
    "MOTOR_PLUS,private,*,0.05,,",
    "MOTOR_PLUS,private,*,abc,rate_on_value,",
    "MOTOR_PLUS,private,*,0.05,rate_on_value,",
    "HOME_X,*,*,0.01,flat,",
    ",private,*,0.01,flat,",
  ].join("\n");
  const r = parseBulkRateImport(csv, ["vehicle_use", "region"], catalogue);
  assert.equal(r.totalRows, 7);
  assert.deepEqual(r.groups.map((g) => [g.code, g.rows.length, g.errors.map((e) => e.row)]), [
    ["MOTOR_PLUS", 1, [5, 5, 6]],
    ["MOTOR_STD", 2, []],
  ]);
  const plus = r.groups[0]!;
  assert.match(plus.errors[0]!.message, /rate "abc" is not a number/);
  assert.match(plus.errors[1]!.message, /Duplicate of row 4 \(same factors\)/);
  assert.match(plus.errors[2]!.message, /Duplicate of row 4/);
  assert.equal(r.groups[1]!.rows[1]!.rate, 0.06);
  assert.deepEqual(r.groups[1]!.rows[0]!.factors, { vehicle_use: "private", region: "*" });
  assert.deepEqual(r.unknownCodes, [{ code: "HOME_X", lines: 1 }]);
  assert.deepEqual(r.errors, [{ row: 8, message: "product_code is empty." }]);
  assert.equal(r.ok, false, "a bad row blocks the import");

  const clean = parseBulkRateImport(["product_code,vehicle_use,region,rate", "MOTOR_STD,private,*,4.5%", "MOTOR_PLUS,*,*,0.05"].join("\n"), ["vehicle_use", "region"], catalogue);
  assert.equal(clean.ok, true);
  assert.equal(clean.groups.find((g) => g.code === "MOTOR_STD")!.rows[0]!.rate, 0.045);
});

test("bulk CSV import reports missing columns, an empty file and unknown columns once", () => {
  assert.deepEqual(parseBulkRateImport("", ["region"], catalogue).errors, [{ row: 1, message: "The file is empty." }]);
  assert.match(parseBulkRateImport("region,rate\n*,0.1", ["region"], catalogue).errors[0]!.message, /Missing column: product_code/);
  assert.match(parseBulkRateImport("product_code,rate\nMOTOR_STD,0.1", ["region"], catalogue).errors[0]!.message, /Missing column: region/);
  const extra = parseBulkRateImport("product_code,region,rate,comment\nMOTOR_STD,*,0.1,hello", ["region"], catalogue);
  assert.equal(extra.ok, true);
  assert.deepEqual(extra.errors, [{ row: 1, message: "Unknown column ignored: comment." }]);
  assert.equal(extra.groups[0]!.errors.length, 0, "the unknown-column note is not repeated per product");
  const onlyUnknown = parseBulkRateImport("product_code,region,rate\nNOPE,*,0.1", ["region"], catalogue);
  assert.equal(onlyUnknown.ok, false);
  assert.deepEqual(onlyUnknown.unknownCodes, [{ code: "NOPE", lines: 1 }]);
});

test("bulk template lists every product and the import target version prefers a draft", () => {
  const t = bulkRateImportTemplate(["region"], catalogue);
  assert.equal(t.split("\n")[0], "product_code,region,rate,rate_kind,min_premium");
  assert.equal(t.trim().split("\n").length, 3);
  assert.match(bulkRateImportTemplate(["region"], []), /PRODUCT_CODE/);
  const versions = [
    { id: "v1", version: 1, status: "approved" },
    { id: "v2", version: 2, status: "draft" },
    { id: "v3", version: 3, status: "pending_approval" },
  ];
  assert.deepEqual(pickImportTargetVersion(versions, "v1"), { version: versions[1], why: "draft" });
  assert.deepEqual(pickImportTargetVersion(versions.filter((v) => v.status !== "draft"), "v1"), { version: versions[0], why: "current" });
  assert.deepEqual(pickImportTargetVersion(versions.filter((v) => v.status !== "draft"), null), { version: versions[2], why: "latest" });
  assert.equal(pickImportTargetVersion([], null), null);
});

const row = (over: Partial<ProductHistoryRow>): ProductHistoryRow => ({ event_id: 1, occurred_at: "2026-11-01T09:30:00Z", actor_id: "u1", actor_name: "Ama Owusu", actor_role: "authenticated", action: "update", entity_type: "products", entity_id: "p1", version_no: null, entity_label: "Motor Standard", changes: {}, note: null, ...over });

test("change history lines: product status, versions, rate tables, rules, bulk actions", () => {
  const paused = describeProductChange(row({ changes: { status: { from: "approved", to: "suspended" } } }));
  assert.equal(paused.title, "Paused");
  assert.deepEqual(paused.details, ["Published → Paused"]);
  assert.equal(paused.tone, "wait");
  assert.equal(paused.scope, "Product");

  const bulk = describeProductChange(row({ action: "products.bulk_withdraw", note: "Retired for 2027", changes: {} }));
  assert.equal(bulk.title, "Withdrawn (bulk update)");
  assert.deepEqual(bulk.details, ["Reason: Retired for 2027"]);
  assert.equal(bulk.tone, "danger");

  const published = describeProductChange(row({ entity_type: "product_versions", version_no: 3, changes: { status: { from: "pending_approval", to: "approved" }, compliance_status: { from: "in_review", to: "published" }, approved_at: { from: null, to: "2026-11-01T09:30:00Z" }, compliance_notes: { from: null, to: "Wording checked." } } }));
  assert.equal(published.title, "V3 published");
  assert.deepEqual(published.details, ["Compliance note: Wording checked."]);
  assert.equal(published.tone, "ok");
  assert.equal(published.scope, "Version 3");

  const returned = describeProductChange(row({ entity_type: "product_versions", version_no: 4, changes: { compliance_status: { from: "submitted", to: "returned" } } }));
  assert.equal(returned.title, "V4 returned by compliance");
  assert.equal(returned.tone, "danger");

  const pricing = describeProductChange(row({ entity_type: "product_versions", version_no: 4, changes: { rating: { changed: true } } }));
  assert.equal(pricing.title, "V4 pricing rule changed");
  assert.deepEqual(pricing.details, []);

  const created = describeProductChange(row({ action: "insert", entity_type: "product_versions", version_no: 5, changes: { version: 5, status: "pending_approval", effective_from: "2027-01-01", issuance_type: "instant" } }));
  assert.equal(created.title, "V5 created and submitted for approval");
  assert.deepEqual(created.details, ["Effective from: 2027-01-01", "Issuance type: instant"]);

  const table = describeProductChange(row({ action: "insert", entity_type: "rate_tables", version_no: 2, entity_label: "Motor 2027", changes: { name: "Motor 2027", status: "draft", source: "csv", factor_keys: ["vehicle_use"] } }));
  assert.equal(table.title, "Rate table “Motor 2027” added to v2");
  assert.deepEqual(table.details, ["Source: csv", "Factor keys: vehicle_use"]);
  const submitted = describeProductChange(row({ entity_type: "rate_tables", version_no: 2, entity_label: "Motor 2027", changes: { status: { from: "draft", to: "pending_review" } } }));
  assert.equal(submitted.title, "Rate table “Motor 2027”: submitted for covva review");
  assert.equal(submitted.tone, "wait");

  const rule = describeProductChange(row({ entity_type: "underwriting_rules", version_no: 2, entity_label: "Young driver", changes: { active: { from: true, to: false } } }));
  assert.equal(rule.title, "Rule “Young driver” disabled");
  const dates = describeProductChange(row({ entity_type: "product_versions", version_no: 1, changes: { effective_to: { from: null, to: "2026-12-31" } } }));
  assert.equal(dates.title, "V1 effective dates changed");
  assert.deepEqual(dates.details, ["Effective to: — → 2026-12-31"]);
});

test("actors: members by name, compliance staff anonymised, automation labelled", () => {
  assert.equal(describeProductChange(row({})).actor, "Ama Owusu");
  assert.equal(describeProductChange(row({ actor_name: null })).actor, "Covva compliance");
  assert.equal(describeProductChange(row({ actor_name: null, actor_id: null, actor_role: "service_role" })).actor, "Platform (automated)");
  assert.equal(describeProductChange(row({ actor_name: null, actor_id: null, actor_role: "postgres" })).actor, "System");
});

test("history groups by day, newest first", () => {
  const lines = [
    describeProductChange(row({ event_id: 1, occurred_at: "2026-10-30T08:00:00Z" })),
    describeProductChange(row({ event_id: 3, occurred_at: "2026-11-01T09:00:00Z" })),
    describeProductChange(row({ event_id: 2, occurred_at: "2026-11-01T08:00:00Z" })),
  ];
  assert.deepEqual(groupHistoryByDay(lines).map((g) => [g.day, g.lines.map((l) => l.id)]), [["2026-11-01", [3, 2]], ["2026-10-30", [1]]]);
});
