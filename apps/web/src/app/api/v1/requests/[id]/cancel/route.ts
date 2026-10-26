import { CancelRequestInput, canTransitionRequest } from "@im/core";
import { createServiceClient } from "@/lib/supabase/server";
import { check, parseJson, rule, uuidParam, withApi } from "@/server/api-auth";
import { requestForCustomer } from "@/server/access";
import { notifyOrg } from "@/server/notify";

/** POST /api/v1/requests/{id}/cancel — customer cancels an open request. */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/requests/[id]/cancel">) => {
    const id = uuidParam((await route.params).id);
    const { reason } = await parseJson(req, CancelRequestInput);
    const request = await requestForCustomer(auth, id);
    if (!canTransitionRequest(request.status, "cancelled", "customer")) {
      throw rule(`A request that is "${request.status.replace(/_/g, " ")}" can't be cancelled here. Contact your broker.`);
    }
    // Service client: RLS lets customers edit only draft/awaiting-info/quotes-ready requests, but the
    // status machine also allows cancelling a submitted request. Ownership and transition checked above.
    const svc = createServiceClient();
    const res = await svc
      .from("requests")
      .update({ status: "cancelled", cancelled_reason: reason ?? "Cancelled by customer", next_step: null })
      .eq("id", id)
      .eq("status", request.status)
      .select("id, reference, status, completed_at")
      .single();
    check(res);
    await svc.from("request_events").insert({ request_id: id, actor_id: auth.userId, actor_party: "customer", event: "note", note: reason ? `Cancelled: ${reason}` : "Cancelled by customer" });
    if (request.broker_org_id) {
      await notifyOrg(request.broker_org_id, { kind: "request.cancelled", title: `${request.reference} cancelled by the customer`, body: reason, link: `/partner/requests/${id}`, data: { request_id: id }, channels: ["in_app"] });
    }
    return res.data;
  },
  { auth: "user" },
);
