import { ClaimInfoRequestInput } from "@im/core";
import { check, must, notFound, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { requestClaimInfo } from "@/server/claims";
import { PARTNER_ROLES, requireRole, resolvePartnerOrg } from "@/server/partner-mobile";

/** GET /api/v1/partner/claims/{id}/info-requests — requests raised on the claim and their fulfilment. */
export const GET = withApi<"user", RouteContext<"/api/v1/partner/claims/[id]/info-requests">>(
  async ({ auth, req, client }, route) => {
    const id = uuidParam((await route.params).id, "claim");
    const p = await resolvePartnerOrg(auth, req, client);
    const claim = must(await auth.supabase.from("claims").select("id, broker_org_id, insurer_org_id").eq("id", id).maybeSingle(), "Claim not found.");
    if ((p.orgType === "broker" ? claim.broker_org_id : claim.insurer_org_id) !== p.orgId) throw notFound("Claim not found.");
    const res = await auth.supabase.from("claim_info_requests").select("*").eq("claim_id", id).order("created_at", { ascending: false });
    check(res);
    return { items: res.data ?? [] };
  },
  { auth: "user" },
);

/**
 * POST /api/v1/partner/claims/{id}/info-requests — ask the customer (or, for insurers, the broker) for a document,
 * information or an inspection slot. Notifies the requested party (customer: in-app, push, email and SMS).
 * Insurers may pass `setStatus: true` to move the claim to `info_requested` at the same time.
 */
export const POST = withApi<"user", RouteContext<"/api/v1/partner/claims/[id]/info-requests">>(
  async ({ auth, req, client }, route) => {
    const id = uuidParam((await route.params).id, "claim");
    const input = await parseJson(req, ClaimInfoRequestInput);
    const p = await resolvePartnerOrg(auth, req, client);
    requireRole(p, p.orgType === "broker" ? PARTNER_ROLES.brokerWork : PARTNER_ROLES.claims);
    const claim = must(await auth.supabase.from("claims").select("id, broker_org_id, insurer_org_id").eq("id", id).maybeSingle(), "Claim not found.");
    if ((p.orgType === "broker" ? claim.broker_org_id : claim.insurer_org_id) !== p.orgId) throw notFound("Claim not found.");
    const request = await requestClaimInfo(auth.supabase, {
      claimId: id,
      userId: auth.userId,
      kind: input.kind,
      requestedParty: input.requestedParty,
      message: input.message,
      dueAt: input.dueAt ?? null,
      setStatus: input.setStatus,
    });
    return Response.json({ ok: true, data: { request } }, { status: 201 });
  },
  { auth: "user" },
);
