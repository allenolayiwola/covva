import { withApi } from "@/server/api-auth";
import { familyDashboard } from "@/server/diaspora";

/**
 * GET /api/v1/family/dashboard — everything the sponsor pays for: beneficiaries (+ consent), sponsorships,
 * policies, next renewal, payment schedule (one-off payments + recurring sponsor subscriptions) and claims.
 */
export const GET = withApi(async ({ auth }) => familyDashboard(auth.supabase, auth.userId), { auth: "user" });
