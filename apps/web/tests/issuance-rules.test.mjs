// Issuance database rules (Addendum 2 A, Level 2): policy-number blocks, issuance jobs, SLA timers,
// the public verify_policy RPC and insurer-direct submissions — exercised through Supabase Auth +
// PostgREST as each role.
// Run:  node --test apps/web/tests/issuance-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Rows created here are tagged `E2E-ISSUANCE…` and are never deleted: number blocks are deactivated and
// requests cancelled at the end (the purge script removes `E2E-%` rows). The block that needs rows only
// the service role may create runs only when SUPABASE_SECRET_KEY is set.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp, uuid } from "./_lib/supabase.mjs";

const TAG = "E2E-ISSUANCE";
const RUN = `${TAG} ${stamp()}`;
const VERIFY_FIELDS = ["valid", "status", "insurer_name", "category_name", "cover_start", "cover_end", "policy_number_masked"];

function expectRefused(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["42501", "P0001", "23503", "23514", "23505"].includes(r.code), `expected RLS/guard rejection, got ${r.code}: ${r.message}`);
}
function expectRule(r, pattern) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected trigger error P0001, got ${r.code}: ${r.message}`);
  assert.match(r.message ?? "", pattern);
}
function expectOk(r, status = 200) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
  if (status === 201) assert.equal(r.status, 201);
}
/** Empty result or a refusal: the role must not see the table's rows. */
function expectHidden(r, table) {
  assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${table}: ${r.status} ${JSON.stringify(r.body)}`);
}

const sessions = {};
const ids = {};

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  const pub = anon();
  const orgs = (await pub.get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  ids.otherInsurer = orgs.find((o) => o.type === "insurer" && o.id !== ids.insurer)?.id ?? null;
  ids.insurerSlug = orgs.find((o) => o.id === ids.insurer)?.slug;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  const cats = (await pub.get("product_categories?select=id,slug")).body;
  ids.motor = cats.find((c) => c.slug === "motor")?.id;
  ids.categories = cats.map((c) => c.id);
  assert.ok(ids.insurer && ids.motor && ids.broker, "seed data (insurer, broker, motor category) must exist");
});

// ---------------------------------------------------------------------------
describe("anonymous visitors", () => {
  test("can call verify_policy and only ever get the allowed, non-personal fields", async () => {
    const pub = anon();
    const missing = await pub.rpc("verify_policy", { p_code: "ZZZZZZZZZZ" });
    expectOk(missing);
    assert.deepEqual(missing.body, { valid: false, status: "not_found" });
    const byNumber = await pub.rpc("verify_policy", { p_insurer: ids.insurerSlug, p_policy_number: `${RUN} no-such-number` });
    expectOk(byNumber);
    assert.equal(byNumber.body.valid, false);
    const empty = await pub.rpc("verify_policy", {});
    expectOk(empty);
    assert.deepEqual(empty.body, { valid: false, status: "invalid_input" });
    for (const r of [missing, byNumber, empty]) for (const k of Object.keys(r.body)) assert.ok(VERIFY_FIELDS.includes(k), `unexpected field ${k}`);
  });

  test("cannot read issuance jobs, number blocks or SLA timers, nor allocate numbers", async () => {
    const pub = anon();
    for (const table of ["issuance_jobs", "policy_number_blocks", "sla_timers"]) expectHidden(await pub.get(`${table}?select=id&limit=1`), table);
    const alloc = await pub.rpc("allocate_policy_number", { p_insurer: ids.insurer, p_category: ids.motor });
    assert.ok(alloc.status >= 400, `anon must not allocate: ${alloc.status}`);
  });
});

// ---------------------------------------------------------------------------
describe("customer", () => {
  test("cannot read issuance jobs or number blocks, and cannot write any of the issuance tables", async () => {
    const db = asUser(sessions.customer);
    expectHidden(await db.get("issuance_jobs?select=id&limit=5"), "issuance_jobs");
    expectHidden(await db.get("policy_number_blocks?select=id&limit=5"), "policy_number_blocks");
    expectRefused(await db.insert("policy_number_blocks", { insurer_org_id: ids.insurer, category_id: ids.motor, prefix: `${RUN}-`, next_number: 1, last_number: 10 }));
    expectRefused(await db.insert("issuance_jobs", { policy_id: uuid(), insurer_org_id: ids.insurer, mode: "delegated", status: "queued" }));
    expectRefused(await db.insert("sla_timers", { subject_type: "request", subject_id: uuid(), due_at: new Date().toISOString() }));
    assert.equal((await db.rpc("allocate_policy_number", { p_insurer: ids.insurer, p_category: ids.motor })).code, "42501", "allocation requires the service role");
  });

  test("sees the verification code of their own policies only (never other customers')", async () => {
    const db = asUser(sessions.customer);
    const mine = await db.get("policies?select=id,customer_id,verification_code&limit=20");
    expectOk(mine);
    assert.ok(mine.body.every((p) => p.customer_id === sessions.customer.userId), "customers only read their own policies");
    assert.ok(mine.body.every((p) => p.verification_code === null || /^[0-9A-HJKMNP-TV-Z]{10}$/.test(p.verification_code)), "codes are 10-char Crockford base32");
  });
});

// ---------------------------------------------------------------------------
describe("broker", () => {
  test("cannot read number blocks or another organisation's issuance jobs", async () => {
    const db = asUser(sessions.broker);
    expectHidden(await db.get("policy_number_blocks?select=id&limit=5"), "policy_number_blocks");
    expectHidden(await db.get("issuance_jobs?select=id&limit=5"), "issuance_jobs");
    expectRefused(await db.insert("policy_number_blocks", { insurer_org_id: ids.insurer, prefix: `${RUN}-`, next_number: 1, last_number: 10 }));
    assert.equal((await db.rpc("allocate_policy_number", { p_insurer: ids.insurer })).code, "42501", "allocation requires the service role");
  });

  test("a submission without a broker of record is refused unless the order is insurer-direct", async () => {
    // Brokers create submissions for their own organisation; a null broker is only valid for
    // insurer_direct routing (guard trigger), and the RLS insert policy requires their own org anyway.
    const db = asUser(sessions.broker);
    const r = await db.insert("insurer_submissions", { request_id: uuid(), insurer_org_id: ids.insurer, broker_org_id: null, risk_fingerprint: `${RUN}-${uuid()}`, status: "sent" });
    expectRefused(r);
  });
});

// ---------------------------------------------------------------------------
describe("insurer", () => {
  test("reads only its own issuance jobs, number blocks and timers; underwriters cannot add blocks", async () => {
    const db = asUser(sessions.underwriter);
    const jobs = await db.get("issuance_jobs?select=id,insurer_org_id&limit=100");
    expectOk(jobs);
    assert.ok(jobs.body.every((j) => j.insurer_org_id === ids.insurer), "an insurer never sees another insurer's jobs");
    const blocks = await db.get("policy_number_blocks?select=id,insurer_org_id&limit=100");
    expectOk(blocks);
    assert.ok(blocks.body.every((b) => b.insurer_org_id === ids.insurer));
    const timers = await db.get("sla_timers?select=id,insurer_org_id,broker_org_id&limit=100");
    expectOk(timers);
    assert.ok(timers.body.every((t) => t.insurer_org_id === ids.insurer || t.broker_org_id === ids.insurer), "only timers naming the insurer");
    // Blocks are managed by owners/admins (RLS); the underwriter account is refused.
    expectRefused(await db.insert("policy_number_blocks", { insurer_org_id: ids.insurer, prefix: `${RUN}-UW-`, next_number: 1, last_number: 10 }));
    if (ids.otherInsurer) {
      expectRefused(await db.insert("policy_number_blocks", { insurer_org_id: ids.otherInsurer, prefix: `${RUN}-X-`, next_number: 1, last_number: 10 }));
      assert.equal((await db.rpc("allocate_policy_number", { p_insurer: ids.otherInsurer })).code, "42501", "allocation requires the service role");
    }
  });

  test("cannot write issuance jobs or SLA timers directly (system writes)", async () => {
    const db = asUser(sessions.underwriter);
    expectRefused(await db.insert("issuance_jobs", { policy_id: uuid(), insurer_org_id: ids.insurer, mode: "delegated", status: "queued" }));
    expectRefused(await db.insert("sla_timers", { subject_type: "issuance", subject_id: uuid(), insurer_org_id: ids.insurer, due_at: new Date().toISOString() }));
  });
});

// ---------------------------------------------------------------------------
describe("number block allocation and direct submissions (needs SUPABASE_SECRET_KEY)", { skip: hasServiceKey() ? false : "skipped: no SUPABASE_SECRET_KEY" }, () => {
  const j = {};
  let svc;

  before(() => {
    svc = service();
  });

  after(async () => {
    // Never delete: deactivate the block and cancel the request so the rows stay auditable.
    if (j.block) await svc.update(`policy_number_blocks?id=eq.${j.block}`, { active: false });
    if (j.request) await svc.update(`requests?id=eq.${j.request}`, { status: "cancelled", cancelled_reason: `${RUN} cleanup` });
  });

  test("allocation is sequential, zero-padded, row-locked under concurrency and raises when exhausted", async () => {
    // A category with no active block for this insurer (never motor, which the seed may use).
    const active = (await svc.get(`policy_number_blocks?select=category_id&insurer_org_id=eq.${ids.insurer}&active=eq.true`)).body.map((b) => b.category_id);
    const category = ids.categories.find((c) => c !== ids.motor && !active.includes(c));
    assert.ok(category, "a category without an active block is needed");
    const created = await svc.insert("policy_number_blocks", { insurer_org_id: ids.insurer, category_id: category, prefix: `${TAG}-${stamp()}-`, next_number: 1, last_number: 8, pad: 4 });
    expectOk(created, 201);
    j.block = created.body[0].id;
    const prefix = created.body[0].prefix;

    const one = await svc.rpc("allocate_policy_number", { p_insurer: ids.insurer, p_category: category });
    const two = await svc.rpc("allocate_policy_number", { p_insurer: ids.insurer, p_category: category });
    const three = await svc.rpc("allocate_policy_number", { p_insurer: ids.insurer, p_category: category });
    expectOk(one);
    assert.deepEqual([one.body, two.body, three.body], [`${prefix}0001`, `${prefix}0002`, `${prefix}0003`]);

    // Five concurrent allocations: all distinct, all within the block (row lock serialises them).
    const parallel = await Promise.all(Array.from({ length: 5 }, () => svc.rpc("allocate_policy_number", { p_insurer: ids.insurer, p_category: category })));
    for (const r of parallel) expectOk(r);
    const numbers = parallel.map((r) => r.body).sort();
    assert.deepEqual(numbers, [4, 5, 6, 7, 8].map((n) => `${prefix}000${n}`));

    expectRule(await svc.rpc("allocate_policy_number", { p_insurer: ids.insurer, p_category: category }), /exhausted/);
    const after = (await svc.get(`policy_number_blocks?select=next_number,last_number&id=eq.${j.block}`)).body[0];
    assert.equal(Number(after.next_number), 9);

    // A second active block for the same line is refused by the partial unique index.
    const dup = await svc.insert("policy_number_blocks", { insurer_org_id: ids.insurer, category_id: category, prefix: `${TAG}-dup-`, next_number: 1, last_number: 2 });
    assert.equal(dup.code, "23505");
  });

  test("a null broker on a submission is only allowed for an insurer-direct order; verify_policy finds real policies by code", async () => {
    const req = await svc.insert("requests", { customer_id: sessions.customer.userId, category_id: ids.motor, status: "submitted", source: "web", title: `${RUN} direct`, risk_data: { vehicle_make: "E2E" }, risk_fingerprint: `${RUN}-${uuid()}` });
    expectOk(req, 201);
    j.request = req.body[0].id;
    // Not routed insurer_direct yet → refused by the guard.
    expectRule(await svc.insert("insurer_submissions", { request_id: j.request, insurer_org_id: ids.insurer, broker_org_id: null, risk_fingerprint: `${RUN}-${uuid()}`, status: "sent" }), /broker of record/);
    // Routed to the insurer directly → allowed, and the insurer sees it with no broker.
    expectOk(await svc.insert("order_routing", { request_id: j.request, mode: "insurer_direct", insurer_org_id: ids.insurer, reason: `${RUN}` }), 201);
    const sub = await svc.insert("insurer_submissions", { request_id: j.request, insurer_org_id: ids.insurer, broker_org_id: null, risk_fingerprint: `${RUN}-${uuid()}`, status: "sent", idempotency_key: `${RUN}-direct` });
    expectOk(sub, 201);
    assert.equal(sub.body[0].broker_org_id, null);
    const seen = await asUser(sessions.underwriter).get(`insurer_submissions?select=id,broker_org_id&id=eq.${sub.body[0].id}`);
    expectOk(seen);
    assert.deepEqual(seen.body, [{ id: sub.body[0].id, broker_org_id: null }]);
    await svc.update(`insurer_submissions?id=eq.${sub.body[0].id}`, { status: "withdrawn" });

    // verify_policy by code returns only the allowed fields for a real policy (if the seed has one).
    const policy = (await svc.get("policies?select=verification_code,status&external_source=eq.false&limit=1")).body[0];
    if (policy?.verification_code) {
      const r = await anon().rpc("verify_policy", { p_code: policy.verification_code.toLowerCase() });
      expectOk(r);
      for (const k of Object.keys(r.body)) assert.ok(VERIFY_FIELDS.includes(k), `unexpected field ${k}`);
      assert.equal(typeof r.body.valid, "boolean");
      assert.ok(!("customer_id" in r.body) && !("premium" in r.body));
    }
  });
});
