import { test } from "node:test";
import assert from "node:assert/strict";
import { routeRequest, type RoutingCandidate } from "./routing.ts";

const cand = (over: Partial<RoutingCandidate> & Pick<RoutingCandidate, "brokerOrgId">): RoutingCandidate => ({
  brokerName: over.brokerOrgId.toUpperCase(),
  priority: 10,
  isSecondary: false,
  regions: [],
  segments: [],
  dailyCapacity: null,
  openToday: 0,
  insurerAccess: 3,
  licenceValid: true,
  ...over,
});

test("daily capacity: a full broker is skipped, unlimited capacity never is", () => {
  const d = routeRequest([cand({ brokerOrgId: "full", dailyCapacity: 5, openToday: 5 }), cand({ brokerOrgId: "open", priority: 50, dailyCapacity: null, openToday: 999 })], {});
  assert.equal(d.brokerOrgId, "open");
  assert.deepEqual(d.considered.find((c) => c.brokerOrgId === "full"), { brokerOrgId: "full", eligible: false, why: "At daily capacity" });
  const almost = routeRequest([cand({ brokerOrgId: "almost", dailyCapacity: 5, openToday: 4 })], {});
  assert.equal(almost.brokerOrgId, "almost");
});

test("region: empty list means nationwide, otherwise the request region must be served", () => {
  const candidates = [cand({ brokerOrgId: "accra-only", regions: ["Greater Accra"] }), cand({ brokerOrgId: "nationwide", priority: 20 })];
  assert.equal(routeRequest(candidates, { region: "Greater Accra" }).brokerOrgId, "accra-only");
  const volta = routeRequest(candidates, { region: "Volta" });
  assert.equal(volta.brokerOrgId, "nationwide");
  assert.equal(volta.considered[0]!.why, "Does not serve this region");
  assert.equal(routeRequest(candidates, {}).brokerOrgId, "accra-only", "no region in context → regional rules are not applied");
});

test("segment: brokers restricted to segments only receive those segments", () => {
  const candidates = [cand({ brokerOrgId: "biz", segments: ["business", "specialist"] }), cand({ brokerOrgId: "retail", priority: 20 })];
  assert.equal(routeRequest(candidates, { segment: "business" }).brokerOrgId, "biz");
  const personal = routeRequest(candidates, { segment: "personal" });
  assert.equal(personal.brokerOrgId, "retail");
  assert.equal(personal.considered[0]!.why, "Does not serve this segment");
});

test("licence and insurer access gate eligibility before anything else", () => {
  const d = routeRequest([cand({ brokerOrgId: "no-licence", licenceValid: false }), cand({ brokerOrgId: "no-insurers", insurerAccess: 0 })], { region: "Ashanti" });
  assert.equal(d.brokerOrgId, null);
  assert.match(d.reason, /No eligible broker/);
  assert.deepEqual(d.considered.map((c) => c.why), ["Licence not verified or expired", "No insurer appointments for this category"]);
});

test("scoring: priority first, secondary brokers last, SLA breaches and load penalised, insurer access rewarded", () => {
  const primaryBusy = cand({ brokerOrgId: "primary-busy", priority: 10, openToday: 50, slaBreachRate30d: 0.5, insurerAccess: 1 });
  const primaryFresh = cand({ brokerOrgId: "primary-fresh", priority: 10, openToday: 0, slaBreachRate30d: 0, insurerAccess: 1 });
  const secondary = cand({ brokerOrgId: "secondary", priority: 1, isSecondary: true, insurerAccess: 10 });
  const d = routeRequest([primaryBusy, secondary, primaryFresh], {});
  assert.equal(d.brokerOrgId, "primary-fresh");
  assert.match(d.reason, /PRIMARY-FRESH selected \(primary broker/);
  const scores = Object.fromEntries(d.considered.map((c) => [c.brokerOrgId, c.score!]));
  assert.ok(scores["secondary"]! > scores["primary-busy"]! && scores["secondary"]! > 900, "secondary brokers carry a +1000 penalty (minus at most 10 for insurer access)");
  assert.ok(scores["primary-busy"]! > scores["primary-fresh"]!);
  assert.equal(d.considered.find((c) => c.brokerOrgId === "secondary")!.why, "Secondary broker");

  // Same priority and load: more insurer access wins.
  const tie = routeRequest([cand({ brokerOrgId: "few", insurerAccess: 2 }), cand({ brokerOrgId: "many", insurerAccess: 6 })], {});
  assert.equal(tie.brokerOrgId, "many");
});

test("the considered list explains every candidate", () => {
  const d = routeRequest([cand({ brokerOrgId: "a" }), cand({ brokerOrgId: "b", licenceValid: false }), cand({ brokerOrgId: "c", isSecondary: true })], {});
  assert.equal(d.considered.length, 3);
  for (const c of d.considered) assert.ok(c.why.length > 0);
});
