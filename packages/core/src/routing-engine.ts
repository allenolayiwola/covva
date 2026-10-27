/**
 * Routing engine (Addendum 2 D/E). Decides who fulfils a new request:
 *
 *   a. the customer has an active broker assignment      → broker_fixed (that broker)
 *   b. "talk to an expert" or a complexity threshold hit → broker_pool (advice needed)
 *   c. the chosen insurer is connected for direct sales  → insurer_direct (no broker)
 *   d. the insurer nominated brokers                      → broker_pool restricted to them
 *   e. otherwise                                          → broker_pool of eligible brokers
 *      no eligible broker                                 → ops_hold
 *
 * Eligibility for a pool = verified appointment for insurer × line (the server passes the
 * appointed insurers per broker) + licence valid + capacity/region/segment, scored with
 * `routeRequest` (never by payment to the platform). A pool is offered to the top N brokers
 * for a limited time; on expiry the next N get the offer; after the last round the request
 * is held for platform operations. Pure functions only: no I/O, fully unit-testable.
 */
import { routeRequest, type RoutingCandidate, type RoutingContext } from "./routing";

export type RoutingMode = "insurer_direct" | "broker_pool" | "broker_fixed" | "ops_hold";
export type RoutingRule = "customer_assignment" | "advice_or_complexity" | "insurer_direct" | "nominated_brokers" | "broker_pool" | "ops_hold";
export type IntegrationLevel = "L1" | "L2" | "L3";
export type OfferStatus = "offered" | "accepted" | "declined" | "expired" | "withdrawn";

export const ROUTING_DEFAULTS = {
  offerTimeoutMinutes: 30,
  offerBatchSize: 3,
  maxRounds: 3,
} as const;

export interface ComplexityThresholds {
  /** Fleet policies with at least this many vehicles need a broker. */
  fleetVehicles: number;
  /** Group life / health schemes with at least this many lives need a broker. */
  groupLives: number;
  /** Sum insured (GHS) above which the risk is treated as complex. null disables the check. */
  sumInsured: number | null;
}

export const DEFAULT_COMPLEXITY_THRESHOLDS: ComplexityThresholds = { fleetVehicles: 5, groupLives: 20, sumInsured: 2_000_000 };

export type ComplexityFlag = "fleet" | "commercial_property" | "marine" | "group_scheme" | "high_sum_insured";

export interface RoutingRequestInput {
  categorySlug: string;
  /** personal | business | specialist */
  segment?: string;
  region?: string;
  talkToExpert?: boolean;
  risk: Record<string, unknown>;
  /** Insurer the customer chose (from the risk form / a selected product), if any. */
  preferredInsurerOrgId?: string | null;
}

export interface LineIntegration {
  insurerOrgId: string;
  insurerName?: string;
  level: IntegrationLevel;
  directSales: boolean;
  nominatedBrokerOrgIds: string[];
  active: boolean;
}

/** A broker candidate plus the insurers that have appointed it for this line. */
export interface EngineCandidate extends RoutingCandidate {
  appointedInsurerOrgIds: string[];
}

export interface RoutingEngineInput {
  request: RoutingRequestInput;
  customerAssignment?: { brokerOrgId: string; brokerName?: string; source?: string } | null;
  integrations: LineIntegration[];
  brokers: EngineCandidate[];
  thresholds?: Partial<ComplexityThresholds>;
  offerTimeoutMinutes?: number;
  offerBatchSize?: number;
  maxRounds?: number;
  /** Scorecard factor (± points from the 90-day score); omitted or 0 = off. See RoutingContext. */
  scorecardWeight?: number;
}

export interface ConsideredBroker {
  brokerOrgId: string;
  brokerName: string;
  eligible: boolean;
  why: string;
  score?: number;
  /** 1-based position among eligible brokers (offer order). */
  rank?: number;
}

export interface RoutingEngineDecision {
  mode: RoutingMode;
  rule: RoutingRule;
  insurerOrgId?: string;
  brokerOrgId?: string;
  /** Every broker considered, eligible ones ranked (the offer order for a pool). */
  candidates: ConsideredBroker[];
  reason: string;
  complexityFlags: ComplexityFlag[];
  offerTimeoutMinutes: number;
  offerBatchSize: number;
  maxRounds: number;
}

// ---------------------------------------------------------------------------
// Complexity
// ---------------------------------------------------------------------------
function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function firstNum(risk: Record<string, unknown>, keys: string[]): number | null {
  for (const k of keys) {
    const n = num(risk[k]);
    if (n !== null) return n;
    const v = risk[k];
    if (Array.isArray(v)) return v.length;
  }
  return null;
}

function text(v: unknown): string {
  return typeof v === "string" ? v.toLowerCase() : "";
}

/** Which complexity thresholds a request hits (Addendum 2 D3). Empty = simple risk. */
export function complexityFlags(req: RoutingRequestInput, thresholds: Partial<ComplexityThresholds> = {}): ComplexityFlag[] {
  const t = { ...DEFAULT_COMPLEXITY_THRESHOLDS, ...thresholds };
  const slug = req.categorySlug.toLowerCase();
  const risk = req.risk ?? {};
  const flags: ComplexityFlag[] = [];

  const vehicles = firstNum(risk, ["fleet_size", "vehicle_count", "number_of_vehicles", "vehicles"]);
  if (vehicles !== null && vehicles >= t.fleetVehicles) flags.push("fleet");

  const use = text(risk.property_use ?? risk.occupancy ?? risk.property_type);
  const commercialUse = /commercial|industrial|office|warehouse|shop|factory|retail/.test(use);
  const propertyLine = /property|fire|building|home|office|shop/.test(slug);
  if (/commercial/.test(slug) || (propertyLine && (commercialUse || (!!req.segment && req.segment !== "personal")))) {
    flags.push("commercial_property");
  }

  if (/marine|cargo|hull/.test(slug) || /marine|cargo|hull/.test(text(risk.cover_type ?? risk.cover))) flags.push("marine");

  const lives = firstNum(risk, ["lives", "members", "employees", "group_size", "number_of_lives", "staff_count", "headcount"]);
  if (lives !== null && lives >= t.groupLives) flags.push("group_scheme");

  if (t.sumInsured !== null) {
    const sums = ["sum_insured", "insured_value", "property_value", "vehicle_value", "building_value", "contents_value", "cover_amount", "total_sum_insured"]
      .map((k) => num(risk[k]))
      .filter((n): n is number => n !== null);
    if (sums.length && Math.max(...sums) > t.sumInsured) flags.push("high_sum_insured");
  }
  return flags;
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------
/** Ranks a pool of candidates with the existing scoring. Eligible brokers come first, best score first. */
export function rankBrokers(candidates: EngineCandidate[], ctx: RoutingContext): ConsideredBroker[] {
  const decision = routeRequest(candidates, ctx);
  const names = new Map(candidates.map((c) => [c.brokerOrgId, c.brokerName]));
  const eligible = decision.considered
    .filter((c) => c.eligible)
    .sort((a, b) => (a.score ?? 0) - (b.score ?? 0))
    .map((c, i) => ({ brokerOrgId: c.brokerOrgId, brokerName: names.get(c.brokerOrgId) ?? c.brokerOrgId, eligible: true, why: c.why, score: c.score, rank: i + 1 }));
  const ineligible = decision.considered
    .filter((c) => !c.eligible)
    .map((c) => ({ brokerOrgId: c.brokerOrgId, brokerName: names.get(c.brokerOrgId) ?? c.brokerOrgId, eligible: false, why: c.why }));
  return [...eligible, ...ineligible];
}

/** True when the insurer's line integration lets Covva sell its products directly (no broker). */
export function isDirectSales(i: LineIntegration | null | undefined): boolean {
  return !!i && i.active && (i.level === "L2" || i.level === "L3" || (i.level === "L1" && i.directSales));
}

export function decideRouting(input: RoutingEngineInput): RoutingEngineDecision {
  const offerTimeoutMinutes = positive(input.offerTimeoutMinutes, ROUTING_DEFAULTS.offerTimeoutMinutes);
  const offerBatchSize = positive(input.offerBatchSize, ROUTING_DEFAULTS.offerBatchSize);
  const maxRounds = positive(input.maxRounds, ROUTING_DEFAULTS.maxRounds);
  const base = { offerTimeoutMinutes, offerBatchSize, maxRounds };
  const req = input.request;
  const flags = complexityFlags(req, input.thresholds);
  const ctx: RoutingContext = { region: req.region, segment: req.segment, scorecardWeight: input.scorecardWeight };
  const preferred = req.preferredInsurerOrgId ? input.integrations.find((i) => i.insurerOrgId === req.preferredInsurerOrgId && i.active) ?? null : null;

  // (a) Broker-sourced or chosen broker: the customer stays with that broker.
  if (input.customerAssignment) {
    const a = input.customerAssignment;
    const known = input.brokers.find((b) => b.brokerOrgId === a.brokerOrgId);
    return {
      ...base,
      mode: "broker_fixed",
      rule: "customer_assignment",
      brokerOrgId: a.brokerOrgId,
      candidates: [{ brokerOrgId: a.brokerOrgId, brokerName: a.brokerName ?? known?.brokerName ?? a.brokerOrgId, eligible: true, why: "Customer's standing broker", rank: 1 }],
      reason: `${a.brokerName ?? known?.brokerName ?? "The customer's broker"} is the customer's standing broker (${a.source ?? "assignment"}); the request stays with them.`,
      complexityFlags: flags,
    };
  }

  // (b) Advice requested or complex risk: a broker regardless of insurer connectivity.
  if (req.talkToExpert || flags.length) {
    const pool = poolFor(input.brokers, preferred, ctx);
    const why = req.talkToExpert ? "the customer asked to talk to an expert" : `complex risk (${flags.join(", ")})`;
    return poolDecision(pool, base, flags, "advice_or_complexity", `Routed to brokers because ${why}.`);
  }

  // (c) Chosen insurer connected for direct sales → the insurer, no broker.
  if (preferred && isDirectSales(preferred)) {
    return {
      ...base,
      mode: "insurer_direct",
      rule: "insurer_direct",
      insurerOrgId: preferred.insurerOrgId,
      candidates: [],
      reason: `${preferred.insurerName ?? "The insurer"} is connected at ${preferred.level}${preferred.level === "L1" ? " with direct sales" : ""}; the order goes straight to the insurer.`,
      complexityFlags: flags,
    };
  }

  // (d) Insurer-nominated brokers: pool restricted to nominated brokers with a verified appointment.
  if (preferred && preferred.nominatedBrokerOrgIds.length) {
    const nominated = new Set(preferred.nominatedBrokerOrgIds);
    const pool = poolFor(
      input.brokers.filter((b) => nominated.has(b.brokerOrgId)),
      preferred,
      ctx,
    );
    return poolDecision(pool, base, flags, "nominated_brokers", `${preferred.insurerName ?? "The insurer"} routes its Covva sales through nominated brokers.`);
  }

  // (e) General pool of eligible brokers.
  const pool = poolFor(input.brokers, preferred, ctx);
  return poolDecision(pool, base, flags, "broker_pool", preferred ? `${preferred.insurerName ?? "The insurer"} sells through brokers; offered to brokers appointed for this line.` : "Offered to brokers appointed for this line.");
}

function positive(v: number | undefined, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : fallback;
}

/** Applies the appointment rule (insurer × line) before scoring. */
function poolFor(brokers: EngineCandidate[], preferred: LineIntegration | null, ctx: RoutingContext): ConsideredBroker[] {
  const withAppointment = brokers.map((b) => {
    const appointed = preferred ? b.appointedInsurerOrgIds.includes(preferred.insurerOrgId) : b.appointedInsurerOrgIds.length > 0;
    // routeRequest treats insurerAccess === 0 as "No insurer appointments for this category".
    return appointed ? b : { ...b, insurerAccess: 0 };
  });
  const ranked = rankBrokers(withAppointment, ctx);
  if (!preferred) return ranked;
  return ranked.map((c) => (c.eligible || c.why !== "No insurer appointments for this category" ? c : { ...c, why: "No verified appointment with the chosen insurer for this line" }));
}

function poolDecision(
  pool: ConsideredBroker[],
  base: { offerTimeoutMinutes: number; offerBatchSize: number; maxRounds: number },
  flags: ComplexityFlag[],
  rule: RoutingRule,
  reason: string,
): RoutingEngineDecision {
  const eligible = pool.filter((c) => c.eligible);
  if (!eligible.length) {
    return { ...base, mode: "ops_hold", rule: "ops_hold", candidates: pool, reason: `${reason} No eligible broker — held for platform operations.`, complexityFlags: flags };
  }
  const first = eligible.slice(0, base.offerBatchSize).map((c) => c.brokerName);
  return { ...base, mode: "broker_pool", rule, candidates: pool, reason: `${reason} Offered first to ${first.join(", ")} (${base.offerTimeoutMinutes} min to accept).`, complexityFlags: flags };
}

// ---------------------------------------------------------------------------
// Offer rounds and timeouts
// ---------------------------------------------------------------------------
export interface OfferRoundPlan {
  round: number;
  brokerOrgIds: string[];
  /** No candidates left or the round limit was reached: hold for ops. */
  exhausted: boolean;
}

/**
 * Brokers to offer in a given round (1-based): the next `batchSize` eligible brokers in rank
 * order that have not been offered before. Beyond `maxRounds`, or with no brokers left, the
 * plan is exhausted and the request goes to ops.
 */
export function planOfferRound(candidates: ConsideredBroker[], round: number, opts: { batchSize?: number; maxRounds?: number; alreadyOffered?: string[] } = {}): OfferRoundPlan {
  const batchSize = positive(opts.batchSize, ROUTING_DEFAULTS.offerBatchSize);
  const maxRounds = positive(opts.maxRounds, ROUTING_DEFAULTS.maxRounds);
  if (round < 1 || round > maxRounds) return { round, brokerOrgIds: [], exhausted: true };
  const skip = new Set(opts.alreadyOffered ?? []);
  const ordered = candidates
    .filter((c) => c.eligible)
    .sort((a, b) => (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER))
    .map((c) => c.brokerOrgId)
    .filter((id, i, arr) => !skip.has(id) && arr.indexOf(id) === i);
  // When callers don't track who was offered, rounds walk the ranked list in fixed pages.
  const page = opts.alreadyOffered ? ordered.slice(0, batchSize) : ordered.slice((round - 1) * batchSize, round * batchSize);
  return { round, brokerOrgIds: page, exhausted: page.length === 0 };
}

export interface OfferLike {
  id: string;
  brokerOrgId: string;
  status: OfferStatus;
  round: number;
  respondsBy: string | Date;
}

export type RoundState = "accepted" | "open" | "closed" | "none";

/** State of the offers on a request at `now`: accepted, still open, all closed (expired/declined/withdrawn) or none. */
export function offerRoundState(offers: OfferLike[], now: Date = new Date()): { state: RoundState; round: number; expired: string[] } {
  if (!offers.length) return { state: "none", round: 0, expired: [] };
  const round = Math.max(...offers.map((o) => o.round));
  if (offers.some((o) => o.status === "accepted")) return { state: "accepted", round, expired: [] };
  const expired = offers.filter((o) => o.status === "offered" && new Date(o.respondsBy).getTime() <= now.getTime()).map((o) => o.id);
  const stillOpen = offers.some((o) => o.status === "offered" && !expired.includes(o.id));
  return { state: stillOpen ? "open" : "closed", round, expired };
}

/**
 * Applies an acceptance to a set of offers, enforcing the one-accepted-offer invariant: the
 * accepted offer must be open and unexpired, no other offer may already be accepted, and
 * every other open offer is withdrawn.
 */
export function applyOfferAcceptance(offers: OfferLike[], acceptId: string, now: Date = new Date()): { ok: true; offers: OfferLike[]; accepted: OfferLike } | { ok: false; reason: string } {
  const target = offers.find((o) => o.id === acceptId);
  if (!target) return { ok: false, reason: "This offer is not valid" };
  const already = offers.find((o) => o.status === "accepted");
  if (already) return { ok: false, reason: already.id === acceptId ? "This offer has already been accepted" : "Another broker has already taken this request" };
  if (target.status !== "offered") return { ok: false, reason: `This offer is no longer open (${target.status})` };
  if (new Date(target.respondsBy).getTime() < now.getTime()) return { ok: false, reason: "This offer has expired and the request has been re-routed" };
  const next = offers.map((o) => (o.id === acceptId ? { ...o, status: "accepted" as const } : o.status === "offered" ? { ...o, status: "withdrawn" as const } : o));
  return { ok: true, offers: next, accepted: next.find((o) => o.id === acceptId)! };
}

/** Deadline for an offer made at `from`. */
export function offerDeadline(from: Date, timeoutMinutes: number): Date {
  return new Date(from.getTime() + positive(timeoutMinutes, ROUTING_DEFAULTS.offerTimeoutMinutes) * 60_000);
}
