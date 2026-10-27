// Instalments / micro cover RLS and rule tests (migration 20261030100000_instalments_micro.sql), exercised
// through Supabase Auth + PostgREST as each role (same style as db-rules.test.mjs).
// Run:  node --test apps/web/tests/instalments-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Invariants:
//  * instalment_schedules / instalments / micro_sessions: a customer reads only their own rows (as customer
//    or payer) and cannot create or change them (server writes only).
//  * the policy's insurer reads its schedules; a broker / other party does not.
//  * product_versions.periods / audience_tags and the schedule / instalment statuses are constrained.
//  * the privileged block (seeding a tagged schedule with the secret key) is skipped without SUPABASE_SECRET_KEY.
//  * nothing is ever deleted: the seeded schedule is tagged and reused on every run.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, TAG, anon, asUser, hasServiceKey, service, signIn } from "./_lib/supabase.mjs";

function expectRls(r) {
  assert.ok(r.status >= 400, `expected an RLS rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(r.code === "42501" || r.code === "P0001" || r.status === 403, `expected RLS/rule error, got ${r.code}: ${r.message}`);
}
function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}
function expectNoChange(r) {
  assert.ok(r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `expected no rows changed, got ${r.status} ${JSON.stringify(r.body)}`);
}
function expectCheckViolation(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["23514", "23502", "P0001", "22P02"].includes(r.code), `expected a constraint error, got ${r.code}: ${r.message}`);
}

const sessions = {};
const ids = {};

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  const orgs = (await anon().get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
});

describe("instalments and micro sessions — no service key needed", () => {
  test("anonymous sees nothing", async () => {
    for (const t of ["instalment_schedules", "instalments", "micro_sessions"]) {
      const r = await anon().get(`${t}?select=id&limit=1`);
      assert.ok(r.status >= 400 || (Array.isArray(r.body) && r.body.length === 0), `${t}: anon must see nothing (${r.status})`);
    }
  });

  test("a customer reads only their own schedules and sessions", async () => {
    const c = asUser(sessions.customer);
    const me = sessions.customer.userId;
    const schedules = await c.get("instalment_schedules?select=id,customer_id,payer_user_id&limit=200");
    expectOk(schedules);
    for (const s of schedules.body) assert.ok(s.customer_id === me || s.payer_user_id === me, "only own schedules");
    const sessionsRes = await c.get("micro_sessions?select=id,customer_id&limit=200");
    expectOk(sessionsRes);
    for (const s of sessionsRes.body) assert.equal(s.customer_id, me);
    const other = await c.get(`instalment_schedules?select=id&customer_id=eq.${sessions.broker.userId}`);
    expectOk(other);
    assert.equal(other.body.length, 0);
    expectOk(await c.get("instalments?select=id&limit=5"));
  });

  test("a customer cannot create schedules, instalments or micro sessions", async () => {
    const c = asUser(sessions.customer);
    const me = sessions.customer.userId;
    expectRls(await c.insert("instalment_schedules", { customer_id: me, payer_user_id: me, insurer_org_id: ids.insurer, plan_key: "monthly", total_amount: 100, instalment_count: 2, metadata: { tag: TAG } }));
    const own = (await c.get("instalment_schedules?select=id&limit=1")).body[0];
    if (own) expectRls(await c.insert("instalments", { schedule_id: own.id, seq: 99, due_at: new Date().toISOString(), amount: 1 }));
    const policy = (await c.get("policies?select=id&limit=1")).body[0];
    if (policy) expectRls(await c.insert("micro_sessions", { policy_id: policy.id, customer_id: me, starts_at: new Date().toISOString(), ends_at: new Date(Date.now() + 86_400_000).toISOString(), amount: 2 }));
  });

  test("product versions expose the new period / plan columns publicly for approved versions", async () => {
    const r = await anon().get("product_versions?select=id,periods,instalment_plans,micro,audience_tags&status=eq.approved&limit=5");
    expectOk(r);
    for (const v of r.body) {
      assert.ok(Array.isArray(v.periods) && v.periods.length > 0);
      assert.ok(Array.isArray(v.instalment_plans));
      assert.equal(typeof v.micro, "boolean");
    }
  });
});

describe("instalment RLS with a seeded schedule (needs SUPABASE_SECRET_KEY)", { skip: hasServiceKey() ? false : "skipped: no SUPABASE_SECRET_KEY" }, () => {
  before(async () => {
    const svc = service();
    const me = sessions.customer.userId;
    const existing = (await svc.get(`instalment_schedules?select=id&customer_id=eq.${me}&metadata->>tag=eq.${TAG}&limit=1`)).body[0];
    if (existing) {
      ids.schedule = existing.id;
    } else {
      const created = await svc.insert("instalment_schedules", { customer_id: me, payer_user_id: me, insurer_org_id: ids.insurer, plan_key: "monthly", plan: { key: "monthly", count: 2, deposit_pct: 0, surcharge_pct: 0, grace_days: 14, lapse_after_days: 30, reinstatement: { allowed: true, within_days: 60, requires_review: true } }, total_amount: 100, instalment_count: 2, status: "cancelled", metadata: { tag: TAG, note: "db-rules fixture; never collected (no policy, cancelled)" } });
      expectOk(created);
      ids.schedule = created.body[0].id;
      const due = new Date(Date.now() + 30 * 86_400_000).toISOString();
      expectOk(await svc.insert("instalments", [{ schedule_id: ids.schedule, seq: 1, due_at: new Date().toISOString(), amount: 50, status: "cancelled" }, { schedule_id: ids.schedule, seq: 2, due_at: due, amount: 50, status: "cancelled" }]));
    }
  });

  test("the customer reads their schedule and its instalments but cannot change them", async () => {
    const c = asUser(sessions.customer);
    const s = await c.get(`instalment_schedules?select=id,status&id=eq.${ids.schedule}`);
    expectOk(s);
    assert.equal(s.body.length, 1);
    const inst = await c.get(`instalments?select=id,status,amount&schedule_id=eq.${ids.schedule}`);
    expectOk(inst);
    assert.ok(inst.body.length >= 1);
    expectNoChange(await c.update(`instalments?schedule_id=eq.${ids.schedule}`, { status: "paid" }));
    expectNoChange(await c.update(`instalment_schedules?id=eq.${ids.schedule}`, { status: "completed" }));
    const after = await service().get(`instalments?select=status&schedule_id=eq.${ids.schedule}`);
    for (const r of after.body) assert.notEqual(r.status, "paid");
  });

  test("the policy's insurer reads the schedule; a broker does not", async () => {
    const uw = await asUser(sessions.underwriter).get(`instalment_schedules?select=id&id=eq.${ids.schedule}`);
    expectOk(uw);
    assert.equal(uw.body.length, 1, "insurer of the schedule reads it");
    const uwInst = await asUser(sessions.underwriter).get(`instalments?select=id&schedule_id=eq.${ids.schedule}`);
    expectOk(uwInst);
    assert.ok(uwInst.body.length >= 1);
    expectNoChange(await asUser(sessions.underwriter).update(`instalments?schedule_id=eq.${ids.schedule}`, { status: "waived" }));
    const br = await asUser(sessions.broker).get(`instalment_schedules?select=id&id=eq.${ids.schedule}`);
    expectOk(br);
    assert.equal(br.body.length, 0, "a broker without a link does not read it");
  });

  test("statuses, plan keys, periods and audience tags are constrained", async () => {
    const svc = service();
    expectCheckViolation(await svc.update(`instalment_schedules?id=eq.${ids.schedule}`, { status: "paused" }));
    expectCheckViolation(await svc.update(`instalment_schedules?id=eq.${ids.schedule}`, { plan_key: "weekly" }));
    expectCheckViolation(await svc.update(`instalment_schedules?id=eq.${ids.schedule}`, { currency: "USD" }));
    const inst = (await svc.get(`instalments?select=id&schedule_id=eq.${ids.schedule}&limit=1`)).body[0];
    if (inst) expectCheckViolation(await svc.update(`instalments?id=eq.${inst.id}`, { status: "refunded" }));
    const v = (await svc.get("product_versions?select=id,periods&limit=1")).body[0];
    if (v) {
      expectCheckViolation(await svc.update(`product_versions?id=eq.${v.id}`, { periods: ["fortnight"] }));
      expectCheckViolation(await svc.update(`product_versions?id=eq.${v.id}`, { audience_tags: ["pilot"] }));
    }
  });
});
