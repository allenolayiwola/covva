// Act 843 data-subject request rules (supabase/migrations/20261031100100_data_subject_requests.sql), exercised
// through Supabase Auth + PostgREST as each role.
// Run:  node --test apps/web/tests/privacy-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// SAFE FOR THE SHARED DEMO PROJECT: the demo customer's requests are tagged `E2E-DSR` in the note and always end
// withdrawn / refused / closed; the deletion is only ever PREVIEWED (dry run) — the real anonymisation is never run
// against a shared account (it is proven on a throwaway local database instead, see docs/PRIVACY_REQUESTS.md). The
// marketing opt-out is undone at the end by re-recording the customer's previous marketing consent. Requests are never
// deleted (the service role has no DELETE on these tables).
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp } from "./_lib/supabase.mjs";

const TAG = "E2E-DSR";
const RUN = `${TAG} ${stamp()}`;

function expectRule(r, pattern) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected business-rule error P0001, got ${r.code}: ${r.message}`);
  if (pattern) assert.match(r.message ?? "", pattern);
}
function expectRefused(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["42501", "P0001", "PGRST202"].includes(r.code), `expected RLS / privilege rejection, got ${r.code}: ${r.message}`);
}
function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}
const emptyOrRefused = (r, what) => assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${what}: ${r.status} ${JSON.stringify(r.body)}`);

const sessions = {};
const ids = {};
let marketingBefore = null;

/** Close anything a crashed earlier run left open, so the one-open-request-per-type rule doesn't block this run. */
async function tidy() {
  const me = asUser(sessions.customer);
  const staff = asUser(sessions.admin);
  const open = await me.get(`privacy_requests?select=id,status&note=like.${encodeURIComponent(`${TAG}*`)}&status=in.(submitted,identity_verified,approved,export_ready,refused)`);
  for (const r of Array.isArray(open.body) ? open.body : []) {
    if (["submitted", "identity_verified", "approved"].includes(r.status)) await me.rpc("withdraw_privacy_request", { p_id: r.id });
    else await staff.rpc("privacy_request_action", { p_id: r.id, p_action: "close" });
  }
}

before(async () => {
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.claims = await signIn(ACCOUNTS.claims); // another signed-in person (insurer claims officer)
  sessions.admin = await signIn(ACCOUNTS.admin);
  const latest = await asUser(sessions.customer).get(`consents?select=granted&user_id=eq.${sessions.customer.userId}&type=eq.marketing&order=created_at.desc&limit=1`);
  marketingBefore = latest.body?.[0]?.granted ?? null;
  await tidy();
});

after(async () => {
  await tidy();
  // Undo the marketing opt-out on the shared demo customer (append-only consent history: record the old choice again).
  if (marketingBefore === true) {
    await asUser(sessions.customer).insert("consents", { user_id: sessions.customer.userId, type: "marketing", version: "e2e", granted: true, context: `${TAG} restore` });
  }
});

describe("anonymous visitors", () => {
  test("cannot read privacy tables or call the RPCs", async () => {
    const pub = anon();
    for (const t of ["privacy_requests", "privacy_request_events", "privacy_retention_runs"]) emptyOrRefused(await pub.get(`${t}?select=id&limit=1`), t);
    expectRefused(await pub.rpc("submit_privacy_request", { p_type: "access" }));
    expectRefused(await pub.rpc("run_privacy_retention", { p_plan: [], p_dry_run: true }));
  });
});

describe("customer", () => {
  test("creates an access request and reads only their own requests and timeline", async () => {
    const me = asUser(sessions.customer);
    const r = await me.rpc("submit_privacy_request", { p_type: "access", p_note: `${RUN} access`, p_channel: "web" });
    expectOk(r);
    ids.access = r.body.id;
    assert.equal(r.body.status, "submitted");
    assert.match(r.body.reference, /^DSR-\d+$/);
    assert.ok(Date.parse(r.body.due_at) > Date.now() + 25 * 86_400_000, "due date is about 30 days out");

    const mine = await me.get("privacy_requests?select=id,user_id");
    expectOk(mine);
    assert.ok(mine.body.length >= 1);
    assert.ok(mine.body.every((x) => x.user_id === sessions.customer.userId), "only own rows");
    const ev = await me.get(`privacy_request_events?select=id,visible_to_customer&request_id=eq.${ids.access}`);
    expectOk(ev);
    assert.ok(ev.body.length >= 1 && ev.body.every((e) => e.visible_to_customer));
  });

  test("validation: one open request per type; corrections need detail", async () => {
    const me = asUser(sessions.customer);
    expectRule(await me.rpc("submit_privacy_request", { p_type: "access", p_note: `${RUN} again` }), /already have an open request/i);
    expectRule(await me.rpc("submit_privacy_request", { p_type: "correction", p_note: "short" }), /what is wrong/i);
  });

  test("cannot write the tables directly or act as staff", async () => {
    const me = asUser(sessions.customer);
    expectRefused(await me.insert("privacy_requests", { user_id: sessions.customer.userId, type: "deletion" }));
    expectRefused(await me.update(`privacy_requests?id=eq.${ids.access}`, { status: "fulfilled" }));
    expectRule(await me.rpc("privacy_request_action", { p_id: ids.access, p_action: "verify_identity", p_method: "ghana_card" }), /privacy officers/i);
    expectRule(await me.rpc("run_privacy_retention", { p_plan: [], p_dry_run: true }), /only the platform/i);
  });

  test("marketing opt-out takes effect immediately", async () => {
    const me = asUser(sessions.customer);
    const r = await me.rpc("submit_privacy_request", { p_type: "marketing_opt_out", p_note: `${RUN} opt-out` });
    expectOk(r);
    ids.optOut = r.body.id;
    assert.equal(r.body.status, "fulfilled");
    const c = await me.get(`consents?select=granted&user_id=eq.${sessions.customer.userId}&type=eq.marketing&order=created_at.desc&limit=1`);
    assert.equal(c.body[0]?.granted, false, "marketing consent withdrawn");
    const p = await me.get(`profiles?select=notification_prefs&id=eq.${sessions.customer.userId}`);
    assert.equal(p.body[0]?.notification_prefs?.marketing, false, "marketing preference off");
  });
});

describe("other people", () => {
  test("another signed-in person sees none of the customer's requests", async () => {
    const other = asUser(sessions.claims);
    const r = await other.get(`privacy_requests?select=id&user_id=eq.${sessions.customer.userId}`);
    emptyOrRefused(r, "privacy_requests");
    emptyOrRefused(await other.get(`privacy_request_events?select=id&request_id=eq.${ids.access}`), "privacy_request_events");
    expectRule(await other.rpc("withdraw_privacy_request", { p_id: ids.access }), /could not find/i);
  });

  test("a broker partner sees nothing and cannot act", async () => {
    const broker = asUser(sessions.broker);
    emptyOrRefused(await broker.get("privacy_requests?select=id&limit=5"), "privacy_requests");
    emptyOrRefused(await broker.get("privacy_retention_runs?select=id&limit=5"), "privacy_retention_runs");
    expectRule(await broker.rpc("privacy_request_action", { p_id: ids.access, p_action: "close" }), /privacy officers/i);
    expectRule(await broker.rpc("fulfil_privacy_deletion", { p_id: ids.access, p_dry_run: true }), /privacy officers/i);
  });
});

describe("platform staff", () => {
  test("see every request", async () => {
    const staff = asUser(sessions.admin);
    const r = await staff.get(`privacy_requests?select=id,user_id&id=eq.${ids.access}`);
    expectOk(r);
    assert.equal(r.body.length, 1);
  });

  test("workflow and transitions are enforced", async () => {
    const staff = asUser(sessions.admin);
    expectRule(await staff.rpc("record_privacy_export", { p_id: ids.access, p_path: `privacy-exports/${sessions.customer.userId}/x.json`, p_bytes: 10, p_sha256: "a".repeat(64) }), /verify/i);
    expectRule(await staff.rpc("privacy_request_action", { p_id: ids.access, p_action: "fulfil", p_reason: "done it" }), /completed by hand/i);
    expectOk(await staff.rpc("privacy_request_action", { p_id: ids.access, p_action: "verify_identity", p_method: "signed_in_session", p_reason: `${RUN} verified` }));
    expectRule(await staff.rpc("privacy_request_action", { p_id: ids.access, p_action: "verify_identity", p_method: "ghana_card" }), /not available/i);
    expectRule(
      await staff.rpc("record_privacy_export", { p_id: ids.access, p_path: `privacy-exports/${sessions.admin.userId}/x.json`, p_bytes: 10, p_sha256: "a".repeat(64) }),
      /privacy-exports\/<customer id>/,
    );
    expectRefused(await staff.update(`privacy_requests?id=eq.${ids.access}`, { status: "closed" }));
    expectRule(await staff.rpc("privacy_request_action", { p_id: ids.access, p_action: "refuse", p_reason: "no" }), /reason/i);
    const refused = await staff.rpc("privacy_request_action", { p_id: ids.access, p_action: "refuse", p_reason: `${RUN} test refusal` });
    expectOk(refused);
    assert.equal(refused.body.status, "refused");
    expectRule(await staff.rpc("privacy_request_action", { p_id: ids.access, p_action: "approve" }), /cannot move from refused to approved/i);
    expectOk(await staff.rpc("privacy_request_action", { p_id: ids.access, p_action: "close" }));
    const me = asUser(sessions.customer);
    const seen = await me.get(`privacy_requests?select=status,decision_reason&id=eq.${ids.access}`);
    assert.equal(seen.body[0].status, "closed");
    assert.match(seen.body[0].decision_reason, /test refusal/, "the customer sees the reason");
  });

  test("deletion: dry-run preview counts what would be erased and retained, and changes nothing", async () => {
    const me = asUser(sessions.customer);
    const d = await me.rpc("submit_privacy_request", { p_type: "deletion", p_note: `${RUN} deletion` });
    expectOk(d);
    ids.deletion = d.body.id;
    const staff = asUser(sessions.admin);
    expectRule(await staff.rpc("fulfil_privacy_deletion", { p_id: ids.deletion, p_dry_run: false }), /approve/i);
    const before = await me.get(`profiles?select=email,anonymised_at&id=eq.${sessions.customer.userId}`);
    const preview = await staff.rpc("fulfil_privacy_deletion", { p_id: ids.deletion, p_dry_run: true });
    expectOk(preview);
    assert.equal(preview.body.dry_run, true);
    assert.ok(preview.body.scrubbed && preview.body.retained, "summary has scrubbed + retained counts");
    assert.equal(typeof preview.body.retained.policies, "number");
    const afterPreview = await me.get(`profiles?select=email,anonymised_at&id=eq.${sessions.customer.userId}`);
    assert.deepEqual(afterPreview.body, before.body, "a dry run changes nothing");
    // Never anonymise the shared demo customer: withdraw instead.
    expectOk(await me.rpc("withdraw_privacy_request", { p_id: ids.deletion }));
    expectRule(await me.rpc("withdraw_privacy_request", { p_id: ids.deletion }), /no longer be withdrawn/i);
  });

  test("retention: staff may dry-run but not enforce; runs are logged", async () => {
    const staff = asUser(sessions.admin);
    const plan = [{ class: "unconverted_leads", cutoff: new Date(Date.now() - 730 * 86_400_000).toISOString() }];
    const r = await staff.rpc("run_privacy_retention", { p_plan: plan, p_dry_run: true, p_triggered_by: "staff" });
    expectOk(r);
    assert.equal(r.body.dry_run, true);
    assert.equal(typeof r.body.results.unconverted_leads.count, "number");
    expectRule(await staff.rpc("run_privacy_retention", { p_plan: plan, p_dry_run: false, p_triggered_by: "staff" }), /scheduled job/i);
    const runs = await staff.get(`privacy_retention_runs?select=id,dry_run&id=eq.${r.body.run_id}`);
    expectOk(runs);
    assert.equal(runs.body[0]?.dry_run, true);
  });

  test("the audit chain still verifies", async () => {
    const r = await asUser(sessions.admin).rpc("verify_audit_chain", { p_limit: 100000 });
    expectOk(r);
    assert.equal(r.body[0]?.ok, true, JSON.stringify(r.body));
  });
});

describe("service role (cron)", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
  test("a dry run reports per-class counts and refuses a too-recent cutoff", async () => {
    const svc = service();
    const r = await svc.rpc("run_privacy_retention", {
      p_plan: [
        { class: "ai_chat_logs", cutoff: new Date(Date.now() - 365 * 86_400_000).toISOString() },
        { class: "abandoned_drafts", cutoff: new Date(Date.now() - 2 * 86_400_000).toISOString() },
        { class: "no_such_class", cutoff: new Date(Date.now() - 365 * 86_400_000).toISOString() },
      ],
      p_dry_run: true,
      p_triggered_by: "manual",
    });
    expectOk(r);
    assert.equal(typeof r.body.results.ai_chat_logs.count, "number");
    assert.match(r.body.results.abandoned_drafts.error, /too recent/);
    assert.match(r.body.results.no_such_class.error, /Unknown retention data class/);
    assert.equal(r.body.ok, false);
  });
});
