import { CLAIM_STATUS, PartnerClaimUpdateInput } from "@im/core";
import { check, forbidden, must, notFound, parseJson, rule, uuidParam, withApi } from "@/server/api-auth";
import { notify, notifyOrg } from "@/server/notify";
import { PARTNER_ROLES, requireRole, resolvePartnerOrg } from "@/server/partner-mobile";
import { emitEvent } from "@/server/webhooks";

/**
 * POST /api/v1/partner/claims/{id}/updates — a broker records a claim step or note from the app.
 * Same rules as the web "Service & claims" desk: brokers may mark a claim delivered to the insurer and,
 * only while the insurer hasn't acted, acknowledgement/assessment/info steps; otherwise a note only.
 * Decisions are insurer-only (`POST /partner/claims/{id}/status` with an insurer key, or the web claims desk).
 * Insurer users (web) may add timeline notes here; their status changes go through the claims desk.
 */
export const POST = withApi<"user", RouteContext<"/api/v1/partner/claims/[id]/updates">>(
  async ({ auth, req, client }, route) => {
    const id = uuidParam((await route.params).id, "claim");
    const input = await parseJson(req, PartnerClaimUpdateInput);
    const p = await resolvePartnerOrg(auth, req, client);
    requireRole(p, p.orgType === "broker" ? PARTNER_ROLES.brokerWork : PARTNER_ROLES.claims);
    const sb = auth.supabase;
    const claim = must(await sb.from("claims").select("id, reference, status, customer_id, broker_org_id, insurer_org_id").eq("id", id).maybeSingle(), "Claim not found.");
    if ((p.orgType === "broker" ? claim.broker_org_id : claim.insurer_org_id) !== p.orgId) throw notFound("Claim not found.");

    let newStatus: typeof input.status | undefined;
    if (input.status) {
      if (p.orgType !== "broker") throw forbidden("Insurer status changes are recorded in the claims desk; add a note here.");
      if (input.status === "delivered_to_insurer") {
        if (!["reported", "draft"].includes(claim.status)) throw rule("This claim has already been delivered to the insurer.");
      } else {
        const { data: insurerEvents } = await sb.from("claim_events").select("id").eq("claim_id", claim.id).eq("actor_party", "insurer").limit(1);
        if (insurerEvents?.length) throw rule("The insurer is handling this claim now. Status updates come from them.");
        if (["approved", "partially_approved", "rejected", "paid", "closed", "withdrawn"].includes(claim.status)) throw rule(`This claim is already ${CLAIM_STATUS[claim.status].label.toLowerCase()}.`);
      }
      if (claim.status !== input.status) {
        check(await sb.from("claims").update({ status: input.status }).eq("id", claim.id));
        newStatus = input.status;
      }
    }
    const note = input.note?.trim();
    let event: { id: number; created_at: string } | null = null;
    if (note || newStatus) {
      event = must(
        await sb
          .from("claim_events")
          .insert({ claim_id: claim.id, actor_id: auth.userId, actor_party: p.orgType, from_status: newStatus ? claim.status : null, to_status: newStatus ?? null, note: note ?? null, visible_to_customer: input.visibleToCustomer })
          .select("id, created_at")
          .single(),
      );
    }
    if (newStatus) {
      await notify({
        userId: claim.customer_id,
        kind: "claim.status",
        title: `Claim ${claim.reference}: ${CLAIM_STATUS[newStatus].label}`,
        body: (input.visibleToCustomer && note) || CLAIM_STATUS[newStatus].customerHint || "Reporting a claim does not mean approval. The insurer decides.",
        link: `/account/claims/${claim.id}`,
        data: { claim_id: claim.id, status: newStatus },
      });
      if (newStatus === "delivered_to_insurer") {
        await notifyOrg(claim.insurer_org_id, { kind: "claim.delivered", title: `Claim ${claim.reference} delivered by ${p.orgName}`, link: `/partner/claims/${claim.id}`, data: { claim_id: claim.id } }, ["owner", "admin", "claims_officer"]);
      }
      const changed = { claim_id: claim.id, reference: claim.reference, from_status: claim.status, status: newStatus };
      await emitEvent(claim.broker_org_id, "claim.status_changed", changed);
      await emitEvent(claim.insurer_org_id, "claim.status_changed", changed);
    } else if (note && input.visibleToCustomer) {
      await notify({ userId: claim.customer_id, kind: "claim.status", title: `Update on claim ${claim.reference}`, body: note.length > 200 ? `${note.slice(0, 197)}…` : note, link: `/account/claims/${claim.id}`, data: { claim_id: claim.id, status: claim.status }, channels: ["in_app", "push", "email"] });
    }
    return Response.json(
      { ok: true, data: { claim: { id: claim.id, reference: claim.reference, status: newStatus ?? claim.status, statusLabel: CLAIM_STATUS[newStatus ?? claim.status].label }, event } },
      { status: 201 },
    );
  },
  { auth: "user" },
);
