// Diaspora payments RLS / rule tests (migration 20261029100100_diaspora_payments.sql), exercised through
// Supabase Auth + PostgREST as each role (same style as db-rules.test.mjs).
// Run:  node --test apps/web/tests/diaspora-payments-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Invariants:
//  * fx_rates are public to read (indicative display rates) and append-only; customers cannot write them.
//  * payment_methods / sponsor_subscriptions / subscription_charges: a customer reads only their own rows
//    and cannot create them (server writes only).
//  * product_bundles: published bundles are public; drafts are staff-only; customers cannot write.
//  * property_* : a customer cannot attach updates or inspections to a policy that is not theirs.
//  * remittance_partners: never visible to customers or anonymous callers.
//  * payments.psp / display_currency are constrained (privileged block, skipped without SUPABASE_SECRET_KEY).
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, uuid } from "./_lib/supabase.mjs";

function expectRls(r) {
  assert.ok(r.status >= 400, `expected an RLS rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(r.code === "42501" || r.code === "P0001" || r.status === 403, `expected RLS/rule error, got ${r.code}: ${r.message}`);
}

function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}

function expectCheckViolation(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["23514", "23502", "23505", "P0001"].includes(r.code), `expected a constraint error, got ${r.code}: ${r.message}`);
}

const sessions = {};
const ids = {};

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  const orgs = (await anon().get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  ids.broker = orgs.find((o) => o.type === "broker")?.id;
});

// ---------------------------------------------------------------------------
describe("fx_rates", () => {
  test("anonymous and customers can read rates; GBP/USD/EUR/CAD are seeded (manual, flagged)", async () => {
    for (const c of [anon(), asUser(sessions.customer)]) {
      const r = await c.get("fx_rates?select=quote,rate,source&order=fetched_at.desc&limit=50");
      expectOk(r);
      for (const q of ["GBP", "USD", "EUR", "CAD"]) {
        const row = r.body.find((x) => x.quote === q);
        assert.ok(row, `${q} rate must be seeded`);
        assert.ok(Number(row.rate) > 0);
        assert.ok(["manual", "openexchangerates", "bog", "provider"].includes(row.source));
      }
    }
    const latest = await anon().rpc("latest_fx_rate", { p_quote: "GBP" });
    expectOk(latest);
    assert.equal(latest.body[0]?.quote, "GBP");
  });

  test("customers and brokers cannot insert, update or delete rates", async () => {
    const c = asUser(sessions.customer);
    expectRls(await c.insert("fx_rates", { quote: "GBP", rate: 1, source: "manual", note: "E2E-DBRULES must fail" }));
    const existing = (await anon().get("fx_rates?select=id&limit=1")).body[0];
    if (existing) {
      const upd = await c.update(`fx_rates?id=eq.${existing.id}`, { rate: 999 });
      assert.ok(upd.status >= 400 || (Array.isArray(upd.body) && upd.body.length === 0), "customer update must not change rates");
      const del = await c.delete(`fx_rates?id=eq.${existing.id}`);
      assert.ok(del.status >= 400 || (Array.isArray(del.body) && del.body.length === 0), "customer delete must be a no-op");
      const still = await anon().get(`fx_rates?select=id,rate&id=eq.${existing.id}`);
      expectOk(still);
      assert.equal(still.body.length, 1);
      assert.notEqual(Number(still.body[0].rate), 999);
    }
    expectRls(await asUser(sessions.broker).insert("fx_rates", { quote: "USD", rate: 1, source: "openexchangerates" }));
  });

  test("the fx and grace-day platform settings exist and are readable", async () => {
    const r = await anon().get("platform_settings?select=key,value&key=in.(fx,payments.grace_days)");
    expectOk(r);
    const fx = r.body.find((s) => s.key === "fx");
    assert.ok(fx && typeof fx.value.margin_pct === "number");
    const grace = r.body.find((s) => s.key === "payments.grace_days");
    assert.ok(grace && Number(grace.value) >= 0);
  });
});

// ---------------------------------------------------------------------------
describe("payment methods, sponsor subscriptions and charges", () => {
  test("anonymous sees nothing", async () => {
    for (const t of ["payment_methods", "sponsor_subscriptions", "subscription_charges", "remittance_partners", "property_inspections", "property_updates"]) {
      const r = await anon().get(`${t}?select=id&limit=1`);
      assert.ok(r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `${t}: anon must see nothing (${r.status})`);
    }
  });

  test("a customer reads only their own methods / subscriptions and cannot create them", async () => {
    const c = asUser(sessions.customer);
    const me = sessions.customer.userId;
    const methods = await c.get("payment_methods?select=id,user_id&limit=100");
    expectOk(methods);
    for (const m of methods.body) assert.equal(m.user_id, me);
    const subs = await c.get("sponsor_subscriptions?select=id,sponsor_user_id&limit=100");
    expectOk(subs);
    for (const s of subs.body) assert.equal(s.sponsor_user_id, me);
    const charges = await c.get("subscription_charges?select=id&limit=5");
    expectOk(charges);
    // Explicitly asking for someone else's rows yields nothing, not an error.
    const other = await c.get(`sponsor_subscriptions?select=id&sponsor_user_id=eq.${sessions.broker.userId}`);
    expectOk(other);
    assert.equal(other.body.length, 0);
    // Writes are server-only (no insert policy).
    expectRls(await c.insert("payment_methods", { user_id: me, psp: "simulator", provider_token_ref: `E2E-DBRULES-${uuid()}`, last4: "4242" }));
    expectRls(await c.insert("sponsor_subscriptions", { sponsor_user_id: me, cadence: "monthly", ghs_amount: 10, psp: "simulator" }));
    const remit = await c.get("remittance_partners?select=id&limit=1");
    assert.ok(remit.status >= 400 || remit.body.length === 0, "remittance partners are staff-only");
  });
});

// ---------------------------------------------------------------------------
describe("product bundles", () => {
  test("the Parents' Care Pack is published and public; customers cannot write bundles", async () => {
    const r = await anon().get("product_bundles?select=slug,status,items,audience&slug=eq.parents-care-pack");
    expectOk(r);
    assert.equal(r.body.length, 1);
    assert.equal(r.body[0].status, "published");
    assert.equal(r.body[0].audience, "diaspora");
    assert.ok(Array.isArray(r.body[0].items) && r.body[0].items.some((i) => i.category_slug === "life-funeral"));
    const drafts = await anon().get("product_bundles?select=id&status=eq.draft");
    expectOk(drafts);
    assert.equal(drafts.body.length, 0, "draft bundles are never public");
    expectRls(await asUser(sessions.customer).insert("product_bundles", { slug: `e2e-dbrules-${uuid().slice(0, 8)}`, name: "E2E-DBRULES must fail", items: [] }));
  });
});

// ---------------------------------------------------------------------------
describe("property cover", () => {
  test("a customer cannot attach photo updates or inspections to someone else's policy", async () => {
    const c = asUser(sessions.customer);
    const me = sessions.customer.userId;
    // A policy the customer cannot see (random id) → RLS insert check fails.
    expectRls(await c.insert("property_updates", { policy_id: uuid(), storage_path: `${me}/policies/E2E-DBRULES.jpg`, uploaded_by: me }));
    expectRls(await c.insert("property_inspections", { policy_id: uuid(), requested_by: me, address: "E2E-DBRULES must fail", status: "requested" }));
    // Nor pre-assign a partner or skip the 'requested' status on their own request.
    const mine = (await c.get("policies?select=id&limit=1")).body[0];
    if (mine) {
      expectRls(await c.insert("property_inspections", { policy_id: mine.id, requested_by: me, address: "E2E-DBRULES must fail", status: "completed" }));
      expectRls(await c.insert("property_inspections", { policy_id: mine.id, requested_by: me, address: "E2E-DBRULES must fail", status: "requested", partner_org_id: ids.broker }));
    }
  });
});

// ---------------------------------------------------------------------------
describe("payments constraints (needs SUPABASE_SECRET_KEY)", { skip: hasServiceKey() ? false : "skipped: no SUPABASE_SECRET_KEY" }, () => {
  test("payments.psp and display_currency are constrained; the GHS amount stays the contract amount", async () => {
    const svc = service();
    const payment = (await svc.get("payments?select=id,amount,currency&limit=1")).body[0];
    if (!payment) return; // nothing to check against on an empty database
    expectCheckViolation(await svc.update(`payments?id=eq.${payment.id}`, { psp: "bitcoin" }));
    expectCheckViolation(await svc.update(`payments?id=eq.${payment.id}`, { display_currency: "NGN" }));
    const still = await svc.get(`payments?select=currency&id=eq.${payment.id}`);
    expectOk(still);
    assert.equal(still.body[0].currency, "GHS");
  });

  test("fx_rates reject non-positive rates and unknown sources; (quote, fetched_at) is unique", async () => {
    const svc = service();
    expectCheckViolation(await svc.insert("fx_rates", { quote: "GBP", rate: 0, source: "manual", note: "E2E-DBRULES must fail" }));
    expectCheckViolation(await svc.insert("fx_rates", { quote: "GBP", rate: 20, source: "guess", note: "E2E-DBRULES must fail" }));
    const existing = (await svc.get("fx_rates?select=quote,fetched_at&order=fetched_at.asc&limit=1")).body[0];
    if (existing) expectCheckViolation(await svc.insert("fx_rates", { quote: existing.quote, rate: 1, source: "manual", fetched_at: existing.fetched_at, note: "E2E-DBRULES duplicate must fail" }));
  });

  test("sponsor subscriptions reject bad cadences, currencies and non-positive amounts", async () => {
    const svc = service();
    const me = sessions.customer.userId;
    expectCheckViolation(await svc.insert("sponsor_subscriptions", { sponsor_user_id: me, cadence: "weekly", ghs_amount: 10, psp: "simulator" }));
    expectCheckViolation(await svc.insert("sponsor_subscriptions", { sponsor_user_id: me, cadence: "monthly", ghs_amount: 0, psp: "simulator" }));
    expectCheckViolation(await svc.insert("sponsor_subscriptions", { sponsor_user_id: me, cadence: "monthly", ghs_amount: 10, display_currency: "NGN", psp: "simulator" }));
    expectCheckViolation(await svc.insert("payment_methods", { user_id: me, psp: "simulator", provider_token_ref: `E2E-DBRULES-${uuid()}`, last4: "12" }));
  });
});
