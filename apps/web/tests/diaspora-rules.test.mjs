// Diaspora database rules (sponsor ↔ beneficiary ↔ sponsorship, consent OTP), exercised through
// Supabase Auth + PostgREST as each role.
// Run:  node --test apps/web/tests/diaspora-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Rows created here are tagged `E2E-DIASPORA…` (beneficiary notes / full_name) and deleted at the end
// with the service key when present. The parts that need system writes (issuing a consent code,
// stamping a policy's sponsor) run only with SUPABASE_SECRET_KEY and are skipped otherwise.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp, uuid } from "./_lib/supabase.mjs";

const TAG = "E2E-DIASPORA";
const RUN = `${TAG} ${stamp()}`;

function expectRule(r, pattern) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected trigger error P0001, got ${r.code}: ${r.message}`);
  if (pattern) assert.match(r.message ?? "", pattern);
}
function expectRefused(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["42501", "P0001", "23503", "23514", "23502"].includes(r.code), `expected RLS/guard rejection, got ${r.code}: ${r.message}`);
}
function expectOk(r, status = 200) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
  if (status === 201) assert.equal(r.status, 201);
}

const sessions = {};
const ids = { beneficiaries: [], sponsorships: [], policies: [] };
// Unique-ish Ghana number per run so the auto-link trigger never matches a demo account.
const phone = `+23355${String(Date.now()).slice(-7)}`;

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  const pub = anon();
  const orgs = (await pub.get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  ids.motor = (await pub.get("product_categories?select=id,slug&slug=eq.motor")).body[0]?.id;
  assert.ok(ids.insurer && ids.motor, "seed data (insurer, motor category) must exist");
});

after(async () => {
  if (!hasServiceKey()) {
    console.log(`cleanup: no SUPABASE_SECRET_KEY — rows tagged "${TAG}" left behind: ${JSON.stringify(ids)}`);
    return;
  }
  const svc = service();
  if (ids.policies.length) await svc.delete(`policies?id=in.(${ids.policies.join(",")})`);
  await svc.delete(`sponsorships?id=in.(${[...ids.sponsorships, uuid()].join(",")})`);
  await svc.delete(`beneficiaries?notes=like.${TAG}*`);
});

// ---------------------------------------------------------------------------
describe("anonymous visitors", () => {
  test("cannot read or write beneficiaries, sponsorships or consents", async () => {
    const pub = anon();
    for (const table of ["beneficiaries", "sponsorships", "beneficiary_consents", "households", "household_members"]) {
      const r = await pub.get(`${table}?select=id&limit=1`);
      assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${table}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    expectRefused(await pub.insert("beneficiaries", { sponsor_user_id: uuid(), full_name: `${RUN} anon`, relationship: "parent", phone, notes: RUN }));
    // The code-issuing RPC is service-role only; execute is revoked from anon and authenticated.
    const rpc = await pub.rpc("request_beneficiary_consent", { p_beneficiary_id: uuid(), p_kind: "data_sharing", p_channel: "sms" });
    assert.ok(rpc.status >= 400, `expected rejection, got ${rpc.status}`);
  });
});

// ---------------------------------------------------------------------------
describe("customer as sponsor", () => {
  let db;
  let me;
  let beneficiaryId;
  before(() => {
    db = asUser(sessions.customer);
    me = sessions.customer.userId;
  });

  test("can add their own beneficiary; consent starts pending and the Ghana number is enforced", async () => {
    expectRefused(await db.insert("beneficiaries", { sponsor_user_id: me, full_name: `${RUN} bad phone`, relationship: "parent", phone: "+447700900123", notes: RUN }));
    const created = await db.insert("beneficiaries", { sponsor_user_id: me, full_name: `${RUN} Akua Mensah`, relationship: "parent", phone, notes: RUN, consent_status: "granted" });
    expectOk(created, 201);
    const row = created.body[0];
    beneficiaryId = row.id;
    ids.beneficiaries.push(row.id);
    assert.equal(row.consent_status, "pending", "the guard resets consent_status on insert");
    assert.equal(row.linked_user_id, null);
    assert.equal(row.phone, phone);
  });

  test("cannot add a beneficiary for another sponsor", async () => {
    expectRefused(await db.insert("beneficiaries", { sponsor_user_id: sessions.broker.userId, full_name: `${RUN} not mine`, relationship: "sibling", phone, notes: RUN }));
  });

  test("cannot edit consent fields or the linked account directly", async () => {
    expectRule(await db.update(`beneficiaries?id=eq.${beneficiaryId}`, { consent_status: "granted" }), /captured from the beneficiary/);
    expectRule(await db.update(`beneficiaries?id=eq.${beneficiaryId}`, { linked_user_id: sessions.broker.userId }), /linked automatically/);
    expectRule(await db.update(`beneficiaries?id=eq.${beneficiaryId}`, { sponsor_user_id: sessions.broker.userId }), /another sponsor/);
    // Ordinary details are editable.
    expectOk(await db.update(`beneficiaries?id=eq.${beneficiaryId}`, { region: "Ashanti" }));
  });

  test("another user cannot read the beneficiary", async () => {
    const other = asUser(sessions.broker);
    const r = await other.get(`beneficiaries?select=id&id=eq.${beneficiaryId}`);
    expectOk(r);
    assert.equal(r.body.length, 0);
    expectRefused(await other.update(`beneficiaries?id=eq.${beneficiaryId}`, { full_name: "hijack" }));
  });

  test("a sponsorship needs consent-independent ownership checks: own beneficiary, own request/policy", async () => {
    expectRule(await db.insert("sponsorships", { sponsor_user_id: me, beneficiary_id: uuid() }), /Add the family member/);
    expectRefused(await db.insert("sponsorships", { sponsor_user_id: sessions.broker.userId, beneficiary_id: beneficiaryId }));
    expectRule(await db.insert("sponsorships", { sponsor_user_id: me, beneficiary_id: beneficiaryId, policy_id: uuid() }), /not one you pay for|not yours/);
    const created = await db.insert("sponsorships", { sponsor_user_id: me, beneficiary_id: beneficiaryId, gift: true, gift_message: `${RUN} love from London`, gift_revealed_at: new Date().toISOString() });
    expectOk(created, 201);
    const s = created.body[0];
    ids.sponsorships.push(s.id);
    assert.equal(s.status, "draft");
    assert.equal(s.gift_revealed_at, null, "the sponsor cannot mark a gift as opened");
    expectRule(await db.update(`sponsorships?id=eq.${s.id}`, { gift_revealed_at: new Date().toISOString() }), /Only the beneficiary/);
    expectRule(await db.update(`sponsorships?id=eq.${s.id}`, { status: "active" }), /once a policy is linked/);
    expectRule(await db.rpc("reveal_gift", { p_sponsorship_id: s.id }), /Gift not found/);
  });

  test("consent RPC rejects when no code is pending; the code-issuing RPC is not callable by the sponsor", async () => {
    expectRule(await db.rpc("confirm_beneficiary_consent", { p_beneficiary_id: beneficiaryId, p_kind: "data_sharing", p_code: "123456" }), /No consent code is pending/);
    const r = await db.rpc("request_beneficiary_consent", { p_beneficiary_id: beneficiaryId, p_kind: "data_sharing", p_channel: "sms" });
    assert.ok(r.status >= 400, `expected rejection, got ${r.status} ${JSON.stringify(r.body)}`);
    // A beneficiary that isn't theirs is "not found" (no enumeration).
    expectRule(await db.rpc("confirm_beneficiary_consent", { p_beneficiary_id: uuid(), p_kind: "data_sharing", p_code: "123456" }), /not found/);
  });

  describe("privileged: consent code, 5-attempt lock, sponsor policy access", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
    let code;

    test("service role issues a code; wrong codes count down and lock after 5; the right code grants", async () => {
      const svc = service();
      const issued = await svc.rpc("request_beneficiary_consent", { p_beneficiary_id: beneficiaryId, p_kind: "data_sharing", p_channel: "sms" });
      expectOk(issued);
      code = String(issued.body);
      assert.match(code, /^\d{6}$/);
      const pending = await db.get(`beneficiary_consents?select=kind,granted,attempts,locked_at,code_hash&beneficiary_id=eq.${beneficiaryId}&kind=eq.data_sharing`);
      expectOk(pending);
      assert.equal(pending.body[0].granted, false);
      assert.equal(pending.body[0].code_hash === null || typeof pending.body[0].code_hash === "string", true);
      assert.notEqual(pending.body[0].code_hash, code, "the plaintext code is never stored");

      const wrong = code === "000000" ? "111111" : "000000";
      for (let i = 1; i <= 4; i++) {
        expectRule(await db.rpc("confirm_beneficiary_consent", { p_beneficiary_id: beneficiaryId, p_kind: "data_sharing", p_code: wrong }), new RegExp(`${5 - i} attempt`));
      }
      expectRule(await db.rpc("confirm_beneficiary_consent", { p_beneficiary_id: beneficiaryId, p_kind: "data_sharing", p_code: wrong }), /Too many incorrect codes/);
      // Locked: even the right code is refused until a new one is issued.
      expectRule(await db.rpc("confirm_beneficiary_consent", { p_beneficiary_id: beneficiaryId, p_kind: "data_sharing", p_code: code }), /Too many incorrect codes/);

      const again = await svc.rpc("request_beneficiary_consent", { p_beneficiary_id: beneficiaryId, p_kind: "data_sharing", p_channel: "whatsapp" });
      expectOk(again);
      const ok = await db.rpc("confirm_beneficiary_consent", { p_beneficiary_id: beneficiaryId, p_kind: "data_sharing", p_code: String(again.body) });
      expectOk(ok);
      assert.equal(ok.body.status, "granted");
      const b = await db.get(`beneficiaries?select=consent_status,consent_channel,consent_granted_at&id=eq.${beneficiaryId}`);
      assert.equal(b.body[0].consent_status, "granted");
      assert.equal(b.body[0].consent_channel, "whatsapp");
      assert.ok(b.body[0].consent_granted_at);
    });

    test("the signed-link decision RPC is service-role only and records declines", async () => {
      const svc = service();
      expectRule(await db.rpc("decide_beneficiary_consent_link", { p_beneficiary_id: beneficiaryId, p_kind: "proxy_claims", p_granted: true }), /verified by the platform/);
      const declined = await svc.rpc("decide_beneficiary_consent_link", { p_beneficiary_id: beneficiaryId, p_kind: "proxy_claims", p_granted: false });
      expectOk(declined);
      assert.equal(declined.body.status, "declined");
      const granted = await svc.rpc("decide_beneficiary_consent_link", { p_beneficiary_id: beneficiaryId, p_kind: "proxy_claims", p_granted: true });
      expectOk(granted);
      assert.equal(granted.body.status, "granted");
    });

    test("a sponsor can read a policy where sponsor_user_id is them (and a stranger cannot)", async () => {
      const svc = service();
      // Policy owned by the broker user (as the customer), sponsored by our customer.
      const created = await svc.insert("policies", {
        customer_id: sessions.broker.userId,
        insurer_org_id: ids.insurer,
        broker_org_id: ids.broker ?? null,
        category_id: ids.motor,
        status: "pending_issuance",
        nickname: `${TAG} sponsored`,
        sponsor_user_id: me,
        beneficiary_id: beneficiaryId,
        premium: 100,
      });
      expectOk(created, 201);
      const policy = created.body[0];
      ids.policies.push(policy.id);

      const mine = await db.get(`policies?select=id,sponsor_user_id&id=eq.${policy.id}`);
      expectOk(mine);
      assert.equal(mine.body.length, 1, "sponsor reads the policy they pay for");
      assert.equal(mine.body[0].sponsor_user_id, me);

      // Linking the sponsorship to that policy makes it active.
      const s = await db.insert("sponsorships", { sponsor_user_id: me, beneficiary_id: beneficiaryId, policy_id: policy.id });
      expectOk(s, 201);
      ids.sponsorships.push(s.body[0].id);
      assert.equal(s.body[0].status, "active");
      assert.ok(s.body[0].started_at);

      // The sponsor's own name for the beneficiary side.
      const name = await db.rpc("policy_sponsor_name", { p_policy_id: policy.id });
      expectOk(name);
      assert.ok(typeof name.body === "string" && name.body.length > 0);

      // A third account (underwriter of a different insurer, if any) — use a fresh anon: no access.
      const pub = anon();
      const hidden = await pub.get(`policies?select=id&id=eq.${policy.id}`);
      assert.ok(hidden.status === 200 ? hidden.body.length === 0 : hidden.status >= 400);
    });
  });
});
