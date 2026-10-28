"use server";
import { redirect } from "next/navigation";
import { refresh } from "next/cache";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { afterOfferAccepted, rerouteIfRoundClosed } from "@/server/routing";
import { ROLES, actionContext, dbMessage, run, type ActionState } from "../../_lib/context";

const uuid = z.string().uuid();

/**
 * Accept an offered request. The database function checks the caller is an adviser or
 * supervisor of the offered broker, that the offer is open and unexpired, and that no other
 * broker has taken it (one accepted offer per request). Follow-ups (estimates, webhook,
 * customer notice) run with the service client afterwards.
 */
export async function acceptOffer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "broker", roles: ROLES.brokerWork });
    const offerId = uuid.parse(formData.get("offerId"));
    const { data, error } = await ctx.supabase.rpc("accept_order_offer", { p_offer_id: offerId });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't accept this request.") };
    const accepted = data?.[0];
    if (!accepted) return { ok: false, error: "We couldn't accept this request." };
    try {
      await afterOfferAccepted(createServiceClient(), { request_id: accepted.request_id, broker_org_id: accepted.broker_org_id, reference: accepted.reference, customer_id: accepted.customer_id });
    } catch {
      /* follow-ups are best effort; the request is already claimed */
    }
    redirect(`/partner/requests/${accepted.request_id}?claimed=1`);
  });
}

export async function declineOffer(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const ctx = await actionContext({ kind: "broker", roles: ROLES.brokerWork });
    const input = z.object({ offerId: uuid, reason: z.string().trim().max(500).optional() }).parse(Object.fromEntries(formData));
    const { data, error } = await ctx.supabase.rpc("decline_order_offer", { p_offer_id: input.offerId, p_reason: input.reason || undefined });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't decline this request.") };
    const declined = data?.[0];
    if (declined && declined.open_offers === 0) {
      // Whole round closed by declines: re-route now rather than waiting for the timeout cron.
      try {
        await rerouteIfRoundClosed(createServiceClient(), declined.request_id);
      } catch {
        /* the offer-expiry cron picks it up */
      }
    }
    refresh();
    return { ok: true, message: "Declined. The request has been offered to the next broker." };
  });
}
