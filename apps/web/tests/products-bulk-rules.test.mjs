// Insurer product management (Roadmap Phase 1, migration 20261101100000): the product status guard
// (insurers pause / republish / withdraw; publishing and un-withdrawing stay with Covva compliance),
// `bulk_set_product_status` (preview-honest skips, audited with a reason) and `product_change_history`
// (members of the owning insurer and staff only) — exercised through Supabase Auth + PostgREST as each role.
// Run:  node --test apps/web/tests/products-bulk-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// A dedicated product `E2E-BULK…` is created by the demo underwriter so the shared demo catalogue is never
// paused. The positive path (pause → republish → withdraw) needs an approved current version, which only the
// service role can set directly; without SUPABASE_SECRET_KEY those steps are skipped and the guard, skips and
// history are still asserted on the draft product. The product is withdrawn at the end (never deleted).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp } from "./_lib/supabase.mjs";

const TAG = "E2E-BULK";
const RUN = `${TAG} ${stamp()}`;

function expectRule(r, pattern) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected trigger error P0001, got ${r.code}: ${r.message}`);
  if (pattern) assert.match(r.message ?? "", pattern);
}
function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}

const sessions = {};
const ids = {};

before(async () => {
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  sessions.claims = await signIn(ACCOUNTS.claims); // insurer member without product rights
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.admin = await signIn(ACCOUNTS.admin);
  const pub = anon();
  const orgs = (await pub.get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  ids.otherInsurerProduct = (await pub.get(`products?select=id&status=eq.approved&insurer_org_id=neq.${ids.insurer}&limit=1`)).body?.[0]?.id ?? null;
  const category = (await pub.get("product_categories?select=id&slug=eq.motor&limit=1")).body?.[0]?.id ?? (await pub.get("product_categories?select=id&limit=1")).body?.[0]?.id;
  assert.ok(ids.insurer && category, "seed data (an insurer, a category) must exist");
  const db = asUser(sessions.underwriter);
  const created = await db.insert("products", { insurer_org_id: ids.insurer, category_id: category, name: RUN, code: `${TAG}_${stamp()}`, status: "draft", data_owner_id: sessions.underwriter.userId }, { select: "id" });
  expectOk(created);
  ids.product = created.body[0].id;
  if (hasServiceKey()) {
    // Only the platform publishes: an approved version becomes the current one and the product goes live.
    const svc = service();
    const v = await svc.insert("product_versions", { product_id: ids.product, version: 1, status: "approved", compliance_status: "published", effective_from: new Date().toISOString().slice(0, 10), approved_at: new Date().toISOString() }, { select: "id" });
    expectOk(v);
    ids.version = v.body[0].id;
    expectOk(await svc.update(`products?id=eq.${ids.product}`, { current_version_id: ids.version, status: "approved" }));
    ids.published = true;
  }
});

after(async () => {
  // Never delete: withdraw the test product so it stays auditable and off sale.
  if (ids.product && hasServiceKey()) await service().update(`products?id=eq.${ids.product}`, { status: "retired" });
});

describe("anonymous visitors", () => {
  test("cannot bulk-update or read a product's history", async () => {
    const pub = anon();
    assert.ok((await pub.rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "pause", p_reason: `${RUN} anon` })).status >= 400);
    assert.ok((await pub.rpc("product_change_history", { p_product_id: ids.product })).status >= 400);
  });
});

describe("the status guard", () => {
  test("an insurer user cannot publish a product directly; only Covva compliance does", async (t) => {
    if (ids.published) return t.skip("product already published by the service role; the draft case is covered without a service key");
    const db = asUser(sessions.underwriter);
    expectRule(await db.update(`products?id=eq.${ids.product}`, { status: "approved" }), /Covva compliance/);
  });

  test("a claims officer cannot change product status (RLS) and a broker cannot touch it", async () => {
    const claims = await asUser(sessions.claims).update(`products?id=eq.${ids.product}`, { status: "suspended" });
    assert.ok(claims.status >= 400 || claims.body.length === 0, `claims officer: ${claims.status} ${JSON.stringify(claims.body)}`);
    const broker = await asUser(sessions.broker).update(`products?id=eq.${ids.product}`, { status: "suspended" });
    assert.ok(broker.status >= 400 || broker.body.length === 0, `broker: ${broker.status}`);
  });
});

describe("bulk_set_product_status", () => {
  test("rejects outsiders, missing reasons, unknown actions and mixed insurers with plain messages", async () => {
    expectRule(await asUser(sessions.customer).rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "pause", p_reason: `${RUN} customer` }), /owners, admins and underwriters/);
    expectRule(await asUser(sessions.broker).rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "pause", p_reason: `${RUN} broker` }), /owners, admins and underwriters/);
    expectRule(await asUser(sessions.claims).rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "pause", p_reason: `${RUN} claims` }), /owners, admins and underwriters/);
    const db = asUser(sessions.underwriter);
    expectRule(await db.rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "pause", p_reason: "x" }), /reason/);
    expectRule(await db.rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "delete", p_reason: `${RUN} bad action` }), /pause, withdraw or republish/);
    expectRule(await db.rpc("bulk_set_product_status", { p_product_ids: [], p_action: "pause", p_reason: `${RUN} empty` }), /at least one/);
    if (ids.otherInsurerProduct) {
      expectRule(await db.rpc("bulk_set_product_status", { p_product_ids: [ids.product, ids.otherInsurerProduct], p_action: "pause", p_reason: `${RUN} mixed` }), /one insurer/);
    }
  });

  test("skips are reported, not raised: a draft product cannot be paused", async (t) => {
    if (ids.published) return t.skip("product is published in this run");
    const r = await asUser(sessions.underwriter).rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "pause", p_reason: `${RUN} draft pause` });
    expectOk(r);
    assert.equal(r.body.updated, 0);
    assert.equal(r.body.skipped?.[0]?.reason, "only published products can be paused");
    const republish = await asUser(sessions.underwriter).rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "republish", p_reason: `${RUN} draft republish` });
    expectOk(republish);
    assert.equal(republish.body.skipped?.[0]?.reason, "only paused products can be republished");
  });

  test("pause → republish → withdraw, each audited, with one bulk row carrying the reason", async (t) => {
    if (!ids.published) return t.skip("needs SUPABASE_SECRET_KEY to publish the test product");
    const db = asUser(sessions.underwriter);
    const paused = await db.rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "pause", p_reason: `${RUN} rates under review` });
    expectOk(paused);
    assert.equal(paused.body.updated, 1);
    assert.equal(paused.body.status, "suspended");
    assert.equal((await db.get(`products?select=status&id=eq.${ids.product}`)).body[0].status, "suspended");
    const again = await db.rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "pause", p_reason: `${RUN} twice` });
    expectOk(again);
    assert.equal(again.body.skipped?.[0]?.reason, "already paused", "idempotent, explained");
    const back = await db.rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "republish", p_reason: `${RUN} review finished` });
    expectOk(back);
    assert.equal(back.body.updated, 1);
    const gone = await db.rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "withdraw", p_reason: `${RUN} retired for 2027` });
    expectOk(gone);
    assert.equal(gone.body.status, "retired");
    const cannot = await db.rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "republish", p_reason: `${RUN} bring back` });
    expectOk(cannot);
    assert.equal(cannot.body.updated, 0);
    assert.match(cannot.body.skipped?.[0]?.reason ?? "", /Covva compliance/, "a withdrawn product is not republished by the insurer");
    expectRule(await db.update(`products?id=eq.${ids.product}`, { status: "approved" }), /Covva compliance/);
    // Staff bring it back (and the test leaves it withdrawn in after()).
    const staff = await asUser(sessions.admin).rpc("bulk_set_product_status", { p_product_ids: [ids.product], p_action: "republish", p_reason: `${RUN} compliance cleared` });
    expectOk(staff);
    assert.equal(staff.body.updated, 1);
    // Audit: the products trigger wrote one row per status change, plus one bulk row per action with the reason.
    const audit = await asUser(sessions.admin).get(`audit_events?select=action,data&or=(entity_id.eq.${ids.product},action.like.products.bulk_*)&order=id.desc&limit=40`);
    expectOk(audit);
    const statusChanges = audit.body.filter((a) => a.action === "update" && a.data?.changes?.status);
    assert.ok(statusChanges.length >= 4, `every status change audited (${statusChanges.length})`);
    const bulk = audit.body.filter((a) => a.action.startsWith("products.bulk_") && (a.data?.product_ids ?? []).includes(ids.product));
    assert.ok(bulk.some((a) => a.data?.reason === `${RUN} rates under review`), "the reason is kept");
    assert.ok(bulk.every((a) => typeof a.data?.count === "number"), "bulk rows carry the count");
  });
});

describe("product_change_history", () => {
  test("any active member of the insurer reads it; others are refused", async () => {
    const underwriter = await asUser(sessions.underwriter).rpc("product_change_history", { p_product_id: ids.product, p_limit: 50 });
    expectOk(underwriter);
    assert.ok(Array.isArray(underwriter.body) && underwriter.body.length >= 1, "the product's creation is in its history");
    const insert = underwriter.body.find((r) => r.entity_type === "products" && r.action === "insert");
    assert.ok(insert, "creation row present");
    assert.equal(insert.changes?.name, RUN, "whitelisted fields only");
    assert.equal(insert.actor_name?.length > 0, true, "members are named");
    const claims = await asUser(sessions.claims).rpc("product_change_history", { p_product_id: ids.product });
    expectOk(claims);
    if (ids.published) {
      const bulk = underwriter.body.filter((r) => r.action.startsWith("products.bulk_"));
      assert.ok(bulk.some((r) => r.note === `${RUN} rates under review`), "bulk rows carry the reason as note");
      assert.ok(underwriter.body.some((r) => r.action === "update" && r.changes?.status?.to === "suspended"), "status changes show from → to");
      const staffRow = underwriter.body.find((r) => r.action === "products.bulk_republish");
      assert.equal(staffRow?.actor_name ?? null, null, "staff actors are not named to the insurer");
    }
    expectRule(await asUser(sessions.broker).rpc("product_change_history", { p_product_id: ids.product }), /own organisation/);
    expectRule(await asUser(sessions.customer).rpc("product_change_history", { p_product_id: ids.product }), /own organisation/);
    expectRule(await asUser(sessions.underwriter).rpc("product_change_history", { p_product_id: "00000000-0000-0000-0000-000000000000" }), /not found/);
  });

  test("rate tables added to a version show up with the version number", async (t) => {
    if (!ids.version) return t.skip("needs the published version");
    const db = asUser(sessions.underwriter);
    const table = await db.insert("rate_tables", { product_version_id: ids.version, name: `${RUN} table`, factor_keys: ["region"], status: "draft", source: "csv", submitted_by: sessions.underwriter.userId, submitted_by_org_id: ids.insurer }, { select: "id" });
    expectOk(table);
    const history = await db.rpc("product_change_history", { p_product_id: ids.product, p_limit: 50 });
    expectOk(history);
    const row = history.body.find((r) => r.entity_type === "rate_tables" && r.entity_id === table.body[0].id);
    assert.ok(row, "rate table creation is in the product's history");
    assert.equal(row.version_no, 1);
    assert.equal(row.entity_label, `${RUN} table`);
  });

  test("the audit chain still verifies", async () => {
    const r = await asUser(sessions.admin).rpc("verify_audit_chain", { p_limit: 100000 });
    expectOk(r);
    assert.equal(r.body?.[0]?.ok ?? r.body?.ok, true);
  });
});
