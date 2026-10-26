import type { RoutingCandidate, RoutingDecision } from "@im/core";

export interface SimulationResult {
  decision: RoutingDecision;
  candidates: (RoutingCandidate & { reason?: string })[];
  names: Record<string, string>;
}
