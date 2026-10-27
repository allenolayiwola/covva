"use server";
import { z } from "zod";
import { revalidateEverywhere } from "@/lib/revalidate";
import { authorize, dbMessage, done, fail, formObject, zodError, type ActionState } from "@/lib/actions";

const Moderate = z.object({ reviewId: z.string().uuid(), status: z.enum(["approved", "hidden"]), reason: z.string().trim().max(500).optional() });

/**
 * Approve or hide a customer review of a broker. Hiding needs a reason (recorded on the row and in
 * the audit log). Reviews are never deleted; the rating and text stay as written.
 */
export async function moderateBrokerReview(_: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await authorize("conduct");
  if (!auth.ok) return fail(auth.error);
  const parsed = Moderate.safeParse(formObject(fd));
  if (!parsed.success) return zodError(parsed.error);
  if (parsed.data.status === "hidden" && !parsed.data.reason) return fail("Give a reason when hiding a review.");
  const { error } = await auth.supabase
    .from("broker_reviews")
    .update({ status: parsed.data.status, moderation_reason: parsed.data.status === "hidden" ? parsed.data.reason ?? null : parsed.data.reason ?? null })
    .eq("id", parsed.data.reviewId);
  if (error) return fail(dbMessage(error));
  await revalidateEverywhere(["scorecards", "partners"]);
  return done(parsed.data.status === "approved" ? "Review approved. It is now shown publicly, anonymised." : "Review hidden. It still counts in the broker's private scorecard.");
}
