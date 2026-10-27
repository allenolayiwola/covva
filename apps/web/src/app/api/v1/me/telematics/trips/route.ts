import { TelematicsTripsInput } from "@im/core";
import { parseJson, withApi, type RateLimit } from "@/server/api-auth";
import { ingestTrips } from "@/server/telematics";

/** Uploads are batched by the app (up to 200 trips); a phone never needs more than a few calls an hour. */
const TELEMATICS_LIMIT: RateLimit = { capacity: 30, refillPerSecond: 0.05, name: "telematics" };

/**
 * POST /api/v1/me/telematics/trips — batch upload of trip SUMMARIES for an active enrolment of the caller.
 * Idempotent by `tripId` (a repeat counts as a duplicate, never an error). Refused (422) once the enrolment is
 * withdrawn or the consent is no longer granted. Nothing is stored beyond the summary fields.
 */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, TelematicsTripsInput);
    return ingestTrips(auth.supabase, auth.userId, input);
  },
  { auth: "user", rateLimit: TELEMATICS_LIMIT },
);
