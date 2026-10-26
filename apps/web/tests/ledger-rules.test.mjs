// Ledger, commercial terms and settlement RLS / immutability tests, exercised through
// Supabase Auth + PostgREST as each role (same style as db-rules.test.mjs).
// Run:  node --test apps/web/tests/ledger-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// The ledger is append-only, so the privileged part posts at most ONE permanent zero-value
// `adjustment` row (reference `E2E-DBRULES-ledger-immutability`) and reuses it on later runs.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn } from "./_lib/supabase.mjs";

const REF = "E2E-DBRULES-ledger-immutability";

function expectRule(r, pattern) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected trigger error P0001, got ${r.code}: ${r.message}`);
  assert.match(r.message ?? "", pattern);
}

function expectRls(r) {
  assert.ok(r.status >= 400, `expected an RLS rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "42501", `expected RLS error 42501, got ${r.code}: ${r.message}`);
}

function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}

const sessions = {};
const ids = {};

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  const orgs = (await anon().get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  assert.ok(ids.broker && ids.insurer, "seed data (demo broker, insurer) must exist");
  const brokerOrgs = (await asUser(sessions.broker).get("memberships?select=org_id&active=eq.true")).body.map((m) => m.org_id);
  ids.brokerOrgs = brokerOrgs;
});

// ---------------------------------------------------------------------------
describe("anonymous and customers", () => {
  test("anonymous cannot read the ledger, terms, splits or statements", async () => {
    const pub = anon();
    for (const t of ["ledger_entries", "org_commercial_terms", "payment_splits", "settlement_statements", "settlement_lines"]) {
      const r = await pub.get(`${t}?select=id&limit=1`);
      assert.ok(r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `${t}: anon must see nothing (${r.status})`);
    }
  });

  test("customer sees no ledger entries, terms, splits or statements and cannot write them", async () => {
    const c = asUser(sessions.customer);
    for (const t of ["ledger_entries", "org_commercial_terms", "payment_splits", "settlement_statements", "settlement_lines"]) {
      const r = await c.get(`${t}?select=id&limit=5`);
      expectOk(r);
      assert.equal(r.body.length, 0, `${t}: customer must read nothing`);
    }
    expectRls(await c.insert("ledger_entries", { entry_type: "adjustment", org_id: ids.insurer, amount: 1, memo: "E2E-DBRULES must fail" }));
    expectRls(await c.insert("settlement_statements", { org_id: ids.broker, period_start: "2026-01-01", period_end: "2026-01-31" }));
  });

  test("customer still sees fee transparency on quotes they can access (column exists)", async () => {
    const r = await asUser(sessions.customer).get("quotes?select=id,fee_breakdown&limit=1");
    expectOk(r);
  });
});

// ---------------------------------------------------------------------------
describe("partners", () => {
  test("broker reads only its own organisation's statements, terms and splits", async () => {
    const b = asUser(sessions.broker);
    const mine = new Set(ids.brokerOrgs);
    for (const t of ["settlement_statements", "org_commercial_terms", "payment_splits"]) {
      const r = await b.get(`${t}?select=id,org_id&limit=200`);
      expectOk(r);
      for (const row of r.body) assert.ok(mine.has(row.org_id), `${t}: broker must not see org ${row.org_id}`);
    }
    // Explicitly asking for another org's rows yields nothing (not an error).
    const other = await b.get(`settlement_statements?select=id&org_id=eq.${ids.insurer}`);
    expectOk(other);
    assert.equal(other.body.length, 0);
    const ledger = await b.get("ledger_entries?select=id,org_id,counterparty_org_id&limit=200");
    expectOk(ledger);
    for (const row of ledger.body) assert.ok(mine.has(row.org_id) || mine.has(row.counterparty_org_id), "broker ledger rows must involve its own org");
  });

  test("partners cannot write ledger entries, terms or statements, nor call the staff-only functions", async () => {
    const b = asUser(sessions.broker);
    expectRls(await b.insert("ledger_entries", { entry_type: "broker_commission", org_id: ids.broker, counterparty_org_id: ids.insurer, amount: 10, memo: "E2E-DBRULES must fail" }));
    expectRls(await b.insert("org_commercial_terms", { org_id: ids.broker, model: "revenue_share", revenue_share_pct: 1 }));
    expectRls(await b.insert("settlement_statements", { org_id: ids.broker, period_start: "2026-01-01", period_end: "2026-01-31" }));
    expectRule(await b.rpc("set_commercial_terms", { p_org: ids.broker, p_model: "revenue_share", p_revenue_share_pct: 5 }), /platform staff/i);
    expectRule(await b.rpc("build_settlement_statement", { p_org: ids.broker, p_start: "2026-01-01", p_end: "2026-01-31" }), /platform staff/i);
    const uw = asUser(sessions.underwriter);
    expectRls(await uw.insert("ledger_entries", { entry_type: "premium_received", org_id: ids.insurer, amount: 10, memo: "E2E-DBRULES must fail" }));
  });
});

// ---------------------------------------------------------------------------
describe("ledger immutability and premium invariants (needs SUPABASE_SECRET_KEY)", { skip: hasServiceKey() ? false : "skipped: no SUPABASE_SECRET_KEY" }, () => {
  let svc;
  let entryId;

  before(async () => {
    svc = service();
    const existing = await svc.get(`ledger_entries?select=id&reference=eq.${REF}&limit=1`);
    expectOk(existing);
    if (existing.body.length) {
      entryId = existing.body[0].id;
    } else {
      const r = await svc.insert("ledger_entries", { entry_type: "adjustment", org_id: ids.insurer, amount: 0, memo: "E2E-DBRULES zero-value immutability probe (permanent)", reference: REF });
      expectOk(r);
      entryId = r.body[0].id;
    }
  });

  test("even the service role cannot update or delete a ledger entry", async () => {
    expectRule(await svc.update(`ledger_entries?id=eq.${entryId}`, { memo: "tampered" }), /append-only/);
    expectRule(await svc.update(`ledger_entries?id=eq.${entryId}`, { amount: 999 }), /append-only/);
    expectRule(await svc.delete(`ledger_entries?id=eq.${entryId}`), /append-only/);
    const still = await svc.get(`ledger_entries?select=id,amount,memo&id=eq.${entryId}`);
    expectOk(still);
    assert.equal(Number(still.body[0].amount), 0);
    assert.notEqual(still.body[0].memo, "tampered");
  });

  test("premiums can only be credited to an insurer — never to a broker", async () => {
    expectRule(await svc.insert("ledger_entries", { entry_type: "premium_received", org_id: ids.broker, amount: 100, memo: "E2E-DBRULES must fail" }), /insurer only/);
  });

  test("the insurer party of a split must be the payment payee", async () => {
    const payment = await svc.get("payments?select=id,payee_org_id&limit=1");
    expectOk(payment);
    if (!payment.body.length) return; // nothing to check against on an empty database
    const p = payment.body[0];
    expectRule(await svc.insert("payment_splits", { payment_id: p.id, party: "insurer", org_id: ids.broker, amount: 1 }), /payment payee/);
    expectRule(await svc.insert("payment_splits", { payment_id: p.id, party: "broker", org_id: p.payee_org_id, amount: 1 }), /broker organisation/);
  });

  test("commercial terms guard: brokers cannot be put on the insurer fee model", async () => {
    expectRule(await svc.insert("org_commercial_terms", { org_id: ids.broker, model: "insurer_fee" }), /revenue share or subscription/);
    expectRule(await svc.insert("org_commercial_terms", { org_id: ids.insurer, model: "revenue_share" }), /insurer fee model/);
  });
});
