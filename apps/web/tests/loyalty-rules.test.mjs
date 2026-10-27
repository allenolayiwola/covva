// Loyalty rules engine + motor telematics database rules (Roadmap Phase 4): versioned per-insurer rule sets,
// explicit discount lines on quotes, consent-first telematics enrolment, trip ingestion, monthly scores and the
// Act 843 retention hooks — exercised through Supabase Auth + PostgREST as each role.
// Run:  node --test apps/web/tests/loyalty-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Rows are tagged `E2E-LOYAL…` (notes, device labels, trip ids). Rule-set versions are append-only by design, so
// each run publishes a new version for the demo insurer and ends by publishing one with every rule switched off.
// Blocks that need the service role (discount lines, trips, scores — written by the server only) are skipped
// without SUPABASE_SECRET_KEY.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp } from "./_lib/supabase.mjs";

const TAG = "E2E-LOYAL";
const RUN = `${TAG} ${stamp()}`;

function expectRule(r, pattern) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected trigger error P0001, got ${r.code}: ${r.message}`);
  if (pattern) assert.match(r.message ?? "", pattern);
}
function expectRefused(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["42501", "P0001", "23503", "23514", "23502", "23505"].includes(r.code), `expected RLS/guard rejection, got ${r.code}: ${r.message}`);
}
function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}
const emptyOrRefused = (r, what) => assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${what}: ${r.status} ${JSON.stringify(r.body)}`);

const OFF_RULES = [
  { key: "no_claims", type: "no_claims", active: false, tiers: [{ years: 1, pct: 10 }] },
  { key: "bundle", type: "bundle", active: false, pct: 5, min_categories: 2 },
];
const ON_RULES = [
  { key: "no_claims", type: "no_claims", active: true, tiers: [{ years: 1, pct: 10 }, { years: 3, pct: 20 }], max_pct: 20 },
  { key: "early_renewal", type: "early_renewal", active: true, pct: 3, days_before_expiry: 14 },
  { key: "safe_driver", type: "safe_driver", active: true, tiers: [{ score: 75, pct: 5 }, { score: 90, pct: 10 }], min_months: 3 },
];

const sessions = {};
const ids = {};

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.other = await signIn(ACCOUNTS.adviser); // a signed-in person who is not the customer, the insurer or the broker of record
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter); // insurer member, not owner/admin
  sessions.admin = await signIn(ACCOUNTS.admin);
  const pub = anon();
  const orgs = (await pub.get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  ids.otherInsurer = orgs.find((o) => o.type === "insurer" && o.id !== ids.insurer)?.id;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  assert.ok(ids.insurer && ids.broker, "seed data (demo broker, an insurer) must exist");
  const me = asUser(sessions.underwriter);
  const membership = await me.get(`memberships?select=role&org_id=eq.${ids.insurer}&user_id=eq.${sessions.underwriter.userId}`);
  ids.underwriterIsAdmin = ["owner", "admin"].includes(membership.body?.[0]?.role);
});

after(async () => {
  // Leave the demo insurer with every rule off (the version history keeps this run's publications, tagged by note).
  if (ids.publishedByInsurer) {
    await asUser(sessions.underwriter).rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.insurer, p_rules: OFF_RULES, p_max_combined_pct: 25, p_note: `${RUN} reset (all rules off)` });
  }
  if (ids.enrolment) await asUser(sessions.customer).rpc("withdraw_telematics", { p_enrolment_id: ids.enrolment, p_reason: `${RUN} cleanup` });
});

describe("anonymous visitors", () => {
  test("see nothing and cannot publish, enrol or read scores", async () => {
    const pub = anon();
    for (const t of ["loyalty_rule_sets", "quote_discounts", "telematics_enrolments", "telematics_trips", "telematics_scores"]) {
      emptyOrRefused(await pub.get(`${t}?select=id&limit=1`), t);
    }
    assert.ok((await pub.rpc("publish_loyalty_rule_set", { p_insurer_org_id: null, p_rules: [] })).status >= 400);
    assert.ok((await pub.rpc("enrol_telematics", { p_policy_id: "00000000-0000-0000-0000-000000000000", p_device_id: "x-device-1" })).status >= 400);
  });
});

describe("rule sets", () => {
  test("the platform fallback exists, is published and has every rule switched off", async () => {
    const r = await asUser(sessions.customer).get("loyalty_rule_sets?select=id,version,status,rules,max_combined_pct&insurer_org_id=is.null&status=eq.published");
    expectOk(r);
    assert.equal(r.body.length, 1, "exactly one published fallback");
    assert.ok(Array.isArray(r.body[0].rules) && r.body[0].rules.length >= 6);
    assert.ok(r.body[0].rules.every((rule) => rule.active === false), "seeded fallback rules are all OFF until insurers sign off");
  });

  test("signed-in users read published sets only; writes are refused for everyone", async () => {
    const db = asUser(sessions.customer);
    const r = await db.get("loyalty_rule_sets?select=id,status");
    expectOk(r);
    assert.ok(r.body.every((s) => s.status === "published"));
    expectRefused(await db.insert("loyalty_rule_sets", { insurer_org_id: ids.insurer, version: 999, note: RUN }));
    expectRefused(await db.update(`loyalty_rule_sets?insurer_org_id=is.null`, { max_combined_pct: 99 }));
    expectRefused(await asUser(sessions.admin).update(`loyalty_rule_sets?insurer_org_id=is.null`, { max_combined_pct: 99 }));
  });

  test("a customer, a broker and an underwriter cannot publish for an insurer; nobody but staff publishes the fallback", async () => {
    expectRefused(await asUser(sessions.customer).rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.insurer, p_rules: OFF_RULES, p_note: RUN }));
    expectRefused(await asUser(sessions.broker).rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.insurer, p_rules: OFF_RULES, p_note: RUN }));
    expectRefused(await asUser(sessions.underwriter).rpc("publish_loyalty_rule_set", { p_insurer_org_id: null, p_rules: OFF_RULES, p_note: RUN }));
    if (!ids.underwriterIsAdmin) expectRefused(await asUser(sessions.underwriter).rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.insurer, p_rules: OFF_RULES, p_note: RUN }));
    if (ids.otherInsurer) expectRefused(await asUser(sessions.underwriter).rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.otherInsurer, p_rules: OFF_RULES, p_note: RUN }));
  });

  test("validation refuses bad rules with human messages (any publisher)", async () => {
    const db = asUser(sessions.admin); // staff may publish for any insurer: the validation is what is under test
    expectRule(await db.rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.insurer, p_rules: [{ key: "Bad Key", type: "bundle", active: true, pct: 5 }], p_note: RUN }), /lower-case/);
    expectRule(await db.rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.insurer, p_rules: [{ key: "bb", type: "bundle", active: true, pct: 150 }], p_note: RUN }), /between 0 and 100/);
    expectRule(await db.rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.insurer, p_rules: [{ key: "nc", type: "no_claims", active: true }], p_note: RUN }), /at least one tier/);
    expectRule(await db.rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.insurer, p_rules: [{ key: "xx", type: "cashback", active: false }], p_note: RUN }), /unknown rule type/i);
    expectRule(await db.rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.insurer, p_rules: [], p_max_combined_pct: 120, p_note: RUN }), /combined/);
    expectRule(await db.rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.insurer, p_rules: [], p_stacking_order: ["bundle", "bundle"], p_note: RUN }), /twice/);
  });

  test("publishing creates the next version and supersedes the previous one; the effective set is the insurer's own", async () => {
    // Staff publish on the demo insurer's behalf (the demo underwriter is not an owner/admin); an insurer admin would do the same from the partner workspace.
    const publisher = ids.underwriterIsAdmin ? asUser(sessions.underwriter) : asUser(sessions.admin);
    const v1 = await publisher.rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.insurer, p_rules: ON_RULES, p_max_combined_pct: 20, p_note: `${RUN} v-on` });
    expectOk(v1);
    ids.publishedByInsurer = true;
    assert.equal(v1.body.status, "published");
    assert.equal(v1.body.insurer_org_id, ids.insurer);
    const v2 = await publisher.rpc("publish_loyalty_rule_set", { p_insurer_org_id: ids.insurer, p_rules: ON_RULES, p_max_combined_pct: 25, p_note: `${RUN} v-on-2` });
    expectOk(v2);
    assert.equal(v2.body.version, v1.body.version + 1);
    const eff = await asUser(sessions.customer).rpc("effective_loyalty_rule_set", { p_insurer_org_id: ids.insurer });
    expectOk(eff);
    assert.equal(eff.body.id, v2.body.id, "the newest published version is in force");
    const prev = await asUser(sessions.admin).get(`loyalty_rule_sets?select=status,superseded_at&id=eq.${v1.body.id}`);
    assert.equal(prev.body[0].status, "superseded");
    assert.ok(prev.body[0].superseded_at);
    // Superseded versions are not visible to other signed-in users; the insurer's own members and staff see them.
    const asOther = await asUser(sessions.other).get(`loyalty_rule_sets?select=id&id=eq.${v1.body.id}`);
    assert.equal(asOther.body.length, 0);
    const asInsurer = await asUser(sessions.underwriter).get(`loyalty_rule_sets?select=id&id=eq.${v1.body.id}`);
    assert.equal(asInsurer.body.length, 1);
  });
});

describe("discount lines", { skip: !hasServiceKey() && "needs SUPABASE_SECRET_KEY" }, () => {
  before(async () => {
    const svc = service();
    const q = await svc.get(`quotes?select=id,request_id,premium,insurer_org_id,broker_org_id,request:requests!quotes_request_id_fkey(customer_id)&insurer_org_id=eq.${ids.insurer}&request.customer_id=eq.${sessions.customer.userId}&order=created_at.desc&limit=1`);
    ids.quote = q.body?.[0] ?? null;
  });

  test("the server records explicit lines; the guard copies the quote's parties and refuses more than the premium", async (t) => {
    if (!ids.quote) return t.skip("the demo customer needs a quote from the demo insurer");
    const svc = service();
    await svc.delete(`quote_discounts?quote_id=eq.${ids.quote.id}&rule_key=like.e2e_%`);
    const ins = await svc.insert("quote_discounts", { quote_id: ids.quote.id, rule_key: "e2e_no_claims", rule_type: "no_claims", label: `${RUN} No-claims`, explanation: "1 claim-free year: 10% off (test).", basis: "premium", pct: 10, amount: Math.min(1, Number(ids.quote.premium)) });
    expectOk(ins);
    ids.discount = ins.body[0].id;
    assert.equal(ins.body[0].request_id, ids.quote.request_id);
    assert.equal(ins.body[0].insurer_org_id, ids.quote.insurer_org_id);
    expectRule(await svc.insert("quote_discounts", { quote_id: ids.quote.id, rule_key: "e2e_big", rule_type: "bundle", label: "x", explanation: "x", amount: Number(ids.quote.premium) + 1 }), /exceed the premium/);
    expectRefused(await svc.insert("quote_discounts", { quote_id: ids.quote.id, rule_key: "e2e_no_claims", rule_type: "no_claims", label: "dup", explanation: "dup", amount: 1 }));
  });

  test("the customer, the broker of the quote and the insurer see the line; others see nothing; nobody writes", async (t) => {
    if (!ids.discount) return t.skip("no discount line");
    const sel = `quote_discounts?select=id&id=eq.${ids.discount}`;
    assert.equal((await asUser(sessions.customer).get(sel)).body.length, 1, "customer");
    assert.equal((await asUser(sessions.underwriter).get(sel)).body.length, 1, "insurer");
    if (ids.quote.broker_org_id === ids.broker) assert.equal((await asUser(sessions.broker).get(sel)).body.length, 1, "broker");
    assert.equal((await asUser(sessions.other).get(sel)).body.length, 0, "outsider");
    assert.equal((await asUser(sessions.admin).get(sel)).body.length, 1, "staff");
    expectRefused(await asUser(sessions.customer).insert("quote_discounts", { quote_id: ids.quote.id, rule_key: "e2e_me", rule_type: "bundle", label: "x", explanation: "x", amount: 1 }));
    expectRefused(await asUser(sessions.broker).delete(`quote_discounts?id=eq.${ids.discount}`));
  });

  after(async () => {
    if (hasServiceKey() && ids.quote) await service().delete(`quote_discounts?quote_id=eq.${ids.quote.id}&rule_key=like.e2e_%`);
  });
});

describe("telematics", () => {
  before(async () => {
    const db = asUser(sessions.customer);
    const motor = await db.get("policies?select=id,status,category:product_categories!policies_category_id_fkey(slug)&external_source=eq.false&status=in.(active,pending_issuance)&category.slug=eq.motor&limit=5");
    ids.motorPolicy = motor.body?.find((p) => p.category?.slug === "motor")?.id ?? null;
    const home = await db.get("policies?select=id,category:product_categories!policies_category_id_fkey(slug)&external_source=eq.false&status=in.(active,pending_issuance)&category.slug=neq.motor&limit=5");
    ids.nonMotorPolicy = home.body?.find((p) => p.category && p.category.slug !== "motor")?.id ?? null;
    // Make sure the latest telematics decision is "withdrawn" so the consent-first check is real.
    await db.insert("consents", { user_id: sessions.customer.userId, type: "telematics", version: "telematics-2026-10", granted: false, context: `${RUN} reset` });
    const active = await db.get("telematics_enrolments?select=id&status=eq.active");
    for (const e of active.body ?? []) await db.rpc("withdraw_telematics", { p_enrolment_id: e.id, p_reason: `${RUN} reset` });
  });

  test("enrolment needs consent first, a motor policy, and the policyholder", async (t) => {
    if (!ids.motorPolicy) return t.skip("the demo customer needs an active motor policy arranged through Covva");
    const db = asUser(sessions.customer);
    expectRule(await db.rpc("enrol_telematics", { p_policy_id: ids.motorPolicy, p_device_id: `${TAG}-device-1`, p_device_label: RUN }), /consent is required/i);
    expectOk(await db.insert("consents", { user_id: sessions.customer.userId, type: "telematics", version: "telematics-2026-10", granted: true, context: `${RUN} web` }));
    if (ids.nonMotorPolicy) expectRule(await db.rpc("enrol_telematics", { p_policy_id: ids.nonMotorPolicy, p_device_id: `${TAG}-device-1` }), /motor policies only/i);
    expectRule(await asUser(sessions.other).rpc("enrol_telematics", { p_policy_id: ids.motorPolicy, p_device_id: `${TAG}-device-evil` }), /policyholder/i);
    const r = await db.rpc("enrol_telematics", { p_policy_id: ids.motorPolicy, p_device_id: `${TAG}-device-1`, p_device_label: RUN });
    expectOk(r);
    ids.enrolment = r.body.id;
    assert.equal(r.body.status, "active");
    assert.ok(r.body.consent_id, "the consent row is linked");
    expectRule(await db.rpc("enrol_telematics", { p_policy_id: ids.motorPolicy, p_device_id: `${TAG}-device-2` }), /already enrolled/i);
    expectRefused(await db.insert("telematics_trips", { enrolment_id: ids.enrolment, policy_id: ids.motorPolicy, user_id: sessions.customer.userId, trip_id: `${TAG}-trip-direct`, started_at: new Date(Date.now() - 7200e3).toISOString(), ended_at: new Date(Date.now() - 3600e3).toISOString(), distance_km: 10, max_speed_band: "50_80" }));
  });

  test("only the customer (and staff) read the enrolment; insurers, brokers and outsiders cannot", async (t) => {
    if (!ids.enrolment) return t.skip("no enrolment");
    const sel = `telematics_enrolments?select=id&id=eq.${ids.enrolment}`;
    assert.equal((await asUser(sessions.customer).get(sel)).body.length, 1);
    assert.equal((await asUser(sessions.underwriter).get(sel)).body.length, 0, "insurer never reads enrolments");
    assert.equal((await asUser(sessions.broker).get(sel)).body.length, 0);
    assert.equal((await asUser(sessions.other).get(sel)).body.length, 0);
    assert.equal((await asUser(sessions.admin).get(sel)).body.length, 1);
  });

  describe("ingestion and scoring (service role)", { skip: !hasServiceKey() && "needs SUPABASE_SECRET_KEY" }, () => {
    test("trips are idempotent by trip id; the insurer sees scores but never trips; the broker sees neither", async (t) => {
      if (!ids.enrolment) return t.skip("no enrolment");
      const svc = service();
      const trip = { enrolment_id: ids.enrolment, policy_id: ids.motorPolicy, user_id: sessions.customer.userId, trip_id: `${RUN}-trip-1`, started_at: new Date(Date.now() - 7200e3).toISOString(), ended_at: new Date(Date.now() - 3600e3).toISOString(), distance_km: 18.5, max_speed_band: "80_100", harsh_brake_count: 1, harsh_accel_count: 0, night_share: 0.2, phone_use: false };
      expectOk(await svc.insert("telematics_trips", trip));
      expectRefused(await svc.insert("telematics_trips", trip)); // unique (enrolment, trip_id): the API uses an ignore-duplicates upsert
      expectRefused(await svc.insert("telematics_trips", { ...trip, trip_id: `${RUN}-trip-bad`, max_speed_band: "warp" }));
      const period = new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth() - 1, 1)).toISOString().slice(0, 10);
      const score = { enrolment_id: ids.enrolment, policy_id: ids.motorPolicy, user_id: sessions.customer.userId, period, score: 81, factors: { speed: { score: 80, detail: "test" } }, trips: 6, distance_km: 120, final: true };
      expectOk(await svc.insert("telematics_scores", score));
      const again = await svc.insert("telematics_scores?on_conflict=enrolment_id,period", { ...score, score: 83 });
      assert.ok(again.status < 300 || again.code === "23505", "scoring re-run is an upsert on (enrolment, period)");
      const scores = `telematics_scores?select=id,score&enrolment_id=eq.${ids.enrolment}`;
      const trips = `telematics_trips?select=id&enrolment_id=eq.${ids.enrolment}`;
      assert.equal((await asUser(sessions.customer).get(scores)).body.length, 1, "customer sees own score");
      assert.equal((await asUser(sessions.customer).get(trips)).body.length, 1, "customer sees own trips");
      assert.equal((await asUser(sessions.underwriter).get(scores)).body.length, 1, "insurer of the policy sees the score");
      assert.equal((await asUser(sessions.underwriter).get(trips)).body.length, 0, "insurer never sees trips");
      assert.equal((await asUser(sessions.broker).get(scores)).body.length, 0, "broker sees no scores");
      assert.equal((await asUser(sessions.broker).get(trips)).body.length, 0, "broker sees no trips");
      assert.equal((await asUser(sessions.other).get(scores)).body.length, 0);
      assert.equal((await asUser(sessions.admin).get(trips)).body.length, 1, "staff see all");
    });

    test("withdrawal stops ingestion, records the consent withdrawal and keeps the scores", async (t) => {
      if (!ids.enrolment) return t.skip("no enrolment");
      const db = asUser(sessions.customer);
      expectRefused(await asUser(sessions.other).rpc("withdraw_telematics", { p_enrolment_id: ids.enrolment }));
      const w = await db.rpc("withdraw_telematics", { p_enrolment_id: ids.enrolment, p_reason: `${RUN} withdraw` });
      expectOk(w);
      assert.equal(w.body.status, "withdrawn");
      assert.equal(w.body.device_id, null, "device cleared on withdrawal");
      const consent = await db.get(`consents?select=granted&type=eq.telematics&order=created_at.desc&limit=1`);
      assert.equal(consent.body[0]?.granted, false);
      const svc = service();
      expectRule(await svc.insert("telematics_trips", { enrolment_id: ids.enrolment, policy_id: ids.motorPolicy, user_id: sessions.customer.userId, trip_id: `${RUN}-trip-after`, started_at: new Date(Date.now() - 3600e3).toISOString(), ended_at: new Date().toISOString(), distance_km: 5, max_speed_band: "50_80" }), /withdrawn/i);
      expectRule(await svc.update(`telematics_enrolments?id=eq.${ids.enrolment}`, { status: "active" }), /cannot be reactivated/i);
      assert.equal((await db.get(`telematics_scores?select=id&enrolment_id=eq.${ids.enrolment}`)).body.length, 1, "scores stay with the policy");
      expectRule(await db.rpc("enrol_telematics", { p_policy_id: ids.motorPolicy, p_device_id: `${TAG}-device-3` }), /consent is required/i);
      ids.enrolment = null; // withdrawn already; nothing for the after() hook to do
    });

    test("the retention job counts withdrawn-enrolment trips (dry run) and refuses a too-recent cutoff", async () => {
      const svc = service();
      const dry = await svc.rpc("run_privacy_retention", { p_plan: [{ class: "telematics_trips", cutoff: new Date(Date.now() - 400 * 86_400e3).toISOString() }], p_dry_run: true, p_triggered_by: "manual" });
      expectOk(dry);
      assert.equal(dry.body.dry_run, true);
      assert.ok("telematics_trips" in dry.body.results, "the class is known to the retention job");
      const tooRecent = await svc.rpc("run_privacy_retention", { p_plan: [{ class: "telematics_trips", cutoff: new Date(Date.now() - 2 * 86_400e3).toISOString() }], p_dry_run: true, p_triggered_by: "manual" });
      expectOk(tooRecent);
      assert.match(tooRecent.body.results.telematics_trips.error ?? "", /too recent/);
    });
  });
});
