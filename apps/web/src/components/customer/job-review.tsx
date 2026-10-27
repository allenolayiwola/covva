import { Star } from "lucide-react";
import type { Supabase } from "@/app/(customer)/account/_lib/data";
import { rateClaimJob } from "@/app/(customer)/account/claims/[id]/review-actions";
import { myJobReviews } from "@/server/partner-network";
import { JobReviewForm } from "./job-review-form";

/**
 * "How did it go?" prompt under a completed claim job (customer only). Reads the caller's own review
 * through RLS; ratings are published to the partner directory once a partner has three reviews.
 */
export async function JobReviewPrompt({ supabase, claimId, jobId, partnerName }: { supabase: Supabase; claimId: string; jobId: string; partnerName: string }) {
  const mine = (await myJobReviews(supabase, [jobId])).get(jobId);
  if (mine) {
    return (
      <p className="mt-2 flex items-center gap-1 text-xs text-muted" aria-label={`You rated ${partnerName} ${mine.rating} out of 5`}>
        You rated this {Array.from({ length: 5 }, (_, i) => <Star key={i} aria-hidden className={`size-3.5 ${i < mine.rating ? "fill-amber text-amber" : "text-line"}`} />)}
      </p>
    );
  }
  return <JobReviewForm action={rateClaimJob.bind(null, claimId, jobId)} partnerName={partnerName} />;
}
