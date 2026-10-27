import { AcceptEndorsementInput } from "@im/core";
import { must, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { acceptEndorsement, endorsementView } from "@/server/endorsements";

/**
 * POST /api/v1/endorsements/{id}/accept — the policyholder agrees to the quoted premium adjustment.
 * Additional premium returns `payment` (open `authorizationUrl`; the money settles to the insurer).
 * A refund is returned by the insurer once it applies the change.
 */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/endorsements/[id]/accept">) => {
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, AcceptEndorsementInput);
    must(await auth.supabase.from("endorsements").select("id").eq("id", id).eq("customer_id", auth.userId).maybeSingle(), "Change request not found.");
    const r = await acceptEndorsement(auth.userId, id, { channel: input.channel, callbackUrl: input.callbackUrl });
    return { endorsement: endorsementView(r.endorsement), payment: r.payment, refundDue: r.refundDue };
  },
  { auth: "user" },
);
