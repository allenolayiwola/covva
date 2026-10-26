import { CLAIM_STATUS, PartnerClaimStatusInput } from "@im/core";
import type { Update } from "@im/db";
import { forbidden, must, notFound, parseJson, rule, uuidParam, withApi } from "@/server/api-auth";
import { notify, notifyOrg } from "@/server/notify";

const FINAL = ["paid", "closed", "withdrawn", "rejected"];

/**
 * POST /api/v1/partner/claims/{id}/status — insurer API key (scope claims:write). Only the insurer
 * decides claims. Service client, after checking the key's org is the claim's insurer.
 */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/partner/claims/[id]/status">) => {
    if (auth.orgType !== "insurer") throw forbidden("Only the insurer can update claim decisions.");
    const id = uuidParam((await route.params).id);
    const input = await parseJson(req, PartnerClaimStatusInput);
    const svc = auth.svc;
    const claim = must(await svc.from("claims").select("id, reference, status, customer_id, broker_org_id, insurer_org_id").eq("id", id).maybeSingle(), "Claim not found.");
    if (claim.insurer_org_id !== auth.orgId) throw notFound("Claim not found.");
    if (FINAL.includes(claim.status) && !(claim.status === "rejected" && input.status === "closed") && !(input.status === "paid" && claim.status === "approved")) {
      throw rule(`This claim is already ${CLAIM_STATUS[claim.status].label.toLowerCase()}.`);
    }
    if (input.status === "paid" && !["approved", "partially_approved"].includes(claim.status)) throw rule("A claim must be approved before it is marked paid.");

    const patch: Update<"claims"> = { status: input.status };
    if (input.insurerReference) patch.insurer_reference = input.insurerReference;
    if (input.decisionAmount !== undefined) patch.decision_amount = input.decisionAmount;
    if (input.note && ["approved", "partially_approved", "rejected"].includes(input.status)) patch.decision_note = input.note;
    const updated = must(await svc.from("claims").update(patch).eq("id", id).select("id, reference, status, decision_amount, decision_at, paid_at").single());
    if (input.note) {
      await svc.from("claim_events").insert({ claim_id: id, actor_party: "insurer", from_status: claim.status, to_status: input.status, note: input.note, visible_to_customer: input.visibleToCustomer });
    }
    const label = CLAIM_STATUS[input.status].label;
    await notify({ userId: claim.customer_id, kind: "claim.status", title: `Claim ${claim.reference}: ${label}`, body: input.visibleToCustomer && input.note ? input.note : CLAIM_STATUS[input.status].customerHint, link: `/account/claims/${id}`, data: { claim_id: id, status: input.status } });
    if (claim.broker_org_id) await notifyOrg(claim.broker_org_id, { kind: "claim.status", title: `Claim ${claim.reference}: ${label}`, link: `/partner/claims/${id}`, data: { claim_id: id, status: input.status }, channels: ["in_app", "email"] });
    return { claim: { ...updated, statusLabel: CLAIM_STATUS[updated.status].label } };
  },
  { auth: "apiKey", scopes: ["claims:write"] },
);
