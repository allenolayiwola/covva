// Claims completion rules (supabase/migrations/20261029100200_claims_completion.sql): the claim thread, information
// requests, fraud flags and the post-claim partner network, exercised through Supabase Auth + PostgREST as each role
// (same style as db-rules.test.mjs).
// Run:  node --test apps/web/tests/claims-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Fixture: the demo customer reports a claim on a policy they own (the customer "bought elsewhere" policy the
// db-rules suite also creates, tagged E2E-DBRULES…). Customers can withdraw but not delete claims, so the suite
// withdraws its claims at the end and the purge script removes them when SUPABASE_SECRET_KEY is set.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, TAG, anon, asUser, hasServiceKey, service, signIn, stamp, uuid } from "./_lib/supabase.mjs";

const RUN = `${TAG} ${stamp()}`;

function expectOk(r, status) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
  if (status) assert.equal(r.status, status);
}
function expectForbidden(r) {
  assert.ok(r.status >= 400, `expected a permission error, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(r.code === "42501" || r.code === "P0001" || r.status === 401 || r.status === 403, `expected 42501/P0001/401/403, got ${r.status} ${r.code}: ${r.message}`);
}
function expectRule(r, re) {
  assert.ok(r.status >= 400, `expected a business-rule error, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected P0001, got ${r.code}: ${r.message}`);
  if (re) assert.match(r.message ?? "", re);
}

const sessions = {};
const ids = {};
const created = { claims: [], partners: [] };

const daysAgo = (n) => new Date(Date.now() - n * 86_400_000).toISOString();

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.claims = await signIn(ACCOUNTS.claims);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  const orgs = (await anon().get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  const cats = (await anon().get("product_categories?select=id,slug&slug=eq.motor")).body;
  ids.motor = cats[0]?.id;
  assert.ok(ids.broker && ids.insurer && ids.motor, "seed data (demo broker, insurer, motor category) must exist");

  // A policy the customer owns with the demo insurer and the demo broker of record. Customers may only create
  // external policies (insurer optional, broker not settable), so with a service key we create a serviced one;
  // without it we fall back to an external policy (broker-dependent checks are then skipped).
  const c = asUser(sessions.customer);
  if (hasServiceKey()) {
    const r = await service().insert("policies", {
      customer_id: sessions.customer.userId,
      insurer_org_id: ids.insurer,
      broker_org_id: ids.broker,
      category_id: ids.motor,
      status: "active",
      policy_number: `${RUN}-CLAIMS-${stamp()}`,
      nickname: `${RUN} claims fixture`,
      cover_start: daysAgo(100).slice(0, 10),
      cover_end: new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10),
      premium: 900,
    });
    expectOk(r, 201);
    ids.policy = r.body[0].id;
    ids.policyHasBroker = true;
  } else {
    const r = await c.insert("policies", {
      customer_id: sessions.customer.userId,
      insurer_org_id: ids.insurer,
      category_id: ids.motor,
      status: "active",
      external_source: true,
      policy_number: `${RUN}-CLAIMS-${stamp()}`,
      nickname: `${RUN} claims fixture`,
      cover_start: daysAgo(100).slice(0, 10),
      cover_end: new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10),
      premium: 900,
    });
    expectOk(r, 201);
    ids.policy = r.body[0].id;
    ids.policyHasBroker = false;
  }

  const claim = await c.insert("claims", {
    policy_id: ids.policy,
    customer_id: sessions.customer.userId,
    insurer_org_id: ids.insurer,
    broker_org_id: ids.policyHasBroker ? ids.broker : null,
    status: "reported",
    incident_type: "accident",
    incident_at: daysAgo(2),
    description: `${RUN} thread claim`,
    amount_claimed: 800,
  });
  expectOk(claim, 201);
  ids.claim = claim.body[0].id;
  created.claims.push(ids.claim);
});

after(async () => {
  const c = asUser(sessions.customer);
  for (const id of created.claims) await c.update(`claims?id=eq.${id}`, { status: "withdrawn" }).catch(() => {});
  if (!hasServiceKey()) return;
  const svc = service();
  for (const id of created.claims) await svc.delete(`claims?id=eq.${id}`);
  for (const id of created.partners) await svc.delete(`service_partners?id=eq.${id}`);
  if (ids.policy) await svc.delete(`policies?id=eq.${ids.policy}`);
});

// ---------------------------------------------------------------------------
describe("claim thread", () => {
  test("customer posts a message; the trigger stamps author and party; internal notes are refused", async () => {
    const c = asUser(sessions.customer);
    const m = await c.insert("claim_messages", { claim_id: ids.claim, body: `${RUN} hello from the customer` });
    expectOk(m, 201);
    assert.equal(m.body[0].author_party, "customer");
    assert.equal(m.body[0].author_id, sessions.customer.userId);
    assert.equal(m.body[0].internal, false);
    const internal = await c.insert("claim_messages", { claim_id: ids.claim, body: `${RUN} sneaky`, internal: true });
    expectForbidden(internal);
    const empty = await c.insert("claim_messages", { claim_id: ids.claim, body: "   " });
    expectRule(empty, /body is required/i);
  });

  test("insurer claims officer writes an internal note the customer cannot read; the broker can", async () => {
    const officer = asUser(sessions.claims);
    const note = await officer.insert("claim_messages", { claim_id: ids.claim, body: `${RUN} internal insurer note`, internal: true });
    expectOk(note, 201);
    assert.equal(note.body[0].author_party, "insurer");
    const visible = await officer.insert("claim_messages", { claim_id: ids.claim, body: `${RUN} visible insurer reply` });
    expectOk(visible, 201);

    const mine = await asUser(sessions.customer).get(`claim_messages?select=body,internal,author_party&claim_id=eq.${ids.claim}&order=created_at`);
    expectOk(mine);
    assert.ok(mine.body.every((m) => m.internal === false), "customer never sees internal notes");
    assert.ok(mine.body.some((m) => m.author_party === "insurer"), "customer sees the visible insurer reply");

    if (ids.policyHasBroker) {
      const broker = await asUser(sessions.broker).get(`claim_messages?select=body,internal&claim_id=eq.${ids.claim}&internal=eq.true`);
      expectOk(broker);
      assert.equal(broker.body.length, 1, "broker of record reads internal notes");
    }
  });

  test("a stranger (underwriter not on the claim) cannot read or post in the thread", async () => {
    const uw = asUser(sessions.underwriter);
    const insurerOrgs = (await uw.get("memberships?select=org_id&active=eq.true")).body.map((m) => m.org_id);
    if (insurerOrgs.includes(ids.insurer)) return; // same insurer: legitimately a party
    const r = await uw.get(`claim_messages?select=id&claim_id=eq.${ids.claim}`);
    assert.ok(r.status >= 400 || r.body.length === 0);
    expectForbidden(await uw.insert("claim_messages", { claim_id: ids.claim, body: "not mine" }));
  });
});

// ---------------------------------------------------------------------------
describe("information requests", () => {
  test("customer cannot raise a request; the insurer can; the customer fulfils but cannot edit the message", async () => {
    const c = asUser(sessions.customer);
    expectForbidden(await c.insert("claim_info_requests", { claim_id: ids.claim, message: "give me money" }));

    const officer = asUser(sessions.claims);
    const r = await officer.insert("claim_info_requests", { claim_id: ids.claim, kind: "document", requested_party: "customer", message: `${RUN} please upload the police report` });
    expectOk(r, 201);
    const req = r.body[0];
    assert.equal(req.requested_by_party, "insurer");
    assert.equal(req.requested_by, sessions.claims.userId);
    ids.infoRequest = req.id;

    const seen = await c.get(`claim_info_requests?select=id,message,fulfilled_at&id=eq.${req.id}`);
    expectOk(seen);
    assert.equal(seen.body.length, 1, "customer sees the request");

    expectRule(await c.update(`claim_info_requests?id=eq.${req.id}`, { message: "changed" }), /only fulfil/i);
    const done = await c.update(`claim_info_requests?id=eq.${req.id}`, { fulfilled_at: new Date().toISOString(), response: `${RUN} sent by post` });
    expectOk(done);
    assert.equal(done.body[0].fulfilled_by, sessions.customer.userId);
  });

  test("kind is constrained", async () => {
    const officer = asUser(sessions.claims);
    const bad = await officer.insert("claim_info_requests", { claim_id: ids.claim, kind: "money", message: "no" });
    assert.ok(bad.status >= 400 && bad.code === "23514", `check constraint expected, got ${bad.code}`);
  });
});

// ---------------------------------------------------------------------------
describe("fraud flags", () => {
  test("customer cannot read fraud flags (table) nor insert them; the insurer claims officer can read", async () => {
    const c = asUser(sessions.customer);
    const r = await c.get(`claim_fraud_flags?select=id&claim_id=eq.${ids.claim}`);
    assert.ok(r.status >= 400 || r.body.length === 0, "customer sees no flags");
    expectForbidden(await c.insert("claim_fraud_flags", { claim_id: ids.claim, kind: "late_report" }));
    expectForbidden(await c.rpc("run_claim_fraud_checks", { p_claim_id: ids.claim }));
    expectOk(await asUser(sessions.claims).get(`claim_fraud_flags?select=id,kind,status&claim_id=eq.${ids.claim}`));
    if (ids.policyHasBroker) {
      const b = await asUser(sessions.broker).get(`claim_fraud_flags?select=id&claim_id=eq.${ids.claim}`);
      assert.ok(b.status >= 400 || b.body.length === 0, "broker sees no flags either");
    }
  });

  test("insurer may run the checks on demand and gets a summary", async () => {
    const r = await asUser(sessions.claims).rpc("run_claim_fraud_checks", { p_claim_id: ids.claim });
    expectOk(r);
    assert.equal(r.body.claim_id, ids.claim);
    assert.ok(["clear", "review", "confirmed"].includes(r.body.status));
    assert.equal(typeof r.body.open_flags, "number");
  });

  test("a claim reported 60 days after the incident gets a late_report flag (customer still cannot see it)", async () => {
    const c = asUser(sessions.customer);
    const late = await c.insert("claims", {
      policy_id: ids.policy,
      customer_id: sessions.customer.userId,
      insurer_org_id: ids.insurer,
      broker_org_id: ids.policyHasBroker ? ids.broker : null,
      status: "reported",
      incident_type: "windscreen",
      incident_at: daysAgo(60),
      description: `${RUN} late report`,
    });
    expectOk(late, 201);
    created.claims.push(late.body[0].id);
    const flags = await asUser(sessions.claims).get(`claim_fraud_flags?select=kind,status,details&claim_id=eq.${late.body[0].id}`);
    expectOk(flags);
    const lateFlag = flags.body.find((f) => f.kind === "late_report");
    assert.ok(lateFlag, `late_report flag expected, got ${JSON.stringify(flags.body)}`);
    assert.equal(lateFlag.status, "open");
    assert.ok(Number(lateFlag.details.days_late) >= 59);
    const own = await c.get(`claim_fraud_flags?select=id&claim_id=eq.${late.body[0].id}`);
    assert.ok(own.status >= 400 || own.body.length === 0);
    const summary = await asUser(sessions.claims).get(`claims?select=fraud_score,fraud_status&id=eq.${late.body[0].id}`);
    expectOk(summary);
    assert.ok(Number(summary.body[0].fraud_score) >= 15, "late report adds 15 to the score");
  });

  test("insurer clears a flag; the claim summary is recomputed; the customer cannot touch flags", async () => {
    const officer = asUser(sessions.claims);
    const lateClaim = created.claims[created.claims.length - 1];
    const flags = (await officer.get(`claim_fraud_flags?select=id&claim_id=eq.${lateClaim}&kind=eq.late_report`)).body;
    assert.ok(flags.length === 1);
    // RLS hides the row from the customer: PostgREST answers 200 with no rows updated (or a permission error).
    const sneaky = await asUser(sessions.customer).update(`claim_fraud_flags?id=eq.${flags[0].id}`, { status: "cleared" });
    assert.ok(sneaky.status >= 400 || (Array.isArray(sneaky.body) && sneaky.body.length === 0), `customer must not update flags: ${sneaky.status} ${JSON.stringify(sneaky.body)}`);
    const cleared = await officer.update(`claim_fraud_flags?id=eq.${flags[0].id}`, { status: "cleared", review_note: `${RUN} customer was abroad` });
    expectOk(cleared);
    assert.equal(cleared.body[0].reviewed_by, sessions.claims.userId);
    assert.ok(cleared.body[0].reviewed_at);
    const summary = await officer.get(`claims?select=fraud_score,fraud_status&id=eq.${lateClaim}`);
    assert.equal(summary.body[0].fraud_status, "clear");
  });
});

// ---------------------------------------------------------------------------
describe("service partner directory", () => {
  test("anonymous and customers read approved partners only; customers cannot write", async () => {
    const pub = await anon().get("service_partners?select=id,status&limit=50");
    expectOk(pub);
    assert.ok(pub.body.every((p) => p.status === "approved"), "only approved partners are public");
    const c = await asUser(sessions.customer).get("service_partners?select=id,status&limit=50");
    expectOk(c);
    assert.ok(c.body.every((p) => p.status === "approved"));
    expectForbidden(await asUser(sessions.customer).insert("service_partners", { kind: "garage", name: `${RUN} garage` }));
    expectForbidden(await anon().insert("service_partners", { kind: "garage", name: `${RUN} garage` }));
  });

  test("customer reads their own claim's jobs but cannot create one", async () => {
    const c = asUser(sessions.customer);
    expectOk(await c.get(`claim_jobs?select=id&claim_id=eq.${ids.claim}`));
    const fake = await c.insert("claim_jobs", { claim_id: ids.claim, service_partner_id: uuid(), kind: "repair" });
    assert.ok(fake.status >= 400, "customers cannot arrange jobs");
  });
});

// ---------------------------------------------------------------------------
describe("privileged checks (SUPABASE_SECRET_KEY)", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
  test("a second claim on the same policy within 7 days produces a duplicate_claim flag and a review status", async () => {
    const svc = service();
    const dupe = await asUser(sessions.customer).insert("claims", {
      policy_id: ids.policy,
      customer_id: sessions.customer.userId,
      insurer_org_id: ids.insurer,
      broker_org_id: ids.policyHasBroker ? ids.broker : null,
      status: "reported",
      incident_type: "accident",
      incident_at: daysAgo(3),
      description: `${RUN} duplicate of the thread claim`,
    });
    expectOk(dupe, 201);
    created.claims.push(dupe.body[0].id);
    const flags = (await svc.get(`claim_fraud_flags?select=kind,status,details&claim_id=eq.${dupe.body[0].id}`)).body;
    const dup = flags.find((f) => f.kind === "duplicate_claim");
    assert.ok(dup, `duplicate_claim flag expected, got ${JSON.stringify(flags)}`);
    assert.equal(dup.details.other_claim_id, ids.claim);
    const row = (await svc.get(`claims?select=fraud_score,fraud_status&id=eq.${dupe.body[0].id}`)).body[0];
    assert.equal(row.fraud_status, "review");
    assert.ok(Number(row.fraud_score) >= 40);
    const summary = await svc.rpc("run_claim_fraud_checks", { p_claim_id: dupe.body[0].id });
    expectOk(summary);
    assert.equal(summary.body.status, "review");
  });

  test("approved partner with direct billing: broker/insurer arranges a job; customer sees it with direct_billing", async () => {
    const svc = service();
    const partner = await svc.insert("service_partners", { kind: "garage", name: `${RUN} Test Garage`, region: "Greater Accra", status: "approved", direct_billing_insurer_ids: [ids.insurer] });
    expectOk(partner, 201);
    created.partners.push(partner.body[0].id);
    assert.equal((await anon().get(`service_partners?select=id&id=eq.${partner.body[0].id}`)).body.length, 1, "approved partner is public");

    const officer = asUser(sessions.claims);
    const job = await officer.insert("claim_jobs", { claim_id: ids.claim, service_partner_id: partner.body[0].id, kind: "repair", direct_billing: true, estimate: 1200 });
    expectOk(job, 201);
    assert.equal(job.body[0].created_by, sessions.claims.userId);
    const mine = await asUser(sessions.customer).get(`claim_jobs?select=id,direct_billing,status&id=eq.${job.body[0].id}`);
    expectOk(mine);
    assert.equal(mine.body[0].direct_billing, true);
    expectForbidden(await asUser(sessions.customer).update(`claim_jobs?id=eq.${job.body[0].id}`, { status: "completed" }));
    const done = await officer.update(`claim_jobs?id=eq.${job.body[0].id}`, { status: "completed" });
    expectOk(done);
    assert.ok(done.body[0].completed_at, "trigger stamps completed_at");

    const suspended = await svc.update(`service_partners?id=eq.${partner.body[0].id}`, { status: "suspended" });
    expectOk(suspended);
    assert.equal((await anon().get(`service_partners?select=id&id=eq.${partner.body[0].id}`)).body.length, 0, "suspended partner leaves the directory");
  });
});
