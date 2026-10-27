import { withApi } from "@/server/api-auth";
import { loyaltySummaryForUser } from "@/server/loyalty";

/**
 * GET /api/v1/me/loyalty — the signed-in customer's loyalty position: claim-free years, tier with each insurer,
 * credit balance, upcoming renewal perks (what the insurer's rules would give and what is still needed), recent
 * savings and plain "how to earn more" tips. Discounts are the insurer's; Covva only records them.
 */
export const GET = withApi(async ({ auth }) => loyaltySummaryForUser(auth.supabase, auth.userId), { auth: "user" });
