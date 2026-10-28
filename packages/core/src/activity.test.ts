import { test } from "node:test";
import assert from "node:assert/strict";
import { describeActivity, isTeamActivity } from "./activity.ts";

const names = (id: string | null | undefined) => ({ "u-kofi": "Kofi Mensah", "u-ama": "Ama Owusu" })[id ?? ""] ?? null;
const ctx = { kind: "insurer" as const, names };

test("role changes read as a sentence with the organisation's role labels", () => {
  const line = describeActivity({ action: "update", entity_type: "memberships", actor_id: "u-kofi", subject_user_id: "u-ama", detail: { role: { from: "underwriter", to: "claims_officer" } } }, ctx);
  assert.equal(line.actor, "Kofi Mensah");
  assert.equal(line.summary, "Changed Ama Owusu's role: Underwriter → Claims");
  assert.equal(line.tone, "info");
  assert.equal(line.entityLabel, "Team member");
  const broker = describeActivity({ action: "update", entity_type: "memberships", actor_id: "u-kofi", subject_user_id: "u-ama", detail: { role: { from: "adviser", to: "admin" } } }, { ...ctx, kind: "broker" });
  assert.equal(broker.summary, "Changed Ama Owusu's role: Account Executive → Admin");
});

test("deactivation, reactivation, supervisor and team moves; several changes join into one line", () => {
  assert.equal(describeActivity({ action: "update", entity_type: "memberships", actor_id: "u-kofi", subject_user_id: "u-ama", detail: { active: { from: true, to: false } } }, ctx).summary, "Deactivated Ama Owusu");
  assert.equal(describeActivity({ action: "update", entity_type: "memberships", actor_id: "u-kofi", subject_user_id: "u-ama", detail: { active: { from: true, to: false } } }, ctx).tone, "danger");
  assert.equal(describeActivity({ action: "update", entity_type: "memberships", actor_id: "u-kofi", subject_user_id: "u-ama", detail: { active: { from: false, to: true } } }, ctx).summary, "Reactivated Ama Owusu");
  const multi = describeActivity({ action: "update", entity_type: "memberships", actor_id: "u-kofi", subject_user_id: "u-ama", detail: { role: { from: "viewer", to: "finance" }, is_supervisor: { from: false, to: true }, team: { from: null, to: "Accra" } } }, ctx);
  assert.equal(multi.summary, "Changed Ama Owusu's role: Read-only → Finance; made Ama Owusu a supervisor; moved Ama Owusu to the Accra team");
  const self = describeActivity({ action: "update", entity_type: "memberships", actor_id: "u-kofi", subject_user_id: "u-kofi", detail: { title: { from: null, to: "Head of claims" } } }, ctx);
  assert.equal(self.summary, "Updated their own job title");
  const former = describeActivity({ action: "update", entity_type: "memberships", actor_id: "u-gone", subject_user_id: "u-gone2", detail: { active: { from: true, to: false } } }, ctx);
  assert.equal(former.actor, "A former member");
  assert.equal(former.summary, "Deactivated a former member");
});

test("invitations: invited, accepted, revoked", () => {
  assert.equal(describeActivity({ action: "insert", entity_type: "invitations", actor_id: "u-kofi", detail: { email: "new@ins.example", role: "underwriter" } }, ctx).summary, "Invited new@ins.example as Underwriter");
  const accepted = describeActivity({ action: "update", entity_type: "invitations", actor_id: "u-ama", detail: { accepted_at: { from: null, to: "2026-11-01T10:00:00Z" } } }, ctx);
  assert.equal(accepted.summary, "Accepted the invitation and joined the team");
  assert.equal(accepted.actor, "Ama Owusu");
  const joined = describeActivity({ action: "insert", entity_type: "memberships", actor_id: "u-ama", subject_user_id: "u-ama", detail: { role: "finance", active: true } }, ctx);
  assert.equal(joined.summary, "Ama Owusu joined the team as Finance");
  const revoked = describeActivity({ action: "delete", entity_type: "invitations", actor_id: "u-kofi", detail: { email: "new@ins.example", role: "underwriter" } }, ctx);
  assert.equal(revoked.summary, "Revoked the invitation for new@ins.example");
  assert.equal(revoked.tone, "danger");
});

test("MFA enrolment and removal name the state, never the secret", () => {
  const on = describeActivity({ action: "mfa.enrolled", entity_type: "mfa", actor_id: "u-ama", subject_user_id: "u-ama", detail: { verified_factors: 1 } }, ctx);
  assert.equal(on.summary, "Set up two-step verification (1 authenticator on the account)");
  assert.equal(on.entityLabel, "Two-step verification");
  const off = describeActivity({ action: "mfa.removed", entity_type: "mfa", actor_id: "u-ama", subject_user_id: "u-ama", detail: { verified_factors: 0 } }, ctx);
  assert.equal(off.summary, "Two-step verification was removed from the account (no authenticator left)");
  assert.equal(off.tone, "danger");
  assert.equal(describeActivity({ action: "mfa.removed", entity_type: "mfa", actor_id: "u-ama", detail: { verified_factors: "2" } }, ctx).summary, "An authenticator was removed (2 authenticators left)");
});

test("bulk product actions and the generic fallback", () => {
  const bulk = describeActivity({ action: "products.bulk_pause", entity_type: "products", actor_id: "u-kofi", detail: { count: 3, reason: "Rates under review" } }, ctx);
  assert.equal(bulk.summary, "Paused 3 products — Rates under review");
  assert.equal(bulk.tone, "wait");
  assert.equal(describeActivity({ action: "products.bulk_republish", entity_type: "products", actor_id: "u-kofi", detail: { count: 1 } }, ctx).summary, "Republished 1 product");
  const generic = describeActivity({ action: "update", entity_type: "policies", actor_id: null, actor_role: "service_role", changed_fields: ["status", "cover_end"] }, ctx);
  assert.equal(generic.actor, "Platform (automated)");
  assert.equal(generic.summary, "Updated policy (Status, Cover end)");
  assert.equal(describeActivity({ action: "insert", entity_type: "api_keys", actor_id: null }, ctx).actor, "System");
});

test("team filter", () => {
  assert.ok(isTeamActivity({ entity_type: "invitations" }));
  assert.ok(isTeamActivity({ entity_type: "mfa" }));
  assert.ok(!isTeamActivity({ entity_type: "quotes" }));
});
