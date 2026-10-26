import { check, uuidParam, withApi } from "@/server/api-auth";

/** GET /api/v1/claims/{id}/info-requests — what the insurer/broker has asked for, open first. */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/claims/[id]">) => {
    const id = uuidParam((await route.params).id);
    const res = await auth.supabase.from("claim_info_requests").select("*").eq("claim_id", id).order("fulfilled_at", { ascending: true, nullsFirst: true }).order("created_at", { ascending: false });
    check(res);
    const items = res.data ?? [];
    return { items, open: items.filter((r) => !r.fulfilled_at).length, fulfilEndpoint: "/api/v1/claims/{id}/info-requests/{reqId}/fulfil" };
  },
  { auth: "user" },
);
