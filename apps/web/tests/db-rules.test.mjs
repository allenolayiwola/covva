// Database business-rule and RLS tests, exercised through Supabase Auth + PostgREST as each role.
// Run:  node --test apps/web/tests/db-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Every row created here is tagged `E2E-DBRULES…` (title / nickname / description / idempotency_key)
// and is cleaned up as far as RLS allows (customers can cancel requests and withdraw claims but
// cannot delete). With SUPABASE_SECRET_KEY set, the privileged purchase journey runs too and the
// teardown deletes every `E2E-%` row with the service key.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, TAG, anon, asUser, hasServiceKey, service, signIn, stamp, uuid } from "./_lib/supabase.mjs";
import { purgeE2EData } from "./purge-e2e-data.mjs";

const RUN = `${TAG} ${stamp()}`;

/** Asserts a PostgREST response is a business-rule violation raised by a trigger (errcode P0001). */
function expectRule(r, pattern) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected trigger error P0001, got ${r.code}: ${r.message}`);
  assert.match(r.message ?? "", pattern);
}

/** Asserts PostgREST refused the write because of row-level security (42501). */
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
/** Leftovers the service key can delete (only used when SUPABASE_SECRET_KEY is set). */
const leftovers = { requests: [], claims: [], policies: [] };

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  sessions.claims = await signIn(ACCOUNTS.claims);

  const pub = anon();
  const orgs = (await pub.get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  const cats = (await pub.get("product_categories?select=id,slug&slug=eq.motor")).body;
  ids.motor = cats[0]?.id;
  assert.ok(ids.broker && ids.insurer && ids.motor, "seed data (demo broker, insurer, motor category) must exist");

  // Membership sanity: the demo broker user must belong to the demo broker org and the underwriter to the insurer.
  const brokerOrgs = (await asUser(sessions.broker).get("memberships?select=org_id&active=eq.true")).body.map((m) => m.org_id);
  assert.ok(brokerOrgs.includes(ids.broker), `${ACCOUNTS.brokerSupervisor} must be a member of the demo broker`);
  const insurerOrgs = (await asUser(sessions.underwriter).get("memberships?select=org_id&active=eq.true")).body.map((m) => m.org_id);
  assert.ok(insurerOrgs.includes(ids.insurer), `${ACCOUNTS.underwriter} must be a member of the demo insurer`);
});

after(async () => {
  if (hasServiceKey()) await purgeE2EData();
  else console.log(`cleanup: no SUPABASE_SECRET_KEY — rows tagged "${TAG}" that RLS prevented deleting: ${JSON.stringify(leftovers)}`);
});

// ---------------------------------------------------------------------------
describe("anonymous visitors", () => {
  test("can read categories, plans, flags and settings", async () => {
    const pub = anon();
    const cats = await pub.get("product_categories?select=slug,availability&order=sort_order");
    expectOk(cats);
    assert.ok(cats.body.length >= 1);
    for (const c of cats.body) assert.ok(["integrated", "broker_assisted", "planned"].includes(c.availability));
    const plans = await pub.get("plans?select=code,active");
    expectOk(plans);
    assert.ok(plans.body.length >= 1 && plans.body.every((p) => p.active === true), "only active plans are public");
    expectOk(await pub.get("feature_flags?select=key"));
    expectOk(await pub.get("platform_settings?select=key"));
  });

  test("cannot read profiles, memberships, requests, policies or the audit log", async () => {
    const pub = anon();
    for (const table of ["profiles", "memberships", "requests", "policies", "claims", "payments", "audit_events"]) {
      const r = await pub.get(`${table}?select=id&limit=1`);
      assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${table}: ${r.status} ${JSON.stringify(r.body)}`);
    }
  });

  test("cannot write the catalogue", async () => {
    const r = await anon().insert("product_categories", { slug: `e2e-${stamp()}`, name: `${RUN} category` });
    assert.ok(r.status >= 400, `expected rejection, got ${r.status}`);
  });
});

// ---------------------------------------------------------------------------
describe("customer", () => {
  let db;
  let me;
  let ownPolicy;
  before(() => {
    db = asUser(sessions.customer);
    me = sessions.customer.userId;
  });

  test("can create a draft request for themselves, then cancel it", async () => {
    const created = await db.insert("requests", {
      customer_id: me,
      category_id: ids.motor,
      type: "new_cover",
      status: "draft",
      source: "web",
      title: `${RUN} draft`,
      risk_data: { vehicle_make: "E2E", vehicle_model: "Test", vehicle_year: 2020 },
    });
    expectOk(created, 201);
    const row = created.body[0];
    assert.equal(row.status, "draft");
    assert.match(row.reference, /^REQ-\d+$/);
    assert.equal(row.customer_id, me);
    leftovers.requests.push(row.id);

    // Customers may only edit their own risk details and make the status moves the state machine allows.
    expectRule(await db.update(`requests?id=eq.${row.id}`, { broker_org_id: ids.broker }), /only change the details of your own request/);
    expectRule(await db.update(`requests?id=eq.${row.id}`, { status: "completed" }), /status change is not allowed/);

    const cancelled = await db.update(`requests?id=eq.${row.id}`, { status: "cancelled", cancelled_reason: `${RUN} cleanup` });
    expectOk(cancelled);
    assert.equal(cancelled.body[0].status, "cancelled");
    assert.ok(cancelled.body[0].completed_at, "trigger stamps completed_at on cancellation");
  });

  test("cannot create a request on behalf of another customer", async () => {
    expectRls(
      await db.insert("requests", { customer_id: sessions.broker.userId, category_id: ids.motor, status: "draft", title: `${RUN} forged owner` }),
    );
  });

  test("sees only their own data: no audit log, no memberships, no other profiles", async () => {
    // The demo customer may own business accounts (SME suites / e2e, never deleted): those are the only
    // organisations whose audit trail and memberships they may see.
    const business = await db.get("organizations?select=id&type=eq.enterprise");
    expectOk(business);
    const own = new Set(business.body.map((o) => o.id));
    const audit = await db.get("audit_events?select=id,org_id&limit=50");
    expectOk(audit);
    assert.ok(audit.body.every((a) => a.org_id && own.has(a.org_id)), `audit rows outside the customer's own business accounts: ${JSON.stringify(audit.body.slice(0, 3))}`);
    const memberships = await db.get("memberships?select=id,org_id&limit=50");
    expectOk(memberships);
    assert.ok(memberships.body.every((m) => own.has(m.org_id)), "a customer sees memberships of their own business accounts only");
    const profiles = await db.get("profiles?select=id");
    expectOk(profiles);
    assert.deepEqual(profiles.body.map((p) => p.id), [me]);
    const policies = await db.get("policies?select=id,customer_id");
    expectOk(policies);
    assert.ok(policies.body.every((p) => p.customer_id === me));
    const payments = await db.get("payments?select=id,customer_id");
    expectOk(payments);
    assert.ok(payments.body.every((p) => p.customer_id === me));
  });

  test("cannot forge an active policy", async () => {
    // Insert: customers may only add policies bought elsewhere.
    expectRule(
      await db.insert("policies", { customer_id: me, insurer_org_id: ids.insurer, category_id: ids.motor, status: "active", policy_number: `${RUN}-forged`, external_source: false, nickname: `${RUN} forged` }),
      /Customers can only add policies bought elsewhere/,
    );
    // Nor for someone else.
    expectRule(
      await db.insert("policies", { customer_id: sessions.broker.userId, insurer_org_id: ids.insurer, category_id: ids.motor, status: "active", external_source: true, nickname: `${RUN} forged` }),
      /Customers can only add policies bought elsewhere/,
    );
  });

  test("can rename their own policy, but cannot change its status or premium", async () => {
    const mine = await db.get(`policies?select=id,nickname,status,premium,external_source&customer_id=eq.${me}&order=created_at&limit=1`);
    expectOk(mine);
    if (!mine.body.length) {
      // No seeded policy: add one bought elsewhere (the only kind a customer may create).
      const ext = await db.insert("policies", { customer_id: me, insurer_org_id: ids.insurer, category_id: ids.motor, status: "active", policy_number: `${RUN}-EXT`, external_source: true, nickname: `${RUN} external` });
      expectOk(ext, 201);
      leftovers.policies.push(ext.body[0].id);
      mine.body = ext.body;
    }
    ownPolicy = mine.body[0];

    expectRule(await db.update(`policies?id=eq.${ownPolicy.id}`, { status: ownPolicy.status === "active" ? "cancelled" : "active" }), /Customers can only rename their policies/);
    expectRule(await db.update(`policies?id=eq.${ownPolicy.id}`, { premium: 1 }), /Customers can only rename their policies/);

    const renamed = await db.update(`policies?id=eq.${ownPolicy.id}`, { nickname: `${RUN} renamed` });
    expectOk(renamed);
    assert.equal(renamed.body[0].nickname, `${RUN} renamed`);
    const reverted = await db.update(`policies?id=eq.${ownPolicy.id}`, { nickname: ownPolicy.nickname });
    expectOk(reverted);
    assert.equal(reverted.body[0].nickname, ownPolicy.nickname);
  });

  test("can report a claim on their own policy; reporting is not approval", async () => {
    assert.ok(ownPolicy, "needs a policy from the previous test");
    const insurer = (await db.get(`policies?select=insurer_org_id&id=eq.${ownPolicy.id}`)).body[0].insurer_org_id;
    const reported = await db.insert("claims", {
      policy_id: ownPolicy.id,
      customer_id: me,
      insurer_org_id: insurer,
      status: "reported",
      incident_type: "accident",
      description: `${RUN} claim`,
      amount_claimed: 1500,
    });
    expectOk(reported, 201);
    const claim = reported.body[0];
    leftovers.claims.push(claim.id);
    assert.equal(claim.status, "reported");
    assert.ok(claim.reported_at, "trigger stamps reported_at");
    assert.equal(claim.decision_at, null);

    // Only the insurer decides; customers cannot touch decision fields or assessment statuses.
    expectRule(await db.update(`claims?id=eq.${claim.id}`, { status: "approved" }), /Only the insurer can record a claim decision/);
    expectRule(await db.update(`claims?id=eq.${claim.id}`, { status: "paid" }), /Only the insurer can record a claim decision/);
    expectRule(await db.update(`claims?id=eq.${claim.id}`, { status: "acknowledged" }), /set by the insurer or broker/);
    expectRule(await db.update(`claims?id=eq.${claim.id}`, { decision_amount: 1500 }), /Customers can only update the details of a claim/);

    // The customer may still edit reporting details and withdraw (our cleanup).
    expectOk(await db.update(`claims?id=eq.${claim.id}`, { description: `${RUN} claim (edited)` }));
    const withdrawn = await db.update(`claims?id=eq.${claim.id}`, { status: "withdrawn" });
    expectOk(withdrawn);
    assert.equal(withdrawn.body[0].status, "withdrawn");
  });

  test("cannot report a claim on a policy they do not own", async () => {
    const other = await db.insert("claims", { policy_id: uuid(), customer_id: me, insurer_org_id: ids.insurer, status: "reported", incident_type: "accident", description: `${RUN} not mine` });
    assert.ok(other.status >= 400, `expected rejection, got ${other.status}`);
    assert.ok(["42501", "23503"].includes(other.code), `RLS or FK should block: ${other.code} ${other.message}`);
  });

  test("cannot set their own KYC status or verification date", async () => {
    expectRule(await db.update(`profiles?id=eq.${me}`, { kyc_status: "verified" }), /set by the platform after review/);
    expectRule(await db.update(`profiles?id=eq.${me}`, { kyc_verified_at: new Date().toISOString() }), /set by the platform after review/);
    // Harmless profile edits still work (round-trip the preferred name).
    const current = (await db.get(`profiles?select=preferred_name&id=eq.${me}`)).body[0];
    expectOk(await db.update(`profiles?id=eq.${me}`, { preferred_name: `${RUN}` }));
    expectOk(await db.update(`profiles?id=eq.${me}`, { preferred_name: current.preferred_name }));
  });

  test("cannot insert a payment, and premiums can never be routed to a broker", async () => {
    const base = { request_id: uuid(), customer_id: me, amount: 100, provider: "paystack", idempotency_key: `${RUN}-pay-${uuid()}`, status: "pending" };
    // The payee guard fires before RLS: a non-insurer payee is a business-rule violation.
    expectRule(await db.insert("payments", { ...base, payee_org_id: ids.broker }), /settle directly to a licensed insurer/);
    // With a valid payee the write is still refused: payments are written only by the server.
    const r = await db.insert("payments", { ...base, payee_org_id: ids.insurer });
    assert.ok(r.status >= 400, `expected rejection, got ${r.status}`);
    assert.ok(["42501", "23503"].includes(r.code), `RLS (or FK on the fake request) should block: ${r.code} ${r.message}`);
  });

  test("cannot acknowledge a broker that is not the request's broker of record", async () => {
    const draft = await db.insert("requests", { customer_id: me, category_id: ids.motor, status: "draft", title: `${RUN} disclosure` });
    expectOk(draft, 201);
    leftovers.requests.push(draft.body[0].id);
    try {
      expectRls(
        await db.insert("broker_disclosures", { request_id: draft.body[0].id, broker_org_id: ids.broker, shown_to: me, disclosure_text: `${RUN} forged disclosure`, stage: "before_application" }),
      );
    } finally {
      expectOk(await db.update(`requests?id=eq.${draft.body[0].id}`, { status: "cancelled", cancelled_reason: `${RUN} cleanup` }));
    }
  });

  test("cannot write quotes, submissions or audit events", async () => {
    const r1 = await db.insert("quotes", { request_id: uuid(), insurer_org_id: ids.insurer, premium: 1, status: "ready_to_accept" });
    assert.ok(r1.status >= 400 && ["42501", "23503"].includes(r1.code), `quotes: ${r1.status} ${r1.code}`);
    const r2 = await db.insert("insurer_submissions", { request_id: uuid(), insurer_org_id: ids.insurer, broker_org_id: ids.broker, risk_fingerprint: `${RUN}-fp` });
    assert.ok(r2.status >= 400 && ["42501", "23503"].includes(r2.code), `submissions: ${r2.status} ${r2.code}`);
    const r3 = await db.insert("audit_events", { action: "insert", entity_type: "e2e", data: {} });
    assert.ok(r3.status >= 400, `audit_events: ${r3.status}`);
  });
});

// ---------------------------------------------------------------------------
describe("broker", () => {
  test("cannot mark cover active — only the issuing insurer can", async () => {
    const db = asUser(sessions.broker);
    expectRule(
      await db.insert("policies", {
        customer_id: sessions.customer.userId,
        insurer_org_id: ids.insurer,
        broker_org_id: ids.broker,
        category_id: ids.motor,
        status: "active",
        policy_number: `${RUN}-BRK`,
        nickname: `${RUN} broker-activated`,
      }),
      /Only the issuing insurer can mark cover active/,
    );
  });

  test("cannot decide a claim they do not service, cannot read the platform audit log", async () => {
    const db = asUser(sessions.broker);
    // Claims visible to the broker are only those where broker_org_id is theirs; a foreign claim updates nothing.
    const foreign = await db.update(`claims?id=eq.${uuid()}`, { status: "approved" });
    assert.ok(foreign.status < 300 ? foreign.body.length === 0 : foreign.status >= 400);
    const audit = await db.get("audit_events?select=id,org_id&limit=20");
    expectOk(audit);
    assert.ok(audit.body.every((e) => e.org_id === ids.broker), "a supervisor may only see their own organisation's audit events");
  });
});

// ---------------------------------------------------------------------------
describe("insurer", () => {
  test("cannot activate a policy without an insurer-issued policy number", async () => {
    const db = asUser(sessions.underwriter);
    expectRule(
      await db.insert("policies", {
        customer_id: sessions.customer.userId,
        insurer_org_id: ids.insurer,
        broker_org_id: ids.broker,
        category_id: ids.motor,
        status: "active",
        policy_number: null,
        nickname: `${RUN} no-number`,
      }),
      /policy number is required before cover is active/,
    );
  });

  test("cannot issue for another insurer", async () => {
    const db = asUser(sessions.underwriter);
    const others = (await anon().get(`organizations?select=id&type=eq.insurer&id=neq.${ids.insurer}&limit=1`)).body;
    if (!others.length) return;
    const r = await db.insert("policies", { customer_id: sessions.customer.userId, insurer_org_id: others[0].id, category_id: ids.motor, status: "active", policy_number: `${RUN}-OTHER`, nickname: `${RUN} other insurer` });
    assert.ok(r.status >= 400, `expected rejection, got ${r.status}`);
    assert.ok(["42501", "P0001"].includes(r.code), `${r.code}: ${r.message}`);
  });
});

// ---------------------------------------------------------------------------
describe("privileged purchase journey (needs SUPABASE_SECRET_KEY)", { skip: hasServiceKey() ? false : "skipped: no SUPABASE_SECRET_KEY" }, () => {
  const j = {};
  let svc;

  before(() => {
    svc = service();
  });

  after(async () => {
    // Delete in dependency order; cascades handle quotes/submissions/disclosures/applications/events.
    if (j.claim) await svc.delete(`claims?id=eq.${j.claim}`);
    if (j.payment) await svc.delete(`payments?id=eq.${j.payment}`);
    if (j.policy) await svc.delete(`policies?id=eq.${j.policy}`);
    if (j.request) await svc.delete(`requests?id=eq.${j.request}`);
  });

  test("request → submission (no duplicates) → binding quote", async () => {
    const req = await svc.insert("requests", {
      customer_id: sessions.customer.userId,
      category_id: ids.motor,
      status: "submitted",
      source: "web",
      title: `${RUN} journey`,
      broker_org_id: ids.broker,
      risk_data: { vehicle_make: "E2E", vehicle_model: "Journey", vehicle_year: 2021, vehicle_value: 80000, cover_type: "comprehensive" },
      risk_fingerprint: `${RUN}-${uuid()}`,
    });
    expectOk(req, 201);
    j.request = req.body[0].id;
    j.fingerprint = req.body[0].risk_fingerprint;
    assert.ok(req.body[0].due_at, "SLA due date set on submission");

    const broker = asUser(sessions.broker);
    const sub = await broker.insert("insurer_submissions", { request_id: j.request, insurer_org_id: ids.insurer, broker_org_id: ids.broker, risk_fingerprint: j.fingerprint, status: "sent" });
    expectOk(sub, 201);
    j.submission = sub.body[0].id;
    const dup = await broker.insert("insurer_submissions", { request_id: j.request, insurer_org_id: ids.insurer, broker_org_id: ids.broker, risk_fingerprint: j.fingerprint, status: "sent" });
    assert.equal(dup.code, "23505", `duplicate submission of the same risk to the same insurer must be blocked: ${dup.status} ${dup.message}`);

    const uw = asUser(sessions.underwriter);
    const quote = await uw.insert("quotes", {
      request_id: j.request,
      submission_id: j.submission,
      insurer_org_id: ids.insurer,
      broker_org_id: ids.broker,
      status: "ready_to_accept",
      premium: 3200,
      sum_insured: 80000,
      excess: 1000,
      prepared_by: sessions.underwriter.userId,
    });
    expectOk(quote, 201);
    j.quote = quote.body[0].id;
    assert.equal(quote.body[0].is_binding, true, "ready_to_accept quotes are binding");
    assert.ok(quote.body[0].valid_until, "binding quotes get a validity date");
  });

  test("application is blocked until the broker is disclosed; then accepted", async () => {
    const customer = asUser(sessions.customer);
    const terms = new Date().toISOString();
    expectRule(
      await customer.insert("applications", { request_id: j.request, quote_id: j.quote, customer_id: sessions.customer.userId, status: "submitted", terms_accepted_at: terms }),
      /broker of record must be disclosed/,
    );
    const disclosure = await customer.insert("broker_disclosures", {
      request_id: j.request,
      broker_org_id: ids.broker,
      shown_to: sessions.customer.userId,
      disclosure_text: `${RUN} disclosure`,
      stage: "before_application",
    });
    expectOk(disclosure, 201);

    expectRule(
      await customer.insert("applications", { request_id: j.request, quote_id: j.quote, customer_id: sessions.customer.userId, status: "submitted", terms_accepted_at: null }),
      /Terms and declarations must be accepted/,
    );
    const app = await customer.insert("applications", { request_id: j.request, quote_id: j.quote, customer_id: sessions.customer.userId, status: "submitted", terms_accepted_at: terms, disclosure_id: disclosure.body[0].id });
    expectOk(app, 201);
    j.application = app.body[0].id;
    assert.ok(app.body[0].submitted_at);
  });

  test("payment settles to the insurer; customer sees it but cannot change it", async () => {
    expectRule(
      await svc.insert("payments", { application_id: j.application, request_id: j.request, quote_id: j.quote, customer_id: sessions.customer.userId, payee_org_id: ids.broker, amount: 3200, idempotency_key: `${RUN}-bad-${uuid()}` }),
      /settle directly to a licensed insurer/,
    );
    const pay = await svc.insert("payments", {
      application_id: j.application,
      request_id: j.request,
      quote_id: j.quote,
      customer_id: sessions.customer.userId,
      payee_org_id: ids.insurer,
      amount: 3200,
      status: "succeeded",
      paid_at: new Date().toISOString(),
      idempotency_key: `${RUN}-pay-${uuid()}`,
      provider_reference: `${RUN}-${uuid()}`,
    });
    expectOk(pay, 201);
    j.payment = pay.body[0].id;
    const seen = await asUser(sessions.customer).get(`payments?select=id,status&id=eq.${j.payment}`);
    expectOk(seen);
    assert.equal(seen.body[0]?.status, "succeeded");
    const tamper = await asUser(sessions.customer).update(`payments?id=eq.${j.payment}`, { amount: 1 });
    assert.ok(tamper.status >= 400 || tamper.body.length === 0, "customer has no update policy on payments");
  });

  test("payment confirmation never activates cover; only the insurer issues with a policy number", async () => {
    const pol = await svc.insert("policies", {
      request_id: j.request,
      quote_id: j.quote,
      customer_id: sessions.customer.userId,
      insurer_org_id: ids.insurer,
      broker_org_id: ids.broker,
      category_id: ids.motor,
      status: "pending_issuance",
      premium: 3200,
      nickname: `${RUN} journey policy`,
    });
    expectOk(pol, 201);
    j.policy = pol.body[0].id;
    assert.equal(pol.body[0].status, "pending_issuance");

    expectRule(await asUser(sessions.customer).update(`policies?id=eq.${j.policy}`, { status: "active" }), /Customers can only rename/);
    expectRule(await asUser(sessions.broker).update(`policies?id=eq.${j.policy}`, { status: "active", policy_number: `${RUN}-BRK` }), /Only the issuing insurer/);
    const uw = asUser(sessions.underwriter);
    expectRule(await uw.update(`policies?id=eq.${j.policy}`, { status: "active" }), /policy number is required/);
    const issued = await uw.update(`policies?id=eq.${j.policy}`, { status: "active", policy_number: `${RUN}-POL-${stamp()}`, cover_start: new Date().toISOString().slice(0, 10) });
    expectOk(issued);
    assert.equal(issued.body[0].status, "active");
    assert.ok(issued.body[0].issued_at, "issued_at stamped by trigger");
    assert.equal(issued.body[0].issued_by, sessions.underwriter.userId);
  });

  test("claim: customer reports, broker cannot decide, insurer claims officer decides", async () => {
    const customer = asUser(sessions.customer);
    const claim = await customer.insert("claims", {
      policy_id: j.policy,
      customer_id: sessions.customer.userId,
      insurer_org_id: ids.insurer,
      broker_org_id: ids.broker,
      status: "reported",
      incident_type: "accident",
      description: `${RUN} journey claim`,
      amount_claimed: 2500,
    });
    expectOk(claim, 201);
    j.claim = claim.body[0].id;

    expectRule(await customer.update(`claims?id=eq.${j.claim}`, { status: "approved" }), /Only the insurer/);
    const broker = asUser(sessions.broker);
    expectOk(await broker.update(`claims?id=eq.${j.claim}`, { status: "delivered_to_insurer" }));
    expectRule(await broker.update(`claims?id=eq.${j.claim}`, { status: "approved" }), /Only the insurer/);

    const officer = asUser(sessions.claims);
    expectOk(await officer.update(`claims?id=eq.${j.claim}`, { status: "acknowledged" }));
    const decided = await officer.update(`claims?id=eq.${j.claim}`, { status: "approved", decision_amount: 2000, decision_note: `${RUN} approved` });
    expectOk(decided);
    assert.equal(decided.body[0].status, "approved");
    assert.equal(decided.body[0].decision_by, sessions.claims.userId);
    assert.ok(decided.body[0].decision_at);

    const events = await customer.get(`claim_events?select=from_status,to_status,actor_party&claim_id=eq.${j.claim}&order=id`);
    expectOk(events);
    assert.deepEqual(events.body.map((e) => e.to_status), ["reported", "delivered_to_insurer", "acknowledged", "approved"]);
    assert.deepEqual(events.body.map((e) => e.actor_party), ["customer", "broker", "insurer", "insurer"]);
  });
});
