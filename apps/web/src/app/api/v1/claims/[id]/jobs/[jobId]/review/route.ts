import { ClaimJobReviewInput } from "@im/core";
import { must, parseJson, uuidParam, withApi } from "@/server/api-auth";
import { reviewClaimJob } from "@/server/partner-network";

/**
 * POST /api/v1/claims/{id}/jobs/{jobId}/review — the customer rates a completed repair / tow / treatment
 * (1–5, optional comment; one per job). Ratings show in the public directory once a partner has 3 reviews.
 */
export const POST = withApi(
  async ({ auth, req }, route: RouteContext<"/api/v1/claims/[id]/jobs/[jobId]/review">) => {
    const { id: rawId, jobId: rawJob } = await route.params;
    const id = uuidParam(rawId);
    const jobId = uuidParam(rawJob, "jobId");
    const input = await parseJson(req, ClaimJobReviewInput);
    must(await auth.supabase.from("claims").select("id").eq("id", id).eq("customer_id", auth.userId).maybeSingle(), "Claim not found.");
    const review = await reviewClaimJob(auth.supabase, { userId: auth.userId, claimId: id, jobId, rating: input.rating, comment: input.comment });
    return Response.json({ ok: true, data: { review: { id: review.id, rating: review.rating, comment: review.comment, status: review.status, createdAt: review.created_at } } }, { status: 201 });
  },
  { auth: "user" },
);
