import { test } from "node:test";
import assert from "node:assert/strict";
import { CLIENT_HEADER, SetActiveWorkspaceInput, accessMessage, isClientBlocked, parseActiveWorkspace, parseClientKind, workspaceAccess } from "./access.ts";

test("client header parsing defaults to web", () => {
  assert.equal(CLIENT_HEADER, "x-covva-client");
  assert.equal(parseClientKind(null), "web");
  assert.equal(parseClientKind(undefined), "web");
  assert.equal(parseClientKind(""), "web");
  assert.equal(parseClientKind("Mobile"), "mobile");
  assert.equal(parseClientKind(" partner-web "), "partner-web");
  assert.equal(parseClientKind("ios"), "web");
});

test("customers and brokers use the mobile app; insurers and staff are web-only", () => {
  assert.equal(workspaceAccess("customer", "mobile").allowed, true);
  assert.equal(workspaceAccess("broker", "mobile").allowed, true);
  const insurer = workspaceAccess("insurer", "mobile");
  assert.equal(insurer.allowed, false);
  assert.equal(insurer.reason, "insurer_web_only");
  assert.match(insurer.message ?? "", /web portal/);
  const staff = workspaceAccess("platform", "mobile");
  assert.equal(staff.allowed, false);
  assert.equal(staff.reason, "staff_admin_console_only");
});

test("every workspace is allowed on the web clients", () => {
  for (const type of ["customer", "broker", "insurer", "platform"] as const) {
    assert.equal(workspaceAccess(type, "web").allowed, true, `${type} on web`);
    assert.equal(workspaceAccess(type, "partner-web").allowed, true, `${type} on partner-web`);
  }
});

test("accessMessage points insurer users at the partner portal", () => {
  const msg = accessMessage(workspaceAccess("insurer", "mobile"), "https://covva.com.gh/");
  assert.equal(msg, "Insurer accounts are managed in the Covva web portal, not the mobile app. Sign in at https://covva.com.gh/partner on a computer, tablet or phone browser.");
  assert.equal(accessMessage(workspaceAccess("broker", "mobile"), "https://covva.com.gh"), null);
});

test("isClientBlocked: insurer-only accounts are blocked on mobile, dual-role brokers are not", () => {
  assert.equal(isClientBlocked(["insurer"], "mobile"), true);
  assert.equal(isClientBlocked(["platform"], "mobile"), true);
  assert.equal(isClientBlocked(["insurer", "platform"], "mobile"), true);
  assert.equal(isClientBlocked(["insurer", "broker"], "mobile"), false);
  assert.equal(isClientBlocked(["broker"], "mobile"), false);
  assert.equal(isClientBlocked([], "mobile"), false, "plain customers are never blocked");
  assert.equal(isClientBlocked(["insurer"], "web"), false);
  assert.equal(isClientBlocked(["insurer"], "partner-web"), false);
});

test("SetActiveWorkspaceInput requires an orgId for partner workspaces", () => {
  assert.ok(SetActiveWorkspaceInput.safeParse({ type: "customer" }).success);
  assert.ok(!SetActiveWorkspaceInput.safeParse({ type: "broker" }).success);
  assert.ok(SetActiveWorkspaceInput.safeParse({ type: "broker", orgId: "7b1a0a3e-2d5c-4b2f-9f7f-9f1c6e3f2a11" }).success);
  assert.ok(!SetActiveWorkspaceInput.safeParse({ type: "platform", orgId: "7b1a0a3e-2d5c-4b2f-9f7f-9f1c6e3f2a11" }).success);
});

test("parseActiveWorkspace tolerates bad stored values", () => {
  assert.deepEqual(parseActiveWorkspace({ type: "customer", orgId: "ignored" }), { type: "customer" });
  assert.deepEqual(parseActiveWorkspace({ type: "broker", orgId: "x" }), { type: "broker", orgId: "x" });
  assert.equal(parseActiveWorkspace({ type: "broker" }), null);
  assert.equal(parseActiveWorkspace(null), null);
  assert.equal(parseActiveWorkspace("broker"), null);
});
