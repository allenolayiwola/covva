import { FulfilInfoRequestInput } from "@im/core";
import { notFound, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { fulfilInfoRequest } from "@/server/claims";

/** POST /api/v1/claims/{id}/info-requests/{reqId}/fulfil — attach a document (uploaded via /documents) and/or answer in writing. */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/claims/[id]/info-requests/[reqId]/fulfil">) => {
    const params = await route.params;
    const id = uuidParam(params.id);
    const reqId = uuidParam(params.reqId, "reqId");
    const input = await parseJson(req, FulfilInfoRequestInput);
    const { data: exists } = await auth.supabase.from("claim_info_requests").select("id").eq("id", reqId).eq("claim_id", id).maybeSingle();
    if (!exists) throw notFound("Information request not found.");
    const request = await fulfilInfoRequest(auth.supabase, { requestId: reqId, userId: auth.userId, documentId: input.documentId ?? null, response: input.response ?? null });
    return { request };
  },
  { auth: "user" },
);
