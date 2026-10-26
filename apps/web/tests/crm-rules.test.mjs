// Partnerships CRM database rules (Addendum 3 D), exercised through Supabase Auth + PostgREST as each role.
// Run:  node --test apps/web/tests/crm-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Rows created here are tagged `E2E-CRM…` (purged by tests/purge-e2e-data.mjs). The CRM is staff-only:
// anonymous visitors, customers, brokers and insurers never see crm_* rows. A website lead of kind
// insurer/broker/enterprise automatically creates one account (idempotent). The parts that need the
// service role (notification fan-out to the partnerships team) run only when SUPABASE_SECRET_KEY is set.
import { before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, PUBLISHABLE_KEY, SUPABASE_URL, anon, asUser, hasServiceKey, service, signIn, stamp, uuid } from "./_lib/supabase.mjs";

const TAG = "E2E-CRM";
const RUN = `${TAG} ${stamp()}`;
const CRM_TABLES = ["crm_accounts", "crm_stage_events", "crm_notes", "crm_tasks", "crm_meetings", "crm_attachments"];

function expectRefused(r) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.ok(["42501", "P0001", "23503", "42P01"].includes(r.code) || r.status === 401 || r.status === 403, `expected RLS/guard rejection, got ${r.code}: ${r.message}`);
}
function expectRule(r, pattern) {
  assert.ok(r.status >= 400, `expected a rejection, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.code, "P0001", `expected trigger error P0001, got ${r.code}: ${r.message}`);
  assert.match(r.message ?? "", pattern);
}
function expectOk(r) {
  assert.ok(r.status < 300, `expected success, got ${r.status} ${JSON.stringify(r.body)}`);
}
/** Reads must come back empty (RLS) or be refused outright. */
function expectHidden(r, label) {
  assert.ok(r.status === 200 ? r.body.length === 0 : r.status >= 400, `${label}: ${r.status} ${JSON.stringify(r.body)}`);
}

/** Website forms insert leads anonymously without reading them back (no select policy for anon). */
async function submitLead(row) {
  const id = uuid();
  const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
    method: "POST",
    headers: { apikey: PUBLISHABLE_KEY, authorization: `Bearer ${PUBLISHABLE_KEY}`, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({ id, status: "new", ...row }),
  });
  assert.ok(res.status < 300, `lead insert failed: ${res.status} ${await res.text()}`);
  return id;
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
  test("cannot read or write any CRM table, nor the pipeline view", async () => {
    const pub = anon();
    for (const table of CRM_TABLES) expectHidden(await pub.get(`${table}?select=id&limit=1`), table);
    expectHidden(await pub.get("crm_pipeline_summary?select=metric&limit=1"), "crm_pipeline_summary");
    expectRefused(await pub.insert("crm_accounts", { kind: "insurer", name: `${RUN} forged` }));
    expectRefused(await pub.rpc("crm_lead_to_account", { p_lead_id: uuid() }));
  });
});

// ---------------------------------------------------------------------------
describe("customers, brokers and insurers", () => {
  for (const who of ["customer", "broker", "underwriter"]) {
    test(`${who} sees no CRM rows and cannot write them`, async () => {
      const db = asUser(sessions[who]);
      for (const table of CRM_TABLES) expectHidden(await db.get(`${table}?select=id&limit=5`), `${who} ${table}`);
      expectHidden(await db.get("crm_pipeline_summary?select=metric,key,count"), `${who} crm_pipeline_summary`);
      expectRefused(await db.insert("crm_accounts", { kind: "broker", name: `${RUN} forged by ${who}` }));
      expectRefused(await db.insert("crm_tasks", { account_id: uuid(), title: `${RUN} forged` }));
      expectRule(await db.rpc("crm_lead_to_account", { p_lead_id: uuid() }), /platform staff/i);
      expectRule(await db.rpc("crm_move_stage", { p_account_id: uuid(), p_to_stage: "contacted" }), /partnerships team/i);
    });
  }
});

// ---------------------------------------------------------------------------
describe("website leads feed the pipeline", () => {
  let leadId;
  let accountId;

  test("an insurer lead from the website creates exactly one account at stage lead", async () => {
    leadId = await submitLead({ kind: "insurer", name: `${RUN} Ama Mensah`, email: `crm-${stamp()}@example.com`, organization: `${RUN} Insurer Ltd`, message: `${RUN} We would like to list our motor products.`, source_page: "/partners/insurers" });
    const admin = asUser(sessions.admin);
    const r = await admin.get(`crm_accounts?select=id,kind,name,stage,source,lead_id,contact,owner_user_id&lead_id=eq.${leadId}`);
    expectOk(r);
    assert.equal(r.body.length, 1, "one account per lead");
    const acc = r.body[0];
    accountId = acc.id;
    assert.equal(acc.kind, "insurer");
    assert.equal(acc.stage, "lead");
    assert.equal(acc.source, "website_form");
    assert.equal(acc.name, `${RUN} Insurer Ltd`);
    assert.equal(acc.contact.name, `${RUN} Ama Mensah`);
    assert.equal(acc.owner_user_id, null, "no rep yet");
    const notes = await admin.get(`crm_notes?select=body,pinned&account_id=eq.${accountId}`);
    expectOk(notes);
    assert.equal(notes.body.length, 1, "the lead message becomes a pinned note");
    assert.equal(notes.body[0].pinned, true);
    const events = await admin.get(`crm_stage_events?select=from_stage,to_stage&account_id=eq.${accountId}`);
    expectOk(events);
    assert.deepEqual(events.body, [{ from_stage: null, to_stage: "lead" }]);
  });

  test("converting the same lead again is idempotent (RPC returns the existing account)", async () => {
    const admin = asUser(sessions.admin);
    const r = await admin.rpc("crm_lead_to_account", { p_lead_id: leadId });
    expectOk(r);
    assert.equal(r.body, accountId);
    const count = await admin.get(`crm_accounts?select=id&lead_id=eq.${leadId}`);
    assert.equal(count.body.length, 1);
  });

  test("a broker 'suggest an insurer' lead is tagged broker_suggestion; customer leads are skipped", async () => {
    const admin = asUser(sessions.admin);
    const suggested = await submitLead({ kind: "insurer", name: `${RUN} Broker contact`, organization: `${RUN} Suggested Insurer`, message: `${RUN} pending rate table`, source_page: "broker_suggestion", utm: { source: "broker_suggestion" } });
    const r = await admin.get(`crm_accounts?select=source,kind&lead_id=eq.${suggested}`);
    expectOk(r);
    assert.deepEqual(r.body, [{ source: "broker_suggestion", kind: "insurer" }]);

    const group = await submitLead({ kind: "enterprise", name: `${RUN} HR lead`, organization: `${RUN} Employer`, message: `${RUN} group scheme`, source_page: "/partners/employers", utm: { tags: ["group"] } });
    const g = await admin.get(`crm_accounts?select=kind&lead_id=eq.${group}`);
    assert.deepEqual(g.body, [{ kind: "group" }], "enterprise + group tag → group account");

    const customer = await submitLead({ kind: "customer", name: `${RUN} Customer`, message: `${RUN} quote please` });
    const c = await admin.get(`crm_accounts?select=id&lead_id=eq.${customer}`);
    expectOk(c);
    assert.equal(c.body.length, 0, "customer leads are not partnership prospects");
    const viaRpc = await admin.rpc("crm_lead_to_account", { p_lead_id: customer });
    expectOk(viaRpc);
    assert.equal(viaRpc.body, null);
  });

  test("staff move the account one stage with a note; 'live' needs an organisation; 'lost' needs a reason", async () => {
    const admin = asUser(sessions.admin);
    const moved = await admin.rpc("crm_move_stage", { p_account_id: accountId, p_to_stage: "contacted", p_note: `${RUN} called the CEO` });
    expectOk(moved);
    assert.equal(moved.body.stage, "contacted");
    const events = await admin.get(`crm_stage_events?select=from_stage,to_stage,note&account_id=eq.${accountId}&to_stage=eq.contacted`);
    assert.deepEqual(events.body, [{ from_stage: "lead", to_stage: "contacted", note: `${RUN} called the CEO` }]);

    expectRule(await admin.update(`crm_accounts?id=eq.${accountId}`, { stage: "live" }), /linked to an organisation/);
    expectRule(await admin.update(`crm_accounts?id=eq.${accountId}`, { stage: "lost", lost_reason: null }), /reason/i);

    const task = await admin.insert("crm_tasks", { account_id: accountId, title: `${RUN} send deck`, due_at: new Date().toISOString(), assignee_id: sessions.admin.userId });
    expectOk(task);
    const summary = await admin.get("crm_pipeline_summary?select=metric,key,count&metric=eq.stage&key=eq.contacted");
    expectOk(summary);
    assert.ok(summary.body.length === 1 && Number(summary.body[0].count) >= 1, "pipeline view counts the account");
  });

  test("the other roles still cannot see the account that now exists", async () => {
    for (const who of ["customer", "broker", "underwriter"]) {
      const r = await asUser(sessions[who]).get(`crm_accounts?select=id&id=eq.${accountId}`);
      expectHidden(r, `${who} crm_accounts by id`);
    }
  });

  describe("privileged checks (service role)", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
    test("the partnerships team (or platform admins) were notified in-app when the lead landed", async () => {
      const svc = service();
      const r = await svc.get(`notifications?select=user_id,kind,link&kind=eq.crm.account.created&data->>lead_id=eq.${leadId}`);
      expectOk(r);
      assert.ok(r.body.length >= 1, "at least one recipient");
      assert.ok(r.body.every((n) => n.link === `/partners/crm/${accountId}`));
    });
  });
});
