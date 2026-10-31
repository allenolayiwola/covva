import type { IdentityCheckInput, IdentityCheckResult, VehicleLookupResult } from "../lookups";

/** Ghana Card and DVLA contract; manual review never fabricates a verified identity. */
export interface IdentityProvider {
  readonly name: "manual" | "nia";
  verify(input: IdentityCheckInput): Promise<IdentityCheckResult>;
  lookup(registration: string): Promise<VehicleLookupResult | null>;
}

