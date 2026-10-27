// Endorsements, tax rules and partner reviews (supabase/migrations/20261030100400_endorsements_accounting.sql),
// exercised through Supabase Auth + PostgREST as each role (same style as db-rules.test.mjs).
// Run:  node --test apps/web/tests/endorsements-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Without SUPABASE_SECRET_KEY the suite uses the demo customer's own active, insurer-issued policy (if any) and
// skips the privileged flow (serviced policy with a broker of record, insurer decision, partner job + review).
// Rows are never deleted: open changes the suite creates are withdrawn (status `cancelled`) at the end.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, TAG, anon, asUser, hasServiceKey, service, signIn, stamp } from "./_lib/supabase.mjs";

const RUN = `${TAG} ${stamp()}`;
const today = () => new Date().toISOString().slice(0, 10);

function expectOk(r, status) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
  if (status) assert.equal(r.status, status);
}
function expectRule(r, re) {
  assert.ok(r.status >= 400, `expected a business-rule error, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected P0001, got ${r.code}: ${r.message}`);
  if (re) assert.match(r.message ?? "", re);
}
function expectDenied(r) {
  assert.ok(r.status >= 400, `expected a permission error, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["42501", "P0001"].includes(r.code) || r.status === 401 || r.status === 403, `expected 42501/P0001/401/403, got ${r.status} ${r.code}: ${r.message}`);
}

const sessions = {};
const ids = {};
const open = [];

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  sessions.claims = await signIn(ACCOUNTS.claims);
  const c = asUser(sessions.customer);
  const mine = await c.get(`policies?select=id,insurer_org_id,broker_org_id,status&customer_id=eq.${sessions.customer.userId}&external_source=eq.false&status=eq.active&limit=1`);
  expectOk(mine);
  ids.ownPolicy = mine.body[0] ?? null;
  const ext = await c.get(`policies?select=id&customer_id=eq.${sessions.customer.userId}&external_source=eq.true&status=eq.active&limit=1`);
  ids.externalPolicy = ext.body?.[0]?.id ?? null;
  const orgs = (await anon().get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  ids.motor = (await anon().get("product_categories?select=id&slug=eq.motor")).body[0]?.id;
});

after(async () => {
  const c = asUser(sessions.customer);
  for (const id of open) await c.update(`endorsements?id=eq.${id}&status=in.(draft,submitted,quoted)`, { status: "cancelled", cancelled_reason: `${RUN} cleanup` }).catch(() => {});
});

// ---------------------------------------------------------------------------
describe("endorsements: customer", () => {
  test("customer creates a draft on their own active policy; parties come from the policy", async (t) => {
    if (!ids.ownPolicy) return t.skip("the demo customer has no active insurer-issued policy");
    const c = asUser(sessions.customer);
    const r = await c.insert("endorsements", {
      policy_id: ids.ownPolicy.id,
      customer_id: sessions.customer.userId,
      insurer_org_id: ids.broker, // ignored: the trigger copies the policy's insurer
      kind: "change_address",
      changes: { before: {}, after: { address: `${RUN} 1 Ring Road`, city: "Accra", region: "Greater Accra" } },
      effective_from: today(),
      status: "draft",
      premium_adjustment: -500, // ignored for customers
    });
    expectOk(r, 201);
    const row = r.body[0];
    open.push(row.id);
    ids.draft = row.id;
    assert.equal(row.status, "draft");
    assert.equal(row.insurer_org_id, ids.ownPolicy.insurer_org_id);
    assert.equal(row.broker_org_id, ids.ownPolicy.broker_org_id);
    assert.equal(row.premium_adjustment, null);
    assert.match(row.reference, /^END-\d+/);
  });

  test("customer cannot accept, apply or price their own change", async (t) => {
    if (!ids.draft) return t.skip("no draft");
    const c = asUser(sessions.customer);
    expectRule(await c.update(`endorsements?id=eq.${ids.draft}`, { status: "accepted" }), /insurer/i);
    expectRule(await c.update(`endorsements?id=eq.${ids.draft}`, { status: "applied" }), /insurer/i);
    expectRule(await c.update(`endorsements?id=eq.${ids.draft}`, { premium_adjustment: 0 }), /broker or the insurer/i);
    expectRule(await c.update(`endorsements?id=eq.${ids.draft}`, { insurer_note: "approved" }), /insurer/i);
    expectRule(await c.update(`endorsements?id=eq.${ids.draft}`, { adjustment_payment_id: "00000000-0000-0000-0000-000000000000" }), /platform/i);
    expectRule(await c.update(`endorsements?id=eq.${ids.draft}`, { customer_accepted_at: new Date().toISOString() }), /quoted/i);
    // Allowed: edit the draft, then submit it.
    expectOk(await c.update(`endorsements?id=eq.${ids.draft}`, { effective_from: today() }));
    const sub = await c.update(`endorsements?id=eq.${ids.draft}`, { status: "submitted" });
    expectOk(sub);
    assert.equal(sub.body[0].status, "submitted");
    expectRule(await c.update(`endorsements?id=eq.${ids.draft}`, { status: "draft" }), /back to draft/i);
  });

  test("a new change cannot start beyond draft/submitted, and external policies are refused", async (t) => {
    if (!ids.ownPolicy) return t.skip("no own policy");
    const c = asUser(sessions.customer);
    expectRule(await c.insert("endorsements", { policy_id: ids.ownPolicy.id, customer_id: sessions.customer.userId, insurer_org_id: ids.ownPolicy.insurer_org_id, kind: "other", effective_from: today(), status: "quoted" }), /draft/i);
    if (ids.externalPolicy) {
      expectRule(await c.insert("endorsements", { policy_id: ids.externalPolicy, customer_id: sessions.customer.userId, insurer_org_id: ids.insurer, kind: "other", effective_from: today() }), /bought elsewhere/i);
    }
  });

  test("a broker who is not the broker of record can neither see nor change the customer's endorsement", async (t) => {
    if (!ids.draft || ids.ownPolicy?.broker_org_id) return t.skip("policy has a broker of record");
    const b = asUser(sessions.broker);
    const seen = await b.get(`endorsements?select=id&id=eq.${ids.draft}`);
    expectOk(seen);
    assert.equal(seen.body.length, 0);
    const upd = await b.update(`endorsements?id=eq.${ids.draft}`, { status: "applied" });
    assert.ok(upd.status >= 400 || (Array.isArray(upd.body) && upd.body.length === 0), "no rows changed");
  });
});

describe("tax rules", () => {
  test("seeded tax rules exist without rates and need confirmation; customers cannot edit them", async () => {
    const c = asUser(sessions.customer);
    const r = await c.get("tax_rules?select=code,rate,status&code=in.(VAT,NHIL,GETFUND,COVID_LEVY,NIC_LEVY,FIRE_SERVICE_LEVY)");
    expectOk(r);
    assert.equal(r.body.length, 6);
    for (const rule of r.body) if (rule.status === "needs_confirmation") assert.equal(rule.rate, null);
    const upd = await c.update("tax_rules?code=eq.VAT", { rate: 15, status: "active" });
    assert.ok(upd.status >= 400 || (Array.isArray(upd.body) && upd.body.length === 0), "customer cannot change tax rules");
    const a = await anon().get("tax_rules?select=code");
    assert.ok(a.status >= 400 || a.body.length === 0, "tax rules are not public");
  });
});

describe("partner reviews (public)", () => {
  test("anon reads published reviews only, never who wrote them", async () => {
    const a = anon();
    const r = await a.get("service_partner_reviews?select=id,rating,status,service_partner_id&limit=50");
    expectOk(r);
    assert.ok(r.body.every((x) => x.status === "published"));
    expectDenied(await a.get("service_partner_reviews?select=customer_id&limit=1"));
    expectDenied(await a.insert("service_partner_reviews", { claim_job_id: "00000000-0000-0000-0000-000000000000", service_partner_id: "00000000-0000-0000-0000-000000000000", customer_id: "00000000-0000-0000-0000-000000000000", rating: 5 }));
  });

  test("a customer cannot review a job that isn't theirs", async () => {
    const c = asUser(sessions.customer);
    expectRule(await c.insert("service_partner_reviews", { claim_job_id: "00000000-0000-0000-0000-000000000000", service_partner_id: "00000000-0000-0000-0000-000000000000", customer_id: sessions.customer.userId, rating: 4 }), /job not found/i);
  });

  test("service partner applications are not readable by customers or anon", async () => {
    const r = await asUser(sessions.customer).get("service_partner_applications?select=id&limit=1");
    expectOk(r);
    assert.equal(r.body.length, 0);
    expectDenied(await anon().insert("service_partner_applications", { kind: "garage", name: `${RUN} sneaky` }));
  });
});

// ---------------------------------------------------------------------------
describe("privileged: broker quotes, insurer decides and applies; one review per completed job", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
  test("broker of record quotes but cannot accept or apply; insurer accepts after the customer agrees and applies", async () => {
    const svc = service();
    const pol = await svc.insert("policies", {
      customer_id: sessions.customer.userId,
      insurer_org_id: ids.insurer,
      broker_org_id: ids.broker,
      category_id: ids.motor,
      status: "active",
      policy_number: `${RUN}-END-${stamp()}`,
      nickname: `${RUN} endorsement fixture`,
      cover_start: today(),
      cover_end: new Date(Date.now() + 300 * 86_400_000).toISOString().slice(0, 10),
      premium: 1200,
    });
    expectOk(pol, 201);
    const policyId = pol.body[0].id;
    const c = asUser(sessions.customer);
    const e = await c.insert("endorsements", { policy_id: policyId, customer_id: sessions.customer.userId, insurer_org_id: ids.insurer, kind: "add_driver", changes: { after: { driver_name: "Kofi" } }, effective_from: today(), status: "submitted" });
    expectOk(e, 201);
    const id = e.body[0].id;
    open.push(id);
    const broker = asUser(sessions.broker);
    expectRule(await broker.update(`endorsements?id=eq.${id}`, { status: "quoted" }), /premium adjustment/i);
    const quoted = await broker.update(`endorsements?id=eq.${id}`, { status: "quoted", premium_adjustment: 0, broker_note: `${RUN} no change` });
    expectOk(quoted);
    assert.equal(quoted.body[0].status, "quoted");
    expectRule(await broker.update(`endorsements?id=eq.${id}`, { status: "accepted" }), /insurer/i);
    // Customer agrees to the (zero) price.
    expectOk(await c.update(`endorsements?id=eq.${id}`, { customer_accepted_at: new Date().toISOString() }));
    const uw = asUser(sessions.underwriter);
    const accepted = await uw.update(`endorsements?id=eq.${id}`, { status: "accepted", insurer_note: `${RUN} ok` });
    expectOk(accepted);
    assert.equal(accepted.body[0].status, "accepted");
    assert.equal(accepted.body[0].decided_by, sessions.underwriter.userId);
    const brokerApply = await broker.update(`endorsements?id=eq.${id}`, { status: "applied" });
    assert.ok(brokerApply.status >= 400 || brokerApply.body.length === 0, "broker cannot apply an accepted change");
    const applied = await uw.update(`endorsements?id=eq.${id}`, { status: "applied" });
    expectOk(applied);
    assert.equal(applied.body[0].status, "applied");
    assert.ok(applied.body[0].applied_at);
  });

  test("insurer cannot accept a priced change the customer hasn't agreed to; additional premium must be paid before applying", async () => {
    const svc = service();
    const pol = await svc.insert("policies", { customer_id: sessions.customer.userId, insurer_org_id: ids.insurer, category_id: ids.motor, status: "active", policy_number: `${RUN}-END2-${stamp()}`, nickname: `${RUN} endorsement fixture 2`, cover_start: today(), cover_end: new Date(Date.now() + 200 * 86_400_000).toISOString().slice(0, 10), premium: 900 });
    expectOk(pol, 201);
    const c = asUser(sessions.customer);
    const e = await c.insert("endorsements", { policy_id: pol.body[0].id, customer_id: sessions.customer.userId, insurer_org_id: ids.insurer, kind: "change_vehicle", effective_from: today(), status: "submitted" });
    expectOk(e, 201);
    const id = e.body[0].id;
    open.push(id);
    const uw = asUser(sessions.underwriter);
    expectOk(await uw.update(`endorsements?id=eq.${id}`, { status: "quoted", premium_adjustment: 150 }));
    expectRule(await uw.update(`endorsements?id=eq.${id}`, { status: "accepted" }), /customer must agree/i);
    expectOk(await c.update(`endorsements?id=eq.${id}`, { customer_accepted_at: new Date().toISOString() }));
    expectOk(await uw.update(`endorsements?id=eq.${id}`, { status: "accepted" }));
    expectRule(await uw.update(`endorsements?id=eq.${id}`, { status: "applied" }), /not been paid/i);
  });

  test("one review per completed job; incomplete jobs can't be reviewed; review_count is maintained", async () => {
    const svc = service();
    const partner = await svc.insert("service_partners", { kind: "garage", name: `${RUN} Review Garage`, region: "Greater Accra", status: "approved" });
    expectOk(partner, 201);
    const partnerId = partner.body[0].id;
    const pol = (await svc.get(`policies?select=id&nickname=eq.${encodeURIComponent(`${RUN} endorsement fixture`)}`)).body[0];
    const c = asUser(sessions.customer);
    const claim = await c.insert("claims", { policy_id: pol.id, customer_id: sessions.customer.userId, insurer_org_id: ids.insurer, broker_org_id: ids.broker, status: "reported", incident_type: "accident", incident_at: new Date(Date.now() - 86_400_000).toISOString(), description: `${RUN} review claim` });
    expectOk(claim, 201);
    const officer = asUser(sessions.claims);
    const job = await officer.insert("claim_jobs", { claim_id: claim.body[0].id, service_partner_id: partnerId, kind: "repair" });
    expectOk(job, 201);
    const jobId = job.body[0].id;
    expectRule(await c.insert("service_partner_reviews", { claim_job_id: jobId, service_partner_id: partnerId, customer_id: sessions.customer.userId, rating: 5 }), /completed/i);
    expectOk(await officer.update(`claim_jobs?id=eq.${jobId}`, { status: "completed" }));
    const review = await c.insert("service_partner_reviews", { claim_job_id: jobId, service_partner_id: partnerId, customer_id: sessions.customer.userId, rating: 4, comment: `${RUN} quick and tidy` });
    expectOk(review, 201);
    assert.equal(review.body[0].status, "published");
    const dupe = await c.insert("service_partner_reviews", { claim_job_id: jobId, service_partner_id: partnerId, customer_id: sessions.customer.userId, rating: 1 });
    assert.equal(dupe.code, "23505", `second review is a duplicate: ${dupe.code} ${dupe.message}`);
    const pub = (await anon().get(`service_partners?select=rating,review_count&id=eq.${partnerId}`)).body[0];
    assert.equal(pub.review_count, 1);
    assert.equal(pub.rating, null, "rating stays hidden below 3 reviews");
    expectRule(await c.update(`service_partner_reviews?id=eq.${review.body[0].id}`, { rating: 5 }).then((r) => (r.status < 300 && r.body.length === 0 ? { status: 403, code: "P0001", message: "moderated" } : r)), /moderat/i);
    await c.update(`claims?id=eq.${claim.body[0].id}`, { status: "withdrawn" });
  });
});
