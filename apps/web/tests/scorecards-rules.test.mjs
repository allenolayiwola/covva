// Broker scorecards, reviews and the analytics layer (supabase/migrations/20261031100400_scorecards_analytics.sql):
// review guard (one rating per completed request / settled claim, by its customer), moderation (staff only, reason
// when hiding), one broker reply, anonymised public summaries, scorecard visibility (own org, appointed insurers,
// staff), analytics functions (staff-only facts and rollup; insurer insight report with small-cell suppression) —
// exercised through Supabase Auth + PostgREST as each role (same style as analytics-rules.test.mjs).
// Run:  node --test apps/web/tests/scorecards-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Rows created here are tagged `E2E-SCORE…`. Ratings need a completed request with a broker of record, which no user
// role can fabricate, so the rating / moderation / reply round trip runs only when SUPABASE_SECRET_KEY is set: the
// service key creates (and finally deletes) a completed request for the demo customer with the demo broker.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp, uuid } from "./_lib/supabase.mjs";

const TAG = "E2E-SCORE";
const RUN = `${TAG} ${stamp()}`;

function expectRule(r, pattern) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected trigger error P0001, got ${r.code}: ${r.message}`);
  if (pattern) assert.match(r.message ?? "", pattern);
}

/** RLS (42501), a guard trigger (P0001) or a missing row (23503) — the write was refused either way. */
function expectRefused(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["42501", "P0001", "23503", "23505"].includes(r.code) || r.status === 401 || r.status === 403, `expected RLS/guard rejection, got ${r.status} ${r.code}: ${r.message}`);
}

function expectForbidden(r) {
  assert.ok(r.status >= 400, `expected a permission error, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(r.code === "42501" || r.status === 401 || r.status === 403, `expected 42501/401/403, got ${r.status} ${r.code}: ${r.message}`);
}

function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
const thisMonth = () => today().slice(0, 7);

const sessions = {};
const ids = {};

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.adviser = await signIn(ACCOUNTS.adviser);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  sessions.admin = await signIn(ACCOUNTS.admin);
  const orgs = (await anon().get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  ids.otherBroker = orgs.find((o) => o.type === "broker" && o.id !== ids.broker)?.id ?? null;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  ids.motor = (await anon().get("product_categories?select=id,slug&slug=eq.motor")).body[0]?.id;
  assert.ok(ids.broker && ids.insurer && ids.motor, "seed data (demo broker, insurer, motor category) must exist");
});

after(async () => {
  if (!hasServiceKey()) return;
  const svc = service();
  if (ids.review) await svc.delete(`broker_reviews?id=eq.${ids.review}`);
  if (ids.request) await svc.delete(`requests?id=eq.${ids.request}`);
});

// ---------------------------------------------------------------------------
describe("anonymous visitors", () => {
  test("cannot read the review or scorecard tables, but can read the anonymised public summary", async () => {
    const pub = anon();
    for (const table of ["broker_reviews", "broker_scorecards"]) {
      const r = await pub.get(`${table}?select=id&limit=1`);
      assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${table}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    const summary = await pub.rpc("broker_score_summary", { p_broker_org_ids: [ids.broker, uuid()] });
    expectOk(summary);
    assert.equal(summary.body.length, 1, "unknown ids are dropped; only active brokers are summarised");
    const row = summary.body[0];
    assert.equal(row.broker_org_id, ids.broker);
    assert.equal(typeof row.review_count, "number");
    assert.ok(row.rating_avg === null || row.review_count >= 3, "an average is only published from 3 approved reviews");
    assert.ok(["new", "needs_attention", "fair", "good", "excellent"].includes(row.score_band));
    expectForbidden(await pub.rpc("broker_public_reviews", { p_broker_org_id: ids.broker, p_limit: 5 }));
  });

  test("server review reader preserves the public projection", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, async () => {
    const reviews = await service().rpc("broker_public_reviews", { p_broker_org_id: ids.broker, p_limit: 5 });
    expectOk(reviews);
    for (const rv of reviews.body) {
      assert.ok(rv.rating >= 1 && rv.rating <= 5);
      assert.ok(!("customer_id" in rv), "no customer id leaves the database");
      assert.ok(rv.display_name === "Verified customer" || /^\S+ [A-Z]\.$/.test(rv.display_name), `masked reviewer, got "${rv.display_name}"`);
    }
  });

  test("cannot call the analytics or scorecard-input functions", async () => {
    const pub = anon();
    expectForbidden(await pub.rpc("analytics_rollup", { p_from: today(), p_to: today(), p_dry_run: true }));
    expectForbidden(await pub.rpc("analytics_facts", { p_from: plusDays(-7), p_to: today() }));
    expectForbidden(await pub.rpc("insurer_insight_report", { p_insurer_org_id: ids.insurer, p_month: thisMonth() }));
    expectForbidden(await pub.rpc("broker_scorecard_inputs", { p_broker_org_id: ids.broker, p_days: 90 }));
  });
});

// ---------------------------------------------------------------------------
describe("customer", () => {
  test("cannot rate a request that is not theirs or not completed, nor forge a review row", async () => {
    const db = asUser(sessions.customer);
    expectRefused(await db.insert("broker_reviews", { broker_org_id: ids.broker, customer_id: sessions.customer.userId, subject_type: "request", subject_id: uuid(), rating: 5, comment: `${RUN} forged` }));
    // A draft of their own is not completed.
    const draft = await db.insert("requests", { customer_id: sessions.customer.userId, category_id: ids.motor, status: "draft", title: `${RUN} draft`, risk_data: {} });
    if (draft.status < 300) {
      const r = await db.insert("broker_reviews", { broker_org_id: ids.broker, customer_id: sessions.customer.userId, subject_type: "request", subject_id: draft.body[0].id, rating: 4 });
      expectRule(r, /completed|broker of record/);
      await db.update(`requests?id=eq.${draft.body[0].id}`, { status: "cancelled", cancelled_reason: `${RUN} cleanup` });
    }
    // Rating outside 1–5 never reaches the guard.
    expectRefused(await db.insert("broker_reviews", { broker_org_id: ids.broker, customer_id: sessions.customer.userId, subject_type: "claim", subject_id: uuid(), rating: 9 }));
  });

  test("sees no scorecards and cannot use staff analytics", async () => {
    const db = asUser(sessions.customer);
    const cards = await db.get("broker_scorecards?select=id&limit=5");
    expectOk(cards);
    assert.deepEqual(cards.body, []);
    expectForbidden(await db.rpc("analytics_facts", { p_from: plusDays(-7), p_to: today() }));
    expectForbidden(await db.rpc("analytics_rollup", { p_from: today(), p_to: today(), p_dry_run: true }));
    expectForbidden(await db.rpc("broker_scorecard_inputs", { p_broker_org_id: ids.broker, p_days: 90 }));
    expectForbidden(await db.rpc("insurer_insight_report", { p_insurer_org_id: ids.insurer, p_month: thisMonth() }));
  });
});

// ---------------------------------------------------------------------------
describe("broker", () => {
  test("reads its own scorecard inputs and snapshots only; the window is validated", async () => {
    const db = asUser(sessions.broker);
    const inputs = await db.rpc("broker_scorecard_inputs", { p_broker_org_id: ids.broker, p_days: 90 });
    expectOk(inputs);
    for (const k of ["requests_received", "first_response_samples", "quote_fulfilment_samples", "sla_measured", "sla_breached", "rating_count"]) assert.equal(typeof inputs.body[k], "number", `${k} is a number`);
    assert.ok(inputs.body.sla_breached <= inputs.body.sla_measured);
    const bad = await db.rpc("broker_scorecard_inputs", { p_broker_org_id: ids.broker, p_days: 7 });
    expectRule(bad, /30 or 90/);
    if (ids.otherBroker) expectForbidden(await db.rpc("broker_scorecard_inputs", { p_broker_org_id: ids.otherBroker, p_days: 90 }));
    expectForbidden(await db.rpc("broker_scorecard_inputs", { p_broker_org_id: ids.insurer, p_days: 90 }).then((r) => (r.code === "P0001" ? { ...r, code: "42501" } : r)));
    const cards = await db.get("broker_scorecards?select=broker_org_id,window_days,score,score_band");
    expectOk(cards);
    for (const c of cards.body) assert.equal(c.broker_org_id, ids.broker, "brokers see their own snapshots only");
  });

  test("sees approved reviews only and cannot moderate or write snapshots", async () => {
    const db = asUser(sessions.broker);
    const reviews = await db.get("broker_reviews?select=id,status,broker_org_id&limit=50");
    expectOk(reviews);
    for (const r of reviews.body) {
      assert.equal(r.status, "approved");
      assert.equal(r.broker_org_id, ids.broker);
    }
    expectRefused(await db.insert("broker_scorecards", { broker_org_id: ids.broker, window_days: 90, score: 100, score_band: "excellent" }));
    expectForbidden(await db.rpc("analytics_facts", { p_from: plusDays(-7), p_to: today() }));
    expectForbidden(await db.rpc("insurer_insight_report", { p_insurer_org_id: ids.insurer, p_month: thisMonth() }));
  });
});

// ---------------------------------------------------------------------------
describe("insurer", () => {
  test("sees scorecards of appointed brokers only, no reviews, and an anonymised suppressed insight report", async () => {
    const db = asUser(sessions.underwriter);
    const appts = (await db.get(`insurer_broker_appointments?select=broker_org_id&insurer_org_id=eq.${ids.insurer}&active=eq.true`)).body.map((a) => a.broker_org_id);
    const cards = await db.get("broker_scorecards?select=broker_org_id,window_days,score");
    expectOk(cards);
    for (const c of cards.body) assert.ok(appts.includes(c.broker_org_id), "only appointed brokers' scorecards are visible to an insurer");
    const reviews = await db.get("broker_reviews?select=id&limit=5");
    expectOk(reviews);
    assert.deepEqual(reviews.body, [], "insurers never see review rows");

    const report = await db.rpc("insurer_insight_report", { p_insurer_org_id: ids.insurer, p_month: thisMonth() });
    expectOk(report);
    assert.equal(report.body.month, thisMonth());
    assert.equal(report.body.suppression_threshold, 5);
    assert.ok(Array.isArray(report.body.categories));
    const text = JSON.stringify(report.body);
    assert.ok(!/broker_org_id|customer_id|full_name|email|phone/.test(text), "no identities in the report");
    for (const c of report.body.categories) {
      for (const [group, keys] of [["quotes", ["mine", "market"]], ["wins", ["mine", "market"]], ["renewals", ["due", "renewed"]], ["claims", ["opened", "settled", "market_opened"]]]) {
        for (const k of keys) {
          const v = c[group][k];
          assert.ok(v === null || v === 0 || v >= 5, `${c.category_name}.${group}.${k}: counts of 1–4 are suppressed, got ${v}`);
        }
      }
      assert.ok(c.price.position === null || ["below", "in_line", "above"].includes(c.price.position));
    }
    const malformed = await db.rpc("insurer_insight_report", { p_insurer_org_id: ids.insurer, p_month: "October" });
    assert.ok(malformed.status >= 400 && ["P0001", "42501"].includes(malformed.code));
    expectForbidden(await db.rpc("insurer_insight_report", { p_insurer_org_id: ids.broker, p_month: thisMonth() }).then((r) => (r.code === "P0001" ? { ...r, code: "42501" } : r)));
    expectForbidden(await db.rpc("analytics_facts", { p_from: plusDays(-7), p_to: today() }));
    expectForbidden(await db.rpc("analytics_rollup", { p_from: today(), p_to: today(), p_dry_run: true }));
  });
});

// ---------------------------------------------------------------------------
describe("staff", () => {
  test("reads every review and scorecard and analytics facts; cannot run the service-only rollup", async () => {
    const db = asUser(sessions.admin);
    expectOk(await db.get("broker_reviews?select=id,status&limit=5"));
    expectOk(await db.get("broker_scorecards?select=id&limit=5"));
    const facts = await db.rpc("analytics_facts", { p_from: plusDays(-30), p_to: today(), p_group: "category" });
    expectOk(facts);
    for (const row of facts.body) {
      for (const k of ["requests", "quotes", "conversions", "policies_issued", "claims_opened", "payments_succeeded"]) assert.ok(Number(row[k]) >= 0, `${k} is a count`);
    }
    const badGroup = await db.rpc("analytics_facts", { p_from: plusDays(-7), p_to: today(), p_group: "customer" });
    expectRule(badGroup, /Group by/);
    expectForbidden(await db.rpc("analytics_rollup", { p_from: today(), p_to: today(), p_dry_run: true }));
  });

  test("service dry-run rollup writes nothing and validates date ranges", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, async () => {
    const db = asUser(sessions.admin);
    const before = await db.rpc("analytics_facts", { p_from: plusDays(-2), p_to: today(), p_group: "total" });
    expectOk(before);
    const dry = await service().rpc("analytics_rollup", { p_from: plusDays(-2), p_to: today(), p_dry_run: true });
    expectOk(dry);
    assert.equal(dry.body.dry_run, true);
    assert.equal(dry.body.days, 3);
    assert.equal(typeof dry.body.rows, "number");
    const afterDry = await db.rpc("analytics_facts", { p_from: plusDays(-2), p_to: today(), p_group: "total" });
    expectOk(afterDry);
    assert.deepEqual(afterDry.body, before.body, "a dry run changes nothing");
    const reversed = await service().rpc("analytics_rollup", { p_from: today(), p_to: plusDays(-1), p_dry_run: true });
    expectRule(reversed, /end of the range/);
  });
});

// ---------------------------------------------------------------------------
describe("rating, moderation and reply round trip (service key)", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
  test("customer rates once per completed request; staff moderates with a reason; broker replies once; public view is masked", async () => {
    const svc = service();
    const created = await svc.insert("requests", {
      customer_id: sessions.customer.userId,
      category_id: ids.motor,
      status: "completed",
      broker_org_id: ids.broker,
      title: `${RUN} completed request for rating`,
      risk_data: { region: "Greater Accra" },
      submitted_at: new Date(Date.now() - 3 * 86_400_000).toISOString(),
      completed_at: new Date().toISOString(),
    });
    expectOk(created);
    ids.request = created.body[0].id;

    // Customer rates (forged broker/customer ids are overridden by the guard; status forced to pending).
    const c = asUser(sessions.customer);
    const rated = await c.insert("broker_reviews", { broker_org_id: ids.otherBroker ?? ids.broker, customer_id: sessions.customer.userId, subject_type: "request", subject_id: ids.request, rating: 5, comment: `${RUN} fast and clear` });
    expectOk(rated);
    ids.review = rated.body[0].id;
    assert.equal(rated.body[0].status, "pending");
    assert.equal(rated.body[0].broker_org_id, ids.broker, "the broker comes from the request, not the payload");
    const again = await c.insert("broker_reviews", { broker_org_id: ids.broker, customer_id: sessions.customer.userId, subject_type: "request", subject_id: ids.request, rating: 1 });
    expectRefused(again);
    assert.equal(again.code, "23505", "one rating per request");
    // Customer cannot approve their own review, nor edit the rating.
    const self = await c.update(`broker_reviews?id=eq.${ids.review}`, { status: "approved" });
    assert.ok(self.status >= 400 || self.body.length === 0, "customers cannot moderate");
    // Another customer cannot see it; the broker cannot see it while pending; anon cannot see it.
    const asBroker = await asUser(sessions.broker).get(`broker_reviews?id=eq.${ids.review}&select=id`);
    expectOk(asBroker);
    assert.deepEqual(asBroker.body, [], "pending reviews are invisible to the broker");
    const pub = await service().rpc("broker_public_reviews", { p_broker_org_id: ids.broker, p_limit: 50 });
    expectOk(pub);
    assert.ok(!pub.body.some((r) => r.id === ids.review), "pending reviews are not public");

    // Staff: hide without a reason is refused; approve works.
    const staff = asUser(sessions.admin);
    const noReason = await staff.update(`broker_reviews?id=eq.${ids.review}`, { status: "hidden" });
    expectRule(noReason, /reason/);
    const approved = await staff.update(`broker_reviews?id=eq.${ids.review}`, { status: "approved" });
    expectOk(approved);
    assert.equal(approved.body[0].status, "approved");
    assert.ok(approved.body[0].moderated_at, "moderation is stamped");
    const edit = await staff.update(`broker_reviews?id=eq.${ids.review}`, { rating: 2 });
    expectRule(edit, /cannot be edited/);

    // Public: masked reviewer, no customer id.
    const pubAfter = await service().rpc("broker_public_reviews", { p_broker_org_id: ids.broker, p_limit: 50 });
    expectOk(pubAfter);
    const shown = pubAfter.body.find((r) => r.id === ids.review);
    assert.ok(shown, "approved reviews are public");
    assert.ok(shown.display_name === "Verified customer" || /^\S+ [A-Z]\.$/.test(shown.display_name), `masked, got "${shown.display_name}"`);
    assert.ok(!("customer_id" in shown));

    // Broker replies once (adviser role), then cannot reply again or change the status.
    const adviser = asUser(sessions.adviser);
    const reply = await adviser.update(`broker_reviews?id=eq.${ids.review}`, { reply: `${RUN} thank you` });
    expectOk(reply);
    assert.equal(reply.body[0].replied_by, sessions.adviser.userId);
    const replyAgain = await adviser.update(`broker_reviews?id=eq.${ids.review}`, { reply: "another" });
    expectRule(replyAgain, /once/);
    const hideByBroker = await adviser.update(`broker_reviews?id=eq.${ids.review}`, { status: "hidden", moderation_reason: "x" });
    assert.ok(hideByBroker.status >= 400 || hideByBroker.body.length === 0, "brokers cannot moderate");

    // Staff hides with a reason: it leaves the public view and the broker's view.
    const hidden = await staff.update(`broker_reviews?id=eq.${ids.review}`, { status: "hidden", moderation_reason: `${RUN} test cleanup` });
    expectOk(hidden);
    const pubHidden = await service().rpc("broker_public_reviews", { p_broker_org_id: ids.broker, p_limit: 50 });
    assert.ok(!pubHidden.body.some((r) => r.id === ids.review));
    const brokerHidden = await adviser.get(`broker_reviews?id=eq.${ids.review}&select=id`);
    assert.deepEqual(brokerHidden.body, []);
    // The customer still sees their own review and its state.
    const mine = await c.get(`broker_reviews?id=eq.${ids.review}&select=id,status,reply`);
    expectOk(mine);
    assert.equal(mine.body[0]?.status, "hidden");
  });

  test("the rollup is idempotent and the service role may run it", async () => {
    const svc = service();
    const first = await svc.rpc("analytics_rollup", { p_from: plusDays(-1), p_to: today(), p_dry_run: false });
    expectOk(first);
    const second = await svc.rpc("analytics_rollup", { p_from: plusDays(-1), p_to: today(), p_dry_run: false });
    expectOk(second);
    assert.equal(second.body.rows, first.body.rows, "replaying the same days writes the same number of rows");
    const facts = await svc.rpc("analytics_facts", { p_from: plusDays(-1), p_to: today(), p_group: "day" });
    expectOk(facts);
    assert.ok(facts.body.length <= 2);
  });
});
