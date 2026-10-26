import { WithdrawClaimInput } from "@im/core";
import { must, parseJson, rule, uuidParam, withApi } from "@/server/api-auth";
import { notifyOrg } from "@/server/notify";

const WITHDRAWABLE = ["draft", "reported", "delivered_to_insurer", "acknowledged", "under_assessment", "info_requested"];

/** POST /api/v1/claims/{id}/withdraw — the customer withdraws a claim before a decision. */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/claims/[id]/withdraw">) => {
    const id = uuidParam((await route.params).id);
    const { reason } = await parseJson(req, WithdrawClaimInput);
    const sb = auth.supabase;
    const claim = must(await sb.from("claims").select("id, reference, status, customer_id, broker_org_id, insurer_org_id, delivered_to_insurer_at").eq("id", id).maybeSingle(), "Claim not found.");
    if (claim.customer_id !== auth.userId) throw rule("Only the policyholder can withdraw this claim.");
    if (!WITHDRAWABLE.includes(claim.status)) throw rule("This claim can no longer be withdrawn here. Contact your broker.");
    const updated = must(await sb.from("claims").update({ status: "withdrawn" }).eq("id", id).select("id, reference, status").single());
    if (reason) await sb.from("claim_events").insert({ claim_id: id, actor_id: auth.userId, actor_party: "customer", note: `Withdrawn: ${reason}` });
    const msg = { kind: "claim.withdrawn", title: `Claim ${claim.reference} withdrawn by the customer`, body: reason, data: { claim_id: id }, channels: ["in_app", "email"] as ("in_app" | "email")[] };
    if (claim.broker_org_id) await notifyOrg(claim.broker_org_id, { ...msg, link: `/partner/claims/${id}` });
    if (claim.delivered_to_insurer_at) await notifyOrg(claim.insurer_org_id, { ...msg, link: `/partner/claims/${id}` });
    return updated;
  },
  { auth: "user" },
);
