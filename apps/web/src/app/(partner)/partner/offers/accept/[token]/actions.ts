"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { afterOfferAccepted, rerouteIfRoundClosed } from "@/server/routing";
import { ActionError, dbMessage, run, type ActionState } from "@/app/(partner)/partner/_lib/context";

const Token = z.string().regex(/^[a-f0-9]{32,64}$/i);

/**
 * One-tap accept. The signed-in user must be an adviser/supervisor of the offered broker:
 * the RPC (as the user, by offer id) enforces that, so the token only identifies the offer.
 */
export async function acceptByToken(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const token = Token.parse(formData.get("token"));
    const supabase = await createClient();
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new ActionError("Please sign in to accept this request.");
    // RLS: only members of the offered broker can see the offer at all.
    const { data: offer } = await supabase.from("order_offers").select("id").eq("accept_token", token).maybeSingle();
    if (!offer) throw new ActionError("This offer is not for your organisation, or the link has expired.");
    const { data, error } = await supabase.rpc("accept_order_offer", { p_offer_id: offer.id });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't accept this request.") };
    const accepted = data?.[0];
    if (!accepted) return { ok: false, error: "We couldn't accept this request." };
    try {
      await afterOfferAccepted(createServiceClient(), { request_id: accepted.request_id, broker_org_id: accepted.broker_org_id, reference: accepted.reference, customer_id: accepted.customer_id });
    } catch {
      /* best effort */
    }
    redirect(`/partner/requests/${accepted.request_id}?claimed=1`);
  });
}

export async function declineByToken(_prev: ActionState, formData: FormData): Promise<ActionState> {
  return run(async () => {
    const token = Token.parse(formData.get("token"));
    const supabase = await createClient();
    const { data: offer } = await supabase.from("order_offers").select("id").eq("accept_token", token).maybeSingle();
    if (!offer) throw new ActionError("This offer is not for your organisation, or the link has expired.");
    const { data, error } = await supabase.rpc("decline_order_offer", { p_offer_id: offer.id });
    if (error) return { ok: false, error: dbMessage(error, "We couldn't decline this request.") };
    const declined = data?.[0];
    if (declined && declined.open_offers === 0) {
      try {
        await rerouteIfRoundClosed(createServiceClient(), declined.request_id);
      } catch {
        /* cron picks it up */
      }
    }
    redirect("/partner/offers?declined=1");
  });
}
