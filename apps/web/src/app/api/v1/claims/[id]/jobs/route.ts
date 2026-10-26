import { CLAIM_JOB_STATUS } from "@im/core";
import { must, uuidParam, withApi } from "@/server/api-auth";
import { listClaimJobs } from "@/server/claims";

/** GET /api/v1/claims/{id}/jobs — repairs, towing, treatment arranged on the claim, with the partner's contact details and direct-billing status. */
export const GET = withApi(
  async ({ auth }, route: RouteContext<"/api/v1/claims/[id]">) => {
    const id = uuidParam((await route.params).id);
    must(await auth.supabase.from("claims").select("id").eq("id", id).maybeSingle(), "Claim not found.");
    const jobs = await listClaimJobs(auth.supabase, id);
    return {
      items: jobs.map((j) => ({ ...j, statusLabel: CLAIM_JOB_STATUS[j.status as keyof typeof CLAIM_JOB_STATUS]?.label ?? j.status, directBillingNote: j.direct_billing ? "Direct billing — you don't pay upfront. The insurer settles with the partner." : null })),
    };
  },
  { auth: "user" },
);
