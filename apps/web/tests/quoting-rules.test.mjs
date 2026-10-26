// Phase 1 quoting & payments RLS / constraint tests (migration 20261028100300_quoting_payments.sql),
// exercised through Supabase Auth + PostgREST as each role (same style as db-rules.test.mjs).
// Run:  node --test apps/web/tests/quoting-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Rows created here are tagged `E2E-DBRULES…` where a text column exists; quote_shares created by the
// customer expire by themselves (14 days) and are deleted in the privileged teardown when the secret key is set.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn } from "./_lib/supabase.mjs";

function expectRls(r) {
  assert.ok(r.status >= 400, `expected an RLS rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "42501", `expected RLS error 42501, got ${r.code}: ${r.message}`);
}

function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}

const sessions = {};
const ids = { shares: [], lookups: [] };

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
});

after(async () => {
  if (!hasServiceKey()) return;
  const svc = service();
  for (const id of ids.shares) await svc.delete(`quote_shares?id=eq.${id}`);
  for (const reg of ids.lookups) await svc.delete(`vehicle_lookups?registration=eq.${encodeURIComponent(reg)}`);
});

// ---------------------------------------------------------------------------
describe("anonymous", () => {
  test("anon cannot read quote_shares, vehicle_lookups or payment_accounts", async () => {
    const pub = anon();
    for (const t of ["quote_shares", "vehicle_lookups", "payment_accounts"]) {
      const r = await pub.get(`${t}?select=id&limit=1`);
      assert.ok(r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `${t}: anon must see nothing (${r.status})`);
    }
  });

  test("anon cannot create a share or a lookup", async () => {
    const pub = anon();
    const share = await pub.insert("quote_shares", { request_id: "00000000-0000-0000-0000-000000000000", channel: "link", created_by: "00000000-0000-0000-0000-000000000000" });
    assert.ok(share.status >= 400, "anon share insert must fail");
    const lookup = await pub.insert("vehicle_lookups", { registration: "E2E-DBRULES-ANON", data: {} });
    assert.ok(lookup.status >= 400, "anon lookup insert must fail");
  });
});

// ---------------------------------------------------------------------------
describe("customers", () => {
  test("customer reads only their own shares and can share only their own request", async () => {
    const c = asUser(sessions.customer);
    const mine = (await c.get("requests?select=id&limit=1")).body;
    const r = await c.get("quote_shares?select=id,created_by&limit=50");
    expectOk(r);
    for (const row of r.body) assert.equal(row.created_by, sessions.customer.userId, "customer must only see shares they created");

    if (mine?.length) {
      const created = await c.insert("quote_shares", { request_id: mine[0].id, channel: "link", created_by: sessions.customer.userId }, { select: "id,token,expires_at,channel" });
      expectOk(created);
      const share = created.body[0];
      ids.shares.push(share.id);
      assert.match(share.token, /^[a-f0-9]{48}$/, "token is 24 random bytes in hex");
      assert.ok(new Date(share.expires_at) > new Date(Date.now() + 13 * 86_400_000), "expires in ~14 days");
      const again = await c.get(`quote_shares?select=id&id=eq.${share.id}`);
      expectOk(again);
      assert.equal(again.body.length, 1);
      // Spoofing created_by is rejected by the insert policy.
      expectRls(await c.insert("quote_shares", { request_id: mine[0].id, channel: "link", created_by: sessions.broker.userId }));
    }
    // A request that is not theirs (or does not exist) cannot be shared.
    expectRls(await c.insert("quote_shares", { request_id: "00000000-0000-0000-0000-000000000000", channel: "link", created_by: sessions.customer.userId }));
  });

  test("broker does not see a customer's shares", async () => {
    if (!ids.shares.length) return;
    const b = asUser(sessions.broker);
    const r = await b.get(`quote_shares?select=id&id=eq.${ids.shares[0]}`);
    expectOk(r);
    assert.equal(r.body.length, 0);
  });

  test("customer can read vehicle lookups (vehicle facts only) but cannot write them", async () => {
    const c = asUser(sessions.customer);
    const r = await c.get("vehicle_lookups?select=registration,source,data&limit=5");
    expectOk(r);
    for (const row of r.body) {
      for (const k of Object.keys(row.data ?? {})) assert.ok(!/name|address|owner|phone|id_number/i.test(k), `lookup data must not carry keeper PII (${k})`);
    }
    expectRls(await c.insert("vehicle_lookups", { registration: "E2E-DBRULES-CUST", source: "manual", data: { make: "Toyota" } }));
  });

  test("customer sees only their own payment accounts and cannot create one", async () => {
    const c = asUser(sessions.customer);
    const r = await c.get("payment_accounts?select=id,customer_id&limit=20");
    expectOk(r);
    for (const row of r.body) assert.equal(row.customer_id, sessions.customer.userId);
    expectRls(await c.insert("payment_accounts", { customer_id: sessions.customer.userId, provider: "paystack", account_number: "0000000000" }));
  });

  test("customer can switch WhatsApp opt-in on their own profile", async () => {
    const c = asUser(sessions.customer);
    const before = (await c.get(`profiles?select=whatsapp_opt_in&id=eq.${sessions.customer.userId}`)).body[0];
    assert.ok(before && typeof before.whatsapp_opt_in === "boolean");
    const flipped = await c.update(`profiles?id=eq.${sessions.customer.userId}`, { whatsapp_opt_in: !before.whatsapp_opt_in });
    expectOk(flipped);
    const restored = await c.update(`profiles?id=eq.${sessions.customer.userId}`, { whatsapp_opt_in: before.whatsapp_opt_in });
    expectOk(restored);
  });
});

// ---------------------------------------------------------------------------
describe("privileged constraints (needs SUPABASE_SECRET_KEY)", { skip: hasServiceKey() ? false : "skipped: no SUPABASE_SECRET_KEY" }, () => {
  test("payments.provider is restricted to paystack | hubtel | simulator | bank_transfer", async () => {
    const svc = service();
    const payment = (await svc.get("payments?select=id&limit=1")).body?.[0];
    if (!payment) return; // nothing to probe against on an empty database
    const r = await svc.update(`payments?id=eq.${payment.id}`, { provider: "not-a-provider" });
    assert.ok(r.status >= 400, "unknown provider must be rejected");
    assert.equal(r.code, "23514", `expected a check-constraint violation, got ${r.code}: ${r.message}`);
  });

  test("vehicle_lookups: service writes, source constrained, registration unique", async () => {
    const svc = service();
    const reg = "E2E 9999-99";
    ids.lookups.push(reg);
    expectOk(await svc.insert("vehicle_lookups", { registration: reg, source: "manual", data: { make: "Toyota", model: "Corolla", year: 2020 } }));
    const dup = await svc.insert("vehicle_lookups", { registration: reg, source: "manual", data: {} });
    assert.equal(dup.code, "23505", "registration is unique");
    const bad = await svc.insert("vehicle_lookups", { registration: `${reg}-X`, source: "telepathy", data: {} });
    assert.equal(bad.code, "23514", "source is constrained");
    // Customers can read it back (no owner data inside).
    const c = asUser(sessions.customer);
    const r = await c.get(`vehicle_lookups?select=registration,data&registration=eq.${encodeURIComponent(reg)}`);
    expectOk(r);
    assert.equal(r.body[0]?.data?.make, "Toyota");
  });

  test("quote_shares: channel and target constraints", async () => {
    const svc = service();
    const mine = (await svc.get(`requests?select=id&customer_id=eq.${sessions.customer.userId}&limit=1`)).body;
    if (!mine?.length) return;
    const badChannel = await svc.insert("quote_shares", { request_id: mine[0].id, channel: "pigeon", created_by: sessions.customer.userId });
    assert.equal(badChannel.code, "23514");
    const noTarget = await svc.insert("quote_shares", { channel: "link", created_by: sessions.customer.userId });
    assert.equal(noTarget.code, "23514");
  });
});
