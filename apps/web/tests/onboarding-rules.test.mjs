// Partner onboarding database rules (Addendum 3 B1/B4/C1/C2), exercised through Supabase Auth + PostgREST as each role.
// Run:  node --test apps/web/tests/onboarding-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Rows created here are tagged `E2E-ONBOARDING…`. The parts that need rows no user role may create
// (appointment requests for other organisations) run only when SUPABASE_SECRET_KEY is set and delete
// their own rows at the end.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp, uuid } from "./_lib/supabase.mjs";

const TAG = "E2E-ONBOARDING";
const RUN = `${TAG} ${stamp()}`;

function expectRule(r, pattern) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected trigger error P0001, got ${r.code}: ${r.message}`);
  assert.match(r.message ?? "", pattern);
}
function expectRefused(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["42501", "P0001", "23503", "23514"].includes(r.code), `expected RLS/guard rejection, got ${r.code}: ${r.message}`);
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
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id;
  ids.otherBroker = orgs.find((o) => o.type === "broker" && o.id !== ids.broker)?.id ?? null;
  ids.coastline = orgs.find((o) => o.slug === "coastline-general")?.id;
  ids.otherInsurer = orgs.find((o) => o.type === "insurer" && o.id !== ids.coastline)?.id ?? null;
  ids.motor = (await pub.get("product_categories?select=id,slug&slug=eq.motor")).body[0]?.id;
  assert.ok(ids.broker && ids.coastline && ids.motor, "seed data (demo broker, coastline insurer, motor category) must exist");
});

// ---------------------------------------------------------------------------
describe("anonymous visitors", () => {
  test("cannot read applications or appointment requests; the registration flags are readable", async () => {
    const pub = anon();
    for (const table of ["partner_applications", "appointment_requests"]) {
      const r = await pub.get(`${table}?select=id&limit=1`);
      assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${table}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    expectRefused(await pub.insert("partner_applications", { type: "broker", applicant_user_id: uuid(), company_name: `${RUN} anon` }));
    const flags = await pub.get("feature_flags?select=key,enabled&key=like.partner_self_service_*");
    expectOk(flags);
    assert.deepEqual(flags.body.map((f) => f.key).sort(), ["partner_self_service_broker", "partner_self_service_insurer"]);
    expectRule(await pub.rpc("refresh_licence_status", {}), /Only the platform/);
  });
});

// ---------------------------------------------------------------------------
describe("customer (applicant)", () => {
  let appId;

  test("can create and read only their own draft; review fields and other applicants are off limits", async () => {
    const db = asUser(sessions.customer);
    // Reuse an open draft from an earlier run (one open application per applicant and type).
    const existing = await db.get(`partner_applications?select=id,status&type=eq.broker&status=in.(draft,needs_changes)&applicant_user_id=eq.${sessions.customer.userId}`);
    expectOk(existing);
    if (existing.body[0]) {
      appId = existing.body[0].id;
    } else {
      const created = await db.insert("partner_applications", { type: "broker", applicant_user_id: sessions.customer.userId, company_name: `${RUN} Brokers Ltd` });
      expectOk(created, 201);
      appId = created.body[0].id;
      assert.equal(created.body[0].status, "draft");
    }
    const mine = await db.get(`partner_applications?select=id,applicant_user_id&id=eq.${appId}`);
    expectOk(mine);
    assert.equal(mine.body.length, 1);
    const all = await db.get("partner_applications?select=applicant_user_id");
    expectOk(all);
    assert.ok(all.body.every((a) => a.applicant_user_id === sessions.customer.userId), "an applicant sees only their own applications");

    expectRefused(await db.insert("partner_applications", { type: "insurer", applicant_user_id: uuid(), company_name: `${RUN} forged` }));
    expectRefused(await db.insert("partner_applications", { type: "insurer", applicant_user_id: sessions.customer.userId, status: "approved", company_name: `${RUN} forged status` }));
    expectRule(await db.update(`partner_applications?id=eq.${appId}`, { review_notes: "self approved" }), /Review fields are set by Covva staff/);
    expectRule(await db.update(`partner_applications?id=eq.${appId}`, { status: "approved" }), /not allowed|Review fields/);
    expectRule(await db.update(`partner_applications?id=eq.${appId}`, { status: "submitted" }), /required before submitting|must be signed/);
    expectRefused(await db.update(`partner_applications?id=eq.${appId}`, { settlement_account: { type: "card", card_number: "4111111111111111" } }));
    const saved = await db.update(`partner_applications?id=eq.${appId}`, { company_name: `${RUN} Brokers Ltd`, settlement_account: { type: "momo", momo_network: "MTN", momo_number: "0241234567", account_name: "E2E" } });
    expectOk(saved);
    assert.equal(saved.body[0].settlement_account.type, "momo");
  });

  test("cannot run the staff RPCs or decide appointment requests", async () => {
    const db = asUser(sessions.customer);
    expectRule(await db.rpc("approve_partner_application", { p_id: appId ?? uuid() }), /Only Covva staff/);
    expectRule(await db.rpc("return_partner_application", { p_id: appId ?? uuid(), p_note: "x" }), /Only Covva staff/);
    expectRule(await db.rpc("reject_partner_application", { p_id: appId ?? uuid(), p_note: "x" }), /Only Covva staff/);
    expectRule(await db.rpc("decide_appointment_request", { p_id: uuid(), p_decision: "approve" }), /not valid/);
    expectRule(await db.rpc("refresh_licence_status", {}), /Only the platform/);
  });

  after(async () => {
    if (!appId || !hasServiceKey()) return;
    const r = await service().delete(`partner_applications?id=eq.${appId}&company_name=like.E2E-*`);
    assert.ok(r.status < 300, `cleanup failed: ${r.status} ${JSON.stringify(r.body)}`);
  });
});

// ---------------------------------------------------------------------------
describe("broker (supervisor, not an owner/admin)", () => {
  test("cannot raise appointment requests without the owner/admin role and never sees other organisations' requests", async () => {
    const db = asUser(sessions.broker);
    expectRefused(await db.insert("appointment_requests", { broker_org_id: ids.broker, insurer_org_id: ids.coastline, category_id: ids.motor }));
    if (ids.otherBroker) {
      expectRefused(await db.insert("appointment_requests", { broker_org_id: ids.otherBroker, insurer_org_id: ids.coastline, category_id: ids.motor }));
      const foreign = await db.get(`appointment_requests?select=id&broker_org_id=eq.${ids.otherBroker}`);
      expectOk(foreign);
      assert.deepEqual(foreign.body, []);
    }
    const visible = await db.get("appointment_requests?select=broker_org_id,insurer_org_id");
    expectOk(visible);
    assert.ok(visible.body.every((r) => r.broker_org_id === ids.broker), "brokers only see their own organisation's requests");
    expectRule(await db.rpc("decide_appointment_request", { p_id: uuid(), p_decision: "approve" }), /not valid/);
    const apps = await db.get("partner_applications?select=id");
    expectOk(apps);
    assert.deepEqual(apps.body, [], "partner members do not see registration applications");
  });
});

// ---------------------------------------------------------------------------
describe("insurer (underwriter)", () => {
  test("cannot decide requests directly or through the RPC without the owner/admin role", async () => {
    const db = asUser(sessions.underwriter);
    expectRefused(await db.insert("appointment_requests", { broker_org_id: ids.broker, insurer_org_id: ids.coastline, category_id: ids.motor }));
    const foreign = await db.update(`appointment_requests?id=eq.${uuid()}`, { status: "approved" });
    assert.ok(foreign.status < 300 ? foreign.body.length === 0 : foreign.status >= 400);
    expectRule(await db.rpc("decide_appointment_request", { p_id: uuid(), p_decision: "approve" }), /not valid/);
    expectRule(await db.rpc("decide_appointment_request", { p_id: uuid(), p_decision: "bless" }), /approve, decline or revoke/);
  });
});

// ---------------------------------------------------------------------------
describe("privileged flows (service role)", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
  const created = [];

  after(async () => {
    const svc = service();
    for (const id of created) await svc.delete(`appointment_requests?id=eq.${id}`);
  });

  test("an insurer cannot decide a request addressed to a different insurer, and cannot even read it", async () => {
    if (!ids.otherInsurer) return;
    const svc = service();
    const r = await svc.insert("appointment_requests", { broker_org_id: ids.broker, insurer_org_id: ids.otherInsurer, category_id: ids.motor, status: "pending", decision_note: RUN });
    if (r.code === "23505") return; // an open request already exists for this line
    expectOk(r, 201);
    created.push(r.body[0].id);
    const db = asUser(sessions.underwriter);
    const read = await db.get(`appointment_requests?select=id&id=eq.${r.body[0].id}`);
    expectOk(read);
    assert.deepEqual(read.body, [], "coastline staff cannot see a request for another insurer");
    expectRule(await db.rpc("decide_appointment_request", { p_id: r.body[0].id, p_decision: "approve" }), /Only an owner or admin of the insurer/);
    // The broker that raised it can see it.
    const broker = await asUser(sessions.broker).get(`appointment_requests?select=id,status&id=eq.${r.body[0].id}`);
    expectOk(broker);
    assert.equal(broker.body[0]?.status, "pending");
  });

  test("approve → active appointment, revoke → inactive immediately; the broker is notified", async () => {
    const svc = service();
    // Pick an insurer × line with no seed appointment so the seed routing data is never touched.
    const cats = (await svc.get("product_categories?select=id")).body.map((c) => c.id);
    const existing = (await svc.get(`insurer_broker_appointments?select=insurer_org_id,category_id&broker_org_id=eq.${ids.broker}`)).body;
    const taken = new Set(existing.map((a) => `${a.insurer_org_id}:${a.category_id ?? "*"}`));
    const free = [ids.coastline, ids.otherInsurer].filter(Boolean).flatMap((i) => cats.map((c) => ({ insurer: i, cat: c }))).find((p) => !taken.has(`${p.insurer}:${p.cat}`) && !taken.has(`${p.insurer}:*`));
    if (!free) return;
    const r = await svc.insert("appointment_requests", { broker_org_id: ids.broker, insurer_org_id: free.insurer, category_id: free.cat, status: "pending", decision_note: RUN });
    if (r.code === "23505") return; // an open request already exists for this line
    expectOk(r, 201);
    const id = r.body[0].id;
    created.push(id);
    const approved = await svc.rpc("decide_appointment_request", { p_id: id, p_decision: "approve", p_note: RUN });
    expectOk(approved);
    assert.equal(approved.body[0].status, "approved");
    const appt = await svc.get(`insurer_broker_appointments?select=id,active&id=eq.${approved.body[0].appointment_id}`);
    assert.equal(appt.body[0]?.active, true);
    const revoked = await svc.rpc("decide_appointment_request", { p_id: id, p_decision: "revoke", p_note: RUN });
    expectOk(revoked);
    assert.equal(revoked.body[0].status, "revoked");
    const after_ = await svc.get(`insurer_broker_appointments?select=id,active&id=eq.${approved.body[0].appointment_id}`);
    assert.equal(after_.body[0]?.active, false, "revocation removes eligibility immediately");
    const notes = await svc.get(`notifications?select=id,kind&kind=eq.appointment.decided&data->>request_id=eq.${id}`);
    expectOk(notes);
    assert.ok(notes.body.length >= 1, "broker admins are notified of the decision");
    for (const n of notes.body) await svc.delete(`notifications?id=eq.${n.id}`);
    // The appointment row was created by this test (no seed row existed for the pair): remove it.
    await svc.delete(`insurer_broker_appointments?id=eq.${approved.body[0].appointment_id}&agreement_reference=like.appointment%20request%20*`);
  });
});
