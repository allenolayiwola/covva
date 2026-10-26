import { test } from "node:test";
import assert from "node:assert/strict";
import {
  applyOfferAcceptance,
  complexityFlags,
  decideRouting,
  isDirectSales,
  offerDeadline,
  offerRoundState,
  planOfferRound,
  rankBrokers,
  type EngineCandidate,
  type LineIntegration,
  type OfferLike,
  type RoutingEngineInput,
} from "./routing-engine.ts";

const INS = "insurer-a";
const OTHER = "insurer-b";

const broker = (over: Partial<EngineCandidate> & Pick<EngineCandidate, "brokerOrgId">): EngineCandidate => ({
  brokerName: over.brokerOrgId.toUpperCase(),
  priority: 10,
  isSecondary: false,
  regions: [],
  segments: [],
  dailyCapacity: null,
  openToday: 0,
  insurerAccess: 2,
  licenceValid: true,
  appointedInsurerOrgIds: [INS, OTHER],
  ...over,
});

const integration = (over: Partial<LineIntegration> = {}): LineIntegration => ({
  insurerOrgId: INS,
  insurerName: "Insurer A",
  level: "L1",
  directSales: false,
  nominatedBrokerOrgIds: [],
  active: true,
  ...over,
});

const base = (over: Partial<RoutingEngineInput> = {}): RoutingEngineInput => ({
  request: { categorySlug: "motor", segment: "personal", risk: { vehicle_value: 80_000 }, preferredInsurerOrgId: INS },
  customerAssignment: null,
  integrations: [integration()],
  brokers: [broker({ brokerOrgId: "b1", priority: 10 }), broker({ brokerOrgId: "b2", priority: 20 }), broker({ brokerOrgId: "b3", priority: 30 }), broker({ brokerOrgId: "b4", priority: 40 })],
  ...over,
});

// ---------------------------------------------------------------------------
test("rule a: an active customer_broker_assignment fixes the broker before anything else", () => {
  const d = decideRouting(base({ customerAssignment: { brokerOrgId: "b3", brokerName: "Kofi & Co", source: "broker_import" }, integrations: [integration({ level: "L3" })] }));
  assert.equal(d.mode, "broker_fixed");
  assert.equal(d.rule, "customer_assignment");
  assert.equal(d.brokerOrgId, "b3");
  assert.equal(d.insurerOrgId, undefined, "even an L3 insurer does not override the standing broker");
  assert.deepEqual(d.candidates.map((c) => c.brokerOrgId), ["b3"]);
  assert.match(d.reason, /Kofi & Co.*standing broker/);
});

test("rule b: talk_to_expert routes to a broker pool even when the insurer is direct", () => {
  const d = decideRouting(base({ request: { categorySlug: "motor", segment: "personal", risk: {}, preferredInsurerOrgId: INS, talkToExpert: true }, integrations: [integration({ level: "L2" })] }));
  assert.equal(d.mode, "broker_pool");
  assert.equal(d.rule, "advice_or_complexity");
  assert.match(d.reason, /talk to an expert/);
  assert.deepEqual(d.candidates.filter((c) => c.eligible).map((c) => c.brokerOrgId), ["b1", "b2", "b3", "b4"]);
});

test("rule b: complexity thresholds — fleet, commercial property, marine, group scheme, high sum insured", () => {
  const t = { fleetVehicles: 5, groupLives: 20, sumInsured: 2_000_000 };
  assert.deepEqual(complexityFlags({ categorySlug: "motor", risk: { fleet_size: 4 } }, t), []);
  assert.deepEqual(complexityFlags({ categorySlug: "motor", risk: { fleet_size: 5 } }, t), ["fleet"]);
  assert.deepEqual(complexityFlags({ categorySlug: "motor", risk: { vehicles: [1, 2, 3, 4, 5, 6] } }, t), ["fleet"], "a vehicles array counts");
  assert.deepEqual(complexityFlags({ categorySlug: "commercial-property", risk: {} }, t), ["commercial_property"]);
  assert.deepEqual(complexityFlags({ categorySlug: "property", segment: "personal", risk: { property_use: "residential" } }, t), []);
  assert.deepEqual(complexityFlags({ categorySlug: "property", segment: "personal", risk: { property_use: "warehouse" } }, t), ["commercial_property"]);
  assert.deepEqual(complexityFlags({ categorySlug: "fire", segment: "business", risk: {} }, t), ["commercial_property"]);
  assert.deepEqual(complexityFlags({ categorySlug: "marine-cargo", risk: {} }, t), ["marine"]);
  assert.deepEqual(complexityFlags({ categorySlug: "health", risk: { lives: 19 } }, t), []);
  assert.deepEqual(complexityFlags({ categorySlug: "health", risk: { employees: "25" } }, t), ["group_scheme"]);
  assert.deepEqual(complexityFlags({ categorySlug: "motor", risk: { vehicle_value: 2_000_000 } }, t), [], "threshold is exclusive");
  assert.deepEqual(complexityFlags({ categorySlug: "motor", risk: { vehicle_value: 2_000_001 } }, t), ["high_sum_insured"]);
  assert.deepEqual(complexityFlags({ categorySlug: "motor", risk: { vehicle_value: 9_000_000 } }, { sumInsured: null }), [], "null disables the sum-insured check");
  assert.deepEqual(complexityFlags({ categorySlug: "motor", risk: { fleet_size: 12, vehicle_value: 3_000_000 } }, t), ["fleet", "high_sum_insured"]);

  const d = decideRouting(base({ request: { categorySlug: "motor", segment: "business", risk: { fleet_size: 7 }, preferredInsurerOrgId: INS }, integrations: [integration({ level: "L3" })] }));
  assert.equal(d.mode, "broker_pool");
  assert.deepEqual(d.complexityFlags, ["fleet"]);
  assert.match(d.reason, /complex risk \(fleet\)/);
});

test("rule c: L2/L3, or L1 with direct_sales, go straight to the insurer with no broker", () => {
  assert.equal(isDirectSales(integration({ level: "L1" })), false);
  assert.equal(isDirectSales(integration({ level: "L1", directSales: true })), true);
  assert.equal(isDirectSales(integration({ level: "L2" })), true);
  assert.equal(isDirectSales(integration({ level: "L3" })), true);
  assert.equal(isDirectSales(integration({ level: "L3", active: false })), false, "inactive integrations never route direct");
  assert.equal(isDirectSales(null), false);

  const d = decideRouting(base({ integrations: [integration({ level: "L1", directSales: true })] }));
  assert.equal(d.mode, "insurer_direct");
  assert.equal(d.rule, "insurer_direct");
  assert.equal(d.insurerOrgId, INS);
  assert.equal(d.brokerOrgId, undefined);
  assert.deepEqual(d.candidates, []);
  assert.match(d.reason, /L1 with direct sales/);

  // An inactive integration, or no chosen insurer, falls through to the broker pool.
  assert.equal(decideRouting(base({ integrations: [integration({ level: "L3", active: false })] })).mode, "broker_pool");
  assert.equal(decideRouting(base({ request: { categorySlug: "motor", risk: {}, preferredInsurerOrgId: null }, integrations: [integration({ level: "L3" })] })).mode, "broker_pool");
});

test("rule d: nominated brokers restrict the pool to nominees with a verified appointment", () => {
  const d = decideRouting(
    base({
      integrations: [integration({ nominatedBrokerOrgIds: ["b2", "b4", "b9"] })],
      brokers: [broker({ brokerOrgId: "b1" }), broker({ brokerOrgId: "b2", priority: 20 }), broker({ brokerOrgId: "b4", priority: 5, appointedInsurerOrgIds: [OTHER] })],
    }),
  );
  assert.equal(d.mode, "broker_pool");
  assert.equal(d.rule, "nominated_brokers");
  assert.deepEqual(d.candidates.filter((c) => c.eligible).map((c) => c.brokerOrgId), ["b2"], "b1 is not nominated, b4 has no appointment with this insurer, b9 is unknown");
  assert.equal(d.candidates.find((c) => c.brokerOrgId === "b4")!.why, "No verified appointment with the chosen insurer for this line");

  // Nominees without appointments → ops hold.
  const held = decideRouting(base({ integrations: [integration({ nominatedBrokerOrgIds: ["b4"] })], brokers: [broker({ brokerOrgId: "b4", appointedInsurerOrgIds: [OTHER] })] }));
  assert.equal(held.mode, "ops_hold");
});

test("rule e: the general pool needs an appointment with the chosen insurer and a valid licence, ranked by routeRequest", () => {
  const d = decideRouting(
    base({
      brokers: [
        broker({ brokerOrgId: "busy", priority: 10, openToday: 40, slaBreachRate30d: 0.6 }),
        broker({ brokerOrgId: "fresh", priority: 10 }),
        broker({ brokerOrgId: "secondary", priority: 1, isSecondary: true }),
        broker({ brokerOrgId: "unlicensed", licenceValid: false }),
        broker({ brokerOrgId: "other-insurer-only", appointedInsurerOrgIds: [OTHER] }),
        broker({ brokerOrgId: "volta", regions: ["Volta"] }),
      ],
      request: { categorySlug: "motor", segment: "personal", region: "Greater Accra", risk: {}, preferredInsurerOrgId: INS },
    }),
  );
  assert.equal(d.mode, "broker_pool");
  assert.equal(d.rule, "broker_pool");
  const eligible = d.candidates.filter((c) => c.eligible);
  assert.deepEqual(eligible.map((c) => c.brokerOrgId), ["fresh", "busy", "secondary"]);
  assert.deepEqual(eligible.map((c) => c.rank), [1, 2, 3]);
  const why = Object.fromEntries(d.candidates.filter((c) => !c.eligible).map((c) => [c.brokerOrgId, c.why]));
  assert.equal(why["unlicensed"], "Licence not verified or expired");
  assert.equal(why["other-insurer-only"], "No verified appointment with the chosen insurer for this line");
  assert.equal(why["volta"], "Does not serve this region");
  assert.match(d.reason, /Offered first to FRESH, BUSY, SECONDARY \(30 min to accept\)/);

  // Without a chosen insurer any appointment counts.
  const any = decideRouting(base({ request: { categorySlug: "motor", risk: {} }, brokers: [broker({ brokerOrgId: "x", appointedInsurerOrgIds: [OTHER] }), broker({ brokerOrgId: "none", appointedInsurerOrgIds: [] })] }));
  assert.deepEqual(any.candidates.filter((c) => c.eligible).map((c) => c.brokerOrgId), ["x"]);
  assert.equal(any.candidates.find((c) => c.brokerOrgId === "none")!.why, "No insurer appointments for this category");
});

test("no eligible broker → ops_hold with every candidate explained", () => {
  const d = decideRouting(base({ brokers: [broker({ brokerOrgId: "a", licenceValid: false }), broker({ brokerOrgId: "b", dailyCapacity: 1, openToday: 1 })] }));
  assert.equal(d.mode, "ops_hold");
  assert.equal(d.rule, "ops_hold");
  assert.match(d.reason, /held for platform operations/);
  assert.equal(d.candidates.length, 2);
  assert.ok(d.candidates.every((c) => !c.eligible && c.why));
  assert.equal(decideRouting(base({ brokers: [] })).mode, "ops_hold");
});

test("settings: timeout, batch size and rounds come from the input with safe defaults", () => {
  const d = decideRouting(base({ offerTimeoutMinutes: 15, offerBatchSize: 2, maxRounds: 4 }));
  assert.equal(d.offerTimeoutMinutes, 15);
  assert.equal(d.offerBatchSize, 2);
  assert.equal(d.maxRounds, 4);
  assert.match(d.reason, /Offered first to B1, B2 \(15 min to accept\)/);
  const bad = decideRouting(base({ offerTimeoutMinutes: 0, offerBatchSize: -1, maxRounds: Number.NaN }));
  assert.deepEqual([bad.offerTimeoutMinutes, bad.offerBatchSize, bad.maxRounds], [30, 3, 3]);
  assert.deepEqual(offerDeadline(new Date("2026-10-26T10:00:00Z"), 30), new Date("2026-10-26T10:30:00Z"));
});

test("rankBrokers: eligible brokers first in score order with ranks, then the ineligible ones", () => {
  const ranked = rankBrokers([broker({ brokerOrgId: "p20", priority: 20 }), broker({ brokerOrgId: "nolic", licenceValid: false }), broker({ brokerOrgId: "p10", priority: 10 })], {});
  assert.deepEqual(ranked.map((c) => [c.brokerOrgId, c.eligible, c.rank]), [["p10", true, 1], ["p20", true, 2], ["nolic", false, undefined]]);
});

// ---------------------------------------------------------------------------
test("offer rounds: top N per round, then the next N, exhausted after the last candidate or max rounds", () => {
  const d = decideRouting(base({ offerBatchSize: 2, maxRounds: 3 }));
  const r1 = planOfferRound(d.candidates, 1, { batchSize: 2, maxRounds: 3 });
  assert.deepEqual(r1, { round: 1, brokerOrgIds: ["b1", "b2"], exhausted: false });
  const r2 = planOfferRound(d.candidates, 2, { batchSize: 2, maxRounds: 3 });
  assert.deepEqual(r2, { round: 2, brokerOrgIds: ["b3", "b4"], exhausted: false });
  const r3 = planOfferRound(d.candidates, 3, { batchSize: 2, maxRounds: 3 });
  assert.deepEqual(r3, { round: 3, brokerOrgIds: [], exhausted: true }, "nobody left to offer → ops hold");
  const r4 = planOfferRound(d.candidates, 4, { batchSize: 1, maxRounds: 3 });
  assert.equal(r4.exhausted, true, "beyond max rounds even if candidates remain");

  // With an explicit list of already-offered brokers the next round skips them regardless of paging.
  const skip = planOfferRound(d.candidates, 2, { batchSize: 2, alreadyOffered: ["b1", "b3"] });
  assert.deepEqual(skip.brokerOrgIds, ["b2", "b4"]);
});

test("timeout re-routing: expired offers close the round; a still-open offer keeps it open; acceptance ends it", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const past = "2026-10-26T11:30:00Z";
  const future = "2026-10-26T12:20:00Z";
  const offers: OfferLike[] = [
    { id: "o1", brokerOrgId: "b1", status: "offered", round: 1, respondsBy: past },
    { id: "o2", brokerOrgId: "b2", status: "declined", round: 1, respondsBy: past },
    { id: "o3", brokerOrgId: "b3", status: "offered", round: 1, respondsBy: past },
  ];
  assert.deepEqual(offerRoundState(offers, now), { state: "closed", round: 1, expired: ["o1", "o3"] });
  assert.deepEqual(offerRoundState([...offers, { id: "o4", brokerOrgId: "b4", status: "offered", round: 2, respondsBy: future }], now), { state: "open", round: 2, expired: ["o1", "o3"] });
  assert.equal(offerRoundState([{ id: "o9", brokerOrgId: "b9", status: "accepted", round: 1, respondsBy: past }], now).state, "accepted");
  assert.deepEqual(offerRoundState([], now), { state: "none", round: 0, expired: [] });

  // Re-route after a closed round 1: the next page of candidates, then ops hold when exhausted.
  const d = decideRouting(base({ offerBatchSize: 3, maxRounds: 2 }));
  const next = planOfferRound(d.candidates, 2, { batchSize: 3, maxRounds: 2, alreadyOffered: ["b1", "b2", "b3"] });
  assert.deepEqual(next.brokerOrgIds, ["b4"]);
  assert.equal(planOfferRound(d.candidates, 3, { batchSize: 3, maxRounds: 2, alreadyOffered: ["b1", "b2", "b3", "b4"] }).exhausted, true);
});

test("one accepted offer per request: first accept wins, others are withdrawn, late or second accepts are refused", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const offers: OfferLike[] = [
    { id: "o1", brokerOrgId: "b1", status: "offered", round: 1, respondsBy: "2026-10-26T12:30:00Z" },
    { id: "o2", brokerOrgId: "b2", status: "offered", round: 1, respondsBy: "2026-10-26T12:30:00Z" },
    { id: "o3", brokerOrgId: "b3", status: "declined", round: 1, respondsBy: "2026-10-26T12:30:00Z" },
  ];
  const first = applyOfferAcceptance(offers, "o2", now);
  assert.ok(first.ok);
  assert.deepEqual(first.offers.map((o) => o.status), ["withdrawn", "accepted", "declined"]);
  assert.equal(first.offers.filter((o) => o.status === "accepted").length, 1);

  const second = applyOfferAcceptance(first.offers, "o1", now);
  assert.deepEqual(second, { ok: false, reason: "Another broker has already taken this request" });
  const again = applyOfferAcceptance(first.offers, "o2", now);
  assert.deepEqual(again, { ok: false, reason: "This offer has already been accepted" });
  const declined = applyOfferAcceptance(offers, "o3", now);
  assert.deepEqual(declined, { ok: false, reason: "This offer is no longer open (declined)" });
  const late = applyOfferAcceptance(offers, "o1", new Date("2026-10-26T13:00:00Z"));
  assert.deepEqual(late, { ok: false, reason: "This offer has expired and the request has been re-routed" });
  assert.deepEqual(applyOfferAcceptance(offers, "nope", now), { ok: false, reason: "This offer is not valid" });
});
