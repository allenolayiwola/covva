import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { dbError, forbidden, must, notFound, parseJson, rule, uuidParam, withApi, type ApiKeyAuth, type UserAuth } from "@/server/api-auth";
import { afterOfferAccepted, rerouteIfRoundClosed } from "@/server/routing";

const Body = z.object({
  action: z.enum(["accept", "decline"]),
  reason: z.string().trim().max(500).optional(),
});

/**
 * POST /api/v1/partner/offers/{id} — accept or decline an offered request.
 * Users: the database function checks the caller is an adviser/supervisor of the offered broker.
 * API keys (scope requests:read + the key's org must be the offered broker): service client.
 * First accept wins (one accepted offer per request); the other open offers are withdrawn.
 */
export const POST = withApi<"either", RouteContext<"/api/v1/partner/offers/[id]">>(
  async ({ auth, req }, route) => {
    const id = uuidParam((await route.params).id, "offer");
    const input = await parseJson(req, Body);
    let client: UserAuth["supabase"] | ApiKeyAuth["svc"];
    if (auth.kind === "apiKey") {
      if (auth.orgType !== "broker") throw forbidden("Only broker keys can respond to offers.");
      const offer = must(await auth.svc.from("order_offers").select("id, broker_org_id").eq("id", id).maybeSingle(), "Offer not found.");
      if (offer.broker_org_id !== auth.orgId) throw notFound("Offer not found.");
      client = auth.svc;
    } else {
      client = auth.supabase;
    }

    if (input.action === "accept") {
      const { data, error } = await client.rpc("accept_order_offer", { p_offer_id: id });
      if (error) throw dbError(error);
      const accepted = data?.[0];
      if (!accepted) throw rule("The offer could not be accepted.");
      await afterOfferAccepted(createServiceClient(), { request_id: accepted.request_id, broker_org_id: accepted.broker_org_id, reference: accepted.reference, customer_id: accepted.customer_id });
      return { status: "accepted", offerId: accepted.offer_id, requestId: accepted.request_id, reference: accepted.reference, brokerOrgId: accepted.broker_org_id };
    }

    const { data, error } = await client.rpc("decline_order_offer", { p_offer_id: id, p_reason: input.reason });
    if (error) throw dbError(error);
    const declined = data?.[0];
    if (!declined) throw rule("The offer could not be declined.");
    if (declined.open_offers === 0) await rerouteIfRoundClosed(createServiceClient(), declined.request_id);
    return { status: "declined", offerId: declined.offer_id, requestId: declined.request_id };
  },
  { auth: "either", scopes: ["requests:read"] },
);
