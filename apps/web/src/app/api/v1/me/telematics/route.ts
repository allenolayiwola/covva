import { withApi } from "@/server/api-auth";
import { telematicsOverview } from "@/server/telematics";

/**
 * GET /api/v1/me/telematics — consent state and wording, the caller's motor policies with their enrolment,
 * monthly scores with the factor breakdown, a provisional score for the current month and a trips summary.
 * Trips are summaries only; no GPS trace exists to return.
 */
export const GET = withApi(async ({ auth }) => telematicsOverview(auth.supabase, auth.userId), { auth: "user" });
