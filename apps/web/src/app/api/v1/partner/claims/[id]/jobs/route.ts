import { CLAIM_JOB_STATUS, ClaimJobInput, UpdateClaimJobInput } from "@im/core";
import { must, notFound, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { createClaimJob, listClaimJobs, updateClaimJob } from "@/server/claims";
import { PARTNER_ROLES, requireRole, resolvePartnerOrg } from "@/server/partner-mobile";

async function ownClaim(auth: { supabase: Parameters<typeof listClaimJobs>[0] }, id: string, orgType: "broker" | "insurer", orgId: string) {
  const claim = must(await auth.supabase.from("claims").select("id, broker_org_id, insurer_org_id").eq("id", id).maybeSingle(), "Claim not found.");
  if ((orgType === "broker" ? claim.broker_org_id : claim.insurer_org_id) !== orgId) throw notFound("Claim not found.");
  return claim;
}

/** GET /api/v1/partner/claims/{id}/jobs — jobs arranged on the claim. */
export const GET = withApi<"user", RouteContext<"/api/v1/partner/claims/[id]/jobs">>(
  async ({ auth, req, client }, route) => {
    const id = uuidParam((await route.params).id, "claim");
    const p = await resolvePartnerOrg(auth, req, client);
    await ownClaim(auth, id, p.orgType, p.orgId);
    const jobs = await listClaimJobs(auth.supabase, id);
    return { items: jobs.map((j) => ({ ...j, statusLabel: CLAIM_JOB_STATUS[j.status as keyof typeof CLAIM_JOB_STATUS]?.label ?? j.status })) };
  },
  { auth: "user" },
);

/**
 * POST /api/v1/partner/claims/{id}/jobs — assign an approved service partner (garage, towing, hospital…) to the claim.
 * `directBilling: true` is only accepted when the partner direct-bills the claim's insurer. Notifies the customer.
 */
export const POST = withApi<"user", RouteContext<"/api/v1/partner/claims/[id]/jobs">>(
  async ({ auth, req, client }, route) => {
    const id = uuidParam((await route.params).id, "claim");
    const input = await parseJson(req, ClaimJobInput);
    const p = await resolvePartnerOrg(auth, req, client);
    requireRole(p, p.orgType === "broker" ? PARTNER_ROLES.brokerWork : PARTNER_ROLES.claims);
    await ownClaim(auth, id, p.orgType, p.orgId);
    const job = await createClaimJob(auth.supabase, { ...input, claimId: id, userId: auth.userId });
    return Response.json({ ok: true, data: { job: { ...job, statusLabel: CLAIM_JOB_STATUS[job.status as keyof typeof CLAIM_JOB_STATUS]?.label } } }, { status: 201 });
  },
  { auth: "user" },
);

/** PATCH /api/v1/partner/claims/{id}/jobs — update a job (`jobId` + status/estimate/invoice/schedule/notes). */
export const PATCH = withApi<"user", RouteContext<"/api/v1/partner/claims/[id]/jobs">>(
  async ({ auth, req, client }, route) => {
    const id = uuidParam((await route.params).id, "claim");
    const input = await parseJson(req, UpdateClaimJobInput);
    const p = await resolvePartnerOrg(auth, req, client);
    requireRole(p, p.orgType === "broker" ? PARTNER_ROLES.brokerWork : PARTNER_ROLES.claims);
    await ownClaim(auth, id, p.orgType, p.orgId);
    const job = await updateClaimJob(auth.supabase, { ...input, userId: auth.userId });
    if (job.claim_id !== id) throw notFound("Job not found.");
    return { job: { ...job, statusLabel: CLAIM_JOB_STATUS[job.status as keyof typeof CLAIM_JOB_STATUS]?.label } };
  },
  { auth: "user" },
);
