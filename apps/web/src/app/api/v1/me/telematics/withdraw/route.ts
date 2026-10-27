import { TelematicsWithdrawInput } from "@im/core";
import { parseJson, withApi } from "@/server/api-auth";
import { telematicsOverview, withdrawTelematics } from "@/server/telematics";

/**
 * POST /api/v1/me/telematics/withdraw — stop driving scoring for an enrolment. Collection stops at once (the
 * database refuses further trips), a consent-withdrawn record is written, trip summaries are deleted by the
 * retention job and monthly scores stay with the policy.
 */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, TelematicsWithdrawInput);
    const enrolment = await withdrawTelematics(auth.supabase, input.enrolmentId, auth.via === "bearer" ? "mobile" : "web");
    return { enrolment, overview: await telematicsOverview(auth.supabase, auth.userId) };
  },
  { auth: "user" },
);
