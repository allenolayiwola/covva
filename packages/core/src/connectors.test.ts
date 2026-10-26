import { test } from "node:test";
import assert from "node:assert/strict";
import { apiMotorRegistration, connectorFor, manualHandoffMotorRegistration, nicMotorRegistration, parseNicMotorDbMode, simulatorConnector } from "./connectors.ts";

const fixed = () => new Date("2026-10-26T10:00:00Z");

test("simulator: quote → bind → issue round trip is deterministic", async () => {
  const sim = simulatorConnector({ now: fixed });
  const q = await sim.quote({ categorySlug: "motor", risk: { vehicle_value: 80000 }, productCode: "MTR-COMP" });
  assert.ok(q.ok);
  if (!q.ok) return;
  assert.equal(q.premium, 3200);
  assert.equal(q.currency, "GHS");
  assert.equal(q.validUntil, "2026-11-09T10:00:00.000Z");
  const again = await sim.quote({ categorySlug: "motor", risk: { vehicle_value: 80000 }, productCode: "MTR-COMP" });
  assert.ok(again.ok && again.externalReference === q.externalReference, "same risk → same reference");

  const b = await sim.bind({ externalReference: q.externalReference, coverStart: "2026-11-01", coverEnd: "2027-10-31" });
  assert.ok(b.ok && b.bound);

  const issued = await sim.issue({ policyId: "11111111-1111-4111-8111-111111111111", externalReference: q.externalReference, coverStart: "2026-11-01", coverEnd: "2027-10-31", customer: { fullName: "Ama Mensah" }, risk: {} });
  assert.ok(issued.ok);
  if (!issued.ok) return;
  assert.match(issued.policyNumber, /^SIM-[0-9A-Z]{7}$/);
  assert.equal(issued.issuedAt, "2026-10-26T10:00:00.000Z");
  assert.deepEqual(issued.documents, []);
});

test("simulator: failures carry a code and never throw", async () => {
  const sim = simulatorConnector({ now: fixed });
  const declined = await sim.quote({ categorySlug: "motor", risk: { simulate: "decline" } });
  assert.deepEqual(declined, { ok: false, code: "rejected", message: "Simulated decline: outside appetite.", retryable: false });
  const bad = await sim.bind({ externalReference: "SIM-Q-1", coverStart: "2026-11-01", coverEnd: "2026-11-01" });
  assert.ok(!bad.ok && bad.code === "invalid");
  const noRef = await sim.bind({ externalReference: "", coverStart: "2026-11-01", coverEnd: "2027-11-01" });
  assert.ok(!noRef.ok && noRef.code === "invalid");
  const minimum = await sim.quote({ categorySlug: "travel", risk: {} });
  assert.ok(minimum.ok && minimum.premium === 100, "minimum premium applies");
});

test("NIC motor registration: manual hand-off is pending, API mode registers through the connector", async () => {
  const manual = manualHandoffMotorRegistration(fixed);
  assert.equal(manual.mode, "manual");
  const r = await manual.register({ policyId: "p", policyNumber: "CG/MTR/2026/000001", insurerName: "Coastline", coverStart: "2026-11-01", coverEnd: "2027-10-31" });
  assert.deepEqual(r, { ok: true, status: "pending", reference: null, provider: "manual_handoff", submittedAt: "2026-10-26T10:00:00.000Z" });
  const missing = await manual.register({ policyId: "p", policyNumber: "", insurerName: "Coastline", coverStart: "2026-11-01", coverEnd: "2027-10-31" });
  assert.ok(!missing.ok && missing.code === "invalid");

  const api = apiMotorRegistration(simulatorConnector({ now: fixed }));
  assert.equal(api.mode, "api");
  const reg = await api.register({ policyId: "p", policyNumber: "CG/MTR/2026/000001", insurerName: "Coastline", coverStart: "2026-11-01", coverEnd: "2027-10-31" });
  assert.ok(reg.ok && reg.status === "registered" && reg.reference?.startsWith("NIC-SIM-"));

  assert.equal(parseNicMotorDbMode("api"), "api");
  assert.equal(parseNicMotorDbMode(undefined), "manual");
  assert.equal(parseNicMotorDbMode("anything"), "manual");
  assert.equal(nicMotorRegistration("api", null).mode, "manual", "API mode without a connector falls back to hand-off");
  assert.equal(nicMotorRegistration("api", simulatorConnector()).provider, "simulator");
  assert.equal(nicMotorRegistration("manual", simulatorConnector()).provider, "manual_handoff");
});

test("connector registry knows only the simulator", () => {
  assert.equal(connectorFor("simulator")?.id, "simulator");
  assert.equal(connectorFor("SIM")?.id, "simulator");
  assert.equal(connectorFor("acme-core"), null);
  assert.equal(connectorFor(null), null);
});
