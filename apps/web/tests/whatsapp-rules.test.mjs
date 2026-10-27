// WhatsApp channel database rules (Phase 2), exercised through Supabase Auth + PostgREST as each role.
// Run:  node --test apps/web/tests/whatsapp-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// wa_* tables are written by the webhook / bot through the service role. Staff read everything;
// a broker sees only conversations handed to their organisation; customers and anonymous visitors
// see nothing. The privileged block (inserts, idempotency on wa_message_id, the message trigger,
// broker visibility) runs only when SUPABASE_SECRET_KEY is set. Rows are tagged `E2E-WA…`.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp, uuid } from "./_lib/supabase.mjs";

const TAG = "E2E-WA";
const RUN = `${TAG} ${stamp()}`;
const WA_TABLES = ["wa_contacts", "wa_conversations", "wa_messages", "wa_templates", "wa_handoffs"];
const SEEDED_TEMPLATES = ["renewal_reminder", "policy_documents_ready", "claim_status_update", "quote_ready", "payment_link", "broker_new_offer", "consent_request", "otp_code", "info_request"];

function expectRefused(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["42501", "P0001", "23503", "42P01", "23514", "23505"].includes(r.code) || r.status === 401 || r.status === 403, `expected RLS/guard rejection, got ${r.code}: ${r.message}`);
}
function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}
/** Reads must come back empty (RLS) or be refused outright. */
function expectHidden(r, label) {
  assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${label}: ${r.status} ${JSON.stringify(r.body)}`);
}

/** A unique test phone number: +2335 + 8 digits derived from the run stamp. */
function testPhone(offset = 0) {
  const n = (Number(stamp().slice(-8)) + offset) % 100_000_000;
  return `+2335${String(n).padStart(8, "0")}`;
}

const sessions = {};

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  sessions.admin = await signIn(ACCOUNTS.admin);
});

// ---------------------------------------------------------------------------
describe("anonymous visitors", () => {
  test("cannot read or write any WhatsApp table", async () => {
    const pub = anon();
    for (const table of WA_TABLES) expectHidden(await pub.get(`${table}?select=id&limit=1`), table);
    expectRefused(await pub.insert("wa_contacts", { phone: testPhone(1), wa_id: testPhone(1).slice(1), display_name: `${RUN} forged` }));
    expectRefused(await pub.insert("wa_templates", { name: "forged_template", body: "x", variables: [] }));
  });
});

// ---------------------------------------------------------------------------
describe("customers, brokers and insurers", () => {
  for (const who of ["customer", "broker", "underwriter"]) {
    test(`${who} sees no WhatsApp rows by default and cannot write them`, async () => {
      const db = asUser(sessions[who]);
      // Brokers may see conversations handed to them (checked in the privileged block); none exist for them yet in a fresh run,
      // and templates / unassigned contacts are never visible.
      expectHidden(await db.get("wa_templates?select=id&limit=5"), `${who} wa_templates`);
      if (who !== "broker") expectHidden(await db.get(`wa_contacts?select=id&display_name=like.${encodeURIComponent(`${TAG}%`)}&limit=5`), `${who} wa_contacts`);
      expectRefused(await db.insert("wa_contacts", { phone: testPhone(2), wa_id: testPhone(2).slice(1), display_name: `${RUN} forged by ${who}` }));
      expectRefused(await db.insert("wa_conversations", { contact_id: uuid() }));
      expectRefused(await db.insert("wa_messages", { conversation_id: uuid(), direction: "in", body: `${RUN} forged` }));
      expectRefused(await db.insert("wa_handoffs", { conversation_id: uuid(), reason: "unknown", to_party: "support" }));
      expectRefused(await db.insert("wa_templates", { name: "forged_by_user", body: "x", variables: [] }));
    });
  }
});

// ---------------------------------------------------------------------------
describe("platform staff", () => {
  test("read the seeded template registry", async () => {
    const admin = asUser(sessions.admin);
    const r = await admin.get("wa_templates?select=name,status,category,variables&order=name");
    expectOk(r);
    const names = r.body.map((t) => t.name);
    for (const n of SEEDED_TEMPLATES) assert.ok(names.includes(n), `template ${n} is seeded`);
    const offer = r.body.find((t) => t.name === "broker_new_offer");
    assert.deepEqual(offer.variables, ["category", "reference", "minutes", "link"]);
    assert.equal(offer.status, "draft", "templates start as draft until Meta approves them");
  });

  test("cannot insert messages directly (the webhook/bot writes through the service role)", async () => {
    const admin = asUser(sessions.admin);
    expectRefused(await admin.insert("wa_messages", { conversation_id: uuid(), direction: "out", body: `${RUN} forged` }));
  });
});

// ---------------------------------------------------------------------------
describe("privileged checks (service role)", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
  const phone = testPhone(3);
  let contactId;
  let conversationId;
  let brokerOrgId;
  const waMessageId = `wamid.${TAG}.${stamp()}.${uuid().slice(0, 8)}`;

  test("the webhook path: contact → conversation → inbound message; a replayed wa_message_id is rejected", async () => {
    const svc = service();
    const c = await svc.insert("wa_contacts", { phone, wa_id: phone.slice(1), display_name: `${RUN} Ama`, opted_in: true, opted_in_at: new Date().toISOString() });
    expectOk(c);
    contactId = c.body[0].id;
    assert.equal(c.body[0].last_inbound_at, null);
    const v = await svc.insert("wa_conversations", { contact_id: contactId, status: "bot" });
    expectOk(v);
    conversationId = v.body[0].id;
    assert.equal(v.body[0].bot_turns, 0);

    const m = await svc.insert("wa_messages", { conversation_id: conversationId, direction: "in", wa_message_id: waMessageId, kind: "text", body: `${RUN} I need a quote`, status: "received", sender_party: "customer" });
    expectOk(m);
    const dup = await svc.insert("wa_messages", { conversation_id: conversationId, direction: "in", wa_message_id: waMessageId, kind: "text", body: `${RUN} replayed`, status: "received", sender_party: "customer" });
    assert.equal(dup.code, "23505", "wa_message_id is unique → webhook retries are idempotent");

    const contact = await svc.get(`wa_contacts?select=last_inbound_at,last_outbound_at&id=eq.${contactId}`);
    assert.ok(contact.body[0].last_inbound_at, "the message trigger stamps last_inbound_at (opens the 24h window)");
    assert.equal(contact.body[0].last_outbound_at, null);

    const bot = await svc.insert("wa_messages", { conversation_id: conversationId, direction: "out", kind: "text", body: `${RUN} Here is your quote link`, status: "sent", wa_message_id: `${waMessageId}.out`, sender_party: "bot" });
    expectOk(bot);
    const conv = await svc.get(`wa_conversations?select=bot_turns,last_message_at&id=eq.${conversationId}`);
    assert.equal(conv.body[0].bot_turns, 1, "bot replies are counted (three → offer a human)");
    const after = await svc.get(`wa_contacts?select=last_outbound_at&id=eq.${contactId}`);
    assert.ok(after.body[0].last_outbound_at, "outbound messages stamp last_outbound_at");
  });

  test("delivery statuses update the outbound row; invalid statuses are rejected by the check", async () => {
    const svc = service();
    const r = await svc.update(`wa_messages?wa_message_id=eq.${encodeURIComponent(`${waMessageId}.out`)}`, { status: "delivered" });
    expectOk(r);
    assert.equal(r.body[0].status, "delivered");
    const bad = await svc.update(`wa_messages?wa_message_id=eq.${encodeURIComponent(`${waMessageId}.out`)}`, { status: "bounced" });
    assert.equal(bad.code, "23514");
  });

  test("only the broker the conversation was handed to can read it (and its messages, handoff and contact)", async () => {
    const svc = service();
    const admin = asUser(sessions.admin);
    const brokerDb = asUser(sessions.broker);
    const mine = await brokerDb.get("memberships?select=org_id,organizations!inner(type)&organizations.type=eq.broker&limit=1");
    expectOk(mine);
    brokerOrgId = mine.body[0]?.org_id;
    assert.ok(brokerOrgId, "the demo broker belongs to a broker organisation");

    // Before the handoff: invisible to the broker, visible to staff.
    expectHidden(await brokerDb.get(`wa_conversations?select=id&id=eq.${conversationId}`), "broker before handoff");
    const staffSees = await admin.get(`wa_conversations?select=id,status&id=eq.${conversationId}`);
    expectOk(staffSees);
    assert.equal(staffSees.body.length, 1);

    const h = await svc.insert("wa_handoffs", { conversation_id: conversationId, reason: "advice", to_party: "broker", org_id: brokerOrgId, note: `${RUN} which cover should I pick` });
    expectOk(h);
    expectOk(await svc.update(`wa_conversations?id=eq.${conversationId}`, { status: "broker", assigned_org_id: brokerOrgId }));

    const conv = await brokerDb.get(`wa_conversations?select=id,status&id=eq.${conversationId}`);
    expectOk(conv);
    assert.deepEqual(conv.body, [{ id: conversationId, status: "broker" }]);
    const msgs = await brokerDb.get(`wa_messages?select=direction,body&conversation_id=eq.${conversationId}&order=created_at`);
    expectOk(msgs);
    assert.equal(msgs.body.length, 2);
    const contact = await brokerDb.get(`wa_contacts?select=id,phone&id=eq.${contactId}`);
    expectOk(contact);
    assert.equal(contact.body.length, 1);
    const handoffs = await brokerDb.get(`wa_handoffs?select=reason&conversation_id=eq.${conversationId}`);
    expectOk(handoffs);
    assert.deepEqual(handoffs.body, [{ reason: "advice" }]);

    // Brokers reply through the server (service role): they cannot write rows themselves.
    expectRefused(await brokerDb.insert("wa_messages", { conversation_id: conversationId, direction: "out", body: `${RUN} forged broker reply` }));
    expectRefused(await brokerDb.update(`wa_conversations?id=eq.${conversationId}`, { status: "closed" }));

    // Other roles still see nothing.
    for (const who of ["customer", "underwriter"]) {
      expectHidden(await asUser(sessions[who]).get(`wa_conversations?select=id&id=eq.${conversationId}`), `${who} after handoff`);
      expectHidden(await asUser(sessions[who]).get(`wa_messages?select=id&conversation_id=eq.${conversationId}`), `${who} messages`);
    }
  });

  test("staff take over, close and opt out; opt-out and consent columns are honoured by the schema", async () => {
    const admin = asUser(sessions.admin);
    const taken = await admin.update(`wa_conversations?id=eq.${conversationId}`, { status: "human", assigned_user_id: sessions.admin.userId, assigned_org_id: null });
    expectOk(taken);
    assert.equal(taken.body[0].status, "human");
    expectHidden(await asUser(sessions.broker).get(`wa_conversations?select=id&id=eq.${conversationId}`), "broker after staff took it back");

    const out = await admin.update(`wa_contacts?id=eq.${contactId}`, { opted_out_at: new Date().toISOString(), opted_in: false });
    expectOk(out);
    assert.equal(out.body[0].opted_in, false);
    const closed = await admin.update(`wa_conversations?id=eq.${conversationId}`, { status: "closed", closed_at: new Date().toISOString() });
    expectOk(closed);
    const badStatus = await admin.update(`wa_conversations?id=eq.${conversationId}`, { status: "archived" });
    assert.equal(badStatus.code, "23514");
    const badPhone = await service().insert("wa_contacts", { phone: "0501234567", wa_id: "0501234567" });
    assert.equal(badPhone.code, "23514", "phones must be E.164");
  });
});
