import { uuidParam, withApi } from "@/server/api-auth";
import { businessDashboard } from "@/server/business";

type Route = { params: Promise<{ orgId: string }> };

/** GET /api/v1/business/{orgId}/dashboard — schemes, member/fleet/asset counts, renewals, statements due, claim counts. */
export const GET = withApi<"user", Route>(
  async ({ auth }, { params }) => {
    const orgId = uuidParam((await params).orgId, "orgId");
    return businessDashboard({ supabase: auth.supabase, userId: auth.userId, source: "mobile" }, orgId);
  },
  { auth: "user" },
);
