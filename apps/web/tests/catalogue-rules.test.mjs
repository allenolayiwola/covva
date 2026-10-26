// Catalogue extensions (migration 20261027100100): RLS on rate tables, rate rows,
// underwriting rules and document templates, exercised through Supabase Auth + PostgREST.
// Run:  node --test apps/web/tests/catalogue-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Rows created here are tagged `E2E-CATALOGUE…` in their name so the purge script can remove
// them with the service key. Without SUPABASE_SECRET_KEY the privileged part is skipped.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp } from "./_lib/supabase.mjs";
import { purgeE2EData } from "./purge-e2e-data.mjs";

const RUN = `E2E-CATALOGUE ${stamp()}`;

function expectRls(r) {
  assert.ok(r.status >= 400, `expected an RLS rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "42501", `expected RLS error 42501, got ${r.code}: ${r.message}`);
}
function expectOk(r, status = 200) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
  if (status === 201) assert.equal(r.status, 201);
}

const sessions = {};
const ids = {};

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);

  const pub = anon();
  const orgs = (await pub.get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  // An approved version of a product owned by the demo insurer (public read of approved versions).
  const products = (await pub.get(`products?select=id,current_version_id&insurer_org_id=eq.${ids.insurer}&status=eq.approved&limit=5`)).body;
  ids.version = products.find((p) => p.current_version_id)?.current_version_id;
  assert.ok(ids.broker && ids.insurer && ids.version, "seed data (demo broker, insurer with an approved product version) must exist");
});

after(async () => {
  if (hasServiceKey()) await purgeE2EData();
  else console.log(`cleanup: no SUPABASE_SECRET_KEY — rows named "${RUN}…" were left in rate_tables/underwriting_rules/document_templates`);
});

// ---------------------------------------------------------------------------
describe("insurer underwriter (owning organisation)", () => {
  let db;
  before(() => {
    db = asUser(sessions.underwriter);
  });

  test("creates a draft rate table with rows on their own product version", async () => {
    const created = await db.insert("rate_tables", {
      product_version_id: ids.version,
      name: `${RUN} motor rates`,
      factor_keys: ["vehicle_use", "region"],
      status: "draft",
      source: "manual",
      submitted_by: sessions.underwriter.userId,
      submitted_by_org_id: ids.insurer,
    });
    expectOk(created, 201);
    ids.table = created.body[0].id;
    const rows = await db.insert("rate_rows", [
      { rate_table_id: ids.table, factors: { vehicle_use: "*", region: "*" }, rate: 0.05, rate_kind: "rate_on_value", min_premium: 400 },
      { rate_table_id: ids.table, factors: { vehicle_use: "private", region: "Greater Accra" }, rate: 0.045, rate_kind: "rate_on_value" },
    ]);
    expectOk(rows, 201);
    assert.equal(rows.body.length, 2);
    const mine = await db.get(`rate_tables?select=id,status&id=eq.${ids.table}`);
    expectOk(mine);
    assert.equal(mine.body.length, 1, "the owning insurer reads its own draft table");
  });

  test("can submit the table for review but cannot self-approve it", async () => {
    expectRls(await db.update(`rate_tables?id=eq.${ids.table}`, { status: "approved" }));
    const pending = await db.update(`rate_tables?id=eq.${ids.table}`, { status: "pending_review" });
    expectOk(pending);
    assert.equal(pending.body[0].status, "pending_review");
  });

  test("manages underwriting rules and draft templates; approval of templates is reserved for staff", async () => {
    const rule = await db.insert("underwriting_rules", {
      product_version_id: ids.version,
      name: `${RUN} old vehicle`,
      condition: { field: "vehicle_age", op: "gt", value: 15 },
      outcome: "decline",
      message: "Vehicles older than 15 years are not covered.",
      priority: 10,
    });
    expectOk(rule, 201);
    ids.rule = rule.body[0].id;
    const tpl = await db.insert("document_templates", {
      product_version_id: ids.version,
      kind: "certificate",
      name: `${RUN} certificate`,
      template: { fields: [{ key: "no", label: "Policy number", path: "policy.policy_number" }], blocks: [{ type: "fields", fields: ["no"] }] },
      status: "draft",
    });
    expectOk(tpl, 201);
    ids.template = tpl.body[0].id;
    expectRls(await db.update(`document_templates?id=eq.${ids.template}`, { status: "approved" }));
    expectRls(
      await db.insert("document_templates", { product_version_id: ids.version, kind: "sticker", name: `${RUN} forged approval`, template: { html: "<p>x</p>" }, status: "approved" }),
    );
  });
});

// ---------------------------------------------------------------------------
describe("broker", () => {
  let db;
  before(() => {
    db = asUser(sessions.broker);
  });

  test("cannot create or edit rate tables, rules or templates on an insurer's product version", async () => {
    expectRls(await db.insert("rate_tables", { product_version_id: ids.version, name: `${RUN} broker forged`, factor_keys: ["vehicle_use"], status: "draft" }));
    expectRls(await db.insert("underwriting_rules", { product_version_id: ids.version, name: `${RUN} broker rule`, condition: { field: "x", op: "exists" }, outcome: "accept" }));
    expectRls(await db.insert("document_templates", { product_version_id: ids.version, kind: "receipt", name: `${RUN} broker tpl`, template: { html: "<p>x</p>" } }));
    // The insurer's pending table is not visible to a broker, so an update touches nothing.
    const hidden = await db.get(`rate_tables?select=id&id=eq.${ids.table}`);
    expectOk(hidden);
    assert.deepEqual(hidden.body, [], "brokers only read approved tables");
    const patched = await db.update(`rate_tables?id=eq.${ids.table}`, { name: `${RUN} renamed by broker` });
    assert.ok(patched.status >= 400 || (Array.isArray(patched.body) && patched.body.length === 0), `broker must not edit an insurer table: ${patched.status} ${JSON.stringify(patched.body)}`);
    expectRls(await db.insert("rate_rows", { rate_table_id: ids.table, factors: { vehicle_use: "taxi", region: "*" }, rate: 0.01, rate_kind: "rate_on_value" }));
  });

  test("can submit a pending rate table for an insurer not on Covva, with rows and a partnerships lead", async () => {
    const proposal = await db.insert("rate_tables", {
      product_version_id: null,
      proposed_insurer_name: `${RUN} New Insurer Ltd`,
      name: `${RUN} proposal`,
      factor_keys: ["vehicle_use"],
      status: "pending_review",
      source: "csv",
      submitted_by: sessions.broker.userId,
      submitted_by_org_id: ids.broker,
    });
    expectOk(proposal, 201);
    ids.proposal = proposal.body[0].id;
    assert.equal(proposal.body[0].status, "pending_review");
    const rows = await db.insert("rate_rows", { rate_table_id: ids.proposal, factors: { vehicle_use: "*" }, rate: 0.06, rate_kind: "rate_on_value" });
    expectOk(rows, 201);
    const mine = await db.get(`rate_tables?select=id,proposed_insurer_name&id=eq.${ids.proposal}`);
    expectOk(mine);
    assert.equal(mine.body.length, 1, "a broker reads its own proposals");
    const lead = await db.insert("leads", {
      kind: "insurer",
      name: `${RUN} New Insurer Ltd`,
      organization: `${RUN} New Insurer Ltd`,
      message: `${RUN} broker suggested insurer`,
      source_page: "broker_suggestion",
      utm: { source: "broker_suggestion", rate_table_id: ids.proposal },
      status: "new",
    });
    expectOk(lead, 201);
  });

  test("cannot submit a proposal that is already approved, or for another organisation", async () => {
    expectRls(
      await db.insert("rate_tables", { product_version_id: null, proposed_insurer_name: `${RUN} X`, name: `${RUN} pre-approved`, factor_keys: ["a"], status: "approved", submitted_by: sessions.broker.userId, submitted_by_org_id: ids.broker }),
    );
    expectRls(
      await db.insert("rate_tables", { product_version_id: null, proposed_insurer_name: `${RUN} X`, name: `${RUN} wrong org`, factor_keys: ["a"], status: "pending_review", submitted_by: sessions.broker.userId, submitted_by_org_id: ids.insurer }),
    );
  });
});

// ---------------------------------------------------------------------------
describe("customer and anonymous", () => {
  test("customer cannot read draft or pending tables, rules or templates, nor write them", async () => {
    const db = asUser(sessions.customer);
    for (const path of [`rate_tables?select=id&id=in.(${ids.table},${ids.proposal})`, `rate_rows?select=id&rate_table_id=eq.${ids.table}`, `underwriting_rules?select=id&id=eq.${ids.rule}`, `document_templates?select=id&id=eq.${ids.template}`]) {
      const r = await db.get(path);
      assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${path}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    expectRls(await db.insert("rate_tables", { product_version_id: null, proposed_insurer_name: `${RUN} X`, name: `${RUN} customer`, factor_keys: ["a"], status: "pending_review", submitted_by: sessions.customer.userId }));
  });

  test("anonymous visitors see nothing in the catalogue extension tables", async () => {
    const pub = anon();
    for (const table of ["rate_tables", "rate_rows", "underwriting_rules", "document_templates"]) {
      const r = await pub.get(`${table}?select=id&limit=1`);
      assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${table}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    assert.ok((await pub.rpc("activate_scheduled_versions")).status >= 400, "anonymous cannot run the scheduler");
  });
});

// ---------------------------------------------------------------------------
describe("privileged (service key)", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
  test("platform approval makes the insurer table readable by brokers; the scheduler runs idempotently", async () => {
    const svc = service();
    const approved = await svc.update(`rate_tables?id=eq.${ids.table}`, { status: "approved", reviewed_at: new Date().toISOString() });
    expectOk(approved);
    assert.equal(approved.body[0].status, "approved");
    const broker = asUser(sessions.broker);
    const visible = await broker.get(`rate_tables?select=id,status&id=eq.${ids.table}`);
    expectOk(visible);
    assert.equal(visible.body.length, 1, "brokers read approved tables");
    const rows = await broker.get(`rate_rows?select=id&rate_table_id=eq.${ids.table}`);
    expectOk(rows);
    assert.equal(rows.body.length, 2);
    // Still read-only for the broker.
    const patched = await broker.update(`rate_tables?id=eq.${ids.table}`, { name: `${RUN} renamed by broker` });
    assert.ok(patched.status >= 400 || (Array.isArray(patched.body) && patched.body.length === 0));
    const customer = asUser(sessions.customer);
    const cust = await customer.get(`rate_tables?select=id&id=eq.${ids.table}`);
    assert.ok(cust.status === 200 ? cust.body.length === 0 : cust.status >= 400, "customers never read rate tables");

    const run1 = await svc.rpc("activate_scheduled_versions");
    expectOk(run1);
    assert.equal(typeof run1.body, "number");
    const run2 = await svc.rpc("activate_scheduled_versions");
    expectOk(run2);
    assert.equal(run2.body, 0, "a second run promotes nothing new");
  });
});
