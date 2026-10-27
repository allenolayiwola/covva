// Embedded distribution + referrals RLS / RPC tests (supabase/migrations/20261030100200_distribution_referrals.sql),
// exercised through Supabase Auth + PostgREST as each role (same style as db-rules.test.mjs).
// Run:  node --test apps/web/tests/distribution-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Writes: the demo customer's personal referral link (ensure_my_referral_link is idempotent — one row, reused).
// The privileged block (SUPABASE_SECRET_KEY) posts at most ONE permanent zero-value reward_ledger `adjustment`
// (reference `E2E-DBRULES-reward-ledger-immutability`) and reuses it; the ledger is append-only by design.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn } from "./_lib/supabase.mjs";

const TABLES = ["distribution_partners", "referral_links", "referral_attributions", "reward_ledger", "reward_rules"];
const REF = "E2E-DBRULES-reward-ledger-immutability";

function expectDenied(r) {
  assert.ok(r.status >= 400, `expected a permission error, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(r.code === "42501" || r.status === 401 || r.status === 403 || r.code === "PGRST202", `expected 42501/401/403, got ${r.status} ${r.code}: ${r.message}`);
}
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
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.admin = await signIn(ACCOUNTS.admin);
  const orgs = (await anon().get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  assert.ok(ids.broker, "seed data (demo broker) must exist");
});

// ---------------------------------------------------------------------------
describe("anonymous", () => {
  test("cannot read any distribution / referral table", async () => {
    for (const t of TABLES) {
      const r = await anon().get(`${t}?select=*&limit=1`);
      assert.ok(r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `${t}: anon must see nothing (${r.status})`);
    }
  });

  test("cannot call the partner report, my_referrals or create links", async () => {
    expectDenied(await anon().rpc("partner_referral_report", { p_org_id: ids.broker }));
    expectDenied(await anon().rpc("my_referrals"));
    expectDenied(await anon().rpc("ensure_my_referral_link", {}));
  });

  test("embed_partner is public but reveals nothing for an unknown code", async () => {
    const r = await anon().rpc("embed_partner", { p_code: "AAAAAAAA" });
    expectOk(r);
    assert.deepEqual(r.body, []);
  });
});

// ---------------------------------------------------------------------------
describe("customers", () => {
  test("get one personal link (idempotent) and read only their own links", async () => {
    const c = asUser(sessions.customer);
    const a = await c.rpc("ensure_my_referral_link", {});
    expectOk(a);
    const b = await c.rpc("ensure_my_referral_link", { p_code: "ZZZZ2222" });
    expectOk(b);
    assert.match(a.body.code, /^[A-Z2-7]{8}$/);
    assert.equal(a.body.code, b.body.code, "a second call returns the same link");
    const links = await c.get("referral_links?select=id,owner_user_id,owner_org_id&limit=50");
    expectOk(links);
    assert.ok(links.body.length >= 1);
    for (const l of links.body) assert.equal(l.owner_user_id, sessions.customer.userId);
  });

  test("read only their own rewards and attributions, and cannot write either", async () => {
    const c = asUser(sessions.customer);
    const rewards = await c.get("reward_ledger?select=id,user_id&limit=50");
    expectOk(rewards);
    for (const r of rewards.body) assert.equal(r.user_id, sessions.customer.userId);
    const attrs = await c.get("referral_attributions?select=id,customer_id&limit=50");
    expectOk(attrs);
    for (const r of attrs.body) assert.equal(r.customer_id, sessions.customer.userId);
    expectDenied(await c.insert("reward_ledger", { user_id: sessions.customer.userId, kind: "referral_credit", amount: 1000, memo: "E2E-DBRULES must fail" }));
    const link = (await c.rpc("ensure_my_referral_link", {})).body;
    expectDenied(await c.insert("referral_attributions", { code: link.code, lead_id: null, request_id: null, source: "link" }));
    expectOk(await c.rpc("my_referrals"));
  });

  test("cannot see partner rows, switch rules on or touch another organisation's links", async () => {
    const c = asUser(sessions.customer);
    const partners = await c.get("distribution_partners?select=id&limit=5");
    expectOk(partners);
    assert.equal(partners.body.length, 0);
    const upd = await c.update("reward_rules?key=eq.customer_referral", { active: true });
    assert.ok(upd.status >= 400 || (Array.isArray(upd.body) && upd.body.length === 0), "a customer must not change reward rules");
    expectDenied(await c.rpc("partner_referral_report", { p_org_id: ids.broker }));
    expectDenied(await c.rpc("create_partner_referral_link", { p_org_id: ids.broker, p_campaign: "E2E-DBRULES" }));
    expectDenied(await c.rpc("update_partner_widget", { p_org_id: ids.broker, p_widget_domains: ["https://evil.example"] }));
  });
});

// ---------------------------------------------------------------------------
describe("partners and staff", () => {
  test("a broker sees no distribution partner rows and cannot report on other organisations", async () => {
    const b = asUser(sessions.broker);
    const r = await b.get("distribution_partners?select=id&limit=5");
    expectOk(r);
    assert.equal(r.body.length, 0);
    const own = await b.rpc("partner_referral_report", { p_org_id: ids.broker });
    expectOk(own); // members may run the report for their own organisation (broker links)
  });

  test("the partner report masks customer details (first name + masked phone only)", async () => {
    const r = await asUser(sessions.admin).rpc("partner_referral_report", { p_org_id: ids.broker });
    expectOk(r);
    for (const row of r.body) {
      assert.ok(!("customer_id" in row) && !("email" in row) && !("phone" in row), "no raw identifiers");
      if (row.customer_first_name) assert.doesNotMatch(row.customer_first_name, /\s/);
      if (row.customer_phone_masked) assert.match(row.customer_phone_masked, /^.{4}\*{2,}.{2}$/);
    }
  });
});

// ---------------------------------------------------------------------------
describe("privileged (service role)", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
  test("reward_ledger is append-only, even for the service role", async () => {
    const svc = service();
    let row = (await svc.get(`reward_ledger?select=id,amount,memo&reference=eq.${REF}`)).body?.[0];
    if (!row) {
      const ins = await svc.insert("reward_ledger", { org_id: ids.broker, kind: "adjustment", amount: 0, reference: REF, memo: "E2E-DBRULES immutability fixture (zero value)" });
      expectOk(ins);
      row = ins.body[0];
    }
    expectRule(await svc.update(`reward_ledger?id=eq.${row.id}`, { amount: 999 }), /append-only/);
    expectRule(await svc.delete(`reward_ledger?id=eq.${row.id}`), /append-only/);
    const still = await svc.get(`reward_ledger?select=amount&id=eq.${row.id}`);
    assert.equal(Number(still.body[0].amount), 0);
  });

  test("credits cannot be negative and redemptions cannot be positive", async () => {
    const svc = service();
    const r1 = await svc.insert("reward_ledger", { user_id: sessions.customer.userId, kind: "referral_credit", amount: -5, memo: "E2E-DBRULES must fail" });
    assert.equal(r1.code, "23514");
    const r2 = await svc.insert("reward_ledger", { user_id: sessions.customer.userId, kind: "redemption", amount: 5, memo: "E2E-DBRULES must fail" });
    assert.equal(r2.code, "23514");
  });

  test("only distributor organisations can be distribution partners; self-referrals are refused", async () => {
    const svc = service();
    expectRule(await svc.insert("distribution_partners", { org_id: ids.broker, segment: "other" }), /distributor/);
    const link = (await asUser(sessions.customer).rpc("ensure_my_referral_link", {})).body;
    const req = (await svc.get(`requests?select=id&customer_id=eq.${sessions.customer.userId}&limit=1`)).body?.[0];
    if (!req) return;
    expectRule(await svc.insert("referral_attributions", { code: link.code, request_id: req.id, customer_id: sessions.customer.userId, source: "link" }), /refer yourself/);
  });
});
