// Partner analytics functions (supabase/migrations/20261028100400_partner_analytics.sql): membership
// gate, role gate for money, customer-name masking for insurers — exercised through Supabase Auth +
// PostgREST RPC as each role (same style as db-rules.test.mjs).
// Run:  node --test apps/web/tests/analytics-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Fixture: the demo customer adds one policy "bought elsewhere" (the only kind a customer may create)
// with the demo insurer and a cover end 20 days out, tagged `E2E-DBRULES…`, so partner_renewals has a
// row for both the insurer (masked name) and the privileged checks. The purge script removes it when
// SUPABASE_SECRET_KEY is set; otherwise it is reused on later runs.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, TAG, anon, asUser, hasServiceKey, service, signIn, stamp, uuid } from "./_lib/supabase.mjs";

const RUN = `${TAG} ${stamp()}`;
const FIXTURE_NUMBER = "E2E-DBRULES-RENEWAL-FIXTURE";

function expectForbidden(r) {
  assert.ok(r.status >= 400, `expected a permission error, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(r.code === "42501" || r.status === 401 || r.status === 403, `expected 42501/401/403, got ${r.status} ${r.code}: ${r.message}`);
}

function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

const sessions = {};
const ids = {};

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.adviser = await signIn(ACCOUNTS.adviser);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  const orgs = (await anon().get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  assert.ok(ids.broker && ids.insurer, "seed data (demo broker, insurer) must exist");
  const cats = (await anon().get("product_categories?select=id,slug&limit=50")).body;
  ids.motor = cats.find((c) => c.slug === "motor")?.id ?? cats[0]?.id;
  assert.ok(ids.motor, "a product category must exist");

  // Renewal fixture owned by the customer, insured by the demo insurer.
  const c = asUser(sessions.customer);
  const existing = await c.get(`policies?select=id,cover_end&policy_number=eq.${FIXTURE_NUMBER}&limit=1`);
  if (existing.status < 300 && existing.body.length) {
    ids.fixture = existing.body[0].id;
    if (existing.body[0].cover_end < today()) {
      // Customers may only rename; a stale fixture is simply ignored by the window checks below.
      ids.fixtureStale = true;
    }
  } else {
    const r = await c.insert("policies", {
      customer_id: sessions.customer.userId,
      insurer_org_id: ids.insurer,
      category_id: ids.motor,
      status: "active",
      external_source: true,
      policy_number: FIXTURE_NUMBER,
      nickname: `${RUN} renewal fixture`,
      cover_start: plusDays(-345),
      cover_end: plusDays(20),
      premium: 1200,
    });
    if (r.status < 300) ids.fixture = r.body[0].id;
    else ids.fixtureError = `${r.status} ${r.message ?? JSON.stringify(r.body)}`;
  }
});

after(async () => {
  if (!hasServiceKey() || !ids.fixture) return;
  await service().delete(`policies?id=eq.${ids.fixture}`);
});

// ---------------------------------------------------------------------------
describe("membership gate", () => {
  test("broker member can call partner_sales_summary for their own organisation", async () => {
    const r = await asUser(sessions.broker).rpc("partner_sales_summary", { p_org_id: ids.broker, p_from: plusDays(-6), p_to: today() });
    expectOk(r);
    assert.equal(r.body.length, 7, "one row per day");
    for (const row of r.body) {
      for (const k of ["requests", "quotes", "conversions", "policies_issued"]) assert.equal(typeof row[k], "number", `${k} is a number`);
      assert.ok(Number(row.premium) >= 0 && Number(row.platform_fee) >= 0 && Number(row.broker_commission) >= 0);
    }
  });

  test("adviser (non-finance) can read sales, renewals, claims, SLA and lapses for the org", async () => {
    const a = asUser(sessions.adviser);
    expectOk(await a.rpc("partner_sales_summary", { p_org_id: ids.broker }));
    expectOk(await a.rpc("partner_renewals", { p_org_id: ids.broker, p_days: 60 }));
    const claims = await a.rpc("partner_claims_summary", { p_org_id: ids.broker });
    expectOk(claims);
    for (const k of ["by_status", "total", "open", "decided", "stale_open"]) assert.ok(k in claims.body, `claims summary has ${k}`);
    const sla = await a.rpc("partner_sla_performance", { p_org_id: ids.broker, p_days: 90 });
    expectOk(sla);
    assert.equal(sla.body.length, 1);
    assert.ok(sla.body[0].requests_on_time <= sla.body[0].requests_measured);
    const lapses = await a.rpc("partner_lapses", { p_org_id: ids.broker });
    expectOk(lapses);
    assert.equal(lapses.body[0].ended, lapses.body[0].lapsed + lapses.body[0].cancelled + lapses.body[0].expired + lapses.body[0].renewed);
  });

  test("broker member gets a permission error for another organisation (and for an unknown id)", async () => {
    const b = asUser(sessions.broker);
    const brokerOrgs = (await b.get("memberships?select=org_id&active=eq.true")).body.map((m) => m.org_id);
    if (!brokerOrgs.includes(ids.insurer)) expectForbidden(await b.rpc("partner_sales_summary", { p_org_id: ids.insurer }));
    expectForbidden(await b.rpc("partner_sales_summary", { p_org_id: uuid() }));
    expectForbidden(await b.rpc("partner_renewals", { p_org_id: uuid(), p_days: 30 }));
    expectForbidden(await b.rpc("partner_claims_summary", { p_org_id: uuid() }));
    expectForbidden(await b.rpc("partner_lapses", { p_org_id: uuid() }));
  });

  test("customers and anonymous callers cannot use the analytics functions", async () => {
    const c = asUser(sessions.customer);
    expectForbidden(await c.rpc("partner_sales_summary", { p_org_id: ids.broker }));
    expectForbidden(await c.rpc("partner_renewals", { p_org_id: ids.insurer, p_days: 30 }));
    expectForbidden(await c.rpc("partner_commission_summary", { p_org_id: ids.broker, p_period: "2026-10" }));
    expectForbidden(await anon().rpc("partner_sales_summary", { p_org_id: ids.broker }));
    expectForbidden(await anon().rpc("partner_claims_summary", { p_org_id: ids.broker }));
  });

  test("the private implementations are not callable directly", async () => {
    const r = await asUser(sessions.broker).rpc("partner_org_gate", { p_org: ids.broker });
    assert.ok(r.status >= 400, "private schema functions are not exposed through PostgREST");
  });
});

// ---------------------------------------------------------------------------
describe("money", () => {
  test("owner/admin/finance sees the commission summary; an adviser does not", async () => {
    const owner = await asUser(sessions.broker).rpc("partner_commission_summary", { p_org_id: ids.broker, p_period: today().slice(0, 7) });
    const me = (await asUser(sessions.broker).get(`memberships?select=role&org_id=eq.${ids.broker}&active=eq.true`)).body[0];
    if (me && ["owner", "admin", "finance"].includes(me.role)) {
      expectOk(owner);
      assert.equal(owner.body.length, 1);
      const row = owner.body[0];
      assert.equal(row.period, today().slice(0, 7));
      assert.ok(Number(row.outstanding) >= 0 && Number(row.outstanding) <= Number(row.earned) + 0.01, "outstanding ≤ earned and never negative");
    } else {
      expectForbidden(owner);
    }
    const adviser = (await asUser(sessions.adviser).get(`memberships?select=role&org_id=eq.${ids.broker}&active=eq.true`)).body[0];
    const r = await asUser(sessions.adviser).rpc("partner_commission_summary", { p_org_id: ids.broker });
    if (adviser && !["owner", "admin", "finance"].includes(adviser.role)) expectForbidden(r);
    else expectOk(r);
  });

  test("a malformed period is a business-rule error, not a crash", async () => {
    const r = await asUser(sessions.broker).rpc("partner_commission_summary", { p_org_id: ids.broker, p_period: "October" });
    assert.ok(r.status >= 400);
    assert.ok(r.code === "P0001" || r.code === "42501", `got ${r.code}`);
  });
});

// ---------------------------------------------------------------------------
describe("renewals and masking", () => {
  test("insurer members see masked customer names and no contact details", async () => {
    const r = await asUser(sessions.underwriter).rpc("partner_renewals", { p_org_id: ids.insurer, p_days: 365 });
    expectOk(r);
    if (ids.fixture && !ids.fixtureStale) {
      assert.ok(r.body.some((x) => x.policy_id === ids.fixture), `fixture policy appears in the insurer's renewal list (${ids.fixtureError ?? "created"})`);
    }
    for (const row of r.body) {
      assert.equal(row.customer_email, null, "insurers never get the customer's email");
      assert.equal(row.customer_phone, null, "insurers never get the customer's phone");
      // "Ama Mensah" → "Ama M." — a business name or single-word name passes through unchanged.
      assert.ok(!/\S+\s+\S{2,}/.test(row.customer_name) || /\s[A-Z]\.$/.test(row.customer_name), `masked name, got "${row.customer_name}"`);
      assert.equal(typeof row.contact_allowed, "boolean");
      assert.equal(typeof row.marketing_allowed, "boolean");
      assert.ok(row.days_left >= 0 && row.days_left <= 365);
    }
  });

  test("the window is honoured: nothing beyond p_days", async () => {
    const r = await asUser(sessions.underwriter).rpc("partner_renewals", { p_org_id: ids.insurer, p_days: 1 });
    expectOk(r);
    for (const row of r.body) assert.ok(row.days_left <= 1);
  });

  test("the security_invoker views apply the caller's RLS", async () => {
    // A customer sees only their own policies through the renewal pipeline view, and no audit rows.
    const c = asUser(sessions.customer);
    const pipeline = await c.get("partner_renewal_pipeline?select=policy_id,customer_id&limit=50");
    expectOk(pipeline);
    for (const row of pipeline.body) assert.equal(row.customer_id, sessions.customer.userId);
    const activity = await c.get("partner_activity?select=id&limit=5");
    expectOk(activity);
    assert.equal(activity.body.length, 0, "customers have no audit visibility");
    // An adviser (not owner/admin/supervisor) sees no org activity either.
    const adviserRole = (await asUser(sessions.adviser).get(`memberships?select=role,is_supervisor&org_id=eq.${ids.broker}&active=eq.true`)).body[0];
    const adviserActivity = await asUser(sessions.adviser).get(`partner_activity?select=id&org_id=eq.${ids.broker}&limit=5`);
    expectOk(adviserActivity);
    if (adviserRole && !adviserRole.is_supervisor && !["owner", "admin", "supervisor"].includes(adviserRole.role)) assert.equal(adviserActivity.body.length, 0);
  });
});

// ---------------------------------------------------------------------------
describe("privileged (service key)", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
  test("the service role bypasses the membership gate (API-key routes scope orgId in code)", async () => {
    const svc = service();
    expectOk(await svc.rpc("partner_sales_summary", { p_org_id: ids.broker, p_from: plusDays(-1), p_to: today() }));
    expectOk(await svc.rpc("partner_commission_summary", { p_org_id: ids.insurer }));
    const r = await svc.rpc("partner_renewals", { p_org_id: ids.broker, p_days: 30 });
    expectOk(r);
  });

  test("the renewal fixture is visible with full details to the policy's broker of record only", async () => {
    if (!ids.fixture) return;
    const svc = service();
    // Attach the demo broker as broker of record for the fixture, then read as the broker.
    expectOk(await svc.update(`policies?id=eq.${ids.fixture}`, { broker_org_id: ids.broker }));
    const r = await asUser(sessions.broker).rpc("partner_renewals", { p_org_id: ids.broker, p_days: 365 });
    expectOk(r);
    const row = r.body.find((x) => x.policy_id === ids.fixture);
    assert.ok(row, "broker of record sees the policy in its renewal list");
    assert.ok(!/\s[A-Z]\.$/.test(row.customer_name) || row.customer_name.split(" ").length === 1, "brokers see the full name");
    assert.equal(typeof row.renewal_request_id === "string" || row.renewal_request_id === null, true);
  });
});
