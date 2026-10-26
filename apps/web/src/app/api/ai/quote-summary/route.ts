import { QuoteSummaryInput } from "@im/core";
import { RATE_LIMITS, parseJson, withApi } from "@/server/api-auth";
import { quoteSummary } from "@/server/ai/quote-summary";

export const maxDuration = 60;

/** POST /api/ai/quote-summary — plain-language cover summary for the compare page. Body: { quoteId } or { productVersionId }. */
export const POST = withApi(
  async ({ auth, req }) => {
    const input = await parseJson(req, QuoteSummaryInput);
    return quoteSummary(auth, input);
  },
  { auth: "user", rateLimit: RATE_LIMITS.ai },
);
