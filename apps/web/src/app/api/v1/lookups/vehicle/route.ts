import { VehicleLookupInput, normaliseRegistration } from "@im/core";
import { RATE_LIMITS, parseJson, withApi } from "@/server/api-auth";
import { lookupVehicle } from "@/server/lookups";

/**
 * POST /api/v1/lookups/vehicle — prefill a motor quote from a registration number.
 * Returns `{ registration, found, source, data }`; `found: false` simply means "ask the customer".
 * Vehicle facts only (make, model, year, body, colour, engine, seats, use) — never the keeper.
 */
export const POST = withApi(
  async ({ req }) => {
    const { registration } = await parseJson(req, VehicleLookupInput);
    const reg = normaliseRegistration(registration);
    const r = await lookupVehicle(reg);
    return r ? { registration: r.registration, found: true, source: r.source, data: r.data, fetchedAt: r.fetchedAt } : { registration: reg, found: false, source: null, data: null };
  },
  { auth: "user", rateLimit: RATE_LIMITS.write },
);
