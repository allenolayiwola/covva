import { uuidParam, withApi } from "@/server/api-auth";
import { listInvoices } from "@/server/business";

type Route = { params: Promise<{ orgId: string }> };

/** GET /api/v1/business/{orgId}/invoices — consolidated statements (lines per insurer, payment status per line). */
export const GET = withApi<"user", Route>(
  async ({ auth }, { params }) => {
    const orgId = uuidParam((await params).orgId, "orgId");
    return listInvoices({ supabase: auth.supabase, userId: auth.userId, source: "mobile" }, orgId);
  },
  { auth: "user" },
);
