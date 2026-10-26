import { ClaimCompletenessInput } from "@im/core";
import { RATE_LIMITS, parseJson, withApi } from "@/server/api-auth";
import { claimCompleteness } from "@/server/ai/claims";

export const maxDuration = 60;

/** POST /api/ai/claim-completeness — evidence checklist and guidance for a claim. Never predicts the decision. */
export const POST = withApi(
  async ({ auth, req }) => {
    const { claimId } = await parseJson(req, ClaimCompletenessInput);
    return claimCompleteness(auth, claimId);
  },
  { auth: "user", rateLimit: RATE_LIMITS.ai },
);
