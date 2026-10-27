// SME & group database rules (Roadmap Phase 3): business accounts, group schemes, scheme members (PII), fleet and
// consolidated statements — exercised through Supabase Auth + PostgREST as each role.
// Run:  node --test apps/web/tests/sme-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Rows are tagged `E2E-SME…` and never deleted (the service role has no DELETE on these tables): the demo customer
// re-uses one tagged business account across runs (accounts are capped at 5 per owner), each run's scheme is
// cancelled and its members/vehicles marked removed at the end. The broker-on-the-scheme block needs
// SUPABASE_SECRET_KEY (the broker of record is a platform write) and is skipped without it.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp } from "./_lib/supabase.mjs";

const TAG = "E2E-SME";
const RUN = `${TAG} ${stamp()}`;
const BUSINESS_NAME = `${TAG} Test Business`;

function expectRule(r, pattern) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected trigger error P0001, got ${r.code}: ${r.message}`);
  if (pattern) assert.match(r.message ?? "", pattern);
}
function expectRefused(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["42501", "P0001", "23503", "23514", "23502"].includes(r.code), `expected RLS/guard rejection, got ${r.code}: ${r.message}`);
}
function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}
const emptyOrRefused = (r, what) => assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${what}: ${r.status} ${JSON.stringify(r.body)}`);

const sessions = {};
const ids = {};

before(async () => {
  sessions.owner = await signIn(ACCOUNTS.customer);
  sessions.other = await signIn(ACCOUNTS.adviser); // a different signed-in person (not on the business, not on the scheme)
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  const pub = anon();
  ids.health = (await pub.get("product_categories?select=id&slug=eq.health")).body[0]?.id;
  const orgs = (await pub.get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  assert.ok(ids.health && ids.broker, "seed data (health category, demo broker) must exist");

  // One tagged business account for the demo customer, re-used across runs.
  const owner = asUser(sessions.owner);
  const mine = (await owner.get(`organizations?select=id,name,type&type=eq.enterprise&name=eq.${encodeURIComponent(BUSINESS_NAME)}`)).body;
  if (Array.isArray(mine) && mine.length) ids.org = mine[0].id;
  else {
    const r = await owner.rpc("create_business_account", { p_name: BUSINESS_NAME, p_profile: { industry: "Testing", employees: "12", billing_email: "e2e-sme@example.com", billing_contact: "E2E" } });
    expectOk(r);
    ids.org = r.body;
  }
  assert.ok(ids.org, "business account");
});

after(async () => {
  if (!ids.scheme) return;
  const owner = asUser(sessions.owner);
  await owner.update(`scheme_members?scheme_id=eq.${ids.scheme}`, { status: "removed" });
  await owner.update(`group_schemes?id=eq.${ids.scheme}`, { status: "cancelled" });
  if (ids.vehicle) await owner.update(`fleet_vehicles?id=eq.${ids.vehicle}`, { status: "removed" });
});

describe("anonymous visitors", () => {
  test("see nothing and cannot create business accounts", async () => {
    const pub = anon();
    for (const t of ["group_schemes", "scheme_members", "fleet_vehicles", "business_assets", "business_invoices"]) {
      emptyOrRefused(await pub.get(`${t}?select=id&limit=1`), t);
    }
    const rpc = await pub.rpc("create_business_account", { p_name: `${RUN} anon` });
    assert.ok(rpc.status >= 400, `expected rejection, got ${rpc.status}`);
    expectRefused(await pub.insert("group_schemes", { business_org_id: ids.org, category_id: ids.health, name: `${RUN} anon` }));
  });
});

describe("business owner", () => {
  let db;
  before(() => {
    db = asUser(sessions.owner);
  });

  test("is the owner of the business account and reads its profile", async () => {
    const m = await db.get(`memberships?select=role&org_id=eq.${ids.org}&user_id=eq.${sessions.owner.userId}`);
    expectOk(m);
    assert.equal(m.body[0]?.role, "owner");
    const o = await db.get(`organizations?select=type,business_profile&id=eq.${ids.org}`);
    assert.equal(o.body[0]?.type, "enterprise");
    assert.equal(o.body[0]?.business_profile?.industry, "Testing");
  });

  test("creates a draft scheme (placement fields are the platform's) and reads its own members", async () => {
    const s = await db.insert("group_schemes", { business_org_id: ids.org, category_id: ids.health, name: `${RUN} staff health`, status: "active", broker_org_id: ids.broker });
    expectOk(s);
    ids.scheme = s.body[0].id;
    assert.equal(s.body[0].status, "draft", "status is forced to draft");
    assert.equal(s.body[0].broker_org_id, null, "the business cannot pick the broker of record");

    const e = await db.insert("scheme_members", { scheme_id: ids.scheme, full_name: `${RUN} Kwame`, employee_ref: "E1", relationship: "employee", phone: "+233200000001", date_of_birth: "1990-01-01", user_id: sessions.owner.userId });
    expectOk(e);
    ids.employee = e.body[0].id;
    assert.equal(e.body[0].user_id, null, "accounts are linked by verified phone, never set by the business");
    const c = await db.insert("scheme_members", { scheme_id: ids.scheme, full_name: `${RUN} Kid`, relationship: "child", principal_member_id: ids.employee });
    expectOk(c);

    const list = await db.get(`scheme_members?select=id,full_name,relationship&scheme_id=eq.${ids.scheme}`);
    expectOk(list);
    assert.equal(list.body.length, 2);
    const scheme = await db.get(`group_schemes?select=member_count&id=eq.${ids.scheme}`);
    assert.equal(scheme.body[0].member_count, 2, "member_count follows the census");
  });

  test("guards: dependants need an employee; status follows placement; accounts link only by phone", async () => {
    expectRefused(await db.insert("scheme_members", { scheme_id: ids.scheme, full_name: `${RUN} Orphan`, relationship: "spouse" }));
    expectRule(await db.update(`group_schemes?id=eq.${ids.scheme}`, { status: "active" }), /only cancel/i);
    expectRule(await db.update(`scheme_members?id=eq.${ids.employee}`, { user_id: sessions.owner.userId }), /same phone/i);
    // Business accounts only use business roles.
    expectRule(await db.insert("invitations", { org_id: ids.org, email: `e2e-sme-${Date.now()}@example.com`, role: "adviser" }), /owner, admin, finance and viewer/);
  });

  test("adds a vehicle with a normalised registration", async () => {
    const reg = `e2e  ${String(Date.now()).slice(-4)}-26`;
    const v = await db.insert("fleet_vehicles", { business_org_id: ids.org, registration: reg, make: "Toyota", use: "commercial", policy_id: null });
    expectOk(v);
    ids.vehicle = v.body[0].id;
    assert.equal(v.body[0].registration, reg.toUpperCase().replace(/\s+/g, " "));
  });

  test("link_my_scheme_memberships is callable (no verified phone → nothing linked)", async () => {
    const r = await db.rpc("link_my_scheme_memberships", {});
    expectOk(r);
    assert.equal(typeof r.body, "number");
  });
});

describe("a different signed-in person", () => {
  test("cannot read or add members, fleet or statements of the business", async () => {
    const db = asUser(sessions.other);
    const m = await db.get(`scheme_members?select=id&scheme_id=eq.${ids.scheme}`);
    expectOk(m);
    assert.equal(m.body.length, 0, "members are hidden");
    const s = await db.get(`group_schemes?select=id&id=eq.${ids.scheme}`);
    assert.equal(s.body.length, 0, "the scheme is hidden");
    const f = await db.get(`fleet_vehicles?select=id&business_org_id=eq.${ids.org}`);
    assert.equal(f.body.length, 0, "the fleet is hidden");
    const i = await db.get(`business_invoices?select=id&business_org_id=eq.${ids.org}`);
    assert.equal(i.body.length, 0);
    expectRefused(await db.insert("scheme_members", { scheme_id: ids.scheme, full_name: `${RUN} intruder` }));
    expectRefused(await db.insert("group_schemes", { business_org_id: ids.org, category_id: ids.health, name: `${RUN} intruder` }));
    expectRefused(await db.insert("invitations", { org_id: ids.org, email: "intruder@example.com", role: "admin" }));
  });

  test("the broker is not on the scheme yet, so sees no members", async () => {
    const m = await asUser(sessions.broker).get(`scheme_members?select=id&scheme_id=eq.${ids.scheme}`);
    expectOk(m);
    assert.equal(m.body.length, 0);
  });
});

describe("broker of record on the scheme (privileged setup)", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
  test("reads the census and members; an insurer not on the scheme does not", async () => {
    const svc = service();
    expectOk(await svc.update(`group_schemes?id=eq.${ids.scheme}`, { broker_org_id: ids.broker, status: "quoting" }));
    const m = await asUser(sessions.broker).get(`scheme_members?select=id,full_name,date_of_birth&scheme_id=eq.${ids.scheme}`);
    expectOk(m);
    assert.equal(m.body.length, 2, "the broker of record sees the member list for underwriting");
    const s = await asUser(sessions.broker).get(`group_schemes?select=id,member_count&id=eq.${ids.scheme}`);
    assert.equal(s.body[0]?.member_count, 2);
    const f = await asUser(sessions.broker).get(`fleet_vehicles?select=id&business_org_id=eq.${ids.org}`);
    assert.ok(f.body.length >= 1, "the servicing broker sees the business's fleet");
    const u = await asUser(sessions.underwriter).get(`scheme_members?select=id&scheme_id=eq.${ids.scheme}`);
    assert.equal(u.body.length, 0, "an insurer without the scheme sees nothing");
    // The broker can't hand the scheme to another broker.
    expectRule(await asUser(sessions.broker).update(`group_schemes?id=eq.${ids.scheme}`, { broker_org_id: null }), /broker of record/i);
  });
});
