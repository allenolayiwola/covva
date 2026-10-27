// Phase 3 database rules: translations, USSD sessions and voice notes, exercised through Supabase
// Auth + PostgREST as each role.
// Run:  node --test apps/web/tests/i18n-ussd-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
//  - translations: anyone reads APPROVED rows only; staff read and write everything; editing an
//    approved value sends it back to draft (trigger). Test keys are `E2E-I18N.*` (unknown to the
//    app catalogue, so they are never rendered).
//  - ussd_sessions: staff read only; customers, partners and anonymous visitors see nothing; only
//    the service role writes (privileged block).
//  - voice_notes: the owner (and staff, and parties of a linked request/claim) only; the server
//    writes transcripts — owners can edit the transcript text and nothing else.
// The privileged block runs only when SUPABASE_SECRET_KEY is set.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp, uuid } from "./_lib/supabase.mjs";

const RUN = stamp();
const KEY = (suffix) => `E2E-I18N.${RUN}.${suffix}`;

function expectRefused(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["42501", "P0001", "23503", "23514", "23505", "42P01", "PGRST204"].includes(r.code) || r.status === 401 || r.status === 403, `expected RLS/guard rejection, got ${r.code}: ${r.message}`);
}
function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}
function expectHidden(r, label) {
  assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${label}: ${r.status} ${JSON.stringify(r.body)}`);
}

const sessions = {};
before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  sessions.admin = await signIn(ACCOUNTS.admin);
});

// ---------------------------------------------------------------------------
describe("translations", () => {
  test("anonymous visitors read approved rows only and cannot write", async () => {
    const pub = anon();
    const notApproved = await pub.get("translations?select=id,status&status=neq.approved&limit=5");
    expectHidden(notApproved, "anon non-approved translations");
    const approved = await pub.get("translations?select=key,value,status&status=eq.approved&limit=5");
    expectOk(approved);
    for (const r of approved.body) assert.equal(r.status, "approved");
    expectRefused(await pub.insert("translations", { locale: "tw", key: KEY("anon"), value: "forged", status: "approved" }));
  });

  test("customers and partners cannot write translations or see drafts", async () => {
    for (const who of ["customer", "broker", "underwriter"]) {
      const db = asUser(sessions[who]);
      expectRefused(await db.insert("translations", { locale: "tw", key: KEY(who), value: "forged", status: "draft" }));
      expectHidden(await db.get("translations?select=id&status=eq.draft&limit=5"), `${who} drafts`);
    }
  });

  test("staff draft → approve; anon then sees it; editing an approved value sends it back to draft", async () => {
    const admin = asUser(sessions.admin);
    const key = KEY("flow");
    const ins = await admin.insert("translations", { locale: "tw", key, value: "Draft text", status: "draft" });
    expectOk(ins);
    const row = ins.body[0];
    assert.equal(row.status, "draft");
    assert.equal(row.translator_id, sessions.admin.userId, "translator recorded");
    assert.equal(row.approved_at, null);
    expectHidden(await anon().get(`translations?select=id&key=eq.${encodeURIComponent(key)}`), "anon draft");

    const approved = await admin.update(`translations?id=eq.${row.id}`, { status: "approved" });
    expectOk(approved);
    assert.equal(approved.body[0].status, "approved");
    assert.ok(approved.body[0].approved_at, "approved_at stamped");
    assert.equal(approved.body[0].reviewed_by, sessions.admin.userId);
    const pub = await anon().get(`translations?select=key,value&key=eq.${encodeURIComponent(key)}`);
    expectOk(pub);
    assert.deepEqual(pub.body, [{ key, value: "Draft text" }]);

    const edited = await admin.update(`translations?id=eq.${row.id}`, { value: "Changed text" });
    expectOk(edited);
    assert.equal(edited.body[0].status, "draft", "a changed approved value must be checked again");
    assert.equal(edited.body[0].approved_at, null);
    expectHidden(await anon().get(`translations?select=id&key=eq.${encodeURIComponent(key)}`), "anon after edit");
  });

  test("English is never stored and (locale, key) is unique", async () => {
    const admin = asUser(sessions.admin);
    expectRefused(await admin.insert("translations", { locale: "en", key: KEY("en"), value: "x" }));
    const key = KEY("dup");
    expectOk(await admin.insert("translations", { locale: "ee", key, value: "one" }));
    const dup = await admin.insert("translations", { locale: "ee", key, value: "two" });
    assert.equal(dup.code, "23505");
  });
});

// ---------------------------------------------------------------------------
describe("ussd_sessions", () => {
  test("anonymous visitors, customers and partners cannot read or write sessions", async () => {
    expectHidden(await anon().get("ussd_sessions?select=id&limit=1"), "anon");
    for (const who of ["customer", "broker", "underwriter"]) {
      const db = asUser(sessions[who]);
      expectHidden(await db.get("ussd_sessions?select=id&limit=5"), `${who} ussd_sessions`);
      expectRefused(await db.insert("ussd_sessions", { session_id: `E2E-USSD-${RUN}-${who}`, provider: "simulator", msisdn: "+233241234567" }));
    }
  });

  test("staff can read the session log but not write it", async () => {
    const admin = asUser(sessions.admin);
    expectOk(await admin.get("ussd_sessions?select=id,step&limit=5"));
    expectRefused(await admin.insert("ussd_sessions", { session_id: `E2E-USSD-${RUN}-staff`, provider: "simulator", msisdn: "+233241234567" }));
  });
});

// ---------------------------------------------------------------------------
describe("voice_notes", () => {
  let noteId;

  test("the owner records a note: the server-only fields are reset, other people can't see it", async () => {
    const me = asUser(sessions.customer);
    const ins = await me.insert("voice_notes", {
      owner_id: sessions.customer.userId,
      purpose: "claim_description",
      storage_path: `voice/${sessions.customer.userId}/E2E-VOICE-${RUN}.webm`,
      mime_type: "audio/webm",
      duration_seconds: 12,
      language_hint: "tw",
      transcript: "forged transcript",
      transcript_status: "done",
      model: "forged",
    });
    expectOk(ins);
    noteId = ins.body[0].id;
    assert.equal(ins.body[0].transcript_status, "pending", "owners cannot mark their own transcript done");
    assert.equal(ins.body[0].transcript, null);
    assert.equal(ins.body[0].model, null);

    for (const who of ["broker", "underwriter"]) {
      expectHidden(await asUser(sessions[who]).get(`voice_notes?select=id&id=eq.${noteId}`), `${who} unlinked note`);
    }
    expectHidden(await anon().get(`voice_notes?select=id&id=eq.${noteId}`), "anon note");
    const staff = await asUser(sessions.admin).get(`voice_notes?select=id&id=eq.${noteId}`);
    expectOk(staff);
    assert.equal(staff.body.length, 1, "staff can read voice notes");
  });

  test("owners edit the transcript only; status, model and path are server-written", async () => {
    const me = asUser(sessions.customer);
    const ok = await me.update(`voice_notes?id=eq.${noteId}`, { transcript: "My corrected words" });
    expectOk(ok);
    assert.equal(ok.body[0].transcript, "My corrected words");
    assert.ok(ok.body[0].transcript_edited_at, "edit time stamped");
    expectRefused(await me.update(`voice_notes?id=eq.${noteId}`, { transcript_status: "done" }));
    expectRefused(await me.update(`voice_notes?id=eq.${noteId}`, { storage_path: `voice/${sessions.customer.userId}/other.webm` }));
    expectRefused(await me.update(`voice_notes?id=eq.${noteId}`, { request_id: uuid() }));
  });

  test("nobody can file a note in someone else's folder or name", async () => {
    const broker = asUser(sessions.broker);
    expectRefused(await broker.insert("voice_notes", { owner_id: sessions.customer.userId, purpose: "support", storage_path: `voice/${sessions.customer.userId}/E2E-VOICE-${RUN}-x.webm` }));
    expectRefused(await broker.insert("voice_notes", { owner_id: sessions.broker.userId, purpose: "support", storage_path: `voice/${sessions.customer.userId}/E2E-VOICE-${RUN}-y.webm` }));
    expectRefused(await anon().insert("voice_notes", { owner_id: sessions.customer.userId, purpose: "support", storage_path: `voice/${sessions.customer.userId}/E2E-VOICE-${RUN}-z.webm` }));
  });
});

// ---------------------------------------------------------------------------
describe("privileged checks (service role)", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
  test("the USSD route writes sessions; staff read them; customers never do", async () => {
    const svc = service();
    const sid = `E2E-USSD-${RUN}-svc`;
    const ins = await svc.insert("ussd_sessions", { session_id: sid, provider: "simulator", msisdn: "+233241234567", state: { history: ["1"] }, step: "quote" });
    expectOk(ins);
    const dup = await svc.insert("ussd_sessions", { session_id: sid, provider: "simulator", msisdn: "+233241234567" });
    assert.equal(dup.code, "23505", "session_id is unique (aggregator retries are idempotent)");
    const bad = await svc.insert("ussd_sessions", { session_id: `${sid}-bad`, provider: "simulator", msisdn: "0241234567" });
    assert.equal(bad.code, "23514", "msisdn must be E.164");
    const staff = await asUser(sessions.admin).get(`ussd_sessions?select=session_id,step&session_id=eq.${encodeURIComponent(sid)}`);
    expectOk(staff);
    assert.equal(staff.body[0]?.step, "quote");
    expectHidden(await asUser(sessions.customer).get(`ussd_sessions?select=id&session_id=eq.${encodeURIComponent(sid)}`), "customer");
  });

  test("the server stores the transcript; the owner sees it", async () => {
    const svc = service();
    const ins = await svc.insert("voice_notes", { owner_id: sessions.customer.userId, purpose: "quote_help", storage_path: `voice/${sessions.customer.userId}/E2E-VOICE-${RUN}-svc.webm` });
    expectOk(ins);
    const id = ins.body[0].id;
    const done = await svc.update(`voice_notes?id=eq.${id}`, { transcript: "Automatic words", transcript_status: "done", transcript_language: "en", model: "openai/gpt-4o-mini-transcribe" });
    expectOk(done);
    const mine = await asUser(sessions.customer).get(`voice_notes?select=transcript,transcript_status&id=eq.${id}`);
    expectOk(mine);
    assert.deepEqual(mine.body[0], { transcript: "Automatic words", transcript_status: "done" });
    const tooLong = await svc.update(`voice_notes?id=eq.${id}`, { duration_seconds: 600 });
    assert.equal(tooLong.code, "23514", "≤ 120 s (+ tolerance)");
  });
});
