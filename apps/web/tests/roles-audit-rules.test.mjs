// Audit coverage of team role changes (Roadmap Phase 1, migration 20261101100000): invitations, revokes,
// membership changes and MFA enrolment/removal write who/what/when to the hash-chained audit log, the
// partner activity view exposes a safe `detail` (never the invitation token), and only the organisation's
// owners/admins/supervisors (and platform staff) can read it — exercised through Supabase Auth + PostgREST.
// Run:  node --test apps/web/tests/roles-audit-rules.test.mjs   (or `pnpm --filter @im/web test:db`)
//
// Rows are tagged `E2E-ROLES…` (invitation emails, team names). The membership edit changes the demo
// adviser's `team` (not their role, which other suites rely on) and restores it. Acceptance is covered by
// the invitation RPC tests in db-rules; here we assert the audit rows it leaves behind are readable.
import { after, before, describe, test } from "node:test";
import assert from "node:assert/strict";
import { ACCOUNTS, anon, asUser, signIn, stamp } from "./_lib/supabase.mjs";

const TAG = "E2E-ROLES";
const RUN = `${TAG} ${stamp()}`;
const INVITE_EMAIL = `${TAG.toLowerCase()}-${stamp()}@example.com`;

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
  sessions.supervisor = await signIn(ACCOUNTS.brokerSupervisor); // owner/supervisor of the demo broker
  sessions.adviser = await signIn(ACCOUNTS.adviser); // broker member without audit visibility
  sessions.underwriter = await signIn(ACCOUNTS.underwriter); // insurer member
  sessions.customer = await signIn(ACCOUNTS.customer);
  sessions.admin = await signIn(ACCOUNTS.admin);
  const pub = anon();
  const orgs = (await pub.get("organizations?select=id,slug,type&status=eq.active")).body;
  ids.broker = orgs.find((o) => o.slug === "demo-broker")?.id ?? orgs.find((o) => o.type === "broker")?.id;
  ids.insurer = orgs.find((o) => o.slug === "coastline-general")?.id ?? orgs.find((o) => o.type === "insurer")?.id;
  assert.ok(ids.broker && ids.insurer, "seed data (demo broker, an insurer) must exist");
  const me = asUser(sessions.supervisor);
  const mine = await me.get(`memberships?select=role&org_id=eq.${ids.broker}&user_id=eq.${sessions.supervisor.userId}`);
  ids.supervisorCanAudit = ["owner", "admin", "supervisor"].includes(mine.body?.[0]?.role);
  const adviser = await me.get(`memberships?select=id,team&org_id=eq.${ids.broker}&user_id=eq.${sessions.adviser.userId}`);
  ids.adviserMembership = adviser.body?.[0]?.id ?? null;
  ids.adviserTeam = adviser.body?.[0]?.team ?? null;
});

after(async () => {
  const db = asUser(sessions.supervisor);
  if (ids.invitation) await db.delete(`invitations?id=eq.${ids.invitation}`);
  if (ids.adviserMembership && ids.teamChanged) await db.update(`memberships?id=eq.${ids.adviserMembership}`, { team: ids.adviserTeam });
});

describe("anonymous visitors", () => {
  test("see no activity and cannot record an MFA change", async () => {
    const pub = anon();
    emptyOrRefused(await pub.get("partner_activity?select=id&limit=1"), "partner_activity");
    emptyOrRefused(await pub.get("audit_events?select=id&limit=1"), "audit_events");
    assert.ok((await pub.rpc("record_mfa_change", { p_org_id: null })).status >= 400, "anon cannot call record_mfa_change");
  });
});

describe("invitations", () => {
  test("inviting writes an audit row the organisation's leads can read, without the token", async (t) => {
    if (!ids.supervisorCanAudit) return t.skip("the demo broker supervisor is not owner/admin/supervisor");
    const db = asUser(sessions.supervisor);
    const inv = await db.insert("invitations", { org_id: ids.broker, email: INVITE_EMAIL, role: "adviser", team: RUN, invited_by: sessions.supervisor.userId }, { select: "id" });
    expectOk(inv);
    ids.invitation = inv.body[0].id;
    const act = await db.get(`partner_activity?select=id,action,entity_type,entity_id,actor_id,detail,subject_user_id&entity_type=eq.invitations&entity_id=eq.${ids.invitation}&order=id.desc`);
    expectOk(act);
    const row = act.body.find((r) => r.action === "insert");
    assert.ok(row, "the invitation insert is in the activity log");
    assert.equal(row.actor_id, sessions.supervisor.userId, "attributed to the inviter");
    assert.equal(row.detail?.email, INVITE_EMAIL);
    assert.equal(row.detail?.role, "adviser");
    assert.equal(row.detail?.token, undefined, "the view never exposes the token");
    // Staff see the raw payload: the snapshot itself must not carry the token either.
    const raw = await asUser(sessions.admin).get(`audit_events?select=data&entity_type=eq.invitations&entity_id=eq.${ids.invitation}&action=eq.insert`);
    expectOk(raw);
    assert.equal(raw.body.length, 1);
    assert.equal(raw.body[0].data?.row?.token, undefined, "audit snapshot strips the invitation token");
    assert.equal(raw.body[0].data?.row?.email, INVITE_EMAIL);
  });

  test("revoking an invitation is audited as a delete", async (t) => {
    if (!ids.invitation) return t.skip("no invitation");
    const db = asUser(sessions.supervisor);
    expectOk(await db.delete(`invitations?id=eq.${ids.invitation}`));
    const act = await db.get(`partner_activity?select=action,detail&entity_type=eq.invitations&entity_id=eq.${ids.invitation}&action=eq.delete`);
    expectOk(act);
    assert.equal(act.body.length, 1, "revoke audited");
    assert.equal(act.body[0].detail?.email, INVITE_EMAIL);
    ids.invitation = null;
  });
});

describe("membership changes", () => {
  test("a change by an admin shows the member it is about and the field that changed", async (t) => {
    if (!ids.supervisorCanAudit || !ids.adviserMembership) return t.skip("no adviser membership to edit");
    const db = asUser(sessions.supervisor);
    expectOk(await db.update(`memberships?id=eq.${ids.adviserMembership}`, { team: RUN }));
    ids.teamChanged = true;
    const act = await db.get(`partner_activity?select=action,changed_fields,subject_user_id,detail,actor_id&entity_type=eq.memberships&entity_id=eq.${ids.adviserMembership}&order=id.desc&limit=1`);
    expectOk(act);
    const row = act.body[0];
    assert.equal(row?.action, "update");
    assert.ok((row?.changed_fields ?? []).includes("team"));
    assert.equal(row?.subject_user_id, sessions.adviser.userId, "the row is about the adviser");
    assert.equal(row?.actor_id, sessions.supervisor.userId, "and made by the supervisor");
    assert.equal(row?.detail?.team?.to, RUN, "detail carries the whitelisted team change");
    assert.equal(row?.detail?.role, undefined, "fields that did not change are not in detail");
    expectOk(await db.update(`memberships?id=eq.${ids.adviserMembership}`, { team: ids.adviserTeam }));
    ids.teamChanged = false;
  });

  test("a member without a lead role sees none of it, and a customer sees nothing", async () => {
    const adviser = await asUser(sessions.adviser).get(`partner_activity?select=id&org_id=eq.${ids.broker}&limit=5`);
    expectOk(adviser);
    assert.equal(adviser.body.length, 0, "advisers cannot read the organisation's audit trail");
    const customer = await asUser(sessions.customer).get(`partner_activity?select=id,org_id&limit=20`);
    expectOk(customer);
    assert.ok(customer.body.every((r) => r.org_id !== ids.broker && r.org_id !== ids.insurer), "a customer never sees partner organisations' activity");
    const other = await asUser(sessions.underwriter).get(`partner_activity?select=id&org_id=eq.${ids.broker}&limit=5`);
    expectOk(other);
    assert.equal(other.body.length, 0, "another organisation sees nothing");
  });
});

describe("two-step verification", () => {
  test("record_mfa_change reads the real factor state: a no-op when nothing changed, never self-reported", async () => {
    const r = await asUser(sessions.underwriter).rpc("record_mfa_change", { p_org_id: ids.insurer });
    expectOk(r);
    assert.equal(typeof r.body.verified_factors, "number");
    assert.equal(typeof r.body.changed, "boolean");
    const again = await asUser(sessions.underwriter).rpc("record_mfa_change", { p_org_id: ids.insurer });
    expectOk(again);
    assert.equal(again.body.changed, false, "the second call in a row records nothing");
    // The org id is only attributed when the caller belongs to it: a customer naming the broker org leaves it null.
    const c = await asUser(sessions.customer).rpc("record_mfa_change", { p_org_id: ids.broker });
    expectOk(c);
    const leaked = await asUser(sessions.supervisor).get(`partner_activity?select=id&entity_type=eq.mfa&org_id=eq.${ids.broker}&actor_id=eq.${sessions.customer.userId}`);
    expectOk(leaked);
    assert.equal(leaked.body.length, 0, "no MFA row is attributed to an organisation the caller is not a member of");
  });

  test("staff can filter the audit log by the mfa entity and the named actions", async () => {
    const db = asUser(sessions.admin);
    const rows = await db.get("audit_events?select=id,action,entity_type,entity_id,data&entity_type=eq.mfa&order=id.desc&limit=5");
    expectOk(rows);
    for (const r of rows.body) {
      assert.ok(["mfa.enrolled", "mfa.removed"].includes(r.action), `named action, got ${r.action}`);
      assert.equal(typeof r.data?.verified_factors, "number");
      assert.equal(r.data?.secret, undefined, "no secrets in the audit log");
    }
  });

  test("nobody can edit or delete audit rows, including staff", async () => {
    const db = asUser(sessions.admin);
    const any = await db.get("audit_events?select=id&order=id.desc&limit=1");
    expectOk(any);
    if (!any.body.length) return;
    expectRefused(await db.update(`audit_events?id=eq.${any.body[0].id}`, { action: "update" }));
    expectRefused(await db.delete(`audit_events?id=eq.${any.body[0].id}`));
  });
});
