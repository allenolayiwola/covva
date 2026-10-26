// Routing-engine database rules (Addendum 2 D/E), exercised through Supabase Auth + PostgREST as each role.
// Run:  node --test apps/web/tests/routing-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Rows created here are tagged `E2E-ROUTING…`. The parts that need rows no user role may create
// (routing decisions and offers are system writes) run only when SUPABASE_SECRET_KEY is set and
// delete their own request (offers/routing cascade) at the end.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp, uuid } from "./_lib/supabase.mjs";

const TAG = "E2E-ROUTING";
const RUN = `${TAG} ${stamp()}`;

function expectRule(r, pattern) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected trigger error P0001, got ${r.code}: ${r.message}`);
  assert.match(r.message ?? "", pattern);
}

/** RLS (42501) or a guard trigger (P0001) — either way the write was refused. */
function expectRefused(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["42501", "P0001", "23503"].includes(r.code), `expected RLS/guard rejection, got ${r.code}: ${r.message}`);
}

function expectOk(r, status = 200) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
  if (status === 201) assert.equal(r.status, 201);
}

const sessions = {};
const ids = {};

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  const pub = anon();
  const orgs = (await pub.get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  ids.otherBroker = orgs.find((o) => o.type === "broker" && o.id !== ids.broker)?.id ?? null;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  ids.motor = (await pub.get("product_categories?select=id,slug&slug=eq.motor")).body[0]?.id;
  assert.ok(ids.broker && ids.insurer && ids.motor, "seed data (demo broker, insurer, motor category) must exist");
});

// ---------------------------------------------------------------------------
describe("anonymous visitors", () => {
  test("cannot read routing decisions, offers, line integrations or broker assignments", async () => {
    const pub = anon();
    for (const table of ["order_routing", "order_offers", "insurer_line_integrations", "customer_broker_assignments"]) {
      const r = await pub.get(`${table}?select=id&limit=1`);
      assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${table}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    const settings = await pub.get("platform_settings?select=key,value&key=like.routing.*");
    expectOk(settings);
    assert.ok(settings.body.some((s) => s.key === "routing.offer_timeout_minutes"), "routing defaults are seeded");
  });
});

// ---------------------------------------------------------------------------
describe("customer", () => {
  test("sees no offers and cannot write routing tables", async () => {
    const db = asUser(sessions.customer);
    const offers = await db.get("order_offers?select=id&limit=5");
    expectOk(offers);
    assert.deepEqual(offers.body, [], "customers never see broker offers");
    const routing = await db.get("order_routing?select=id&limit=5");
    expectOk(routing);
    assert.deepEqual(routing.body, [], "routing rows are read through request_routing_mode() only");
    expectRefused(await db.insert("order_offers", { request_id: uuid(), broker_org_id: ids.broker, responds_by: new Date().toISOString() }));
    expectRefused(await db.insert("order_routing", { request_id: uuid(), mode: "broker_pool" }));
    expectRefused(await db.insert("customer_broker_assignments", { customer_id: sessions.customer.userId, broker_org_id: ids.broker, source: "customer_choice", note: `${RUN} forged` }));
    expectRefused(await db.insert("insurer_line_integrations", { insurer_org_id: ids.insurer, category_id: ids.motor, level: "L3" }));
  });

  test("can read the routing mode of a request (null for unknown ids) and set talk_to_expert on their own draft", async () => {
    const db = asUser(sessions.customer);
    const mode = await db.rpc("request_routing_mode", { p_request: uuid() });
    expectOk(mode);
    assert.equal(mode.body, null);

    const created = await db.insert("requests", { customer_id: sessions.customer.userId, category_id: ids.motor, status: "draft", title: `${RUN} expert`, risk_data: {} });
    expectOk(created, 201);
    const id = created.body[0].id;
    try {
      assert.equal(created.body[0].talk_to_expert, false);
      const flagged = await db.update(`requests?id=eq.${id}`, { talk_to_expert: true });
      expectOk(flagged);
      assert.equal(flagged.body[0].talk_to_expert, true);
      expectRule(await db.update(`requests?id=eq.${id}`, { routing_mode: "broker_fixed" }), /only change the details of your own request/);
    } finally {
      expectOk(await db.update(`requests?id=eq.${id}`, { status: "cancelled", cancelled_reason: `${RUN} cleanup` }));
    }
  });

  test("cannot accept or decline offers", async () => {
    const db = asUser(sessions.customer);
    expectRule(await db.rpc("accept_order_offer", { p_offer_id: uuid() }), /not valid/);
    expectRule(await db.rpc("accept_order_offer", { p_token: "0123456789abcdef0123456789abcdef" }), /redeemed by the platform/);
    expectRule(await db.rpc("decline_order_offer", { p_offer_id: uuid() }), /not valid/);
  });
});

// ---------------------------------------------------------------------------
describe("broker", () => {
  test("cannot write offers or routing directly; unknown offers cannot be accepted", async () => {
    const db = asUser(sessions.broker);
    expectRefused(await db.insert("order_offers", { request_id: uuid(), broker_org_id: ids.broker, responds_by: new Date().toISOString() }));
    expectRefused(await db.insert("order_routing", { request_id: uuid(), mode: "broker_fixed", broker_org_id: ids.broker }));
    const foreign = await db.update(`order_offers?id=eq.${uuid()}`, { status: "accepted" });
    assert.ok(foreign.status < 300 ? foreign.body.length === 0 : foreign.status >= 400);
    expectRule(await db.rpc("accept_order_offer", { p_offer_id: uuid() }), /not valid/);
    expectRule(await db.rpc("accept_order_offer", {}), /offer id or accept token is required/);
    // Tokens are redeemed by the server (service role) after it has verified the signed-in member.
    expectRule(await db.rpc("accept_order_offer", { p_token: "0123456789abcdef0123456789abcdef" }), /redeemed by the platform/);
  });

  test("sees only its own organisation's offers and the line integrations of insurers that appointed it", async () => {
    const db = asUser(sessions.broker);
    const offers = await db.get("order_offers?select=id,broker_org_id&limit=50");
    expectOk(offers);
    assert.ok(offers.body.every((o) => o.broker_org_id === ids.broker));
    const lines = await db.get("insurer_line_integrations?select=id,insurer_org_id&limit=50");
    expectOk(lines);
    const appointed = new Set((await db.get(`insurer_broker_appointments?select=insurer_org_id&broker_org_id=eq.${ids.broker}&active=eq.true`)).body.map((a) => a.insurer_org_id));
    assert.ok(lines.body.every((l) => appointed.has(l.insurer_org_id)), "a broker only sees integrations of insurers that appointed it (or nominated it)");
    expectRefused(await db.insert("insurer_line_integrations", { insurer_org_id: ids.insurer, category_id: ids.motor, level: "L2" }));
  });

  test("a supervisor can record an imported client (standing assignment) and end it; one active per customer", async () => {
    const db = asUser(sessions.broker);
    const existing = await db.get(`customer_broker_assignments?select=id,broker_org_id&customer_id=eq.${sessions.customer.userId}&active=eq.true`);
    expectOk(existing);
    const created = await db.insert("customer_broker_assignments", { customer_id: sessions.customer.userId, broker_org_id: ids.broker, source: "broker_import", note: `${RUN} import` });
    if (existing.body.length) {
      assert.equal(created.code, "23505", `a second active assignment must be refused: ${created.status} ${created.message}`);
      return;
    }
    expectOk(created, 201);
    const id = created.body[0].id;
    try {
      const dup = await db.insert("customer_broker_assignments", { customer_id: sessions.customer.userId, broker_org_id: ids.broker, source: "broker_import", note: `${RUN} dup` });
      assert.equal(dup.code, "23505", "unique active assignment per customer");
      // The customer can see who their standing broker is.
      const mine = await asUser(sessions.customer).get(`customer_broker_assignments?select=broker_org_id&active=eq.true&customer_id=eq.${sessions.customer.userId}`);
      expectOk(mine);
      assert.deepEqual(mine.body, [{ broker_org_id: ids.broker }]);
      // Only broker_import may be recorded by a broker; platform assignments are staff-only.
      expectRefused(await db.insert("customer_broker_assignments", { customer_id: sessions.broker.userId, broker_org_id: ids.broker, source: "platform", note: `${RUN} wrong source` }));
    } finally {
      const ended = await db.update(`customer_broker_assignments?id=eq.${id}`, { active: false, ended_at: new Date().toISOString() });
      expectOk(ended);
      assert.equal(ended.body[0].active, false);
    }
  });
});

// ---------------------------------------------------------------------------
describe("insurer", () => {
  test("reads its own line integrations only and cannot create one or change its level", async () => {
    const db = asUser(sessions.underwriter);
    const lines = await db.get("insurer_line_integrations?select=id,insurer_org_id,level,direct_sales&limit=50");
    expectOk(lines);
    assert.ok(lines.body.every((l) => l.insurer_org_id === ids.insurer));
    expectRefused(await db.insert("insurer_line_integrations", { insurer_org_id: ids.insurer, category_id: ids.motor, level: "L3" }));
    const mine = lines.body[0];
    if (mine) {
      // Underwriters are not owners/admins: RLS hides the update (0 rows) or the guard refuses.
      const r = await db.update(`insurer_line_integrations?id=eq.${mine.id}`, { level: mine.level === "L1" ? "L2" : "L1" });
      assert.ok(r.status >= 400 || r.body.length === 0, `level change must be refused: ${r.status} ${JSON.stringify(r.body)}`);
    }
    expectOk(await db.get("order_offers?select=id&limit=1"));
  });
});

// ---------------------------------------------------------------------------
describe("offers lifecycle (needs SUPABASE_SECRET_KEY)", { skip: hasServiceKey() ? false : "skipped: no SUPABASE_SECRET_KEY" }, () => {
  const j = {};
  let svc;

  before(() => {
    svc = service();
  });

  after(async () => {
    // Offers and routing cascade from the request; both rows were created by this test only.
    for (const id of [j.request, j.request2].filter(Boolean)) await svc.delete(`requests?id=eq.${id}`);
  });

  test("a pool request: the offered broker sees the request and its offer, the customer sees only the mode", async () => {
    const req = await svc.insert("requests", {
      customer_id: sessions.customer.userId,
      category_id: ids.motor,
      status: "submitted",
      source: "web",
      title: `${RUN} pool`,
      risk_data: { vehicle_make: "E2E", vehicle_value: 50000 },
      risk_fingerprint: `${RUN}-${uuid()}`,
    });
    expectOk(req, 201);
    j.request = req.body[0].id;
    assert.equal(req.body[0].broker_org_id, null);

    const routing = await svc.insert("order_routing", { request_id: j.request, mode: "broker_pool", rule: "broker_pool", reason: `${RUN} pool`, candidates: [{ brokerOrgId: ids.broker, brokerName: "Demo", eligible: true, why: "Primary broker", rank: 1 }], current_round: 1 });
    expectOk(routing, 201);
    expectOk(await svc.update(`requests?id=eq.${j.request}`, { routing_mode: "broker_pool" }));
    const dup = await svc.insert("order_routing", { request_id: j.request, mode: "ops_hold" });
    assert.equal(dup.code, "23505", "one routing decision per request");

    const respondsBy = new Date(Date.now() + 30 * 60_000).toISOString();
    const rows = [{ request_id: j.request, broker_org_id: ids.broker, status: "offered", round: 1, responds_by: respondsBy }];
    if (ids.otherBroker) rows.push({ request_id: j.request, broker_org_id: ids.otherBroker, status: "offered", round: 1, responds_by: respondsBy });
    const offers = await svc.insert("order_offers", rows);
    expectOk(offers, 201);
    j.offer = offers.body.find((o) => o.broker_org_id === ids.broker).id;
    j.otherOffer = offers.body.find((o) => o.broker_org_id === ids.otherBroker)?.id ?? null;
    assert.match(offers.body[0].accept_token, /^[a-f0-9]{48}$/, "accept token is 24 random bytes (hex)");
    const dupOffer = await svc.insert("order_offers", { request_id: j.request, broker_org_id: ids.broker, status: "offered", round: 1, responds_by: respondsBy });
    assert.equal(dupOffer.code, "23505", "one open offer per broker per request");

    const broker = asUser(sessions.broker);
    const seen = await broker.get(`order_offers?select=id,status,accept_token&request_id=eq.${j.request}`);
    expectOk(seen);
    assert.deepEqual(seen.body.map((o) => o.id), [j.offer], "a broker sees only its own offer");
    const visible = await broker.get(`requests?select=id,reference,risk_data&id=eq.${j.request}`);
    expectOk(visible);
    assert.equal(visible.body.length, 1, "an offered broker can read the request (risk only)");
    const profile = await broker.get(`profiles?select=id&id=eq.${sessions.customer.userId}`);
    expectOk(profile);
    assert.deepEqual(profile.body, [], "the customer's identity stays hidden until the offer is accepted");

    const customer = asUser(sessions.customer);
    const mode = await customer.rpc("request_routing_mode", { p_request: j.request });
    expectOk(mode);
    assert.equal(mode.body, "broker_pool");
    const hidden = await customer.get(`order_offers?select=id&request_id=eq.${j.request}`);
    expectOk(hidden);
    assert.deepEqual(hidden.body, []);
    const hiddenRouting = await customer.get(`order_routing?select=id&request_id=eq.${j.request}`);
    expectOk(hiddenRouting);
    assert.deepEqual(hiddenRouting.body, []);
    expectRule(await broker.update(`order_offers?id=eq.${j.offer}`, { status: "accepted" }), /accepted or declined through accept_order_offer/);
  });

  test("first accept wins: broker of record is set, other offers withdrawn, a second accept is refused", async () => {
    const broker = asUser(sessions.broker);
    const accepted = await broker.rpc("accept_order_offer", { p_offer_id: j.offer });
    expectOk(accepted);
    assert.equal(accepted.body[0].request_id, j.request);
    assert.equal(accepted.body[0].broker_org_id, ids.broker);

    const req = (await svc.get(`requests?select=broker_org_id,routing_mode,next_step&id=eq.${j.request}`)).body[0];
    assert.equal(req.broker_org_id, ids.broker);
    assert.equal(req.routing_mode, "broker_pool");
    const all = (await svc.get(`order_offers?select=id,status&request_id=eq.${j.request}&order=offered_at`)).body;
    assert.equal(all.find((o) => o.id === j.offer).status, "accepted");
    if (j.otherOffer) assert.equal(all.find((o) => o.id === j.otherOffer).status, "withdrawn", "other open offers are withdrawn");
    const events = (await svc.get(`request_events?select=event,visible_to_customer&request_id=eq.${j.request}&event=in.(offer_accepted,broker_assigned)`)).body;
    assert.ok(events.some((e) => e.event === "offer_accepted" && e.visible_to_customer === true), "the customer's timeline shows the acceptance");
    assert.ok(events.some((e) => e.event === "broker_assigned"));

    expectRule(await broker.rpc("accept_order_offer", { p_offer_id: j.offer }), /already been accepted/);
    if (j.otherOffer) expectRule(await svc.rpc("accept_order_offer", { p_offer_id: j.otherOffer }), /no longer open|already taken/);
    // The partial unique index is the last line of defence even for privileged writers.
    if (j.otherOffer) {
      const forced = await svc.update(`order_offers?id=eq.${j.otherOffer}`, { status: "accepted" });
      assert.equal(forced.code, "23505", `only one accepted offer per request: ${forced.status} ${forced.message}`);
    }
    // The customer can now see the broker of record on their request, and the broker sees the customer.
    const mine = await asUser(sessions.customer).get(`requests?select=broker_org_id&id=eq.${j.request}`);
    expectOk(mine);
    assert.equal(mine.body[0].broker_org_id, ids.broker);
    const profile = await broker.get(`profiles?select=id&id=eq.${sessions.customer.userId}`);
    expectOk(profile);
    assert.equal(profile.body.length, 1);
  });

  test("expired offers cannot be accepted and are marked expired; tokens are redeemed by the service role", async () => {
    const req = await svc.insert("requests", { customer_id: sessions.customer.userId, category_id: ids.motor, status: "submitted", source: "web", title: `${RUN} expired`, risk_data: {}, risk_fingerprint: `${RUN}-${uuid()}` });
    expectOk(req, 201);
    j.request2 = req.body[0].id;
    expectOk(await svc.insert("order_routing", { request_id: j.request2, mode: "broker_pool", reason: `${RUN} expired` }), 201);
    const stale = await svc.insert("order_offers", { request_id: j.request2, broker_org_id: ids.broker, status: "offered", round: 1, responds_by: new Date(Date.now() - 60_000).toISOString() });
    expectOk(stale, 201);
    const broker = asUser(sessions.broker);
    expectRule(await broker.rpc("accept_order_offer", { p_offer_id: stale.body[0].id }), /expired/);
    assert.equal((await svc.get(`order_offers?select=status&id=eq.${stale.body[0].id}`)).body[0].status, "expired");

    // Round 2 by token (as the server does after verifying the member), then decline paths.
    const fresh = await svc.insert("order_offers", { request_id: j.request2, broker_org_id: ids.broker, status: "offered", round: 2, responds_by: new Date(Date.now() + 10 * 60_000).toISOString() });
    expectOk(fresh, 201);
    const declined = await broker.rpc("decline_order_offer", { p_offer_id: fresh.body[0].id, p_reason: `${RUN} at capacity` });
    expectOk(declined);
    assert.equal(declined.body[0].open_offers, 0, "the server re-routes when a round has no open offers left");
    expectRule(await broker.rpc("accept_order_offer", { p_offer_id: fresh.body[0].id }), /no longer open \(declined\)/);

    const round3 = await svc.insert("order_offers", { request_id: j.request2, broker_org_id: ids.broker, status: "offered", round: 3, responds_by: new Date(Date.now() + 10 * 60_000).toISOString() });
    expectOk(round3, 201);
    const byToken = await svc.rpc("accept_order_offer", { p_token: round3.body[0].accept_token });
    expectOk(byToken);
    assert.equal(byToken.body[0].broker_org_id, ids.broker);
    assert.equal((await svc.get(`requests?select=broker_org_id&id=eq.${j.request2}`)).body[0].broker_org_id, ids.broker);
  });
});
