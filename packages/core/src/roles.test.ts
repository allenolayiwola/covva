import { test } from "node:test";
import assert from "node:assert/strict";
import { BROKER_ROLE_OPTIONS, INSURER_ROLE_OPTIONS, ROLE_PERMISSIONS, assignableRoles, can, roleLabel, rolesFor, rolesWith } from "./roles.ts";

test("insurer roles match Addendum 3 B2 and map onto the member_role enum", () => {
  assert.deepEqual(
    INSURER_ROLE_OPTIONS.map((r) => [r.label, r.value]),
    [
      ["Admin", "admin"],
      ["Product Manager", "supervisor"],
      ["Underwriter", "underwriter"],
      ["Claims", "claims_officer"],
      ["Finance", "finance"],
      ["Read-only", "viewer"],
    ],
  );
});

test("broker roles match Addendum 3 C3 (account executive → adviser)", () => {
  assert.deepEqual(
    BROKER_ROLE_OPTIONS.map((r) => [r.label, r.value]),
    [
      ["Admin", "admin"],
      ["Account Executive", "adviser"],
      ["Claims", "claims_officer"],
      ["Finance", "finance"],
      ["Read-only", "viewer"],
    ],
  );
  assert.deepEqual(assignableRoles("broker"), ["admin", "adviser", "claims_officer", "finance", "viewer"]);
  assert.ok(!assignableRoles("insurer").includes("owner"), "owner is never offered in the picker");
  assert.equal(rolesFor("insurer").length, 6);
});

test("roleLabel uses the partner's vocabulary and degrades gracefully", () => {
  assert.equal(roleLabel("insurer", "supervisor"), "Product Manager");
  assert.equal(roleLabel("broker", "adviser"), "Account Executive");
  assert.equal(roleLabel("broker", "viewer"), "Read-only");
  assert.equal(roleLabel("broker", "owner"), "Owner");
  assert.equal(roleLabel("broker", "supervisor"), "Supervisor");
  assert.equal(roleLabel("insurer", "adviser"), "Adviser");
});

test("permissions: owner/admin do everything, read-only only views", () => {
  for (const action of ROLE_PERMISSIONS.admin ?? []) {
    assert.ok(can("owner", action), `owner can ${action}`);
    assert.ok(can("admin", action), `admin can ${action}`);
  }
  assert.deepEqual(ROLE_PERMISSIONS.viewer, ["view_reports"]);
  assert.ok(!can("viewer", "manage_team"));
  assert.ok(!can("viewer", "work_requests"));
  assert.ok(can("viewer", "view_reports"));
});

test("permissions: role-specific actions", () => {
  // Product Manager (insurer supervisor) manages products but does not underwrite or manage the team.
  assert.ok(can("supervisor", "manage_products"));
  assert.ok(can("supervisor", "supervise"));
  assert.ok(!can("supervisor", "underwrite"));
  assert.ok(!can("supervisor", "manage_team"));
  // Account Executive works requests; cannot supervise or see billing.
  assert.ok(can("adviser", "work_requests"));
  assert.ok(!can("adviser", "supervise"));
  assert.ok(!can("adviser", "view_billing"));
  // Underwriter / Claims / Finance are scoped.
  assert.ok(can("underwriter", "underwrite"));
  assert.ok(!can("underwriter", "handle_claims"));
  assert.ok(can("claims_officer", "handle_claims"));
  assert.ok(!can("claims_officer", "underwrite"));
  assert.ok(can("finance", "view_billing"));
  assert.ok(!can("finance", "manage_developer"));
  // Unknown / missing role → nothing.
  assert.ok(!can(null, "view_reports"));
  assert.ok(!can(undefined, "view_reports"));
});

test("rolesWith lists the enum values allowed for an action", () => {
  assert.deepEqual(rolesWith("manage_team"), ["owner", "admin"]);
  assert.deepEqual(rolesWith("handle_claims"), ["owner", "admin", "supervisor", "claims_officer"]);
  assert.deepEqual(rolesWith("view_billing"), ["owner", "admin", "finance"]);
});
