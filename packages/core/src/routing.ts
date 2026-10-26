/**
 * Broker routing (strategy doc §4): route by category, competence, insurer
 * access, location, capacity and service performance — never solely by the
 * highest payment to the platform. Exactly one broker of record per request.
 */
export interface RoutingCandidate {
  brokerOrgId: string;
  brokerName: string;
  priority: number;          // lower = preferred
  isSecondary: boolean;
  regions: string[];         // empty = nationwide
  segments: string[];        // empty = all
  dailyCapacity: number | null;
  openToday: number;         // requests already routed today
  insurerAccess: number;     // insurers appointed for this category
  licenceValid: boolean;     // NIC licence verified and unexpired
  slaBreachRate30d?: number; // 0–1
}

export interface RoutingDecision {
  brokerOrgId: string | null;
  reason: string;
  considered: { brokerOrgId: string; eligible: boolean; why: string; score?: number }[];
}

export function routeRequest(candidates: RoutingCandidate[], ctx: { region?: string; segment?: string }): RoutingDecision {
  const considered: RoutingDecision["considered"] = [];
  const eligible: (RoutingCandidate & { score: number })[] = [];

  for (const c of candidates) {
    let why = "";
    if (!c.licenceValid) why = "Licence not verified or expired";
    else if (c.insurerAccess === 0) why = "No insurer appointments for this category";
    else if (ctx.region && c.regions.length && !c.regions.includes(ctx.region)) why = "Does not serve this region";
    else if (ctx.segment && c.segments.length && !c.segments.includes(ctx.segment)) why = "Does not serve this segment";
    else if (c.dailyCapacity !== null && c.openToday >= c.dailyCapacity) why = "At daily capacity";

    if (why) {
      considered.push({ brokerOrgId: c.brokerOrgId, eligible: false, why });
      continue;
    }
    // Lower score is better: priority first, secondary brokers last, then service quality and load.
    const score = c.priority + (c.isSecondary ? 1000 : 0) + Math.round((c.slaBreachRate30d ?? 0) * 50) + Math.min(c.openToday, 50) * 0.1 - Math.min(c.insurerAccess, 10);
    eligible.push({ ...c, score });
    considered.push({ brokerOrgId: c.brokerOrgId, eligible: true, why: c.isSecondary ? "Secondary broker" : "Primary broker", score });
  }

  eligible.sort((a, b) => a.score - b.score);
  const pick = eligible[0];
  return pick
    ? { brokerOrgId: pick.brokerOrgId, reason: `${pick.brokerName} selected (${pick.isSecondary ? "secondary" : "primary"} broker for this category)`, considered }
    : { brokerOrgId: null, reason: "No eligible broker — request held for platform operations", considered };
}
