import "server-only";
import { forbidden, notFound, type UserAuth } from "@/server/api-auth";
import { requestForCaller } from "@/server/access";

type Links = { requestId?: string; policyId?: string; claimId?: string };

/**
 * Work out whose folder a document belongs in (`{customerId}/{scope}/…`) and whether
 * the caller may upload there: the customer themselves, or servicing staff on a linked
 * request/policy/claim (all checked through RLS reads).
 */
export async function documentOwner(auth: UserAuth, links: Links): Promise<{ ownerId: string; party: "customer" | "broker" | "insurer" | "platform" }> {
  const sb = auth.supabase;
  let ownerId: string | null = null;
  let party: "customer" | "broker" | "insurer" | "platform" = "customer";
  if (links.requestId) {
    const r = await requestForCaller(auth, links.requestId);
    ownerId = r.request.customer_id;
    party = r.party;
  }
  if (links.policyId) {
    const { data: p } = await sb.from("policies").select("customer_id").eq("id", links.policyId).maybeSingle();
    if (!p) throw notFound("Policy not found.");
    if (ownerId && ownerId !== p.customer_id) throw forbidden("The linked records belong to different customers.");
    ownerId = p.customer_id;
  }
  if (links.claimId) {
    const { data: c } = await sb.from("claims").select("customer_id").eq("id", links.claimId).maybeSingle();
    if (!c) throw notFound("Claim not found.");
    if (ownerId && ownerId !== c.customer_id) throw forbidden("The linked records belong to different customers.");
    ownerId = c.customer_id;
  }
  ownerId ??= auth.userId;
  if (ownerId === auth.userId) return { ownerId, party: "customer" };
  if (party === "customer") {
    // Linked only via policy/claim: RLS let the caller read it, so they are servicing staff.
    const { data: m } = await sb.from("memberships").select("org:organizations!memberships_org_id_fkey(type)").eq("user_id", auth.userId).eq("active", true).limit(1).maybeSingle();
    const t = (m?.org as unknown as { type: string } | null)?.type;
    if (!t) throw forbidden();
    party = t === "insurer" ? "insurer" : t === "platform" ? "platform" : "broker";
  }
  return { ownerId, party };
}
