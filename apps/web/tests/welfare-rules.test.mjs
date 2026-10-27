// Funeral cover & welfare group database rules (Roadmap Phase 4): groups, members (consent), beneficiaries, sponsors
// abroad, contributions and the claims link — exercised through Supabase Auth + PostgREST as each role.
// Run:  node --test apps/web/tests/welfare-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Rows are tagged `E2E-WELFARE…` and never deleted (the service role has no DELETE on these tables): each run's group
// is cancelled at the end, its members marked left and sponsorships ended. The placement block (broker of record /
// contributions settled by a payment) needs SUPABASE_SECRET_KEY and is skipped without it.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, hasServiceKey, service, signIn, stamp } from "./_lib/supabase.mjs";

const TAG = "E2E-WELFARE";
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

const sessions = {};
const ids = {};

before(async () => {
  sessions.admin = await signIn(ACCOUNTS.customer);
  sessions.other = await signIn(ACCOUNTS.adviser); // a different signed-in person: not on the group, not a sponsor
  sessions.sponsor = await signIn(ACCOUNTS.claims); // stands in for a relative abroad (any account not on the group)
  sessions.broker = await signIn(ACCOUNTS.brokerSupervisor);
  sessions.underwriter = await signIn(ACCOUNTS.underwriter);
  const pub = anon();
  const orgs = (await pub.get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  assert.ok(ids.broker && ids.insurer, "seed data (demo broker, an insurer) must exist");
});

after(async () => {
  if (!ids.group) return;
  const admin = asUser(sessions.admin);
  await admin.update(`welfare_sponsors?group_id=eq.${ids.group}&status=neq.ended`, { status: "ended" });
  await admin.update(`welfare_members?group_id=eq.${ids.group}&user_id=is.null`, { status: "left" });
  await admin.update(`welfare_groups?id=eq.${ids.group}`, { status: "cancelled", invite_enabled: false });
});

describe("anonymous visitors", () => {
  test("see nothing and cannot create or join groups", async () => {
    const pub = anon();
    for (const t of ["welfare_groups", "welfare_members", "welfare_beneficiaries", "welfare_sponsors", "welfare_contributions"]) {
      emptyOrRefused(await pub.get(`${t}?select=id&limit=1`), t);
    }
    const rpc = await pub.rpc("create_welfare_group", { p_name: `${RUN} anon` });
    assert.ok(rpc.status >= 400, `expected rejection, got ${rpc.status}`);
    const join = await pub.rpc("join_welfare_group", { p_token: "nope", p_full_name: "Anon", p_consent: true });
    assert.ok(join.status >= 400, `expected rejection, got ${join.status}`);
  });
});

describe("group admin", () => {
  let db;
  before(() => {
    db = asUser(sessions.admin);
  });

  test("creates a group through the RPC: draft, no placement, admin is the first consenting member", async () => {
    const r = await db.rpc("create_welfare_group", { p_name: `${RUN} Union`, p_kind: "hometown_union", p_contribution_amount: 50, p_cadence: "monthly", p_contribution_day: 5, p_region: "Eastern" });
    expectOk(r);
    ids.group = r.body;
    const g = await db.get(`welfare_groups?select=id,status,broker_org_id,insurer_org_id,policy_id,member_count,invite_token,admin_user_id&id=eq.${ids.group}`);
    expectOk(g);
    assert.equal(g.body[0].status, "draft");
    assert.equal(g.body[0].broker_org_id, null);
    assert.equal(g.body[0].policy_id, null);
    assert.equal(g.body[0].member_count, 1);
    assert.equal(g.body[0].admin_user_id, sessions.admin.userId);
    ids.token = g.body[0].invite_token;
    const me = await db.get(`welfare_members?select=id,role,status,consent_at&group_id=eq.${ids.group}&user_id=eq.${sessions.admin.userId}`);
    assert.equal(me.body[0]?.role, "admin");
    assert.equal(me.body[0]?.status, "active");
    assert.ok(me.body[0]?.consent_at, "the creator's consent is recorded");
  });

  test("direct inserts are forced to draft with no broker; the RPC validates its inputs", async () => {
    const g = await db.insert("welfare_groups", { name: `${RUN} direct`, admin_user_id: sessions.admin.userId, status: "active", broker_org_id: ids.broker });
    expectOk(g);
    assert.equal(g.body[0].status, "draft");
    assert.equal(g.body[0].broker_org_id, null);
    await db.update(`welfare_groups?id=eq.${g.body[0].id}`, { status: "cancelled" });
    expectRule(await db.rpc("create_welfare_group", { p_name: "x" }), /2–160/);
    expectRule(await db.rpc("create_welfare_group", { p_name: `${RUN} bad day`, p_contribution_day: 31 }), /between 1 and 28/);
  });

  test("adds members: invited by default, active only with attested consent, one phone per group", async () => {
    const a = await db.insert("welfare_members", { group_id: ids.group, full_name: `${RUN} Ama`, phone: "0240000701", status: "invited" });
    expectOk(a);
    ids.ama = a.body[0].id;
    assert.equal(a.body[0].user_id, null, "accounts are linked by the member, never set by the admin");
    assert.equal(a.body[0].consent_at, null);
    expectRule(await db.insert("welfare_members", { group_id: ids.group, full_name: `${RUN} NoConsent`, phone: "0240000702", status: "active" }), /agreed to be enrolled/i);
    const k = await db.insert("welfare_members", { group_id: ids.group, full_name: `${RUN} Kwame`, phone: "0240000703", status: "active", consent_attested_by: sessions.admin.userId });
    expectOk(k);
    ids.kwame = k.body[0].id;
    assert.equal(k.body[0].status, "active");
    expectRule(await db.insert("welfare_members", { group_id: ids.group, full_name: `${RUN} Dup`, phone: "+233240000703" }), /already uses this phone/i);
    const g = await db.get(`welfare_groups?select=member_count&id=eq.${ids.group}`);
    assert.equal(g.body[0].member_count, 3, "member_count follows enrolment");
  });

  test("guards: no forged consent or account links; placement fields are the platform's; only cancel", async () => {
    expectRule(await db.update(`welfare_members?id=eq.${ids.ama}`, { user_id: sessions.other.userId }), /same phone/i);
    expectRule(await db.update(`welfare_members?id=eq.${ids.ama}`, { consent_at: new Date().toISOString() }), /recorded by the member/i);
    expectRule(await db.update(`welfare_groups?id=eq.${ids.group}`, { broker_org_id: ids.broker }), /broker of record/i);
    expectRule(await db.update(`welfare_groups?id=eq.${ids.group}`, { insurer_org_id: ids.insurer }), /recorded when the cover is placed/i);
    expectRule(await db.update(`welfare_groups?id=eq.${ids.group}`, { status: "active" }), /only be cancelled/i);
    const plan = await db.update(`welfare_groups?id=eq.${ids.group}`, { contribution_amount: 60, rules: "Funeral grant GH₵ 5,000 after 6 months" });
    expectOk(plan);
    assert.equal(Number(plan.body[0].contribution_amount), 60);
  });

  test("records beneficiaries and invites a sponsor abroad (pending until accepted)", async () => {
    const b = await db.insert("welfare_beneficiaries", { group_id: ids.group, member_id: ids.kwame, full_name: `${RUN} Adwoa`, relationship: "spouse", phone: "0240000704" });
    expectOk(b);
    ids.beneficiary = b.body[0].id;
    assert.equal(b.body[0].user_id, null);
    expectRefused(await db.insert("welfare_beneficiaries", { group_id: ids.group, member_id: ids.kwame, full_name: `${RUN} Wrong`, relationship: "child", share_pct: 150 }));
    const s = await db.insert("welfare_sponsors", { group_id: ids.group, member_id: ids.kwame, sponsor_name: `${RUN} Nana`, sponsor_email: `e2e-welfare-${Date.now()}@example.com`, display_currency: "GBP", status: "active", sponsor_user_id: sessions.sponsor.userId });
    expectOk(s);
    ids.sponsor = s.body[0].id;
    ids.sponsorToken = s.body[0].invite_token;
    assert.equal(s.body[0].status, "invited", "a sponsorship is active only once the sponsor accepts");
    assert.equal(s.body[0].sponsor_user_id, null);
    expectRule(await db.update(`welfare_sponsors?id=eq.${ids.sponsor}`, { status: "active" }), /sponsor accepts/i);
  });

  test("contributions are generated by the RPC, never written directly, and the admin can waive one", async () => {
    // No policy yet: generation still works (schedule), payment does not (server-side rule).
    const n = await db.rpc("generate_welfare_contributions", { p_group_id: ids.group });
    expectOk(n);
    assert.ok(n.body >= 2, `expected rows for the active members, got ${n.body}`);
    const again = await db.rpc("generate_welfare_contributions", { p_group_id: ids.group });
    assert.equal(again.body, 0, "idempotent");
    const list = await db.get(`welfare_contributions?select=id,member_id,status,amount,due_at&group_id=eq.${ids.group}`);
    expectOk(list);
    assert.ok(list.body.every((c) => c.status === "due" && Number(c.amount) === 60));
    ids.contribution = list.body.find((c) => c.member_id === ids.kwame)?.id;
    assert.ok(ids.contribution);
    expectRefused(await db.update(`welfare_contributions?id=eq.${ids.contribution}`, { status: "paid" }));
    expectRefused(await db.insert("welfare_contributions", { group_id: ids.group, member_id: ids.kwame, period_start: "2030-01-01", due_at: "2030-01-05", amount: 1 }));
    const w = await db.rpc("waive_welfare_contribution", { p_contribution_id: ids.contribution, p_note: "Bereaved" });
    expectOk(w);
    const waived = await db.get(`welfare_contributions?select=status,note&id=eq.${ids.contribution}`);
    assert.equal(waived.body[0].status, "waived");
    expectRule(await db.rpc("waive_welfare_contribution", { p_contribution_id: ids.contribution }), /due or failed/i);
  });

  test("link_my_welfare_memberships is callable (nothing to link for the admin)", async () => {
    const r = await db.rpc("link_my_welfare_memberships", {});
    expectOk(r);
    assert.equal(typeof r.body, "number");
  });
});

describe("a different signed-in person", () => {
  test("sees nothing of the group and cannot add members, request cover or generate contributions", async () => {
    const db = asUser(sessions.other);
    for (const t of ["welfare_groups?select=id&id=eq." + ids.group, "welfare_members?select=id&group_id=eq." + ids.group, "welfare_beneficiaries?select=id&group_id=eq." + ids.group, "welfare_sponsors?select=id&group_id=eq." + ids.group, "welfare_contributions?select=id&group_id=eq." + ids.group]) {
      const r = await db.get(t);
      expectOk(r);
      assert.equal(r.body.length, 0, `${t} is hidden`);
    }
    expectRefused(await db.insert("welfare_members", { group_id: ids.group, full_name: `${RUN} intruder` }));
    expectRefused(await db.insert("welfare_beneficiaries", { group_id: ids.group, member_id: ids.kwame, full_name: `${RUN} intruder` }));
    expectRule(await db.rpc("generate_welfare_contributions", { p_group_id: ids.group }), /group admin/i);
    expectRule(await db.rpc("join_welfare_group", { p_token: ids.token, p_full_name: `${RUN} Other`, p_consent: false }), /agree/i);
    expectRule(await db.rpc("join_welfare_group", { p_token: "not-a-token", p_full_name: `${RUN} Other`, p_consent: true }), /not valid/i);
  });

  test("joins with the invitation link (consent captured) and then sees only the group and their own row", async () => {
    const db = asUser(sessions.other);
    const r = await db.rpc("join_welfare_group", { p_token: ids.token, p_full_name: `${RUN} Other`, p_phone: "0240000705", p_consent: true });
    expectOk(r);
    ids.otherMember = r.body;
    const me = await db.get(`welfare_members?select=id,status,consent_at,consent_channel,user_id&group_id=eq.${ids.group}`);
    expectOk(me);
    assert.equal(me.body.length, 1, "a member sees only their own member row");
    assert.equal(me.body[0].status, "pending", "self-joined members await the admin's approval");
    assert.equal(me.body[0].consent_channel, "link");
    assert.ok(me.body[0].consent_at);
    const g = await db.get(`welfare_groups?select=id&id=eq.${ids.group}`);
    assert.equal(g.body.length, 1, "a member sees the group");
    const b = await db.get(`welfare_beneficiaries?select=id&group_id=eq.${ids.group}`);
    assert.equal(b.body.length, 0, "other members' beneficiaries are hidden");
    // Own row: contact details yes, role no.
    const upd = await db.update(`welfare_members?id=eq.${ids.otherMember}`, { role: "admin", phone: "0240000706" });
    expectOk(upd);
    assert.equal(upd.body[0].role, "member");
    assert.equal(upd.body[0].phone, "0240000706");
    // Cannot edit the group (RLS: zero rows).
    const h = await db.update(`welfare_groups?id=eq.${ids.group}`, { name: `${RUN} hijack` });
    assert.ok(h.status >= 400 || h.body.length === 0);
    // Can add their own beneficiary.
    expectOk(await db.insert("welfare_beneficiaries", { group_id: ids.group, member_id: ids.otherMember, full_name: `${RUN} Kid`, relationship: "child" }));
  });

  test("the admin approves the pending member; a member who leaves is not re-activated", async () => {
    const admin = asUser(sessions.admin);
    const ok = await admin.update(`welfare_members?id=eq.${ids.otherMember}`, { status: "active" });
    expectOk(ok);
    assert.equal(ok.body[0].status, "active");
    const left = await asUser(sessions.other).update(`welfare_members?id=eq.${ids.otherMember}`, { status: "left" });
    expectOk(left);
    assert.ok(left.body[0].left_at);
    expectRule(await admin.update(`welfare_members?id=eq.${ids.otherMember}`, { status: "active" }), /enrolled again/i);
    const gone = await asUser(sessions.other).get(`welfare_groups?select=id&id=eq.${ids.group}`);
    assert.equal(gone.body.length, 0, "after leaving, the group is hidden again");
  });
});

describe("sponsor abroad", () => {
  test("sees nothing before accepting; after accepting sees only the sponsored member and their contributions", async () => {
    const db = asUser(sessions.sponsor);
    const before = await db.get(`welfare_groups?select=id&id=eq.${ids.group}`);
    assert.equal(before.body.length, 0);
    expectRule(await db.rpc("accept_welfare_sponsorship", { p_token: "nope" }), /not valid/i);
    const acc = await db.rpc("accept_welfare_sponsorship", { p_token: ids.sponsorToken, p_display_currency: "GBP" });
    expectOk(acc);
    const s = await db.get(`welfare_sponsors?select=id,status,sponsor_user_id,display_currency&id=eq.${ids.sponsor}`);
    assert.equal(s.body[0]?.status, "active");
    assert.equal(s.body[0]?.sponsor_user_id, sessions.sponsor.userId);
    assert.equal(s.body[0]?.display_currency, "GBP");
    const g = await db.get(`welfare_groups?select=id&id=eq.${ids.group}`);
    assert.equal(g.body.length, 1, "a sponsor sees the group");
    const m = await db.get(`welfare_members?select=id&group_id=eq.${ids.group}`);
    assert.deepEqual(m.body.map((x) => x.id), [ids.kwame], "a sponsor sees only the member they pay for");
    const c = await db.get(`welfare_contributions?select=id,member_id&group_id=eq.${ids.group}`);
    assert.ok(c.body.length >= 1 && c.body.every((x) => x.member_id === ids.kwame), "only the sponsored member's contributions");
    const b = await db.get(`welfare_beneficiaries?select=id&group_id=eq.${ids.group}`);
    assert.equal(b.body.length, 0, "beneficiaries stay private");
    expectRefused(await db.insert("welfare_members", { group_id: ids.group, full_name: `${RUN} intruder` }));
    expectRefused(await db.update(`welfare_contributions?member_id=eq.${ids.kwame}`, { status: "paid" }));
  });

  test("can end the sponsorship, after which the group is hidden again", async () => {
    const db = asUser(sessions.sponsor);
    const e = await db.update(`welfare_sponsors?id=eq.${ids.sponsor}`, { status: "ended" });
    expectOk(e);
    assert.ok(e.body[0].ended_at);
    const g = await db.get(`welfare_groups?select=id&id=eq.${ids.group}`);
    assert.equal(g.body.length, 0);
  });
});

describe("partners not on the group", () => {
  test("a broker and an insurer without the group see nothing", async () => {
    for (const s of [sessions.broker, sessions.underwriter]) {
      const g = await asUser(s).get(`welfare_groups?select=id&id=eq.${ids.group}`);
      expectOk(g);
      assert.equal(g.body.length, 0);
      const m = await asUser(s).get(`welfare_members?select=id&group_id=eq.${ids.group}`);
      assert.equal(m.body.length, 0);
    }
  });
});

describe("placement and settlement (privileged setup)", { skip: !hasServiceKey() && "SUPABASE_SECRET_KEY not set" }, () => {
  test("the broker of record sees the group, members and contributions but not sponsor contacts, and cannot add members", async () => {
    const svc = service();
    expectOk(await svc.update(`welfare_groups?id=eq.${ids.group}`, { broker_org_id: ids.broker, status: "quoting" }));
    const broker = asUser(sessions.broker);
    const g = await broker.get(`welfare_groups?select=id,status&id=eq.${ids.group}`);
    expectOk(g);
    assert.equal(g.body[0]?.status, "quoting");
    const m = await broker.get(`welfare_members?select=id,full_name,date_of_birth&group_id=eq.${ids.group}`);
    assert.ok(m.body.length >= 3, "the broker of record sees the member list for placement");
    const c = await broker.get(`welfare_contributions?select=id&group_id=eq.${ids.group}`);
    assert.ok(c.body.length >= 1);
    const s = await broker.get(`welfare_sponsors?select=id&group_id=eq.${ids.group}`);
    assert.equal(s.body.length, 0, "sponsor contact rows are not for the broker");
    expectRefused(await broker.insert("welfare_members", { group_id: ids.group, full_name: `${RUN} broker-added` }));
    // Broker: status / renewal only; a rename is silently kept as it was; the insurer is placement.
    const r = await broker.update(`welfare_groups?id=eq.${ids.group}`, { name: `${RUN} renamed by broker`, renewal_date: "2027-12-31" });
    expectOk(r);
    assert.equal(r.body[0].name, `${RUN} Union`);
    assert.equal(r.body[0].renewal_date, "2027-12-31");
    expectRule(await broker.update(`welfare_groups?id=eq.${ids.group}`, { insurer_org_id: ids.insurer }), /recorded when the cover is placed/i);
    const u = await asUser(sessions.underwriter).get(`welfare_members?select=id&group_id=eq.${ids.group}`);
    assert.equal(u.body.length, 0, "an insurer not on the group sees nothing");
  });

  test("a paid contribution needs the payment that settled it and is then final", async () => {
    const svc = service();
    const due = (await svc.get(`welfare_contributions?select=id&group_id=eq.${ids.group}&status=eq.due&limit=1`)).body[0];
    assert.ok(due, "a due contribution");
    expectRule(await svc.update(`welfare_contributions?id=eq.${due.id}`, { status: "paid", paid_via: "sponsor" }), /needs the payment/i);
    expectRule(await svc.update(`welfare_contributions?id=eq.${due.id}`, { member_id: ids.ama }), /cannot move/i);
    // Re-open the waived one as due (allowed), then confirm a paid one cannot change (needs a payment row — covered
    // in the local Postgres proof; here we only assert the guard messages that need no payment).
    expectOk(await svc.update(`welfare_contributions?id=eq.${ids.contribution}`, { status: "due" }));
  });
});
