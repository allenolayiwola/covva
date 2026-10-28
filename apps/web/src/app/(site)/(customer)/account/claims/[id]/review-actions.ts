"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ClaimJobReviewInput } from "@im/core";
import type { ActionState } from "@/components/customer/utils";
import { reviewClaimJob } from "@/server/partner-network";
import { BusinessRuleError } from "@/server/requests";
import { SIGNED_OUT, actionContext } from "../../_lib/action";

const uuid = z.string().uuid();

/** The customer rates a completed repair / tow / treatment on their claim (one rating per job). */
export async function rateClaimJob(claimId: string, jobId: string, _prev: ActionState, formData: FormData): Promise<ActionState> {
  const { supabase, user } = await actionContext();
  if (!user) return SIGNED_OUT;
  if (!uuid.safeParse(claimId).success || !uuid.safeParse(jobId).success) return { ok: false, error: "Unknown job." };
  const parsed = ClaimJobReviewInput.safeParse({ rating: formData.get("rating"), comment: formData.get("comment") || undefined });
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Choose 1 to 5 stars." };
  try {
    await reviewClaimJob(supabase, { userId: user.id, claimId, jobId, rating: parsed.data.rating, comment: parsed.data.comment });
  } catch (err) {
    return { ok: false, error: err instanceof BusinessRuleError ? err.message : "We couldn't save your rating." };
  }
  revalidatePath(`/account/claims/${claimId}`);
  return { ok: true, message: "Thank you — your rating helps other customers choose." };
}
